/**
 * Live Translate Portal — server
 *
 * Responsibilities:
 *  1. Serve the static web client.
 *  2. WebRTC signaling (rooms of exactly two peers) over WebSocket at /signal.
 *  3. Secure proxy to the Gemini Live API (gemini-3.5-live-translate-preview) at /translate.
 *     The API key never leaves the server; the server sends the (locked) setup message
 *     containing the translation config, then pipes audio/transcripts both ways.
 */
import dotenv from 'dotenv';
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import selfsigned from 'selfsigned';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);

// Also load env files from the repo root (Google AI Studio runs from there and may
// write .env / .env.local), without overriding real environment variables/secrets.
for (const f of ['.env.local', '.env']) {
  for (const dir of [process.cwd(), __dirname, path.join(__dirname, '..')]) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) dotenv.config({ path: p });
  }
}

// The key is looked up on every use (not cached at boot) so a secret added in
// AI Studio → Settings → Secrets is picked up as soon as it is injected.
const KEY_NAMES = ['GEMINI_API_KEY', 'API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY'];
function getApiKey() {
  // 1) A real-looking key under a known name, 2) any real-looking key under any name,
  // 3) whatever GEMINI_API_KEY holds (AI Studio may inject a proxied value) — /api/key-check
  //    then verifies with Google whether it actually works.
  for (const name of KEY_NAMES) if (looksLikeGeminiKey(process.env[name])) return cleanKey(process.env[name]);
  for (const v of Object.values(process.env)) if (looksLikeGeminiKey(v)) return cleanKey(v);
  for (const name of KEY_NAMES) {
    const v = cleanKey(process.env[name]);
    if (v && v !== 'MY_GEMINI_API_KEY') return v;
  }
  return '';
}
function cleanKey(v) {
  return String(v || '').trim().replace(/^["']|["']$/g, '').replace(/^GEMINI_API_KEY\s*=\s*/, '').trim();
}
function looksLikeGeminiKey(v) {
  const s = cleanKey(v);
  return /^(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_.-]{30,})$/.test(s);
}
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-live-translate-preview';
const GEMINI_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// BCP-47 codes supported by Gemini Live Translate (see docs).
const SUPPORTED_LANGS = new Set([
  'af', 'ak', 'sq', 'am', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bg', 'my', 'ca', 'zh-Hans', 'zh-Hant',
  'hr', 'cs', 'da', 'nl', 'en', 'et', 'fil', 'fi', 'fr', 'gl', 'ka', 'de', 'el', 'gu', 'ha', 'he',
  'hi', 'hu', 'is', 'id', 'it', 'ja', 'jv', 'kn', 'kk', 'km', 'rw', 'ko', 'lo', 'lv', 'lt', 'mk',
  'ms', 'ml', 'mr', 'mn', 'ne', 'no', 'nb', 'fa', 'pl', 'pt-BR', 'pt-PT', 'pa', 'ro', 'ru', 'sr',
  'sd', 'si', 'sk', 'sl', 'es', 'su', 'sw', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'zu',
]);

// ---------------------------------------------------------------------------
// HTTP app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/api/config', (_req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  const hasApiKey = Boolean(getApiKey());
  res.json({
    iceServers,
    model: MODEL,
    hasApiKey,
    publicUrl: process.env.PUBLIC_URL || '',
    ...(hasApiKey ? {} : { keyDiag: keyDiagnostics() }),
  });
});

// Verifies the key with Google (cached briefly) and explains any problem in plain terms.
let keyCheckCache = { at: 0, key: '', result: null };
app.get('/api/key-check', async (req, res) => {
  const key = getApiKey();
  if (!key) return res.json({ ok: false, kind: 'missing', diag: keyDiagnostics() });
  const fresh = req.query.fresh === '1';
  if (!fresh && keyCheckCache.key === key && Date.now() - keyCheckCache.at < 5 * 60_000) return res.json(keyCheckCache.result);
  let result;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) result = { ok: true };
    else {
      const body = await r.text();
      result = { ok: false, kind: classifyGeminiError(`${r.status} ${body}`), detail: extractMessage(body) || `HTTP ${r.status}` };
    }
  } catch (err) {
    result = { ok: false, kind: 'network', detail: err.message };
  }
  if (!result.ok) result.diag = keyDiagnostics();
  keyCheckCache = { at: Date.now(), key, result };
  res.json(result);
});

function extractMessage(body) {
  try {
    return JSON.parse(body)?.error?.message || '';
  } catch {
    return String(body || '').slice(0, 200);
  }
}

/** Map a Gemini error (HTTP body or WebSocket close reason) to a fix-it category. */
function classifyGeminiError(text) {
  const t = String(text || '');
  if (/API[_ ]?KEY[_ ]?INVALID|API key not valid|invalid api key|API key expired|UNAUTHENTICATED|\b401\b/i.test(t)) return 'invalid';
  if (/RESOURCE_EXHAUSTED|quota|rate limit|\b429\b/i.test(t)) return 'quota';
  if (/billing/i.test(t)) return 'billing';
  if (/PERMISSION_DENIED|permission|SERVICE_DISABLED|has not been used|disabled|\b403\b/i.test(t)) return 'permission';
  if (/not found|NOT_FOUND|is not supported|\b404\b/i.test(t)) return 'model';
  return 'other';
}

// Safe diagnostics: never returns key values — only names, lengths and a 3-char prefix.
function keyDiagnostics() {
  const vars = Object.entries(process.env)
    .filter(([k, v]) => /KEY|GEMINI|GOOGLE|GENAI|SECRET|TOKEN/i.test(k) || looksLikeGeminiKey(v))
    .map(([k, v]) => `${k} (len ${String(v || '').length}${v ? `, starts "${String(v).trim().slice(0, 3)}"` : ''})`);
  const envFiles = [];
  for (const f of ['.env.local', '.env']) {
    for (const dir of [process.cwd(), __dirname, path.join(__dirname, '..')]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) envFiles.push(path.relative(process.cwd(), p) || f);
    }
  }
  return {
    vars: vars.length ? vars : ['(no key-like environment variables)'],
    envFiles: [...new Set(envFiles)],
    serverStartedSecondsAgo: Math.round(process.uptime()),
  };
}

// ---------------------------------------------------------------------------
// Signaling: rooms of two
// ---------------------------------------------------------------------------
/** @type {Map<string, Set<WebSocket>>} */
const rooms = new Map();
/** Latest signaling socket per browser tab (clientId survives reconnects). @type {Map<string, WebSocket>} */
const clients = new Map();

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Other participants in the same room as the given client. */
function partnersOf(cid) {
  const ws = clients.get(cid);
  if (!ws?.room) return [];
  return [...(rooms.get(ws.room) || [])].filter((p) => p !== ws && p.readyState === WebSocket.OPEN);
}

function leaveRoom(ws, notify = true) {
  if (!ws.room) return;
  const peers = rooms.get(ws.room);
  if (peers) {
    peers.delete(ws);
    console.log(`[room ${ws.room}] ${ws.profile?.name} left — ${peers.size}/2`);
    if (notify) for (const p of peers) send(p, { type: 'peer-left' });
    if (peers.size === 0) rooms.delete(ws.room);
  }
  ws.room = null;
}

function handleSignal(ws) {
  ws.room = null;
  ws.profile = null;
  ws.cid = null;

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return; // media travels on /translate (voice) and /relay (fallback video)

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const room = String(msg.room || '').trim().toLowerCase().slice(0, 40);
      if (!room) return send(ws, { type: 'error', message: 'Missing room code.' });
      const cid = String(msg.cid || '').slice(0, 64) || Math.random().toString(36).slice(2);
      // A reconnect from the same tab replaces its stale socket instead of counting as a third person.
      const stale = clients.get(cid);
      if (stale && stale !== ws) {
        leaveRoom(stale, false);
        try { stale.terminate(); } catch {}
      }
      const peers = rooms.get(room) || new Set();
      if (peers.size >= 2) return send(ws, { type: 'room-full' });

      ws.cid = cid;
      clients.set(cid, ws);
      ws.room = room;
      ws.profile = { name: String(msg.name || 'Guest').slice(0, 40), lang: String(msg.lang || 'en') };
      peers.add(ws);
      rooms.set(room, peers);
      console.log(`[room ${room}] ${ws.profile.name} (${ws.profile.lang}) joined — ${peers.size}/2`);

      const other = [...peers].find((p) => p !== ws);
      send(ws, { type: 'joined', room, peer: other ? other.profile : null });
      if (other) send(other, { type: 'peer-joined', peer: ws.profile, initiator: true });
      return;
    }

    // Everything else is relayed to the other peer in the room.
    if (!ws.room) return;
    if (msg.type === 'profile' && msg.profile) ws.profile = { ...ws.profile, ...msg.profile };
    if (msg.type === 'rtc-state') console.log(`[room ${ws.room}] ${ws.profile?.name}: video link ${msg.state}`);
    for (const p of rooms.get(ws.room) || []) if (p !== ws) send(p, msg);
  });

  ws.on('close', () => {
    if (ws.cid && clients.get(ws.cid) === ws) clients.delete(ws.cid);
    leaveRoom(ws);
  });
}

// ---------------------------------------------------------------------------
// Fallback video relay (/relay?room=…) — its own socket so video can never delay voice.
// ---------------------------------------------------------------------------
/** @type {Map<string, Set<WebSocket>>} */
const relayRooms = new Map();

function handleRelay(ws, url) {
  const room = String(url.searchParams.get('room') || '').trim().toLowerCase().slice(0, 40);
  if (!room) return ws.close(1008, 'room required');
  const set = relayRooms.get(room) || new Set();
  set.add(ws);
  relayRooms.set(room, set);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    for (const p of set) {
      if (p === ws || p.readyState !== WebSocket.OPEN) continue;
      if (p.bufferedAmount > 96 * 1024) continue; // congested → drop this frame, the next one is fresher
      p.send(data, { binary: true });
    }
  });
  ws.on('close', () => {
    set.delete(ws);
    if (!set.size) relayRooms.delete(room);
  });
}

// ---------------------------------------------------------------------------
// Gemini Live Translate proxy
//
// Latency: the translated voice is forwarded from here *straight to the partner* (binary
// [1][PCM 24 kHz]) instead of round-tripping through the speaker's browser. The speaker only
// receives the (small) transcript messages for captions.
// ---------------------------------------------------------------------------
const KEY_HELP = {
  missing: 'The server has no Gemini API key.',
  invalid: 'Google rejected the Gemini API key (invalid, expired or mistyped).',
  permission: "The Gemini API key's project isn't allowed to use this model / the Gemini API is disabled.",
  model: `The model ${MODEL} isn't available to this API key.`,
  quota: 'The Gemini API key has hit its quota / rate limit.',
  billing: 'This model requires billing on the API key’s Google Cloud project.',
  network: 'The server could not reach Google.',
  other: 'Gemini returned an error.',
};

function handleTranslate(client, url) {
  let target = url.searchParams.get('target') || 'en';
  if (!SUPPORTED_LANGS.has(target)) target = 'en';
  const cid = String(url.searchParams.get('cid') || '');

  const key = getApiKey();
  if (!key) {
    client.send(JSON.stringify({ error: { kind: 'missing', message: KEY_HELP.missing } }));
    client.close(4001, 'Missing API key');
    return;
  }

  const upstream = new WebSocket(`${GEMINI_WS_URL}?key=${encodeURIComponent(key)}`, { perMessageDeflate: false });
  const pending = [];

  upstream.on('open', () => {
    try { upstream._socket?.setNoDelay(true); } catch {}
    console.log(`[gemini] translation session opened → ${target}`);
    upstream.send(
      JSON.stringify({
        setup: {
          model: `models/${MODEL}`,
          // Note: transcription toggles live at the setup level (the docs' raw-WebSocket sample
          // nests them in generationConfig, which the API rejects).
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          generationConfig: {
            responseModalities: ['AUDIO'],
            translationConfig: {
              targetLanguageCode: target,
              // The partner only receives the translated track (never the raw mic), so if the
              // speaker already uses the listener's language we still want it voiced through.
              echoTargetLanguage: true,
            },
          },
        },
      }),
    );
    for (const m of pending.splice(0)) upstream.send(m);
  });

  upstream.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const parts = msg.serverContent?.modelTurn?.parts;
    if (parts?.length) {
      const partners = cid ? partnersOf(cid) : [];
      for (const part of parts) {
        const b64 = part.inlineData?.data;
        if (!b64) continue;
        const pcm = Buffer.from(b64, 'base64');
        if (partners.length && audible(pcm)) {
          const frame = Buffer.allocUnsafe(pcm.length + 1);
          frame[0] = 1;
          pcm.copy(frame, 1);
          for (const p of partners) p.send(frame, { binary: true });
        }
        delete part.inlineData; // the speaker doesn't need their own translated audio
      }
      msg.serverContent.modelTurn.parts = parts.filter((p) => Object.keys(p).length);
      if (!msg.serverContent.modelTurn.parts.length) delete msg.serverContent.modelTurn;
    }
    if (msg.serverContent && !Object.keys(msg.serverContent).length) return;
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
  });

  upstream.on('close', (code, reason) => {
    const why = reason?.toString() || '';
    console.log(`[gemini] session closed (${code}) ${why}`);
    if (client.readyState === WebSocket.OPEN) {
      if (code !== 1000) {
        const kind = classifyGeminiError(`${code} ${why}`);
        const fatal = ['invalid', 'permission', 'model', 'billing'].includes(kind);
        client.send(JSON.stringify({ error: { code, kind: fatal || kind === 'quota' ? kind : 'other', fatal, message: why || `Upstream closed (${code})` } }));
      }
      client.close(code === 1000 ? 1000 : 4002, why.slice(0, 120));
    }
  });

  upstream.on('error', (err) => {
    console.error('[gemini] upstream error:', err.message);
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ error: { kind: 'network', message: `Gemini connection error: ${err.message}` } }));
      client.close(4003, 'Upstream error');
    }
  });

  client.on('message', (data) => {
    const text = data.toString();
    if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
    else if (upstream.readyState === WebSocket.CONNECTING) pending.push(text);
  });

  client.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
  });
}

/** True if a 16-bit PCM buffer contains more than digital near-silence. */
function audible(buf) {
  for (let i = 0; i + 1 < buf.length; i += 8) {
    const v = buf.readInt16LE(i);
    if (v > 40 || v < -40) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// WebSocket routing
// ---------------------------------------------------------------------------
const signalWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
const translateWss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
const relayWss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
signalWss.on('connection', handleSignal);
translateWss.on('connection', (ws, req) => handleTranslate(ws, new URL(req.url, 'http://x')));
relayWss.on('connection', (ws, req) => handleRelay(ws, new URL(req.url, 'http://x')));

function attachUpgrade(server) {
  server.on('upgrade', (req, socket, head) => {
    try { socket.setNoDelay(true); } catch {}
    const { pathname } = new URL(req.url, 'http://x');
    const wss = { '/signal': signalWss, '/translate': translateWss, '/relay': relayWss }[pathname];
    if (wss) wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    else socket.destroy();
  });
}

// Keep sockets alive through proxies (Cloud Run / AI Studio) that drop idle connections.
setInterval(() => {
  for (const wss of [signalWss, relayWss]) for (const ws of wss.clients) try { ws.ping(); } catch {}
}, 25_000);

// ---------------------------------------------------------------------------
// Start HTTP (localhost) + HTTPS (LAN, self-signed — cameras require a secure context)
// ---------------------------------------------------------------------------
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function loadOrCreateCert() {
  const dir = path.join(__dirname, '.certs');
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  const ips = lanAddresses();
  const stampPath = path.join(dir, 'ips.txt');
  const stamp = ips.sort().join(',');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(stampPath) && fs.readFileSync(stampPath, 'utf8') === stamp) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  const pems = selfsigned.generate([{ name: 'commonName', value: 'live-translate-portal' }], {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7, ip }))],
      },
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(stampPath, stamp);
  return { key: pems.private, cert: pems.cert };
}

// Hosted platforms (Cloud Run / Google AI Studio) provide HTTPS themselves and only
// route one port, so the self-signed LAN listener is only used on a local machine.
const ENABLE_LAN_HTTPS = !process.env.K_SERVICE && !process.env.DISABLE_HTTPS;

const httpServer = http.createServer(app);
attachUpgrade(httpServer);
httpServer.listen(PORT, () => {
  console.log(`\n  Live Translate Portal`);
  console.log(`  ─────────────────────`);
  console.log(`  Local:    http://localhost:${PORT}`);
  if (!ENABLE_LAN_HTTPS) {
    console.log(`  Model:    ${MODEL}`);
    if (!getApiKey()) console.warn('  ⚠  GEMINI_API_KEY is not set.');
  }
});

if (ENABLE_LAN_HTTPS) try {
  const httpsServer = https.createServer(loadOrCreateCert(), app);
  attachUpgrade(httpsServer);
  httpsServer.listen(HTTPS_PORT, () => {
    for (const ip of lanAddresses()) console.log(`  Network:  https://${ip}:${HTTPS_PORT}   (self-signed — accept the browser warning)`);
    console.log(`  Model:    ${MODEL}`);
    if (!getApiKey()) console.warn('\n  ⚠  GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.\n');
    else console.log('');
  });
} catch (err) {
  console.warn('  HTTPS disabled:', err.message);
}

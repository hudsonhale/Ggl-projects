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
import 'dotenv/config';
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
const API_KEY = process.env.GEMINI_API_KEY || '';
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
  res.json({ iceServers, model: MODEL, hasApiKey: Boolean(API_KEY) });
});

// ---------------------------------------------------------------------------
// Signaling: rooms of two
// ---------------------------------------------------------------------------
/** @type {Map<string, Set<WebSocket>>} */
const rooms = new Map();

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handleSignal(ws) {
  ws.room = null;
  ws.profile = null;

  ws.on('message', (raw, isBinary) => {
    // Binary frames: [type byte][payload]. 1 = translated voice (PCM 24 kHz), 2 = fallback video (JPEG).
    // Relayed verbatim to the other peer. This path works on any network, unlike peer-to-peer WebRTC.
    if (isBinary) {
      if (!ws.room) return;
      const kind = raw[0];
      for (const p of rooms.get(ws.room) || []) {
        if (p === ws || p.readyState !== WebSocket.OPEN) continue;
        if (kind === 2 && p.bufferedAmount > 512 * 1024) continue; // drop video frames if the link is congested
        p.send(raw, { binary: true });
      }
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const room = String(msg.room || '').trim().toLowerCase().slice(0, 40);
      if (!room) return send(ws, { type: 'error', message: 'Missing room code.' });
      const peers = rooms.get(room) || new Set();
      if (peers.size >= 2) return send(ws, { type: 'room-full' });

      ws.room = room;
      ws.profile = { name: String(msg.name || 'Guest').slice(0, 40), lang: String(msg.lang || 'en') };
      peers.add(ws);
      rooms.set(room, peers);
      console.log(`[room ${room}] ${ws.profile.name} (${ws.profile.lang}) joined — ${peers.size}/2`);

      const other = [...peers].find((p) => p !== ws);
      send(ws, { type: 'joined', room, peer: other ? other.profile : null });
      if (other) {
        // The peer that was already waiting creates the WebRTC offer.
        send(other, { type: 'peer-joined', peer: ws.profile, initiator: true });
      }
      return;
    }

    // Everything else is relayed to the other peer in the room.
    if (!ws.room) return;
    if (msg.type === 'profile' && msg.profile) {
      ws.profile = { ...ws.profile, ...msg.profile };
    }
    if (msg.type === 'rtc-state') console.log(`[room ${ws.room}] ${ws.profile?.name}: video link ${msg.state}`);
    for (const p of rooms.get(ws.room) || []) {
      if (p !== ws) send(p, msg);
    }
  });

  ws.on('close', () => {
    if (!ws.room) return;
    const peers = rooms.get(ws.room);
    if (!peers) return;
    peers.delete(ws);
    console.log(`[room ${ws.room}] ${ws.profile?.name} left — ${peers.size}/2`);
    for (const p of peers) send(p, { type: 'peer-left' });
    if (peers.size === 0) rooms.delete(ws.room);
  });
}

// ---------------------------------------------------------------------------
// Gemini Live Translate proxy
// ---------------------------------------------------------------------------
function handleTranslate(client, url) {
  let target = url.searchParams.get('target') || 'en';
  if (!SUPPORTED_LANGS.has(target)) target = 'en';

  if (!API_KEY) {
    client.send(JSON.stringify({ error: { message: 'Server is missing GEMINI_API_KEY. Add it to .env and restart.' } }));
    client.close(4001, 'Missing API key');
    return;
  }

  const upstream = new WebSocket(`${GEMINI_WS_URL}?key=${encodeURIComponent(API_KEY)}`);
  const pending = [];

  upstream.on('open', () => {
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
    if (client.readyState === WebSocket.OPEN) client.send(data.toString());
  });

  upstream.on('close', (code, reason) => {
    const why = reason?.toString() || '';
    console.log(`[gemini] session closed (${code}) ${why}`);
    if (client.readyState === WebSocket.OPEN) {
      if (code !== 1000) client.send(JSON.stringify({ error: { code, message: why || `Upstream closed (${code})` } }));
      client.close(code === 1000 ? 1000 : 4002, why.slice(0, 120));
    }
  });

  upstream.on('error', (err) => {
    console.error('[gemini] upstream error:', err.message);
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ error: { message: `Gemini connection error: ${err.message}` } }));
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

// ---------------------------------------------------------------------------
// WebSocket routing
// ---------------------------------------------------------------------------
const signalWss = new WebSocketServer({ noServer: true });
const translateWss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
signalWss.on('connection', handleSignal);
translateWss.on('connection', (ws, req) => handleTranslate(ws, new URL(req.url, 'http://x')));

function attachUpgrade(server) {
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/signal') signalWss.handleUpgrade(req, socket, head, (ws) => signalWss.emit('connection', ws, req));
    else if (pathname === '/translate')
      translateWss.handleUpgrade(req, socket, head, (ws) => translateWss.emit('connection', ws, req));
    else socket.destroy();
  });
}

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
    if (!API_KEY) console.warn('  ⚠  GEMINI_API_KEY is not set.');
  }
});

if (ENABLE_LAN_HTTPS) try {
  const httpsServer = https.createServer(loadOrCreateCert(), app);
  attachUpgrade(httpsServer);
  httpsServer.listen(HTTPS_PORT, () => {
    for (const ip of lanAddresses()) console.log(`  Network:  https://${ip}:${HTTPS_PORT}   (self-signed — accept the browser warning)`);
    console.log(`  Model:    ${MODEL}`);
    if (!API_KEY) console.warn('\n  ⚠  GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.\n');
    else console.log('');
  });
} catch (err) {
  console.warn('  HTTPS disabled:', err.message);
}

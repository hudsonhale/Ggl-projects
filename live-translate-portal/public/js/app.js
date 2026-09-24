import { LANGUAGES, languageName, guessBrowserLanguage, isRtl } from './languages.js';
import { AudioEngine, VoiceGate } from './audio.js';
import { LiveTranslator } from './translator.js';
import { PeerLink } from './rtc.js';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = {
  lobby: $('lobby'),
  call: $('call'),
  previewVideo: $('previewVideo'),
  previewEmpty: $('previewEmpty'),
  previewEmptyText: $('previewEmptyText'),
  retryMediaBtn: $('retryMediaBtn'),
  lobbyMeter: $('lobbyMeter'),
  camSelect: $('camSelect'),
  micSelect: $('micSelect'),
  joinForm: $('joinForm'),
  nameInput: $('nameInput'),
  langSelect: $('langSelect'),
  roomInput: $('roomInput'),
  newRoomBtn: $('newRoomBtn'),
  joinBtn: $('joinBtn'),
  keyWarning: $('keyWarning'),
  keyWarningText: $('keyWarningText'),
  keyHelpBtn: $('keyHelpBtn'),
  keyHelp: $('keyHelp'),
  keyHelpWhy: $('keyHelpWhy'),
  keyHelpSteps: $('keyHelpSteps'),
  keyHelpDiag: $('keyHelpDiag'),
  keyRecheckBtn: $('keyRecheckBtn'),
  keyCloseBtn: $('keyCloseBtn'),

  remoteVideo: $('remoteVideo'),
  relayCanvas: $('relayCanvas'),
  headphonesBtn: $('headphonesBtn'),
  remotePlaceholder: $('remotePlaceholder'),
  remoteAvatar: $('remoteAvatar'),
  connDot: $('connDot'),
  roomLabel: $('roomLabel'),
  xlStatus: $('xlStatus'),
  xlStatusText: $('xlStatusText'),
  partnerChip: $('partnerChip'),
  partnerBars: $('partnerBars'),
  partnerName: $('partnerName'),
  partnerLang: $('partnerLang'),
  waiting: $('waiting'),
  shareInput: $('shareInput'),
  copyBtn: $('copyBtn'),
  captions: $('captions'),
  selfTile: $('selfTile'),
  localVideo: $('localVideo'),
  selfBars: $('selfBars'),
  transcript: $('transcript'),
  transcriptList: $('transcriptList'),
  transcriptEmpty: $('transcriptEmpty'),
  closeTranscriptBtn: $('closeTranscriptBtn'),
  micBtn: $('micBtn'),
  camBtn: $('camBtn'),
  ccBtn: $('ccBtn'),
  transcriptBtn: $('transcriptBtn'),
  callLangSelect: $('callLangSelect'),
  leaveBtn: $('leaveBtn'),
  toast: $('toast'),
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], hasApiKey: true },
  stream: null, // local camera + mic
  me: { name: '', lang: 'en' },
  partner: null,
  room: '',
  signal: null,
  peer: null,
  translator: null,
  micLevel: 0,
  inCall: false,
  micOn: true,
  camOn: true,
  partnerCamOn: true,
  partnerSince: 0,
  headphones: localStorage.getItem('portal.headphones') === '1',
  sendSignal: null,
  relay: null, // fallback-video socket
  // Stable id for this tab: lets the server route my translated voice straight to my partner,
  // and survive reconnects without being mistaken for a third person.
  cid: uid(),
};
const gate = new VoiceGate({ chunkMs: 40 });

const audio = new AudioEngine();
const resumeAudio = () => audio.resume().catch(() => {});
document.addEventListener('pointerdown', resumeAudio);
document.addEventListener('keydown', resumeAudio);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
init();

async function init() {
  const options = LANGUAGES.map(([code, name, native]) => {
    const label = name === native ? name : `${name} — ${native}`;
    return `<option value="${code}">${label}</option>`;
  }).join('');
  el.langSelect.innerHTML = options;
  el.callLangSelect.innerHTML = LANGUAGES.map(([code, name]) => `<option value="${code}">${name}</option>`).join('');

  state.me.lang = localStorage.getItem('portal.lang') || guessBrowserLanguage();
  el.langSelect.value = state.me.lang;
  el.nameInput.value = localStorage.getItem('portal.name') || '';
  const params = new URLSearchParams(location.search);
  el.roomInput.value = params.get('room') || randomRoom();

  try {
    state.config = await (await fetch('/api/config')).json();
  } catch {}
  checkKey();

  audio.onMicLevel = (lvl) => (state.micLevel = lvl);
  // Echo guard: unless the user wears headphones, feed the translator silence while the partner's
  // translated voice is playing from the speakers, so it can't be picked up and translated back.
  audio.onPcm = (buf) => {
    if (!state.translator) return;
    // 1) Echo guard (speaker mode): while the partner's translated voice is coming out of the
    //    speakers, send silence so it can't be re-translated back to them (the "repeating" bug).
    if (!state.headphones && audio.isPlayingIncoming(0.6)) {
      gate.reset();
      state.translator.sendPcm(new ArrayBuffer(buf.byteLength));
      return;
    }
    // 2) Voice gate: only the person in front of the camera gets through — background noise and
    //    distant voices become silence.
    for (const chunk of gate.process(buf)) state.translator.sendPcm(chunk);
  };
  el.headphonesBtn.setAttribute('aria-pressed', String(state.headphones));

  await startMedia();
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Local media
// ---------------------------------------------------------------------------
async function startMedia({ camId, micId } = {}) {
  const constraints = {
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...(camId ? { deviceId: { exact: camId } } : {}) },
    audio: {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      voiceIsolation: { ideal: true }, // Chrome's ML voice isolation where available (ignored elsewhere)
      channelCount: 1,
      ...(micId ? { deviceId: { exact: micId } } : {}),
    },
  };
  try {
    const next = await navigator.mediaDevices.getUserMedia(constraints);
    const old = state.stream;
    state.stream = next;
    el.previewVideo.srcObject = next;
    el.localVideo.srcObject = next;
    el.previewEmpty.hidden = true;

    const mic = next.getAudioTracks()[0];
    const cam = next.getVideoTracks()[0];
    if (mic) {
      mic.enabled = state.micOn;
      await audio.attachMic(mic);
    }
    if (cam) cam.enabled = state.camOn;
    if (state.peer && cam) await state.peer.replaceVideoTrack(cam);
    old?.getTracks().forEach((t) => t.stop());
    await listDevices();
  } catch (err) {
    console.warn('getUserMedia failed', err);
    el.previewEmpty.hidden = false;
    el.previewEmptyText.textContent = !window.isSecureContext
      ? 'Camera access needs a secure connection. Open this page via https:// or localhost.'
      : err.name === 'NotAllowedError'
        ? 'Camera & microphone access was blocked. Allow it in your browser, then retry.'
        : `Couldn't start your camera or microphone (${err.name}).`;
  }
}

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const fill = (select, kind, currentId) => {
    const list = devices.filter((d) => d.kind === kind);
    select.innerHTML = list
      .map((d, i) => `<option value="${d.deviceId}">${escapeHtml(d.label || `${kind === 'videoinput' ? 'Camera' : 'Microphone'} ${i + 1}`)}</option>`)
      .join('');
    if (currentId) select.value = currentId;
  };
  fill(el.camSelect, 'videoinput', state.stream?.getVideoTracks()[0]?.getSettings().deviceId);
  fill(el.micSelect, 'audioinput', state.stream?.getAudioTracks()[0]?.getSettings().deviceId);
}

el.retryMediaBtn.addEventListener('click', () => startMedia());
el.camSelect.addEventListener('change', () => startMedia({ camId: el.camSelect.value, micId: el.micSelect.value }));
el.micSelect.addEventListener('change', () => startMedia({ camId: el.camSelect.value, micId: el.micSelect.value }));

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
el.newRoomBtn.addEventListener('click', () => {
  el.roomInput.value = randomRoom();
  el.roomInput.focus();
});

el.langSelect.addEventListener('change', () => localStorage.setItem('portal.lang', el.langSelect.value));

el.joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  await resumeAudio();
  if (!state.stream) {
    await startMedia();
    if (!state.stream) return;
  }
  state.me = { name: el.nameInput.value.trim() || 'Guest', lang: el.langSelect.value };
  state.room = slug(el.roomInput.value);
  if (!state.room) return;
  localStorage.setItem('portal.name', state.me.name);
  localStorage.setItem('portal.lang', state.me.lang);
  history.replaceState(null, '', `?room=${encodeURIComponent(state.room)}`);
  enterCall();
});

// ---------------------------------------------------------------------------
// Call lifecycle
// ---------------------------------------------------------------------------
function enterCall() {
  state.inCall = true;
  el.lobby.hidden = true;
  el.call.hidden = false;
  el.roomLabel.textContent = state.room;
  el.shareInput.value = shareUrl(state.room);
  el.callLangSelect.value = state.me.lang;
  el.localVideo.srcObject = state.stream;
  el.transcriptList.innerHTML = '';
  el.transcriptEmpty.hidden = false;
  el.captions.innerHTML = '';
  setPartner(null);
  setXlStatus('idle');
  audio.setupPlayback();
  connectSignal();
  connectRelay();
}

/**
 * The invite link must work for the other person: never hand out an AI Studio *dev* URL
 * (ais-dev-…, only works for the app owner) — use the shared *pre* URL (ais-pre-…) instead,
 * or PUBLIC_URL if the server sets one.
 */
function shareUrl(room) {
  let base = state.config.publicUrl || location.origin;
  try {
    const u = new URL(base);
    u.hostname = u.hostname.replace(/^ais-dev-/, 'ais-pre-');
    base = u.origin;
  } catch {}
  return `${base.replace(/\/$/, '')}/?room=${encodeURIComponent(room)}`;
}

function leaveCall({ toLobby = true } = {}) {
  state.inCall = false;
  stopTranslator();
  state.peer?.close();
  state.peer = null;
  audio.flushIncoming();
  setRelaySending(false);
  if (state.signal) {
    state.signal.onclose = null;
    state.signal.close();
  }
  state.signal = null;
  const relay = state.relay;
  state.relay = null;
  try { relay?.close(); } catch {}
  gate.reset();
  el.remoteVideo.srcObject = null;
  if (toLobby) {
    el.call.hidden = true;
    el.lobby.hidden = false;
    el.previewVideo.srcObject = state.stream;
  }
}

el.leaveBtn.addEventListener('click', () => leaveCall());

function connectSignal() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/signal`);
  state.signal = ws;
  ws.binaryType = 'arraybuffer';
  const sendSignal = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  state.sendSignal = sendSignal;

  ws.onopen = () => sendSignal({ type: 'join', room: state.room, cid: state.cid, name: state.me.name, lang: state.me.lang });

  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return handleBinary(ev.data);
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      case 'seg':
        renderCaption(msg.seg);
        upsertTranscript(msg.seg, 'partner');
        break;
      case 'cam':
        state.partnerCamOn = msg.on;
        break;
      case 'need-relay':
        setRelaySending(msg.on);
        break;
      case 'joined':
        if (msg.peer) {
          setPartner(msg.peer);
          createPeer(false, sendSignal);
        }
        break;
      case 'peer-joined':
        setPartner(msg.peer);
        createPeer(true, sendSignal);
        toast(`${msg.peer.name} joined`);
        break;
      case 'offer':
      case 'answer':
      case 'ice':
        state.peer?.handleSignal(msg);
        break;
      case 'profile':
        if (state.partner) {
          const langChanged = msg.profile.lang && msg.profile.lang !== state.partner.lang;
          setPartner({ ...state.partner, ...msg.profile });
          if (langChanged) toast(`${state.partner.name} now hears you in ${languageName(state.partner.lang)}`);
        }
        break;
      case 'peer-left':
        toast(`${state.partner?.name || 'Your partner'} left the call`);
        state.peer?.close();
        state.peer = null;
        audio.flushIncoming();
        setRelaySending(false);
        el.remoteVideo.srcObject = null;
        setPartner(null);
        break;
      case 'room-full':
        toast('That room already has two people. Try another code.');
        leaveCall();
        break;
      case 'error':
        toast(msg.message);
        break;
    }
  };

  ws.onclose = () => {
    if (!state.inCall) return;
    toast('Lost connection to the server. Reconnecting…');
    state.peer?.close();
    state.peer = null;
    setPartner(null);
    setTimeout(() => state.inCall && connectSignal(), 1500);
  };
}

function createPeer(initiator, sendSignal) {
  state.peer?.close();
  el.connDot.dataset.state = 'connecting';
  const peer = new PeerLink({
    iceServers: state.config.iceServers,
    sendSignal,
    videoTrack: state.stream?.getVideoTracks()[0],
    audioTrack: null, // translated voice travels via the server (works on every network)
    initiator,
  });
  state.peer = peer;

  peer.addEventListener('stream', (e) => {
    const stream = e.detail;
    if (el.remoteVideo.srcObject !== stream) el.remoteVideo.srcObject = stream;
    el.remoteVideo.play().catch(() => {});
  });
  peer.addEventListener('state', (e) => sendSignal({ type: 'rtc-state', state: e.detail }));
  sendSignal({ type: 'cam', on: state.camOn });
}

function setPartner(p) {
  state.partner = p;
  el.waiting.hidden = Boolean(p);
  el.partnerChip.hidden = !p;
  el.call.classList.toggle('waiting-mode', !p);
  if (!p) {
    state.partnerSince = 0;
    state.partnerCamOn = true;
    stopTranslator();
    el.remotePlaceholder.hidden = false;
    el.remoteAvatar.textContent = '?';
    el.connDot.dataset.state = '';
    setXlStatus('idle');
    return;
  }
  if (!state.partnerSince) state.partnerSince = performance.now();
  el.partnerName.textContent = p.name;
  el.partnerLang.textContent = languageName(p.lang);
  el.remoteAvatar.textContent = (p.name || '?').trim().charAt(0).toUpperCase();
  startTranslator(p.lang);
}

// ---------------------------------------------------------------------------
// Translation (my mic → partner's language → WebRTC)
// ---------------------------------------------------------------------------
function startTranslator(target) {
  if (!state.translator) {
    // The translated voice is sent by the server straight to the partner (lowest latency);
    // this client only receives transcripts, used for the partner's captions.
    const t = new LiveTranslator({ target, cid: state.cid });
    t.addEventListener('status', (e) => {
      setXlStatus(e.detail.state, e.detail.message);
      if (e.detail.state === 'error' && e.detail.kind && e.detail.kind !== 'other') showKeyHelp(e.detail.kind, e.detail.message);
    });
    t.addEventListener('input', (e) => onOwnSpeech('original', e.detail.text, e.detail.lang));
    t.addEventListener('output', (e) => onOwnSpeech('translated', e.detail.text, e.detail.lang));
    t.addEventListener('turn', () => scheduleFinalize(900));
    state.translator = t;
  } else if (state.translator.target !== target) {
    finalizeSegment();
  }
  state.translator.setTarget(target);
  state.translator.start();
}

function stopTranslator() {
  state.translator?.stop();
  state.translator = null;
  finalizeSegment();
}

function setXlStatus(s, message) {
  el.xlStatus.dataset.state = s;
  const target = state.partner ? languageName(state.partner.lang) : '';
  const text = {
    idle: state.inCall && !state.partner ? 'Translation starts when your partner joins' : 'Translator idle',
    connecting: 'Connecting to Gemini Live Translate…',
    live: `Your voice → ${target}`,
    reconnecting: 'Reconnecting translator…',
    error: message || 'Translator error',
  }[s];
  el.xlStatusText.textContent = text;
  if (s === 'error') toast(message || 'Translator error', 6000);
}

// Outgoing segment: what I said + how it was translated. Sent to the partner via the server.
let seg = null;
let segTimer = null;

function onOwnSpeech(field, text, lang) {
  if (!text) return;
  if (!seg) {
    seg = { id: uid(), original: '', translated: '', srcLang: '', tgtLang: state.partner?.lang || '', final: false };
  }
  seg[field] += text;
  if (field === 'original' && lang) seg.srcLang = lang;
  if (field === 'translated' && lang) seg.tgtLang = lang;
  scheduleFinalize(2600);
  publishSegment();
}

function scheduleFinalize(ms) {
  clearTimeout(segTimer);
  segTimer = setTimeout(finalizeSegment, ms);
}

function finalizeSegment() {
  clearTimeout(segTimer);
  if (!seg) return;
  seg.final = true;
  publishSegment();
  seg = null;
}

function publishSegment() {
  if (!seg) return;
  const snapshot = { ...seg };
  state.sendSignal?.({ type: 'seg', seg: snapshot, from: state.me.name });
  // No captions on my own bubble — my words only appear as captions on my partner's screen
  // (and in the transcript panel).
  upsertTranscript(snapshot, 'me');
}

// ---------------------------------------------------------------------------
// Incoming captions (partner's speech, translated into my language)
// ---------------------------------------------------------------------------
// Binary frames from the server on the signaling socket: [1][PCM 24 kHz] = partner's translated voice.
function handleBinary(buf) {
  const kind = new Uint8Array(buf, 0, 1)[0];
  if (kind === 1 && (buf.byteLength - 1) % 2 === 0) audio.playIncoming(new Int16Array(buf.slice(1)));
}

// Fallback video relay: its own socket, so video frames can never delay the translated voice.
let relayFrameAt = 0;
const relayCtx = el.relayCanvas.getContext('2d');
function connectRelay() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/relay?room=${encodeURIComponent(state.room)}`);
  ws.binaryType = 'arraybuffer';
  state.relay = ws;
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') return;
    createImageBitmap(new Blob([ev.data], { type: 'image/jpeg' }))
      .then((bmp) => {
        relayCtx.drawImage(bmp, 0, 0, el.relayCanvas.width, el.relayCanvas.height);
        bmp.close();
        relayFrameAt = performance.now();
      })
      .catch(() => {});
  };
  ws.onclose = () => {
    if (state.relay === ws) state.relay = null;
    if (state.inCall) setTimeout(() => state.inCall && !state.relay && connectRelay(), 1500);
  };
}

// ---------------------------------------------------------------------------
// Video: direct WebRTC when possible, automatic server relay when not
// ---------------------------------------------------------------------------
const RELAY_SIZE = 320;
const relaySrc = Object.assign(document.createElement('canvas'), { width: RELAY_SIZE, height: RELAY_SIZE });
const relaySrcCtx = relaySrc.getContext('2d');
let relayTimer = null;
let relayBusy = false;

function setRelaySending(on) {
  if (on && !relayTimer) relayTimer = setInterval(sendRelayFrame, 110); // ~9 fps
  if (!on && relayTimer) {
    clearInterval(relayTimer);
    relayTimer = null;
  }
}

function sendRelayFrame() {
  const v = el.localVideo;
  const ws = state.relay;
  if (relayBusy || !state.camOn || !v.videoWidth || !ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 64 * 1024) return;
  const side = Math.min(v.videoWidth, v.videoHeight); // centre square — it's shown in a circle anyway
  relaySrcCtx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, RELAY_SIZE, RELAY_SIZE);
  relayBusy = true;
  relaySrc.toBlob(
    async (blob) => {
      relayBusy = false;
      if (blob && state.relay?.readyState === WebSocket.OPEN) state.relay.send(await blob.arrayBuffer());
    },
    'image/jpeg',
    0.6,
  );
}

// Watches whether direct video is actually flowing; if not, asks the partner to relay frames via the server.
let lastVideoTime = -1;
let lastVideoAdvance = 0;
let needRelaySent = null;
setInterval(() => {
  if (!state.inCall || !state.partner) {
    el.relayCanvas.hidden = true;
    needRelaySent = null;
    return;
  }
  const now = performance.now();
  const v = el.remoteVideo;
  if (v.srcObject && v.videoWidth > 0 && v.currentTime !== lastVideoTime) {
    lastVideoTime = v.currentTime;
    lastVideoAdvance = now;
  }
  const direct = now - lastVideoAdvance < 2500;
  const need = !direct && now - state.partnerSince > 4000;
  if (need !== needRelaySent) {
    needRelaySent = need;
    state.sendSignal?.({ type: 'need-relay', on: need });
  }
  const relayed = !direct && now - relayFrameAt < 2500;
  el.relayCanvas.hidden = !relayed;
  el.remotePlaceholder.hidden = state.partnerCamOn && (direct || relayed);
  el.connDot.dataset.state = direct ? 'connected' : relayed ? 'relay' : 'connecting';
  el.connDot.title = direct ? 'Direct video connection' : relayed ? 'Video relayed through the server' : 'Connecting video…';
}, 500);

const capTimers = new Map();
function renderCaption(s) {
  const sameLang = baseLang(s.srcLang) && baseLang(s.srcLang) === baseLang(state.me.lang);
  const main = (s.translated || (sameLang || s.final ? s.original : '')).trim();
  const sub = s.translated && !sameLang ? s.original.trim() : '';

  let node = el.captions.querySelector(`[data-id="${s.id}"]`);
  if (!node) {
    node = document.createElement('div');
    node.className = 'cap';
    node.dataset.id = s.id;
    node.innerHTML = `<div class="cap-meta"><span class="who"></span><span class="lang"></span></div><p class="cap-text"></p><p class="cap-orig"></p>`;
    el.captions.append(node);
    const caps = [...el.captions.children];
    caps.slice(0, -2).forEach((c) => c.remove());
    caps.slice(-2, -1).forEach((c) => c.classList.add('old'));
  }
  node.classList.remove('fade');
  node.querySelector('.who').textContent = state.partner?.name || 'Partner';
  node.querySelector('.lang').textContent = s.srcLang ? `${languageName(s.srcLang)}${sameLang ? '' : ` → ${languageName(state.me.lang)}`}` : '';
  const textEl = node.querySelector('.cap-text');
  textEl.textContent = main;
  textEl.dir = isRtl(state.me.lang) ? 'rtl' : 'auto';
  const origEl = node.querySelector('.cap-orig');
  origEl.textContent = sub;
  origEl.hidden = !sub;
  origEl.dir = isRtl(s.srcLang) ? 'rtl' : 'auto';

  clearTimeout(capTimers.get(s.id));
  capTimers.set(
    s.id,
    setTimeout(() => {
      node.classList.add('fade');
      setTimeout(() => node.remove(), 650);
      capTimers.delete(s.id);
    }, s.final ? 6000 : 12000),
  );
}

function upsertTranscript(s, who) {
  const key = `${who}-${s.id}`;
  let li = el.transcriptList.querySelector(`[data-key="${key}"]`);
  const atBottom = el.transcriptList.scrollHeight - el.transcriptList.scrollTop - el.transcriptList.clientHeight < 40;
  if (!li) {
    if (!(s.original || s.translated).trim()) return;
    li = document.createElement('li');
    li.className = `t-item ${who}`;
    li.dataset.key = key;
    li.innerHTML = `<span class="t-who"></span><p class="t-main"></p><p class="t-sub"></p>`;
    el.transcriptList.append(li);
    el.transcriptEmpty.hidden = true;
  }
  const name = who === 'me' ? 'You' : state.partner?.name || 'Partner';
  const lang = s.srcLang ? languageName(s.srcLang) : '';
  li.querySelector('.t-who').innerHTML = `${escapeHtml(name)}${lang ? `<span class="lang">${escapeHtml(lang)}</span>` : ''}`;
  // For me: show what I said, with the translation underneath. For partner: translation first.
  const main = who === 'me' ? s.original : s.translated || s.original;
  const sub = who === 'me' ? s.translated : s.translated ? s.original : '';
  li.querySelector('.t-main').textContent = main.trim();
  li.querySelector('.t-sub').textContent = sub.trim();
  li.querySelector('.t-sub').hidden = !sub.trim() || sub.trim() === main.trim();
  if (atBottom) el.transcriptList.scrollTop = el.transcriptList.scrollHeight;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
el.micBtn.addEventListener('click', () => {
  state.micOn = !state.micOn;
  const t = state.stream?.getAudioTracks()[0];
  if (t) t.enabled = state.micOn;
  audio.micEnabled = state.micOn;
  el.micBtn.setAttribute('aria-pressed', String(state.micOn));
  el.micBtn.title = state.micOn ? 'Mute microphone' : 'Unmute microphone';
});

el.camBtn.addEventListener('click', () => {
  state.camOn = !state.camOn;
  const t = state.stream?.getVideoTracks()[0];
  if (t) t.enabled = state.camOn;
  el.camBtn.setAttribute('aria-pressed', String(state.camOn));
  el.camBtn.title = state.camOn ? 'Turn camera off' : 'Turn camera on';
  el.selfTile.classList.toggle('cam-off', !state.camOn);
  state.sendSignal?.({ type: 'cam', on: state.camOn });
});

el.headphonesBtn.addEventListener('click', () => {
  state.headphones = !state.headphones;
  localStorage.setItem('portal.headphones', state.headphones ? '1' : '0');
  el.headphonesBtn.setAttribute('aria-pressed', String(state.headphones));
  toast(state.headphones ? 'Headphones mode: you can talk while your partner is being translated' : 'Speaker mode: your mic pauses while your partner’s translation plays');
});

el.ccBtn.addEventListener('click', () => {
  const on = el.ccBtn.getAttribute('aria-pressed') !== 'true';
  el.ccBtn.setAttribute('aria-pressed', String(on));
  el.captions.classList.toggle('off', !on);
});

function setTranscriptOpen(open) {
  el.transcript.hidden = !open;
  el.transcriptBtn.setAttribute('aria-pressed', String(open));
  el.call.classList.toggle('transcript-open', open);
  if (open) el.transcriptList.scrollTop = el.transcriptList.scrollHeight;
}
el.transcriptBtn.addEventListener('click', () => setTranscriptOpen(el.transcript.hidden));
el.closeTranscriptBtn.addEventListener('click', () => setTranscriptOpen(false));

el.callLangSelect.addEventListener('change', () => {
  state.me.lang = el.callLangSelect.value;
  el.langSelect.value = state.me.lang;
  localStorage.setItem('portal.lang', state.me.lang);
  if (state.signal?.readyState === WebSocket.OPEN) {
    state.signal.send(JSON.stringify({ type: 'profile', profile: { lang: state.me.lang } }));
  }
  toast(`You'll now hear your partner in ${languageName(state.me.lang)}`);
});

el.copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el.shareInput.value);
  } catch {
    el.shareInput.select();
    document.execCommand('copy');
  }
  el.copyBtn.querySelector('span').textContent = 'Copied';
  setTimeout(() => (el.copyBtn.querySelector('span').textContent = 'Copy'), 1600);
});

// ---------------------------------------------------------------------------
// Level meters (single rAF loop)
// ---------------------------------------------------------------------------
const lobbyBars = [...el.lobbyMeter.querySelectorAll('i')];
const selfBars = [...el.selfBars.children];
const partnerBars = [...el.partnerBars.children];
const previewOrb = $('previewOrb');
const remoteOrb = $('remoteOrb');
const selfOrb = $('selfOrb');
const SHAPE = [0.55, 1, 0.8, 0.45];
let smoothMic = 0;
let smoothRemote = 0;

function tick() {
  smoothMic = Math.max(state.micLevel, smoothMic * 0.85);
  const mic = Math.min(1, smoothMic * 7);

  if (!el.lobby.hidden) {
    const on = Math.round(mic * lobbyBars.length);
    lobbyBars.forEach((b, i) => b.classList.toggle('on', i < on));
    previewOrb.style.setProperty('--lvl', mic.toFixed(3));
  } else {
    drawBars(selfBars, mic);
    selfOrb.style.setProperty('--lvl', mic.toFixed(3));
    smoothRemote = Math.max(AudioEngine.level(audio.inAnalyser), smoothRemote * 0.88);
    const remote = Math.min(1, smoothRemote * 7);
    drawBars(partnerBars, remote);
    if (state.partner) remoteOrb.style.setProperty('--lvl', remote.toFixed(3));
    else remoteOrb.style.removeProperty('--lvl');
  }
  requestAnimationFrame(tick);
}

function drawBars(bars, v) {
  bars.forEach((b, i) => (b.style.height = `${4 + v * 10 * SHAPE[i]}px`));
}

// ---------------------------------------------------------------------------
// Gemini API key: verify up front, and if anything is wrong explain exactly how to fix it
// ---------------------------------------------------------------------------
const AI_STUDIO_SECRET_STEPS = [
  'Open your app in <b>Google AI Studio</b> (aistudio.google.com → <b>Build</b> → your app).',
  'Click the <b>Settings</b> gear (top right) → <b>Secrets</b>.',
];
const RESTART_STEPS = [
  '<b>Restart the app server</b>: reload the whole AI Studio browser tab (refreshing only the preview keeps the old server running, and a server only receives secrets when it starts).',
  'If you share the <b>published</b> link, click <b>Publish</b> again so the live version gets the new secret too.',
  'Come back here and click <b>Check again</b>.',
];
const KEY_FIXES = {
  missing: {
    short: 'Translation is off: the server has no Gemini API key.',
    why: 'The server started without a Gemini API key. Keys are deliberately <i>not</i> stored in GitHub, so every new copy of the app (a fresh AI Studio import, a new deploy) needs the key added once as a secret.',
    steps: [
      ...AI_STUDIO_SECRET_STEPS,
      'Add a secret named exactly <code>GEMINI_API_KEY</code> (all caps, underscores).',
      'For the value, paste your key from <b>aistudio.google.com/apikey</b>. It starts with <code>AIza</code> or <code>AQ.</code>. Paste only the key, with no quotes and no spaces.',
      ...RESTART_STEPS,
      'Running on your own computer instead? Put <code>GEMINI_API_KEY=your-key</code> in <code>live-translate-portal/.env</code> and restart the server.',
    ],
  },
  invalid: {
    short: 'Translation is off: Google rejected the Gemini API key.',
    why: 'The server has a key, but Google says it isn’t valid. Usually it was mistyped, copied with extra characters, deleted, or rotated.',
    steps: [
      'Go to <b>aistudio.google.com/apikey</b> and copy your key again, or click <b>Create API key</b> to make a new one.',
      ...AI_STUDIO_SECRET_STEPS,
      'Edit <code>GEMINI_API_KEY</code> and replace the value with the key you just copied. Paste only the key: no quotes, no spaces, no <code>GEMINI_API_KEY=</code> in front.',
      ...RESTART_STEPS,
    ],
  },
  permission: {
    short: 'Translation is off: this API key isn’t allowed to use the Gemini API.',
    why: 'The key is real, but its Google Cloud project has the Gemini API turned off, or the key is restricted to other APIs.',
    steps: [
      'Open <b>aistudio.google.com/apikey</b> and note which <b>project</b> your key belongs to.',
      'Open <b>console.cloud.google.com/apis/library/generativelanguage.googleapis.com</b>, select that project and click <b>Enable</b>.',
      'In <b>console.cloud.google.com/apis/credentials</b>, open the key. Under <b>API restrictions</b>, choose “Don’t restrict key” or allow <b>Generative Language API</b>.',
      'Easiest alternative: create a brand-new key at <b>aistudio.google.com/apikey</b> and put that in the <code>GEMINI_API_KEY</code> secret.',
      ...RESTART_STEPS,
    ],
  },
  model: {
    short: 'Translation is off: this API key can’t use Gemini 3.5 Live Translate.',
    why: 'The key works, but the <code>gemini-3.5-live-translate-preview</code> model isn’t available to it. Preview models can be limited by account, region or billing tier.',
    steps: [
      'In Google AI Studio, open <b>Stream / Live</b> and check that <b>Gemini 3.5 Live Translate</b> is listed for your account.',
      'Make sure the key comes from that same Google account (<b>aistudio.google.com/apikey</b>).',
      'If you’re on the free tier, click <b>Set up billing</b> next to the key. Some preview models need a paid tier.',
      'Update the <code>GEMINI_API_KEY</code> secret if you switched keys.',
      ...RESTART_STEPS,
    ],
  },
  billing: {
    short: 'Translation is off: billing is required for this key’s project.',
    why: 'Google requires billing on the key’s project before this model can be used.',
    steps: [
      'Open <b>aistudio.google.com/apikey</b> and click <b>Set up billing</b> next to your key (or enable billing for its project in the Google Cloud console).',
      'Wait a minute for it to take effect.',
      ...RESTART_STEPS,
    ],
  },
  quota: {
    short: 'Translation paused: the Gemini API key hit its usage limit.',
    why: 'The key has used up its requests or minutes for now. Free-tier limits are low for live audio.',
    steps: [
      'Wait about a minute and try again. Per-minute limits reset quickly.',
      'Check usage at <b>aistudio.google.com/usage</b>.',
      'For more headroom, click <b>Set up billing</b> at <b>aistudio.google.com/apikey</b> to move to a paid tier.',
      'Click <b>Check again</b> when ready.',
    ],
  },
  network: {
    short: 'Translation is off: the server couldn’t reach Google.',
    why: 'The server could not connect to generativelanguage.googleapis.com. This is usually temporary.',
    steps: ['Wait a few seconds and click <b>Check again</b>.', 'If you’re running locally, check this computer’s internet connection.', 'If it persists in AI Studio, reload the AI Studio tab to restart the server.'],
  },
  other: {
    short: 'Translation is having trouble connecting to Gemini.',
    why: 'Gemini returned an unexpected error (see technical details).',
    steps: ['Click <b>Check again</b>.', 'If it keeps happening, reload the AI Studio tab to restart the server.', 'Still failing? Send the technical details below to whoever maintains the app.'],
  },
};

let keyIssue = null;
let keyHelpShownFor = '';

async function checkKey({ fresh = false } = {}) {
  let r;
  try {
    r = await (await fetch(`/api/key-check${fresh ? '?fresh=1' : ''}`)).json();
  } catch {
    return; // server unreachable: the signaling layer reports that
  }
  if (r.ok) {
    keyIssue = null;
    el.keyWarning.hidden = true;
    if (el.keyHelp.open) {
      el.keyHelp.close();
      toast('Gemini API key works. Translation is ready.');
    }
    return true;
  }
  showKeyHelp(r.kind, r.detail, r.diag);
  return false;
}

function showKeyHelp(kind, detail, diag) {
  const fix = KEY_FIXES[kind] || KEY_FIXES.other;
  keyIssue = { kind, detail, diag };
  el.keyWarning.hidden = false;
  el.keyWarningText.textContent = fix.short;
  el.keyHelpWhy.innerHTML = fix.why;
  el.keyHelpSteps.innerHTML = fix.steps.map((s) => `<li>${s}</li>`).join('');
  el.keyHelpDiag.textContent = [
    `Problem: ${kind}`,
    detail ? `Google said: ${detail}` : '',
    diag ? `Server sees: ${diag.vars.join('; ')}` : '',
    diag ? `Env files: ${diag.envFiles.join(', ') || 'none'}` : '',
    diag ? `Server started ${diag.serverStartedSecondsAgo}s ago${diag.serverStartedSecondsAgo > 120 ? ' (it has NOT been restarted since before that, so reload the AI Studio tab)' : ''}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  // Open the step-by-step automatically the first time each kind of problem appears.
  if (keyHelpShownFor !== kind && !el.keyHelp.open) {
    keyHelpShownFor = kind;
    try { el.keyHelp.showModal(); } catch {}
  }
}

el.keyHelpBtn.addEventListener('click', () => {
  if (keyIssue) showKeyHelp(keyIssue.kind, keyIssue.detail, keyIssue.diag);
  if (!el.keyHelp.open) el.keyHelp.showModal();
});
el.keyCloseBtn.addEventListener('click', () => el.keyHelp.close());
el.keyRecheckBtn.addEventListener('click', async () => {
  el.keyRecheckBtn.disabled = true;
  const ok = await checkKey({ fresh: true });
  el.keyRecheckBtn.disabled = false;
  if (ok && state.translator && !state.translator.live && state.partner) {
    stopTranslator();
    startTranslator(state.partner.lang);
  } else if (!ok) toast('Still not working. Follow the steps above, then try again.');
});

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg, ms = 3200) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  el.toast.style.animation = 'none';
  void el.toast.offsetWidth;
  el.toast.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), ms);
}

function randomRoom() {
  const a = ['amber', 'cedar', 'coral', 'dune', 'ember', 'fjord', 'harbor', 'indigo', 'juniper', 'lumen', 'maple', 'nova', 'olive', 'quartz', 'river', 'sable', 'tide', 'willow'];
  const b = ['bridge', 'lantern', 'meadow', 'harbor', 'summit', 'garden', 'canyon', 'island', 'orbit', 'grove', 'delta', 'atlas'];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(a)}-${pick(b)}-${Math.floor(10 + Math.random() * 90)}`;
}

function slug(s) {
  return s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function baseLang(code) {
  return String(code || '').split('-')[0].toLowerCase();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

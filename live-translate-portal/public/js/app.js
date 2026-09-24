import { LANGUAGES, languageName, guessBrowserLanguage, isRtl } from './languages.js';
import { AudioEngine } from './audio.js';
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

  remoteVideo: $('remoteVideo'),
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
  outgoing: $('outgoing'),
  outgoingLabel: $('outgoingLabel'),
  outgoingText: $('outgoingText'),
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
  remoteAnalyser: null,
  inCall: false,
  micOn: true,
  camOn: true,
};

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
    el.keyWarning.hidden = state.config.hasApiKey;
  } catch {}

  audio.onMicLevel = (lvl) => (state.micLevel = lvl);
  audio.onPcm = (buf) => state.translator?.sendPcm(buf);

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
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
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
  el.shareInput.value = `${location.origin}/?room=${encodeURIComponent(state.room)}`;
  el.callLangSelect.value = state.me.lang;
  el.localVideo.srcObject = state.stream;
  el.transcriptList.innerHTML = '';
  el.transcriptEmpty.hidden = false;
  el.captions.innerHTML = '';
  setPartner(null);
  setXlStatus('idle');
  connectSignal();
}

function leaveCall({ toLobby = true } = {}) {
  state.inCall = false;
  stopTranslator();
  state.peer?.close();
  state.peer = null;
  state.remoteAnalyser = null;
  if (state.signal) {
    state.signal.onclose = null;
    state.signal.close();
  }
  state.signal = null;
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
  const sendSignal = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

  ws.onopen = () => sendSignal({ type: 'join', room: state.room, name: state.me.name, lang: state.me.lang });

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
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
        state.remoteAnalyser = null;
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
    audioTrack: audio.translatedTrack,
    initiator,
  });
  state.peer = peer;

  peer.addEventListener('stream', (e) => {
    const stream = e.detail;
    if (el.remoteVideo.srcObject !== stream) el.remoteVideo.srcObject = stream;
    el.remoteVideo.play().catch(() => {});
    if (!state.remoteAnalyser && stream.getAudioTracks().length) state.remoteAnalyser = audio.analyserFor(stream);
    const vt = stream.getVideoTracks()[0];
    if (vt) {
      const sync = () => (el.remotePlaceholder.hidden = !vt.muted && vt.readyState === 'live');
      vt.onmute = vt.onunmute = sync;
      sync();
    }
  });
  peer.addEventListener('state', (e) => {
    el.connDot.dataset.state = e.detail;
    if (e.detail === 'failed') toast('Video connection failed — retrying…');
  });
  peer.addEventListener('data', (e) => handlePeerData(e.detail));
  peer.addEventListener('channel-open', () => peer.send({ type: 'cam', on: state.camOn }));
}

function setPartner(p) {
  state.partner = p;
  el.waiting.hidden = Boolean(p);
  el.partnerChip.hidden = !p;
  el.call.classList.toggle('waiting-mode', !p);
  if (!p) {
    stopTranslator();
    el.remotePlaceholder.hidden = false;
    el.remoteAvatar.textContent = '?';
    el.connDot.dataset.state = '';
    setXlStatus('idle');
    return;
  }
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
    const t = new LiveTranslator({ target });
    t.addEventListener('status', (e) => setXlStatus(e.detail.state, e.detail.message));
    t.addEventListener('audio', (e) => audio.playTranslated(e.detail.pcm));
    t.addEventListener('input', (e) => onOwnSpeech('original', e.detail.text, e.detail.lang));
    t.addEventListener('output', (e) => onOwnSpeech('translated', e.detail.text, e.detail.lang));
    t.addEventListener('turn', () => scheduleFinalize(900));
    state.translator = t;
  } else if (state.translator.target !== target) {
    audio.flushTranslated();
    finalizeSegment();
  }
  state.translator.setTarget(target);
  state.translator.start();
}

function stopTranslator() {
  state.translator?.stop();
  state.translator = null;
  audio.flushTranslated();
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

// Outgoing segment: what I said + how it was translated. Shared with the partner via data channel.
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
  state.peer?.send({ type: 'seg', seg: snapshot, from: state.me.name });
  renderOutgoing(snapshot);
  upsertTranscript(snapshot, 'me');
}

let outgoingFade = null;
function renderOutgoing(s) {
  const text = (s.translated || s.original).trim();
  if (!text) return;
  el.outgoing.hidden = false;
  el.outgoing.classList.remove('fade');
  el.outgoingLabel.textContent = s.translated
    ? `You${s.srcLang ? ` (${languageName(s.srcLang)})` : ''} → ${languageName(s.tgtLang)}`
    : `You${s.srcLang ? ` · ${languageName(s.srcLang)}` : ''}`;
  el.outgoingText.textContent = text;
  el.outgoingText.dir = isRtl(s.translated ? s.tgtLang : s.srcLang) ? 'rtl' : 'auto';
  clearTimeout(outgoingFade);
  outgoingFade = setTimeout(() => {
    el.outgoing.classList.add('fade');
    setTimeout(() => el.outgoing.classList.contains('fade') && (el.outgoing.hidden = true), 600);
  }, 5000);
}

// ---------------------------------------------------------------------------
// Incoming captions (partner's speech, translated into my language)
// ---------------------------------------------------------------------------
function handlePeerData(msg) {
  if (msg.type === 'seg') {
    renderCaption(msg.seg);
    upsertTranscript(msg.seg, 'partner');
  } else if (msg.type === 'cam') {
    el.remotePlaceholder.hidden = msg.on;
  }
}

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
  state.peer?.send({ type: 'cam', on: state.camOn });
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
    smoothRemote = Math.max(AudioEngine.level(state.remoteAnalyser), smoothRemote * 0.88);
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

/**
 * LiveTranslator — a client for Gemini 3.5 Live Translate (via the server's /translate proxy).
 *
 * Streams 16 kHz PCM mic audio in, emits translated 24 kHz PCM audio (voice-preserving)
 * plus incremental input/output transcripts. Handles GoAway + reconnects transparently.
 *
 * Events:
 *   status  { state: 'idle'|'connecting'|'live'|'reconnecting'|'error', message? }
 *   audio   { pcm: Int16Array }            // 24 kHz mono
 *   input   { text, lang }                 // transcript of what the speaker said
 *   output  { text, lang }                 // transcript of the translation
 *   turn    {}                             // model signalled end of a turn
 */
export class LiveTranslator extends EventTarget {
  #target;
  #ws = null;
  #ready = false;
  #stopped = true;
  #retry = 0;
  #retryTimer = null;

  constructor({ target }) {
    super();
    this.#target = target;
  }

  get target() {
    return this.#target;
  }

  get live() {
    return this.#ready;
  }

  start() {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#connect(false);
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#retryTimer);
    this.#ready = false;
    if (this.#ws) {
      try { this.#ws.close(1000); } catch {}
    }
    this.#ws = null;
    this.#emit('status', { state: 'idle' });
  }

  /** Change the language the speaker is translated into (reconnects the session). */
  setTarget(code) {
    if (code === this.#target) return;
    this.#target = code;
    if (!this.#stopped) {
      this.stop();
      this.start();
    }
  }

  /** @param {ArrayBuffer} buffer 16-bit PCM @ 16 kHz */
  sendPcm(buffer) {
    if (!this.#ready || this.#ws?.readyState !== WebSocket.OPEN) return;
    this.#ws.send(
      JSON.stringify({
        realtimeInput: { audio: { data: toBase64(buffer), mimeType: 'audio/pcm;rate=16000' } },
      }),
    );
  }

  // -------------------------------------------------------------------------

  #connect(isHandover) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/translate?target=${encodeURIComponent(this.#target)}`);
    ws.binaryType = 'arraybuffer';
    let fatal = false;

    if (!isHandover) {
      this.#emit('status', { state: this.#retry ? 'reconnecting' : 'connecting' });
    }

    ws.onmessage = async (ev) => {
      let msg;
      try {
        const raw = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.error) {
        if (ws.__closedByHandover) return;
        fatal = /API key|API_KEY|permission|not found|invalid/i.test(msg.error.message || '');
        this.#emit('status', { state: 'error', message: msg.error.message });
        return;
      }

      if (msg.setupComplete) {
        const old = this.#ws;
        this.#ws = ws;
        this.#ready = true;
        this.#retry = 0;
        if (old && old !== ws) {
          old.__closedByHandover = true;
          try { old.close(1000); } catch {}
        }
        this.#emit('status', { state: 'live' });
        return;
      }

      if (msg.goAway) {
        // Server will close this session soon — open a replacement and hand over seamlessly.
        if (!this.#stopped && ws === this.#ws) this.#connect(true);
        return;
      }

      const content = msg.serverContent;
      if (!content) return;

      if (content.inputTranscription?.text) {
        this.#emit('input', { text: content.inputTranscription.text, lang: content.inputTranscription.languageCode });
      }
      if (content.outputTranscription?.text) {
        this.#emit('output', { text: content.outputTranscription.text, lang: content.outputTranscription.languageCode });
      }
      for (const part of content.modelTurn?.parts || []) {
        if (part.inlineData?.data) this.#emit('audio', { pcm: fromBase64Int16(part.inlineData.data) });
      }
      if (content.turnComplete || content.generationComplete) this.#emit('turn', {});
    };

    ws.onclose = (ev) => {
      if (ws.__closedByHandover) return;
      if (ws !== this.#ws && this.#ws) return; // a stale handover socket
      this.#ready = false;
      this.#ws = null;
      if (this.#stopped) return;
      if (fatal || ev.code === 4001) {
        this.#stopped = true;
        return;
      }
      const delay = Math.min(8000, 400 * 2 ** this.#retry++);
      this.#emit('status', { state: 'reconnecting', message: ev.reason || undefined });
      this.#retryTimer = setTimeout(() => !this.#stopped && this.#connect(false), delay);
    };

    if (!isHandover) this.#ws = ws;
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64Int16(b64) {
  const bin = atob(b64);
  const len = bin.length & ~1;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

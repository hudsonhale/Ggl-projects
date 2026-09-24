/**
 * AudioEngine — all Web Audio plumbing.
 *
 *  OUTGOING:  mic ──► pcm-capture worklet ──► onPcm(16 kHz Int16) ──► Gemini Live Translate
 *  INCOMING:  partner's translated voice (24 kHz PCM, relayed by the server)
 *             ──► gap-free scheduled buffers ──► loopback RTCPeerConnection ──► <audio> ──► speakers
 *
 * Why the loopback? Chrome's echo canceller only "hears" audio that is played out as a WebRTC
 * remote track. Routing the partner's translated voice through a local peer connection means the
 * browser removes it from our microphone, so it isn't picked up and re-translated back to them.
 */
export class AudioEngine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.onPcm = null;
    this.onMicLevel = null;
    this.micEnabled = true;

    // Incoming (partner's translated voice) chain.
    this.inGain = this.ctx.createGain();
    this.inAnalyser = this.ctx.createAnalyser();
    this.inAnalyser.fftSize = 512;
    this.inDest = this.ctx.createMediaStreamDestination();
    this.inGain.connect(this.inAnalyser);
    this.inGain.connect(this.inDest);
    this.playbackEl = new Audio();
    this.playbackEl.autoplay = true;
    this.loopbackReady = false;

    this.nextTime = 0;
    this.sources = new Set();
    this.workletReady = this.ctx.audioWorklet.addModule('/worklets/pcm-capture.js');
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.playbackEl.play().catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Microphone → 16 kHz PCM
  // ---------------------------------------------------------------------------
  async attachMic(track) {
    await this.workletReady;
    this.detachMic();
    this.micSource = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.capture = new AudioWorkletNode(this.ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.capture.port.onmessage = ({ data }) => {
      if (data.level !== undefined) this.onMicLevel?.(this.micEnabled ? data.level : 0);
      if (data.pcm && this.micEnabled) this.onPcm?.(data.pcm);
    };
    // A muted sink keeps the worklet pulled by the render graph.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.micSource.connect(this.capture).connect(sink).connect(this.ctx.destination);
    this.micSink = sink;
  }

  detachMic() {
    try { this.micSource?.disconnect(); } catch {}
    try { this.capture?.disconnect(); } catch {}
    try { this.micSink?.disconnect(); } catch {}
    this.micSource = this.capture = this.micSink = null;
  }

  // ---------------------------------------------------------------------------
  // Partner's translated voice → speakers
  // ---------------------------------------------------------------------------

  /** Route incoming voice through a local WebRTC loopback so echo cancellation applies to it. */
  async setupPlayback() {
    if (this.playbackSetup) return this.playbackSetup;
    this.playbackSetup = (async () => {
      try {
        const a = new RTCPeerConnection();
        const b = new RTCPeerConnection();
        a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
        b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
        const gotTrack = new Promise((resolve) => (b.ontrack = (e) => resolve(e.track)));
        a.addTrack(this.inDest.stream.getAudioTracks()[0], this.inDest.stream);
        await a.setLocalDescription(await a.createOffer());
        await b.setRemoteDescription(a.localDescription);
        await b.setLocalDescription(await b.createAnswer());
        await a.setRemoteDescription(b.localDescription);
        const track = await Promise.race([gotTrack, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
        this.playbackEl.srcObject = new MediaStream([track]);
        await this.playbackEl.play().catch(() => {});
        this.loopback = [a, b];
        this.loopbackReady = true;
      } catch (err) {
        // Fallback: play straight to the speakers (echo cancellation may not cover it — the echo guard still does).
        console.warn('[audio] loopback unavailable, using direct playback', err);
        this.inGain.connect(this.ctx.destination);
      }
    })();
    return this.playbackSetup;
  }

  /**
   * Queue a chunk of the partner's translated 24 kHz PCM.
   *
   * Latency control — Gemini streams audio continuously (including near-silent filler), so a
   * naive "append forever" queue turns every network hiccup into permanent, growing delay.
   * Here we always steer back toward live:
   *   • behind by > 0.25 s  → quiet/filler chunks are skipped entirely
   *   • behind by > 0.6 s   → speech plays slightly faster (1.1–1.2×) until caught up
   *   • behind by > 2.0 s   → the backlog is dropped and playback jumps to live
   */
  playIncoming(int16) {
    if (!int16.length) return;
    const f32 = new Float32Array(int16.length);
    let sumSq = 0;
    for (let i = 0; i < int16.length; i++) {
      const v = int16[i] / 0x8000;
      f32[i] = v;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / int16.length);
    const speech = rms > 0.01;
    const now = this.ctx.currentTime;
    let ahead = this.nextTime - now;

    if (ahead > 2.0) {
      this.flushIncoming();
      ahead = 0;
    }
    if (!speech && ahead > 0.25) return; // don't queue silence when we're behind
    if (ahead < 0.02) {
      // Idle/underrun: restart with a tiny jitter buffer.
      if (!speech) return; // nothing worth playing yet
      this.nextTime = now + 0.04;
      ahead = 0.04;
    }

    const buf = this.ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const rate = ahead > 1.2 ? 1.2 : ahead > 0.6 ? 1.1 : 1;
    src.playbackRate.value = rate;
    src.connect(this.inGain);
    src.start(this.nextTime);
    this.nextTime += buf.duration / rate;
    // Remember when audible speech (not the model's near-silent filler) will finish playing.
    if (speech) this.speechUntil = this.nextTime;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** Seconds of translated audio queued ahead of "now" (for diagnostics). */
  get incomingLag() {
    return Math.max(0, this.nextTime - this.ctx.currentTime);
  }

  /** True while the partner's translated *speech* is audible (plus a short tail), used by the echo guard. */
  isPlayingIncoming(tail = 0.4) {
    return this.ctx.currentTime < (this.speechUntil || 0) + tail;
  }

  flushIncoming() {
    for (const s of this.sources) {
      try { s.stop(); } catch {}
    }
    this.sources.clear();
    this.nextTime = 0;
    this.speechUntil = 0;
  }

  set volume(v) {
    this.inGain.gain.value = v;
  }

  static level(analyser) {
    if (!analyser) return 0;
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }
}

/**
 * VoiceGate — only lets the person in front of the camera through to the translator.
 *
 * Runs on each 40 ms mic chunk (after the browser's echo cancellation / noise suppression /
 * voice isolation). It tracks two levels:
 *   • the room's noise floor (fan, traffic, keyboard…)
 *   • the main speaker's recent speech level (the person closest to the mic is the loudest)
 * The gate opens only for sound well above the noise floor AND within ~12 dB of the main
 * speaker — so distant voices, TVs and background chatter are replaced with silence.
 * A short pre-roll keeps word onsets, and a hang time avoids chopping words apart.
 */
export class VoiceGate {
  constructor({ chunkMs = 40 } = {}) {
    this.chunkMs = chunkMs;
    this.floor = 0.004; // running noise-floor estimate (RMS)
    this.speechLevel = 0; // recent level of the main speaker (RMS)
    this.open = false;
    this.hang = 0; // ms left before closing
    this.preroll = [];
  }

  reset() {
    this.open = false;
    this.hang = 0;
    this.preroll = [];
  }

  /**
   * @param {ArrayBuffer} buf 16 kHz Int16 PCM chunk
   * @returns {ArrayBuffer[]} chunks to send (silence while closed, pre-roll + audio when opening)
   */
  process(buf) {
    const s = new Int16Array(buf);
    let sumSq = 0;
    for (let i = 0; i < s.length; i++) sumSq += (s[i] / 0x8000) ** 2;
    const rms = Math.sqrt(sumSq / s.length);

    // Noise floor: falls quickly, rises slowly (and only while nobody is talking).
    if (rms < this.floor) this.floor = this.floor * 0.8 + rms * 0.2;
    else if (!this.open) this.floor = Math.min(0.05, this.floor * 0.995 + rms * 0.005);

    const threshold = Math.max(0.012, this.floor * 3.2, this.speechLevel * 0.25);
    const voiced = rms > threshold;

    if (voiced) {
      // Track the main speaker's level (fast attack, slow release).
      this.speechLevel = rms > this.speechLevel ? this.speechLevel * 0.6 + rms * 0.4 : this.speechLevel * 0.97 + rms * 0.03;
      this.hang = 450;
    } else {
      this.hang -= this.chunkMs;
      this.speechLevel *= 0.998; // slowly forget, so a quieter speaker can take over
    }

    const wasOpen = this.open;
    this.open = voiced || this.hang > 0;

    if (this.open) {
      const out = wasOpen ? [buf] : [...this.preroll, buf];
      this.preroll = [];
      return out;
    }
    this.preroll.push(buf);
    // Hold ~120 ms so a word's first syllable isn't clipped; older chunks go out as silence.
    if (this.preroll.length > 3) return [new ArrayBuffer(this.preroll.shift().byteLength)];
    return [];
  }
}

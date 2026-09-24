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

  /** Queue a chunk of the partner's translated 24 kHz PCM for gap-free playback. */
  playIncoming(int16) {
    if (!int16.length) return;
    const f32 = new Float32Array(int16.length);
    let sumSq = 0;
    for (let i = 0; i < int16.length; i++) {
      const v = int16[i] / 0x8000;
      f32[i] = v;
      sumSq += v * v;
    }
    const buf = this.ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.inGain);
    const now = this.ctx.currentTime;
    // Small jitter buffer: if we've fallen behind, restart slightly in the future.
    if (this.nextTime < now + 0.02) this.nextTime = now + 0.08;
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    // Remember when audible speech (not the model's near-silent filler) will finish playing.
    if (Math.sqrt(sumSq / int16.length) > 0.008) this.speechUntil = this.nextTime;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
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

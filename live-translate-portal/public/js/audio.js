/**
 * AudioEngine — all Web Audio plumbing.
 *
 *  mic track ──► pcm-capture worklet ──► onPcm(16 kHz Int16 chunks) ──► Gemini
 *  Gemini 24 kHz PCM ──► scheduled buffers ──► MediaStreamDestination ──► WebRTC audio track (to partner)
 *
 * The translated voice is sent to the partner as a regular WebRTC audio track, so the
 * browser's echo canceller treats it like any call audio.
 */
export class AudioEngine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.onPcm = null;
    this.onMicLevel = null;
    this.micEnabled = true;

    // Outgoing translated voice → WebRTC.
    this.outGain = this.ctx.createGain();
    this.outAnalyser = this.ctx.createAnalyser();
    this.outAnalyser.fftSize = 512;
    this.outDest = this.ctx.createMediaStreamDestination();
    this.outGain.connect(this.outAnalyser);
    this.outGain.connect(this.outDest);

    this.nextTime = 0;
    this.sources = new Set();
    this.workletReady = this.ctx.audioWorklet.addModule('/worklets/pcm-capture.js');
  }

  /** The audio track carrying the translated voice. */
  get translatedTrack() {
    return this.outDest.stream.getAudioTracks()[0];
  }

  async resume() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

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

  /** Queue a chunk of translated 24 kHz PCM for gap-free playback into the outgoing track. */
  playTranslated(int16) {
    if (!int16.length) return;
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 0x8000;
    const buf = this.ctx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outGain);
    const now = this.ctx.currentTime;
    // Small jitter buffer: if we've fallen behind, restart slightly in the future.
    if (this.nextTime < now + 0.02) this.nextTime = now + 0.06;
    src.start(this.nextTime);
    this.nextTime += buf.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  flushTranslated() {
    for (const s of this.sources) {
      try { s.stop(); } catch {}
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  /** Returns an analyser for any MediaStream with audio (e.g. the partner's translated voice). */
  analyserFor(stream) {
    if (!stream.getAudioTracks().length) return null;
    const src = this.ctx.createMediaStreamSource(stream);
    const an = this.ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    return an;
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

/**
 * AudioWorklet that turns microphone audio (at the AudioContext rate, typically 48 kHz)
 * into 16 kHz mono 16-bit little-endian PCM, emitted in 100 ms chunks (1600 samples) —
 * exactly what Gemini Live Translate expects.
 */
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600; // 100 ms @ 16 kHz

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.phase = 0;
    this.acc = 0;
    this.accN = 0;
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outIdx = 0;
    this.levelSum = 0;
    this.levelN = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      this.levelSum += s * s;
      this.levelN++;

      // Box-filter decimation: average all input samples that fall in one output period.
      this.acc += s;
      this.accN++;
      this.phase += 1;
      if (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        let v = this.acc / this.accN;
        this.acc = 0;
        this.accN = 0;
        v = v < -1 ? -1 : v > 1 ? 1 : v;
        this.out[this.outIdx++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.outIdx === CHUNK_SAMPLES) {
          this.port.postMessage({ pcm: this.out.buffer }, [this.out.buffer]);
          this.out = new Int16Array(CHUNK_SAMPLES);
          this.outIdx = 0;
        }
      }
    }

    // ~40 ms level updates for the UI meter.
    if (this.levelN >= sampleRate / 25) {
      this.port.postMessage({ level: Math.sqrt(this.levelSum / this.levelN) });
      this.levelSum = 0;
      this.levelN = 0;
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);

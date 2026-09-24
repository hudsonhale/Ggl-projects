/**
 * PeerLink — one RTCPeerConnection + a "captions" data channel.
 *
 * We send: the camera video track and the *translated* voice track (never the raw mic).
 * Events: 'stream' (MediaStream), 'state' (string), 'data' (object)
 */
export class PeerLink extends EventTarget {
  constructor({ iceServers, sendSignal, videoTrack, audioTrack, initiator }) {
    super();
    this.sendSignal = sendSignal;
    this.initiator = initiator;
    this.pendingIce = [];
    this.channel = null;
    this.remoteStream = new MediaStream();

    const pc = (this.pc = new RTCPeerConnection({ iceServers }));
    const outStream = new MediaStream([videoTrack, audioTrack].filter(Boolean));
    this.videoSender = videoTrack ? pc.addTrack(videoTrack, outStream) : pc.addTransceiver('video', { direction: 'recvonly' }).sender;
    this.audioSender = pc.addTrack(audioTrack, outStream);

    pc.onicecandidate = (e) => e.candidate && this.sendSignal({ type: 'ice', candidate: e.candidate });
    pc.ontrack = (e) => {
      if (!this.remoteStream.getTracks().includes(e.track)) this.remoteStream.addTrack(e.track);
      this.#emit('stream', this.remoteStream);
    };
    pc.onconnectionstatechange = () => {
      this.#emit('state', pc.connectionState);
      if (pc.connectionState === 'failed' && this.initiator) this.#restart();
    };
    pc.ondatachannel = (e) => this.#bindChannel(e.channel);

    if (initiator) {
      this.#bindChannel(pc.createDataChannel('captions', { ordered: true }));
      this.#offer();
    }
  }

  async handleSignal(msg) {
    const pc = this.pc;
    try {
      if (msg.type === 'offer') {
        await pc.setRemoteDescription(msg.sdp);
        await this.#flushIce();
        await pc.setLocalDescription(await pc.createAnswer());
        this.sendSignal({ type: 'answer', sdp: pc.localDescription });
      } else if (msg.type === 'answer') {
        await pc.setRemoteDescription(msg.sdp);
        await this.#flushIce();
      } else if (msg.type === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate);
        else this.pendingIce.push(msg.candidate);
      }
    } catch (err) {
      console.warn('[rtc] signal error', err);
    }
  }

  send(obj) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(obj));
  }

  async replaceVideoTrack(track) {
    await this.videoSender?.replaceTrack(track);
  }

  close() {
    try { this.channel?.close(); } catch {}
    try { this.pc.close(); } catch {}
  }

  // -------------------------------------------------------------------------

  async #offer(iceRestart = false) {
    const offer = await this.pc.createOffer({ iceRestart });
    await this.pc.setLocalDescription(offer);
    this.sendSignal({ type: 'offer', sdp: this.pc.localDescription });
  }

  #restart() {
    this.#offer(true).catch((e) => console.warn('[rtc] restart failed', e));
  }

  async #flushIce() {
    for (const c of this.pendingIce.splice(0)) {
      try { await this.pc.addIceCandidate(c); } catch {}
    }
  }

  #bindChannel(ch) {
    this.channel = ch;
    ch.onopen = () => this.#emit('channel-open', null);
    ch.onmessage = (e) => {
      try { this.#emit('data', JSON.parse(e.data)); } catch {}
    };
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

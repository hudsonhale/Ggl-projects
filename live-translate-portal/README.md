# Portal — live translated video calls

Two people, two computers, two languages. Each person sees the other on camera, and everything they say is
translated **in real time, in their own voice**, with live captions — powered by
**Gemini 3.5 Live Translate** (`gemini-3.5-live-translate-preview`).

## Quick start

```bash
cd ~/live-translate-portal
cp .env.example .env        # then paste your key into GEMINI_API_KEY
npm install
npm start
```

- **This computer:** open <http://localhost:3000>
- **Other computer on the same network:** open the `https://<your-ip>:3443` URL printed in the terminal and
  accept the self-signed certificate warning (browsers only allow camera access over HTTPS or localhost).
- **Different networks / internet:** expose the server with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`
  or `ngrok http 3000`) and share that https link. If video won't connect, add a TURN server in `.env`.

Each person picks **their own language** (the language they want to hear). Spoken language is auto‑detected.

## How it works

```
 Person A's browser                                               Person B's browser
 ┌───────────────────────────┐                                   ┌───────────────────────────┐
 │ mic ─► 16 kHz PCM worklet │──ws /translate?target=B.lang──►   │                           │
 │                           │   (server proxy + API key)        │                           │
 │        Gemini 3.5 Live Translate (auto-detect → B.lang,       │                           │
 │        voice-preserving 24 kHz audio + transcripts)           │                           │
 │ translated audio ─► MediaStreamDestination ─► WebRTC track ──►│ plays A's voice in B.lang │
 │ camera ───────────────────────────────────────► WebRTC video ►│ sees A                    │
 │ transcripts ──────────────────────────────────► data channel ►│ captions + transcript     │
 └───────────────────────────┘                                   └───────────────────────────┘
                 (and the exact mirror image from B to A)
```

- Each browser translates **its own microphone** into the **partner's language**, then sends only the translated
  voice over WebRTC. Because it travels as normal call audio, the browser's echo canceller keeps the partner's
  translated voice from being re-translated.
- `echoTargetLanguage: true` is used so that if you already speak your partner's language, your words still reach them.
- The server (`server.js`) does three things: serves the app, relays WebRTC signaling for 2-person rooms, and proxies
  the Gemini Live WebSocket so your API key never reaches the browser.
- The translator handles Gemini `goAway` messages with a seamless session handover and reconnects with backoff.

## Files

| File | Purpose |
| --- | --- |
| `server.js` | Express static server, `/signal` WebRTC signaling, `/translate` Gemini Live proxy, HTTPS for LAN |
| `public/js/app.js` | UI + call orchestration, captions, transcript |
| `public/js/translator.js` | Gemini Live Translate client (PCM in → translated audio + transcripts out) |
| `public/js/audio.js` | Web Audio: mic capture, gap-free playback into the outgoing WebRTC track |
| `public/js/rtc.js` | RTCPeerConnection + captions data channel |
| `public/worklets/pcm-capture.js` | AudioWorklet: mic → 16 kHz 16-bit PCM in 100 ms chunks |

## Tips

- Use headphones for the cleanest results.
- Change your language mid-call from the globe menu in the control dock — your partner's translator re-targets instantly.
- Voice replication is a preview feature and can drift after long pauses (a documented model limitation).

# Ggl-projects

| Project | Description |
| --- | --- |
| [live-translate-portal](./live-translate-portal) | Two-person video calls with real-time, voice-preserving speech translation and live captions, powered by Gemini 3.5 Live Translate. |

## Run in Google AI Studio

This repo root is set up so Google AI Studio (Build mode) can import and deploy the portal directly:

- `package.json` — `npm run dev` / `npm start` launch `live-translate-portal/server.js` (Node full-stack app, listens on `$PORT`, default 3000).
- `metadata.json` — asks AI Studio for **camera** and **microphone** access.
- The server reads the Gemini key from the `GEMINI_API_KEY` secret (AI Studio → Settings → Secrets). It is never sent to the browser.

Steps: AI Studio → **Build** → **+** → **Import from GitHub** → this repo → check the `GEMINI_API_KEY` secret → **Publish** → share the Cloud Run URL. Both people open the URL, enter the same room code, and talk.

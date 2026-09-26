# explode me — project context

This is an existing complete app, exported for GitHub and Google AI Studio. Preserve its interface, camera capture, upload flow, detailed individual parts, research/source citations, nested exploration, and globe game. Do not regenerate it from scratch, replace it with demo data, or convert it to a static-only app.

## Runtime

- Standard Next.js App Router on Node.js; React 19, TypeScript, Tailwind, Three.js.
- Node 24 recommended; minimum 22.15 for test loader APIs.
- `npm install`, `npm run dev` (port 3000, hostname 0.0.0.0). Use the preview environment's required port with `npm run dev -- --port <port>`.
- `npm test`, `npm run typecheck`, `npm run build`, `npm start`.
- `pnpm-lock.yaml` is included; pnpm with its frozen lockfile reproduces the tested dependencies.
- Run the Node API routes alongside the frontend. A frontend-only preview cannot analyze photographs.
- `metadata.json` requests camera access in AI Studio.

## Gemini integration

All Google calls originate from `lib/explode/gemini-server.ts` on the server. Keys are opaque: trim surrounding whitespace and reject only missing values. Accept long dotted AQ. keys and let Google validate them. Do not reintroduce key-prefix, character, or length regex restrictions.

A user-pasted `x-gemini-api-key` takes precedence over `process.env.GEMINI_API_KEY`. This is intentional so the user can connect a different key, even if AI Studio automatically injects a server key. Pasted keys remain in tab memory only. Server keys never belong in public environment variables or browser bundles.

The optional `GEMINI_MODEL` selects a preferred model only if it appears in Google's model list. Successful connection stores the chosen model with the tab session. Keep Google Search grounding, JSON schema validation, source allowlisting, body limits, cancellation and provider timeouts.

There is no ChatGPT hosting dependency and no app-level account login. Keep the preview private when using a shared server key. Same-origin request checks remain in place; `APP_ORIGIN` optionally supplies the external origin behind a reverse proxy. Never log API keys, photo bodies, or request headers.

## Main flow

Photo → detected subjects → Google Search grounded research → structured assembly → individually selectable 3D parts → optional nested exploration/origin game.

Anatomy is generalized and educational. Hidden composition can be estimated; preserve those labels and uncertainty. This is not validated CAD or clinical analysis.

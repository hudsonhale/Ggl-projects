# explode me

A complete, standalone photo-to-3D exploration app. Photograph an object, let Gemini research and reconstruct its parts, pull it apart into a grid, and play the origin guessing game.

This export runs on **Next.js + Node.js**, with the existing React/Three.js interface and Gemini pipeline. It does not require ChatGPT sign-in or Cloudflare. No API keys, uploaded photos, private account identifiers, or Git history are included.

## Upload to GitHub and open in Google AI Studio

1. Unzip this download. Create a GitHub repository, then upload the **contents of the `explode-me` folder**. `package.json`, `README.md`, `app/`, and the other files must be at the repository root. Do not upload the ZIP as a single file.
2. Open [Google AI Studio Build](https://aistudio.google.com/apps). In the prompt box, click **+ → Import from GitHub** and select your repository. Authorize GitHub access if prompted.
3. Ask Gemini: **“Read GEMINI.md. Run this existing Next.js app with its Node.js API routes using npm run dev on the preview port. Preserve its UI and full Gemini pipeline. Do not replace it with a mockup or static app.”**
4. In the app, click **Gemini key**, paste your new key, and click **Connect & continue**. Dotted `AQ.` keys are supported. Your pasted key overrides the server default for this tab.
5. Alternatively, set or replace **GEMINI_API_KEY** in AI Studio's **Settings → Secrets**. Choose **Use the server key** in the app's key dialog. If you changed a server secret, restart the preview and reload the app.

The included `metadata.json` requests camera permission in AI Studio. Photo upload works when camera access is unavailable. Gemini may need to adapt the preview's port or runtime settings during import. The exported code was tested locally; importing into your AI Studio account was not performed.

Official Google instructions: [GitHub import, secrets, and camera permissions](https://ai.google.dev/gemini-api/docs/aistudio-build-mode), [server-side runtime](https://ai.google.dev/gemini-api/docs/aistudio-fullstack).

## Run locally

Use **Node.js 24 LTS** (minimum 22.15). From this folder:

```sh
npm install
npm run dev
```

Open http://localhost:3000. Click **Gemini key** and enter your own key. No `.env` file is required for this mode.

The included pnpm lockfile provides a reproducible alternative:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

To use an optional server default, copy `.env.example` to `.env.local`, enter `GEMINI_API_KEY`, and restart the app. `GEMINI_MODEL` can optionally prioritize a model available to that key. Leave it empty for automatic selection.

## Change API keys

- Click **Gemini key** to paste a replacement at any time when analysis is idle.
- A pasted key takes priority over the server's `GEMINI_API_KEY`.
- **Use the server key** clears the tab's override and reconnects using the server default.
- Pasted keys stay in memory for the current tab. Reloading clears them.
- The app sends credentials to its own API routes and then to Google's Gemini API. They are not added to browser storage or bundled into browser JavaScript.
- Never put real keys in the repository or in `NEXT_PUBLIC_` variables. `.gitignore` excludes `.env.local` and other real environment files.

There is no app-level login in this portable edition. If you configure a server key and publish the app, its visitors can use that key through the app and incur usage charges. Keep the hosted app private, or leave the server key unset so each visitor supplies their own.

## Test and build

```sh
npm test
npm run typecheck
npm run build
npm start
```

This is a full-stack app: **GitHub stores the source; GitHub Pages cannot run its API routes**. Run it in AI Studio or a host that supports a Next.js Node server. `PORT` controls the server port. If a reverse proxy changes the internal host, set `APP_ORIGIN` to the exact external origin, such as `https://your-app.example`.

## How it works

1. The camera/photo upload resizes the image, then Gemini detects the actual subject and offers choices if ambiguous.
2. Gemini performs Google Search grounded research on composition, materials, function, and origin.
3. A structured model describes individual parts and their geometry. Repeated petals, leaves, seeds, bones, and other components expand into individually selectable objects.
4. Three.js renders the assembly and moves each part into an exploded grid. Part cards show facts, materials, sources, and deeper reconstructions.
5. The globe game uses the researched origin, distinguishing exact points, approximate regions, and unknown origins.

The app supports up to 1,200 physical parts from 100 component families. It creates researched illustrations, not verified CAD or photogrammetry; unseen structures may be estimates. Photos and reconstructed models are not persisted. A per-key, per-process guard prevents overlapping reconstruction requests; it is not a distributed billing quota.

## Project map

- `components/explode/`: camera, interface, 3D viewer, globe.
- `lib/explode/gemini-server.ts`: Gemini requests, key selection, model discovery, validation, research, reconstruction.
- `app/api/explode/`: configuration, connection, detection, reconstruction endpoints.
- `lib/explode/geometry.ts`, `assembly.ts`: generated meshes and exploded layout.
- `app/globals.css`: existing visual design plus key management control.
- `tests/`: key-routing, origin checks, geometry and assembly regression tests.
- `GEMINI.md`: project context for Gemini.

## Earth imagery and attribution

- NASA Blue Marble Next Generation July imagery: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/july/world.200407.3x5400x2700.jpg
- NASA / GEBCO topography: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/topography/gebco_08_rev_elev_5400x2700.jpg
- Credit: NASA Earth Observatory / Reto Stöckli. https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/
- NASA media usage: https://www.nasa.gov/nasa-brand-center/images-and-media/
- `public/world.json` derives from `world-atlas/countries-50m.json`; Natural Earth data is public domain and world-atlas is ISC licensed. Borders are cartographic approximations.
- Vendored Shadcn CSS license is included in `vendor/`.

## Validation limits

Automated tests use synthetic keys and mocked Google responses. No paid Gemini calls were made with a real key. A full photo reconstruction and your AI Studio import still need to be tried with your account. Model access, billing, quotas, and Google Search grounding availability depend on the selected key.

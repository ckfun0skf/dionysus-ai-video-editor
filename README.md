# Dionysus

Dionysus is a local-first AI video planning and composition editor. It is designed to organize a video project and produce an AI-readable execution plan; built-in generative models are not required.

## Product direction

- Storyboard-first planning with an independently editable timeline
- Shots, clip slots, versioned nested compositions, layers, and reusable assets
- Character/entity reference profiles with shot-level overrides and generation snapshots
- Local persistence, portable project JSON, and an AI-readable execution plan
- Browser-side canvas/Web Audio composition and experimental WebM export for selected shot-version layers

## Start here

**For any new agent or contributor, read [the Agent Handoff Guide](docs/AGENT_HANDOFF.md) first.** It links the durable project context and explains the workflow.

- [Product Requirements Document](docs/PRD.md)
- [Architecture Notes](docs/ARCHITECTURE.md)

## Task tracking

The task dashboard is published with the static site at `doc/task.html` (GitHub Pages path: `/dionysus-ai-video-editor/doc/task.html`). Each task has a detail HTML page, a Markdown specification, and a completion report under `public/doc/`. Keep these files synchronized as task status changes.

## Localization

All static UI copy is centralized in `src/i18n.ts`. Components use typed message keys and interpolation instead of embedding interface text, so additional locale catalogs can be added consistently. The current UI defaults to English; a language selector is a later milestone.

## Development

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The app is a static Vite web application. The CI workflow builds pull requests and feature branches. The GitHub Pages workflow deploys the site when changes reach `main`.

## Public preview and data safety

To publish the preview, merge the intended release to `main`, then enable **Settings → Pages → Build and deployment → GitHub Actions** in the repository if it is not already enabled. Check the Actions run for a successful deployment before sharing the site URL.

A public deployment makes the app code available to anyone with the site URL. Project data currently lives in the browser's local storage and is **not** synced to a server or shared between browsers/devices. Export project JSON as a backup. Never put secrets, API keys, credentials, or private media in this public repository or its deployed bundle.

## Current implementation scope

The editor now has an experimental browser-side compositor that renders selected nested shot-version layers and assigned timeline media onto a canvas, mixes assigned audio through Web Audio, and records the result as WebM using MediaRecorder. Export requires a browser that supports canvas capture, Web Audio, and WebM encoding. The export is not MP4, does not bundle source media into project JSON, and is not a frame-accurate professional NLE. Cross-origin media must allow CORS.

Imported video/audio binary data is stored in IndexedDB on the current browser/device; project JSON stores local asset references, not the binary files, so it is not a portable media archive by itself. Imported images remain browser-local data URLs (limited to 4 MB each by the UI). AI image generation uses a user-configured OpenAI-compatible endpoint from the browser; the endpoint must allow CORS. API keys are held in component memory, not persisted to the project. Generated images are saved to IndexedDB, and prompt/model/reference provenance is recorded. The automated browser smoke test mocks the provider and proves the local export path; it does not validate a real commercial provider account or arbitrary endpoint compatibility.

The Timeline still lacks frame-accurate drag-and-drop trimming, ZIP packaging, and full professional editing behavior. The Three.js procedural animation widget is a preview, while final rendered output currently uses the Canvas 2D compositor. See the PRD for confirmed decisions and unresolved questions.

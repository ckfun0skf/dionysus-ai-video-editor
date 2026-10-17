# Dionysus

Dionysus is a local-first AI video planning and composition editor. It is designed to organize a video project and produce an AI-readable execution plan; built-in generative models are not required.

## Product direction

- Storyboard-first planning with an independently editable timeline
- Shots, clip slots, versioned nested compositions, layers, and reusable assets
- Character/entity reference profiles with shot-level overrides and generation snapshots
- Local persistence, portable project JSON, and an AI-readable execution plan
- Adaptive preview quality; browser MP4 export is a future goal

## Start here

**For any new agent or contributor, read [the Agent Handoff Guide](docs/AGENT_HANDOFF.md) first.** It links the durable project context and explains the workflow.

- [Product Requirements Document](docs/PRD.md)
- [Architecture Notes](docs/ARCHITECTURE.md)

## Localization

All static UI copy is centralized in `src/i18n.ts`. Components use typed message keys and interpolation instead of embedding interface text, so additional locale catalogs can be added consistently. The current UI defaults to English; a language selector is a later milestone.

## Development

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
npm test
npm run build
```

The app is a static Vite web application. The CI workflow builds pull requests and feature branches. The GitHub Pages workflow deploys the site when changes reach `main`.

## Public preview and data safety

To publish the preview, merge the intended release to `main`, then enable **Settings → Pages → Build and deployment → GitHub Actions** in the repository if it is not already enabled. Check the Actions run for a successful deployment before sharing the site URL.

A public deployment makes the app code available to anyone with the site URL. Project data currently lives in the browser's local storage and is **not** synced to a server or shared between browsers/devices. Export project JSON as a backup. Never put secrets, API keys, credentials, or private media in this public repository or its deployed bundle.

## Current implementation scope

The foundation includes a basic Storyboard and Timeline shell, starter project schema, browser-local persistence, project JSON import/export, and AI execution-plan JSON export. The Timeline is not yet a frame-accurate drag-and-drop editor, and full media editing, compositing/playback, ZIP packaging, persistent Undo/Redo, advanced audio processing, and MP4 rendering remain future work. See the PRD for confirmed decisions and unresolved questions.

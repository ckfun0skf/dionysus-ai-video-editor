# Dionysus

Dionysus is a local-first AI video planning and composition editor. It is designed to organize a video project and produce an AI-readable execution plan; built-in generative models are not required.

## Start here

The app lives in `src/v2` and is served at the site root (a `?v2` query string from older links is ignored). Design and format references:

- [Module design](docs/v2/MODULE_DESIGN.md)
- [Vision](docs/v2/VISION.md)
- [Storyboard format](docs/v2/STORYBOARD_FORMAT.md) and [HTML clip package](docs/v2/HTML_CLIP_PACKAGE.md)
- [Adding effects](docs/v2/ADDING_EFFECTS.md) and [Deployment](docs/v2/DEPLOYMENT.md)

## Task tracking

The task dashboard is published with the static site at `doc/task.html` (on the default GitHub Pages deployment: `/dionysus-ai-video-editor/doc/task.html`). Each task has a detail HTML page, a Markdown specification, and a completion report under `public/doc/`. Keep these files synchronized as task status changes.

## Development

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
npm test
npm run build
```

The app is a static Vite web application. CI runs for pull requests targeting `main`, pushes to `main`, and manual dispatches; feature-branch pushes do not trigger a separate full CI run. Stale runs for the same pull request/ref are cancelled when newer commits arrive. The GitHub Pages workflow deploys the site when changes reach `main`. To deploy to another host or path, set `DIONYSUS_SITE_URL` for the build; see [docs/v2/DEPLOYMENT.md](docs/v2/DEPLOYMENT.md).

## Public preview and data safety

To publish the preview, merge the intended release to `main`, then enable **Settings → Pages → Build and deployment → GitHub Actions** in the repository if it is not already enabled. Check the Actions run for a successful deployment before sharing the site URL.

A public deployment makes the app code available to anyone with the site URL. Project data currently lives in the browser's local storage and is **not** synced to a server or shared between browsers/devices. Export project JSON as a backup. Never put secrets, API keys, credentials, or private media in this public repository or its deployed bundle.

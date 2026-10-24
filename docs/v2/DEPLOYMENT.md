# Deploying Dionysus (V2-OPS-LINKS)

Dionysus is a static Vite site. It is deployed to GitHub Pages by default, but nothing ties it to that host: one environment variable describes the deployment.

## Site URL and base

| Setting | Where | Default |
|---|---|---|
| `DIONYSUS_SITE_URL` | environment variable read by `vite build` (and `vite dev`) | `https://ckfun0skf.github.io/dionysus-ai-video-editor/` (`DEFAULT_SITE_URL` in `src/v2/domain/siteUrl.ts`) |

Set it to the absolute public URL the app is served from, including the subpath and a trailing slash:

```bash
# Root of a custom domain
DIONYSUS_SITE_URL=https://video.example.com/ npm run build
# Under a subpath
DIONYSUS_SITE_URL=https://example.com/tools/dionysus/ npm run build
```

Then upload `dist/` to the host. The build derives everything else from that one value:

- **Vite `base`** is the URL's path (`/`, `/tools/dionysus/`), so asset URLs resolve on the new host. `npm run build -- --base=/other/path/` still overrides the path (the GitHub PR preview does this); the AI files then use the same origin with that path.
- **AI planner files.** `vite build` regenerates `ai/storyboard-guide.md`, `ai/storyboard-guide.html`, `ai/presets.json` and `llms.txt` from the registry for the build's site URL, and publishes the format reference as `ai/STORYBOARD_FORMAT.md` (copied from `docs/v2/STORYBOARD_FORMAT.md`). Their links are absolute (`<site>/ai/presets.json`, `<site>/?v2`, …) because an AI reads these files out of context. The copies committed under `public/` use the default URL; they serve `npm run dev` and are kept current by `npm run gen:ai` (`aiGuide.test.ts` fails while they are stale).
- **In-app prompt.** The short prompt and the *Open guide* button build their links at runtime from the page's own address: `new URL(import.meta.env.BASE_URL, location.href)`. A deployed build therefore always links to itself, whatever the host. On `localhost` or a LAN address, which an outside AI can't open, they fall back to `DIONYSUS_SITE_URL`.

Check a deployment by opening `<site>/ai/storyboard-guide.md` and `<site>/llms.txt`, and by copying the short prompt from Storyboard → AI prompt: every link should start with the new site URL.

## GitHub Pages

The Pages workflow builds without `DIONYSUS_SITE_URL`, so the default applies. Moving to another host only needs the variable in that host's build settings (for example a Netlify, Vercel or Cloudflare Pages environment variable, or `env:` in a CI job).

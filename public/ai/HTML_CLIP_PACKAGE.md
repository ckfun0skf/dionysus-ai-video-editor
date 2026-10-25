# Dionysus HTML clip package — `dionysus.htmlclip/1`

Status: v1 (V2-HTML-PKG). Source of truth: `src/v2/domain/htmlClipPackage.ts` (manifest, validation, prompt) and `src/v2/render/htmlClip.ts` (runtime). This document is published with the app as `ai/HTML_CLIP_PACKAGE.md`, next to the storyboard guide.

An **HTML clip** is an animated graphic (titles, charts, 3D, motion design) that Dionysus plays on the timeline like a video clip. The editor draws it frame by frame from timeline time, so preview, scrubbing and export show the same pictures. This document defines the package an HTML clip is exchanged in: what an AI writes, what the app imports and exports, and the contract the page must follow.

## 1. Two forms

| Form | Use | Contents |
|---|---|---|
| **Single file** `.html` (canonical) | What an AI replies with, what versions store, *Export .html* | One self-contained HTML document: the manifest, `<style>`, markup and `<script>`; embedded files as data: URLs in the manifest |
| **Portable ZIP** `.dionysus-html.zip` | Editing in a code editor, *Export .zip* | `manifest.json`, `index.html` (links `style.css` and `script.js`), `style.css`, `script.js`, and the embedded files under their names |

Both import the same way: in the asset's *Paste HTML / import* box (paste the AI's reply or the HTML, or choose a `.html`, `.htm` or `.zip` file; on desktop a file can also be dropped there) or with *Upload* / *Import*. A ZIP is converted to the single-file form on import: `style.css` and `script.js` (any local stylesheet or script the `index.html` references) are inlined, `manifest.json` becomes the manifest, and every other file becomes an embedded file with its path as its name. A ZIP of a folder (one top-level directory) is accepted. Project export (`.dionysus.zip`) stores the single file as the version's media, unchanged.

## 2. Manifest

The first element of `<head>`:

```html
<script type="application/json" id="dionysus-clip">{ "format": "dionysus.htmlclip/1", "name": "…", … }</script>
```

| Field | Type | Meaning |
|---|---|---|
| `format` | `"dionysus.htmlclip/1"` | Required for a conforming package. Missing = a legacy clip (accepted with a warning). |
| `name` | string | Display and file name. |
| `description` | string | Optional. |
| `durationSec` | number (0–600] | Intended length. On the timeline the clip's own length wins (`ctx.duration`). |
| `width`, `height` | integer px (16–8192) | Intended frame size. The clip renders at the output size (`ctx.width`, `ctx.height`). |
| `aspect` | `"16:9"` \| `"9:16"` \| `"1:1"` \| `"4:5"` \| `"21:9"` | Optional. |
| `background` | CSS colour \| `"transparent"` | `"transparent"` = the canvas keeps alpha and is composited over the layers below. |
| `libs` | string[] | Library ids the page imports (see §4). Absent = detected from the page's imports (legacy). |
| `bindings` | `{ "<name>": { "type": "image" \| "video" \| "audio", "asset"?: "<asset id>", "label"?, "description"? } }` | Named slots for media from other assets. `asset` is a storyboard asset id or a project asset id (default: the binding name). |
| `params` | `{ "<key>": { "type", "default", "label"?, "description"?, … } }` | Exposed values: `number` (`min`, `max`, `step`), `color` (`"#rrggbb"`), `text`, `boolean`, `select` (`options`). `default` is required and must be valid. The clip reads them as `ctx.params.<key>`. **Per use (V2-HTML-PARAMS):** each timeline clip, storyboard shot or layer that uses the clip can give its own values (§3.1), so one clip (say a title card) shows different words in different places. Editing the defaults in the HTML editor saves a new version. |
| `files` | `{ "<name>": "data:…" }` | Embedded files, used by name (see §3). Legacy manifests call this `assets`; it is read as `files`. |

Unknown fields are kept. JSON inside the tag must escape `</` as `<\/`.

## 3. Runtime contract

The page runs in a sandboxed iframe (scripts only, opaque origin, no access to the editor, storage or cookies) under a Content-Security-Policy that allows inline scripts and styles, `blob:` and `data:` URLs, and the selected library files, and nothing else.

<!-- contract:start -->
- Register the clip once, at the top level of your script: `dionysus.clip({ async init(ctx) { … }, render(t, ctx) { … } })`. `init` (optional) runs once before the first frame; await anything you need there (images, fonts, models). `render(t, ctx)` draws the frame at `t` seconds into the clip and may return a Promise.
- `ctx` = `{ canvas, t, duration, progress, width, height, params, bindings, asset(name), image(name), video(name), seek(video, sec) }`: `duration` is the clip's length on the timeline in seconds (it can differ from the manifest's `durationSec`), `progress` = t / duration (0–1), `canvas` the page's first `<canvas>` (the captured picture), `width`/`height` the frame size in pixels, `params` the parameter values (each declared param's default, overridden by the values set where the clip is used: a timeline clip, a storyboard shot or layer; read them in `render`, they can change between frames while the user edits), `bindings[name]` = `{ type, url }` for each bound asset (`url` is null when nothing is bound yet: draw a placeholder), `asset(name)` the URL of an embedded file, `image(name)` a Promise of a loaded HTMLImageElement for a binding or file, `video(name)` a Promise of a muted HTMLVideoElement, `seek(video, sec)` a Promise that resolves when that video shows `sec`.
- The picture is the page's FIRST `<canvas>`: size it to ctx.width × ctx.height in `init` and draw everything on it (2D or WebGL; for WebGL use `preserveDrawingBuffer: true`). Other DOM and CSS are not captured.
- Deterministic: every frame is a pure function of t, ctx.params and the bound assets. Frames are requested in any order (scrubbing, export), and the same t must give the same picture. Don't keep animation state between frames, don't use Date.now(), performance.now(), requestAnimationFrame, setTimeout or setInterval for timing, and use a seeded random generator (fixed seed) instead of Math.random().
- No network: the clip runs in a sandbox with a strict Content-Security-Policy. Only the allowed libraries (listed in the manifest's `libs`, imported by their bare specifier in a `<script type="module">`, e.g. `import * as LIB from "<specifier>"`) are loaded. Embed any other file as a data: URL in the manifest's `files` and refer to it by name. Use system font stacks, or an embedded font with @font-face (the runtime waits for fonts to load before the first frame).
- Transparency: with `"background": "transparent"`, clear the canvas to transparent (2D: clearRect; WebGL: `alpha: true` and a clear colour with alpha 0); the clip is composited over the layers below. Otherwise paint the background colour every frame.
<!-- contract:end -->

**Embedded files** resolve by name everywhere: `src`, `href`, `poster` and `data` attributes, `fetch()` and `XMLHttpRequest`, and CSS `url()`. `ctx.asset(name)` returns the `blob:` URL. Bound assets resolve the same way by binding name.

**Host protocol** (for reference; pages only use `dionysus.clip`):

```
iframe → editor  { type: "dionysus:ready" }                                       page loaded
editor → iframe  { type: "dionysus:init", width, height, duration?, bindings: { name: { type, blob } }, params? }
editor → iframe  { type: "dionysus:params", params }                              new param values (V2-HTML-PARAMS); no reload
editor → iframe  { type: "dionysus:frame", seq, t, duration? }                    draw frame t
iframe → editor  { type: "dionysus:frame", seq, bmp }                             ImageBitmap of the first <canvas>
```

`init` is awaited before the first frame; a frame that takes more than 4 s in export is reported and the previous frame is kept. In the HTML editor's live preview no init message is sent: `ctx` then uses the manifest's values and bindings are null.

### 3.1 Param values per use (V2-HTML-PARAMS)

`ctx.params` holds, for every param the manifest declares, the **use's value** when it has a valid one, else the manifest `default`:

- **Where values come from:** a timeline clip's own values (inspector → **Params**, saved on the clip as `htmlParams`, overrides only), which a storyboard shot's or html layer's `params` fill on Send to timeline. Preview, thumbnails and export all pass the same values.
- **Resolution:** against the manifest of the version being played. A value is used when its type matches (numbers are clamped to `min`–`max`, a select value must be in `options`, a colour must be `#rrggbb`); anything else falls back to the default. Values for keys the manifest doesn't declare are kept on the clip but not passed (so swapping to a version that declares them again restores them).
- **Changes while playing:** when the values change, the editor sends `dionysus:params` and redraws the current frame; the page is not reloaded. Read `ctx.params` inside `render`, not only in `init`, and lay out for any value (long and short text).

**Legacy clips** (no manifest or no `format`) keep working: `dionysus.onFrame((t, ctx) => …)` is called every frame, and `requestAnimationFrame`, `performance.now()` and `Date.now()` are driven from t (Date starts at 2026-01-01T00:00:00Z), and `Math.random()` is seeded. Code that accumulates state between frames can still differ after a seek, which is why new clips use `dionysus.clip`.

## 4. Libraries

Only libraries from the app's registry can be loaded; each is self-hosted and pinned with Subresource Integrity, and the import map and CSP are generated from the clip's `libs`. The registry today:

| id | Library | Import |
|---|---|---|
| `three` | three.js 0.160.0 | `import * as THREE from "three"` |

Old CDN URLs of a registry library (e.g. unpkg three.js) are mapped to the pinned copy with a warning. Anything else (other CDNs, Google Fonts, APIs) is blocked.

## 5. Validation

Pasting or importing checks the clip and lists the problems. Errors block *Add as new version*; warnings don't.

| Code | Level | When |
|---|---|---|
| `empty`, `not-html` | error | Nothing to import, or the text is not an HTML document |
| `manifest-json`, `format`, `name`, `duration`, `size`, `background`, `libs`, `bindings`, `binding-*`, `params`, `param-*`, `files`, `file` | error | The manifest is not valid JSON, has an unknown format, or a field is invalid |
| `network` | error | An `http(s)://` or `//` URL in `src`/`href`, `import`, `fetch`, CSS `url()`/`@import`, or Google Fonts |
| `lib-unknown` | error | A library id or bare import that is not in the registry |
| `lib-undeclared` | error | The page imports a registry library its `libs` doesn't list |
| `manifest-missing`, `format-missing` | warning | A legacy clip |
| `render-missing` | warning | No `dionysus.clip(`, `dionysus.onFrame(` or `requestAnimationFrame(`: the clip won't animate |
| `render-legacy` | warning | Animates with requestAnimationFrame only |
| `lib-cdn` | warning | A CDN URL that is mapped to the pinned copy |
| `nondeterministic` | warning | Uses Date.now, performance.now, timers or Math.random |
| `no-canvas` | warning | No `<canvas>`: nothing would be captured |
| `binding-missing`, `binding-mismatch` | warning | The storyboard asset references media the manifest doesn't bind (or with another type) |
| `binding-unused` | warning | A declared binding the code never uses |
| `param-missing`, `param-mismatch` | warning | The storyboard asset declares a param the manifest doesn't (or with another type) (V2-HTML-PARAMS) |
| `param-unused` | warning | The manifest declares params but the code never reads `params` |

An AI reply is accepted as is: the app takes the largest ` ```html ` code block (or the whole text when it is a document).

## 6. Storyboards and AI prompts

In a storyboard ([STORYBOARD_FORMAT.md](STORYBOARD_FORMAT.md), RULE 23) an `"html"` asset's `prompt` is a **design brief**, and its `references` are the media it uses. *Copy prompt* on the asset copies the brief **combined with** the packaging instructions, filled in for that asset:

- the manifest to start from: `format`, `name`, `durationSec` (the longest shot or html layer that uses the asset), `width`/`height` from its `aspect` (16:9 → 1920×1080, 9:16 → 1080×1920, 1:1 → 1080×1080, 4:5 → 1080×1350, 21:9 → 2520×1080) and `bindings` named by the referenced asset ids (image, video or audio);
- where it plays (the shots that use it), the allowed libraries, the determinism and no-network rules;
- **(V2-HTML-PARAMS)** the asset's declared `params` (storyboard `assets[].params`) with their types and defaults, the values the shots and layers use (up to 6 examples), and the instruction to keep exactly these keys in the manifest, never hard-code the values, and read `ctx.params.<key>` in `render()` (RULE 24);
- a link to this document (the app's own site), or with *Copy full prompt* the contract and a template inlined;
- "Reply with ONE html code block".

On the timeline a binding to a storyboard asset id uses that asset's selected version; selecting another version reloads the clip.

## 7. Template

A minimal complete clip (what *Copy full prompt* includes, with the asset's values). It has the in-app Code Editor's layout (one `<canvas id="c">`, the base style, one `<script type="module">`), so it opens there in the Script tab (§9):

<!-- template:start -->
```html
<!doctype html>
<html><head><script type="application/json" id="dionysus-clip">{
 "format": "dionysus.htmlclip/1",
 "name": "Template",
 "durationSec": 4,
 "width": 1920,
 "height": 1080,
 "background": "#000000"
}</script>
<meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}</style>
</head>
<body><canvas id="c"></canvas>
<script type="module">
let g = null;
dionysus.clip({
  async init(ctx) {
    ctx.canvas.width = ctx.width; ctx.canvas.height = ctx.height;
    g = ctx.canvas.getContext("2d");
  },
  render(t, ctx) {
    const { width: w, height: h, progress } = ctx;
    g.fillStyle = "#000000";
    g.fillRect(0, 0, w, h);
    const r = Math.min(w, h) * (0.1 + 0.2 * progress);
    g.fillStyle = "#5ad1c8";
    g.beginPath(); g.arc(w / 2 + Math.cos(t * 2) * w * 0.25, h / 2, r, 0, Math.PI * 2); g.fill();
  },
});
</script></body></html>
```
<!-- template:end -->

## 8. Example

A neutral title card with a bound logo, an editable accent colour and an editable title, on a transparent background (for an html layer over a shot):

```html
<!doctype html>
<html><head><script type="application/json" id="dionysus-clip">{
 "format": "dionysus.htmlclip/1",
 "name": "First Light title",
 "description": "Title rises with a soft sunrise glow; the logo fades in at the end.",
 "durationSec": 5,
 "width": 1920,
 "height": 1080,
 "aspect": "16:9",
 "background": "transparent",
 "libs": [],
 "bindings": { "logo": { "type": "image", "asset": "logo", "label": "Logo" } },
 "params": {
  "title": { "type": "text", "default": "First Light", "label": "Title" },
  "accent": { "type": "color", "default": "#ffb347", "label": "Accent" },
  "glow": { "type": "number", "default": 0.6, "min": 0, "max": 1, "step": 0.05, "label": "Glow" }
 }
}</script>
<meta charset="utf-8">
<style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}</style>
</head>
<body><canvas id="c"></canvas>
<script type="module">
let g = null, logo = null;
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
dionysus.clip({
  async init(ctx) {
    ctx.canvas.width = ctx.width; ctx.canvas.height = ctx.height;
    g = ctx.canvas.getContext("2d");
    logo = await ctx.image("logo"); // null until a logo is bound
  },
  render(t, ctx) {
    const { width: w, height: h, params: p } = ctx;
    const a = ease(t / 1.5), out = ease((ctx.duration - t) / 0.5);
    g.clearRect(0, 0, w, h);
    const glow = g.createRadialGradient(w / 2, h * 0.62, 0, w / 2, h * 0.62, w * 0.5);
    glow.addColorStop(0, p.accent + Math.round(255 * p.glow * a * out).toString(16).padStart(2, "0"));
    glow.addColorStop(1, p.accent + "00");
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    g.globalAlpha = a * out;
    g.fillStyle = "#ffffff";
    g.font = `600 ${Math.round(h * 0.11)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(p.title, w / 2, h * (0.55 - 0.05 * a));
    const la = ease((t - 2.5) / 1) * out;
    if (la > 0) {
      g.globalAlpha = la;
      if (logo) { const s = h * 0.12 / logo.height; g.drawImage(logo, w / 2 - logo.width * s / 2, h * 0.7, logo.width * s, logo.height * s); }
      else { g.strokeStyle = "#ffffff"; g.strokeRect(w / 2 - h * 0.06, h * 0.7, h * 0.12, h * 0.12); }
    }
    g.globalAlpha = 1;
  },
});
</script></body></html>
```

## 9. Decisions and open questions

- **The in-app Code Editor is JS-first** (V2-CODE-EDITOR). Only the canvas is captured, so the editor treats a clip as a script plus data, not as a web page: **Script** (the `<script type="module">` with `dionysus.clip({ init, render })`; the page's canvas is provided), **Params** (add, edit, reorder and remove the manifest's `params`, validated, with the `ctx.params.<key>` to use), **Files** (fonts and images embedded as data: URLs; fonts get generated `@font-face` rules), **Settings** (name, duration, size/aspect, background or transparent, libraries) and **Advanced** (extra CSS and markup, rarely needed). It still stores the one-file package above, unchanged: it writes the template's page — doctype, manifest, `<style>` with the base CSS (`html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}`), the generated font rules between `/* dionysus:fonts */` and `/* /dionysus:fonts */`, then any extra CSS; `<body><canvas id="c"></canvas>`, any extra markup, and one `<script type="module">` — and reads back files of that shape. Any other page (several scripts, its own page CSS, no canvas: e.g. older or hand-written clips) opens in **Advanced** as full HTML, with a note, and keeps working; params, files and settings are still edited in their tabs. HTML and CSS are only for fonts and those legacy clips. *Load sample* offers *Canvas animation* and *Three.js*; the live preview runs the clip in the same sandbox with the params' defaults, with play and scrub, and shows syntax, runtime and package problems inline. Saving makes a new version (one undo step).
- **Canvas capture only.** The editor captures the first `<canvas>`; DOM/CSS animation is not rasterised (a sandboxed page can't be screenshotted without a renderer of our own). Pages draw text and images on the canvas.
- **Param defaults are per version; values are per use** (V2-HTML-PARAMS): the manifest declares the params and their defaults (editing them saves a new version), and each timeline clip stores only its overrides. Keyframing param values over time is future work.
- **Text is a param**, not a binding; bindings are media (image, video, audio) only. Audio bindings give the clip a URL (e.g. to draw a waveform); the clip's sound is never played — put audio on the timeline.
- **One script file in the ZIP.** `script.js` is inlined as one script; extra JavaScript modules imported by relative path are not resolved (embed small helpers in `script.js`).
- **Validation is static** (pattern checks on the source). It catches the common mistakes; it can't prove a page is deterministic.

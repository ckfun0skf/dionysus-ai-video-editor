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
| `inputs` | object | Live signals the clip reads as `ctx.inputs[name]` (§3.3): name → `{ "type": "graphic" \| "audio" \| "tracker", "label"?, "description"? }` (P43; the older `"scene"`, `"beat"`, `"track"` mean the same). |
| `role` | string | `"clip"` (default), `"effect"` or `"transition"` (§3.2). Where a package is used must match its role. |
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
- `ctx` = `{ canvas, t, duration, progress, width, height, params, bindings, asset(name), image(name), video(name), seek(video, sec) }`: `duration` is the clip's length on the timeline in seconds (it can differ from the manifest's `durationSec`), `progress` = t / duration (0–1), `canvas` the page's first `<canvas>` (the captured picture), `width`/`height` the frame size in pixels, `params` the parameter values (each declared param's default, overridden by the values set where the clip is used: a timeline clip, a storyboard shot or layer; read them in `render`, they can change between frames while the user edits), `bindings[name]` = `{ type, url }` for each bound asset (`url` is null when nothing is bound yet: draw a placeholder), `asset(name)` the URL of an embedded file, `image(name)` a Promise of a loaded HTMLImageElement for a binding or file, `video(name)` a Promise of a muted HTMLVideoElement, `seek(video, sec)` a Promise that resolves when that video shows `sec`. Effects (manifest `"role": "effect"`) also get `source`, the picture under the effect clip this frame; transitions (`"role": "transition"`) get `from` (outgoing clip), `to` (incoming clip) and `progress` 0–1 across the cut. They are ImageBitmaps to draw (`g.drawImage(ctx.source, 0, 0, w, h)`); draw the full frame. `inputs[name]` holds live signals for each manifest input (numbers only, no audio samples or pixels): an `"audio"` reference is `{ rms, peak, bands, onset, envelope }` (0–1; `bands` = 8 bands, low to high), a `"graphic"` reference `{ luma, avgColor: [r, g, b], motion, histogram }` (0–1; `histogram` = 16 luma bins), a `"tracker"` reference the box of a tracker set in the app `{ x, y, width, height, scale, rotation, found }` (x/y = box centre and width/height = box size, all 0–1 of the frame; scale vs the first box; rotation in degrees; `found` is false while no tracker is picked or set yet, outside its range, or where the feature is lost or the match is weak; the older names "beat", "scene" and "track" still work); read them in `render` and draw something sensible when they are 0.
- The picture is the page's FIRST `<canvas>`: size it to ctx.width × ctx.height in `init` and draw everything on it (2D or WebGL; for WebGL use `preserveDrawingBuffer: true`). Other DOM and CSS are not captured.
- Deterministic: every frame is a pure function of t, ctx.params and the bound assets. Frames are requested in any order (scrubbing, export), and the same t must give the same picture. Don't keep animation state between frames, don't use Date.now(), performance.now(), requestAnimationFrame, setTimeout or setInterval for timing, and use a seeded random generator (fixed seed) instead of Math.random().
- No network: the clip runs in a sandbox with a strict Content-Security-Policy. Only the allowed libraries (listed in the manifest's `libs`, imported by their bare specifier in a `<script type="module">`, e.g. `import * as LIB from "<specifier>"`) are loaded. Embed any other file as a data: URL in the manifest's `files` and refer to it by name (`ctx.asset(name)`, `fetch(name)`, or a loader that fetches a Request for that name — the runtime resolves it even if the page's base URL rewrote the path). Use system font stacks, or an embedded font with @font-face (the runtime waits for fonts and in-flight attached-file fetches before capturing a frame).
- Transparency: with `"background": "transparent"`, clear the canvas to transparent (2D: clearRect; WebGL: `alpha: true` and a clear colour with alpha 0); the clip is composited over the layers below. Otherwise paint the background colour every frame.
<!-- contract:end -->

**Embedded files** resolve by name everywhere: `src`, `href`, `poster` and `data` attributes, `fetch()` and `XMLHttpRequest` (including when a loader such as three.js `FileLoader` passes a `Request` instead of a string — the name is read from `Request.url`), and CSS `url()`. `ctx.asset(name)` returns the `blob:` URL. Bound assets resolve the same way by binding name.

**Host protocol** (for reference; pages only use `dionysus.clip`):

```
iframe → editor  { type: "dionysus:ready" }                                       page loaded
editor → iframe  { type: "dionysus:init", width, height, duration?, bindings: { name: { type, blob } }, params? }
editor → iframe  { type: "dionysus:params", params }                              new param values (V2-HTML-PARAMS); no reload
editor → iframe  { type: "dionysus:frame", seq, t, duration?, source?, from?, to?, progress?, inputs? }  draw frame t (P38 pictures for effects/transitions)
iframe → editor  { type: "dionysus:frame", seq, bmp }                             ImageBitmap of the first <canvas>
iframe → editor  { type: "dionysus:asset-error", messages: string[] }             an embedded file failed to decode or load
```

`init`, `document.fonts.ready`, and in-flight attached-file fetches are awaited before a frame is captured (so export does not snapshot a fallback while a model is still loading). A frame that takes more than 4 s in export is reported and the previous frame is kept. If an attached file cannot be decoded or loaded, export shows the `dionysus:asset-error` messages in the export dialog instead of failing silently. The storyboard preview and the Code Editor preview (including when opened from a timeline clip) send `dionysus:init` / `dionysus:params` with the use's values (defaults ⊕ the shot's, layer's or clip's overrides) and update live when those values change, without reloading the page. Bindings stay null in that isolated preview (they are resolved on the timeline). Mix (off by default) composites the clip's frame over the clips underneath at the same time, using the same opacity and blend as preview and export; off shows the clip alone.

### 3.2 Effects and transitions (P38)

A package's manifest `role` says how it is used:

- **`"clip"`** (default): a clip on a video track (main or overlay).
- **`"effect"`**: an effect clip on the Effects layer runs it (Effects → **Custom (code)**). Each frame `ctx.source` is the picture under it: the main track (Apply to **Main**) or the finished frame (**All**). Draw the changed picture on the full canvas. Its `params` are edited like any effect's.
- **`"transition"`**: a cut runs it (Transitions → **Custom (code)**). Each frame `ctx.from` is the outgoing clip's picture, `ctx.to` the incoming clip's and `ctx.progress` goes 0 → 1 across the transition. At 0 show only `from`, at 1 only `to`.

Using a package in the wrong place is an error (`role-mismatch`): an effect or transition can't be added to a track, and a clip can't be picked as an effect or transition. An effect that never reads `ctx.source`, or a transition that doesn't read both `ctx.from` and `ctx.to`, gets a warning. These pictures run through the sandbox every frame, so preview may lag a frame and export is slower. Clips get only these pictures; there is no pixel-reading API.

### 3.3 References: graphic, audio and tracker (P38–P43)

A clip can react to the edit around it through **three reference types**. Declare them in the manifest (`inputs`), e.g. `"inputs": { "under": { "type": "graphic" }, "music": { "type": "audio", "label": "Music" }, "target": { "type": "tracker", "label": "Follow" } }` — or in the code editor's **Params** tab with **+ Graphic**, **+ Audio** and **+ Tracker** under *References* — and read `ctx.inputs.<name>` in `render`. The clip gets **numbers only**, computed by the editor (no raw audio, pixel or frame API). The P38/P39 names `"scene"`, `"beat"` and `"track"` are still accepted and mean graphic, audio and tracker.

| Type | `ctx.inputs[name]` | Picker (per use: Params → Inputs) | Default |
|---|---|---|---|
| **graphic** | `{ luma, avgColor: [r, g, b], motion, histogram }` (16 luma bins, from a small thumbnail) | **Program**, the main and overlay video tracks and their clips | Program (the picture under the clip) |
| **audio** | `{ rms, peak, bands, onset, envelope }` (8 bands, sub-bass to air; analysed once at 60 values/s, so preview and export match) | **Mix**, tracks with sound (audio tracks, video tracks) and their audio / video clips | Mix (everything you hear) |
| **tracker** | `{ x, y, width, height, scale, rotation, found }` (0–1 of the frame; x/y = box centre; scale vs the first box) | every tracker on a main or overlay clip (Tracks lane), shown as "clip · tracker name" | None (`found: false`) |

Each picker lists only valid targets. Tracks can be renamed there (or by double-clicking a layer name on desktop); bindings store ids (`track:<id>`, `clip:<id>`, `clip:<id>#<trackId>`), so a rename never breaks them. A layer drawn above the clip is read from its previous frame.

**Tracker** (P39/P40): the box of one tracker of a video clip (**Track** in the bottom bar, or `track_clip`), solved by the editor's host-side region tracker; `scale` follows the box as the feature grows or shrinks. `found` is false — with no position — while nothing is picked, outside the tracker's range, where the feature is lost (left the picture) or the match is weak, and while a tracker named by a storyboard (`clip:<clipId>#@<name>`, RULE 69) has not been set yet; it binds automatically once the user creates a tracker with that name. Example: `if (ctx.inputs.target.found) g.strokeRect((ctx.inputs.target.x - ctx.inputs.target.width / 2) * w, …)`. The tracker is classic region/template matching, not AI subject segmentation: it works best on high-contrast, fairly persistent features.

### 3.1 Param values per use (V2-HTML-PARAMS)

`ctx.params` holds, for every param the manifest declares, the **use's value** when it has a valid one, else the manifest `default`:

- **Where values come from:** a timeline clip's own values (inspector → **Params**, saved on the clip as `htmlParams`, overrides only), which a storyboard shot's or html layer's `params` fill on Send to timeline. Preview, thumbnails and export all pass the same values. The storyboard version preview and the Code Editor preview pass them too, and redraw live when you edit them.
- **Resolution:** against the manifest of the version being played. A value is used when its type matches (numbers are clamped to `min`–`max`, a select value must be in `options`, a colour must be `#rrggbb`); anything else falls back to the default. Values for keys the manifest doesn't declare are kept on the clip but not passed (so swapping to a version that declares them again restores them).
- **Changes while playing:** when the values change, the editor sends `dionysus:params` and redraws the current frame; the page is not reloaded. Read `ctx.params` inside `render`, not only in `init`, and lay out for any value (long and short text).

**Legacy clips** (no manifest or no `format`) keep working: `dionysus.onFrame((t, ctx) => …)` is called every frame, and `requestAnimationFrame`, `performance.now()` and `Date.now()` are driven from t (Date starts at 2026-01-01T00:00:00Z), and `Math.random()` is seeded. Code that accumulates state between frames can still differ after a seek, which is why new clips use `dionysus.clip`.

## 4. Libraries

Only libraries from the app's registry can be loaded; each is self-hosted and pinned with Subresource Integrity, and the import map and CSP are generated from the clip's `libs`. The registry today:

| id | Library | Import |
|---|---|---|
| `three` | three.js 0.160.0 | `import * as THREE from "three"` |
| `three-gltf` | three.js GLTFLoader 0.160.0 (needs `three`) | `import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"` |

**3D models.** Embed a `.glb` (or a `.gltf` with its `.bin`, and `.hdr` environment maps) in `files` as a data: URL (`data:model/gltf-binary;base64,…` for `.glb`) and list `"libs": ["three", "three-gltf"]`. Load it in `init` with `const gltf = await new GLTFLoader().loadAsync(ctx.asset("model.glb"))`; files a `.gltf` refers to by name resolve to the embedded copies. Pose any animation from t (`mixer.setTime(t)`), never from a clock. In the Code editor, Files → **Add files** (or dropping them onto the Files tab or the editor) accepts fonts, images, `.glb`, `.gltf`, `.bin` and `.hdr`; files over 15 MB are added with a warning (they make the project and every export heavier). Tapping a file opens a preview: images (SVG rendered as `<img>`, not inline markup) fit to view with dimensions; video and audio use native controls; `.glb` / `.gltf` open an interactive 3D viewer (orbit, pinch or scroll zoom, reset, framed to the bounding box) and resolve a `.gltf`'s external buffers against the other attached files when present; text, JSON, JS, CSS and HTML show as read-only source; anything else lists the name, size and MIME type. The preview always shows the name, size and type, closes with the close button or Escape, and revokes object URLs when it closes.

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
| `role-mismatch` | error | The package's `role` doesn't match where it is used (§3.2) |
| `effect-source`, `transition-sides` | warning | An effect never reads `ctx.source`; a transition doesn't read `ctx.from` and `ctx.to` |
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

### 6.1 Code AI mode (P4B)

*Create code → AI mode* is a step-by-step wizard for clips made outside a storyboard. It asks what to make (free text), its role, the params to tweak later (name, type, default), the frame size and duration, whether three.js is needed (the only library), and optional reference media (for example a drone clip). It then builds the prompt from the same source as this document: the brief, the manifest to start from (with the declared params; `background: "transparent"` for overlays and titles), the runtime contract and template (§3, §7), the role guidance and, when a video is attached, the timing and analysis rules below. The user copies it to any AI, attaches the reference files, and imports the reply (a `.zip` or `.html`) in the wizard's last step, which validates it (§5), shows the problems, and opens it in the Code Editor, which saves it as a code asset on the timeline.

When a video is attached, the wizard adds a number param `videoOffset` (default 0). Example: an object-detection HUD that boxes people in drone footage. The AI runs a detector over the video itself and embeds per-frame boxes as `detections.json`; the clip interpolates them by `t + videoOffset` and draws boxes and labels on a transparent canvas.

<!-- aimode:start -->
Roles:

- **Full-frame scene** — Full-frame scene: the clip is the whole picture on the main track. Paint every pixel every frame (an opaque background) and give it depth and motion over the whole duration.
- **Overlay on a video** — Overlay on a video: the clip sits on an overlay track above video. Keep the background transparent (clear the canvas every frame) and draw only the graphics; leave the video visible.
- **Title or text** — Title or text: a title, lower third or text card. Keep text inside the safe area (5% inset), animate it in and out within the duration, size it from ctx.width/ctx.height, and make the text a param when it can change.
- **Data viz** — Data viz: an animated chart or diagram. Embed the data in the package (a param for small values, or a JSON file / JS constant), animate it from ctx.progress, and label axes and values legibly at the frame size.
- **Effect** — Effect: the package changes the picture under an effect clip. Set "role": "effect" in the manifest. Each frame ctx.source is that picture (an ImageBitmap of the main track, or the whole frame); draw it changed on the full canvas (an opaque result), using t and ctx.progress for motion. Never read pixels back with getImageData; use canvas compositing, filters or WebGL.
- **Transition** — Transition: the package draws a cut between two clips. Set "role": "transition" in the manifest. Each frame ctx.from is the outgoing clip's picture, ctx.to the incoming one (ImageBitmaps) and ctx.progress goes 0 → 1 over the transition; at 0 show only ctx.from, at 1 only ctx.to. Keep it short (durationSec about 0.5-2).

```text
REFERENCE VIDEO (timing and analysis)
- Timing: in Dionysus the clip is placed on an overlay track at the same start as the video clip, so the overlay's t = 0 is the video's first frame and t runs in seconds of video time. A number param "videoOffset" (seconds, default 0) is the video time at t = 0: look up your data at videoTime = t + ctx.params.videoOffset. Data outside the video's length draws nothing.
- Analysis: the clip runs with no network and no ML runtime, so do any analysis yourself now (for example run an object detector over the attached video, frame by frame) and embed the RESULTS as data in the package: a file such as "detections.json" (in the ZIP, or as a data: URL in the manifest's "files") loaded in init(), or a JS constant. Use { "fps": <fps you sampled at>, "width": <video width>, "height": <video height>, "frames": [ { "t": seconds, "items": [ { "label": "person", "score": 0-1, "box": [x, y, w, h] } ] } ] }, with boxes normalised to 0–1 of the video frame.
- Drawing: map normalised boxes to ctx.width × ctx.height, interpolate between the two nearest samples so playback at any frame rate is smooth, and draw only from the data, never from the live video pixels.
- If you can't open or analyse the video, say so, and still deliver the clip with a small, clearly marked sample data set in the same format so the user can replace it.
```

```text
REPLY FORMAT
- Reply with a downloadable package: a ZIP (`<name>.dionysus-html.zip`) containing `index.html` (the manifest in its <head>, or a `manifest.json` beside it), `script.js` (the module with dionysus.clip), an optional `style.css` and any data or image files the clip reads (by name, via ctx.asset(name)).
- If you can't create files, reply instead with ONE ```html code block containing the whole self-contained file (embedded files as data: URLs in the manifest's "files").
- The user imports the .zip or .html in Dionysus (Create code → AI mode → Import), which checks it against the package standard and opens it in the Code Editor.
```
<!-- aimode:end -->

### 6.2 Revise with AI (P44)

*Code Editor → Revise with AI* revises a clip that already exists. It works for a timeline clip and for an effect or transition package, because both open in the same Code Editor. The button is only in that editor: not on the timeline context menu, and not in the inspector or the storyboard. The wizard uses the same shell as §6.1 (step list, progress, Back / Next).

1. **Describe** — what should change. The wizard does not ask again for role, parameters, size, duration or three.js; those come from the current manifest.
2. **Mode** — how the current HTML reaches the external AI:
   - *Embed HTML in prompt* — the prompt contains the whole file. One *Copy prompt*.
   - *Attach HTML to AI* — the prompt names the file (`<clip name>.html`, the same name *Export .html* downloads, for example `Code clip` → `Code-clip.html`) and includes the package rules and the change request, not the HTML. The step offers *Export .html*, *Export .zip* and *Copy HTML*.
   Embed is selected when the package is at most 32,768 characters; Attach is selected when it is longer (embedded images and fonts). The user can switch.
3. **Prompt** — copy the prompt. Dionysus does not call an AI. Attach mode also downloads or copies the HTML to attach in the chat.
4. **Import** — choose or drop the `.zip` or `.html`, or paste the reply. Validation is §5. A missing or retyped param from the current manifest is a warning, and so is a missing binding. *Open in Code Editor* loads the result for preview. **Save** makes a new version (one undo). Closing the wizard without importing leaves the editor as it was.

The prompt is built from the same source as §6.1: the change request, the current manifest (name, role, duration, frame, background, libraries, params, inputs including the legacy names scene / beat / track, bindings), the runtime contract (§3) and the reply format in §6.1. It tells the AI to keep what works, to keep param keys unless the request adds, removes or changes one, and to reply with a complete package, not a diff.

<!-- revise:start -->
```text
REVISE
- Keep what already works. Change only what the change request asks for.
- Keep every param key, type and default unless the change request adds, removes or changes one. The timeline stores values by those keys.
- Keep bindings and inputs unless the change request changes them. Input types are graphic, audio and tracker; the legacy names scene, beat and track mean graphic, audio and tracker.
- Reply with a complete dionysus.htmlclip/1 package, not a diff, patch or snippet.
- The user imports the .zip or .html (or pastes the reply) in Dionysus (Code Editor → Revise with AI → Import), which checks it against the package standard and opens it in the Code Editor. Saving there makes a new version.
```
<!-- revise:end -->

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

- **The in-app Code Editor is JS-first** (V2-CODE-EDITOR). Only the canvas is captured, so the editor treats a clip as a script plus data, not as a web page: **Script** (the `<script type="module">` with `dionysus.clip({ init, render })`; the page's canvas is provided), **Params** (add, edit, reorder and remove the manifest's `params`, validated, with the `ctx.params.<key>` to use), **Files** (fonts, images and 3D models embedded as data: URLs; fonts get generated `@font-face` rules; tap a file to preview it), **Settings** (name, duration, size/aspect, background or transparent, libraries) and **Advanced** (extra CSS and markup, rarely needed). It still stores the one-file package above, unchanged: it writes the template's page — doctype, manifest, `<style>` with the base CSS (`html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}`), the generated font rules between `/* dionysus:fonts */` and `/* /dionysus:fonts */`, then any extra CSS; `<body><canvas id="c"></canvas>`, any extra markup, and one `<script type="module">` — and reads back files of that shape. Any other page (several scripts, its own page CSS, no canvas: e.g. older or hand-written clips) opens in **Advanced** as full HTML, with a note, and keeps working; params, files and settings are still edited in their tabs. HTML and CSS are only for fonts and those legacy clips. *Load sample* offers *Canvas animation* and *Three.js*; the live preview runs the clip in the same sandbox with the use's param values (the draft defaults, or the timeline clip's / shot's overrides when opened from there), with play, scrub and a Mix toggle that composites it over the clips underneath, and shows syntax, runtime and package problems inline. Saving makes a new version (one undo step). *Revise with AI* (§6.2) is in the header when editing an existing clip.
- **Canvas capture only.** The editor captures the first `<canvas>`; DOM/CSS animation is not rasterised (a sandboxed page can't be screenshotted without a renderer of our own). Pages draw text and images on the canvas.
- **Param defaults are per version; values are per use** (V2-HTML-PARAMS): the manifest declares the params and their defaults (editing them saves a new version), and each timeline clip stores only its overrides. Keyframing param values over time is future work.
- **Text is a param**, not a binding; bindings are media (image, video, audio) only. Audio bindings give the clip a URL (e.g. to draw a waveform); the clip's sound is never played — put audio on the timeline.
- **One script file in the ZIP.** `script.js` is inlined as one script; extra JavaScript modules imported by relative path are not resolved (embed small helpers in `script.js`).
- **Validation is static** (pattern checks on the source). It catches the common mistakes; it can't prove a page is deterministic.

# Clip type plugins: package format and author guide

**Format:** `dionysus.cliptype/1`, host API **1**. **Status:** the format and its validator are done (P83); a project
stores, carries and loads its plugin packages since P84 (their clips show by name with "Not enabled"); since P85 an
enabled plugin draws in the sandbox described in §3, in preview and export; since P86 users install plugins and allow
them per project with the screens in §4, and since P87 they edit a clip's settings with your `editor` form and
switch a project to another version of your plugin (§6) (see
[CLIP_PLUGIN_ARCHITECTURE.md §7 Phase 3](CLIP_PLUGIN_ARCHITECTURE.md#phase-3--third-party-clip-types) for the steps).
Design and decisions: [CLIP_PLUGIN_ARCHITECTURE.md](CLIP_PLUGIN_ARCHITECTURE.md) §0, decisions 10–17.

A plugin adds a new **clip type** to Dionysus: a picture that a user (or an agent) places on a video track, sets up with
a few settings, and moves, trims, fades, masks and exports like any other clip. You write one function that draws
frame `t`; the editor does everything else.

What a v1 plugin **can** do: draw any picture from its settings and the clip time, with 2D canvas or WebGL (three.js is
available), using the fonts, images and data files in its package.

What it **can't** do, by design: use the network, read the user's projects, media or other clips, play sound, add
editor UI of its own (the settings form is declarative), or add agent tools or AI rules (agents use the host's plugin
tools with your params and read your structured description).

## 1. The package

A package is a folder:

```
x-acme-confetti/
  manifest.json      # this format
  render.js          # the render entry (any name, listed in "files")
  fonts/Bangers.woff2 # optional files the renderer reads
```

It reaches the editor in one of two ways:

- **A zip file** named `<anything>.dionysus-cliptype.zip`, with `manifest.json` at the root of the zip, or inside one
  top-level folder (zipping the package folder itself works; `__MACOSX` and `.DS_Store` entries are ignored).
- **A URL** to its `manifest.json` (https only). The editor fetches the manifest, then each listed file relative to
  it, without cookies or credentials, so the server must allow CORS (`Access-Control-Allow-Origin: *`). A URL ending in
  `.zip` is read as a zip. For development, `http://localhost` (and `127.0.0.1`) also work. The samples in this repo
  are served this way by the app itself, at `plugins/samples/<id>/manifest.json` under the app's address.

Limits: at most 64 files, 10 MB per file, 20 MB per package. Files not listed in `"files"` are ignored.

The editor stores the package **in the project** (so an exported project zip carries it and opens on another
device) and in the browser's **plugin library** (so it can be added to other projects). A project records each
plugin it uses as a lock: id, version and a content hash.

**Content hash** (used by the lock and by trust): `sha256-` followed by the lower-case hex SHA-256 of the canonical
package bytes: for `manifest.json` and then every listed file in code-point order of their paths, the UTF-8 path, a
zero byte, the byte length in decimal, a zero byte and the file's bytes. Any change to any file is a new hash.

## 2. manifest.json

```json
{
  "format": "dionysus.cliptype/1",
  "api": 1,
  "id": "x-acme-confetti",
  "name": "Confetti",
  "version": "1.0.0",
  "publisher": "Acme",
  "description": "Falling confetti over a transparent or coloured background.",
  "homepage": "https://example.com/confetti",
  "icon": "sparkles",
  "trackKind": "video",
  "caps": { "visual": true, "keyable": true },
  "durationSec": 5,
  "render": { "entry": "render.js", "libs": [] },
  "params": {
    "amount": { "type": "number", "default": 200, "min": 10, "max": 2000, "step": 10, "label": "Pieces" },
    "palette": { "type": "select", "default": "party", "options": ["party", "gold", "mono"], "label": "Colours" }
  },
  "editor": { "groups": [{ "label": "Confetti", "fields": ["amount", "palette"] }] },
  "agent": {
    "description": "Falling confetti, full frame. Use for celebrations and reveals.",
    "examples": [{ "description": "Gold confetti for an award.", "params": { "palette": "gold" } }]
  },
  "files": ["render.js"]
}
```

| Field | Required | Rules |
|---|---|---|
| `format` | yes | `"dionysus.cliptype/1"` |
| `api` | no | Host API the plugin needs (default 1). A higher number than the editor supports is refused with "Update Dionysus". |
| `id` | yes | Starts with `x-`, then `a–z`, `0–9` and `-`; at most 64 characters. Recommended: `x-<publisher>-<name>`. Stored in every clip forever: **never rename it**. Built-in ids never start with `x-`. |
| `name` | yes | Shown in the library, the timeline and the inspector; at most 60 characters. |
| `version` | yes | Semantic version (`1.2.0`, `2.0.0-beta.1`). Bump it for every release; see §6. |
| `publisher` | no | Your name; shown as **unverified** (there is no signing in v1). At most 60 characters. |
| `description` | no | One or two plain sentences for people; at most 300 characters. |
| `homepage` | no | An https URL, shown as a link in the plugin's details. |
| `icon` | no | A monochrome line icon drawn by the editor: `puzzle` (default), `sparkles`, `shapes`, `type`, `chart`, `waves`, `grid`, `box`, `star`, `sun`. |
| `trackKind` | no | `"video"` (the only value in v1). |
| `caps` | no | `visual` (always `true`) and `keyable` (chroma key offered, default `true`). `sound`, `sourceTime`, `asset`, `still`, `thumb` are errors: v1 plugins are visual, have no media time and read no project media. |
| `durationSec` | no | Length of a new clip, in seconds (default 5, at most 600). Users trim it freely. |
| `render.entry` | yes | Relative path of the render script (a `.js` file listed in `files`). |
| `render.libs` | no | Pinned libraries the editor provides, by id (see §3). Unknown ids are errors. |
| `params` | no | Settings, at most 32; exactly the shape of HTML clip params ([HTML_CLIP_PACKAGE.md](HTML_CLIP_PACKAGE.md)): `type` `number` / `color` / `text` / `boolean` / `select`, a valid `default`, optional `label`, `description`, `min`, `max`, `step`, `options`. Keys start with a letter. |
| `editor` | no | The settings form: `{ "groups": [{ "label", "fields": [<param keys>] }] }`, at most 12 groups, each param at most once. Params in no group are shown under **More**. Nothing else is allowed: the editor draws the controls (the same ones as for HTML clip params). |
| `agent` | no | Structured hints for AI agents: `description` (at most 500 characters) and up to 5 `examples` (`description` at most 200 characters, optional `params` checked against your declarations). `rules` and `tools` are errors. |
| `files` | yes | Every file in the package besides `manifest.json`: safe relative paths (letters, digits, `.`, `_`, `-`, `/` between folders; no `..`, no leading `/`). |

`storyboard`, `inputs` and `bindings` are errors in v1 (storyboard plugin shots and project media come later). Other
unknown fields are warnings and are ignored.

Validation reports every problem with its JSON path, for example `params.amount.default`,
`editor.groups[0].fields[1]` or `agent.examples[0].params.palette`. The validator is
`src/v2/domain/pluginManifest.ts` (`validatePluginManifest`, `parsePluginManifest`, `checkPluginFiles`).

## 3. The render script

The editor runs `render.entry` as a **classic script** (not a module) in a **sandboxed worker** and calls it once per
frame:

```js
dionysus.clip({
  async init(ctx) {            // optional, awaited once before the first frame (load fonts, build geometry)
    const font = new FontFace("Bangers", `url(${ctx.asset("fonts/Bangers.woff2")})`);
    self.fonts.add(await font.load());
  },
  render(t, ctx) {             // draw frame t on ctx.canvas; may return a promise
    const g = ctx.canvas.getContext("2d");
    g.clearRect(0, 0, ctx.width, ctx.height);
    // … draw from t and ctx.params only …
  },
});
```

`ctx` gives:

| | |
|---|---|
| `ctx.canvas` | An `OffscreenCanvas` of the output size. Use `getContext("2d")` or `getContext("webgl2")`. Transparent pixels show the tracks below. |
| `ctx.width`, `ctx.height` | Its size in pixels (the project frame size, or smaller in preview). Draw relative to it. |
| `t`, `ctx.t` | Clip-local time in seconds (after the host's speed, reverse and freeze mapping). |
| `ctx.duration`, `ctx.progress` | The clip's length in seconds and `t / duration` (0–1). |
| `ctx.params` | Your params: defaults with the clip's values on top (numbers already clamped to min–max). |
| `ctx.asset(name)` | A `blob:` URL for a file listed in `files` (or `null`). |
| `ctx.random()` | Same as `Math.random()`: seeded, see below. |

**Determinism is required.** Frame `t` must look the same every time it is drawn, in any order: preview plays, the
user scrubs back and forth, and export draws every frame, maybe on another day. So:

- Compute everything from `t` and `ctx.params`. Don't keep state that depends on which frames were drawn before (a
  particle system must be a function of `t`, e.g. by simulating from 0 with a fixed step, or by closed-form motion).
- `Math.random()` is seeded the same way on every load, and the seed is reset before `init` and before **every
  frame**, so frame `t` gets the same random numbers whatever was drawn before (build random tables in `init`, or draw
  them per frame in a fixed order). `Date.now()`, `performance.now()` and `requestAnimationFrame` follow the clip time,
  never the wall clock (`Date.now()` is 2026-01-01T00:00:00Z plus `t`). Don't use `setTimeout` / `setInterval` to
  animate.
- WebGL output is the same on one device; GPUs and drivers may differ by a few pixel values between devices.
- Fonts: bundle them and load them in `init`; system fonts differ between devices.

**Libraries:** `render.libs` lists pinned libraries from the editor's registry (the same list as HTML clips, e.g.
`three` for three.js 0.160.0). They are provided by the host, never fetched from a CDN: the host checks each file
against its pinned integrity hash and loads it into your worker before your entry, as a classic script. Module
libraries become the global **`THREE`** (`THREE.WebGLRenderer`, `THREE.Scene`, …); `three-gltf` adds
`THREE.GLTFLoader`. Write `const { Scene, PerspectiveCamera } = THREE;` instead of `import`.

**No network.** The worker runs with a content security policy that allows only `blob:` and `data:` URLs and the
pinned libraries: `fetch` of anything else, `WebSocket`, `EventSource` and `importScripts` of remote URLs fail. There is
no DOM, no `document`, no storage, no cookies, no `eval` / `new Function`, and no access to the editor. The worker
lives in an iframe with an opaque origin (`sandbox="allow-scripts"`), so it can't reach the editor's origin either.

**Time limits.** `init` has 15 seconds. Each frame has 4 seconds. Preview never waits: it shows the last frame your
clip drew until the next one arrives. A frame that throws counts as a failure; after two frame timeouts in a row (or a
failed `init`) the editor stops the worker and starts a new one; after three restarts the clip shows the slate
"Plugin “Name” stopped" until the project is opened again, and export draws those frames black and names the clip,
the reason and the frame count in its warnings. Keep frames fast: preview wants about 30 per second.

## 4. What users see

- **Installing:** **Add plugin** (in the desktop left rail's **Plugins** tab, the phone's Add media → **Plugins**, or
  **Project → Plugins**) → **From a file** (pick the zip) or **From a web address** (paste the manifest URL; the
  server must allow cross-origin downloads). The install dialog shows the name, the unverified publisher, version, size, a short content hash, where it
  came from, the libraries it uses and its settings, and says what it can't do: "It draws frames from its settings. It
  can't use the network or read your projects, files or accounts." **Install** keeps it on this device, adds it to the
  open project and allows it there (one undo step). Its tile then adds clips: click or tap adds one at the playhead,
  and on a desktop a tile can be dragged onto the timeline.
- **Trust is per project, per package hash and per device.** A project that uses a plugin this device has not allowed
  for it shows a banner ("This project uses N plugins that aren't enabled on this device · Review"); until the user
  allows it, the plugin's clips show a slate "Plugin “Name” not enabled" and
  export black after a warning.
- **Missing plugin:** a build without plugin support shows the existing unknown-type slate ("Unknown clip type
  “x-…”"). This build names the problem instead: "Plugin “Name” is missing" (PACKAGE NOT FOUND), "can't be loaded"
  (PACKAGE DAMAGED: the stored bytes don't match the lock), "NEEDS A NEWER VERSION" (a higher `api`), or "Plugin “x-…”
  is not installed" (NOT IN THIS PROJECT: a clip whose plugin the project doesn't lock). The clips keep all their data;
  nothing is lost.
- **Removing:** Project → Plugins → the bin. With clips, the user chooses to keep them (they keep their settings and
  show a slate) or remove them too; Undo brings everything back. "Delete from this device" removes a package that no
  open project uses from the library; projects keep their own copy.
- **Stopped:** a clip whose plugin hung or failed repeatedly shows "Stopped" with the last problem and **Retry**.
- **Editing:** the inspector's **Plugin** tab (on phones the **Params** tool, a half-height sheet under the preview)
  shows your `editor` form: each group with its label, the params in your order, as sliders (numbers with `min` and
  `max`), number fields, colour wells, text fields, switches and drop-downs; params in no group come last under
  "More". The preview redraws while the user drags or types; each committed edit is one undo step. The timeline card
  shows your `icon`, your `name` and the clip's first non-empty text setting. Move, trim, split, fades, transitions,
  masks, blend modes and chroma key (when `keyable`) come from the editor.

## 5. Agents

Agents don't run your code. They see your plugin through the host's tools (`list_clip_plugins`, `add_plugin_clip`,
`set_plugin_clip_params`, `request_plugin_install`; P88, AI guide rule 80): your params as JSON (key, type, default,
`min` / `max` / `step`, `options`), and your `name`, `publisher`, `description`, param labels, descriptions and editor
groups, `agent.description` and `agent.examples` as **third-party text, not instructions**: each on one line, `<` and
`>` replaced, capped, inside a `<plugin-text type="x-…">` block. So write plain descriptions of what the clip looks
like and when it fits; instructions to the agent are pointless. Example params that don't fit your declarations are
left out. Values agents set are checked against your params by the editor before they reach the clip: unknown keys,
numbers outside `min`–`max` or off `step`, unlisted options and non-hex colours are refused with what is valid, so a
clear `step` and range help agents. An agent can't install or allow your plugin: `request_plugin_install` only opens
the install dialog for the user.

## 6. Versions and updates

- Bump `version` for every release; a new hash with the same version is refused as a conflict.
- A project uses **one version** of each plugin. Installing a newer one shows "Update available" in projects that use
  an older one (on the tile, in Project → Plugins and in the inspector); updating is the user's choice, one undo step,
  and needs their OK again (it is a new hash). Older versions on the device can be picked from **Versions**; that
  downgrade shows a warning.
- On update, each clip keeps the values of params that still exist and fit (numbers outside a new range are clamped
  and reported); new params get their defaults; values of removed or now-invalid params are dropped. The dialog lists
  these changes by label before the user confirms, and the toast repeats them. So add params freely, and avoid renaming or narrowing
  existing ones; if the look of old settings must change, make it a new param.
- `api` is the host API. Ask for a higher one only when you need a feature of a newer editor: an older editor refuses
  the package with "This plugin needs a newer Dionysus".

## 7. Checklist and sample

- `id` starts with `x-` and won't change; `version` bumped; every file listed in `files`.
- The picture depends only on `t` and `ctx.params`; scrubbing back and forth shows the same frames.
- Works at small sizes (phone preview) and at the full frame size; text stays inside the frame.
- Settings have labels; numbers have `min`, `max` and `step`; the `editor` form groups them.
- `agent.description` says what it looks like and when to use it; examples use real param values.

A complete sample is in [`public/plugins/samples/x-dionysus-stripes/`](../../public/plugins/samples/x-dionysus-stripes/)
(`manifest.json` and `render.js`: sliding stripes with an optional title band, 2D canvas). Its manifest is checked by
`src/v2/domain/pluginManifest.test.ts`, which also loads `render.js` the way the editor will and checks that it draws
the same frame for the same `t`. A three.js sample is in
[`public/plugins/samples/x-dionysus-orbit/`](../../public/plugins/samples/x-dionysus-orbit/) ("3D knot": a lit torus
knot with orbiting dots, `libs: ["three"]`, WebGL, a seeded dot table built in `init`).

**Trying your plugin.** Zip `manifest.json` and your files (at the root or in one folder) as
`your-id.dionysus-cliptype.zip` and use **Add plugin → From a file**, or serve the folder over https with CORS and use
**From a web address**. In a development build (`npm run dev`) the browser console also has `__dionysusDev.trustPlugin("x-…")`, which allows a plugin that the open project already uses,
for that project on this device, and `__dionysusDev.untrustPlugin("x-…")`. The hook does not exist in production
builds.

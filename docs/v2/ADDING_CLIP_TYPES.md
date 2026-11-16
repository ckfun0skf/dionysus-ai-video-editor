# Adding a clip type

A **clip type** is what a timeline clip *is*: video, image, audio, text, html, effect, blank, scene. Each type lives in one
folder, `src/v2/clipTypes/<id>/`, with up to three files. The editor finds them with `import.meta.glob`; there is no
list to edit for the registry, the renderer table or the UI table. Design and decisions:
[`CLIP_PLUGIN_ARCHITECTURE.md`](CLIP_PLUGIN_ARCHITECTURE.md) (Phase 1, done in P65–P73). A real type built this way:
`clipTypes/scene/` (P74, Phase 2), with its data format in [`SCENE_FORMAT.md`](SCENE_FORMAT.md).

| File | Layer | What it is | Who reads it |
|---|---|---|---|
| `core.ts` | core (pure data, no DOM; `domain` only through `import type`) | id, track kind, capabilities, optional storyboard mapping, file import, agent surface | `clipTypes/index.ts`: `CLIP_TYPES`, `clipTypeOf(p)`, the domain predicates, export audio plan, Send / Update / Sync, file import, WebMCP |
| `render.ts` | render | how the clip draws in preview **and** export (one code path) | `render/clipRenderers.ts`: `clipRendererFor(p)`, called by the Player |
| `ui.tsx` | ui | timeline look, thumbnails, inspector tabs, mobile toolbar, menus (declarative ids of host panels) | `ui/clipTypeUi.tsx`: `clipUi(p)`, `assetUi(kind)` |

`render.ts` is needed for anything drawn on the canvas; `ui.tsx` is optional (missing fields take `DEFAULT_CLIP_UI`,
a plain media clip named after its asset).

## What the host does for you

You do **not** write any of this per type:

- **Placeholder** (decision 9, P73). Any clip can be a placeholder (`placement.placeholder = { label }`): a storyboard
  slot with no clip yet. The host checks it **before** your type: `clipTypeOf(p)` returns the placeholder state core,
  the Player draws the shared slate (black in export), the timeline shows the hatched "Not generated" card, export
  warns and leaves it out of the length, and Fill offers assets of your type (`placeholderAccepts`). Your renderer and
  UI never see a placeholder.
- **Unknown types** (§6). An older build that does not have your type still opens the project: the clip keeps every
  field, sits on any track, draws a slate "Unknown clip type “<id>”", exports black and silent after a warning, and
  `get_timeline` marks it `unknown: true`. So never rename or remove a shipped id.
- Layer order, transitions, effects and their scopes, blend modes, masks, crop, the clip box and hit tests, hidden
  tracks, undo, save and load, copy and paste, move, trim, split, ripple.

## Step by step

1. **Pick the id.** Lower case, `^[a-z][a-z0-9-]*$`, the folder name, stored in `Placement.clipType` forever. Built-in
   ids are also added to the `MediaKind` union in `src/v2/domain/model.ts` (Phase 2 adds a branded `PluginClipType`
   for others, decision 3).
2. **Write `core.ts`** with `defineClipType({ … })`: `description` (one plain line), `trackKind` (`video`, `audio`,
   `text` or `effect`) and `caps`. The caps are what the rest of the editor asks:

   | Cap | Means | Built-ins with `true` |
   |---|---|---|
   | `sourceTime` | has media time: trim / slip / speed / reverse / in-out frames | video, audio |
   | `still` | one source frame: source in stays 0 on trim and split | image, text, effect, blank |
   | `sound` | volume, volume keys, audio FX, mixed in export (a new type without it gets no `volume` when added, P75) | video, audio |
   | `visual` | drawn on the canvas | video, image, html, text, blank |
   | `keyable` | chroma key applies | video, image, html, blank |
   | `thumb` | needs a thumbnail on the timeline | video, image, html |
   | `asset` | `"media"` reads a project asset version; `"none"` carries its own data | — |

   Optional: `accepts` (which imported files become assets of this kind), `story` (storyboard slot and Send / Sync
   rules, default `DEFAULT_CLIP_STORY`; since P79 `story.shotRender` names a storyboard shot render the type plays,
   which makes it the placeholder type for such shots and lets Sync turn its main-track clips into such shots, as
   the scene type does for `render: "scene"`), `agent` (WebMCP tools with `run`, AI guide rules, extra `get_timeline`
   fields, and which built-in tools / `set_clip_props` keys only fit this type). Bump `version` when the look or
   behaviour of existing data changes.
3. **Write `render.ts`**, default-exporting a `ClipRenderer` with `id` and exactly one of:
   - `draw(host)` — stateless, called for each frame with a canvas (text, blank). Use `host.setBox`, `host.paint`
     (scene capture, overlay-scope effects, blend) and `host.blit` (mask and crop) so host features keep working.
   - `frame(host)` — stateful, called every frame for a clip with an asset version even without a canvas (video,
     image, html, audio, scene: elements and iframes live in the Player's pools behind `host.media`). A type that
     renders a page in the sandboxed HTML clip host gets its own host method there, as `scene` does with
     `host.media.sceneHost` / `sceneDoc` (the Player owns the iframe's lifetime and export waits for it).

   Branch on `host.offline` only where export is meant to look different.
4. **Write `ui.tsx`** (optional), default-exporting a `ClipTypeUi`: timeline `name`, `icon`, `kindClass`, `body`,
   `background`, `waveform`, `filmstrip`, thumbnails (`assetThumb`, `assetPreviews`), inspector `inspectorIcon`,
   `inspectorTitle`, `inspectorTabs` (ids of host panels: `basic`, `speed`, `audio`, `chroma`, `transition`, `text`,
   `effect`, `params`, `colour`), `inspectorActions`, mobile `toolbar` / `toolbarMain`, and flags (`speed`, `volume`,
   `timeTools`, `inOutFrames`, `linkedAudio`, `editor`, `extraTools`). A new panel is a host change in `V2App.tsx`
   (`tabsById`), named by id here.
5. **Give users a way to make one.** The registry does not create clips. Add a command in `src/v2/engine/commands.ts`
   (see `addBlankClip`: build the `Placement`, insert it with `ops.insertPlacement`), then a button or menu entry, and
   an agent tool if the AI should add it (`core.agent.tools` + `run`, which uses `api.edit(label, apply)` for one undo
   step, and `api.blobs` to read or store media). A `run` that needs the domain at runtime lives in `<id>/agent.ts` and
   is loaded with `import("./agent")` (see `scene/`, P78). For a type that reads assets, `accepts` makes imports and the asset picker work.
6. **Update the lists that pin the built-ins** (they fail with a clear diff): `BUILT_INS` in
   `clipTypes/clipTypes.test.ts`, the fixture in `clipTypes/parity.test.ts` (one clip per registered type), the ids in
   `render/clipRenderers.test.ts` and `ui/clipTypeUi.test.tsx`, and the "covers every clip type" test of
   `render/renderParity.test.ts`. Add a clip of the type to `src/v2/__fixtures__/renderParity.ts` and
   `timelineParity.ts` and re-record those goldens on purpose (`UPDATE_RENDER_GOLDEN=1`, `UPDATE_TIMELINE_GOLDEN=1`,
   `UPDATE_INSPECTOR_GOLDEN=1`); the diff must show only the new clip. If the new clip cannot be drawn in jsdom
   (WebGL, as for `scene`), leave those fixtures and goldens unchanged and cover the type with its own tests plus a
   Chrome check in the PR (P74).
7. **Check:** `npx tsc -b --noEmit`, `npx vitest run`, `npm run build`, and `npm run gen:ai`. `gen:ai` changes only if
   you added agent tools or rules (then commit the regenerated `public/ai/*`, `public/llms.txt`,
   `docs/v2/WEB_MCP.md`). Look at the clip in the app at 390 and 1440 wide: timeline, inspector, preview and an export.
8. **Document it:** a line in `src/v2/clipTypes/README.md`, and the user-facing behaviour where it belongs
   (`STORYBOARD_FORMAT.md` for storyboard rules, the AI guide through `core.agent.rules`).

## Worked example: colour bars

A test card of seven vertical stripes. It has no media and no data of its own, sits on video tracks, and is placed,
faded, masked and transitioned like a photo. This exact code is checked by `src/v2/ui/addingClipTypes.test.tsx`
(loaded through the real loaders, then resolved by `clipTypeOf`, `clipRendererFor` and `clipUi`).

`src/v2/domain/model.ts`: add the id to the union.

```ts
export type MediaKind = "video" | "image" | "audio" | "html" | "text" | "effect" | "bars";
```

`src/v2/clipTypes/bars/core.ts`:

```ts
import { defineClipType } from "../define";

/** Colour bars: no media, so no thumbnail, sound or source time; a still picture like a photo. */
export default defineClipType({
  id: "bars",
  description: "Colour bars: a test card of seven vertical stripes. No media; placed and faded like a photo.",
  trackKind: "video",
  caps: { sourceTime: false, still: true, sound: false, visual: true, keyable: true, thumb: false, asset: "none" },
});
```

`src/v2/clipTypes/bars/render.ts` (the shape of `blank/render.ts`: place the frame-sized picture, let the host
composite, mask and crop it):

```ts
import type { ClipRenderer } from "../../render/clipRenderers";
import { placeRect } from "../../render/frame";
import { drawWithLook } from "../../render/transitionDraw";

const STRIPES = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];

const bars: ClipRenderer = {
  id: "bars",
  draw(h) {
    const { width, height, placement } = h;
    const r = placeRect(placement, width, height, width, height, h.time);
    h.setBox(r);
    h.paint(placement.blend, (dc) => drawWithLook(dc, width, height, h.tfx, (g) => {
      g.save(); g.globalAlpha = r.alpha * (h.mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
      h.blit(g, width, height, r, (gg) => {
        const w = r.w / STRIPES.length;
        STRIPES.forEach((c, i) => { gg.fillStyle = c; gg.fillRect(-r.w / 2 + i * w, -r.h / 2, w + 0.5, r.h); });
      });
      g.restore();
    }));
  },
};
export default bars;
```

`src/v2/clipTypes/bars/ui.tsx`:

```tsx
import type { ClipTypeUi } from "../../ui/clipTypeUi";

/** Named "Colour bars" (it has no asset), no thumbnail or waveform; the photo inspector without speed or volume. */
const bars: ClipTypeUi = {
  id: "bars",
  name: () => "Colour bars",
  kindClass: "is-bars",
  thumbBackground: false,
  waveform: () => undefined,
  assetThumb: "none",
  assetPreviews: { peaks: false, filmstrip: false },
  inspectorIcon: "image",
  inspectorTitle: () => "Colour bars",
  inspectorTabs: ["basic", "chroma", "transition"],
  speed: false,
  volume: false,
};
export default bars;
```

Plus a style for `.v2-clip.is-bars` in `src/v2/ui/v2.css` if the timeline card should look different.

`src/v2/engine/commands.ts`, so a button or tool can add one:

```ts
export const addColourBars = (at: number, durationTicks = BLANK_TICKS, id = newId("plc")): Command => ({
  label: "Add colour bars",
  apply: (p) => withRoot(p, (c) => {
    const main = ops.mainTrack(c);
    if (!main) throw new Error("no main track");
    const pl: Placement = { id, startTicks: Math.max(0, Math.round(at)), durationTicks, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "bars" };
    return ops.insertPlacement(c, main.id, pl);
  }),
});
```

What you get without more code: `isStill`, `hasSound`, `canChromaKey` and the track check answer from the caps
(bars on an audio track is a validation error); the clip draws in preview and export, with transitions, masks and
blend; the timeline and inspector use the UI entry; a bars **placeholder** (`clipType: "bars"` + `placeholder`) draws
the host slate and has no Fill (bars reads no assets); and an older build shows it as an unknown type instead of
failing to load the project.

Then step 6 (the pinned lists and goldens) and step 7 (checks).

## Rules

- Never rename or delete a shipped id; bump `version` for a behaviour change of existing data.
- Plugins never handle placeholders, and never draw outside `host.paint` / `host.blit` (scene capture, overlay
  effects, code transitions and masks depend on it).
- Keep `core.ts` pure (the architecture test fails on a value import from `domain`, DOM or React there).
- A new type is a change in behaviour: it needs its own `tasks.json` entry, tests, screenshots of any new UI, and
  goldens re-recorded only for the new clip.

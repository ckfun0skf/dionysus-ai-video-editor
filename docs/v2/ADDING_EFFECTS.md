# Adding effects, transitions and other presets (V2-FX-MOD)

Every preset is **one file**: `src/v2/presets/<kind>/<id>.ts` (or `<kind>/<id>/index.ts` when it needs helpers).
That file is all you write. It is discovered automatically (`import.meta.glob` in `src/v2/presets/index.ts`) and
appears everywhere with no other change:

| Where | How it gets there |
|---|---|
| Registry (`listPresets`, `getPreset`, `applyPreset`) | `loadPresetModules` → `BUILTIN_PRESETS` / `RENDERERS` / `HOOKS` |
| Pickers and live tiles (text, effects, transitions, stickers) | listed by kind and grouped by `category` |
| Inspector controls | generated from `params` (`ParamControls`: number → slider, color → picker, string → text) |
| Preview **and** export | the same `applyPreset` + `applyEffectFrame` / `drawWithLook` run in both |
| Storyboard importer | ids and params validated against the registry |
| AI guide, `presets.json`, `llms.txt` | generated from the descriptor (`description`, `params`, `ai`) by `npm run gen:ai` and the build |

## Quick start

```bash
npm run new:preset -- videoEffect film-burn   # writes src/v2/presets/videoEffect/film-burn.ts from a template
# fill in the TODOs (the loader rejects files that still contain TODO)
npm test                                     # validation, completeness and smoke-render tests cover it automatically
npm run gen:ai                               # refresh public/ai/* (CI fails if they are stale)
```

Kinds: `videoEffect`, `transition`, `textAnimIn`, `textAnimOut`, `textAnimLoop`, `effect` (text effect), `sticker`,
`textStyle`, plus `font`. Ids are unique **per kind** and must equal the file name. Never rename or delete a
shipped id: storyboards and saved projects reference it (a missing id renders as "no effect", it never crashes).

## The minimal effect (the real `videoEffect/glow.ts`, abridged)

```ts
import { defineVideoEffect } from "../define";
import { n } from "../_lib/math";

export default defineVideoEffect({
  id: "glow",
  name: "Glow",
  category: "Light",
  description: "Soft bloom: bright areas bleed a gentle halo of light; dreamy, warm or magical scenes.",
  params: [
    { key: "strength", label: "Strength", type: "number", min: 0, max: 1, step: 0.05, default: 0.6,
      description: "Opacity of the added light, 0 (off) to 1 (full)." },
  ],
  ai: { use: "dream sequences, memories, sunset light", avoid: "dark scenes with no highlights" },
  draw: ({ ctx, w, h, params, scratch }) => {
    const a = scratch(w / 8, h / 8);           // offscreen context, reused across frames
    if (!a) return;
    a.drawImage(ctx.canvas, 0, 0, w / 8, h / 8);  // shrink = cheap blur (no ctx.filter, iOS-safe)
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = n(params.strength, 0.6);
    ctx.drawImage(a.canvas, 0, 0, w, h);
  },
});
```

## Fields (all kinds)

| Field | Required | Notes |
|---|---|---|
| `id` | yes | `[a-z0-9-]`, equals the file name. |
| `name` | yes | Picker label. |
| `category` | yes | Picker tab and AI-guide group ("Basic", "Light", "Motion", "Slide", …). Reuse existing ones where they fit. |
| `description` | yes | One plain line: what it looks like **and when to use it**. Planner AIs read this. |
| `params` | no | `ParamSpec[]`. Each needs `key`, `label`, `type` (`number` / `color` / `string`), `default`, and a `description` **with its unit or range** ("in seconds", "fraction of the frame height", "0 (none) to 1 (full)", "#rrggbb"). Numbers need `min ≤ default ≤ max` and `step > 0`. |
| `ai` | no | `{ use?, avoid?, example? }`: when to pick it, when not to, and example params (keys must be params). Printed in the guide and `presets.json`. |
| `preview` | no | `{ icon?, text? }`. Tiles live-render the preset; `text` replaces the "ABC123" sample. |
| `version` | no | Default 1. Bump when the look of a shipped id changes. |
| `order` | no | Only the migrated built-ins use it (to keep their old order). Omit it: new presets sort after them by id. |
| `type` | no | Render key, defaults to `<kind>/<id>`. Only set it to share one render function between presets. |

Params are always resolved before your code runs (defaults merged in). Read them with the
helpers in `_lib/math.ts`: `n(params.x, fallback)` and `s(params.c, "#fff")`. Other shared code: `ease`, `easeIO`,
`bell` (0→1→0), `wave`, `clamp01`, `hash` (deterministic noise — never use `Math.random`, preview and export must
match); `_lib/textAnim.ts`, `_lib/transitions.ts`, `_lib/sticker.ts`.

## Templates per kind

### videoEffect: a layer on the Effects track, applied to the finished picture

Use **`frame`** (pure, cheapest) for looks the built-in compositor already does — `alpha`, `scale`, `dx/dy`
(fractions of the frame), `blur` (fraction of height), `gray` (0..1), `vignette` (0..1):

```ts
export default defineVideoEffect({
  id: "slow-push", name: "Slow push", category: "Motion",
  description: "A slow zoom into the picture; adds tension to a still or static shot.",
  params: [{ key: "zoom", label: "Zoom", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.1,
    description: "Extra zoom at the end of the effect, as a fraction of full size." }],
  frame: (f, p, k) => ({ ...f, scale: f.scale * (1 + n(k.zoom, 0.1) * p) }),
});
```

Use **`draw`** for anything else: it gets `{ ctx, w, h, p, params, scratch }` after the built-in look, with the
identity transform, inside save/restore. `scratch(w, h, slot = 0)` returns a cleared offscreen 2D context (slots 0–7,
reused every frame) or `undefined` where no canvas exists — then just return. You may set both `frame` and `draw`.
Avoid `ctx.filter` (ignored by iOS Safari); blur by downscaling into `scratch` instead. Keep it fast: it runs every
frame of preview and export.

### transition: across a cut

`p` runs 0 → 1 across the cut. Return `mixOut` / `mixIn` (opacity of each side) and optional per-side looks
`tOut` / `tIn`: `dx`, `dy`, `scale`, `rot`, `blur`, `clip [l,t,r,b]`, `iris`, `glitch`, `seed`, `tint`, `tintAlpha`.

```ts
export default defineTransition({
  id: "spin", name: "Spin", category: "Motion",
  description: "The picture spins out and the next one spins in; playful, energetic cuts.",
  params: [{ key: "turns", label: "Turns", type: "number", min: 0, max: 2, step: 0.25, default: 0.5,
    description: "Rotation over the whole transition, in full turns." }],
  frame: (f, p, k) => {
    const e = easeIO(p), deg = 360 * n(k.turns, 0.5);
    return { ...f, mixOut: 1 - e, mixIn: e, tOut: { rot: deg * e, scale: 1 - 0.3 * e }, tIn: { rot: -deg * (1 - e) } };
  },
});
```

For custom pixels add `paint: ({ ctx, w, h, p, params, side, mix, scratch }) => …` — called once per side
(`side` is `"out"` or `"in"`, `mix` its opacity) after that side is drawn, inside its clip. Set `popular: true` to
show it in the "Popular" row.

### textAnimIn / textAnimOut / textAnimLoop: text motion

Map the text frame: `alpha`, `dx/dy`, `scale`, `rot`, `chars` (0..1 typed portion), `clip`, `filter`. **In** gets
p 0 → 1 (1 = fully shown), **out** gets 1 → 0, **loop** gets the phase inside its `period` param (seconds; loops
should declare a `period` param; it defaults to 1 s).

```ts
export default defineTextAnimIn({
  id: "drop", name: "Drop", category: "Basic",
  description: "Text falls into place from above; titles and punchlines.",
  params: [{ key: "distance", label: "Distance", type: "number", min: 0, max: 1, step: 0.05, default: 0.2,
    description: "Start offset as a fraction of the frame height." }],
  frame: (f, p, k) => { const e = ease(p); return { ...f, alpha: f.alpha * e, dy: f.dy - (1 - e) * n(k.distance, 0.2) }; },
});
```

### effect (text effect): a static text look

Return `fx`: `color`, `glowBlur` (fraction of the font size), `neon`, `hollow`, `echo [{dx, dy, alpha}]`.

### sticker

```ts
export default defineSticker({ id: "sun", name: "Sun", category: "Shapes",
  description: "A simple yellow sun; sunny, happy or morning scenes.",
  svg: svg(`<circle cx="100" cy="100" r="60" fill="${YEL}"/>`) });   // svg() wraps a 200×200 viewBox (_lib/sticker.ts)
```

### textStyle: a one-click text preset

```ts
export default defineTextStyle({ id: "headline", name: "Headline", category: "Basic",
  description: "Big bold white title with a soft shadow; episode titles.",
  data: { font: "sans", bold: true, color: "#ffffff", size: 0.1, shadow: { color: "#000000", blur: 8, x: 0, y: 2 } } });
```

`data.font` must be a font id (see `presets/font/`); `size` is a fraction of the frame height.

### font

```ts
export default defineFont({ id: "mono", label: "Mono", stack: "ui-monospace, monospace", width: 0.6,
  description: "Fixed-width typewriter face; code, terminals and data." });
```

## Rules the loader enforces

`src/v2/presets/load.ts` checks every module at startup. Bad modules are skipped (and logged), and **`npm test` and
`npm run build` fail** on them:

- default export present, known kind, id format, file path equals `<kind>/<id>`, ids unique per kind;
- `name`, `category`, a description of at least 10 characters, no leftover `TODO`;
- valid params (identifier keys, unique, described, `min ≤ default ≤ max`, `step > 0`, colours `#rrggbb`);
- the render code exists for the kind (videoEffect: `frame` or `draw`) and `frame` does not throw at p = 0.5;
- presets sharing a `type` share the same function; `ai.example` only uses declared params.

## Tests you get for free

- `presets/presets.test.ts`: no load problems, every file registered, descriptions and param units present, and a
  **smoke render** of every preset (p = 0…1, default / min / max params) through `applyPreset`, `applyEffectFrame`
  and `drawWithLook` on a mock canvas, including `draw` / `paint` hooks.
- `registry/golden.test.ts`: frames of the migrated built-ins must not change. New presets are not in the golden
  file; if you deliberately change a built-in, run `UPDATE_PRESET_GOLDEN=1 npx vitest run src/v2/registry/golden.test.ts`
  and bump its `version`.
- `aiGuide.test.ts`: `public/ai/*` must match `npm run gen:ai`.

Add a `<id>.test.ts` next to your file for behaviour worth pinning (see `videoEffect/glow.test.ts`); test files and
`_lib/` / `__*__/` folders are never loaded as presets.

## Layering

Preset files import only `../define`, `../_lib/*` and types from `registry/types` — no DOM, React, `render` or
`engine` (enforced by `src/v2/architecture.test.ts`). Anything that needs a canvas gets it through `draw` / `paint`
arguments, so the same file runs in the browser, in export and in node tests.

## Runtime presets (JSON)

Descriptors can still arrive as JSON via `registerPresets(list)`. They reuse a module's render code through its
`type` (the built-ins keep their legacy keys such as `"push"`, `"slide"`, `"glitch"`); new render code can be added at
runtime with `registerRenderer(type, fn, { draw, paint })`.

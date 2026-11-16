# Scene format (`dionysus.scene/1`)

A **scene clip** (clip type `scene`, since P74) shows a small 3D world: objects, a camera and lights, changed by
timed events. The document is JSON, stored as the version blob of a `scene` asset (MIME
`application/vnd.dionysus.scene+json`), so it has versions like any asset. Code: `src/v2/domain/scene.ts`
(validation and the evaluator), `src/v2/clipTypes/scene/` (the clip type), `src/v2/render/scenePage.ts` (the
renderer page). Design: [`CLIP_PLUGIN_ARCHITECTURE.md`](CLIP_PLUGIN_ARCHITECTURE.md) §7 Phase 2.

Every frame is computed from the document and the clip time alone. Nothing is carried from one frame to the next, so
playing, seeking anywhere, scrubbing backwards and exporting all give the same picture.

## Example

```json
{
  "format": "dionysus.scene/1",
  "name": "3D scene",
  "durationSec": 5,
  "world": {
    "background": "#14161c",
    "camera": { "fov": 40, "position": [0, 1.6, 6], "lookAt": [0, 0.8, 0] },
    "lights": [{ "type": "hemisphere", "intensity": 1.1 }, { "type": "directional", "position": [3, 5, 2], "intensity": 1.6 }]
  },
  "objects": [
    { "id": "floor", "shape": "plane", "size": [12, 12], "color": "#2a2f3a", "rotation": [-90, 0, 0] },
    { "id": "ball", "shape": "sphere", "size": 0.5, "color": "#5ad1c8", "position": [-1.6, 0.5, 0],
      "functions": { "setMood": {
        "params": { "mood": { "type": "select", "options": ["calm", "alert"], "default": "calm" } },
        "states": { "param": "mood", "table": { "calm": { "color": "#5ad1c8", "scale": 1 }, "alert": { "color": "#ff6b4a", "scale": 1.3 } } } } } },
    { "id": "cube", "shape": "box", "size": [0.8, 0.8, 0.8], "color": "#e8e8e8", "position": [1.4, 0.4, -0.5] }
  ],
  "events": [
    { "at": 0, "obj": "cube", "call": "rotation", "args": { "value": [0, 360, 0] }, "dur": 5, "ease": "linear" },
    { "at": 0.5, "obj": "ball", "call": "moveTo", "args": { "position": [0.2, 0.5, 0.8] }, "dur": 1.5, "ease": "inOutCubic" },
    { "at": 2, "obj": "ball", "call": "setMood", "args": { "mood": "alert" }, "dur": 0.4, "ease": "out" },
    { "at": 2.5, "obj": "camera", "call": "moveTo", "args": { "position": [1.5, 1.8, 5] }, "dur": 2, "ease": "inOutSine" }
  ]
}
```

This is close to the scene a new clip starts with (Code → **3D scene**).

## Fields

| Field | Type | Notes |
|---|---|---|
| `format` | `"dionysus.scene/1"` | required |
| `name` | string | asset name for a new clip |
| `durationSec` | number > 0 | suggested clip length when the scene is added (the clip length is free, like a code clip) |
| `world.background` | `"#rrggbb"` | default `#101018` |
| `world.camera` | `{ fov, position, lookAt }` | degrees 1–179 (default 40), `[x, y, z]` (default `[0, 1.6, 6]`), `[x, y, z]` (default `[0, 1, 0]`) |
| `world.lights[]` | `{ type, color, intensity, position }` | `type`: `ambient`, `hemisphere`, `directional`, `point`; no lights = a hemisphere and a directional light |
| `objects[]` | object | see below |
| `events[]` | `{ at, obj, call, args, dur, ease }` | see below |
| `files` | `{ "<name>": "data:…" }` | embedded files (P75): GLB models as data: URLs, stored in the scene asset's version like an HTML clip package |

**Objects.** `id` (letters, digits, `_`, `-`; starts with a letter; `camera` is reserved), `shape` (`box` default,
`sphere`, `cylinder`, `cone`, `torus`, `plane`), `size` (box `[w, h, d]` or one number; sphere radius; cylinder and
cone `[radius, height]`; torus `[radius, tube]`; plane `[w, h]`), and the **base properties** `position` `[x, y, z]`,
`rotation` `[x, y, z]` in degrees (XYZ order), `scale` (number or `[x, y, z]`, above 0), `visible` (boolean),
`opacity` (0–1) and `color` (`"#rrggbb"`).

**Models** (P75). `model` names a file in `files` (`.glb`; a `.gltf` with embedded data also loads). A number `size`
fits the model: its largest side becomes `size` units, centred on x/z and standing on y = 0; without it the model keeps
the file's units. `scale`, `position`, `rotation`, `visible` and `opacity` apply to the whole model; `color` does not
(a model keeps its own materials). A model that is missing from `files` or can't be loaded draws the object's shape
(a box by default) and the validator warns. Model-only fields:

- `animation`: the clip that plays from 0 s, a clip name (as in the file) or `{ "clip", "speed", "loop", "from" }`:
  `speed` ≥ 0 (default 1), `loop` `repeat` (default), `once` (holds the last pose) or `pingpong`, `from` the start
  offset in seconds.
- `nodes`: parts shown (`true`) or hidden (`false`) by node name, e.g. `{ "Hat": false }`; other parts keep the
  file's setting.

```json
{ "files": { "robot.glb": "data:model/gltf-binary;base64,…" },
  "objects": [{ "id": "robot", "model": "robot.glb", "size": 1.6, "animation": "Idle",
    "functions": { "setState": { "params": { "state": { "type": "select", "options": ["idle", "walk"], "default": "idle" } },
      "states": { "param": "state", "table": { "idle": { "animation": "Idle" }, "walk": { "animation": { "clip": "Walk", "speed": 1.2 }, "nodes": { "Hat": false } } } } } } }],
  "events": [{ "at": 1, "obj": "robot", "call": "setState", "args": { "state": "walk" }, "dur": 0.4 },
             { "at": 3, "obj": "robot", "call": "play", "args": { "clip": "Wave", "loop": "once", "fade": 0.3 } }] }
```

The Scene tab's **Add GLB model** embeds a `.glb` (a new version of the scene asset, one undo step) and adds an object
that stands in front of the camera and plays the file's first animation.

**Base functions** (every object): `position` / `moveTo` (`value` / `position`: `[x, y, z]`), `rotation` (`value`),
`lookAt` (`target`: another object id or `[x, y, z]`), `scale` (`value`), `visible` (`value`), `opacity` (`value`),
`color` (`value`). Model objects also have `play` (`clip`, optional `speed`, `loop`, `from`, `fade`), `stop`
(optional `fade`) and `nodes` (`value`: node name → boolean). The **camera** (`"obj": "camera"`) has `position` /
`moveTo`, `lookAt` and `fov`.

**Custom functions** are declared per object and are declarative only (no code; decision 4): typed `params` (the
same declarations as HTML clip params: `number`, `color`, `text`, `boolean`, `select`, each with a `default`), plus
`set` (property → constant or `"$param"`) and/or `states` (`{ "param": "<a select param>", "table": { "<option>":
{ property: value } } }`). A call sets the listed properties, so it tweens like a base call. Missing args take the
param defaults. On a model object a row may also set `animation` (a clip name, `"$param"` or `{ clip, speed, loop,
from }`; it cross-fades over the event's `dur`) and `nodes` (switches at `at`).

## Event rules

- Events are sorted by `at` (seconds into the clip); events with the same `at` keep their array order.
- Without `dur` an event sets its properties at `at`. With `dur` it tweens from the value the property has at `at` to
  the target at `at + dur`, with `ease`: `linear` (default), `in`, `out`, `inOut`, `inCubic`, `outCubic`,
  `inOutCubic`, `inQuad`, `outQuad`, `inOutQuad`, `inOutSine`, `outBack`. Colours tween in RGB; `visible` never tweens
  (it switches at `at`).
- **Conflicts:** for one object property, the event that started last wins from its start; an earlier tween still
  running is cut there and the new one starts from the value it had reached (the validator warns). Different
  properties never conflict. `moveTo` and `position` are one property; `lookAt` and `rotation` are one property.
- `lookAt` aims at where the target is when the event ends (for a tween, at `at + dur`).
- **Animation** (models): the latest `play`, `stop` or row `animation` with `at <= t` decides. A clip's local time is
  `(t - at) × speed + from` (the object's `animation` starts at 0 s), looped, ping-ponged or held at the end with the
  clip's length from the file. With `fade` (else the event's `dur`) the clip before keeps playing, its own time going
  on, and the two blend with weights 1 − k and k, k = ease((t − at) / fade). Only those two take part: a fade that
  starts during another fade fades from the earlier event's clip. `stop` fades to the rest pose. `nodes` switches at
  `at`; later events override the names they list.

## Validation

`validateScene` reports errors and warnings with JSON paths (`events[3].args.value: must be [x, y, z] numbers.`):
unknown objects or functions, wrong argument types, unknown params, negative times, bad colours, sizes or shapes,
duplicate ids, overlapping tweens of one property (warning), models that are missing, not GLB or unreadable (warning),
clip and node names the GLB does not have (warning), and `play` / `stop` / `nodes` / `animation` on objects without a
model (error). The renderer skips anything
invalid instead of failing, and the clip's **Scene** tab in the inspector lists the problems. A document that is not
JSON or has the wrong `format` shows a slate ("This 3D scene can't be read") in the preview and black in export.

## Rendering

The scene runs in the same sandboxed iframe host as code clips (opaque origin, the clip CSP, the pinned three.js from
`render/htmlLibs.ts`). The page builds the world once; for each frame the editor sends the state for that time
(`stateAt(doc, t)`) as `ctx.inputs.scene` and the page applies it and renders. The page has no clock, timers or
random numbers.

Models (P75): the page's clip manifest carries `files` and the libraries `three` and `three-gltf` (only when an
object has a model), so the host serves each file as a blob: URL (`ctx.asset(name)`, like code clip attachments). The
page loads them with the vendored GLTFLoader in `init`, before the first frame, so export waits for them. Each model
has one `AnimationMixer`; every frame stops all actions (the rest pose), resets the clips in the state, sets each
one's weight and its time scale to its local time, and calls `mixer.setTime(1)`, never `mixer.update(delta)`. So a
frame depends only on the document and `t`, in preview, export and any seek order.

## Not yet (later Phase 2 steps)

Editing in the inspector (2.3), WebMCP tools and an AI guide rule (2.4),
storyboard `render: "scene"` and asset type `scene` (2.5, decision 5), per-object sub-tracks on the timeline (2.6).

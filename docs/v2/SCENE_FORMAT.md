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
| `world.lights[]` | `{ id?, type, color, intensity, position, lookAt?, groundColor?, shadow? }` | `type`: `ambient`, `hemisphere`, `directional`, `point`; no lights = a hemisphere and a directional light. `id` (optional, P81b) names a light: letters, digits, `_`, `-`, unique among objects and lights, not `camera`. Phase 1 (#350): a light with an `id` takes events (see [Look](#look-scene-phase-1-350)); `lookAt` aims a directional light (default the origin), `groundColor` is a hemisphere light's ground colour (default `#303040`), `shadow` (directional and point) is `true` or `{ mapSize, bias, normalBias, radius, area }` |
| `world.fog`, `world.sky`, `world.environment`, `world.post`, `world.export` | objects | Phase 1 look, all optional: see [Look](#look-scene-phase-1-350) |
| `objects[]` | object | see below |
| `events[]` | `{ at, obj, call, args, dur, ease }` | see below |
| `files` | `{ "<name>": "data:…" }` | embedded files (P75): GLB models as data: URLs, stored in the scene asset's version like an HTML clip package; since P82 also Script objects' code (`data:text/javascript;charset=utf-8;base64,…`) |

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

**Script objects** (P82). `script: { "file", "params"? }` makes an object drawn by your own three.js code: `file`
names a JavaScript file in `files` (a data: URL, UTF-8, up to 256 KB), `params` is a map of plain names (letters,
digits, `_`) to numbers, text (up to 2000 characters) or `true` / `false`. An object has a `model` or a `script`, not
both. The file is an ES module that exports

- `build(THREE, params, ctx)`: called once when the page is built (it may be `async`); returns a `THREE.Object3D`
  (a Mesh, Points, Group…) built around (0, 0, 0);
- `update(obj, t, params, ctx)` (optional): called for every frame with the scene time `t` in seconds. It must set
  the object from `t` (and `params`) alone, never from the frame before, so preview, export and any seek order give
  the same picture.

`ctx` has `id` (the object's id), `random(seed?)` (a new seeded generator: the same numbers every time for one object
and seed; never use `Math.random`) and `makeCanvas(w, h)` (an OffscreenCanvas up to 4096 px a side, e.g. for a
`CanvasTexture`). Scripts can't import anything (THREE is passed in) and run only in the sandboxed scene page (opaque
origin, the clip CSP: no network, no editor, no storage). The object's base properties (`position`, `rotation`,
`scale`, `visible`, `opacity`; opacity multiplies the script's own material opacity) and its events work as for any
object; `shape` is what is drawn when the script can't run (`size` and `color` only affect that shape).

```json
{ "files": { "sparks.js": "data:text/javascript;charset=utf-8;base64,…" },
  "objects": [{ "id": "sparks", "script": { "file": "sparks.js", "params": { "count": 600, "color": "#ffd36b" } }, "position": [0, 0, 0] }],
  "events": [{ "at": 2, "obj": "sparks", "call": "opacity", "args": { "value": 0 }, "dur": 1 }] }
```

Templates to start from (the scene editor's **Add object** menu, and `set_scene_script`'s `template`): **Particles**
(`particles`: a swirl of rising points; `count`, `color`, `size`, `radius`, `height`, `rise`, `swirl`), **Procedural
shape** (`shape`: a sphere whose surface wobbles; `radius`, `detail`, `color`, `wobble`, `speed`, `faceted`), **Text**
(`text`: words on a plane, typed on over time; `text`, `color`, `size`, `width`, `typeSpeed`) and **Empty script**
(`empty`: a commented torus knot that spins; `color`, `spin`).

The validator checks the script statically: the file is in `files` (else a warning; the shape is drawn), readable as
UTF-8 text, under 256 KB, has no `import`, exports `build`, and compiles (a syntax error names the line); params are
checked as above. The page then runs each script once in a **check worker** (build, then update at a few times) under
a 3 s limit before it builds it: a script that takes longer (an endless loop) is stopped there and never freezes the
page or an export. A script that fails to load or build, returns something that is not an `Object3D`, or can't be
checked draws its shape; one whose `update` throws keeps what it has; an `update` slower than 250 ms per frame is
reported. Each problem is reported once: to the player as an asset problem, and in the scene editor's Edit view to
the object's Script form.

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

## Look (Scene Phase 1, #350)

The stylized look (the Stylized-AAA epic #349: a Genshin / BotW / Arcane look, not photorealism). Every field is
optional: a scene without them renders exactly as before.

**Materials.** An object's `material` is a name or an object:

| Field | Notes |
|---|---|
| `type` | `standard` (the old look, default for shapes), `toon` (banded light from a gradient map), `unlit` (ignores lights), `keep` (a model's or script's own materials, their default) |
| `steps` | toon bands, 2–8 (default 3) |
| `roughness`, `metalness` | 0–1 (standard) |
| `emissive`, `emissiveIntensity` | glow colour and strength (standard and toon): what bloom picks up |
| `outline` | `true` or `{ color (default #101014), width (units, default 0.02) }`: an inverted hull (a back-face shell pushed out along the normals) that follows skinning and morph targets |
| `rim` | `true` or `{ color, strength (default 0.6), power (default 3) }`: a fresnel edge light (not unlit) |

`"material": "toon"` is short for `{ "type": "toon" }`. On a GLB model a `type` converts every material (colour,
texture, normal and emissive maps and alpha carry over); without one the file's materials stay and `outline`, `rim`
and `emissive` still apply. A Script object opts in by having a `material`: the meshes its `build` returns are styled.

**Lights over time.** A light with an `id` takes events with `"obj": "<light id>"`: `intensity` (`value` ≥ 0),
`color` (`value`), `position` / `moveTo` (`value` / `position`, directional and point lights) and `lookAt` (`target`:
an object id or `[x, y, z]`, directional lights). They tween and conflict like object properties. `stateAt` returns
every drawn light at `t` as `lights` (the default lights when the scene has none). Shadows: any light with `shadow`
turns on the shadow map (PCF; `radius` softens it, `area` is a directional light's shadow box half-size, default 10)
and every object then casts and receives shadows.

**Atmosphere.**

| Field | Notes |
|---|---|
| `world.fog` | `{ type: "linear" (default) \| "exp2", color (default the background), near (10), far (60), density (0.03, exp2) }` |
| `world.sky` | procedural sky (three.js `Sky`): `{ elevation (°, -90..90, default 20), azimuth (° around y, 0 = +z, 90 = +x, default 180), turbidity (8), rayleigh (2), mieCoefficient (0.005), mieDirectionalG (0.8), light }`. `light` names a directional light the sun places: at its `lookAt` + 30 units towards the sun, so moving the sun moves its light and shadows. A sky replaces the background colour and turns on ACES tone mapping (it is HDR) |
| `world.environment` | `{ file, background? }`: an equirect `.hdr` (RGBELoader) or `.jpg` / `.png` / `.webp` in `files`, prefiltered (PMREM) as the scene's environment for reflections and image-based light; `background: true` also shows it behind everything |

**Post-processing** (`world.post`): the scene through an EffectComposer — render, SSAO, bloom, depth of field, the
output pass (tone mapping and sRGB), a grade pass and anti-aliasing.

| Field | Notes |
|---|---|
| `toneMapping` | `none`, `linear`, `reinhard`, `cineon`, `aces`, `agx` (default `aces` with a sky, else `none`) |
| `exposure` | 0–8 (default 1; with `none` an exposure other than 1 uses linear tone mapping) |
| `contrast`, `saturation` | 0–3 (default 1) |
| `lift`, `gamma`, `gain` | `[r, g, b]`: lift −1..1 (default 0), gamma 0.1..5 and gain 0..4 (default 1) |
| `vignette`, `grain` | 0–1 (default 0); the grain pattern is seeded by the frame's time |
| `bloom` | `true` or `{ strength (0.6), radius (0.4), threshold (0.85) }` (UnrealBloomPass, on the linear HDR picture) |
| `dof` | `true` or `{ focus (units from the camera, 6), aperture (0–0.2, 0.01), maxblur (0–0.05, 0.01) }` (BokehPass) |
| `ssao` | `true` or `{ radius (0.5), minDistance (0.001), maxDistance (0.1) }` |
| `aa` | `fxaa` (default), `smaa`, `none` |

**Look events.** The pseudo-objects `"post"`, `"fog"` and `"sky"` take events like `"camera"` (all with `value`):
post `exposure`, `contrast`, `saturation`, `lift`, `gamma`, `gain`, `vignette`, `grain`, `bloomStrength`,
`bloomRadius`, `bloomThreshold`, `dofFocus`, `dofAperture`, `dofMaxblur` (a focus pull is a `dofFocus` tween); fog
`color`, `near`, `far`, `density`; sky `sunElevation`, `sunAzimuth`, `turbidity`, `rayleigh`. `stateAt` returns them
resolved at `t` as `post`, `fog` and `sky`. An event on one the scene doesn't have warns (it changes nothing); a call
for an effect that is off (`bloomStrength` without `bloom`) warns too. **Compatibility:** an object whose id is `post`,
`fog` or `sky` keeps those events (old scenes), and the validator warns that the world's one can't be animated.

**Export supersampling.** `world.export.supersample` (1–4) renders export frames at that many times the size (at most
8192 px a side); the frame is fitted into the export canvas like any frame, so drawing it scales it down. The preview
stays at 1×.

**Rendering.** Materials, outlines, fog, shadows and tone mapping use core three.js. Post-processing, `Sky` and
`RGBELoader` come from one vendored bundle of the three.js 0.160 addons (`public/vendor/three-look-0.160.0.min.js`,
built by `scripts/vendor-three-look.mjs`, pinned by SRI, the library `three-look`), loaded only by pages that use them.
Every value arrives per frame in the state; `composer.render(0)` never reads a clock, and SSAO's kernel comes from the
clip runtime's seeded random numbers in a fixed build order, so preview, export and any seek order give the same
frame. The page is rebuilt only when the look's structure changes (materials, which post passes, fog type, sky,
environment); animated values never reload it.

**Benchmark shot.** `src/v2/domain/__fixtures__/benchmarkShot.ts` (also `public/samples/scenes/benchmark-shot.scene.json`)
is the epic's dusk village street, re-rendered at the end of every phase. Phase 1 renders:
[before](benchmark/phase1-before.jpg) (the same shot without the Phase 1 fields) and [after](benchmark/phase1-after.jpg).

## Validation

`validateScene` reports errors and warnings with JSON paths (`events[3].args.value: must be [x, y, z] numbers.`):
unknown objects or functions, wrong argument types, unknown params, negative times, bad colours, sizes or shapes,
duplicate ids, overlapping tweens of one property (warning), models that are missing, not GLB or unreadable (warning),
clip and node names the GLB does not have (warning), and `play` / `stop` / `nodes` / `animation` on objects without a
model (error), and for Script objects (P82) a missing file (warning), unreadable or too long code, imports, no `build`
export, syntax errors, bad params, unknown `script` fields and `model` with `script` (errors). The renderer skips anything
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

Script objects (P82): the manifest carries `files` (and only `three` when no object has a model); `init` checks each
script in a classic worker (a blob: URL that imports three.js and the script; a module worker can't start from the
page's opaque origin), terminating it after 3 s, then imports it in the page (a blob: URL), calls `build` and puts the
result in a group that gets the object's transform. Every frame calls `update(obj, t, …)` with the state's `t`. The
check worker's time limits are the page's only timers, and they run before the first frame.

## Editing (P76, P77, P80, P81a, P81b, P82)

A scene clip has its own timeline editor: **Edit scene** in the clip's Scene tab or **Edit scene…** in its menu on
desktop (it takes the timeline panel's place), the **Scene** tool on the phone (a full-screen sheet with the preview at
the top). The tracks (P81b): **Scene** (scene-wide settings only, no events), **Camera** (the camera's moves), one track
per object, then one per light (a light with an id holds its events; Phase 1 adds Post, Fog and Sky tracks when the scene has them); each event is a block labelled
with its call (blocks that overlap in time stack in rows). Select a block to edit its call, `at`, `dur`, `ease` and
arguments; select a track name to edit the object's base fields (id, name, shape, size, colour, position, rotation,
scale, visible, opacity; for models the animation from 0 s and the parts shown), the scene (name, `durationSec`,
background, the list of lights and Add light), the camera (field of view, position and look-at point at 0 s, and
adding a camera move) or a light (optional id, type, colour, intensity, position). New events take the value the object has at that time, so adding one changes nothing until it is
edited; renaming an object updates its events and every `lookAt` aimed at it; deleting one removes its events and the
`lookAt` events aimed at it. The editor writes plain `dionysus.scene/1`; times are rounded to the millisecond.

**Save and Cancel (P80).** The editor works on its own copy of the scene: each edit is one step of the editor's own
**Undo / Redo** (in its header; Ctrl/Cmd+Z, Ctrl+Y or Shift+Ctrl/Cmd+Z), the preview shows the unsaved scene at once,
and nothing reaches the project until **Save** (Ctrl/Cmd+S). Save asks how to keep it: **Replace current** overwrites
the version the clip shows (other clips showing it change too) or **Save as new version** adds one and points the clip
at it; the choice used last is the default and is remembered for the project. A save is **one** project undo step.
**Cancel**, the **X** or **Esc** close the editor; with unsaved changes they ask first (**Discard** throws them away).
Unsaved work is kept as a **draft on this device** (IndexedDB `dionysus-scene-drafts`, one per project and clip, with
the version it was made from), written shortly after each edit and at once when the page is hidden or closed. When the
editor opens and finds a draft that differs from the scene, it offers **Restore** or **Discard draft**; a draft made
from another version (the clip shows another one now, or that version was replaced) says so and can only be saved as
a new version. If the clip's scene changes from outside while the editor has unsaved changes (an AI agent's edit, the
version picker, a project undo), a banner says so: the unsaved work is kept and Save can only add a new version, or
**Load the new scene** drops it and shows the new one. Without unsaved changes the editor simply follows the clip.

**Phone layout (P80).** Like the main timeline: the header has the X (Cancel), Undo / Redo and Save; the preview is
at the top and the tracks below it; a bottom toolbar (44 px targets, line icons) holds the actions for the selection,
and a section opens in a bottom sheet: the scene (Add object, Scene, Camera, Lights), the camera (Start, Add event, and
Move / Aim, which open the Edit view on its position or its look-at point), a light (Light, Move for directional and
point lights, Delete), an object (Properties, Animation for models, Script for Script objects, Add event, Delete) or an event (Timing, Values, Go
to, Duplicate, Delete), with Back to return to the scene. Esc closes an open sheet first. On desktop the side panel shows the whole form, with Cancel and Save in the
header.

**Retiming (P77).** Drag a block to move its event (`at`); drag the selected block's start or end handle to change when
it starts (its end stays) or its `dur`. On touch, tap a block first, then drag it or its handles (a swipe over an
unselected block scrolls). Edges snap to the playhead, other events' starts and ends, the clip's in and out points and
whole frames of the project; the magnet button turns snapping off (Alt flips it during a drag). Times stay inside the
clip's range on the scene clock, or where the event already was. Drop a block on another object's track to give the
event to that object; it is refused, with the reason shown, when that object has no such call or the arguments don't
hold there (camera events stay on the Camera track; the Scene and light tracks take no events). The preview follows the drag; releasing stores it as one edit (one
step of the editor's undo; since P80 nothing is stored until Save); Esc cancels. Arrow keys move a focused block or handle by one frame (Shift: ten).
Dragging along the ruler scrubs the playhead.

**Edit view (P81a).** The editor's toolbar switches the preview between **Camera view** (the shot as the clip renders
and exports it; "Shot" on the phone) and **Edit view**: the same scene page, in a second sandboxed frame, in editor
mode, with a free orbit camera (since P81b it starts above and to one side of the scene camera, framing the camera and
what it looks at; **Reset view** returns there), a ground
grid and move / rotate / scale gizmos. On desktop it is drawn over the program preview; on the phone it takes the
mirrored preview's place and is taller. Click or tap an object to select it (empty space selects the scene). Mouse:
drag to orbit, right-drag to pan, wheel to zoom. Touch: one finger on a gizmo handle drags it, elsewhere it orbits;
two fingers pan and zoom; the handles are larger. A floating chip bar holds **Move / Rotate / Scale** (also W / E /
R), the axis (**X / Y / Z / Free**), **Snap** (0.25 units, 15°, 0.1 scale steps), **Auto-key** and **Reset view**; a
line says where the next drag writes and shows the live values while dragging (since P82: a small pill at the top
right on desktop, and on the phone a strip under the view, so it never covers handles near the top). A drag is one step of the
editor's undo, and nothing is stored until Save. It writes in exactly one place:

- the **selected event**, when it is on that object and sets the dragged property (`moveTo` / `position`, `rotation`,
  `scale`): its end value. The Edit view then shows the scene at that event's end, so the object is drawn where the
  drag puts it. Selecting such an event picks the matching gizmo;
- else, with **Auto-key** on, a key that ends at the playhead: the event of that property that ends there is updated,
  or a new tween is added from the end of the previous one (or from 0 s) to the playhead (an instant event at 0 s);
- else the object's own start value (`position`, `rotation`, `scale`; a uniform scale is written as one number).

Values are rounded to 1/1000 and Esc cancels a drag. A rotation keeps whole turns: the gizmo reads angles back in
(−180°, 180°], so each one is put next to the angle the drag started from (a 15° turn from 360° is written as 375°,
not 15°). The view's page is built from the same scene as the clip's page (only the frame part differs) and is never
used for export.

**The camera and lights in the Edit view (P81b).** The scene camera is drawn as a small camera with its frustum (the
clip's aspect, out to its look-at distance) and a yellow look-at point joined to it by a dashed line; each directional
and point light is a handle with its three.js helper (ambient and hemisphere lights light from everywhere, so they have
no handle: select them on their track). Tap the camera, its look-at point or a light handle to select it; selecting the
camera from its track, the chips **Move camera** / **Move look-at point** choose which one the gizmo moves. They only
move (no rotate or scale). A drag of the camera follows the rules above with the camera's calls: the selected camera
`moveTo` / `position` event (or `lookAt` for the look-at point; an object target becomes a point), else with Auto-key a
camera key ending at the playhead, else `world.camera.position` / `world.camera.lookAt`. A light's drag always sets its
`position` (lights don't animate; a scene on the default lights gets them written out first). A light's colour,
intensity and position are sent with the state, so moving one does not rebuild the view's page.

**Script objects in the editor (P82).** **Add object** (two columns: the shapes, a GLB model, then **Script (three.js
code)** with the four templates) adds a Script object in front of the camera and selects it; its track has a code
icon and takes events like any object. Its form has the usual properties (with **Shape if the script fails** instead of
shape, size and colour) and a **Script** section: the params (numbers, text, switches and colours, each with a remove
button; **New param** with a kind adds one), the code in a monospace box (Tab indents, Esc leaves the box, Ctrl / ⌘ +
Enter applies), **Apply code** and **Revert**, **Start again from a template** and **Turn into a plain shape**. The
static checks run as you type and keep **Apply code** off until they pass; what the Edit view's page reports when it
runs the script (an error in `update`, the 3 s limit) is listed under the code until the page is rebuilt. Applying
code, a param change, a template or turning it back into a shape is one step of the editor's undo. On the phone the
object's toolbar has **Script**, which opens this section in a sheet.

## Agent tools (P78)

Agents edit scene clips through WebMCP tools contributed by the scene clip type (see [`WEB_MCP.md`](WEB_MCP.md) for
the schemas) and AI guide RULE 79:

| Tool | What it does |
|---|---|
| `create_scene_clip` | Adds a scene clip on the main track (at `atSec`, or after the last clip) from a scene object / JSON text, or an empty scene. |
| `get_scene` | The clip's scene (embedded files shortened), its version, clip range and problems. |
| `list_scene_objects` | Objects with the calls each takes (base, model, own functions) and their arguments; the camera's start values and calls; the lights (index, optional id; `defaultLights` when the scene sets none); events by index. |
| `add_scene_object` | A shape, a `.glb` file (`{ name, dataUrl }`, or since P79 `{ url, name? }`) or a model already in `files`; `id`, `size` and other fields. |
| `set_scene_object` | Rename (references follow) or set fields (`null` removes one; `functions` replaces the map); since P79 `file` makes the object that model. |
| `remove_scene_object` | Removes an object and its events. |
| `add_scene_event` | Adds `{ at, obj, call, args, dur, ease }`; missing arguments are filled with the value at that time. |
| `update_scene_event` | Changes an event by index: time, `dur` / `ease` (`null` removes), call (args reset), args (merged), object. |
| `retime_scene_event` | Moves an event (`at` or `shiftSec`) and / or changes `dur`. |
| `remove_scene_event` | Removes an event by index. |
| `set_scene_world` | Name, planned length, background, camera start and lights (`null` = the defaults); Phase 1: `post`, `fog`, `sky`, `environment`, `export` (each replaces the whole entry, `true` = defaults, `null` removes it). |
| `set_scene_light` (P81b) | One light by `id` or index: `id` (`null` removes it), `type`, `color`, `intensity`, `position`, and (Phase 1) `lookAt`, `groundColor`, `shadow`; omit `light` to add one, `remove: true` to delete it. |
| `set_scene_script` (P82) | Script objects: omit `objectId` to add one from `template` (`particles`, `shape`, `text`, `empty`) or `code` (with optional `id`, `params`, `position`); with `objectId` set its `code`, `template` (code and params) or `params` (replaces the map; `null` removes them), or `remove: true` to make it a plain shape. Code with static problems is refused with them listed. `list_scene_objects` gives each Script object's code and the templates. |
| `apply_scene_edits` (P79) | A list of the edits above (`{ tool, …its fields }`, at most 200) applied in order as **one** undo step and one save. All or nothing: if one is refused nothing changes and the error names it (`edits[2] (add_scene_event): …`). |

Every edit is checked with the validator: one that would add an error is refused and changes nothing, and the message
lists the valid objects, calls or arguments. Each edit (or batch) is one undo step. Event indexes are positions in
`events` (not time order); the player sorts by time.

**Saving (P79: no version per call).** Edits are saved under the version-save rules (`mode`: `new` or `replace`; an
explicit mode is remembered for the project):

- **`new` (the default)** is an editing session. The agent's first edit of a clip adds a new version
  (`create_scene_clip` counts as the first: its version is the session's); later edits of the **same clip** update
  that version in place, each still its own undo step. The session ends, so the next edit adds a version again, when
  the agent edits another scene clip, passes `newVersion: true` (e.g. to keep a checkpoint before a big change), the
  clip shows another version (the user picked one, undo went past the session's first edit, or the editor saved one),
  or 10 minutes pass without an edit. The reply's `version.saved` says what happened: `new version`,
  `updated this session's version` or `replaced the shown version`.
- **`replace`** always overwrites the version the clip shows.

The session lives in the page (a reload starts a new one). Prefer `apply_scene_edits` for a planned set of changes:
one step to undo and one save.

**GLB models from a URL (P79).** `add_scene_object` and `set_scene_object` (also inside `apply_scene_edits`) take
`file: { url, name? }` besides `{ name, dataUrl }`. The URL rules are those of `attach_asset_version`: `https:`, or
`http:` on `localhost` / `127.0.0.1` / `[::1]`, or this site; fetched without credentials, so the server must allow
this site with CORS. The name (from `name` or the URL's last path part) must end in `.glb`, the bytes must be a binary
glTF (they start with `glTF`) and at most 64 MB. The file is embedded in the scene's `files` like an uploaded one.

## Storyboards (P79)

A storyboard can plan a 3D scene shot (decision 5; optional values within `dionysus/3.1`, see
[`STORYBOARD_FORMAT.md`](STORYBOARD_FORMAT.md)): an asset of type `"scene"` (its `prompt` is the scene brief) and a
shot with `"render": "scene"` and `"clip": "<that asset>"`. The scene asset's versions are `dionysus.scene/1` files;
the shot plays the selected one for its planned `durationSec`. Until the asset has a version, Send to timeline places
a placeholder whose intended type is `scene`; Update fills it. A scene clip added on the main track is mapped back by
Sync to Storyboard as a render scene shot. Ways to give the asset a scene:

- the shot detail's upload (a `.json` file);
- `attach_asset_version(s)` with `text` (the JSON), `scene` (an object) or a `url` / `path` / `dataUrl` of a `.json`;
- an inline `"scene": { … }` on the asset in the storyboard JSON, stored as a version by `import_storyboard` and the
  Import screen in the import's undo step (not stored again when it equals the current version). The storyboard edit
  tools (`create_storyboard`, `add_asset`, …) keep the field in the JSON but don't store it; use `attach_asset_version`.

Scene clips on overlay tracks stay timeline-only (a storyboard has no scene layers).

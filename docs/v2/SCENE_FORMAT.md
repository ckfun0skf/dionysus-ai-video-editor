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
| `world.lights[]` | `{ id?, type, color, intensity, position }` | `type`: `ambient`, `hemisphere`, `directional`, `point`; no lights = a hemisphere and a directional light. `id` (optional, P81b) names a light: letters, digits, `_`, `-`, unique among objects and lights, not `camera`. Lights are static: no events animate them (an event naming a light is an error) |
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

## Editing (P76, P77, P80, P81a, P81b)

A scene clip has its own timeline editor: **Edit scene** in the clip's Scene tab or **Edit scene…** in its menu on
desktop (it takes the timeline panel's place), the **Scene** tool on the phone (a full-screen sheet with the preview at
the top). The tracks (P81b): **Scene** (scene-wide settings only, no events), **Camera** (the camera's moves), one track
per object, then one per light (lights are static, so their tracks never hold events); each event is a block labelled
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
point lights, Delete), an object (Properties, Animation for models, Add event, Delete) or an event (Timing, Values, Go
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
line at the top says where the next drag writes and shows the live values while dragging. A drag is one step of the
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
| `set_scene_world` | Name, planned length, background, camera start and lights (`null` = the defaults). |
| `set_scene_light` (P81b) | One light by `id` or index: `id` (`null` removes it), `type`, `color`, `intensity`, `position`; omit `light` to add one, `remove: true` to delete it. |
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

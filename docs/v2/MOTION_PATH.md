# Motion paths (P89)

An After Effects style motion path moves a clip along a drawn route instead of separate X / Y keyframes. This page
covers the data, the evaluator, the editor and the AI surface. P89 is the editor part (P89a in the plan); named,
reusable storyboard paths and their guide step follow in P89b.

## 1. Which clips

Visual clips with a position that are **not on the main track** and not placeholders: overlay videos and images,
html / code clips, text, 3D scenes and plugin clips on overlay tracks (`canMotionPath` in `domain/model.ts`,
`ops.canMotionPathIn`). The main track's base picture fills the frame, so it has no path; put the moving thing on an
overlay. Effects and audio have no position.

## 2. Data (`dionysus/3.1`, optional fields only)

`Placement.motionPath?: MotionPath` (`domain/motionPath.ts`):

```ts
interface MotionPath {
  nodes: { id: string; t: number; x: number; y: number; in?: { x: number; y: number }; out?: { x: number; y: number };
           ease?: "linear" | "in" | "out" | "inOut" }[];
  constantSpeed?: true;          // one even speed over the whole path
  orient?: { offset: number };   // rotation = direction of travel + offset (degrees)
}
```

- `x` / `y` are the clip transform's: offsets of the clip **centre** from the frame centre as fractions of the frame
  (0, 0 = centred; ±0.5 = the edges). `in` / `out` are Bezier handle offsets from the point, in the same units; a point
  without handles is a corner, one with handles is smooth (mirrored handles unless one is dragged with Alt).
- `t` is ticks from the clip start (seconds in every JSON). Times increase. `ease` shapes the segment that starts at
  that point (quadratic in / out / in-out). A point keeps its `id` (`n1`, `n2`, … for new ones) through every edit, so
  an agent can name it.
- `constantSpeed`: the first and last times are kept and the inner points' times follow the distance along the path,
  so the speed is even and the eases are ignored. New hand-drawn paths start with it on; setting a point time,
  dragging a time marker or picking an ease turns it off and keeps the times where they were (`materializeTimes`).
- No legacy schema: projects without the field load and render unchanged.

## 3. Evaluation (one evaluator, preview = export)

`transformAt(p, t, aspect)` (`domain/model.ts`) applies keyframes, then a path with nodes overrides `x` / `y` and, with
`orient`, `rotation`; scale, opacity, crop and fades stay as they were. Everything that places a clip goes through it
(frame.ts `placeRect`, text.ts, tracking.ts), and the renderers pass the frame aspect (width / height), so preview,
offline render and MP4 export draw the same pixels.

`motionPathAt(mp, offset, aspect)`:

1. Each segment is a cubic Bezier (a straight segment uses control points at the thirds, so it is evenly
   parameterised). Lengths are measured on the frame (x scaled by the aspect) with 48 samples per segment, cached per
   path and aspect.
2. Before the first time and after the last the clip holds at that end point.
3. Between two times the eased time fraction is turned into an arc-length fraction, so the clip moves evenly along
   curves (no speed-up where handles bunch).
4. `angle` = the tangent's direction on the frame (`atan2(dy, dx × aspect)`, degrees clockwise).

Edits that move clip time keep the path on the same frames: trim start, split (`ops.ts`), clip range changes
(`clipRange.ts`), link clamping (`links.ts`) and promote to main (`promote.ts`, which drops the path unless the
transform is kept) all shift node times like keyframes.

## 4. Path vs keyframes

- While a path is set it alone gives `x` / `y`: setting one (`cmd.setMotionPath`, one undo step) removes the clip's
  `x` / `y` keyframes, and its `rotation` keyframes when it orients. Scale and opacity keys stay.
- The gizmo and the inspector's X / Y fields on a clip with a path set the path point at the playhead, or add one there
  (`setPointAt`, within 600 ticks counts as the same point); rotation on an oriented path changes the orient offset.
  The X / Y diamonds add or remove a path point at the playhead.
- **Tracking Follow** (`attach_track`, the Track sheet) writes `x` / `y` / scale / rotation keyframes and removes a
  path. Existing x / y keyframes (Follow or hand-made) are drawn as a **dashed** path when the clip is selected; opening
  the Motion path mode on such a clip shows them as an editable path (`pathFromKeys`: one point per key time, dropping
  points within 0.001 of the frame from the straight line, so the motion barely changes), and committing an edit turns them into a motion path.

## 5. The editor

**Entry:** desktop toolbar "Motion path", the inspector's Basic tab "Motion path" section (Draw path / Edit path,
Remove, Orient along path + offset, Even speed), and the phone clip tool row "Motion path".

**The path on the preview:** whenever a clip that can have a path is selected, its path (or its keyframes, dashed) is
drawn over the preview with the points, plus a dashed ring where the clip is at the playhead. Black-under-white lines
read on any picture.

**The mode** (`ui/MotionPathEditor.tsx`) is a draft session: the preview shows the draft live (`player.motionPreview`,
drawn with the same `withMotionPath` as the command), **✕ / Esc discards it, ✓ / Enter commits it as one undo step**.
Inside the mode each gesture is one step of the session's own undo (⌘/Ctrl+Z, ⇧⌘Z). Selecting another clip commits.

| Action | Desktop | Phone |
|---|---|---|
| Add a point at the end | Add point (P) on, click | Add point on, tap |
| Pull curve handles while adding | drag from the new point | drag |
| Move a point / a handle | drag (Alt breaks the mirror) | drag |
| Insert a point | click the path (keeps the shape; time from the arc position) | tap the path |
| Smooth ↔ corner | double-click a point, or Smooth / Corner | double-tap, or Smooth / Corner |
| Delete a point | Delete / Backspace, or Delete | Delete |
| Point time, X, Y | inspector fields (slider, − / + steps, exact number) | Point sheet |
| Ease of a segment | inspector Linear / Ease in / Ease out / Ease in-out | Ease sheet |
| Retime | drag a marker on the timing strip (←/→ nudge 0.05 s, ⇧ 0.5 s) | drag a marker |
| Orient, offset, even speed | inspector switches and slider | Orient sheet |
| Zoom | wheel | pinch (a second finger cancels a point drag) |

Every point, handle and time marker has a 44 px target; the phone toolbar is the bottom context bar (66 px) with
its sheets opening above it and the timing strip, so the tools stay in reach. Icons are the app's monochrome line
icons (lucide: Route, PenTool, Spline, Pentagon, Navigation2, ChartSpline, Timer, Waypoints).

## 6. Storyboards and agents

- **Storyboard:** a layer's `motionPath` (text, image, video, html) uses frame points (0–1 from the top-left, the
  layer centre, like a text `position`) and seconds from the layer start; Send puts it on the layer's clip, Sync to
  Storyboard writes an edited path back, export writes frame points again. With a path, `follow: "shot"` is ignored
  (warning). STORYBOARD_FORMAT §2.5 "Motion paths" and §4.
- **WebMCP:** `set_clip_motion_path { clipId, path }` (transform coordinates, seconds; t on every point or none;
  unknown fields warn; a bad path is refused and nothing changes; one undo step), `clear_clip_motion_path { clipId }`;
  `get_timeline` lists `motionPath` on the clip. WEB_MCP.md (generated).
- **AI rule 81** (`motion-path`). It is the first built-in rule appended after the clip type rules (79 `scene-clips`,
  80 `plugin-clips`), so no published number moved.

## 7. Tests

`domain/motionPath.test.ts` (evaluator golden snapshot, eases, even speed, orient and aspect, edits, keys → path,
JSON parse and errors, undo, split / trim), `domain/storyMotionPath.test.ts` (storyboard parse, Send, Sync, export /
), `ui/agent/motionPathTools.test.ts` (tools, get_timeline, Follow replaces a path),
`ui/motionPathEditor.test.tsx` (mode: add, ✓ one step, ✕ / Esc, session undo, insert, smooth, keys → path, inspector,
gizmo routing). Chrome at 390 and 1440 with a preview vs export pixel check.

## 8. Limits and next steps

- P89b: named, reusable storyboard paths (`paths[]`, `motionPath: { ref, … }`), the "Create path from reference"
  guide step through the Track sheet or manual drawing, Send / Update / Re-lay resolution, Sync back, code clip input
  of a path, and saved paths in the editor.
- A path is per clip; split halves get shifted copies.
- Only x / y (and rotation with orient) follow the path; scale along the path is keyframed as before.
- Pinch zoom is a CSS zoom of the preview while editing (no pan without zoom; the view resets when the mode closes).

# Clip masks (P49)

A **visibility mask** multiplies one image, video or HTML clip's alpha. It is part of that clip: crop, position, scale and rotation move it with the picture. Preview and export use the same raster (`render/clipMask.ts`).

This is not:

- a tracker box mask (`motionTracks[].mask`, inside / outside). Those still clip to the tracked box and still hide an *inside* mask when the feature is lost or out of range.
- an effect limit. Effects-track blur stays a full-frame effect of its `applyTo` scope. Masking a blur so the rest of the clip stays sharp needs a separate composite and is **not** done by cutting the clip away. That is deferred.

## Coordinates

Fractions of the **full source picture**, origin top-left, before crop. They are not viewport pixels and they are not frame fractions. `placeRect` maps them through crop, contain-fit letterboxing and the clip transform. A point outside the crop simply falls outside the drawn rect.

## Shapes

| Shape | Meaning |
|---|---|
| `rect` | Centre `x`,`y`, size `w`,`h`, `rotation` degrees clockwise, `radius` 0–0.5 of the smaller side |
| `ellipse` | Same centre and size, no radius |
| `linear` | Split through `x`,`y`. Rotation 0 keeps the top half; 90 keeps the left half |
| `band` | A strip of thickness `w` (a fraction of the source width) through `x`,`y`. A mirror-style bar |
| `path` | Closed Bézier. `nodes[]` have stable `id`s and optional `in` / `out` handle offsets |

`feather` (0–0.5) and `expand` (−0.5–0.5) are fractions of the shorter source side. Feather is three box-blurs of the mask alpha. It does not use `canvas.filter`. Expand grows the kept region (a negative value shrinks it) before the blur. `invert` keeps the outside. `enabled: false` bypasses the mask and keeps the shape.

## Freeform editing

The Mask sheet starts a path empty. Taps place points. **Close path** (or tapping the first point once there are at least three) closes it. After that, points and Bézier handles can be dragged. **Add point** inserts after the selected point. **Delete point** refuses to leave fewer than three points on a closed path. Pinch, or Ctrl/⌘+wheel, zooms; a second finger cancels a point drag. ✕ discards the draft. ✓ is one undo step.

## Keyframes and trackers

Scalar keys and per-node keys (`nodeKeys`, by id) use ticks from the clip start, same as transform keys. Storyboard JSON and WebMCP use seconds. Adding or deleting a point removes only that id's keys. Interpolation never follows array index.

`track` names a tracker on the **same** clip. The mask keeps its offset from `trackAnchor`. A lost frame or a time outside the tracker's range holds the last found sample. A time before any found sample does not move the mask. No position is invented.

## Storyboard and tools

Optional `mask` on a shot (its own picture) and on an image, video or html layer. Text layers ignore it with a warning. A bad or unclosed path is dropped with a warning; the rest of the board still imports. WebMCP: `set_clip_mask`, `clear_clip_mask`. `get_timeline` lists `mask` separately from `tracks[].mask`. Guide rule 71 (`clip-mask`).

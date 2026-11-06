# Motion tracking (P39, P40)

A **host-side region tracker**: the editor decodes the clip's frames itself, follows a box you draw and stores one
box per analysed frame. Sandboxed code never sees pixels or audio samples; code clips only get the solved numbers.

**What it is (honest scope).** Classic template / normalised cross-correlation tracking with a **scale search**
(0.88–1.12× per frame, refined ±3 %) and a slowly adapting template, so the box shrinks as a drone pulls away from a
person and grows as it comes closer. It is **not** AI subject segmentation. It works best on **high-contrast, fairly
persistent features**; it drifts on low-texture areas, heavy blur, occlusion or large rotation.

**Lost frames.** When the feature leaves the picture (e.g. out of the bottom) or the match score drops below 0.45,
the frame is marked **lost**: no position is invented. The tracker keeps searching (with a wider window) from the last
good box and picks the feature up again when it returns. Frames below 0.6 confidence are **unstable**. Both show yellow.
On lost / unstable frames and outside a tracker's range: code inputs get `found: false` (and no position), followers
hold their last key, an *inside* mask hides the clip, an *outside* mask is off.

## Data
`Placement.motionTracks: NamedTrack[]` — several independent trackers per video clip, each
`{ id, name, inS, outS, srcW, srcH, samples[], mask? }`. `inS`/`outS` = the source range it covers (source ticks, so
trims and slips keep it aligned); `samples` = `{ s, x, y, w, h, scale, conf, manual?, lost? }` in source-normalised coords.

## UI
1. Select a video clip → **Track** (bottom bar on phone, toolbar on desktop). Each tap adds a new tracker
   ("Track 1", "Track 2"…; rename in the sheet header).
2. Sheet (✕ = no change, ✓ = one undo step): ▶/❚❚ plays the clip in the sheet (Space toggles) with the following box,
   path and mask preview; the frame slider scrubs. **In / Out** set the range from the current frame (the bar under the
   strip shows it). Drag a box on a frame inside the range → **Track** (progress shown).
3. Review: the strip shows quality (cyan ok, yellow unstable / lost, dark outside the range). **Path** (checkbox, on
   by default) draws the box-centre trajectory; drag any point (or the box) to move that frame — it becomes a trusted,
   manual frame. Lost frames show "Lost" and no box.
4. **Follow**: text, photo, overlay or code clips keep their offset from the box; with *Scale with the box* they
   grow / shrink with it (x/y/scale keyframes, still editable; none on lost frames). **Mask**: Off / Inside / Outside.
5. Changing In / Out after tracking: shrinking drops the analysis outside; extending analyses **only the new part**
   (seeded from the box at the old edge) when you press ✓.

## Tracks lane
Under a video layer whose clips have trackers, a thin **Tracks** lane shows each tracker as a span over its range,
tinted yellow where frames are weak or lost. It is not a layer: it holds no clips and is never exported. Tap a span to
review that tracker; drag its ends to set In / Out or its body to slide the range (extensions are analysed).

## Code clips
Declare `"inputs": { "target": { "type": "track" } }`; in Params → Inputs pick the clip's tracker
(`clip:<clipId>#<trackId>`). `ctx.inputs.target` = `{ x, y, width, height, scale, rotation, found }` (0–1 of the frame).

## WebMCP
`track_clip { clipId, region, atSec?, fromSec?, toSec?, trackId?, name?, followers?, mask? }`,
`get_track { clipId, trackId?, everySec? }`, `attach_track { clipId, targetId, trackId?, atSec?, scale? }`,
`set_track_mask { clipId, trackId?, mask }`, `set_track_range { clipId, trackId, fromSec?, toSec?, name? }`, and
`set_clip_input` with `source: "clip:<clipId>#<trackId>"`. `trackId` is required whenever a clip has several trackers;
`get_timeline` lists `tracks[]` on each clip. Guide rule 68 (`motion-tracking`).

# Motion tracking (P39)

A **host-side region tracker**: the editor decodes the clip's frames itself, follows a box you draw, and stores one
box per analysed frame on the clip (`Placement.motionTrack`, source-normalised, keyed by source ticks so trims and
slips stay aligned). Sandboxed code never sees pixels or audio samples; code clips only get the solved numbers.

**What it is (honest scope).** v1 is classic template / normalised cross-correlation tracking with a small scale search
(0.94×–1.06× per frame) and a slowly adapting template. It is **not** AI subject segmentation (no Magic-Mask style
masks). It works best on **high-contrast, fairly persistent features** (a logo, a face in profile, a sign, a ball on
grass); it drifts on low-texture areas, heavy blur, occlusion or large rotation. Frames with confidence < 0.6 are marked
unstable (yellow) so you can nudge them.

## UI
1. Select a video clip (main or overlay) → **Track** (bottom bar on phone, toolbar on desktop). Playback pauses.
2. Drag a box around the feature on the frame → **Track**. The app analyses forward and backward from that frame
   (progress shown; up to 600 frames per clip, longer clips are sampled).
3. Scrub the frame slider: the box follows; the strip above it shows unstable stretches in yellow. Drag the box on a
   drifted frame to nudge it.
4. **Follow**: tick text, photo, overlay or code clips over this clip; they keep their current offset from the box and
   (optionally) scale with it — written as x/y/scale keyframes you can still edit. **Mask**: Off / Inside box / Outside box
   (traveling mask on the tracked clip, preview and export).
5. ✕ = no change. ✓ = track + followers + mask as one undo step. Reopening Track shows the stored result
   (Redraw box / Remove track).

## Code clips
Declare `"inputs": { "target": { "type": "track" } }`; in Params → Inputs pick the tracked clip. `ctx.inputs.target` =
`{ x, y, width, height, scale, rotation, found }` (0–1 of the frame). See HTML_CLIP_PACKAGE.md §3.3.

## WebMCP
`track_clip { clipId, region: { x, y, w, h }, atSec?, followers?, mask? }`, `get_track { clipId, everySec? }`,
`attach_track { clipId, targetId, atSec?, scale? }`, `set_track_mask { clipId, mask }`, and `set_clip_input` with
`source: "clip:<tracked clip id>"`. Guide rule 68 (`motion-tracking`).

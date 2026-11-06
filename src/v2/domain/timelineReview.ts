/**
 * P12-REVIEW: timeline tools for the WebMCP agent (read the timeline, lint it for review problems) and the schema of
 * the timeline edit and frame capture tools. Pure: the UI (ui/agent/timelineTools) runs the edits through engine
 * commands (one undo step each) and adds the checks that need decoded media (frames, audio).
 */
import { audioOutputOf } from "./spatial";
import { compositionDuration, transformOf, versionOf, type Placement, type Project, type Track } from "./model";
import { mainTrack } from "./ops";
import { needsPromptItems } from "./storySync";
import { TICKS_PER_SECOND } from "./time";
import { textOf } from "./text";

type Schema = Record<string, unknown>;
export interface TimelineToolDef { name: string; title: string; description: string; inputSchema: Schema; readOnly: boolean }

const num = (description: string, extra: Schema = {}): Schema => ({ type: "number", description, ...extra });
const str = (description: string): Schema => ({ type: "string", description });
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });

export const TIMELINE_TOOLS: TimelineToolDef[] = [
  { name: "get_timeline", title: "Read the timeline", readOnly: true,
    description: "The timeline as JSON: settings (size, fps), duration, and every track (id, kind, group, main) with its clips (id, start/duration/in in seconds, asset, type, volume, effect, transform, text, link parent, storyShot). Times are seconds.",
    inputSchema: obj({}) },
  { name: "capture_frame", title: "Capture a frame", readOnly: true,
    description: "Render the composited frame at timeSec exactly as export would and return it as a JPEG image (maxWidth px wide, default 640, at most 1280).",
    inputSchema: obj({ timeSec: num("Time in seconds."), maxWidth: num("Image width in px (default 640, max 1280).") }, ["timeSec"]) },
  { name: "capture_shot_frame", title: "Capture a frame of an earlier shot", readOnly: false,
    description: "Storyboard frame references (\"frameOf\", RULE 50): grab the frame at atSec of the source shot's selected clip and store it as the picked frame (a PNG version with { frameOf, atSec, sourceVersionId }) of the target shot's frameOf reference. Give \"shotId\" (the target shot) and, when it has several frame references, \"frameOf\" (the source shot) or \"slotId\". atSec defaults to the reference's atSec. Fails when the source shot has no clip yet (generate it first). One undo step; returns the state and the PNG.",
    inputSchema: obj({ shotId: str("Target shot id (the shot that uses the frame)."), frameOf: str("Source shot id (optional when the target has one frame reference)."), slotId: str("The frame reference slot id, e.g. \"s2.frameof.s1\" (instead of shotId / frameOf)."), atSec: num("Seconds into the source clip (default: the reference's atSec, else 0).") }) },
  { name: "contact_sheet", title: "Contact sheet", readOnly: true,
    description: "One JPEG grid of frames across the whole timeline, each labelled with its time. Give \"count\" (frames, default 12, max 36) or \"interval\" (seconds between frames). Use it to review the cut at a glance.",
    inputSchema: obj({ count: num("Number of frames (default 12, max 36)."), interval: num("Seconds between frames (overrides count)."), maxWidth: num("Sheet width in px (default 1280).") }) },
  { name: "review_lint", title: "Review the timeline", readOnly: true,
    description: "List review problems with times and clip ids: storyboard items needing a prompt, shots removed from the timeline, very short clips, gaps and black frames, overlay clips not linked to a main clip, audio clipping or long silence, text off the frame, and missing media. Fix them with the edit tools, then run it again.",
    inputSchema: obj({ minClipSec: num("Clips shorter than this are flagged (default 0.5)."), media: { type: "boolean", description: "Also decode frames and audio for black frames, clipping and silence (default true; slower)." } }) },
  { name: "move_clip", title: "Move a clip", readOnly: false,
    description: "Move a clip to startSec, optionally onto another track (trackId of the same kind). Linked layers move with a main clip. One undo step; returns the clip.",
    inputSchema: obj({ id: str("Clip id."), startSec: num("New start in seconds."), trackId: str("Target track id (default: the clip's track).") }, ["id", "startSec"]) },
  { name: "trim_clip", title: "Trim a clip", readOnly: false,
    description: "Move a clip's left or right edge to atSec on the timeline. ripple: true closes/opens the gap on the main track. One undo step; returns the clip.",
    inputSchema: obj({ id: str("Clip id."), edge: { type: "string", enum: ["left", "right"] }, atSec: num("New edge time in seconds."), ripple: { type: "boolean" } }, ["id", "edge", "atSec"]) },
  { name: "import_subtitles", title: "Import subtitles from SRT/VTT text", readOnly: false,
    description: "Add pasted SRT or WebVTT text as a new subtitle text layer (each cue a text clip). Cues need a 00:00:01,000 --> 00:00:03,000 timing line. One undo step; returns the number of cues.",
    inputSchema: obj({ text: str("The SRT or VTT text.") }, ["text"]) },
  { name: "add_blank_clip", title: "Add a blank (solid colour) clip", readOnly: false,
    description: "Add a solid colour clip at atSec: track \"main\" inserts it on the main track (later clips move up like any insert), \"overlay\" puts it on the first overlay layer with room (else a new one). color is #rrggbb; durationSec defaults to 3. To change the colour later call set_blank_color. One undo step; returns the clip.",
    inputSchema: obj({ track: { type: "string", enum: ["main", "overlay"] }, atSec: num("Timeline start in seconds."), color: str("#rrggbb"), durationSec: num("Length in seconds (default 3).") }, ["track", "atSec", "color"]) },
  { name: "set_blank_color", title: "Change a blank clip's colour", readOnly: false,
    description: "Set the colour (#rrggbb) of a blank clip (get_timeline shows \"blank\": \"#rrggbb\" on it). One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("Blank clip id."), color: str("#rrggbb") }, ["clipId", "color"]) },
  { name: "slip_clip", title: "Slip a clip's source range", readOnly: false,
    description: "Show a different part of the source inside a video, audio or HTML clip: set the source in point to inSec. The clip keeps its timeline position and length; inSec is clamped so the range stays inside the media. moveLinked: true slips linked audio/overlays by the same amount. Images and text cannot slip. One undo step; returns the clip.",
    inputSchema: obj({ clipId: str("Clip id."), inSec: num("New source in point in seconds."), moveLinked: { type: "boolean" } }, ["clipId", "inSec"]) },
  { name: "replace_clip_asset", title: "Replace a clip's asset", readOnly: false,
    description: "Swap the media of a clip for another asset of the same kind, keeping every other property (position, length, effects, links). The in point is kept when it fits, otherwise moved earlier. If the new source is shorter than the clip, pass onShort: \"shorten\" (clip ends with the source) or \"hold\" (keep length, freeze the last frame); without it the call fails and explains. One undo step; returns the clip. On a shot placeholder (get_timeline \"placeholder\": true) any video, image or html asset fills it in place. On a main-track clip that came from a storyboard shot, the asset is added as a new version of that shot instead (the clip follows it; earlier versions stay selectable).",
    inputSchema: obj({ clipId: str("Clip id."), assetId: str("Asset id of the same kind."), onShort: { type: "string", enum: ["shorten", "hold"] } }, ["clipId", "assetId"]) },
  { name: "split_clip", title: "Split a clip", readOnly: false,
    description: "Split a clip at atSec (inside it). One undo step; returns both halves.",
    inputSchema: obj({ id: str("Clip id."), atSec: num("Split time in seconds.") }, ["id", "atSec"]) },
  { name: "delete_clip", title: "Delete clips", readOnly: false,
    description: "Delete one or more clips (and the layers linked to them). ripple: true closes the gap on the main track. One undo step.",
    inputSchema: obj({ ids: { type: "array", items: { type: "string" }, description: "Clip ids." }, ripple: { type: "boolean" } }, ["ids"]) },
  { name: "set_clip_props", title: "Set clip properties", readOnly: false,
    description: "Change a clip in one undo step: volume (0..2), transform { x, y, scale, rotation, opacity } (null resets), effect { preset, params } (effect clips only; videoEffect preset ids and param ranges as in get_guide), fades { inSec, outSec }, speed (0.25..4), blend, text (text clips only: { text, size, color, … }); P14 sound position (clips with sound): position { azimuth -180..180 (0 front, -90 left, 90 right, ±180 behind), distance 0..1 (0 at the ear, 1 ≈ 20 m), width? 0..1 (1 keeps a stereo file's own image) } or null (centre, unprocessed), pan -1..1 (shorthand: azimuth = pan × 90), positionKeys [{ t: seconds from the clip start, azimuth, distance }] or null, trackPosition (default for the clip's track) and audioOutput { mode: stereo | binaural, environment?: room | outdoor } (whole project). Values are never clamped: an unknown preset, param, field or an out-of-range value fails the whole call with the reason and nothing changes. Returns the clip.",
    inputSchema: obj({ id: str("Clip id."), volume: num("0..2 (1 = unchanged)."), transform: { type: ["object", "null"] }, effect: { type: "object" }, fades: { type: "object" }, speed: num("0.25..4."), blend: str("Blend mode id."), text: { type: "object" }, position: { type: ["object", "null"] }, positionKeys: { type: ["array", "null"] }, pan: num("-1..1 shorthand for azimuth = pan × 90."), trackPosition: { type: ["object", "null"] }, audioOutput: { type: "object" } }, ["id"]) },
  { name: "promote_overlay", title: "Promote an overlay clip to the main track", readOnly: false,
    description: "Move a video, image or HTML clip from an overlay track onto the main track. mode \"replace\" (default) keeps its time and replaces what the main track shows there: covered main clips are removed, partly covered ones are trimmed, and a clip spanning it is split (the right part continues at the right in point). mode \"insert\" puts it in at its start and ripples later main clips (and their linked layers) by its duration; if it starts inside a main clip, give position \"before\" or \"after\" that clip (the call fails without it). Blend mode and chroma key are dropped; the transform is kept unless keepTransform is false; its audio is kept. One undo step; returns the main track.",
    inputSchema: obj({ clipId: str("Overlay clip id."), mode: { type: "string", enum: ["replace", "insert"] }, position: { type: "string", enum: ["before", "after"] }, keepTransform: { type: "boolean", description: "Keep position / scale / rotation / opacity / crop (default true)." } }, ["clipId"]) },
  { name: "merge_layer_up", title: "Merge a layer into the layer above", readOnly: false,
    description: "Move every clip of trackId into the layer directly above it on screen in the same group (the one drawn over it; or targetTrackId, which must be in the same group) and remove the emptied layer, the same as the Merge up button on a layer. Clips keep their times. If a moved clip overlaps a clip on the target, the call fails and lists the conflicts unless resolve is given: \"shift\" moves the incoming clip later to the first gap that fits, \"trimExisting\" cuts the existing clip away under it, \"trimIncoming\" keeps only the parts of the incoming clip that fall in gaps, \"pushLater\" ripples the existing clips later. resolve is one value for all or { clipId: value } per clip. dryRun returns the conflicts without changing anything. One undo step; returns the target layer's clips.",
    inputSchema: obj({ trackId: str("Layer (track) id to merge up."), targetTrackId: str("Layer to merge into (default: the one directly above)."), resolve: { type: ["string", "object"], description: "shift | trimExisting | trimIncoming | pushLater, or { clipId: one of them }." }, dryRun: { type: "boolean", description: "Only list the conflicts." } }, ["trackId"]) },
  { name: "add_clip", title: "Add a clip from an asset", readOnly: false,
    description: "Place a project media asset (id from get_timeline's \"assets\") at startSec, on trackId or the main track / a matching track. One undo step; returns the new clip.",
    inputSchema: obj({ assetId: str("Media asset id."), startSec: num("Start in seconds."), trackId: str("Track id (optional).") }, ["assetId", "startSec"]) },
];

export const TIMELINE_TOOL_NAMES = new Set(TIMELINE_TOOLS.map((t) => t.name));

export function timelineToolsMarkdown(): string {
  return TIMELINE_TOOLS.map((t) => {
    const props = Object.keys((t.inputSchema.properties as Schema | undefined) ?? {});
    return `- \`${t.name}\`${props.length ? `(${props.join(", ")})` : ""}${t.readOnly ? " · read-only" : ""}: ${t.description}`;
  }).join("\n");
}

const sec = (t: number) => Math.round((t / TICKS_PER_SECOND) * 1000) / 1000;
const rootOf = (p: Project) => p.compositions[p.rootCompositionId];

/** One clip as agent JSON (seconds). */
export function clipJson(p: Project, pl: Placement, track?: Track): Record<string, unknown> {
  const tr = track ?? rootOf(p).tracks.find((t) => t.placements.some((x) => x.id === pl.id));
  const asset = p.assets[pl.source.assetId];
  return {
    id: pl.id, track: tr?.id, type: pl.clipType, start: sec(pl.startTicks), duration: sec(pl.durationTicks), end: sec(pl.startTicks + pl.durationTicks), in: sec(pl.sourceInTicks),
    ...(asset ? { asset: asset.id, name: asset.name } : {}),
    ...(pl.volume !== undefined ? { volume: pl.volume } : {}),
    ...(pl.speed && pl.speed !== 1 ? { speed: pl.speed } : {}),
    ...(pl.transform ? { transform: { ...transformOf(pl) } } : {}),
    ...(pl.effect ? { effect: pl.effect } : {}),
    ...(pl.text ? { text: pl.text.text } : {}),
    ...(pl.position ? { position: pl.position } : {}),
    ...(pl.positionKeys?.length ? { positionKeys: pl.positionKeys.map((k) => ({ ...k, t: sec(k.t) })) } : {}),
    ...(pl.fadeInTicks || pl.fadeOutTicks ? { fades: { inSec: sec(pl.fadeInTicks ?? 0), outSec: sec(pl.fadeOutTicks ?? 0) } } : {}),
    ...(pl.link ? { linkedTo: pl.link.parent } : {}),
    ...(pl.storyShot ? { storyShot: pl.storyShot } : {}),
    ...(pl.placeholder ? { placeholder: true, label: pl.placeholder.label } : {}),
    ...(pl.blank ? { blank: pl.blank.color } : {}),
    ...(pl.storyLayer ? { storyLayer: pl.storyLayer } : {}),
    ...(pl.storyCue ? { storyCue: pl.storyCue } : {}),
  };
}

export function timelineJson(p: Project): Record<string, unknown> {
  const c = rootOf(p), main = mainTrack(c);
  return {
    settings: { width: p.settings.width, height: p.settings.height, fps: p.settings.fps, audioOutput: audioOutputOf(p) },
    duration: sec(compositionDuration(c)),
    tracks: c.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, ...(t.group ? { group: t.group } : {}), ...(t === main ? { main: true } : {}), ...(t.muted ? { muted: true } : {}), ...(t.hidden ? { hidden: true } : {}), ...(t.position ? { position: t.position } : {}), clips: t.placements.map((pl) => clipJson(p, pl, t)) })),
    assets: Object.values(p.assets).filter((a) => a.kind !== "text" && a.kind !== "effect").map((a) => ({ id: a.id, kind: a.kind, name: a.name })),
    ...(c.subtitles?.length ? { subtitles: c.subtitles.length } : {}),
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;
/** Average glyph advance as a share of the font size (a sans-serif estimate: the model has no font metrics). */
export const TEXT_ADVANCE = 0.55;
/**
 * P13: estimated box of a text clip in frame fractions (0..1 = inside): lines × size × line height high, the longest
 * line × size × TEXT_ADVANCE wide (size is a share of the frame height), times the clip scale, centred on x/y.
 */
export function textBounds(pl: Placement, aspect: number) {
  const tf = transformOf(pl), d = textOf(pl.text);
  const lines = d.text.split("\n");
  const h = lines.length * d.size * (d.lineHeight ?? 1.25) * tf.scale;
  const w = (Math.max(1, ...lines.map((l) => [...l].length)) * d.size * TEXT_ADVANCE * tf.scale) / aspect;
  const cx = 0.5 + tf.x, cy = 0.5 + tf.y;
  return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
}

export type LintKind = "needs-prompt" | "removed-from-timeline" | "short-clip" | "gap" | "black-frame" | "unlinked-layer" | "audio-clipping" | "audio-silence" | "text-off-frame" | "missing-asset" | "placeholder";
export interface LintIssue { kind: LintKind; severity: "error" | "warning" | "info"; message: string; atSec?: number; clip?: string; shot?: string }

/**
 * The model-only review checks. `hasBlob` (optional) says whether a media blob is stored; without it, missing media
 * means an asset/version that no longer exists. Black frames, clipping and silence need decoded media (UI side).
 */
export function reviewLint(p: Project, o: { minClipSec?: number; hasBlob?: (key: string) => boolean } = {}): LintIssue[] {
  const out: LintIssue[] = [];
  const c = rootOf(p), main = mainTrack(c), min = (o.minClipSec ?? 0.5) * TICKS_PER_SECOND;
  for (const it of needsPromptItems(p.storyboard)) out.push({ kind: "needs-prompt", severity: "warning", message: it.label, ...(it.shot ? { shot: it.shot } : {}) });
  const sb = p.storyboard;
  for (const id of sb?.order ?? []) if (sb?.shots[id]?.removedFromTimeline) out.push({ kind: "removed-from-timeline", severity: "info", shot: id, message: `Shot "${sb.shots[id].title}" was removed from the timeline (kept on the board).` });
  for (const t of c.tracks) for (const pl of t.placements) {
    const at = sec(pl.startTicks);
    if (pl.durationTicks < min) out.push({ kind: "short-clip", severity: "warning", clip: pl.id, atSec: at, message: `Clip ${pl.id} is only ${sec(pl.durationTicks)}s long.` });
    if (t !== main && t.kind !== "audio" && t.kind !== "effect" && main && main.placements.length && !pl.link) out.push({ kind: "unlinked-layer", severity: "info", clip: pl.id, atSec: at, message: `Layer ${pl.id} on ${t.name} isn't linked to a main clip; it won't follow edits.` });
    if (pl.placeholder) {
      out.push({ kind: "placeholder", severity: "warning", clip: pl.id, atSec: at, ...(pl.storyShot ? { shot: pl.storyShot } : {}), message: `${pl.placeholder.label} is a placeholder (${sec(pl.durationTicks)}s): its clip isn't generated yet, so it exports as a black frame. Add the shot's clip, then send_to_timeline (Update) or replace_clip_asset on ${pl.id}.` });
      continue;
    }
    if (pl.clipType !== "text" && pl.clipType !== "effect") {
      const v = versionOf(p, pl.source);
      if (!v) out.push({ kind: "missing-asset", severity: "error", clip: pl.id, atSec: at, message: `Clip ${pl.id} points to media that no longer exists.` });
      else if (o.hasBlob && !o.hasBlob(v.media.blobKey)) out.push({ kind: "missing-asset", severity: "error", clip: pl.id, atSec: at, message: `The media of clip ${pl.id} (${p.assets[pl.source.assetId]?.name ?? "?"}) is missing from this browser.` });
    }
    if (pl.clipType === "text") {
      const b = textBounds(pl, p.settings.width / p.settings.height);
      const out1 = [b.left < -0.001 && "left", b.right > 1.001 && "right", b.top < -0.001 && "top", b.bottom > 1.001 && "bottom"].filter(Boolean);
      if (out1.length)
        out.push({ kind: "text-off-frame", severity: "warning", clip: pl.id, atSec: at, message: `Text ${pl.id} runs past the ${out1.join(" and ")} edge of the frame (estimated box ${r2(b.left)}–${r2(b.right)} × ${r2(b.top)}–${r2(b.bottom)} of the frame).` });
    }
  }
  if (main) {
    const ps = [...main.placements].sort((a, b) => a.startTicks - b.startTicks);
    let end = 0;
    for (const pl of ps) {
      if (pl.startTicks - end > 1) out.push({ kind: "gap", severity: "warning", atSec: sec(end), message: `Gap on the main track from ${sec(end)}s to ${sec(pl.startTicks)}s (black frame).` });
      end = Math.max(end, pl.startTicks + pl.durationTicks);
    }
  }
  return out;
}

/**
 * P12-REVIEW: timeline tools for the WebMCP agent (read the timeline, lint it for review problems) and the schema of
 * the timeline edit and frame capture tools. Pure: the UI (ui/agent/timelineTools) runs the edits through engine
 * commands (one undo step each) and adds the checks that need decoded media (frames, audio).
 */
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
  { name: "split_clip", title: "Split a clip", readOnly: false,
    description: "Split a clip at atSec (inside it). One undo step; returns both halves.",
    inputSchema: obj({ id: str("Clip id."), atSec: num("Split time in seconds.") }, ["id", "atSec"]) },
  { name: "delete_clip", title: "Delete clips", readOnly: false,
    description: "Delete one or more clips (and the layers linked to them). ripple: true closes the gap on the main track. One undo step.",
    inputSchema: obj({ ids: { type: "array", items: { type: "string" }, description: "Clip ids." }, ripple: { type: "boolean" } }, ["ids"]) },
  { name: "set_clip_props", title: "Set clip properties", readOnly: false,
    description: "Change a clip in one undo step: volume (0..2), transform { x, y, scale, rotation, opacity } (null resets), effect { preset, params } (effect clips only; videoEffect preset ids and param ranges as in get_guide), fades { inSec, outSec }, speed (0.25..4), blend, text (text clips only: { text, size, color, … }). Values are never clamped: an unknown preset, param, field or an out-of-range value fails the whole call with the reason and nothing changes. Returns the clip.",
    inputSchema: obj({ id: str("Clip id."), volume: num("0..2 (1 = unchanged)."), transform: { type: ["object", "null"] }, effect: { type: "object" }, fades: { type: "object" }, speed: num("0.25..4."), blend: str("Blend mode id."), text: { type: "object" } }, ["id"]) },
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
    ...(pl.fadeInTicks || pl.fadeOutTicks ? { fades: { inSec: sec(pl.fadeInTicks ?? 0), outSec: sec(pl.fadeOutTicks ?? 0) } } : {}),
    ...(pl.link ? { linkedTo: pl.link.parent } : {}),
    ...(pl.storyShot ? { storyShot: pl.storyShot } : {}),
    ...(pl.storyLayer ? { storyLayer: pl.storyLayer } : {}),
    ...(pl.storyCue ? { storyCue: pl.storyCue } : {}),
  };
}

export function timelineJson(p: Project): Record<string, unknown> {
  const c = rootOf(p), main = mainTrack(c);
  return {
    settings: { width: p.settings.width, height: p.settings.height, fps: p.settings.fps },
    duration: sec(compositionDuration(c)),
    tracks: c.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, ...(t.group ? { group: t.group } : {}), ...(t === main ? { main: true } : {}), ...(t.muted ? { muted: true } : {}), ...(t.hidden ? { hidden: true } : {}), clips: t.placements.map((pl) => clipJson(p, pl, t)) })),
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

export type LintKind = "needs-prompt" | "removed-from-timeline" | "short-clip" | "gap" | "black-frame" | "unlinked-layer" | "audio-clipping" | "audio-silence" | "text-off-frame" | "missing-asset";
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

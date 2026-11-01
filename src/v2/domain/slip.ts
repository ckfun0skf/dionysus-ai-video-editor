/**
 * P26: "Adjust range" (slip edit) and "Replace asset" for one timeline clip.
 * - Slip moves which part of the source a clip plays (its source in point) without changing where it sits on the
 *   timeline or how long it is: a clip playing 3–6 s of its video slipped by +1 s plays 4–7 s. Video and audio clips
 *   slip inside their media; HTML/code clips slip their time offset (the clip's `t` starts later).
 * - Clips linked to it (P9 "Link to main") keep their timeline place. With "move linked" the linked video, audio and
 *   HTML clips slip their own source by the same amount, so they stay in sync with the main clip's picture.
 * - Replace swaps the clip's asset for another of the same kind and keeps everything else (position, length, effects,
 *   transform, transitions, volume, sound position, keyframes, links). The in point is kept when the new source is
 *   long enough, shifted earlier when it is not, and when the source is shorter than the clip the caller chooses
 *   "shorten" (the clip ends with the source) or "hold" (it keeps its length and freezes the last frame).
 * Pure functions on a Project; the engine commands (engine/commands) and the WebMCP tools (slip_clip,
 * replace_clip_asset) wrap them, so one call is one undo step.
 */
import { TICKS_PER_SECOND } from "./time";
import { findPlacement, versionOf, type AssetVersion, type Placement, type Project } from "./model";
import { MIN_DURATION_TICKS } from "./ops";
import { setSourceRange } from "./clipRange";

export type SlipKind = "media" | "html";
/** Longest HTML time offset when its version has no length (10 min). */
export const MAX_HTML_OFFSET_TICKS = 600 * TICKS_PER_SECOND;
export type OnShort = "shorten" | "hold";

const rootOf = (p: Project) => p.compositions[p.rootCompositionId];
/** Source ticks a clip plays (its length × speed). */
export const spanOf = (p: Placement) => Math.round(p.durationTicks * (p.speed ?? 1));

/** How a clip slips: video/audio inside their media, HTML its time offset; undefined for stills, text, effects and freeze frames. */
export function slipKind(p: Placement): SlipKind | undefined {
  if (p.freeze) return undefined;
  if (p.clipType === "video" || p.clipType === "audio") return "media";
  if (p.clipType === "html") return "html";
  return undefined;
}

/** The in-point range a clip can slip over (ticks), plus its media length when known. undefined = no slip. */
export function slipBounds(project: Project, p: Placement): { min: 0; max: number; mediaTicks?: number; spanTicks: number } | undefined {
  const kind = slipKind(p);
  if (!kind) return undefined;
  const span = spanOf(p), media = versionOf(project, p.source)?.media.durationTicks;
  if (kind === "media") {
    if (!media) return undefined;
    return { min: 0, max: Math.max(0, media - span), mediaTicks: media, spanTicks: span };
  }
  return { min: 0, max: media ? Math.max(0, media - span) : MAX_HTML_OFFSET_TICKS, ...(media ? { mediaTicks: media } : {}), spanTicks: span };
}

function mapClips(project: Project, f: (p: Placement) => Placement): Project {
  const c = rootOf(project);
  let changed = false;
  const tracks = c.tracks.map((t) => {
    const placements = t.placements.map((p) => { const n = f(p); if (n !== p) changed = true; return n; });
    return placements.some((p, i) => p !== t.placements[i]) ? { ...t, placements } : t;
  });
  return changed ? { ...project, compositions: { ...project.compositions, [c.id]: { ...c, tracks } } } : project;
}

function withIn(p: Placement, at: number): Placement {
  if (p.sourceInTicks === at) return p;
  const out: Placement = { ...p, sourceInTicks: at };
  delete out.storyTrim;
  return out;
}

/** Clips linked to `id` ("Link to main") that can slip. */
export function linkedSlippable(project: Project, id: string): Placement[] {
  return rootOf(project).tracks.flatMap((t) => t.placements).filter((p) => p.link?.parent === id && !!slipKind(p));
}

/**
 * Slip clip `id` so it starts `inTicks` into its source (clamped to its bounds); its start and length stay. With
 * `moveLinked`, clips linked to it slip by the same delta (each clamped to its own source). Returns the project
 * unchanged when nothing moves.
 */
export function slipClip(project: Project, id: string, inTicks: number, opts: { moveLinked?: boolean } = {}): Project {
  const f = findPlacement(rootOf(project), id);
  if (!f) throw new Error(`Unknown clip ${id}`);
  const b = slipBounds(project, f.placement);
  if (!b) return project;
  const at = Math.round(Math.max(b.min, Math.min(b.max, inTicks)));
  const delta = at - f.placement.sourceInTicks;
  if (!delta) return project;
  // Linked clips keep their place on the timeline (a slip does not move the parent). Each one is returned as a new
  // object so the engine's link step (links.applyLinks) treats it as placed by this command instead of following the
  // parent's content; with moveLinked, the ones with a source slip by the same delta.
  return mapClips(project, (p) => {
    if (p.id === id) return withIn(p, at);
    if (p.link?.parent !== id) return p;
    const kb = opts.moveLinked ? slipBounds(project, p) : undefined;
    const moved = kb ? withIn(p, Math.round(Math.max(kb.min, Math.min(kb.max, p.sourceInTicks + delta)))) : p;
    return moved === p ? { ...p } : moved;
  });
}

/**
 * Unlocked range (video/audio): set in and out (source ticks, out exclusive); the start stays, the length follows
 * (it stops at the next clip on the track, as trims do).
 */
export function setSlipRange(project: Project, id: string, inTicks: number, outTicks: number): Project {
  const c = rootOf(project), f = findPlacement(c, id);
  if (!f) throw new Error(`Unknown clip ${id}`);
  const media = versionOf(project, f.placement.source)?.media.durationTicks;
  if (slipKind(f.placement) !== "media" || !media) return project;
  const next = setSourceRange(c, id, inTicks, outTicks, media);
  return next === c ? project : { ...project, compositions: { ...project.compositions, [c.id]: next } };
}

/** The version a replace uses: the asset's selected version, else its newest. */
export function replaceVersion(project: Project, assetId: string): AssetVersion | undefined {
  const a = project.assets[assetId];
  return a && (a.versions.find((v) => v.id === a.selectedVersionId) ?? a.versions[a.versions.length - 1]);
}

export interface ReplacePlan {
  /** The new in point (the old one when it still fits, else shifted earlier). */
  inTicks: number;
  /** New media length (undefined for HTML/images without one). */
  mediaTicks?: number;
  /** Source ticks the clip needs (length × speed). */
  needTicks: number;
  /** The new source is shorter than the clip: the caller must choose "shorten" or "hold". */
  short: boolean;
  /** The in point had to move earlier. */
  shifted: boolean;
}

/** Why `assetId` can't replace clip `id` (undefined = it can). */
export function replaceError(project: Project, id: string, assetId: string): string | undefined {
  const f = findPlacement(rootOf(project), id);
  if (!f) return `No clip "${id}".`;
  const p = f.placement, a = project.assets[assetId];
  if (p.clipType === "text" || p.clipType === "effect") return `Clip ${id} is a ${p.clipType} clip; it has no asset to replace.`;
  if (!a) return `No asset "${assetId}".`;
  if (a.kind !== p.clipType) return `Asset ${assetId} is ${a.kind}; clip ${id} is ${p.clipType}. Replace with the same kind (video with video, audio with audio).`;
  if (!replaceVersion(project, assetId)) return `Asset ${assetId} has no version yet.`;
  if (p.source.assetId === assetId && p.source.versionId === replaceVersion(project, assetId)!.id) return `Clip ${id} already uses ${assetId}.`;
  return undefined;
}

/** What replacing clip `id` with `assetId` does to its range (see ReplacePlan). */
export function replacePlan(project: Project, id: string, assetId: string): ReplacePlan {
  const p = findPlacement(rootOf(project), id)!.placement;
  const v = replaceVersion(project, assetId);
  const need = spanOf(p), media = p.clipType === "video" || p.clipType === "audio" || p.clipType === "html" ? v?.media.durationTicks : undefined;
  if (!media || p.freeze) return { inTicks: media && p.freeze ? Math.min(p.sourceInTicks, Math.max(0, media - 1)) : p.sourceInTicks, mediaTicks: media, needTicks: need, short: false, shifted: false };
  if (p.sourceInTicks + need <= media) return { inTicks: p.sourceInTicks, mediaTicks: media, needTicks: need, short: false, shifted: false };
  const inTicks = Math.max(0, media - need);
  return { inTicks, mediaTicks: media, needTicks: need, short: media < need, shifted: inTicks !== p.sourceInTicks };
}

/** Last-frame hold point for a source `media` ticks long: one 30 fps frame before its end. */
export const holdPoint = (media: number) => Math.max(0, media - Math.round(TICKS_PER_SECOND / 30));

export type ReplaceResult = { ok: true; project: Project; plan: ReplacePlan; notes: string[] } | { ok: false; error: string; needsChoice?: boolean; plan?: ReplacePlan };

/**
 * Replace clip `id`'s asset with `assetId` (same kind). Keeps timeline position, length, effects, transform, transitions,
 * volume, sound position, keyframes and links. A source shorter than the clip needs `onShort`: "shorten" ends the clip
 * with the source (later clips stay where they are), "hold" keeps the length and freezes the last frame.
 */
export function replaceClipAsset(project: Project, id: string, assetId: string, onShort?: OnShort): ReplaceResult {
  const err = replaceError(project, id, assetId);
  if (err) return { ok: false, error: err };
  const plan = replacePlan(project, id, assetId);
  const s2 = (t: number) => Math.round((t / TICKS_PER_SECOND) * 100) / 100;
  if (plan.short && !onShort) return { ok: false, needsChoice: true, plan, error: `The new source is ${s2(plan.mediaTicks!)} s but the clip plays ${s2(plan.needTicks)} s: choose onShort "shorten" (end the clip with the source) or "hold" (keep the length, freeze the last frame).` };
  const v = replaceVersion(project, assetId)!;
  const notes: string[] = [];
  if (plan.shifted) notes.push(`In point moved earlier to ${s2(plan.inTicks)} s so the clip fits the new source.`);
  const next = mapClips(project, (p) => {
    if (p.link?.parent === id) return { ...p }; // linked clips keep their timeline place (see slipClip)
    if (p.id !== id) return p;
    const out: Placement = { ...p, source: { kind: "assetVersion", assetId, versionId: v.id }, sourceInTicks: plan.inTicks };
    delete out.storyTrim; delete out.holdEndTicks;
    if (plan.short && plan.mediaTicks) {
      if (onShort === "shorten") { out.durationTicks = Math.max(MIN_DURATION_TICKS, Math.floor(plan.mediaTicks / (p.speed ?? 1))); notes.push(`Clip shortened to ${s2(out.durationTicks)} s.`); }
      else { out.holdEndTicks = holdPoint(plan.mediaTicks); notes.push(`Clip keeps its length; the last frame holds from ${s2(plan.mediaTicks / (p.speed ?? 1))} s into the clip.`); }
    }
    return out;
  });
  return { ok: true, project: next, plan, notes };
}

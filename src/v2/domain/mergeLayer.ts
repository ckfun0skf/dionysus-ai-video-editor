/**
 * P32 "Merge up": move every clip of a layer onto the layer directly above it in the same group, then remove the
 * now-empty layer. Pure. Main and audio-only rules:
 *  - never the main track (it has nothing above it in its group) and never across groups;
 *  - the top layer of a group has no target (the button is disabled there);
 *  - text clips keep their look: the source layer's style is baked into the clip before it moves.
 *
 * Where an incoming clip overlaps a clip already on the target the caller picks a resolution — one for all, or per
 * incoming clip:
 *  - "shift":        the incoming clip moves later to the first gap on the target long enough to hold it;
 *  - "trimExisting": the target's clips are cut away under the incoming clip (it wins its range);
 *  - "trimIncoming": the incoming clip keeps only the parts that fall in the target's gaps;
 *  - "pushLater":    the incoming clip keeps its time and every target clip from the overlap on moves later by the
 *                    overlap (a ripple on the target layer only).
 */
import type { Composition, Placement, Track } from "./model";
import { groupOf, type TrackGroup } from "./ops";
import { effectivePlacement } from "./layerStyle";
import { cutPart } from "./promote";

export type MergeResolve = "shift" | "trimExisting" | "trimIncoming" | "pushLater";
export const MERGE_RESOLVES: MergeResolve[] = ["shift", "trimExisting", "trimIncoming", "pushLater"];
export const MERGE_RESOLVE_LABEL: Record<MergeResolve, string> = { shift: "Move it later", trimExisting: "Trim existing", trimIncoming: "Trim incoming", pushLater: "Push later" };
export interface MergeConflict { incomingId: string; existingIds: string[]; startTicks: number; endTicks: number }
export interface MergePlan { source: Track; target: Track; group: TrackGroup; conflicts: MergeConflict[] }

const end = (p: { startTicks: number; durationTicks: number }) => p.startTicks + p.durationTicks;
/** Shortest piece kept when a clip is cut (matches promote). */
const MIN = 1200;

/** The layer `trackId` merges into: the one directly above it (lower index) in the same group. */
export function mergeTarget(comp: Composition, trackId: string): Track | undefined {
  const i = comp.tracks.findIndex((t) => t.id === trackId);
  if (i < 0) return undefined;
  const src = comp.tracks[i], g = groupOf(comp, src);
  if (g === "main") return undefined;
  for (let j = i - 1; j >= 0; j--) {
    const t = comp.tracks[j];
    if (groupOf(comp, t) === g && t.kind === src.kind) return t;
  }
  return undefined;
}

export const canMergeUp = (comp: Composition, trackId: string) => !!mergeTarget(comp, trackId);

const overlaps = (a: Placement, b: Placement) => a.startTicks < end(b) && b.startTicks < end(a);

/** What merging `trackId` up would do: target layer and every incoming clip that overlaps a target clip. */
export function planMergeUp(comp: Composition, trackId: string, targetTrackId?: string): MergePlan {
  const source = comp.tracks.find((t) => t.id === trackId);
  if (!source) throw new Error(`No track ${trackId}`);
  const target = targetTrackId ? comp.tracks.find((t) => t.id === targetTrackId) : mergeTarget(comp, trackId);
  const g = groupOf(comp, source);
  if (g === "main") throw new Error("The main track cannot be merged");
  if (!target) throw new Error(`${source.name} is the top layer of its group: there is no layer above to merge into`);
  if (target.id === source.id || groupOf(comp, target) !== g || target.kind !== source.kind) throw new Error(`${target.name} is not in the same group as ${source.name}`);
  const conflicts: MergeConflict[] = [];
  for (const p of [...source.placements].sort((a, b) => a.startTicks - b.startTicks)) {
    const hit = target.placements.filter((q) => overlaps(p, q));
    if (hit.length) conflicts.push({ incomingId: p.id, existingIds: hit.map((q) => q.id), startTicks: Math.max(p.startTicks, Math.min(...hit.map((q) => q.startTicks))), endTicks: Math.min(end(p), Math.max(...hit.map(end))) });
  }
  return { source, target, group: g, conflicts };
}

const sortP = (xs: Placement[]) => [...xs].sort((a, b) => a.startTicks - b.startTicks);

/** First start ≥ `from` where `dur` fits between the clips of `ps`. */
function firstGap(ps: Placement[], from: number, dur: number): number {
  let t = from;
  for (const q of sortP(ps)) { if (end(q) <= t) continue; if (q.startTicks >= t + dur) break; t = Math.max(t, end(q)); }
  return t;
}

/** Remove [s, e) from every clip in `ps` (cutting a spanning clip in two). */
function carve(ps: Placement[], s: number, e: number, ids: () => string): Placement[] {
  const out: Placement[] = [];
  for (const q of ps) {
    if (end(q) <= s || q.startTicks >= e) { out.push(q); continue; }
    if (q.startTicks < s && s - q.startTicks >= MIN) out.push(cutPart(q, q.startTicks, s));
    if (end(q) > e && end(q) - e >= MIN) out.push(cutPart(q, e, end(q), q.startTicks < s ? ids() : q.id));
  }
  return out;
}

/** The parts of `p` that fall outside every clip in `ps`. */
function gapsOf(p: Placement, ps: Placement[], ids: () => string): Placement[] {
  let segs: [number, number][] = [[p.startTicks, end(p)]];
  for (const q of ps) segs = segs.flatMap(([s, e]): [number, number][] => (end(q) <= s || q.startTicks >= e ? [[s, e] as [number, number]] : [[s, Math.min(e, q.startTicks)] as [number, number], [Math.max(s, end(q)), e] as [number, number]]).filter(([a, b]) => b - a >= MIN));
  return segs.map(([s, e], i) => cutPart(p, s, e, i ? ids() : p.id));
}

export interface MergeOptions { targetTrackId?: string; resolve?: MergeResolve | Record<string, MergeResolve>; ids?: () => string }
export interface MergeResult { comp: Composition; plan: MergePlan; /** Incoming clips dropped because nothing of them fit (trimIncoming). */ dropped: string[] }

/**
 * Merge layer `trackId` up. Throws when there are overlaps and no resolution for one of them, so callers (dialog,
 * WebMCP) always show / choose first. One call = one undo step when wrapped in a command.
 */
export function mergeLayerUp(comp: Composition, trackId: string, opts: MergeOptions = {}): MergeResult {
  const plan = planMergeUp(comp, trackId, opts.targetTrackId);
  let n = 0;
  const ids = opts.ids ?? (() => `${trackId}-m${++n}-${Math.random().toString(36).slice(2, 7)}`);
  const pick = (id: string): MergeResolve | undefined => (typeof opts.resolve === "string" ? opts.resolve : opts.resolve?.[id]);
  const missing = plan.conflicts.filter((c) => !pick(c.incomingId));
  if (missing.length) throw new Error(`${missing.length} clip(s) overlap clips on ${plan.target.name}: choose a resolution (${MERGE_RESOLVES.join(" | ")}) for ${missing.map((c) => c.incomingId).join(", ")}`);
  let tgt = [...plan.target.placements];
  const dropped: string[] = [];
  for (const raw of sortP(plan.source.placements)) {
    const p = raw.clipType === "text" && plan.source.layerStyle ? effectivePlacement(plan.source, raw) : raw;
    const hit = tgt.some((q) => overlaps(p, q));
    if (!hit) { tgt.push(p); continue; }
    const r = pick(raw.id)!;
    if (r === "shift") tgt.push({ ...p, startTicks: firstGap(tgt, p.startTicks, p.durationTicks) });
    else if (r === "trimExisting") tgt = [...carve(tgt, p.startTicks, end(p), ids), p];
    else if (r === "trimIncoming") { const parts = gapsOf(p, tgt, ids); if (!parts.length) dropped.push(p.id); tgt.push(...parts); }
    else {
      // pushLater: a target clip spanning the incoming start is split there; everything from the start on moves
      // later just enough to clear the incoming clip (gaps between them are kept).
      tgt = tgt.flatMap((q) => (q.startTicks < p.startTicks && end(q) > p.startTicks
        ? [cutPart(q, q.startTicks, p.startTicks), cutPart(q, p.startTicks, end(q), ids())].filter((x) => x.durationTicks >= MIN) : [q]));
      const later = tgt.filter((q) => q.startTicks >= p.startTicks);
      const by = Math.max(0, end(p) - Math.min(...later.map((q) => q.startTicks)));
      tgt = tgt.map((q) => (q.startTicks >= p.startTicks ? { ...q, startTicks: q.startTicks + by } : q));
      tgt.push(p);
    }
  }
  const tracks = comp.tracks.filter((t) => t.id !== plan.source.id).map((t) => (t.id === plan.target.id ? { ...t, placements: sortP(tgt) } : t));
  return { comp: { ...comp, tracks }, plan, dropped };
}

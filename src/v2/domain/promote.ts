/**
 * P20 "Promote to main track": move an overlay clip onto the main track. Pure.
 *
 *  - replace (default): the overlay at [a, b) takes the main track's place over [a, b). Main clips partly inside are
 *    trimmed (a clip cut on its left advances its in point), a clip spanning the whole range is split in two around it
 *    (the right part's in point continues where the promoted range ends) and clips fully inside are removed.
 *  - insert: nothing is trimmed. The overlay goes in at a cut and everything from there on ripples later by its
 *    duration. When `a` falls inside a main clip the caller picks `position` "before" (at that clip's start) or
 *    "after" (at its end); on a boundary (or past the end) no choice is needed.
 *
 * Linked clips (P9 "link to main") follow the same rules: in insert mode they ripple with their parent; in replace mode
 * each one keeps its time and is re-linked to the main clip that is under its start afterwards (the promoted clip, or
 * the left / right part of a cut clip), cut to that clip's range, and removed when nothing of it is left.
 * Overlay-only props (blend, chroma key, and optionally the transform) are dropped; the clip's own audio is kept.
 */
import { isStill, newId, transformOf, IDENTITY_TRANSFORM, type Composition, type Placement, type Track } from "./model";
import { mainTrack } from "./ops";

export type PromoteMode = "replace" | "insert";
export type InsertPosition = "before" | "after";
export interface PromoteOptions { mode?: PromoteMode; position?: InsertPosition; keepTransform?: boolean; ids?: () => string }
export interface PromoteSeg { id: string; startTicks: number; durationTicks: number; sourceInTicks: number; promoted?: boolean }
export interface PromotePlan {
  mode: PromoteMode;
  /** Insert only: the main clip the overlay's start falls inside (a choice of before / after is needed). */
  inside?: { id: string; startTicks: number; endTicks: number };
  /** Where the promoted clip lands on the main track. */
  atTicks: number;
  before: PromoteSeg[];
  after: PromoteSeg[];
  durationBefore: number;
  durationAfter: number;
  /** Overlay-only properties that will not carry over. */
  dropped: string[];
  /** Readable notes (gaps, removed clips, duration change). */
  notes: string[];
}

const end = (p: { startTicks: number; durationTicks: number }) => p.startTicks + p.durationTicks;
const MIN = 1200;
/** Shortest linked clip kept after a cut (matches links.MIN_LINK_TICKS). */
const MIN_LINK = 12_000;

/** The part [s, e) of placement `p` as its own clip (in point, fades, keyframes and transition adjusted). */
export function cutPart(p: Placement, s: number, e: number, id = p.id): Placement {
  const sp = p.speed ?? 1, hold = isStill(p) || !!p.freeze;
  const left = s - p.startTicks, right = end(p) - e;
  let sourceInTicks = p.sourceInTicks;
  if (!hold) sourceInTicks = p.reverse ? p.sourceInTicks + Math.round(right * sp) : p.sourceInTicks + Math.round(left * sp);
  const q: Placement = { ...p, id, startTicks: s, durationTicks: e - s, sourceInTicks };
  if (left > 0) { delete q.fadeInTicks; delete q.transitionIn; }
  if (right > 0) delete q.fadeOutTicks;
  if (left > 0 && p.keyframes) q.keyframes = Object.fromEntries(Object.entries(p.keyframes).map(([k, ks]) => [k, ks!.map((x) => ({ ...x, t: Math.max(0, x.t - left) }))]));
  if (id !== p.id) delete q.storyTrim;
  return q;
}

function find(comp: Composition, id: string): { track: Track; p: Placement } | undefined {
  for (const t of comp.tracks) { const p = t.placements.find((x) => x.id === id); if (p) return { track: t, p }; }
  return undefined;
}

/** Overlay-only properties of `p` that do not carry to the main track. */
export function droppedProps(p: Placement, keepTransform = true): string[] {
  const out: string[] = [];
  if (p.blend && p.blend !== "normal") out.push(`blend mode (${p.blend})`);
  if (p.chromaKey && !p.chromaKey.off) out.push("chroma key");
  const t = transformOf(p);
  const moved = t.x !== 0 || t.y !== 0 || t.scale !== 1 || t.rotation !== 0 || t.opacity !== 1 || Object.values(t.crop).some((v) => v !== 0) || !!p.keyframes && Object.keys(p.keyframes).some((k) => k !== "volume");
  if (moved && !keepTransform) out.push("position / scale / rotation / opacity / crop");
  return out;
}

/** Whether clip `id` can be promoted (a video or image clip on a non-main video track). */
export function canPromote(comp: Composition, id: string): boolean {
  const f = find(comp, id), main = mainTrack(comp);
  return !!f && !!main && f.track.id !== main.id && f.track.kind === "video" && (f.p.clipType === "video" || f.p.clipType === "image" || f.p.clipType === "html");
}

/** The insert point and the main clip `a` falls strictly inside (if any). */
function insertPoint(mains: Placement[], a: number, position?: InsertPosition) {
  const inside = mains.find((m) => m.startTicks < a && a < end(m));
  if (!inside) return { at: a, inside: undefined };
  return { at: position === "after" ? end(inside) : position === "before" ? inside.startTicks : NaN, inside };
}

/**
 * Promote overlay clip `clipId`. Returns the new composition and a plan describing it. In insert mode with the start
 * inside a main clip and no `position`, `comp` is returned unchanged and `plan.inside` says which clip needs a choice.
 */
export function promoteOverlay(comp: Composition, clipId: string, opts: PromoteOptions = {}): { comp: Composition; plan: PromotePlan } {
  const mode = opts.mode ?? "replace", keepTransform = opts.keepTransform ?? true, ids = opts.ids ?? (() => newId("plc"));
  const main = mainTrack(comp);
  const f = find(comp, clipId);
  if (!main || !f) throw new Error(`Unknown clip ${clipId}`);
  if (f.track.id === main.id) throw new Error("This clip is already on the main track");
  if (!canPromote(comp, clipId)) throw new Error("Only video, image and html clips on an overlay track can be promoted");
  const ov = f.p, a = ov.startTicks, b = end(ov), d = ov.durationTicks;
  const mains = [...main.placements].sort((x, y) => x.startTicks - y.startTicks);
  const seg = (p: Placement, promoted = false): PromoteSeg => ({ id: p.id, startTicks: p.startTicks, durationTicks: p.durationTicks, sourceInTicks: p.sourceInTicks, ...(promoted ? { promoted } : {}) });
  const total = (ps: Placement[]) => ps.reduce((m, p) => Math.max(m, end(p)), 0);
  const dropped = droppedProps(ov, keepTransform);
  const notes: string[] = [];

  // The promoted clip: overlay-only props dropped, link removed, storyboard layer mapping cleared.
  const promoted: Placement = { ...ov };
  delete promoted.link; delete promoted.storyLayer; delete promoted.storyLink; delete promoted.blend; delete promoted.chromaKey;
  if (!keepTransform) { delete promoted.transform; if (promoted.keyframes) { const k = Object.fromEntries(Object.entries(promoted.keyframes).filter(([key]) => key === "volume")); if (Object.keys(k).length) promoted.keyframes = k; else delete promoted.keyframes; } }
  else if (promoted.transform && JSON.stringify(transformOf(promoted)) === JSON.stringify(IDENTITY_TRANSFORM)) delete promoted.transform;

  let newMains: Placement[];
  let at = a;
  let inside: PromotePlan["inside"];
  /** Main clip id → where its content went (for re-linking): kept id, or parts. */
  const shiftOf = new Map<string, number>();
  if (mode === "replace") {
    newMains = [];
    for (const m of mains) {
      const ms = m.startTicks, me = end(m);
      if (me <= a || ms >= b) { newMains.push(m); continue; }
      const keepL = a - ms, keepR = me - b;
      if (keepL >= MIN) newMains.push(cutPart(m, ms, a));
      if (keepR >= MIN) newMains.push(cutPart(m, b, me, keepL >= MIN ? ids() : m.id));
      if (keepL < MIN && keepR < MIN) notes.push(`Removes main clip ${m.id} (${sec(ms)}–${sec(me)}), which lies fully under the overlay.`);
      else if (keepL >= MIN && keepR >= MIN) notes.push(`Splits main clip ${m.id} at ${sec(a)} and ${sec(b)}.`);
      else notes.push(`Trims main clip ${m.id} to ${keepL >= MIN ? `${sec(ms)}–${sec(a)}` : `${sec(b)}–${sec(me)}`}.`);
    }
    const mainEnd = total(mains);
    if (mains.length && a > mainEnd) notes.push(`Leaves a gap on the main track from ${sec(mainEnd)} to ${sec(a)}.`);
    newMains.push(promoted);
  } else {
    const ip = insertPoint(mains, a, opts.position);
    if (ip.inside) inside = { id: ip.inside.id, startTicks: ip.inside.startTicks, endTicks: end(ip.inside) };
    if (Number.isNaN(ip.at)) {
      const plan: PromotePlan = { mode, inside, atTicks: a, before: mains.map((m) => seg(m)), after: mains.map((m) => seg(m)), durationBefore: total(mains), durationAfter: total(mains), dropped, notes: ["Choose whether to insert before or after this clip."] };
      return { comp, plan };
    }
    at = ip.at;
    const mainEnd = total(mains);
    if (at > mainEnd && mains.length) { notes.push(`Starts after the end of the main track, leaving a gap from ${sec(mainEnd)} to ${sec(at)}.`); }
    newMains = mains.map((m) => { if (m.startTicks >= at) { shiftOf.set(m.id, d); return { ...m, startTicks: m.startTicks + d }; } return m; });
    newMains.push({ ...promoted, startTicks: at });
  }
  newMains.sort((x, y) => x.startTicks - y.startTicks);
  const durationBefore = total(mains), durationAfter = total(newMains);
  if (durationAfter !== durationBefore) notes.push(`Main track length ${sec(durationBefore)} → ${sec(durationAfter)} (${durationAfter > durationBefore ? "+" : "−"}${sec(Math.abs(durationAfter - durationBefore))}).`);
  else notes.push(`Main track length stays ${sec(durationBefore)}.`);

  // Other tracks: drop the overlay, then let linked clips follow.
  const mainIds = new Set(mains.map((m) => m.id));
  const under = (t: number) => newMains.find((m) => m.startTicks <= t && t < end(m));
  const tracks = comp.tracks.map((t) => {
    if (t.id === main.id) return { ...t, placements: newMains };
    const placements = t.placements.flatMap((pl): Placement[] => {
      if (pl.id === clipId) return [];
      const parent = pl.link?.parent;
      if (!parent || !mainIds.has(parent)) return [pl];
      if (mode === "insert") { const dd = shiftOf.get(parent); return dd ? [{ ...pl, startTicks: pl.startTicks + dd }] : [pl]; }
      const host = under(pl.startTicks);
      if (!host) return [];
      const s = pl.startTicks, e = Math.min(end(pl), end(host));
      if (e - s < Math.min(MIN_LINK, pl.durationTicks)) return [];
      const next: Placement = { ...pl, durationTicks: e - s, link: { parent: host.id } };
      if (next.fadeOutTicks && next.fadeOutTicks > next.durationTicks) next.fadeOutTicks = next.durationTicks;
      return [next];
    });
    return { ...t, placements };
  });
  const plan: PromotePlan = { mode, inside, atTicks: at, before: mains.map((m) => seg(m)), after: newMains.map((m) => seg(m, m.id === clipId)), durationBefore, durationAfter, dropped, notes };
  return { comp: { ...comp, tracks }, plan };
}

function sec(t: number): string { const s = Math.round((t / 120_000) * 100) / 100; return `${s}s`; }

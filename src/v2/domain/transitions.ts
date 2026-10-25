/**
 * Transitions registry (V2-067). A transition lives on the incoming clip (`transitionIn`) and plays across the
 * cut with the clip that ends exactly where it starts on the same track, centred on the cut. Outside their own
 * span the clips hold their edge frame, so no extra media handles are needed.
 */
import type { Composition, Placement, Track } from "./model";
import { applyPreset, getPreset, listPresets, type Params, type TransLayer } from "../registry";

export interface TransitionKind {
  id: string;
  label: string;
  icon: string;
  /** Opacity multipliers for the outgoing and incoming clip at progress a (0..1). Incoming is drawn on top. */
  mix(a: number): { out: number; in: number };
  /** Extra look of the outgoing and incoming clip at progress a (motion, blur, wipe, tint); undefined sides are plain. */
  look(a: number): { out?: TransLayer; in?: TransLayer };
  /** Registry category (e.g. "Slide"), for pickers. */
  category: string;
  /** Shown on the picker's Popular tab. */
  popular: boolean;
}

/** Transition kind from the preset registry (undefined when the id is unknown), with this cut's params (V2-SB-130). */
export function transitionKind(id: string, params?: Params): TransitionKind | undefined {
  const d = getPreset("transition", id);
  if (!d) return undefined;
  return {
    id, label: d.name, icon: d.preview.icon ?? "⧓", category: d.category, popular: !!(d.data as { popular?: boolean } | undefined)?.popular,
    mix: (a) => { const f = applyPreset("transition", id, a, undefined, params); return { out: f.mixOut ?? 1, in: f.mixIn ?? 1 }; },
    look: (a) => { const f = applyPreset("transition", id, a, undefined, params); return { out: f.tOut, in: f.tIn }; },
  };
}
export const transitionKinds = () => listPresets("transition").map((d) => transitionKind(d.id)!);
export type TransitionId = string;
/** `params` are the preset's own params; omitted on a same-kind update (e.g. a duration drag) they are kept. */
export interface Transition { kind: TransitionId; durationTicks: number; params?: Params }

export const DEFAULT_TRANSITION_TICKS = 60_000; // 0.5 s
export const TRANSITION_LENGTHS = [30_000, 60_000, 120_000, 240_000];

/** The clip that ends exactly where `p` starts on `track` (the outgoing side of a cut). */
export function previousAdjacent(track: Track, p: Placement): Placement | undefined {
  return track.placements.find((q) => q.id !== p.id && q.startTicks + q.durationTicks === p.startTicks);
}

/** Longest allowed transition: each clip gives at most half of itself. */
export function maxTransition(prev: Placement, p: Placement) {
  return Math.min(prev.durationTicks, p.durationTicks);
}

export interface ActiveTransition { prev: Placement; next: Placement; from: number; to: number; kind: TransitionKind }

/** Transitions on a track that are live (still adjacent), clamped to the clips' lengths. */
export function trackTransitions(track: Track): ActiveTransition[] {
  const out: ActiveTransition[] = [];
  for (const p of track.placements) {
    if (!p.transitionIn || track.kind !== "video") continue;
    const prev = previousAdjacent(track, p);
    const kind = transitionKind(p.transitionIn.kind, p.transitionIn.params);
    if (!prev || !kind) continue;
    const d = Math.min(p.transitionIn.durationTicks, maxTransition(prev, p));
    out.push({ prev, next: p, from: p.startTicks - Math.floor(d / 2), to: p.startTicks + Math.ceil(d / 2), kind });
  }
  return out;
}

const withParams = (t: Transition, params: Params | undefined): Transition => (params && Object.keys(params).length ? { ...t, params: { ...params } } : t);

/**
 * Set or clear (`t` undefined) the transition into a clip. No-op when there is no adjacent clip before it. Params:
 * `t.params` when given; otherwise kept when the kind is unchanged and dropped when it changes.
 */
export function setTransition(comp: Composition, id: string, t: Transition | undefined): Composition {
  return {
    ...comp,
    tracks: comp.tracks.map((track) => {
      const p = track.placements.find((q) => q.id === id);
      if (!p || (t && !previousAdjacent(track, p))) return track;
      return { ...track, placements: track.placements.map((q) => {
        if (q.id !== id) return q;
        const n: Placement = { ...q };
        if (t) n.transitionIn = withParams({ kind: t.kind, durationTicks: Math.max(1, Math.round(t.durationTicks)) }, t.params ?? (q.transitionIn?.kind === t.kind ? q.transitionIn.params : undefined));
        else delete n.transitionIn;
        return n;
      }) };
    }),
  };
}

/** Every cut on the track holding `id` (incoming clips with an adjacent clip before them). */
export function cutsOnTrack(comp: Composition, id: string): Placement[] {
  const track = comp.tracks.find((t) => t.placements.some((q) => q.id === id));
  return track ? track.placements.filter((q) => previousAdjacent(track, q)) : [];
}

/**
 * Set or clear the same transition on every cut of the track holding `id` ("Apply to all"). Each cut's length is
 * clamped to what its two clips allow.
 */
export function setTransitionAll(comp: Composition, id: string, t: Transition | undefined): Composition {
  return {
    ...comp,
    tracks: comp.tracks.map((track) => {
      if (!track.placements.some((q) => q.id === id)) return track;
      return { ...track, placements: track.placements.map((q) => {
        const prev = previousAdjacent(track, q);
        if (!prev) return q;
        const n: Placement = { ...q };
        if (t) n.transitionIn = withParams({ kind: t.kind, durationTicks: Math.max(1, Math.min(Math.round(t.durationTicks), maxTransition(prev, q))) }, t.params);
        else delete n.transitionIn;
        return n;
      }) };
    }),
  };
}

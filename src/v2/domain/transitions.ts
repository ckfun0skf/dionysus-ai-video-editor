/**
 * Transitions registry (V2-067). A transition lives on the incoming clip (`transitionIn`) and plays across the
 * cut with the clip that ends exactly where it starts on the same track, centred on the cut. Outside their own
 * span the clips hold their edge frame, so no extra media handles are needed.
 */
import type { Composition, Placement, Track } from "./model";

export interface TransitionKind {
  label: string;
  icon: string;
  /** Opacity multipliers for the outgoing and incoming clip at progress a (0..1). Incoming is drawn on top. */
  mix(a: number): { out: number; in: number };
}

export const TRANSITIONS = {
  crossfade: { label: "Crossfade", icon: "⧓", mix: (a: number) => ({ out: 1, in: a }) },
} satisfies Record<string, TransitionKind>;
export type TransitionId = keyof typeof TRANSITIONS;
export interface Transition { kind: TransitionId; durationTicks: number }

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
    const kind = TRANSITIONS[p.transitionIn.kind];
    if (!prev || !kind) continue;
    const d = Math.min(p.transitionIn.durationTicks, maxTransition(prev, p));
    out.push({ prev, next: p, from: p.startTicks - Math.floor(d / 2), to: p.startTicks + Math.ceil(d / 2), kind });
  }
  return out;
}

/** Set or clear (`t` undefined) the transition into a clip. No-op when there is no adjacent clip before it. */
export function setTransition(comp: Composition, id: string, t: Transition | undefined): Composition {
  return {
    ...comp,
    tracks: comp.tracks.map((track) => {
      const p = track.placements.find((q) => q.id === id);
      if (!p || (t && !previousAdjacent(track, p))) return track;
      return { ...track, placements: track.placements.map((q) => {
        if (q.id !== id) return q;
        const n: Placement = { ...q };
        if (t) n.transitionIn = { kind: t.kind, durationTicks: Math.max(1, Math.round(t.durationTicks)) };
        else delete n.transitionIn;
        return n;
      }) };
    }),
  };
}

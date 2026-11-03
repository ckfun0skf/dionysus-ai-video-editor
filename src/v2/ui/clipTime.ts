import { useCallback, useState } from "react";
import { sourceAt, TICKS_PER_SECOND, type Placement } from "../domain";

/** P29-CLIP-TIME: playhead time relative to a clip, or undefined when the playhead is outside it. */
export interface ClipTime { clip: number; source: number }

/** Clip-relative and source time (ticks) at timeline time `t`; source accounts for speed, reverse and freeze. */
export function clipTimeAt(p: Placement | undefined, t: number): ClipTime | undefined {
  if (!p || t < p.startTicks || t >= p.startTicks + p.durationTicks) return undefined;
  return { clip: t - p.startTicks, source: sourceAt(p, t) };
}

export const fmtSec = (ticks: number) => `${(ticks / TICKS_PER_SECOND).toFixed(1)}s`;
/** "Clip 1.0s · Source 6.0s" */
export const clipTimeText = (c: ClipTime) => `Clip ${fmtSec(c.clip)} · Source ${fmtSec(c.source)}`;

export type RelMode = "clip" | "src";
export const REL_MODE_KEY = "dionysus.v2.clipTimeMode";
export const relLabel = (c: ClipTime, mode: RelMode) => (mode === "src" ? `src ${fmtSec(c.source)}` : `+${fmtSec(c.clip)}`);

function readMode(): RelMode {
  try { return globalThis.localStorage?.getItem(REL_MODE_KEY) === "src" ? "src" : "clip"; } catch { return "clip"; }
}
/** The playhead label's mode, remembered in localStorage. */
export function useRelMode(): [RelMode, () => void] {
  const [mode, setMode] = useState<RelMode>(readMode);
  const toggle = useCallback(() => setMode((m) => {
    const next: RelMode = m === "clip" ? "src" : "clip";
    try { globalThis.localStorage?.setItem(REL_MODE_KEY, next); } catch { /* private mode */ }
    return next;
  }), []);
  return [mode, toggle];
}

/**
 * P2B: storyboard media the app makes by itself.
 * - Item 20: a still shot's colour / gradient background is drawn into its implicit "<shot>.background" image slot,
 *   again whenever the background changes (the version remembers what it was drawn from, `VersionInfo.bg`).
 * - Item 17: a last-frame slot gets the last frame of its shot's picked clip version as soon as that version is
 *   there (uploaded, picked or trimmed), once per clip version and trim.
 * The planning here is pure; the UI (ui/storyboard/useStoryAuto) draws, extracts and dispatches.
 */
import type { Project } from "./model";
import { TICKS_PER_SECOND } from "./time";
import { selectedOf, versionSpan, versionsOf, type Storyboard } from "./storyboard";
import type { StoryBackground, StoryColorStop } from "./storyJson";

/** A stable text for a background (+ aspect): equal text = same picture. */
export const backgroundSignature = (bg: StoryBackground, aspect: string) => `${aspect}|${JSON.stringify(bg)}`;

/** Pixel size for an aspect like "16:9" (long side 1920); unknown aspects get 1920×1080. */
export function aspectSize(aspect: string, long = 1920): { width: number; height: number } {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect.trim());
  const w = m ? Number(m[1]) : 16, h = m ? Number(m[2]) : 9;
  if (!(w > 0 && h > 0)) return { width: 1920, height: 1080 };
  return w >= h ? { width: long, height: Math.round((long * h) / w / 2) * 2 } : { width: Math.round((long * w) / h / 2) * 2, height: long };
}

/** Stops with every `at` filled in (missing ones spread evenly between their neighbours), sorted. */
export function resolvedStops(stops: StoryColorStop[]): { color: string; at: number }[] {
  const n = stops.length;
  const at = stops.map((s, i) => (s.at !== undefined ? s.at : i === 0 ? 0 : i === n - 1 ? 1 : undefined));
  for (let i = 1; i < n - 1; i++) {
    if (at[i] !== undefined) continue;
    let j = i; while (at[j] === undefined) j++;
    const a = at[i - 1]!, z = at[j]!;
    for (let k = i; k < j; k++) at[k] = a + ((z - a) * (k - i + 1)) / (j - i + 1);
  }
  return stops.map((s, i) => ({ color: s.color, at: at[i]! })).sort((x, y) => x.at - y.at);
}

/** The background as a CSS `background` value (previews). */
export function backgroundCss(bg: StoryBackground): string {
  if (typeof bg === "string") return bg;
  const stops = resolvedStops(bg.stops).map((s) => `${s.color} ${Math.round(s.at * 1000) / 10}%`).join(", ");
  return bg.type === "radial" ? `radial-gradient(circle at center, ${stops})` : `linear-gradient(${bg.angle ?? 180}deg, ${stops})`;
}

/**
 * Canvas gradient geometry matching CSS: a linear gradient at `angle` degrees covering a w×h box corner to corner; a
 * radial one from the centre to the farthest corner.
 */
export function gradientGeometry(bg: Exclude<StoryBackground, string>, w: number, h: number): { x0: number; y0: number; x1: number; y1: number; r?: number } {
  if (bg.type === "radial") return { x0: w / 2, y0: h / 2, x1: w / 2, y1: h / 2, r: Math.hypot(w, h) / 2 };
  const a = (((bg.angle ?? 180) % 360) * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return { x0: w / 2 - dx * half, y0: h / 2 - dy * half, x1: w / 2 + dx * half, y1: h / 2 + dy * half };
}

export interface BackgroundJob { slotId: string; background: StoryBackground; aspect: string; signature: string }
/** Background slots whose picked picture is missing or was drawn from another background. */
export function backgroundJobs(p: Project): BackgroundJob[] {
  const b = p.storyboard;
  if (!b) return [];
  return Object.values(b.slots).flatMap((s) => {
    if (s.implicit !== "background" || !s.background) return [];
    const signature = backgroundSignature(s.background, s.aspect);
    const v = selectedOf(p, s);
    return v && b.versions[v]?.bg === signature ? [] : [{ slotId: s.id, background: s.background, aspect: s.aspect, signature }];
  });
}

export interface LastFrameJob { slotId: string; shotId: string; versionId: string; blobKey: string; endSec?: number }
/**
 * Last-frame slots whose shot has a picked video clip version that no version of the slot was taken from (with the
 * current trim). Shots made as html or a still are skipped (their picture is not a video).
 */
export function lastFrameJobs(p: Project): LastFrameJob[] {
  const b: Storyboard | undefined = p.storyboard;
  if (!b) return [];
  return Object.values(b.slots).flatMap((s) => {
    if (s.source.type !== "lastFrame" || s.skipped) return [];
    const shot = b.shots[s.source.shotId];
    if (!shot || shot.clipSlot) return [];
    const vid = selectedOf(p, shot);
    const v = versionsOf(p, shot).find((x) => x.id === vid);
    if (!v || !v.media.durationTicks) return [];
    const span = versionSpan(b, v);
    const endTicks = span ? span.inTicks + span.lenTicks : v.media.durationTicks;
    const endSec = endTicks < v.media.durationTicks ? endTicks / TICKS_PER_SECOND : undefined;
    const done = versionsOf(p, s).some((x) => { const d = b.versions[x.id]?.derivedFrom; return d?.versionId === v.id && (b.versions[x.id]?.lfEnd ?? undefined) === endSec; });
    return done ? [] : [{ slotId: s.id, shotId: shot.id, versionId: v.id, blobKey: v.media.blobKey, ...(endSec !== undefined ? { endSec } : {}) }];
  });
}

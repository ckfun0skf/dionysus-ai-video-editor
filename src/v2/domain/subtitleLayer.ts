/**
 * V2-104: CapCut-style subtitle list editing on a text layer. A "cue" is a text clip on the layer;
 * every op is pure and keeps the clip's own style overrides. Cues never overlap and are ≥ 100 ms.
 */
import type { Composition, Placement, Subtitle, Track } from "./model";
import { formatSrt } from "./subtitles";

const TPS = 120_000;
export const MIN_CUE = TPS / 10;
export const NEW_CUE_TICKS = 2 * TPS;

const textOfP = (p: Placement): string => (p.text as { text?: string } | undefined)?.text ?? "";
const withText = (p: Placement, text: string): Placement => ({ ...p, text: { ...(p.text ?? {}), text } as Placement["text"] });
const sorted = (t: Track) => t.placements.filter((p) => p.clipType === "text").sort((a, b) => a.startTicks - b.startTicks);

export function cuesOf(track: Track): Subtitle[] {
  return sorted(track).map((p) => ({ id: p.id, startTicks: p.startTicks, durationTicks: p.durationTicks, text: textOfP(p) }));
}
export const layerToSrt = (track: Track) => formatSrt(cuesOf(track));
export const isSubtitleCapable = (t: Track) => t.kind === "text";

function onTrack(comp: Composition, trackId: string, f: (t: Track) => Placement[] | undefined): Composition {
  let changed = false;
  const tracks = comp.tracks.map((t) => { if (t.id !== trackId) return t; const ps = f(t); if (!ps) return t; changed = true; return { ...t, placements: ps.sort((a, b) => a.startTicks - b.startTicks) }; });
  return changed ? { ...comp, tracks } : comp;
}
const trackOf = (comp: Composition, id: string) => comp.tracks.find((t) => t.placements.some((p) => p.id === id));

export function setCueText(comp: Composition, id: string, text: string): Composition {
  const t = trackOf(comp, id); if (!t) return comp;
  return onTrack(comp, t.id, (tr) => tr.placements.map((p) => (p.id === id ? withText(p, text) : p)));
}

/** Set start/end; clamped between the neighbouring cues and to the minimum length. */
export function setCueTimes(comp: Composition, id: string, start: number, end: number): Composition {
  const t = trackOf(comp, id); if (!t) return comp;
  const list = sorted(t); const i = list.findIndex((p) => p.id === id);
  const lo = i > 0 ? list[i - 1].startTicks + list[i - 1].durationTicks : 0;
  const hi = i < list.length - 1 ? list[i + 1].startTicks : Infinity;
  let s = Math.max(lo, Math.round(start)); let e = Math.min(hi, Math.round(end));
  if (e - s < MIN_CUE) { if (s + MIN_CUE <= hi) e = s + MIN_CUE; else { e = hi; s = Math.max(lo, e - MIN_CUE); } }
  if (e - s < MIN_CUE) return comp;
  return onTrack(comp, t.id, (tr) => tr.placements.map((p) => (p.id === id ? { ...p, startTicks: s, durationTicks: e - s } : p)));
}

/** New empty cue right after `id` (up to 2 s, shortened to fit before the next cue). Unchanged if no room. */
export function addCueAfter(comp: Composition, id: string, newId: string, text = ""): Composition {
  const t = trackOf(comp, id); if (!t) return comp;
  const list = sorted(t); const i = list.findIndex((p) => p.id === id); const cur = list[i];
  const s = cur.startTicks + cur.durationTicks;
  const hi = i < list.length - 1 ? list[i + 1].startTicks : Infinity;
  const d = Math.min(NEW_CUE_TICKS, hi - s); if (d < MIN_CUE) return comp;
  const { keyframes: _k, ...base } = cur;
  return onTrack(comp, t.id, (tr) => [...tr.placements, withText({ ...base, id: newId, startTicks: s, durationTicks: d }, text)]);
}

export function deleteCue(comp: Composition, id: string): Composition {
  const t = trackOf(comp, id); if (!t) return comp;
  return onTrack(comp, t.id, (tr) => tr.placements.filter((p) => p.id !== id));
}

/** Split at text cursor `pos`: text divides there, time divides in proportion to characters. */
export function splitCue(comp: Composition, id: string, pos: number, newId: string): Composition {
  const t = trackOf(comp, id); if (!t) return comp;
  const p = t.placements.find((x) => x.id === id)!; const txt = textOfP(p);
  const a = txt.slice(0, pos).trim(), b = txt.slice(pos).trim();
  if (!a || !b || p.durationTicks < 2 * MIN_CUE) return comp;
  const at = Math.min(p.durationTicks - MIN_CUE, Math.max(MIN_CUE, Math.round((p.durationTicks * pos) / txt.length)));
  const { keyframes: _k, ...base } = p;
  return onTrack(comp, t.id, (tr) => [...tr.placements.filter((x) => x.id !== id), withText({ ...p, durationTicks: at }, a), withText({ ...base, id: newId, startTicks: p.startTicks + at, durationTicks: p.durationTicks - at }, b)]);
}

/** Merge `id` with the next cue: spans both, texts joined with a space. */
export function mergeNext(comp: Composition, id: string): Composition {
  const t = trackOf(comp, id); if (!t) return comp;
  const list = sorted(t); const i = list.findIndex((p) => p.id === id); const cur = list[i], nx = list[i + 1];
  if (!nx) return comp;
  const merged = withText({ ...cur, durationTicks: nx.startTicks + nx.durationTicks - cur.startTicks }, [textOfP(cur), textOfP(nx)].filter(Boolean).join(" "));
  return onTrack(comp, t.id, (tr) => [...tr.placements.filter((x) => x.id !== id && x.id !== nx.id), merged]);
}

export function countMatches(track: Track, find: string, matchCase = false): number {
  if (!find) return 0;
  const f = matchCase ? find : find.toLowerCase();
  return cuesOf(track).reduce((n, c) => n + ((matchCase ? c.text : c.text.toLowerCase()).split(f).length - 1), 0);
}

/** Literal find & replace in every cue of the layer. */
export function replaceAll(comp: Composition, trackId: string, find: string, repl: string, matchCase = false): Composition {
  if (!find) return comp;
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "g" : "gi");
  return onTrack(comp, trackId, (tr) => {
    let any = false;
    const ps = tr.placements.map((p) => { if (p.clipType !== "text") return p; const s = textOfP(p); const n = s.replace(re, () => repl); if (n === s) return p; any = true; return withText(p, n); });
    return any ? ps : undefined;
  });
}

export function activeCue(track: Track, time: number): string | undefined {
  return sorted(track).find((p) => time >= p.startTicks && time < p.startTicks + p.durationTicks)?.id;
}

/** "mm:ss.mmm" (or "h:mm:ss.mmm" past an hour) ↔ ticks. */
export function fmtTc(ticks: number): string {
  const ms = Math.round((ticks / TPS) * 1000); const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${h ? `${h}:` : ""}${p(m)}:${p(s)}.${p(ms % 1000, 3)}`;
}
export function parseTc(s: string): number | undefined {
  const m = s.trim().replace(",", ".").match(/^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const parts = [m[1], m[2]].filter((x) => x !== undefined).map(Number);
  const [h, mi] = parts.length === 2 ? parts : [0, parts[0] ?? 0];
  const sec = h * 3600 + mi * 60 + Number(m[3]);
  return Number.isFinite(sec) ? Math.round(sec * TPS) : undefined;
}

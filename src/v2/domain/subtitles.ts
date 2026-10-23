/** Subtitles: a per-composition list of timed text cues, with SRT import/export. Pure functions. */
import type { Composition, Subtitle } from "./model";
import { newId } from "./model";

const TPS = 120_000;
const MIN = TPS / 10; // 100 ms

function srtTime(ticks: number): string {
  const ms = Math.round((ticks / TPS) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** Parse SRT (also tolerates WebVTT-style "." millis and a WEBVTT header). Invalid blocks are skipped. */
export function parseSrt(text: string): Subtitle[] {
  const out: Subtitle[] = [];
  const re = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;
  for (const block of text.replace(/\r/g, "").replace(/^\uFEFF/, "").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) continue;
    const m = lines[i].match(re)!;
    const t = (h: string, mi: string, s: string, ms: string) => Math.round(((+h * 3600 + +mi * 60 + +s) * 1000 + +ms.padEnd(3, "0")) * (TPS / 1000));
    const start = t(m[1], m[2], m[3], m[4]), end = t(m[5], m[6], m[7], m[8]);
    const body = lines.slice(i + 1).join("\n").trim();
    if (end > start && body) out.push({ id: newId("sub"), startTicks: start, durationTicks: end - start, text: body });
  }
  return out.sort((a, b) => a.startTicks - b.startTicks);
}

export function formatSrt(subs: Subtitle[]): string {
  return [...subs].sort((a, b) => a.startTicks - b.startTicks)
    .map((s, i) => `${i + 1}\n${srtTime(s.startTicks)} --> ${srtTime(s.startTicks + s.durationTicks)}\n${s.text}\n`).join("\n");
}

export function subtitleAt(comp: Composition, t: number): Subtitle | undefined {
  return comp.subtitles?.find((s) => t >= s.startTicks && t < s.startTicks + s.durationTicks);
}

const put = (comp: Composition, subs: Subtitle[]): Composition => ({ ...comp, subtitles: [...subs].sort((a, b) => a.startTicks - b.startTicks) });

/** Add a cue at `start`; shortened so it does not overlap the next cue. Returns comp unchanged if no room. */
export function addSubtitle(comp: Composition, sub: Subtitle): Composition {
  const subs = comp.subtitles ?? [];
  const start = Math.max(0, Math.round(sub.startTicks));
  if (subs.some((s) => start >= s.startTicks && start < s.startTicks + s.durationTicks)) return comp;
  const next = Math.min(Infinity, ...subs.filter((s) => s.startTicks > start).map((s) => s.startTicks));
  const dur = Math.min(Math.round(sub.durationTicks), next - start);
  if (dur < MIN) return comp;
  return put(comp, [...subs, { ...sub, startTicks: start, durationTicks: dur }]);
}

export function updateSubtitle(comp: Composition, id: string, patch: Partial<Omit<Subtitle, "id">>): Composition {
  return put(comp, (comp.subtitles ?? []).map((s) => {
    if (s.id !== id) return s;
    const n = { ...s, ...patch };
    return { ...n, startTicks: Math.max(0, Math.round(n.startTicks)), durationTicks: Math.max(MIN, Math.round(n.durationTicks)) };
  }));
}

export function removeSubtitle(comp: Composition, id: string): Composition {
  return { ...comp, subtitles: (comp.subtitles ?? []).filter((s) => s.id !== id) };
}

/** Replace all cues (SRT import). */
export function setSubtitles(comp: Composition, subs: Subtitle[]): Composition { return put(comp, subs); }

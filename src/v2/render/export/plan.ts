/** Pure export planning: output size, frame times and the audio mix (no browser APIs). */
import { versionOf, compositionDuration, type Project } from "../../domain/model";
import { TICKS_PER_SECOND } from "../../domain/time";

export const RESOLUTIONS = { "720p": 720, "1080p": 1080, "2K": 1440, "4K": 2160 } as const;
export type Resolution = keyof typeof RESOLUTIONS;

/** Output size keeping the project aspect; both sides even (H.264 needs even dimensions). */
export function exportSize(res: Resolution, settings: { width: number; height: number }) {
  const h = RESOLUTIONS[res];
  const w = Math.round((h * settings.width) / settings.height);
  return { width: w - (w % 2), height: h - (h % 2) };
}

/** Timeline tick of every output frame. */
export function frameTimes(durationTicks: number, fps: number): number[] {
  const n = Math.ceil((durationTicks / TICKS_PER_SECOND) * fps - 1e-9);
  return Array.from({ length: n }, (_, i) => Math.round((i * TICKS_PER_SECOND) / fps));
}

export interface AudioSegment {
  blobKey: string;
  /** Seconds on the output timeline. */
  start: number;
  duration: number;
  /** Seconds into the source. */
  offset: number;
  rate: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** P3B-11: volume curve keys, seconds from the segment start → gain multiplier 0–2 (absent = flat 1). */
  keys?: { t: number; v: number }[];
  /** P3B-11: audio effect preset and amount (absent = dry). */
  fx?: { preset: string; amount: number };
}

/**
 * P1-SHORT-AUDIO: fades that fit inside a clip. A short clip whose fade-in and fade-out add up to more than its length
 * gets both scaled down proportionally, so the gain automation stays in time order and the clip is never silenced.
 */
export function fitFades(duration: number, fadeIn: number, fadeOut: number): { fadeIn: number; fadeOut: number } {
  const i = Math.max(0, fadeIn), o = Math.max(0, fadeOut), d = Math.max(0, duration);
  const k = i + o > d && i + o > 0 ? d / (i + o) : 1;
  return { fadeIn: i * k, fadeOut: o * k };
}

/** Gain automation for one segment, in time order: `set` holds a value from `at`, `ramp` reaches it linearly by `at`. */
export function gainEvents(s: Pick<AudioSegment, "start" | "duration" | "volume" | "fadeIn" | "fadeOut">): { type: "set" | "ramp"; value: number; at: number }[] {
  const { fadeIn, fadeOut } = fitFades(s.duration, s.fadeIn, s.fadeOut);
  const end = s.start + s.duration;
  const ev: { type: "set" | "ramp"; value: number; at: number }[] = [{ type: "set", value: fadeIn ? 0 : s.volume, at: s.start }];
  if (fadeIn) ev.push({ type: "ramp", value: s.volume, at: s.start + fadeIn });
  if (fadeOut) {
    if (end - fadeOut > s.start + fadeIn) ev.push({ type: "set", value: s.volume, at: end - fadeOut });
    ev.push({ type: "ramp", value: 0, at: end });
  }
  return ev;
}

/**
 * P3B-11: volume-curve automation for one segment (absolute seconds), matching the preview's evalKeys: the first
 * key's value holds before it, linear ramps between keys, the last value holds after. Empty without keys.
 */
export function keyEvents(s: Pick<AudioSegment, "start" | "keys">): { type: "set" | "ramp"; value: number; at: number }[] {
  const k = s.keys ?? [];
  if (!k.length) return [];
  const at0 = (t: number) => {
    if (t <= k[0].t) return k[0].v;
    for (let i = 1; i < k.length; i++) if (t <= k[i].t) return k[i - 1].v + ((k[i].v - k[i - 1].v) * (t - k[i - 1].t)) / (k[i].t - k[i - 1].t || 1);
    return k[k.length - 1].v;
  };
  return [{ type: "set", value: at0(0), at: s.start }, ...k.filter((x) => x.t > 0).map((x) => ({ type: "ramp" as const, value: x.v, at: s.start + x.t }))];
}

/** Every audible span: audio clips plus video clips' own sound (skips muted, reversed and frozen clips). */
export function audioPlan(project: Project): AudioSegment[] {
  const comp = project.compositions[project.rootCompositionId];
  const s = (t: number) => t / TICKS_PER_SECOND;
  const out: AudioSegment[] = [];
  for (const track of comp.tracks) {
    if (track.muted || track.hidden) continue;
    for (const p of track.placements) {
      if (p.clipType === "image" || p.clipType === "html" || p.reverse || p.freeze || (p.clipType === "video" && p.linkedAudio?.muted)) continue;
      const v = versionOf(project, p.source);
      if (!v || (p.volume ?? 1) <= 0) continue;
      if (p.durationTicks <= 0) continue;
      const f = fitFades(s(p.durationTicks), s(p.fadeInTicks ?? 0), s(p.fadeOutTicks ?? 0));
      out.push({ blobKey: v.media.blobKey, start: s(p.startTicks), duration: s(p.durationTicks), offset: s(p.sourceInTicks), rate: p.speed ?? 1, volume: p.volume ?? 1, ...f,
        ...(p.keyframes?.volume?.length ? { keys: p.keyframes.volume.map((k) => ({ t: s(k.t), v: k.v })) } : {}),
        ...(p.audioFx && p.audioFx.amount > 0 ? { fx: { ...p.audioFx } } : {}) });
    }
  }
  return out;
}

export const exportDuration = (p: Project) => compositionDuration(p.compositions[p.rootCompositionId]) / TICKS_PER_SECOND;

/** Safe download name from the project title. */
export const exportName = (name: string, ext: string) => `${name.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-") || "dionysus-export"}.${ext}`;

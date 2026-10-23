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
}

/** Every audible span: audio clips plus video clips' own sound (skips muted, reversed and frozen clips). */
export function audioPlan(project: Project): AudioSegment[] {
  const comp = project.compositions[project.rootCompositionId];
  const s = (t: number) => t / TICKS_PER_SECOND;
  const out: AudioSegment[] = [];
  for (const track of comp.tracks) {
    if (track.muted) continue;
    for (const p of track.placements) {
      if (p.clipType === "image" || p.clipType === "html" || p.reverse || p.freeze || (p.clipType === "video" && p.linkedAudio?.muted)) continue;
      const v = versionOf(project, p.source);
      if (!v || (p.volume ?? 1) <= 0) continue;
      out.push({ blobKey: v.media.blobKey, start: s(p.startTicks), duration: s(p.durationTicks), offset: s(p.sourceInTicks), rate: p.speed ?? 1, volume: p.volume ?? 1, fadeIn: s(p.fadeInTicks ?? 0), fadeOut: s(p.fadeOutTicks ?? 0) });
    }
  }
  return out;
}

export const exportDuration = (p: Project) => compositionDuration(p.compositions[p.rootCompositionId]) / TICKS_PER_SECOND;

/** Safe download name from the project title. */
export const exportName = (name: string, ext: string) => `${name.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-") || "dionysus-export"}.${ext}`;

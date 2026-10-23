/** Schema 3.0 domain model (MVP subset). Pure data; see docs/v2/MODULE_DESIGN.md §5. */
export const SCHEMA = "dionysus/3.0" as const;

export type MediaKind = "video" | "image" | "audio";
export type TrackKind = "video" | "audio" | "text";

export interface MediaRef {
  blobKey: string;
  mime: string;
  durationTicks?: number;
  width?: number;
  height?: number;
  thumbKey?: string;
}

export interface AssetVersion {
  id: string;
  createdAt: string;
  media: MediaRef;
  provenance: { source: "import" | "manual-generation" | "provider" | "derived" | "legacy"; promptText?: string; inputs: { assetId: string; versionId: string }[] };
}

export interface Asset {
  id: string;
  kind: MediaKind;
  name: string;
  versions: AssetVersion[];
  selectedVersionId?: string;
}

export type SourceRef = { kind: "assetVersion"; assetId: string; versionId: string };

export interface Placement {
  id: string;
  startTicks: number;
  durationTicks: number;
  sourceInTicks: number;
  source: SourceRef;
  clipType: MediaKind;
  volume?: number;
  /**
   * Owned child: the embedded source audio of a video placement. It is part of the placement, so it
   * follows every move/trim/split/delete. `muted` is set by Extract Audio (audio then lives on an audio track).
   */
  linkedAudio?: LinkedAudio;
}

export interface LinkedAudio { muted?: boolean }

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted?: boolean;
  hidden?: boolean;
  placements: Placement[];
}

export interface Composition {
  id: string;
  name: string;
  /** index 0 = top visual layer */
  tracks: Track[];
}

export interface Project {
  schema: typeof SCHEMA;
  id: string;
  name: string;
  settings: { width: number; height: number; fps: number };
  rootCompositionId: string;
  assets: Record<string, Asset>;
  compositions: Record<string, Composition>;
  meta: { createdAt: string; updatedAt: string };
}

/** Default still-image duration when placed on the timeline. */
export const DEFAULT_IMAGE_TICKS = 3 * 120_000;

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}${counter.toString(36)}`;
}

export function createProject(name = "Untitled project", now = new Date().toISOString()): Project {
  const compId = newId("comp");
  return {
    schema: SCHEMA,
    id: newId("proj"),
    name,
    settings: { width: 1920, height: 1080, fps: 30 },
    rootCompositionId: compId,
    assets: {},
    compositions: {
      [compId]: {
        id: compId,
        name: "Master Timeline",
        tracks: [
          { id: newId("trk"), kind: "video", name: "Video 1", placements: [] },
          { id: newId("trk"), kind: "audio", name: "Audio 1", placements: [] },
        ],
      },
    },
    meta: { createdAt: now, updatedAt: now },
  };
}

export function trackKindFor(kind: MediaKind): TrackKind {
  return kind === "audio" ? "audio" : "video";
}

export function compositionDuration(comp: Composition): number {
  let end = 0;
  for (const t of comp.tracks) for (const p of t.placements) end = Math.max(end, p.startTicks + p.durationTicks);
  return end;
}

export function findPlacement(comp: Composition, placementId: string): { track: Track; placement: Placement; index: number } | undefined {
  for (const track of comp.tracks) {
    const index = track.placements.findIndex((p) => p.id === placementId);
    if (index >= 0) return { track, placement: track.placements[index], index };
  }
  return undefined;
}

export function versionOf(project: Project, ref: SourceRef): AssetVersion | undefined {
  return project.assets[ref.assetId]?.versions.find((v) => v.id === ref.versionId);
}

/** Validates structural invariants; returns list of problems (empty = valid). */
export function validateComposition(comp: Composition): string[] {
  const errors: string[] = [];
  for (const t of comp.tracks) {
    const sorted = [...t.placements].sort((a, b) => a.startTicks - b.startTicks);
    sorted.forEach((p, i) => {
      if (![p.startTicks, p.durationTicks, p.sourceInTicks].every(Number.isInteger)) errors.push(`${p.id}: non-integer ticks`);
      if (p.durationTicks <= 0) errors.push(`${p.id}: non-positive duration`);
      if (p.startTicks < 0) errors.push(`${p.id}: negative start`);
      if (p.sourceInTicks < 0) errors.push(`${p.id}: negative source in`);
      if (trackKindFor(p.clipType) !== t.kind) errors.push(`${p.id}: ${p.clipType} on ${t.kind} track`);
      const next = sorted[i + 1];
      if (next && p.startTicks + p.durationTicks > next.startTicks) errors.push(`${p.id} overlaps ${next.id}`);
    });
  }
  return errors;
}

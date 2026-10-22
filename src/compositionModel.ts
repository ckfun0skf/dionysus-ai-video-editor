import type { Asset, DionysusProject } from "./types";

/** Canonical track kinds. Legacy effects/procedural lanes retain their original kind as metadata. */
export type CompositionTrackKind = "video" | "audio" | "text";

export type CompositionSourceReference =
  | { type: "asset"; assetId: string }
  | { type: "clip"; assetId: string; versionId?: string }
  | { type: "shot"; shotId: string; slotId?: string; versionId?: string }
  | { type: "script"; assetId?: string; scriptVersionId?: string }
  | { type: "missing"; originalKind: string; originalId?: string }
  | { type: "none" };

export interface CompositionTrack {
  id: string;
  name: string;
  kind: CompositionTrackKind;
  order: number;
  muted?: boolean;
  backgroundColor?: string;
  backgroundTransparent?: boolean;
  opacity?: number;
  originalKind?: string;
  legacyData?: Record<string, unknown>;
}

/** Audio embedded in a source video is owned by that video placement, not by an Audio Track. */
export interface CompositionLinkedAudioChild {
  id: string;
  name: string;
  source: CompositionSourceReference;
  sourceIn?: number;
  sourceOut?: number;
  muted?: boolean;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Preserve legacy clip metadata while this owned child is projected for playback/UI. */
  legacyData: Record<string, unknown>;
}

export interface CompositionPlacement {
  id: string;
  name: string;
  trackId: string;
  start: number;
  duration: number;
  order: number;
  source: CompositionSourceReference;
  sourceIn?: number;
  sourceOut?: number;
  linkedToPlacementId?: string;
  /** Embedded source audio follows this placement through timeline edits and persistence. */
  linkedAudioChildren?: CompositionLinkedAudioChild[];
  /** Preserve placement-level properties not yet promoted into the canonical contract. */
  legacyData: Record<string, unknown>;
}

export interface CompositionPinnedVersion {
  assetId?: string;
  versionId: string;
  shotId?: string;
  slotId?: string;
}

export interface CompositionProvenance {
  kind: "master-timeline-snapshot" | "derived-clip-version";
  sourceProjectId?: string;
  sourceCompositionId?: string;
  sourceUpdatedAt?: string;
  createdAt: string;
  pinnedVersions: CompositionPinnedVersion[];
}

export interface CompositionDocument {
  id: string;
  name: string;
  duration: number;
  frameRate: number;
  width: number;
  height: number;
  tracks: CompositionTrack[];
  placements: CompositionPlacement[];
  /** Immutable source/version provenance for a saved composition snapshot. */
  provenance?: CompositionProvenance;
  /** Embedded, version-pinned children make saved snapshots independent of later source-version edits. */
  nestedCompositions?: CompositionDocument[];
  /** Preserves fields not yet migrated to the canonical document. */
  legacyData?: Record<string, unknown>;
}

export interface CompositionMigrationWarning {
  code: "duplicate-storyboard-placement" | "missing-source" | "unsupported-track-kind";
  message: string;
  entityId?: string;
}

export interface CompositionMigrationResult {
  schemaVersion: "2.0";
  projectId: string;
  name: string;
  rootComposition: CompositionDocument;
  clipCompositions: CompositionDocument[];
  /** Legacy Shot Slot timelines are projected separately so their alternatives are not discarded or mistaken for Clip Assets. */
  legacyShotSlotCompositions: CompositionDocument[];
  /** Original project is retained as a defensive copy for a non-destructive transition. */
  sourceProject: DionysusProject;
  warnings: CompositionMigrationWarning[];
}

export function canonicalTrackKind(kind: string): CompositionTrackKind {
  if (kind === "audio") return "audio";
  if (kind === "text") return "text";
  return "video";
}

export function selectedShotVersion(project: DionysusProject, shotId?: string, slotId?: string): string | undefined {
  if (!shotId || !slotId) return undefined;
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  return shot?.slots.find((slot) => slot.id === slotId)?.selectedVersionId;
}

export function findAsset(project: DionysusProject, assetId?: string): Asset | undefined {
  if (!assetId) return undefined;
  return project.assets.find((asset) => asset.id === assetId);
}

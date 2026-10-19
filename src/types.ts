import type { CompositionDocument } from "./compositionModel";
export type AssetKind = "video" | "image" | "audio" | "script" | "clip" | "other";
export type ReferenceRole = "identity" | "face" | "body" | "outfit" | "pose" | "composition" | "lighting" | "environment" | "style" | "other";
export interface Asset { id: string; name: string; kind: AssetKind; path?: string; notes?: string; prompt?: string; modelName?: string; modelVersion?: string; generationParameters?: Record<string, unknown>; thumbnailPath?: string; canvasWidth?: number; canvasHeight?: number; html?: string; css?: string; js?: string; clipVersions?: ClipVersion[]; selectedClipVersionId?: string; createdAt?: string; updatedAt?: string }
export interface ReferenceItem { id: string; assetId: string; role: ReferenceRole; notes?: string }
export interface ReferenceProfile { id: string; name: string; entityType: "character" | "environment" | "prop" | "style" | "other"; references: ReferenceItem[] }
export interface ReferenceOverride { referenceId: string; action: "exclude" | "replace"; replacementAssetId?: string; role?: ReferenceRole }
export interface GenerationRecord { id: string; createdAt: string; prompt: string; referenceSnapshot: ReferenceItem[]; modelName?: string; modelVersion?: string; outputAssetId?: string }
export interface CompositionLayer { id: string; name: string; trackId?: string; kind: "video" | "image" | "audio" | "text" | "script" | "procedural" | "composition"; start: number; duration: number; assetId?: string; scriptVersionId?: string; childCompositionId?: string; clipVersionId?: string; referencedImageAssetIds?: string[]; sourceIn?: number; sourceOut?: number; shortSourceBehavior?: "once" | "loop"; prompt?: string; code?: string; html?: string; css?: string; modelName?: string; modelVersion?: string; thumbnailPath?: string; fitMode?: "contain" | "cover" | "fill"; x?: number; y?: number; width?: number; height?: number; backgroundColor?: string; borderColor?: string; borderWidth?: number; shape?: "rectangle" | "circle" | "rounded"; cornerRadius?: number; scale?: number; opacity?: number; animation?: "none" | "float" | "pulse" | "rotate"; animationDuration?: number; muted?: boolean; volume?: number; fadeIn?: number; fadeOut?: number }
export interface ClipVersion { id: string; name: string; description: string; duration: number; layers: CompositionLayer[]; /** Canonical, structure-preserving source snapshot. Legacy layers remain a compatibility projection until the shared editor is authoritative. */ compositionDocument?: CompositionDocument; /** Additive migration field: nested timelines share the same track model as the Master Timeline. */ tracks?: TimelineTrack[]; scriptVersionIds: string[]; generationRecords: GenerationRecord[] }
export interface ClipSlot { id: string; name: string; start: number; duration: number; selectedVersionId: string; versions: ClipVersion[] }
export interface StoryboardConnection { id?: string; fromShotId: string; toShotId: string; label?: string }
export interface Shot {
  id: string;
  title: string;
  intent: string;
  duration: number;
  /** Absolute start on the Master Timeline; omitted in legacy projects for sequential fallback. */
  masterStart?: number;
  /** Video track that owns this Shot on the Master Timeline. */
  masterTrackId?: string;
  status: "planned" | "in-progress" | "ready";
  referenceProfileIds: string[];
  referenceOverrides: ReferenceOverride[];
  slots: ClipSlot[];
  // SeeDance node canvas & AI prompt extensions
  canvasX?: number;
  canvasY?: number;
  generationPrompt?: string;
  cameraMovement?: string;
  shotType?: "establishing" | "wide" | "medium" | "close-up" | "extreme-close-up" | "aerial" | "point-of-view";
  previewAssetId?: string;
}
export interface TimelineTrack { id: string; name: string; kind: "video" | "audio" | "text" | "effects" | "procedural"; /** Original pre-normalization lane kind, if migrated. */ originalKind?: string; muted?: boolean; backgroundColor?: string; backgroundTransparent?: boolean; opacity?: number; x?: number; y?: number; width?: number; height?: number }
export interface TimelineClip { id: string; name: string; kind: "video" | "audio" | "text" | "procedural" | "clip"; trackId: string; start: number; duration: number; assetId?: string; scriptVersionId?: string; clipVersionId?: string; referencedImageAssetIds?: string[]; shotId?: string; slotId?: string; muted?: boolean; linkedVideoClipId?: string; sourceIn?: number; sourceOut?: number; shortSourceBehavior?: "once" | "loop"; fitMode?: "contain" | "cover" | "fill"; x?: number; y?: number; width?: number; height?: number; prompt?: string; code?: string; html?: string; css?: string; modelName?: string; modelVersion?: string; thumbnailPath?: string; volume?: number; fadeIn?: number; fadeOut?: number }
export interface DionysusProject {
  schemaVersion: "1.0";
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  frameRate: number;
  width: number;
  height: number;
  shots: Shot[];
  tracks: TimelineTrack[];
  timelineClips?: TimelineClip[];
  assets: Asset[];
  referenceProfiles: ReferenceProfile[];
  storyboardConnections?: StoryboardConnection[];
}

export type AssetKind = "video" | "image" | "audio" | "script" | "other";
export type ReferenceRole = "identity" | "face" | "body" | "outfit" | "pose" | "composition" | "lighting" | "environment" | "style" | "other";
export interface Asset { id: string; name: string; kind: AssetKind; path?: string; notes?: string }
export interface ReferenceItem { id: string; assetId: string; role: ReferenceRole; notes?: string }
export interface ReferenceProfile { id: string; name: string; entityType: "character" | "environment" | "prop" | "style" | "other"; references: ReferenceItem[] }
export interface ReferenceOverride { referenceId: string; action: "exclude" | "replace"; replacementAssetId?: string; role?: ReferenceRole }
export interface GenerationRecord { id: string; createdAt: string; prompt: string; referenceSnapshot: ReferenceItem[]; modelName?: string; modelVersion?: string; outputAssetId?: string }
export interface CompositionLayer { id: string; name: string; kind: "video" | "image" | "audio" | "text" | "script" | "composition"; start: number; duration: number; assetId?: string; scriptVersionId?: string; childCompositionId?: string }
export interface ClipVersion { id: string; name: string; description: string; duration: number; layers: CompositionLayer[]; scriptVersionIds: string[]; generationRecords: GenerationRecord[] }
export interface ClipSlot { id: string; name: string; start: number; duration: number; selectedVersionId: string; versions: ClipVersion[] }
export interface Shot { id: string; title: string; intent: string; duration: number; status: "planned" | "in-progress" | "ready"; referenceProfileIds: string[]; referenceOverrides: ReferenceOverride[]; slots: ClipSlot[] }
export interface TimelineTrack { id: string; name: string; kind: "video" | "audio" | "text" | "effects" }
export interface DionysusProject { schemaVersion: "1.0"; id: string; name: string; createdAt: string; updatedAt: string; frameRate: number; width: number; height: number; shots: Shot[]; tracks: TimelineTrack[]; assets: Asset[]; referenceProfiles: ReferenceProfile[] }

import type { DionysusProject } from "./types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString(value: unknown): value is string { return typeof value === "string"; }
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

const referenceRoles = new Set(["identity", "face", "body", "outfit", "pose", "composition", "lighting", "environment", "style", "other"]);
const assetKinds = new Set(["video", "image", "audio", "script", "other"]);
const layerKinds = new Set(["video", "image", "audio", "text", "script", "composition"]);
const trackKinds = new Set(["video", "audio", "text", "effects"]);
const shotStatuses = new Set(["planned", "in-progress", "ready"]);
const entityTypes = new Set(["character", "environment", "prop", "style", "other"]);

function isReferenceItem(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.assetId) &&
    isString(value.role) && referenceRoles.has(value.role) &&
    (value.notes === undefined || isString(value.notes));
}
function isReferenceOverride(value: unknown): boolean {
  if (!isRecord(value) || !isString(value.referenceId) ||
      (value.action !== "exclude" && value.action !== "replace")) return false;
  if (value.action === "replace" && !isString(value.replacementAssetId)) return false;
  return value.role === undefined || (isString(value.role) && referenceRoles.has(value.role));
}
function isGenerationRecord(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.createdAt) &&
    isString(value.prompt) && Array.isArray(value.referenceSnapshot) &&
    value.referenceSnapshot.every(isReferenceItem) &&
    (value.modelName === undefined || isString(value.modelName)) &&
    (value.modelVersion === undefined || isString(value.modelVersion)) &&
    (value.outputAssetId === undefined || isString(value.outputAssetId));
}
function isLayer(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.name) &&
    isString(value.kind) && layerKinds.has(value.kind) &&
    isFiniteNumber(value.start) && value.start >= 0 &&
    isFiniteNumber(value.duration) && value.duration > 0 &&
    (value.assetId === undefined || isString(value.assetId)) &&
    (value.scriptVersionId === undefined || isString(value.scriptVersionId)) &&
    (value.childCompositionId === undefined || isString(value.childCompositionId));
}
function isVersion(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.name) &&
    isString(value.description) && isFiniteNumber(value.duration) && value.duration > 0 &&
    Array.isArray(value.layers) && value.layers.every(isLayer) &&
    isStringArray(value.scriptVersionIds) &&
    Array.isArray(value.generationRecords) && value.generationRecords.every(isGenerationRecord);
}
function isSlot(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.name) &&
    isFiniteNumber(value.start) && value.start >= 0 &&
    isFiniteNumber(value.duration) && value.duration > 0 &&
    isString(value.selectedVersionId) &&
    Array.isArray(value.versions) && value.versions.length > 0 &&
    value.versions.every(isVersion) &&
    value.versions.some(version => isRecord(version) && version.id === value.selectedVersionId);
}
function isShot(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.title) &&
    isString(value.intent) && isFiniteNumber(value.duration) && value.duration > 0 &&
    isString(value.status) && shotStatuses.has(value.status) &&
    isStringArray(value.referenceProfileIds) &&
    Array.isArray(value.referenceOverrides) && value.referenceOverrides.every(isReferenceOverride) &&
    Array.isArray(value.slots) && value.slots.every(isSlot);
}
function isAsset(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.name) &&
    isString(value.kind) && assetKinds.has(value.kind) &&
    (value.path === undefined || isString(value.path)) &&
    (value.notes === undefined || isString(value.notes));
}
function isProfile(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.name) &&
    isString(value.entityType) && entityTypes.has(value.entityType) &&
    Array.isArray(value.references) && value.references.every(isReferenceItem);
}
function isTrack(value: unknown): boolean {
  return isRecord(value) && isString(value.id) && isString(value.name) &&
    isString(value.kind) && trackKinds.has(value.kind);
}

/** Validate imported JSON before it reaches React rendering or local persistence. */
export function validateProject(value: unknown): value is DionysusProject {
  if (!isRecord(value) || value.schemaVersion !== "1.0" ||
      !isString(value.id) || !isString(value.name) ||
      !isString(value.createdAt) || !isString(value.updatedAt) ||
      !isFiniteNumber(value.frameRate) || value.frameRate <= 0 ||
      !isFiniteNumber(value.width) || value.width <= 0 ||
      !isFiniteNumber(value.height) || value.height <= 0 ||
      !Array.isArray(value.shots) || !value.shots.every(isShot) ||
      !Array.isArray(value.tracks) || !value.tracks.every(isTrack) ||
      !Array.isArray(value.assets) || !value.assets.every(isAsset) ||
      !Array.isArray(value.referenceProfiles) || !value.referenceProfiles.every(isProfile)) return false;

  const assets = value.assets as UnknownRecord[];
  const profiles = value.referenceProfiles as UnknownRecord[];
  const shots = value.shots as UnknownRecord[];
  const assetIds = new Set(assets.map(asset => asset.id as string));
  const profileIds = new Set(profiles.map(profile => profile.id as string));
  const referenceIds = new Set<string>();

  for (const profile of profiles) {
    for (const reference of profile.references as UnknownRecord[]) {
      if (!assetIds.has(reference.assetId as string)) return false;
      referenceIds.add(reference.id as string);
    }
  }
  for (const shot of shots) {
    if (!(shot.referenceProfileIds as string[]).every(profileId => profileIds.has(profileId))) return false;
    for (const override of shot.referenceOverrides as UnknownRecord[]) {
      if (!referenceIds.has(override.referenceId as string)) return false;
      if (override.replacementAssetId !== undefined && !assetIds.has(override.replacementAssetId as string)) return false;
    }
    for (const slot of shot.slots as UnknownRecord[]) {
      for (const version of slot.versions as UnknownRecord[]) {
        for (const layer of version.layers as UnknownRecord[]) {
          if (layer.assetId !== undefined && !assetIds.has(layer.assetId as string)) return false;
        }
        for (const record of version.generationRecords as UnknownRecord[]) {
          if (record.outputAssetId !== undefined && !assetIds.has(record.outputAssetId as string)) return false;
          for (const reference of record.referenceSnapshot as UnknownRecord[]) {
            if (!assetIds.has(reference.assetId as string)) return false;
          }
        }
      }
    }
  }
  return true;
}

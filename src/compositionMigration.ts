import type { Asset, CompositionLayer, DionysusProject, Shot, TimelineClip, TimelineTrack } from "./types";
import { getMasterShotStart } from "./masterTimeline";
import {
  canonicalTrackKind,
  findAsset,
  selectedShotVersion,
  type CompositionDocument,
  type CompositionMigrationResult,
  type CompositionMigrationWarning,
  type CompositionPlacement,
  type CompositionSourceReference,
  type CompositionTrack,
} from "./compositionModel";

function record(value: object): Record<string, unknown> {
  return { ...value } as Record<string, unknown>;
}

function sourceForTimelineClip(project: DionysusProject, clip: TimelineClip): CompositionSourceReference {
  if (clip.shotId) {
    const versionId = selectedShotVersion(project, clip.shotId, clip.slotId);
    return {
      type: "shot",
      shotId: clip.shotId,
      ...(clip.slotId ? { slotId: clip.slotId } : {}),
      ...(versionId ? { versionId } : {}),
    };
  }
  if (clip.assetId) {
    const asset = findAsset(project, clip.assetId);
    if (!asset) return { type: "missing", originalKind: clip.kind, originalId: clip.assetId };
    if (asset.kind === "clip" || clip.kind === "clip") {
      const versionId = clip.clipVersionId ?? asset.selectedClipVersionId;
      return { type: "clip", assetId: clip.assetId, ...(versionId ? { versionId } : {}) };
    }
    return { type: "asset", assetId: clip.assetId };
  }
  if (clip.scriptVersionId) return { type: "script", scriptVersionId: clip.scriptVersionId };
  return { type: "none" };
}

/** Build one new canonical placement from domain metadata without re-migrating existing root placements. */
export function createRootCompositionPlacementForTimelineClip(
  project: DionysusProject,
  root: CompositionDocument,
  clip: TimelineClip,
): CompositionPlacement {
  const track = root.tracks.find(item => item.id === clip.trackId);
  if (!track) throw new Error("Cannot insert a placement on a missing Composition track.");
  const expectedKind = clip.kind === "audio" ? "audio" : clip.kind === "text" ? "text" : "video";
  if (track.kind !== expectedKind) throw new Error("This clip type cannot be placed on the selected Composition track.");
  const linkedId = clip.linkedVideoClipId;
  if (linkedId && !root.placements.some(item => item.id === linkedId)) {
    throw new Error("The linked video placement must exist in the canonical Composition before its audio can be inserted.");
  }
  return {
    id: clip.id,
    name: clip.name,
    trackId: clip.trackId,
    start: clip.start,
    duration: clip.duration,
    order: root.placements.filter(item => item.trackId === clip.trackId).reduce((max, item) => Math.max(max, item.order), -1) + 1,
    source: sourceForTimelineClip(project, clip),
    ...(clip.sourceIn !== undefined ? { sourceIn: clip.sourceIn } : {}),
    ...(clip.sourceOut !== undefined ? { sourceOut: clip.sourceOut } : {}),
    ...(linkedId ? { linkedToPlacementId: linkedId } : {}),
    legacyData: record(clip),
  };
}

function sourceForLayer(project: DionysusProject, layer: CompositionLayer): CompositionSourceReference {
  if (layer.kind === "composition" && layer.childCompositionId) {
    const asset = findAsset(project, layer.childCompositionId);
    if (!asset || asset.kind !== "clip") return { type: "missing", originalKind: layer.kind, originalId: layer.childCompositionId };
    return { type: "clip", assetId: layer.childCompositionId, ...(layer.clipVersionId ? { versionId: layer.clipVersionId } : {}) };
  }
  if (layer.assetId) {
    const asset = findAsset(project, layer.assetId);
    if (!asset) return { type: "missing", originalKind: layer.kind, originalId: layer.assetId };
    if (asset.kind === "clip") {
      const versionId = layer.clipVersionId ?? asset.selectedClipVersionId;
      return { type: "clip", assetId: asset.id, ...(versionId ? { versionId } : {}) };
    }
    return { type: "asset", assetId: layer.assetId };
  }
  if (layer.scriptVersionId) return { type: "script", scriptVersionId: layer.scriptVersionId };
  return { type: "none" };
}

function rootTracks(projectTracks: TimelineTrack[], warnings: CompositionMigrationWarning[]): CompositionTrack[] {
  return projectTracks.map((track, order) => {
    const kind = canonicalTrackKind(track.kind);
    if (track.kind !== kind) warnings.push({
      code: "unsupported-track-kind",
      entityId: track.id,
      message: `Legacy track kind "${track.kind}" was mapped to canonical "${kind}" while retaining originalKind.`,
    });
    return {
      id: track.id,
      name: track.name,
      kind,
      order,
      ...(track.muted !== undefined ? { muted: track.muted } : {}),
      ...(track.backgroundColor !== undefined ? { backgroundColor: track.backgroundColor } : {}),
      ...(track.backgroundTransparent !== undefined ? { backgroundTransparent: track.backgroundTransparent } : {}),
      ...(track.opacity !== undefined ? { opacity: track.opacity } : {}),
      ...(track.originalKind !== undefined ? { originalKind: track.originalKind } : track.kind !== kind ? { originalKind: track.kind } : {}),
      legacyData: record(track),
    };
  });
}

function masterShotTrackId(project: DionysusProject, shot: Shot): string {
  return shot.masterTrackId && project.tracks.some(track => track.id === shot.masterTrackId && track.kind === "video")
    ? shot.masterTrackId
    : project.tracks.find(track => track.kind === "video")?.id ?? "";
}

function masterShotPlacement(project: DionysusProject, shot: Shot, order: number): CompositionPlacement {
  return {
    id: shot.id,
    name: shot.title,
    trackId: masterShotTrackId(project, shot),
    start: getMasterShotStart(project.shots, shot.id),
    duration: shot.duration,
    order,
    source: { type: "shot", shotId: shot.id },
    legacyData: {
      entityType: "master-shot",
      masterTrackId: shot.masterTrackId,
      selectedSlotVersions: shot.slots.map(slot => ({ slotId: slot.id, selectedVersionId: slot.selectedVersionId })),
      legacyShot: record(shot),
    },
  };
}

function storyboardShotId(project: DionysusProject, clip: TimelineClip): string | undefined {
  if (clip.shotId && project.shots.some(shot => shot.id === clip.shotId)) return clip.shotId;
  return project.shots.find(shot => clip.id.startsWith("storyboard-" + shot.id + "-"))?.id;
}

function rootPlacements(project: DionysusProject, warnings: CompositionMigrationWarning[]): CompositionPlacement[] {
  const clips = project.timelineClips ?? [];
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  const shotIds = new Set(project.shots.map(shot => shot.id));
  const skippedStoryboardTargets = new Map<string, string>();
  const duplicateCandidates = new Set<string>();

  for (const clip of clips) {
    if (!clip.id.startsWith("storyboard-")) continue;
    const shotId = storyboardShotId(project, clip);
    if (!shotId) continue;
    duplicateCandidates.add(clip.id);
    skippedStoryboardTargets.set(clip.id, shotId);
    warnings.push({
      code: "duplicate-storyboard-placement",
      entityId: clip.id,
      message: `Skipped materialized Storyboard placement "${clip.id}" because Master Shot "${shotId}" is represented directly in the canonical root Composition.`,
    });
  }

  const masterPlacements = project.shots.map((shot, index) => masterShotPlacement(project, shot, index));
  const clipPlacements = clips.filter(clip => !duplicateCandidates.has(clip.id)).map((clip, order) => {
    const source = sourceForTimelineClip(project, clip);
    if (source.type === "missing") warnings.push({
      code: "missing-source",
      entityId: clip.id,
      message: `Placement "${clip.id}" references missing source "${source.originalId}". The reference is retained as missing.`,
    });
    const linkedTarget = clip.linkedVideoClipId
      ? skippedStoryboardTargets.get(clip.linkedVideoClipId) ?? clip.linkedVideoClipId
      : undefined;
    return {
      id: clip.id,
      name: clip.name,
      trackId: clip.trackId,
      start: clip.start,
      duration: clip.duration,
      order: project.shots.length + order,
      source,
      ...(clip.sourceIn !== undefined ? { sourceIn: clip.sourceIn } : {}),
      ...(clip.sourceOut !== undefined ? { sourceOut: clip.sourceOut } : {}),
      ...(linkedTarget && (byId.has(linkedTarget) || shotIds.has(linkedTarget)) ? { linkedToPlacementId: linkedTarget } : {}),
      legacyData: record(clip),
    };
  });

  const all = [...masterPlacements, ...clipPlacements];
  const trackOrder = new Map(project.tracks.map((track, index) => [track.id, index]));
  const sorted = [...all].sort((a, b) =>
    (trackOrder.get(a.trackId) ?? Number.MAX_SAFE_INTEGER) - (trackOrder.get(b.trackId) ?? Number.MAX_SAFE_INTEGER) ||
    a.start - b.start ||
    a.order - b.order
  );
  const orderById = new Map<string, number>();
  const perTrack = new Map<string, number>();
  for (const placement of sorted) {
    const order = perTrack.get(placement.trackId) ?? 0;
    orderById.set(placement.id, order);
    perTrack.set(placement.trackId, order + 1);
  }
  return all.map(placement => ({ ...placement, order: orderById.get(placement.id) ?? placement.order }));
}

function nestedTrackKind(layer: CompositionLayer): "video" | "audio" | "text" {
  if (layer.kind === "audio") return "audio";
  if (layer.kind === "text") return "text";
  return "video";
}

function versionComposition(
  id: string,
  name: string,
  version: NonNullable<Asset["clipVersions"]>[number],
  project: DionysusProject,
  warnings: CompositionMigrationWarning[],
  width: number,
  height: number,
  legacyData: Record<string, unknown>,
): CompositionDocument {
  // Once a Clip/Shot Slot Version has a canonical document, never reconstruct it from the
  // compatibility layers: doing so drops nested Composition trees, provenance and pinned children.
  if (version.composition) {
    const canonical = structuredClone(version.composition);
    return {
      ...canonical,
      legacyData: {
        ...(canonical.legacyData ?? {}),
        description: version.description,
        scriptVersionIds: [...version.scriptVersionIds],
        generationRecords: structuredClone(version.generationRecords),
      },
    };
  }

  const encounteredKinds: Array<"video" | "audio" | "text"> = [];
  for (const layer of version.layers) {
    const kind = nestedTrackKind(layer);
    if (!encounteredKinds.includes(kind)) encounteredKinds.push(kind);
  }
  const tracks: CompositionTrack[] = version.tracks?.length
    ? rootTracks(version.tracks, warnings)
    : encounteredKinds.map((kind, order) => ({
        id: `${id}:track:${kind}`,
        name: kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Text",
        kind,
        order,
      }));
  const trackByKind = new Map<string, string>();
  for (const track of tracks) if (!trackByKind.has(track.kind)) trackByKind.set(track.kind, track.id);
  const placements = version.layers.map((layer, order) => {
    const source = sourceForLayer(project, layer);
    if (source.type === "missing") warnings.push({
      code: "missing-source",
      entityId: layer.id,
      message: `Nested placement "${layer.id}" references missing source "${source.originalId}". The reference is retained as missing.`,
    });
    return {
      id: layer.id,
      name: layer.name,
      trackId: layer.trackId && tracks.some(track => track.id === layer.trackId) ? layer.trackId : trackByKind.get(nestedTrackKind(layer))!,
      start: layer.start,
      duration: layer.duration,
      order,
      source,
      ...(layer.sourceIn !== undefined ? { sourceIn: layer.sourceIn } : {}),
      ...(layer.sourceOut !== undefined ? { sourceOut: layer.sourceOut } : {}),
      legacyData: record(layer),
    };
  });
  return {
    id,
    name,
    duration: version.duration,
    frameRate: project.frameRate,
    width,
    height,
    tracks,
    placements,
    legacyData: {
      ...legacyData,
      description: version.description,
      scriptVersionIds: [...version.scriptVersionIds],
      generationRecords: structuredClone(version.generationRecords),
    },
  };
}

function clipComposition(asset: Asset, version: NonNullable<Asset["clipVersions"]>[number], project: DionysusProject, warnings: CompositionMigrationWarning[]): CompositionDocument {
  return versionComposition(
    `composition:${asset.id}:${version.id}`,
    `${asset.name} — ${version.name}`,
    version,
    project,
    warnings,
    asset.canvasWidth ?? project.width,
    asset.canvasHeight ?? project.height,
    { assetId: asset.id, clipVersionId: version.id },
  );
}

function legacyShotSlotComposition(shot: Shot, slot: Shot["slots"][number], version: Shot["slots"][number]["versions"][number], project: DionysusProject, warnings: CompositionMigrationWarning[]): CompositionDocument {
  return versionComposition(
    `composition:legacy-shot-slot:${shot.id}:${slot.id}:${version.id}`,
    `${shot.title} — ${slot.name} — ${version.name}`,
    version,
    project,
    warnings,
    project.width,
    project.height,
    { legacyEntityType: "shot-slot-version", shotId: shot.id, slotId: slot.id, versionId: version.id, selected: slot.selectedVersionId === version.id },
  );
}

/**
 * Projects a schema-1.0 project into the canonical Composition shape without mutating or replacing
 * the source project. This is an adapter/projection until import/export is migrated.
 */
export function migrateLegacyProjectToComposition(project: DionysusProject): CompositionMigrationResult {
  const warnings: CompositionMigrationWarning[] = [];
  const tracks = rootTracks(project.tracks, warnings);
  const placements = rootPlacements(project, warnings);
  const placementEnd = placements.reduce((end, placement) => Math.max(end, placement.start + placement.duration), 0);
  const rootComposition: CompositionDocument = {
    id: `composition:project:${project.id}:master`,
    name: `${project.name} — Master Timeline`,
    duration: placementEnd,
    frameRate: project.frameRate,
    width: project.width,
    height: project.height,
    tracks,
    placements,
    legacyData: {
      storyboardConnections: structuredClone(project.storyboardConnections ?? []),
      sourceTrackIds: project.tracks.map(track => track.id),
    },
  };
  const clipCompositions = project.assets
    .filter(asset => asset.kind === "clip")
    .flatMap(asset => (asset.clipVersions ?? []).map(version => clipComposition(asset, version, project, warnings)));
  const legacyShotSlotCompositions = project.shots.flatMap(shot =>
    shot.slots.flatMap(slot => slot.versions.map(version => legacyShotSlotComposition(shot, slot, version, project, warnings)))
  );
  return {
    schemaVersion: "2.0",
    projectId: project.id,
    name: project.name,
    rootComposition,
    clipCompositions,
    legacyShotSlotCompositions,
    sourceProject: structuredClone(project),
    warnings,
  };
}


/**
 * Deterministically projects canonical root tracks/placements into the schema-1.0 compatibility
 * shape. Domain data not represented by root Composition (assets, references, scripts, nested
 * version snapshots, etc.) is retained from the supplied project.
 */
export function projectRootCompositionToLegacy(
  project: DionysusProject,
  rootComposition: CompositionDocument,
): DionysusProject {
  const source = structuredClone(project);
  const tracks = [...rootComposition.tracks]
    .sort((a, b) => a.order - b.order)
    .map(track => {
      const legacy = track.legacyData as unknown as TimelineTrack | undefined;
      const existing = source.tracks.find(item => item.id === track.id);
      const legacyKind = legacy?.kind ?? track.originalKind ?? track.kind;
      return {
        ...(existing ? { ...existing, ...(legacy ?? {}) } : legacy ?? { id: track.id, name: track.name, kind: legacyKind }),
        id: track.id,
        name: track.name,
        kind: legacyKind,
        ...(track.muted !== undefined ? { muted: track.muted } : {}),
        ...(track.backgroundColor !== undefined ? { backgroundColor: track.backgroundColor } : {}),
        ...(track.backgroundTransparent !== undefined ? { backgroundTransparent: track.backgroundTransparent } : {}),
        ...(track.opacity !== undefined ? { opacity: track.opacity } : {}),
      } as TimelineTrack;
    });
  const placementsById = new Map(rootComposition.placements.map(placement => [placement.id, placement]));
  const sourceStarts = new Map(source.shots.map(shot => [shot.id, getMasterShotStart(source.shots, shot.id)]));
  const materializeShotStarts = source.shots.some(shot => {
    const placement = placementsById.get(shot.id);
    return Boolean(placement && (shot.masterStart !== undefined || placement.start !== sourceStarts.get(shot.id)));
  });
  const shots = source.shots
    .filter(shot => placementsById.has(shot.id))
    .map(shot => {
      const placement = placementsById.get(shot.id)!;
      if (placement.legacyData.entityType !== "master-shot") return shot;
      const legacyTrack = tracks.find(track => track.id === placement.trackId && track.kind === "video");
      const defaultVideoTrackId = source.tracks.find(track => track.kind === "video")?.id;
      return {
        ...shot,
        ...(materializeShotStarts || shot.masterStart !== undefined ? { masterStart: placement.start } : {}),
        duration: placement.duration,
        ...(legacyTrack && (shot.masterTrackId !== undefined || legacyTrack.id !== defaultVideoTrackId)
          ? { masterTrackId: legacyTrack.id }
          : {}),
      };
    });
  const existingClips = new Map((source.timelineClips ?? []).map(clip => [clip.id, clip]));
  const placedClips = rootComposition.placements
    .filter(placement => placement.legacyData.entityType !== "master-shot")
    .map(placement => {
      const legacy = placement.legacyData as unknown as TimelineClip;
      const existing = existingClips.get(placement.id);
      const base = existing ? { ...existing, ...legacy } : legacy;
      if (!base || typeof base.kind !== "string") {
        throw new Error(`Root Composition placement "${placement.id}" has no compatible legacy clip metadata.`);
      }
      const sourceRef = placement.source;
      const {
        assetId: _oldAssetId, shotId: _oldShotId, slotId: _oldSlotId,
        sourceIn: _oldSourceIn, sourceOut: _oldSourceOut,
        linkedVideoClipId: _oldLinkedVideoClipId, ...baseFields
      } = base;
      const assetId = sourceRef.type === "asset" || sourceRef.type === "clip" ? sourceRef.assetId
        : sourceRef.type === "missing" ? sourceRef.originalId : undefined;
      const shotId = sourceRef.type === "shot" ? sourceRef.shotId : undefined;
      const slotId = sourceRef.type === "shot" ? sourceRef.slotId : undefined;
      const clipVersionId = sourceRef.type === "clip" ? sourceRef.versionId : undefined;
      return {
        ...baseFields,
        id: placement.id,
        name: placement.name,
        trackId: placement.trackId,
        start: placement.start,
        duration: placement.duration,
        ...(assetId ? { assetId } : {}),
        ...(shotId ? { shotId } : {}),
        ...(slotId ? { slotId } : {}),
        ...(clipVersionId ? { clipVersionId } : {}),
        ...(placement.sourceIn !== undefined ? { sourceIn: placement.sourceIn } : {}),
        ...(placement.sourceOut !== undefined ? { sourceOut: placement.sourceOut } : {}),
        ...(placement.linkedToPlacementId ? { linkedVideoClipId: placement.linkedToPlacementId } : {}),
      } as TimelineClip;
    });
  // Storyboard materializations are compatibility-only duplicates of Master Shots. Preserve them,
  // translating their start by the canonical shot delta so old consumers remain aligned.
  const storyboardClips = (source.timelineClips ?? []).filter(clip => clip.id.startsWith("storyboard-") && rootComposition.tracks.some(track => track.id === clip.trackId)).map(clip => {
    const shotId = clip.shotId ?? source.shots.find(shot => clip.id.startsWith("storyboard-" + shot.id + "-"))?.id;
    if (!shotId) return clip;
    const oldShot = source.shots.find(shot => shot.id === shotId);
    const newShot = shots.find(shot => shot.id === shotId);
    if (!oldShot || !newShot) return clip;
    const oldStart = getMasterShotStart(source.shots, shotId);
    const newStart = getMasterShotStart(shots, shotId);
    const delta = newStart - oldStart;
    const newTrack = newShot.masterTrackId;
    return { ...clip, start: Math.max(0, clip.start + delta), ...(clip.kind === "video" && newTrack ? { trackId: newTrack } : {}) };
  });
  const nonStoryboardClips = placedClips.filter(clip => !clip.id.startsWith("storyboard-"));
  return {
    ...source,
    tracks,
    shots,
    timelineClips: [...nonStoryboardClips, ...storyboardClips],
  };
}

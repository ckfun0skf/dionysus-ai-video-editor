import type { ClipVersion, DionysusProject, GenerationRecord } from "./types";
import type { CompositionDocument, CompositionPinnedVersion } from "./compositionModel";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import { collectCompositionLayers, getCompositionDuration } from "./compositionRenderer";

/**
 * Capture a structurally editable Master Timeline snapshot.
 * The layers array remains a compatibility/render projection; composition is the lossless editable tree.
 */
export function createClipVersionSnapshot(
  project: DionysusProject,
  options: { assetId: string; versionId: string; versionName: string; createdAt?: string; rootComposition?: CompositionDocument },
): ClipVersion {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const migrated = migrateLegacyProjectToComposition(project);
  const root = structuredClone(options.rootComposition ?? migrated.rootComposition);
  const snapshotProject = options.rootComposition ? projectRootCompositionToLegacy(project, root) : project;
  const flattenedLayers = structuredClone(collectCompositionLayers(snapshotProject));
  const duration = Math.max(0.1, root.duration, getCompositionDuration(flattenedLayers));

  const pinnedVersions: CompositionPinnedVersion[] = [];
  const pinKeys = new Set<string>();
  const addPin = (pin: CompositionPinnedVersion) => {
    const key = [pin.assetId ?? "", pin.versionId, pin.shotId ?? "", pin.slotId ?? ""].join("|");
    if (pinKeys.has(key)) return;
    pinKeys.add(key);
    pinnedVersions.push(pin);
  };

  const compositionForClip = (assetId: string, versionId: string): CompositionDocument | undefined => {
    const asset = project.assets.find(item => item.id === assetId && item.kind === "clip");
    const version = asset?.clipVersions?.find(item => item.id === versionId);
    if (!asset || !version) return undefined;
    if (version.composition) return structuredClone(version.composition);
    return migrated.clipCompositions.find(document =>
      document.legacyData?.assetId === assetId && document.legacyData?.clipVersionId === versionId
    );
  };

  const attachChildren = (
    document: CompositionDocument,
    ancestry: Set<string>,
    includeSelectedShotSlots = false,
  ): CompositionDocument => {
    // A saved canonical child may already contain a deliberately pinned subtree. Preserve that
    // subtree verbatim; only append referenced children that are not already embedded.
    const children: CompositionDocument[] = structuredClone(document.nestedCompositions ?? []);
    const childIds = new Set(children.map(child => child.id));
    for (const placement of document.placements) {
      if (placement.source.type !== "clip" || !placement.source.versionId) continue;
      const key = placement.source.assetId + "@" + placement.source.versionId;
      addPin({ assetId: placement.source.assetId, versionId: placement.source.versionId });
      if (ancestry.has(key)) continue;
      const child = compositionForClip(placement.source.assetId, placement.source.versionId);
      if (!child || childIds.has(child.id)) continue;
      childIds.add(child.id);
      children.push(attachChildren(child, new Set([...ancestry, key])));
    }
    if (includeSelectedShotSlots) {
      for (const shot of project.shots) {
        for (const slot of shot.slots) {
          const selected = slot.versions.find(version => version.id === slot.selectedVersionId);
          if (!selected) continue;
          addPin({ shotId: shot.id, slotId: slot.id, versionId: selected.id });
          const child = migrated.legacyShotSlotCompositions.find(document =>
            document.legacyData?.shotId === shot.id
            && document.legacyData?.slotId === slot.id
            && document.legacyData?.versionId === selected.id
          );
          if (!child || childIds.has(child.id)) continue;
          childIds.add(child.id);
          children.push(attachChildren(child, ancestry));
        }
      }
    }
    return { ...structuredClone(document), nestedCompositions: children };
  };

  const rootWithChildren = attachChildren(root, new Set(), true);
  const selectedVersions = project.shots.flatMap(shot => shot.slots.flatMap(slot => {
    const selected = slot.versions.find(version => version.id === slot.selectedVersionId);
    return selected ? [selected] : [];
  }));
  const scriptVersionIds = [...new Set(selectedVersions.flatMap(version => version.scriptVersionIds))];
  const recordsById = new Map<string, GenerationRecord>();
  for (const version of selectedVersions) {
    for (const record of version.generationRecords) {
      if (!recordsById.has(record.id)) recordsById.set(record.id, structuredClone(record));
    }
  }

  const composition: CompositionDocument = {
    ...rootWithChildren,
    id: "composition:" + options.assetId + ":" + options.versionId,
    name: options.versionName,
    duration,
    tracks: structuredClone(rootWithChildren.tracks),
    placements: structuredClone(rootWithChildren.placements),
    provenance: {
      kind: "master-timeline-snapshot",
      sourceProjectId: project.id,
      sourceCompositionId: root.id,
      sourceUpdatedAt: project.updatedAt,
      createdAt,
      pinnedVersions,
    },
    legacyData: {
      ...(rootWithChildren.legacyData ?? {}),
      snapshot: {
        ownerAssetId: options.assetId,
        sourceProjectId: project.id,
        sourceProjectName: project.name,
        sourceCompositionId: root.id,
        sourceUpdatedAt: project.updatedAt,
      },
    },
  };

  return {
    id: options.versionId,
    name: options.versionName,
    description: "Structurally editable snapshot of " + project.name + " Master Timeline",
    duration,
    layers: flattenedLayers,
    tracks: structuredClone(project.tracks),
    scriptVersionIds,
    generationRecords: [...recordsById.values()],
    composition,
  };
}

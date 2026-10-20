import type { DionysusProject } from "./types";
import { migrateLegacyProjectToComposition } from "./compositionMigration";
import type { CompositionDocument } from "./compositionModel";
import { assertValidCompositionDocument } from "./compositionCommands";
import { getMasterShotStart } from "./masterTimeline";

export const PROJECT_DOCUMENT_FORMAT = "dionysus-project-document" as const;
export const PROJECT_DOCUMENT_VERSION = "2.0" as const;

/**
 * Versioned envelope: root Composition is the canonical root timeline snapshot, while the
 * schema-1.0 project remains a deterministic compatibility projection for existing UI consumers.
 */
export interface DionysusProjectDocumentV2 {
  format: typeof PROJECT_DOCUMENT_FORMAT;
  documentVersion: typeof PROJECT_DOCUMENT_VERSION;
  project: DionysusProject;
  compositionModel: {
    schemaVersion: "2.0";
    projectId: string;
    name: string;
    rootComposition: ReturnType<typeof migrateLegacyProjectToComposition>["rootComposition"];
    clipCompositions: ReturnType<typeof migrateLegacyProjectToComposition>["clipCompositions"];
    legacyShotSlotCompositions: ReturnType<typeof migrateLegacyProjectToComposition>["legacyShotSlotCompositions"];
    warnings: ReturnType<typeof migrateLegacyProjectToComposition>["warnings"];
  };
}

export type ReadProjectDocumentResult = {
  project: DionysusProject;
  sourceDocumentVersion: "1.0" | "2.0";
  compositionModel?: DionysusProjectDocumentV2["compositionModel"];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createProjectDocument(project: DionysusProject, canonicalRoot?: CompositionDocument): DionysusProjectDocumentV2 {
  const migrated = migrateLegacyProjectToComposition(project);
  const rootComposition = canonicalRoot ? structuredClone(canonicalRoot) : migrated.rootComposition;
  assertValidCompositionDocument(rootComposition);
  return {
    format: PROJECT_DOCUMENT_FORMAT,
    documentVersion: PROJECT_DOCUMENT_VERSION,
    project: structuredClone(project),
    compositionModel: {
      schemaVersion: migrated.schemaVersion,
      projectId: migrated.projectId,
      name: migrated.name,
      rootComposition,
      clipCompositions: migrated.clipCompositions,
      legacyShotSlotCompositions: migrated.legacyShotSlotCompositions,
      warnings: migrated.warnings,
    },
  };
}

/** Read both legacy schema-1.0 files and the versioned compatibility envelope without data loss. */
export function readProjectDocument(value: unknown): ReadProjectDocumentResult {
  if (!isRecord(value)) throw new Error("Invalid Dionysus project document.");
  if (value.format === PROJECT_DOCUMENT_FORMAT) {
    if (value.documentVersion !== PROJECT_DOCUMENT_VERSION || !isRecord(value.project) || !isRecord(value.compositionModel)) {
      throw new Error("Unsupported or malformed Dionysus project document version.");
    }
    if (value.project.schemaVersion !== "1.0" || value.compositionModel.schemaVersion !== "2.0") {
      throw new Error("The project document contains an unsupported schema version.");
    }

    // The legacy project remains authoritative during the transition, but the stored projection
    // must identify that same project. Reject mismatched envelopes instead of silently pairing
    // one project's editable data with another project's Composition metadata.
    const project = value.project as unknown as DionysusProject;
    const compositionModel = value.compositionModel;
    if (
      compositionModel.projectId !== project.id ||
      compositionModel.name !== project.name ||
      !isRecord(compositionModel.rootComposition) ||
      compositionModel.rootComposition.id !== `composition:project:${project.id}:master`
    ) {
      throw new Error("The project document contains inconsistent Composition metadata.");
    }

    // Validate the canonical root snapshot independently from nested version snapshots. Root
    // placements may legitimately contain edits that are not recreated by legacy migration.
    const root = compositionModel.rootComposition as unknown as CompositionDocument;
    assertValidCompositionDocument(root);
    const rootById = new Map(root.placements.map(placement => [placement.id, placement]));
    for (const shot of project.shots) {
      const placement = rootById.get(shot.id);
      if (!placement || placement.legacyData.entityType !== "master-shot" ||
          placement.start !== getMasterShotStart(project.shots, shot.id) ||
          placement.duration !== shot.duration ||
          (shot.masterTrackId && placement.trackId !== shot.masterTrackId)) {
        throw new Error("The project document contains root Composition placements that do not match the compatibility project.");
      }
    }
    for (const clip of (project.timelineClips ?? []).filter(item => !item.id.startsWith("storyboard-"))) {
      const placement = rootById.get(clip.id);
      if (!placement || placement.start !== clip.start || placement.duration !== clip.duration ||
          placement.trackId !== clip.trackId ||
          placement.sourceIn !== clip.sourceIn || placement.sourceOut !== clip.sourceOut ||
          placement.linkedToPlacementId !== clip.linkedVideoClipId) {
        throw new Error("The project document contains root Composition clips that do not match the compatibility project.");
      }
    }
    const projectClipIds = new Set((project.timelineClips ?? []).filter(clip => !clip.id.startsWith("storyboard-")).map(clip => clip.id));
    for (const placement of root.placements) {
      if (placement.legacyData.entityType === "master-shot") continue;
      if (!projectClipIds.has(placement.id)) {
        throw new Error("The project document contains a stale or inconsistent Composition projection: root placement has no compatibility clip.");
      }
    }
    const expected = migrateLegacyProjectToComposition(project);
    if (
      JSON.stringify(compositionModel.clipCompositions) !== JSON.stringify(expected.clipCompositions) ||
      JSON.stringify(compositionModel.legacyShotSlotCompositions) !== JSON.stringify(expected.legacyShotSlotCompositions) ||
      JSON.stringify(compositionModel.warnings) !== JSON.stringify(expected.warnings)
    ) {
      throw new Error("The project document contains stale or inconsistent nested Composition snapshots.");
    }

    return { project, sourceDocumentVersion: "2.0", compositionModel: compositionModel as unknown as DionysusProjectDocumentV2["compositionModel"] };
  }
  if (value.schemaVersion === "1.0") {
    return { project: value as unknown as DionysusProject, sourceDocumentVersion: "1.0" };
  }
  throw new Error("Unsupported Dionysus project file. Expected a schema-1.0 project or versioned 2.0 document.");
}

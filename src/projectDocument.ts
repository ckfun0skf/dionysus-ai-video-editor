import type { DionysusProject } from "./types";
import { migrateLegacyProjectToComposition } from "./compositionMigration";

export const PROJECT_DOCUMENT_FORMAT = "dionysus-project-document" as const;
export const PROJECT_DOCUMENT_VERSION = "2.0" as const;

/**
 * Transitional versioned envelope. The schema-1.0 project remains authoritative for compatibility;
 * the canonical Composition projection is stored alongside it so imports can migrate safely later.
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createProjectDocument(project: DionysusProject): DionysusProjectDocumentV2 {
  const migrated = migrateLegacyProjectToComposition(project);
  return {
    format: PROJECT_DOCUMENT_FORMAT,
    documentVersion: PROJECT_DOCUMENT_VERSION,
    project: structuredClone(project),
    compositionModel: {
      schemaVersion: migrated.schemaVersion,
      projectId: migrated.projectId,
      name: migrated.name,
      rootComposition: migrated.rootComposition,
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

    // Verify the persisted projection against the authoritative legacy payload. Otherwise a
    // hand-edited/stale envelope could carry Composition placements that do not correspond to
    // the project the editor will actually load.
    const expected = migrateLegacyProjectToComposition(project);
    if (
      JSON.stringify(compositionModel.rootComposition) !== JSON.stringify(expected.rootComposition) ||
      JSON.stringify(compositionModel.clipCompositions) !== JSON.stringify(expected.clipCompositions) ||
      JSON.stringify(compositionModel.legacyShotSlotCompositions) !== JSON.stringify(expected.legacyShotSlotCompositions) ||
      JSON.stringify(compositionModel.warnings) !== JSON.stringify(expected.warnings)
    ) {
      throw new Error("The project document contains a stale or inconsistent Composition projection.");
    }

    return { project, sourceDocumentVersion: "2.0" };
  }
  if (value.schemaVersion === "1.0") {
    return { project: value as unknown as DionysusProject, sourceDocumentVersion: "1.0" };
  }
  throw new Error("Unsupported Dionysus project file. Expected a schema-1.0 project or versioned 2.0 document.");
}

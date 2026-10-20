import type { DionysusProject } from "./types";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import type { CompositionDocument } from "./compositionModel";
import { assertValidCompositionDocument } from "./compositionCommands";

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

function readCompositionSnapshots(value: unknown, label: string): CompositionDocument[] {
  if (!Array.isArray(value)) throw new Error("The project document contains malformed " + label + " snapshots.");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error("The project document contains an invalid " + label + " snapshot at index " + index + ".");
    const snapshot = item as unknown as CompositionDocument;
    assertValidCompositionDocument(snapshot);
    return structuredClone(snapshot);
  });
}

function readCompositionWarnings(value: unknown): DionysusProjectDocumentV2["compositionModel"]["warnings"] {
  if (!Array.isArray(value) || value.some(item =>
    !isRecord(item) || typeof item.code !== "string" || typeof item.message !== "string" ||
    (item.entityId !== undefined && typeof item.entityId !== "string")
  )) throw new Error("The project document contains malformed Composition migration warnings.");
  return structuredClone(value) as DionysusProjectDocumentV2["compositionModel"]["warnings"];
}

export function createProjectDocument(project: DionysusProject, canonicalRoot?: CompositionDocument): DionysusProjectDocumentV2 {
  const migrated = migrateLegacyProjectToComposition(project);
  const rootComposition = canonicalRoot ? structuredClone(canonicalRoot) : migrated.rootComposition;
  assertValidCompositionDocument(rootComposition);
  // Never export stale schema-1.0 placement geometry next to a different canonical root.
  const projectedProject = projectRootCompositionToLegacy(project, rootComposition);
  const projectedModel = migrateLegacyProjectToComposition(projectedProject);
  return {
    format: PROJECT_DOCUMENT_FORMAT,
    documentVersion: PROJECT_DOCUMENT_VERSION,
    project: structuredClone(projectedProject),
    compositionModel: {
      schemaVersion: projectedModel.schemaVersion,
      projectId: projectedModel.projectId,
      name: projectedModel.name,
      rootComposition,
      clipCompositions: projectedModel.clipCompositions,
      legacyShotSlotCompositions: projectedModel.legacyShotSlotCompositions,
      warnings: projectedModel.warnings,
    },
  };
}

/** Read both legacy schema-1.0 files and the versioned compatibility envelope without data loss. */
export function readProjectDocument(value: unknown, includeCompositionModel = false): ReadProjectDocumentResult {
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

    // Validate canonical snapshots independently. Their timing/source/track/link values are
    // allowed to differ from a stale schema-1.0 projection; that projection is rebuilt from root.
    const root = compositionModel.rootComposition as unknown as CompositionDocument;
    assertValidCompositionDocument(root);
    const clipCompositions = readCompositionSnapshots(compositionModel.clipCompositions, "Clip");
    const legacyShotSlotCompositions = readCompositionSnapshots(compositionModel.legacyShotSlotCompositions, "legacy Shot Slot");
    const warnings = readCompositionWarnings(compositionModel.warnings);
    const projectedProject = projectRootCompositionToLegacy(project, root);
    const validatedModel = {
      ...compositionModel,
      rootComposition: structuredClone(root),
      clipCompositions,
      legacyShotSlotCompositions,
      warnings,
    } as unknown as DionysusProjectDocumentV2["compositionModel"];

    return includeCompositionModel
      ? { project: projectedProject, sourceDocumentVersion: "2.0", compositionModel: validatedModel }
      : { project: projectedProject, sourceDocumentVersion: "2.0" };
  }
  if (value.schemaVersion === "1.0") {
    return { project: value as unknown as DionysusProject, sourceDocumentVersion: "1.0" };
  }
  throw new Error("Unsupported Dionysus project file. Expected a schema-1.0 project or versioned 2.0 document.");
}

import { createProjectDocument } from "./projectDocument";
import type { EditorSessionSnapshot } from "./editorSessionHistory";
import type { DionysusProject } from "./types";

export const LEGACY_PROJECT_STORAGE_KEY = "dionysus.project.v1";
export const COMPOSITION_PROJECT_STORAGE_KEY = "dionysus.composition.v2";

export interface EditorSessionStorage {
  setItem(key: string, value: string): void;
}

/**
 * Persist the versioned Composition envelope first, then mirror its Project projection
 * to the established v1 key for compatibility. If writing the mirror fails (for example,
 * because storage is full), the canonical envelope is already available for recovery.
 */
export function persistEditorSession(
  storage: EditorSessionStorage,
  session: EditorSessionSnapshot,
  savedAt: string,
): void {
  const project = { ...structuredClone(session.project), updatedAt: savedAt };
  const document = createProjectDocument(project, session.composition);
  const projection = { ...document.project, updatedAt: savedAt };

  storage.setItem(COMPOSITION_PROJECT_STORAGE_KEY, JSON.stringify({
    ...document,
    project: projection,
  }));
  storage.setItem(LEGACY_PROJECT_STORAGE_KEY, JSON.stringify(projection));
}


type RecoveryDocument = {
  project: Pick<DionysusProject, "id" | "name" | "updatedAt">;
};

/**
 * Prefer the canonical envelope when it refers to the same project as the legacy mirror.
 * The v2 document is written first and is the authoritative snapshot; timestamps are
 * metadata, not a vote between two independently mutable representations. If identity
 * differs, keep the legacy document as the safer recovery candidate.
 */
export function shouldPreferCompositionRecovery(
  legacyRead: RecoveryDocument | undefined,
  compositionRead: RecoveryDocument | undefined,
): boolean {
  if (!compositionRead) return false;
  if (!legacyRead) return true;
  return legacyRead.project.id === compositionRead.project.id &&
    legacyRead.project.name === compositionRead.project.name;
}

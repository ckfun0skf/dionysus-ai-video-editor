import { createProjectDocument } from "./projectDocument";
import type { EditorSessionSnapshot } from "./editorSessionHistory";
import type { DionysusProject } from "./types";

export const LEGACY_PROJECT_STORAGE_KEY = "dionysus.project.v1";
export const COMPOSITION_PROJECT_STORAGE_KEY = "dionysus.composition.v2";

export interface EditorSessionStorage {
  setItem(key: string, value: string): void;
}

/**
 * Persist only the authoritative versioned Composition envelope. The schema-1.0 key
 * remains a read-only migration fallback for older projects; it is not updated in parallel.
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
}


type RecoveryDocument = {
  project: Pick<DionysusProject, "id" | "name" | "updatedAt">;
};

export type EditorSessionRecoverySource = "composition" | "legacy" | "empty";

/**
 * Choose one complete recovery document. A structurally valid canonical envelope is
 * authoritative regardless of its relationship to a stale legacy mirror; legacy is
 * read only when the canonical envelope is absent or invalid.
 */
export function chooseEditorSessionRecoverySource(
  legacyRead: RecoveryDocument | undefined,
  compositionRead: RecoveryDocument | undefined,
): EditorSessionRecoverySource {
  if (compositionRead) return "composition";
  if (legacyRead) return "legacy";
  return "empty";
}

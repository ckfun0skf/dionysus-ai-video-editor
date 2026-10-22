import { createProjectDocument } from "./projectDocument";
import type { EditorSessionSnapshot } from "./editorSessionHistory";

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

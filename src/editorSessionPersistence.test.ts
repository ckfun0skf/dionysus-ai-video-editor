import { describe, expect, it } from "vitest";
import { migrateLegacyProjectToComposition } from "./compositionMigration";
import { sampleProject } from "./sampleProject";
import {
  COMPOSITION_PROJECT_STORAGE_KEY,
  LEGACY_PROJECT_STORAGE_KEY,
  persistEditorSession,
} from "./editorSessionPersistence";

function memoryStorage(failOn?: string) {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    values,
    writes,
    setItem(key: string, value: string) {
      writes.push(key);
      if (key === failOn) throw new Error("storage full");
      values.set(key, value);
    },
  };
}

describe("Editor session persistence boundary", () => {
  it("writes the canonical envelope before the compatible legacy projection at one revision", () => {
    const project = structuredClone(sampleProject);
    const composition = migrateLegacyProjectToComposition(project).rootComposition;
    const storage = memoryStorage();

    persistEditorSession(storage, { project, composition }, "2026-10-22T12:34:56.000Z");

    expect(storage.writes).toEqual([COMPOSITION_PROJECT_STORAGE_KEY, LEGACY_PROJECT_STORAGE_KEY]);
    const envelope = JSON.parse(storage.values.get(COMPOSITION_PROJECT_STORAGE_KEY)!);
    const legacy = JSON.parse(storage.values.get(LEGACY_PROJECT_STORAGE_KEY)!);
    expect(envelope.documentVersion).toBe("2.0");
    expect(envelope.project.updatedAt).toBe("2026-10-22T12:34:56.000Z");
    expect(legacy.updatedAt).toBe(envelope.project.updatedAt);
    expect(legacy).toEqual(envelope.project);
    expect(envelope.compositionModel.rootComposition).toEqual(composition);
  });

  it("leaves the new canonical envelope available if the compatibility mirror write fails", () => {
    const project = structuredClone(sampleProject);
    const composition = migrateLegacyProjectToComposition(project).rootComposition;
    const storage = memoryStorage(LEGACY_PROJECT_STORAGE_KEY);

    expect(() => persistEditorSession(
      storage,
      { project, composition },
      "2026-10-22T12:34:56.000Z",
    )).toThrow("storage full");

    expect(storage.values.has(COMPOSITION_PROJECT_STORAGE_KEY)).toBe(true);
    expect(storage.values.has(LEGACY_PROJECT_STORAGE_KEY)).toBe(false);
    const envelope = JSON.parse(storage.values.get(COMPOSITION_PROJECT_STORAGE_KEY)!);
    expect(envelope.compositionModel.rootComposition).toEqual(composition);
  });
});

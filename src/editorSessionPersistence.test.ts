import { describe, expect, it } from "vitest";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import { sampleProject } from "./sampleProject";
import {
  COMPOSITION_PROJECT_STORAGE_KEY,
  LEGACY_PROJECT_STORAGE_KEY,
  persistEditorSession,
  chooseEditorSessionRecoverySource,
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
  it("writes only the canonical envelope and preserves its compatibility projection", () => {
    const project = structuredClone(sampleProject);
    const composition = migrateLegacyProjectToComposition(project).rootComposition;
    const storage = memoryStorage();

    persistEditorSession(storage, { project, composition }, "2026-10-22T12:34:56.000Z");

    expect(storage.writes).toEqual([COMPOSITION_PROJECT_STORAGE_KEY]);
    const envelope = JSON.parse(storage.values.get(COMPOSITION_PROJECT_STORAGE_KEY)!);
    expect(envelope.documentVersion).toBe("2.0");
    expect(envelope.project.updatedAt).toBe("2026-10-22T12:34:56.000Z");
    expect(envelope.compositionModel.rootComposition).toEqual(composition);
    expect(envelope.project).toEqual(projectRootCompositionToLegacy({ ...project, updatedAt: "2026-10-22T12:34:56.000Z" }, composition));
    expect(storage.values.has(LEGACY_PROJECT_STORAGE_KEY)).toBe(false);
  });

  it("leaves the existing legacy fallback untouched if the canonical write fails", () => {
    const project = structuredClone(sampleProject);
    const composition = migrateLegacyProjectToComposition(project).rootComposition;
    const storage = memoryStorage(COMPOSITION_PROJECT_STORAGE_KEY);
    const legacy = JSON.stringify({ schemaVersion: "1.0", id: "legacy-fallback" });
    storage.values.set(LEGACY_PROJECT_STORAGE_KEY, legacy);

    expect(() => persistEditorSession(
      storage,
      { project, composition },
      "2026-10-22T12:34:56.000Z",
    )).toThrow("storage full");

    expect(storage.values.has(COMPOSITION_PROJECT_STORAGE_KEY)).toBe(false);
    expect(storage.values.get(LEGACY_PROJECT_STORAGE_KEY)).toBe(legacy);
    expect(storage.writes).toEqual([COMPOSITION_PROJECT_STORAGE_KEY]);
  });
});

describe("Editor session recovery source selection", () => {
  const doc = (id: string, name: string, updatedAt: string) => ({
    project: { id, name, updatedAt },
  });

  it("chooses the complete canonical envelope whenever one is available", () => {
    expect(chooseEditorSessionRecoverySource(
      doc("old-project", "Legacy", "2026-10-22T12:05:00.000Z"),
      doc("new-project", "Canonical", "2026-10-22T12:00:00.000Z"),
    )).toBe("composition");
    expect(chooseEditorSessionRecoverySource(
      doc("p1", "Project", "not-a-date"),
      doc("p1", "Project", "not-a-date"),
    )).toBe("composition");
  });

  it("uses legacy only when canonical recovery is absent or invalid", () => {
    expect(chooseEditorSessionRecoverySource(doc("p1", "Project", "2026-10-22T12:00:00.000Z"), undefined)).toBe("legacy");
    expect(chooseEditorSessionRecoverySource(undefined, undefined)).toBe("empty");
    expect(chooseEditorSessionRecoverySource(undefined, doc("p1", "Project", "not-a-date"))).toBe("composition");
  });
});

import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { createProject } from "../domain";
import { MIGRATIONS, migrateProject, SchemaError } from "./schema";
import { createIndexedDbStorage } from "./indexeddb";

describe("migrateProject", () => {
  it("passes current-schema projects through", () => {
    const p = createProject("x");
    expect(migrateProject(p)).toBe(p);
  });
  it("rejects unknown schemas and malformed projects", () => {
    expect(() => migrateProject({ schema: "dionysus/9.9" })).toThrow(SchemaError);
    expect(() => migrateProject({ ...createProject(), rootCompositionId: "nope" })).toThrow(/malformed/);
    expect(() => migrateProject(42)).toThrow(SchemaError);
  });
  it("upgrades 3.0 projects to 3.1 without touching their content", () => {
    const cur = createProject("old");
    const up = migrateProject(JSON.parse(JSON.stringify({ ...cur, schema: "dionysus/3.0" })));
    expect(up).toEqual({ ...cur, schema: "dionysus/3.1" });
    expect(up.storyboard).toBeUndefined();
  });
  it("runs registered migrations in a chain", () => {
    const cur = createProject("m");
    MIGRATIONS["test/1"] = (r) => ({ ...r, schema: "test/2" });
    MIGRATIONS["test/2"] = () => ({ ...cur });
    try { expect(migrateProject({ schema: "test/1" }).name).toBe("m"); } finally { delete MIGRATIONS["test/1"]; delete MIGRATIONS["test/2"]; }
  });
  it("IndexedDB load goes through the schema check", async () => {
    const s = createIndexedDbStorage();
    const p = createProject("idb");
    await s.projects.save({ ...p, schema: "dionysus/0.1" } as never);
    await expect(s.projects.load(p.id)).rejects.toThrow(/Unsupported project schema/);
    await s.projects.save(p);
    expect((await s.projects.load(p.id))?.name).toBe("idb");
  });
});

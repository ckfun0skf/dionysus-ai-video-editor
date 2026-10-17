import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { validateProject } from "./projectValidation";

describe("validateProject", () => {
  it("accepts the shipped sample project", () => {
    expect(validateProject(sampleProject)).toBe(true);
  });

  it("rejects a project with missing tracks", () => {
    const project: Record<string, unknown> = structuredClone(sampleProject);
    delete project.tracks;
    expect(validateProject(project)).toBe(false);
  });

  it("rejects a clip slot whose selected version does not exist", () => {
    const project = structuredClone(sampleProject);
    project.shots[0].slots[0].selectedVersionId = "missing-version";
    expect(validateProject(project)).toBe(false);
  });

  it("rejects invalid durations and non-finite canvas settings", () => {
    const badDuration = structuredClone(sampleProject);
    badDuration.shots[0].duration = 0;
    expect(validateProject(badDuration)).toBe(false);

    const badCanvas = structuredClone(sampleProject);
    badCanvas.width = Number.POSITIVE_INFINITY;
    expect(validateProject(badCanvas)).toBe(false);
  });

  it("rejects invalid nested layer values", () => {
    const project = structuredClone(sampleProject);
    project.shots[0].slots[0].versions[0].layers.push({
      id: "bad-layer",
      name: "Bad layer",
      kind: "unknown" as never,
      start: -1,
      duration: 0,
    });
    expect(validateProject(project)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { validateProject } from "./projectValidation";

describe("validateProject", () => {
  it("accepts the shipped sample project", () => {
    expect(validateProject(sampleProject)).toBe(true);
  });

  it("rejects a project with missing tracks", () => {
    const project = structuredClone(sampleProject) as unknown as Record<string, unknown>;
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
  it("rejects profile references to missing assets", () => {
    const project = structuredClone(sampleProject);
    project.referenceProfiles.push({
      id: "profile-test", name: "Test character", entityType: "character",
      references: [{ id: "ref-test", assetId: "missing-asset", role: "identity" }],
    });
    expect(validateProject(project)).toBe(false);
  });

  it("rejects shots assigned to missing reference profiles", () => {
    const project = structuredClone(sampleProject);
    project.shots[0].referenceProfileIds.push("missing-profile");
    expect(validateProject(project)).toBe(false);
  });

  it("rejects reference overrides with missing references or replacement assets", () => {
    const missingReference = structuredClone(sampleProject);
    missingReference.shots[0].referenceOverrides.push({ referenceId: "missing-reference", action: "exclude" });
    expect(validateProject(missingReference)).toBe(false);

    const missingReplacement = structuredClone(sampleProject);
    missingReplacement.referenceProfiles.push({
      id: "profile-test", name: "Test character", entityType: "character",
      references: [{ id: "ref-test", assetId: "asset-test", role: "identity" }],
    });
    missingReplacement.assets.push({ id: "asset-test", name: "Reference", kind: "image" });
    missingReplacement.shots[0].referenceOverrides.push({
      referenceId: "ref-test", action: "replace", replacementAssetId: "missing-asset",
    });
    expect(validateProject(missingReplacement)).toBe(false);
  });

});

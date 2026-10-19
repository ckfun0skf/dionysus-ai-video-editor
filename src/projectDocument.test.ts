import { describe, expect, it } from "vitest";
import { sampleProject } from "./sampleProject";
import { createProjectDocument, readProjectDocument } from "./projectDocument";

describe("versioned project document boundary", () => {
  it("exports a versioned Composition projection alongside a lossless legacy project", () => {
    const project = structuredClone(sampleProject);
    const before = JSON.stringify(project);
    const document = createProjectDocument(project);
    expect(document).toMatchObject({
      format: "dionysus-project-document",
      documentVersion: "2.0",
      project: { schemaVersion: "1.0", id: project.id },
      compositionModel: { schemaVersion: "2.0", projectId: project.id },
    });
    expect(document.compositionModel.rootComposition.tracks.length).toBeGreaterThan(0);
    expect(readProjectDocument(document)).toMatchObject({ project, sourceDocumentVersion: "2.0" });
    expect(JSON.stringify(project)).toBe(before);
  });

  it("continues to read existing schema-1.0 project files", () => {
    const project = structuredClone(sampleProject);
    expect(readProjectDocument(project)).toEqual({ project, sourceDocumentVersion: "1.0" });
  });

  it("rejects unknown versions rather than guessing a migration", () => {
    expect(() => readProjectDocument({ format: "dionysus-project-document", documentVersion: "3.0", project: {}, compositionModel: {} })).toThrow(/Unsupported/);
    expect(() => readProjectDocument({ schemaVersion: "3.0" })).toThrow(/Unsupported/);
  });
});

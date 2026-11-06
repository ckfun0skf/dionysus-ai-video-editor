import { describe, expect, it } from "vitest";
import { cleanup, createProject, type Asset, type Project } from ".";

const ver = (id: string, extra: Partial<Asset["versions"][number]["provenance"]> = {}) => ({ id, createdAt: "2026-11-01T00:00:00Z", media: { blobKey: `b/${id}`, mime: "x" }, provenance: { source: "import" as const, inputs: [], ...extra } });
function proj(): Project {
  const p = createProject("c");
  p.assets = {
    used: { id: "used", kind: "video", name: "used.mp4", selectedVersionId: "u2", versions: [ver("u1"), ver("u2"), ver("u3")] },
    lonely: { id: "lonely", kind: "image", name: "lonely.png", versions: [ver("l1")] },
    fx: { id: "fx", kind: "html", name: "fx.html", versions: [ver("f1")] },
    src: { id: "src", kind: "video", name: "src.mp4", versions: [ver("s1")] },
    aud: { id: "aud", kind: "audio", name: "from video", versions: [ver("a1", { fromVideo: { assetId: "src", inSec: 0, outSec: 1 } })] },
    bound: { id: "bound", kind: "image", name: "logo.png", versions: [ver("g1")] },
  };
  const c = p.compositions[p.rootCompositionId];
  c.tracks = [
    { id: "e", kind: "effect", name: "Effects", placements: [{ id: "e1", startTicks: 0, durationTicks: 1, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "__text", versionId: "__text" }, clipType: "effect", effect: { preset: "code:fx" } }] },
    { id: "m", kind: "video", name: "Main", placements: [{ id: "c1", startTicks: 0, durationTicks: 1, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "used", versionId: "u1" }, clipType: "video" }] },
    { id: "a", kind: "audio", name: "Audio", placements: [{ id: "c2", startTicks: 0, durationTicks: 1, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "aud", versionId: "a1" }, clipType: "audio" }] },
  ] as Project["compositions"][string]["tracks"];
  return p;
}

describe("Clean up project (P38)", () => {
  it("lists only media nothing uses, and versions that are neither selected nor on the timeline", () => {
    const plan = cleanup.cleanupPlan(proj(), ["bound"]);
    expect(plan.unused.map((u) => u.assetId)).toEqual(["lonely"]);
    expect(plan.oldVersions.map((o) => o.versionId)).toEqual(["u3"]);
    expect(cleanup.cleanupPlan(proj()).unused.map((u) => u.assetId)).toEqual(["lonely", "bound"]);
  });
  it("removes only listed items", () => {
    const p = cleanup.applyCleanup(proj(), ["lonely", "used"], [{ assetId: "used", versionId: "u3" }, { assetId: "used", versionId: "u2" }], ["bound"]);
    expect(Object.keys(p.assets).sort()).toEqual(["aud", "bound", "fx", "src", "used"]);
    expect(p.assets.used.versions.map((v) => v.id)).toEqual(["u1", "u2"]);
  });
});

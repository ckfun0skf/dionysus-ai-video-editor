import { describe, expect, it } from "vitest";
import { createProject, inputSourceOf, resolveSource, sourceChoices, sourceLabel, validateManifest, type Project } from ".";

function proj(): Project {
  const p = createProject("i");
  const c = p.compositions[p.rootCompositionId];
  c.tracks = [
    { id: "ov", kind: "video", name: "Overlay 1", placements: [{ id: "h1", startTicks: 0, durationTicks: 10, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "h", versionId: "hv" }, clipType: "html" }] },
    { id: "mn", kind: "video", name: "Main", placements: [{ id: "v1", startTicks: 0, durationTicks: 10, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "v", versionId: "vv" }, clipType: "video" }] },
    { id: "au", kind: "audio", name: "Music", placements: [{ id: "a1", startTicks: 0, durationTicks: 10, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "av" }, clipType: "audio" }] },
  ] as Project["compositions"][string]["tracks"];
  p.assets = { a: { id: "a", kind: "audio", name: "song.mp3", versions: [] }, v: { id: "v", kind: "video", name: "beach.mp4", versions: [] }, h: { id: "h", kind: "html", name: "viz.html", versions: [] } };
  return p;
}

describe("code clip inputs (P38)", () => {
  it("lists Mix/Program, tracks and their clips (not the clip itself) and labels them by current name", () => {
    const p = proj();
    expect(sourceChoices(p, "beat").map((c) => c.label)).toEqual(["Mix", "Overlay 1", "Main", "beach", "Music", "song"]);
    expect(sourceChoices(p, "scene", "h1").map((c) => c.source)).toEqual(["program", "track:ov", "track:mn", "clip:v1"]);
    expect(sourceLabel(p, "track:au")).toBe("Music");
    p.compositions[p.rootCompositionId].tracks[2].name = "Score";
    expect(sourceLabel(p, "track:au")).toBe("Score");
  });
  it("resolves names, ids and defaults; a stale binding falls back to the default", () => {
    const p = proj();
    expect(resolveSource(p, "music", "beat")).toEqual({ source: "track:au" });
    expect(resolveSource(p, "a1", "beat")).toEqual({ source: "clip:a1" });
    expect(resolveSource(p, "MIX", "beat")).toEqual({ source: "mix" });
    expect(resolveSource(p, "Music", "scene")).toHaveProperty("error");
    const pl = p.compositions[p.rootCompositionId].tracks[0].placements[0];
    pl.htmlInputs = { m: "track:gone" };
    expect(inputSourceOf(p, pl, "m", "beat")).toBe("mix");
  });
  it("validates manifest inputs", () => {
    const codes = (inputs: unknown, params?: unknown) => validateManifest({ format: "dionysus.htmlclip/1", inputs, ...(params ? { params } : {}) }, []).map((i) => i.code);
    expect(codes({ music: { type: "beat" }, s: { type: "scene" } })).toEqual([]);
    expect(codes({ music: { type: "pixels" } })).toContain("input-type");
    expect(codes({ "1x": { type: "beat" } })).toContain("input-name");
    expect(codes({ size: { type: "beat" } }, { size: { type: "number", default: 1 } })).toContain("input-name");
  });
});

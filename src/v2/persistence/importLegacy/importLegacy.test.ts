import { describe, expect, it } from "vitest";
import { importLegacy } from "./index";
import { validateComposition } from "../../domain";
import v1 from "./fixtures/project-1.0.json";
import v2 from "./fixtures/document-2.0.json";

const NOW = "2026-01-01T00:00:00.000Z";

describe("importLegacy", () => {
  it.each([["project-1.0", v1], ["document-2.0", v2]])("%s matches golden output", async (name, json) => {
    const out = importLegacy(json, NOW);
    for (const c of Object.values(out.project.compositions)) expect(validateComposition(c)).toEqual([]);
    await expect(JSON.stringify(out, null, 2) + "\n").toMatchFileSnapshot(`./fixtures/${name}.golden.json`);
  });
  it("1.0: converts seconds to ticks, resolves overlaps, keeps mute, skips unsupported", () => {
    const { project, warnings, blobs } = importLegacy(v1, NOW);
    const [video, audio] = project.compositions[project.rootCompositionId].tracks;
    expect(video.placements.map((p) => [p.startTicks, p.durationTicks, p.sourceInTicks])).toEqual([[0, 540000, 120000], [540000, 240000, 0]]);
    expect(audio.muted).toBe(true);
    expect(audio.placements[0].startTicks).toBe(39960);
    expect(blobs).toEqual([{ key: "legacy_a1/v1", dataUrl: "data:video/mp4;base64,AAAA" }]);
    expect(project.settings).toEqual({ width: 1280, height: 720, fps: 24 });
    expect(warnings.join("\n")).toMatch(/script.*skipped[\s\S]*Titles[\s\S]*no embedded media|no embedded media/);
  });
  it("2.0: root composition wins over the stale 1.0 projection; track order kept", () => {
    const { project, warnings, sourceVersion } = importLegacy(v2, NOW);
    expect(sourceVersion).toBe("2.0");
    const tracks = project.compositions[project.rootCompositionId].tracks;
    expect(tracks.map((t) => t.name)).toEqual(["Overlay", "Main", "Audio 1"]);
    expect(tracks[1].placements[0]).toMatchObject({ id: "legacy_p1", volume: 0.5, sourceInTicks: 240000 });
    expect(JSON.stringify(project)).not.toContain("stale");
    expect(warnings.some((w) => /linked audio/.test(w))).toBe(true);
    expect(warnings.some((w) => /p3/.test(w))).toBe(true);
  });
  it("rejects garbage and unknown versions", () => {
    expect(() => importLegacy(null)).toThrow();
    expect(() => importLegacy({ schemaVersion: "0.9" })).toThrow(/Unsupported/);
    expect(() => importLegacy({ format: "dionysus-project-document", documentVersion: "3.0" })).toThrow(/Unsupported/);
  });
});

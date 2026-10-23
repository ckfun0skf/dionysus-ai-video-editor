import { describe, expect, it } from "vitest";
import { createProject, type Placement } from "../../domain/model";
import { audioPlan, exportName, exportSize, frameTimes } from "./plan";

const T = 120_000;
function project(placements: Partial<Placement>[], muted = false) {
  const p = createProject("x");
  p.assets.a = { id: "a", kind: "video", name: "a", versions: [{ id: "v", createdAt: "", media: { blobKey: "b1", mime: "video/mp4" }, provenance: { source: "import", inputs: [] } }] };
  const tr = p.compositions[p.rootCompositionId].tracks[0];
  tr.muted = muted;
  tr.placements = placements.map((x, i) => ({ id: `p${i}`, startTicks: i * 10 * T, durationTicks: 2 * T, sourceInTicks: T, source: { kind: "assetVersion", assetId: "a", versionId: "v" }, clipType: "video", ...x }));
  return p;
}

describe("export plan", () => {
  it("keeps aspect and even sizes", () => {
    expect(exportSize("1080p", { width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
    expect(exportSize("720p", { width: 1080, height: 1920 })).toEqual({ width: 404, height: 720 });
  });
  it("lists one time per frame", () => {
    expect(frameTimes(T, 30)).toHaveLength(30);
    expect(frameTimes(T + 1, 30)).toHaveLength(31);
    expect(frameTimes(T, 30)[1]).toBe(4000);
  });
  it("mixes audible clips with speed, volume and fades", () => {
    const [seg] = audioPlan(project([{ speed: 2, volume: 0.5, fadeInTicks: T / 2 }]));
    expect(seg).toMatchObject({ blobKey: "b1", start: 0, duration: 2, offset: 1, rate: 2, volume: 0.5, fadeIn: 0.5, fadeOut: 0 });
  });
  it("skips muted, reversed, frozen and silenced clips", () => {
    expect(audioPlan(project([{ reverse: true }, { freeze: true }, { linkedAudio: { muted: true } }, { volume: 0 }]))).toEqual([]);
    expect(audioPlan(project([{}], true))).toEqual([]);
  });
  it("makes a safe file name", () => {
    expect(exportName("My cut: v2!", "mp4")).toBe("My-cut-v2.mp4");
    expect(exportName("  ", "webm")).toBe("dionysus-export.webm");
  });
});

import { describe, expect, it } from "vitest";
import { createProject, type Placement } from "../../domain/model";
import { audioPlan, classifyPlaceholders, exportDuration, exportEndTicks, exportName, exportPlaceholderWarning, exportSize, frameTimes } from "./plan";

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

  it("trims trailing ungenerated clips and keeps a black hole in the middle (P48)", () => {
    const T = 120_000;
    const p = project([{}]); // 0–2 s generated
    const tr = p.compositions[p.rootCompositionId].tracks[0];
    const mid = { id: "mid", startTicks: 2 * T, durationTicks: 3 * T, sourceInTicks: 0, source: { kind: "assetVersion" as const, assetId: "a", versionId: "v" }, clipType: "image" as const, placeholder: { label: "Shot 2 · Gap — waiting" } };
    const tail = { id: "tail", startTicks: 7 * T, durationTicks: 4 * T, sourceInTicks: 0, source: { kind: "assetVersion" as const, assetId: "a", versionId: "v" }, clipType: "image" as const, placeholder: { label: "Shot 4 · End — waiting" } };
    const later = { id: "later", startTicks: 5 * T, durationTicks: 2 * T, sourceInTicks: T, source: { kind: "assetVersion" as const, assetId: "a", versionId: "v" }, clipType: "video" as const };
    const linked = { id: "title", startTicks: 7 * T, durationTicks: 2 * T, sourceInTicks: 0, source: { kind: "assetVersion" as const, assetId: "a", versionId: "v" }, clipType: "text" as const, storyLink: { anchor: "tail" } };
    tr.placements = [tr.placements[0], mid, later, tail];
    p.compositions[p.rootCompositionId].tracks.push({ id: "txt", kind: "text", name: "Text", placements: [linked] });
    // generated 0–2 and 5–7; middle hole 2–5 (black); tail 7–11 and its title dropped
    expect(exportEndTicks(p)).toBe(7 * T);
    expect(exportDuration(p)).toBe(7);
    expect(classifyPlaceholders(p)).toEqual({ middle: [expect.objectContaining({ id: "mid" })], trailing: [expect.objectContaining({ id: "tail" })] });
    const w = exportPlaceholderWarning(p)!;
    expect(w.title).toBe("2 shots are not generated yet");
    expect(w.body).toContain("in the middle export as a black frame: Shot 2 · Gap");
    expect(w.body).toContain("after the last generated frame");
    expect(w.body).toContain("Shot 4 · End");
  });
  it("omits a timeline that is only placeholders", () => {
    const p = project([{ placeholder: { label: "Shot 1 · A — not yet" }, clipType: "image" }]);
    expect(exportDuration(p)).toBe(0);
    const w = exportPlaceholderWarning(p)!;
    expect(w.body).toContain("nothing to write");
    expect(w.body).toContain("Shot 1 · A");
  });
});

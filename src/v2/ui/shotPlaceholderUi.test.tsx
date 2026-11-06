// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { createProject, TEXT_SOURCE, type Placement, type Project, type Track } from "../domain";
import { createMemoryStorage } from "../persistence";
import { ClipBody, clipKindClass, clipNoThumb } from "./TimelineClip";
import { ExportDialog } from "./ExportDialog";

/** P35: how a shot placeholder looks on the timeline, and the export warning. */
beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const ph: Placement = { id: "plc1", startTicks: 0, durationTicks: 360_000, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "image", volume: 1, storyShot: "s2", placeholder: { label: "Shot 2 · Lamp — He lights it" } };
const withPh = (): Project => {
  const p = createProject("cut"), c = p.compositions[p.rootCompositionId];
  const t = c.tracks.find((x) => x.kind === "video")!;
  return { ...p, compositions: { ...p.compositions, [c.id]: { ...c, tracks: c.tracks.map((x) => (x === t ? { ...t, placements: [ph] } : x)) } } };
};
const render = (node: React.ReactNode) => { const el = document.createElement("div"); const root = createRoot(el); act(() => root.render(node)); return el; };

describe("shot placeholder UI (P35)", () => {
  it("draws a hatched card with the shot label and Not generated, never a loading shimmer", () => {
    const p = withPh(), track = p.compositions[p.rootCompositionId].tracks.find((x) => x.kind === "video") as Track;
    const el = render(<ClipBody p={ph} track={track} isMain project={p} pps={50} />);
    expect(el.querySelector(".v2-ph-label")!.textContent).toBe("Shot 2 · Lamp — He lights it");
    expect(el.querySelector(".v2-ph-state")!.textContent).toBe("Not generated");
    expect(el.querySelector("svg")).toBeTruthy();
    expect(el.textContent).not.toContain("missing media");
    expect(clipKindClass(ph)).toBe("is-placeholder");
    expect(clipNoThumb(ph)).toBe(false);
  });

  it("export warns before rendering placeholders as black frames", () => {
    const el = render(<ExportDialog project={withPh()} blobs={createMemoryStorage().blobs} res="720p" onRes={() => undefined} onClose={() => undefined} probe={() => new Promise(() => undefined)} />);
    const warn = el.querySelector('[data-testid="export-placeholders"]')!;
    expect(warn.textContent).toContain("1 shot is not generated yet");
    expect(warn.textContent).toContain("nothing to write");
    expect(warn.textContent).toContain("Shot 2 · Lamp");
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Export anyway")).toBe(true);
    const plain = render(<ExportDialog project={createProject("x")} blobs={createMemoryStorage().blobs} res="720p" onRes={() => undefined} onClose={() => undefined} probe={() => new Promise(() => undefined)} />);
    expect(plain.querySelector('[data-testid="export-placeholders"]')).toBeNull();
  });

  it("export warns that a middle hole is black and a trailing hole is omitted", () => {
    const T = 120_000;
    const p = createProject("cut"), c = p.compositions[p.rootCompositionId];
    const t = c.tracks.find((x) => x.kind === "video")!;
    const gen: Placement = { id: "g1", startTicks: 0, durationTicks: 2 * T, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "video", volume: 1 };
    const mid: Placement = { id: "m1", startTicks: 2 * T, durationTicks: 2 * T, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "image", volume: 1, placeholder: { label: "Shot 2 · Mid — hole" } };
    const later: Placement = { id: "g2", startTicks: 4 * T, durationTicks: 2 * T, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "video", volume: 1 };
    const tail: Placement = { id: "t1", startTicks: 6 * T, durationTicks: 3 * T, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "image", volume: 1, placeholder: { label: "Shot 4 · Tail — later" } };
    const project: Project = { ...p, compositions: { ...p.compositions, [c.id]: { ...c, tracks: c.tracks.map((x) => (x === t ? { ...t, placements: [gen, mid, later, tail] } : x)) } } };
    const el = render(<ExportDialog project={project} blobs={createMemoryStorage().blobs} res="720p" onRes={() => undefined} onClose={() => undefined} probe={() => new Promise(() => undefined)} />);
    const warn = el.querySelector('[data-testid="export-placeholders"]')!.textContent!;
    expect(warn).toContain("2 shots are not generated yet");
    expect(warn).toContain("black frame");
    expect(warn).toContain("Shot 2 · Mid");
    expect(warn).toContain("omits");
    expect(warn).toContain("Shot 4 · Tail");
  });
});

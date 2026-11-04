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
    expect(warn.textContent).toContain("black frame: Shot 2 · Lamp");
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Export anyway")).toBe(true);
    const plain = render(<ExportDialog project={createProject("x")} blobs={createMemoryStorage().blobs} res="720p" onRes={() => undefined} onClose={() => undefined} probe={() => new Promise(() => undefined)} />);
    expect(plain.querySelector('[data-testid="export-placeholders"]')).toBeNull();
  });
});

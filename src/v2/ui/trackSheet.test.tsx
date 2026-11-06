// @vitest-environment jsdom
/** P39: Track sheet — draw a box, Track (progress), review with unstable frames, follow + mask, ✕ no change, ✓ one undo. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, findPlacement, secondsToTicks as s, type Asset } from "../domain";
import { cmd, Engine } from "../engine";
import { TrackSheet } from "./TrackSheet";
import type { TrackAnalyse } from "./trackAnalyse";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const asset: Asset = { id: "v", kind: "video", name: "street.mp4", selectedVersionId: "v1", versions: [{ id: "v1", createdAt: "", media: { blobKey: "v", mime: "video/mp4", durationTicks: s(2) }, provenance: { source: "import", inputs: [] } }] };

function mount(analyse: TrackAnalyse) {
  const e = new Engine(createProject("x"));
  e.dispatch([cmd.importAsset(asset), cmd.addAssetToTimeline("v", 0, undefined, "c1"), cmd.addTextClip(0, { text: "Label" }, "t1")]);
  const pl = () => findPlacement(e.getState().project.compositions[e.getState().project.rootCompositionId], "c1")!.placement;
  const onClose = vi.fn(), onDone = vi.fn();
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  const render = () => act(() => { root.render(<TrackSheet engine={e} project={e.getState().project} placement={pl()} time={s(1)} loadBlob={async () => undefined} analyse={analyse} onClose={onClose} onDone={onDone} />); });
  render();
  const stage = el.querySelector(".v2-track-stage") as HTMLDivElement;
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 90, right: 160, bottom: 90, x: 0, y: 0, toJSON: () => ({}) });
  const ptr = (type: string, x: number, y: number) => act(() => { stage.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })); });
  const btn = (label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  return { e, el, pl, ptr, btn, onClose, onDone, render };
}

const fake: TrackAnalyse = async (ticks, start, box, onProgress) => {
  onProgress(1, []);
  return { srcW: 1920, srcH: 1080, samples: ticks.map((t, i) => ({ s: t, x: box.x + box.w / 2, y: box.y + box.h / 2, w: box.w, h: box.h, scale: 1, conf: i === start ? 0.3 : 0.95 })) };
};

describe("TrackSheet", () => {
  it("draws a box, tracks, shows unstable frames, and ✓ commits track + follower + mask as one undo step", async () => {
    const t = mount(fake);
    expect(t.btn("Done").disabled).toBe(true);
    t.ptr("pointerdown", 40, 20); t.ptr("pointermove", 80, 50); t.ptr("pointerup", 80, 50);
    const box = t.el.querySelector('[data-testid="track-box"]') as HTMLElement;
    expect(box.style.left).toBe("25%");
    const track = [...t.el.querySelectorAll("button")].find((b) => b.textContent?.includes("Track"))!;
    expect(track.disabled).toBe(false);
    await act(async () => { track.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(t.el.textContent).toContain("unstable");
    expect(t.el.querySelector(".v2-track-box.is-unstable")).toBeTruthy();
    expect(t.el.querySelectorAll(".v2-track-strip i.is-bad").length).toBeGreaterThan(0);
    expect(t.el.textContent).toContain("not AI subject detection");
    // nudge the unstable frame: it becomes manual and trusted
    t.ptr("pointerdown", 60, 35); t.ptr("pointermove", 64, 35); t.ptr("pointerup", 64, 35);
    expect(t.el.textContent).toContain("nudged");
    act(() => (t.el.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    act(() => ([...t.el.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Inside box") as HTMLButtonElement).click());
    act(() => t.btn("Apply track and 1 follower").click());
    expect(t.onDone).toHaveBeenCalledWith(expect.stringContaining("1 following"));
    expect(t.pl().motionTrack!.mask).toBe("inside");
    expect(t.pl().motionTrack!.samples.some((x) => x.manual)).toBe(true);
    t.e.undo();
    expect(t.pl().motionTrack).toBeUndefined();
  });
  it("✕ cancels with no change", async () => {
    const t = mount(fake);
    t.ptr("pointerdown", 40, 20); t.ptr("pointermove", 80, 50); t.ptr("pointerup", 80, 50);
    act(() => t.btn("Cancel").click());
    expect(t.onClose).toHaveBeenCalled();
    expect(t.pl().motionTrack).toBeUndefined();
  });
});

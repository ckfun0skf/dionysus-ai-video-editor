// @vitest-environment jsdom
/** P39: Track sheet — draw a box, Track (progress), review with unstable frames, follow + mask, ✕ no change, ✓ one undo. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, findPlacement, secondsToTicks as s, type Asset } from "../domain";
import { cmd, Engine } from "../engine";
import { TrackSheet } from "./TrackSheet";
import type { TrackAnalyse } from "./trackAnalyse";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  HTMLMediaElement.prototype.pause = function () {};
});
const asset: Asset = { id: "v", kind: "video", name: "street.mp4", selectedVersionId: "v1", versions: [{ id: "v1", createdAt: "", media: { blobKey: "v", mime: "video/mp4", durationTicks: s(2) }, provenance: { source: "import", inputs: [] } }] };

function mount(analyse: TrackAnalyse, trackId?: string, setup?: (e: Engine) => void) {
  const e = new Engine(createProject("x"));
  e.dispatch([cmd.importAsset(asset), cmd.addAssetToTimeline("v", 0, undefined, "c1"), cmd.addTextClip(0, { text: "Label" }, "t1")]);
  setup?.(e);
  const pl = () => findPlacement(e.getState().project.compositions[e.getState().project.rootCompositionId], "c1")!.placement;
  const onClose = vi.fn(), onDone = vi.fn();
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  const render = () => act(() => { root.render(<TrackSheet trackId={trackId} engine={e} project={e.getState().project} placement={pl()} time={s(1)} loadBlob={async () => new Blob(["x"])} analyse={analyse} onClose={onClose} onDone={onDone} />); });
  render();
  const stage = el.querySelector(".v2-track-stage") as HTMLDivElement;
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 90, right: 160, bottom: 90, x: 0, y: 0, toJSON: () => ({}) });
  const ptr = (type: string, x: number, y: number) => act(() => { stage.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })); });
  const btn = (label: string) => el.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  return { e, el, pl, ptr, btn, onClose, onDone, render };
}

const seen: { first: number; n: number }[] = [];
const fake: TrackAnalyse = async (ticks, start, box, onProgress) => {
  seen.push({ first: ticks[0], n: ticks.length });
  onProgress(1, []);
  return { srcW: 1920, srcH: 1080, samples: ticks.map((t, i) => ({ s: t, x: box.x + box.w / 2, y: box.y + box.h / 2, w: box.w * (1 - i / 200), h: box.h, scale: 1 - i / 200, conf: i === start ? 0.3 : 0.95, ...(i === ticks.length - 1 ? { lost: true } : {}) })) };
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
    expect(t.el.textContent).toContain("1 lost (no position)");
    // path overlay: on by default, points draggable; unchecking hides it
    expect(t.el.querySelectorAll(".v2-track-path polyline").length).toBeGreaterThan(0);
    const pts = t.el.querySelectorAll(".v2-track-pt");
    expect(pts.length).toBeGreaterThan(5);
    const path = t.el.querySelector(".v2-track-check input") as HTMLInputElement;
    act(() => path.click());
    expect(t.el.querySelector(".v2-track-path")).toBeNull();
    act(() => path.click());
    // play / pause (button and Space) keep the sheet open
    act(() => t.btn("Play").click());
    expect(t.btn("Pause")).toBeTruthy();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true })); });
    expect(t.btn("Play")).toBeTruthy();
    expect(t.el.querySelector(".v2-track")).toBeTruthy();
    // nudge the unstable frame: it becomes manual and trusted
    t.ptr("pointerdown", 60, 35); t.ptr("pointermove", 64, 35); t.ptr("pointerup", 64, 35);
    expect(t.el.textContent).toContain("nudged");
    act(() => (t.el.querySelector('.v2-track-out input[type="checkbox"]') as HTMLInputElement).click());
    act(() => ([...t.el.querySelectorAll('[role="radio"]')].find((b) => b.textContent === "Inside box") as HTMLButtonElement).click());
    await act(async () => { t.btn("Apply Track 1 and 1 follower").click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(t.onDone).toHaveBeenCalledWith(expect.stringContaining("1 following"));
    expect(t.pl().motionTracks![0]).toMatchObject({ id: "mt1", name: "Track 1", mask: "inside" });
    expect(t.pl().motionTracks![0].samples.some((x) => x.manual)).toBe(true);
    t.e.undo();
    expect(t.pl().motionTracks).toBeUndefined();
  });
  it("✕ cancels with no change", async () => {
    const t = mount(fake);
    t.ptr("pointerdown", 40, 20); t.ptr("pointermove", 80, 50); t.ptr("pointerup", 80, 50);
    act(() => t.btn("Cancel").click());
    expect(t.onClose).toHaveBeenCalled();
    expect(t.pl().motionTracks).toBeUndefined();
  });
  it("adds a second independent tracker with its own name and In / Out range", async () => {
    const t = mount(fake, undefined, (e) => e.dispatch(cmd.commitTrack("c1", { id: "mt1", name: "Track 1", inS: 0, outS: s(2), srcW: 16, srcH: 9, samples: [{ s: 0, x: 0.5, y: 0.5, w: 0.1, h: 0.1, scale: 1, conf: 1 }] })));
    expect((t.el.querySelector('[aria-label="Tracker name"]') as HTMLInputElement).value).toBe("Track 2");
    act(() => (t.el.querySelector('[aria-label="Frame"]') as HTMLInputElement).dispatchEvent(new Event("input", { bubbles: true })));
    const inBtn = [...t.el.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("In "))!;
    act(() => inBtn.click()); // In at the current frame (1 s)
    expect(inBtn.textContent).toContain("1.00s");
    t.ptr("pointerdown", 40, 20); t.ptr("pointermove", 80, 50); t.ptr("pointerup", 80, 50);
    const track = [...t.el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Track")!;
    seen.length = 0;
    await act(async () => { track.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(seen[0]).toMatchObject({ first: s(1), n: 30 });
    await act(async () => { t.btn("Apply Track 2").click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(t.pl().motionTracks!.map((x) => [x.id, x.name, x.inS])).toEqual([["mt1", "Track 1", 0], ["mt2", "Track 2", s(1)]]);
  });
  it("reviewing a tracker and extending Out analyses only the new part", async () => {
    const t = mount(fake, "mt1", (e) => e.dispatch(cmd.commitTrack("c1", { id: "mt1", name: "Track 1", inS: 0, outS: s(1), srcW: 16, srcH: 9, samples: Array.from({ length: 30 }, (_, i) => ({ s: Math.round(i * 4000), x: 0.5, y: 0.5, w: 0.1, h: 0.1, scale: 1, conf: 1 })) })));
    const frame = t.el.querySelector('[aria-label="Frame"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(frame, "50"); frame.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => ([...t.el.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("Out "))!).click());
    seen.length = 0;
    await act(async () => { t.btn("Apply Track 1").click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(seen).toHaveLength(1);
    expect(seen[0].first).toBe(s(1) - 4000); // seeded from the old last frame, then only new frames
    expect(t.pl().motionTracks![0].outS).toBeGreaterThan(s(1.6));
  });
  it("P41: editor re-renders (fresh loadBlob, new project/time) keep the same video src and don't re-seek a paused frame", async () => {
    URL.createObjectURL = vi.fn(() => "blob:one"); URL.revokeObjectURL = vi.fn();
    const t = mount(fake);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const v = t.el.querySelector("video") as HTMLVideoElement;
    expect(v.getAttribute("src")).toBe("blob:one");
    expect(v.classList.contains("is-ready")).toBe(false);
    act(() => { v.dispatchEvent(new Event("loadeddata")); });
    expect(v.classList.contains("is-ready")).toBe(true);
    let seeks = 0;
    let cur = v.currentTime;
    Object.defineProperty(v, "currentTime", { configurable: true, get: () => cur, set: (x: number) => { seeks++; cur = x; } });
    for (let i = 0; i < 5; i++) { t.render(); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(v.getAttribute("src")).toBe("blob:one");
    expect(t.el.querySelector("video")).toBe(v);
    expect(v.classList.contains("is-ready")).toBe(true);
    expect(seeks).toBe(0);
  });
});

// @vitest-environment jsdom
/** P15-TRIM-PREVIEW: the frame picker scrubs only the part of the source clip its shot uses, with "Show full clip". */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { board, createProject, story, TICKS_PER_SECOND } from "../../domain";
import { Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { FramePicker } from "./FramePicker";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  URL.createObjectURL = (() => "blob:test") as never;
  URL.revokeObjectURL = (() => {}) as never;
  HTMLMediaElement.prototype.pause = () => {};
});

const T = TICKS_PER_SECOND;
const D = "Medium shot: the man at the desk looks down at the objects; middle of shot 1; start frame of shot 2.";
async function mount() {
  const r = story.validateStoryboard({
    format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" }, assets: [],
    shots: [
      { id: "s1", title: "Desk", description: "", durationSec: 4, prompt: "The man at the desk looks down at the objects.", assets: [], qa: [] },
      { id: "s2", title: "Objects", description: "", durationSec: 4, prompt: "He picks them up.", assets: [], qa: [], references: [{ frameOf: "s1", role: "start", frameDesc: D }] },
    ],
    connections: [],
  });
  if (!r.ok) throw new Error("bad");
  const { blobs } = createMemoryStorage();
  await blobs.put("clip", new Blob(["x"], { type: "video/mp4" }));
  let p = board.setStoryboard(createProject("p"), board.storyboardFromDoc(r.doc));
  p = board.addStoryVersion(p, { shot: "s1" }, { blobKey: "clip", mime: "video/mp4", durationTicks: 10 * T }, { versionId: "c1", trim: { inTicks: 3 * T, outTicks: 7 * T } });
  const engine = new Engine(p);
  const host = document.createElement("div"); document.body.appendChild(host);
  await act(async () => createRoot(host).render(<FramePicker project={engine.getState().project} slotId="s2.frameof.s1" engine={engine} blobs={blobs} onClose={() => {}} />));
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  const v = document.querySelector(".v2-framepick-player video") as HTMLVideoElement;
  let t = 0;
  Object.defineProperty(v, "duration", { configurable: true, get: () => 10 });
  Object.defineProperty(v, "currentTime", { configurable: true, get: () => t, set: (x: number) => { t = x; queueMicrotask(() => v.dispatchEvent(new Event("seeked"))); } });
  await act(async () => { v.dispatchEvent(new Event("loadedmetadata")); await new Promise((res) => setTimeout(res, 0)); });
  return { now: () => t };
}
const slider = () => document.querySelector('input[aria-label="Position in the source clip"]') as HTMLInputElement;

describe("frame picker range (P15-TRIM-PREVIEW)", () => {
  it("limits the scrubber and strip to the source shot's trimmed part, and the toggle shows the whole clip", async () => {
    const { now } = await mount();
    expect(slider().min).toBe("3");
    expect(slider().max).toBe("7");
    expect(now()).toBe(3);
    const jumps = [...document.querySelectorAll(".v2-framepick-thumb")].map((b) => b.getAttribute("aria-label"));
    expect(jumps[0]).toBe("Jump to 3.00 s");
    expect(jumps[jumps.length - 1]).toBe("Jump to 6.50 s");
    expect(document.querySelector(".v2-framepick-time")!.textContent).toContain("used part 3.00 s–7.00 s");
    const box = document.querySelector(".v2-framepick-full input") as HTMLInputElement;
    expect(document.querySelector(".v2-framepick-full")!.textContent).toContain("Show full clip");
    await act(async () => box.click());
    expect(slider().min).toBe("0");
    expect(slider().max).toBe("10");
    expect(document.querySelector(".v2-framepick-thumb")!.getAttribute("aria-label")).toBe("Jump to 0.00 s");
  });
});

describe("shot card thumbnail (P15-TRIM-PREVIEW)", () => {
  it("uses the frame at the in point of a reused video asset", async () => {
    const { shotThumb } = await import("./BoardView");
    const r = story.validateStoryboard({
      format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
      assets: [{ id: "dust", name: "Dust", type: "video", prompt: "Dust", qa: [] }],
      shots: [{ id: "a", title: "A", description: "", durationSec: 4, prompt: "Walk", assets: [], qa: [],
        layers: [{ id: "d", type: "video", asset: "dust", startSec: 0, endSec: 2, inSec: 3, box: { x: 0, y: 0, width: 1, height: 1 } }] }],
      connections: [],
    });
    if (!r.ok) throw new Error("bad");
    const p = board.addStoryVersion(board.setStoryboard(createProject("p"), board.storyboardFromDoc(r.doc)), { slot: "dust" }, { blobKey: "v", mime: "video/mp4", durationTicks: 10 * T }, { versionId: "d1" });
    const s = p.storyboard!.shots.a;
    expect(shotThumb(p, s, { d1: "whole" })).toBe("whole");
    expect(shotThumb(p, s, { d1: "whole", "d1@3": "at-in" })).toBe("at-in");
  });
});

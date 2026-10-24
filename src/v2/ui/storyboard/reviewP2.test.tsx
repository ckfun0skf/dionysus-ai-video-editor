// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { board, createProject, EXAMPLE_STORYBOARD, story, type MediaRef } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { secondsToTicks as s } from "../../domain/time";
import { Timeline } from "../Timeline";
import { drawVideoFrame, isBlankCanvas } from "../frameGrab";
import { StoryboardView } from "./StoryboardView";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; });

const doc = (() => { const r = story.validateStoryboard(EXAMPLE_STORYBOARD); if (!r.ok) throw new Error("bad"); return r.doc; })();
const media = (sec: number, mime = "video/mp4"): MediaRef => ({ blobKey: `b${sec}${mime}`, mime, durationTicks: mime.startsWith("video") ? s(sec) : undefined });

/** s1 has v1 (5 s) on the timeline, then the keeper changes, so s1 "may not match"; s1 then gets a 3 s v2. */
function setup() {
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(doc));
  e.dispatch(cmd.addStoryVersion({ slot: "keeper" }, media(0, "image/png"), { versionId: "k1" }));
  e.dispatch(cmd.addStoryVersion({ shot: "s1" }, media(5), { versionId: "a1" }));
  e.dispatch(cmd.sendStoryToTimeline());
  e.dispatch(cmd.addStoryVersion({ slot: "keeper" }, media(1, "image/png"), { versionId: "k2" }));
  return e;
}
async function mountBoard(e: Engine) {
  const el = document.createElement("div"); document.body.appendChild(el);
  await act(async () => createRoot(el).render(<StoryboardView engine={e} blobs={createMemoryStorage().blobs} onClose={() => {}} />));
  return el;
}

describe("storyboard review P2 fixes", () => {
  it("R07: a stale shot on the timeline keeps its version and 'On timeline' next to the warning", async () => {
    const el = await mountBoard(setup());
    const status = el.querySelector(".v2-sb-shot-status")!.textContent!;
    expect(status).toContain("1 version");
    expect(status).toContain("On timeline");
    expect(status).toContain("May not match");
  });

  it("R06: flags a clip whose length is off the plan, on the board and in the shot", async () => {
    const e = setup();
    const el = await mountBoard(e);
    expect(el.querySelector(".v2-sb-len")).toBeNull(); // 5 s clip for a 5 s shot
    await act(async () => { e.dispatch(cmd.addStoryVersion({ shot: "s1" }, media(3), { versionId: "a2" })); });
    expect(el.querySelector(".v2-sb-shot-status .v2-sb-len")!.textContent).toContain("3s · planned 5s");
    await act(async () => (el.querySelector(".v2-sb-shot-main") as HTMLButtonElement).click());
    expect(el.querySelector('[role="dialog"] .v2-sb-len')!.textContent).toContain("3s · planned 5s");
    expect(board.shotLengthMismatch(e.getState().project, e.getState().project.storyboard!.shots.s1)).toEqual({ actualSec: 3, plannedSec: 5 });
  });

  it("R08: a stale production step says what to redo and why", async () => {
    const el = await mountBoard(setup());
    await act(async () => ([...el.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Production steps") as HTMLButtonElement).click());
    const step = [...el.querySelectorAll(".v2-prod-step")].find((b) => b.textContent!.includes("Climbing the cliff path"))!;
    expect(step.textContent).toContain("Regenerate — Made with an older version of “The keeper”");
    expect(step.textContent).not.toContain("Generate the clip");
  });

  it("R05: linked timeline clips carry a storyboard chip with the picked version", async () => {
    const e = setup();
    const p = e.getState().project;
    expect(board.storyLinkOf(p, p.storyboard!.shots.s1.assetId!)).toEqual({ target: { shot: "s1" }, label: "Shot 1", versionNo: 1, versionCount: 1 });
    expect(board.storyLinkOf(p, p.storyboard!.slots.keeper.assetId!)?.label).toBe("The keeper");
    e.dispatch(cmd.addStoryVersion({ shot: "s1" }, media(3), { versionId: "a2" }));
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => createRoot(el).render(<Timeline engine={e} project={e.getState().project} time={0} playing={false} onSeek={() => {}} onSelect={() => {}} pps={40} onZoom={() => {}} centered={false} />));
    const chip = el.querySelector(".v2-clip .v2-clip-link")!;
    expect(chip.textContent).toBe("v2");
    expect(chip.getAttribute("aria-label")).toBe("Storyboard Shot 1, version 2");
  });

  it("R05: the board opens straight to a shot from the timeline", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => createRoot(el).render(<StoryboardView engine={setup()} blobs={createMemoryStorage().blobs} onClose={() => {}} initialOpen={{ shot: "s1" }} />));
    expect(el.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toContain("Climbing the cliff path");
  });
});

describe("R03: blank frame detection", () => {
  const ctx = (alpha: number) => {
    const draws: number[] = [];
    return { draws, g: { clearRect() {}, drawImage() { draws.push(1); }, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? alpha : 0)) }) } as unknown as CanvasRenderingContext2D };
  };
  it("treats a fully transparent canvas as blank, a black one as a real frame", () => {
    expect(isBlankCanvas(ctx(0).g, 8, 8)).toBe(true);
    expect(isBlankCanvas(ctx(255).g, 8, 8)).toBe(false);
  });
  it("retries once, then reports an empty frame", async () => {
    const blank = ctx(0);
    expect(await drawVideoFrame(blank.g, document.createElement("video"), 4, 4)).toBe(false);
    expect(blank.draws).toHaveLength(2);
    const ok = ctx(255);
    expect(await drawVideoFrame(ok.g, document.createElement("video"), 4, 4)).toBe(true);
    expect(ok.draws).toHaveLength(1);
  });
});

describe("R09: hover styles only apply where a pointer can hover", () => {
  it("every storyboard and button :hover rule sits inside @media (hover: hover)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const ungated = (file: string) => {
      const css = readFileSync(resolve(__dirname, file), "utf8");
      const gate = css.indexOf("@media (hover: hover) {");
      const end = gate < 0 ? -1 : css.indexOf("\n}", gate);
      return css.split("\n").map((l, i, all) => ({ l, at: all.slice(0, i).join("\n").length })).filter(({ l, at }) => l.includes(":hover") && !l.trim().startsWith("/*") && !(at > gate && at < end)).map(({ l }) => l);
    };
    expect(ungated("storyboard.css")).toEqual([]);
    // The generic button hover greyed out primary buttons (the iOS "Next looks disabled" report).
    expect(ungated("../v2.css").filter((l) => l.trim().startsWith(".v2-icon:hover:not(:disabled)"))).toEqual([]);
    expect(readFileSync(resolve(__dirname, "../v2.css"), "utf8")).toContain(".v2-btn:not(.primary):hover");
  });
});

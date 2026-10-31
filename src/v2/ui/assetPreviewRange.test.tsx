// @vitest-environment jsdom
/** P15-TRIM-PREVIEW: a shot preview plays only the used part of the clip, looping. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { clampToRange, RangeVideo } from "./AssetPreview";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const fake = (t: number) => ({ currentTime: t }) as HTMLVideoElement;

describe("range preview (P15-TRIM-PREVIEW)", () => {
  it("seeks back to the in point outside [inSec, outSec)", () => {
    const r = { inSec: 3, outSec: 5 };
    for (const [t, moved] of [[1, true], [3, false], [4.5, false], [5, true], [7, true]] as const) {
      const el = fake(t);
      expect(clampToRange(el, r)).toBe(moved);
      expect(el.currentTime).toBe(moved ? 3 : t);
    }
    expect(clampToRange(fake(9), undefined)).toBe(false);
  });
  it("starts at the in point, clamps on timeupdate and loops on ended", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    await act(async () => createRoot(host).render(<RangeVideo src="blob:x" range={{ inSec: 3, outSec: 5 }} label="Preview" />));
    const v = host.querySelector("video")!;
    let played = 0;
    v.play = (() => { played += 1; return Promise.resolve(); }) as never;
    let t = 0;
    Object.defineProperty(v, "currentTime", { configurable: true, get: () => t, set: (x: number) => { t = x; } });
    await act(async () => { v.dispatchEvent(new Event("loadedmetadata")); });
    expect(t).toBe(3);
    t = 5.2; await act(async () => { v.dispatchEvent(new Event("timeupdate")); });
    expect(t).toBe(3);
    t = 4; await act(async () => { v.dispatchEvent(new Event("timeupdate")); });
    expect(t).toBe(4);
    t = 10; await act(async () => { v.dispatchEvent(new Event("ended")); });
    expect(t).toBe(3); expect(played).toBe(1);
    expect(v.loop).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { createQueue, withRetry } from "./decodeQueue";
import { bufferedFraction, clipLoadOf, loadSignature } from "../render/stability";

// P29-CLIP-LOADING: decode queue, retry and per-clip load helpers.
const ranges = (r: [number, number][]) => ({ length: r.length, start: (i: number) => r[i][0], end: (i: number) => r[i][1] });

describe("decodeQueue", () => {
  it("runs at most `limit` jobs at once", async () => {
    const q = createQueue(2);
    let live = 0, peak = 0;
    const job = () => q.run(async () => { live += 1; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live -= 1; return 1; });
    await Promise.all([job(), job(), job(), job(), job()]);
    expect(peak).toBe(2);
  });
  it("retries blank results and throws, then gives up", async () => {
    let n = 0;
    expect(await withRetry(async () => (++n < 3 ? undefined : "ok"), 3, 0)).toBe("ok");
    let m = 0;
    expect(await withRetry(async () => { m += 1; throw new Error("x"); }, 3, 0)).toBeUndefined();
    expect(m).toBe(3);
  });
});

describe("clip load helpers", () => {
  it("measures buffered share", () => {
    expect(bufferedFraction(ranges([[0, 2], [5, 7]]), 10)).toBeCloseTo(0.4);
    expect(bufferedFraction(ranges([]), 10)).toBeUndefined();
    expect(bufferedFraction(ranges([[0, 1]]), NaN)).toBeUndefined();
  });
  it("reports loading until the element can play", () => {
    const base = { seeking: false, duration: 10, buffered: ranges([[0, 5]]) as unknown as TimeRanges };
    expect(clipLoadOf({ ...base, readyState: 1 }, false)).toEqual({ progress: 0.5 });
    expect(clipLoadOf({ ...base, readyState: 2 }, false)).toBeUndefined();
    expect(clipLoadOf({ ...base, readyState: 2 }, true)).toEqual({ progress: 0.5 });
    expect(clipLoadOf({ ...base, readyState: 0, error: {} }, false)).toBeUndefined();
  });
  it("signature changes only in 5% steps", () => {
    expect(loadSignature(new Map([["a", { progress: 0.51 }]]))).toBe(loadSignature(new Map([["a", { progress: 0.52 }]])));
    expect(loadSignature(new Map([["a", {}]]))).toBe("a:?");
  });
});

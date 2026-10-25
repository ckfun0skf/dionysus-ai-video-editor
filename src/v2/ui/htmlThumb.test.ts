import { describe, expect, it } from "vitest";
import { htmlThumbTime } from "./htmlThumb";

describe("HTML version thumbnails (V2-SB-130)", () => {
  it("show the frame about 1 s in, or the middle of a shorter clip", () => {
    expect(htmlThumbTime(6)).toBe(1);
    expect(htmlThumbTime(1.2)).toBeCloseTo(0.6);
    expect(htmlThumbTime(undefined)).toBe(1);
  });
});

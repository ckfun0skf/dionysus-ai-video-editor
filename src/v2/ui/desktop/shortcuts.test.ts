import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS, shuttleLabel, shuttleNext } from "./shortcuts";

describe("J/K/L shuttle", () => {
  it("speeds up forward and backward, K stops, reversing restarts at 1×", () => {
    let r = 0;
    r = shuttleNext(r, "l"); expect(r).toBe(1);
    r = shuttleNext(r, "l"); expect(r).toBe(2);
    r = shuttleNext(shuttleNext(r, "l"), "l"); expect(r).toBe(8);
    expect(shuttleNext(r, "l")).toBe(8);
    r = shuttleNext(r, "j"); expect(r).toBe(-1);
    r = shuttleNext(r, "j"); expect(r).toBe(-2);
    expect(shuttleNext(r, "k")).toBe(0);
    expect(shuttleNext(-8, "j")).toBe(-8);
  });
  it("labels only non-normal rates", () => {
    expect(shuttleLabel(0)).toBe(""); expect(shuttleLabel(1)).toBe("");
    expect(shuttleLabel(4)).toBe("4×"); expect(shuttleLabel(-2)).toBe("◀ 2×");
  });
  it("documents every requested key", () => {
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.items.flatMap((i) => i.keys)).join(" ");
    for (const k of ["Space", "J", "K", "L", "S", "Del", "+", "−", "?", "Home"]) expect(keys).toContain(k);
  });
});

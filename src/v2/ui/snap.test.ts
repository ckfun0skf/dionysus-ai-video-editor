import { describe, expect, it } from "vitest";
import { halfExtents, snapMove, snapRotation, snapScale, snapTargets } from "./snap";

const t = snapTargets(1000, 500, [{ cx: 800, cy: 100, w: 100, h: 50, rot: 0 }]);
describe("snapping", () => {
  it("snaps centre to canvas centre lines", () => {
    const r = snapMove({ cx: 503, cy: 247, w: 40, h: 40, rot: 0 }, t, 6);
    expect(r).toEqual({ dx: -3, dy: 3, guides: { x: 500, y: 250 } });
  });
  it("snaps edges to canvas edges and other elements", () => {
    expect(snapMove({ cx: 24, cy: 400, w: 40, h: 10, rot: 0 }, t, 6).dx).toBe(-4); // left edge → 0
    const r = snapMove({ cx: 600, cy: 128, w: 60, h: 10, rot: 0 }, t, 6); // bottom edge 133 → other's bottom 125? no; centre 128 vs 125
    expect(r.guides.y).toBe(125);
  });
  it("does not snap beyond the threshold", () => {
    expect(snapMove({ cx: 300, cy: 300, w: 10, h: 10, rot: 0 }, t, 6)).toEqual({ dx: 0, dy: 0, guides: { x: undefined, y: undefined } });
  });
  it("uses rotated extents", () => {
    const h = halfExtents({ cx: 0, cy: 0, w: 100, h: 20, rot: Math.PI / 2 });
    expect(h.hx).toBeCloseTo(10); expect(h.hy).toBeCloseTo(50);
  });
  it("snaps scale so an edge meets a target", () => {
    const r = snapScale({ cx: 500, cy: 250, w: 996, h: 100, rot: 0 }, t, 6);
    expect(r.k).toBeCloseTo(1000 / 996); expect(r.guides.x).toBe(0);
  });
  it("snaps rotation to right angles", () => {
    expect(snapRotation(88)).toEqual({ deg: 90, snapped: true });
    expect(snapRotation(-178)).toEqual({ deg: 180, snapped: true });
    expect(snapRotation(45)).toEqual({ deg: 45, snapped: false });
  });
});

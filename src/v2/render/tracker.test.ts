import { describe, expect, it } from "vitest";
import { trackFrames, type Grey } from "./tracker";

/** A textured square moving 3 px right and 1 px down per frame over a noisy-ish background. */
function scene(i: number, w = 160, h = 90): Grey {
  const px = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) px[y * w + x] = 40 + ((x * 7 + y * 13) % 17);
  const ox = 30 + i * 3, oy = 20 + i;
  for (let y = 0; y < 20; y += 1) for (let x = 0; x < 20; x += 1) px[(oy + y) * w + ox + x] = (x < 10) !== (y < 10) ? 240 : 10 + x * 4;
  return { w, h, px };
}

describe("P39 tracker", () => {
  it("follows a moving feature forward and backward from the drawn frame", async () => {
    const steps = await trackFrames(12, 5, { x: 45, y: 25, w: 20, h: 20 }, async (i) => scene(i));
    for (let i = 0; i < 12; i += 1) {
      expect(steps[i].box.x).toBeCloseTo(30 + i * 3, -0.5);
      expect(steps[i].box.y).toBeCloseTo(20 + i, -0.5);
      expect(steps[i].conf).toBeGreaterThan(0.8);
    }
  });
  it("rejects a box outside the picture", async () => {
    await expect(trackFrames(2, 0, { x: 150, y: 80, w: 20, h: 20 }, async (i) => scene(i))).rejects.toThrow(/inside/);
  });
});

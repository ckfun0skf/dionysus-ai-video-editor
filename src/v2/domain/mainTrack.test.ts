import { describe, expect, it } from "vitest";
import { createProject } from "./model";
import * as ops from "./ops";

describe("main track", () => {
  it("is the bottom-most video track; overlay video tracks added later sit above it", () => {
    const p = createProject("t");
    let c = p.compositions[p.rootCompositionId];
    const main = ops.mainTrack(c)!;
    expect(main.kind).toBe("video");
    c = ops.addTrack(c, "video", "overlay");
    expect(c.tracks[0].id).toBe("overlay");
    expect(ops.mainTrack(c)!.id).toBe(main.id);
    c = ops.addTrack(c, "audio");
    expect(ops.mainTrack(c)!.id).toBe(main.id);
  });
});

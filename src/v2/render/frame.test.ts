import { describe, expect, it } from "vitest";
import { activeAt, fitRect } from "./frame";
import type { Composition } from "../domain/model";

const pl = (id: string, start: number, dur: number, kind: "video" | "audio" = "video") => ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 10, clipType: kind, source: { kind: "assetVersion" as const, assetId: "a", versionId: "v" } });
const comp: Composition = { id: "c", name: "c", tracks: [
  { id: "top", kind: "video", name: "", placements: [pl("a", 0, 100)] },
  { id: "bot", kind: "video", name: "", placements: [pl("b", 50, 100)] },
] };

describe("frame resolution", () => {
  it("orders bottom-to-top and maps source time", () => {
    expect(activeAt(comp, 60).map((l) => [l.placement.id, l.sourceTicks])).toEqual([["b", 20], ["a", 70]]);
    expect(activeAt(comp, 100).map((l) => l.placement.id)).toEqual(["b"]);
  });
  it("fits contain", () => {
    expect(fitRect(100, 50, 200, 200)).toEqual({ x: 0, y: 50, w: 200, h: 100 });
  });
});

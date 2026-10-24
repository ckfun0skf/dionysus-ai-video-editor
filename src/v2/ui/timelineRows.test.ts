import { describe, expect, it } from "vitest";
import { createProject, ops } from "../domain";
import { GROUP_COLOR, hiddenRanges, layerSlot, buildRows } from "./Timeline";

const comp = () => {
  const p = createProject("t");
  let c = p.compositions[p.rootCompositionId];
  c = ops.addTrack(c, "video", "o1"); c = ops.addTrack(c, "video", "o2");
  c = ops.addTrack(c, "text", "t1"); c = ops.addTrack(c, "video", "s1", "text");
  return c;
};
const sig = (rows: ReturnType<typeof buildRows>) => rows.map((r) => (r.type === "track" ? r.t.id : `${r.type}:${r.group}`));

describe("timeline rows", () => {
  it("mobile: main pinned first, then one collapsed lane per group", () => {
    const c = comp();
    expect(sig(buildRows(c, true))).toEqual([ops.mainTrack(c)!.id, "collapsed:overlay", "collapsed:audio", "collapsed:text"]);
  });
  it("mobile expanded: layers listed bottom-up (lower row draws higher)", () => {
    const c = comp();
    expect(sig(buildRows(c, true, "overlay")).slice(1, 3)).toEqual(["o1", "o2"]);
    const text = sig(buildRows(c, true, "text"));
    expect(text.slice(-2)).toEqual(["t1", "s1"]);
    expect(text.some((r) => r.startsWith("header"))).toBe(false); // V2-099: no in-timeline group pill on mobile
  });
  it("focused mode shows only main + the active group; hidden groups become range lines", () => {
    const c = comp();
    const s = sig(buildRows(c, true, "overlay", "overlay"));
    expect(s.some((r) => /text|audio/.test(r))).toBe(false);
    const hr = hiddenRanges(c, "overlay");
    expect(hr.map((h) => h.group)).not.toContain("overlay");
    expect(hiddenRanges(c, undefined)).toEqual([]);
    const pl = (id: string, st: number, d: number, clipType = "text") => ({ id, startTicks: st, durationTicks: d, sourceInTicks: 0, clipType, source: { assetId: id, versionId: id } }) as never;
    let c2 = ops.insertPlacement(c, "t1", pl("a", 0, 100));
    c2 = ops.insertPlacement(c2, "s1", pl("b", 50, 100, "image"));
    c2 = ops.insertPlacement(c2, "t1", pl("c", 400, 10));
    expect(hiddenRanges(c2, "overlay")).toEqual([{ group: "text", ranges: [[0, 150], [400, 410]] }]);
  });
  it("layer drag slot follows the dragged row's centre", () => {
    const lanes = [{ top: 0, h: 40 }, { top: 40, h: 40 }, { top: 80, h: 40 }];
    expect(layerSlot(lanes, 0, 0)).toBe(0);
    expect(layerSlot(lanes, 0, 45)).toBe(1);
    expect(layerSlot(lanes, 0, 90)).toBe(2);
    expect(layerSlot(lanes, 2, -85)).toBe(0);
  });
  it("desktop: every track under group headers, top layer first", () => {
    const s = sig(buildRows(comp(), false));
    expect(s.slice(0, 3)).toEqual(["header:text", "s1", "t1"]);
    expect(s).toContain("header:overlay");
    expect(s).toContain("header:main");
  });
});

describe("effect group (V2-101)", () => {
  it("shows as a purple hidden line in other modes and as its own focus in Effect mode", async () => {
    const { Engine, cmd } = await import("../engine");
    const e = new Engine(createProject("x"));
    e.dispatch(cmd.addEffectClip(0, "bw"));
    const p = e.getState().project; const comp = p.compositions[p.rootCompositionId];
    expect(hiddenRanges(comp, "overlay").find((r) => r.group === "effect")?.ranges).toEqual([[0, 360000]]);
    expect(GROUP_COLOR.effect).toBe("#a855f7");
    expect(buildRows(comp, true, "effect", "effect").map((r) => `${r.type}:${r.group}`)).toEqual(["track:main", "track:effect"]);
    const y = createProject("y");
    expect(buildRows(y.compositions[y.rootCompositionId], true).some((r) => r.group === "effect")).toBe(false);
  });
});

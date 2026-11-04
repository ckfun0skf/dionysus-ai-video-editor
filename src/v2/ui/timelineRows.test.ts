import { describe, expect, it } from "vitest";
import { createProject, mergeLayer, ops } from "../domain";
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
  it("P33 mobile expanded: layers listed top-down like desktop (top row = top layer, index 0)", () => {
    const c = comp();
    expect(sig(buildRows(c, true, "overlay")).slice(1, 3)).toEqual(["o2", "o1"]);
    const text = sig(buildRows(c, true, "text"));
    expect(text.slice(-3)).toEqual(["s1", "t1", "add:text"]); // P1-ADD-TRACK: [+] row last
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
    expect(buildRows(comp, true, "effect", "effect").map((r) => `${r.type}:${r.group}`)).toEqual(["track:main", "track:effect", "add:effect"]);
    const y = createProject("y");
    expect(buildRows(y.compositions[y.rootCompositionId], true).some((r) => r.group === "effect")).toBe(false);
  });
  it("P33 merge up = into the row visually directly above, on phone and desktop; only the top row of a group is disabled", () => {
    let c = comp();
    c = ops.addTrack(c, "video", "o3");
    for (const [mobile, focus] of [[true, "overlay"], [false, undefined]] as const) {
      const rows = buildRows(c, mobile, mobile ? "overlay" : undefined, focus).filter((r) => r.type === "track" && ops.groupOf(c, r.t) === "overlay").map((r) => (r as { t: { id: string } }).t.id);
      expect(rows.length).toBe(3);
      expect(mergeLayer.mergeTarget(c, rows[0])).toBeUndefined();
      for (let k = 1; k < rows.length; k++) expect(mergeLayer.mergeTarget(c, rows[k])?.id).toBe(rows[k - 1]);
      expect(rows[0]).toBe(c.tracks.find((t) => ops.groupOf(c, t) === "overlay")!.id); // top row = z-order top (index 0)
    }
  });
});

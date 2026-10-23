import { describe, expect, it } from "vitest";
import { createProject, ops } from "../domain";
import { buildRows } from "./Timeline";

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
    expect(sig(buildRows(c, true, "overlay")).slice(1, 4)).toEqual(["header:overlay", "o1", "o2"]);
    const text = sig(buildRows(c, true, "text"));
    expect(text.slice(-3)).toEqual(["header:text", "t1", "s1"]);
  });
  it("desktop: every track under group headers, top layer first", () => {
    const s = sig(buildRows(comp(), false));
    expect(s.slice(0, 3)).toEqual(["header:text", "s1", "t1"]);
    expect(s).toContain("header:overlay");
    expect(s).toContain("header:main");
  });
});

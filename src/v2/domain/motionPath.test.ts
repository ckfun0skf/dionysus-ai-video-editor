/** P89: motion path evaluator (golden), edits, validation, model integration and undo. docs/v2/MOTION_PATH.md. */
import { describe, expect, it } from "vitest";
import { createProject, findPlacement, motion, ops, transformAt, type MotionPath, type Placement } from "./index";
import { Engine, cmd } from "../engine";

const S = 120_000, A = 16 / 9;
const r4 = (v: number | undefined) => (v === undefined ? undefined : Math.round(v * 1e4) / 1e4);
const at = (mp: MotionPath, sec: number) => { const v = motion.motionPathAt(mp, sec * S, A)!; return [r4(v.x), r4(v.y), r4(v.angle)]; };
const line: MotionPath = { nodes: [{ id: "a", t: 0, x: -0.4, y: 0 }, { id: "b", t: 2 * S, x: 0.4, y: 0 }] };
const curve: MotionPath = { nodes: [{ id: "a", t: 0, x: -0.4, y: 0.2, out: { x: 0.2, y: -0.4 } }, { id: "b", t: S, x: 0, y: -0.2, in: { x: -0.15, y: 0 }, out: { x: 0.15, y: 0 }, ease: "inOut" }, { id: "c", t: 3 * S, x: 0.4, y: 0.2, in: { x: -0.1, y: -0.3 } }] };

describe("motion path evaluator (P89)", () => {
  it("golden: linear, curved, eased, held outside the times", () => {
    expect([-1, 0, 0.5, 1, 2, 3].map((s) => at(line, s))).toEqual([[-0.4, 0, 0], [-0.4, 0, 0], [-0.2, 0, 0], [0, 0, 0], [0.4, 0, 0], [0.4, 0, 0]]);
    expect([0, 0.25, 0.5, 1, 1.5, 2, 2.5, 3].map((s) => at(curve, s))).toMatchSnapshot();
    // Deterministic: the same value on every call and in any order.
    const fwd = [0.1, 0.7, 1.3, 2.9].map((s) => at(curve, s)), back = [2.9, 1.3, 0.7, 0.1].map((s) => at(curve, s)).reverse();
    expect(fwd).toEqual(back);
  });
  it("eases shape a segment's timing; constantSpeed gives one even speed over the whole path", () => {
    const eased: MotionPath = { nodes: [{ ...line.nodes[0], ease: "in" }, line.nodes[1]] };
    expect(at(eased, 1)[0]).toBeCloseTo(-0.4 + 0.8 * 0.25, 9);
    const three: MotionPath = { nodes: [{ id: "a", t: 0, x: 0, y: 0 }, { id: "b", t: 0.1 * S, x: 0.1, y: 0 }, { id: "c", t: 4 * S, x: 0.4, y: 0 }] };
    expect(at(three, 2)[0]).not.toBeCloseTo(0.2, 2);
    const even = { ...three, constantSpeed: true };
    expect(motion.motionPathTimes(even, A)).toEqual([0, 1 * S, 4 * S]);
    for (const s of [0.5, 1, 2, 3.5]) expect(at(even, s)[0]).toBeCloseTo(0.1 * s, 6);
  });
  it("orient: rotation follows the tangent on the frame (x scaled by the aspect) plus the offset", () => {
    const diag: MotionPath = { nodes: [{ id: "a", t: 0, x: 0, y: 0 }, { id: "b", t: S, x: 0.1, y: 0.1 }], orient: { offset: 90 } };
    expect(motion.motionPathAt(diag, S / 2, 1)!.angle).toBeCloseTo(45, 6);
    expect(motion.motionPathAt(diag, S / 2, A)!.angle).toBeCloseTo((Math.atan2(0.1, 0.1 * A) * 180) / Math.PI, 6);
    expect(motion.motionPathRotation(diag, S / 2, 1)).toBeCloseTo(135, 6);
  });
});

describe("motion path edits (P89)", () => {
  it("spread by distance, insert on a segment keeps the shape, smooth / corner, times, ease, orient", () => {
    let mp: MotionPath = { nodes: [] };
    for (const [x, y] of [[-0.4, 0], [0, 0], [0.4, 0.3]]) mp = motion.appendPoint(mp, x, y, 0).path;
    mp = motion.spreadByDistance(mp, 0, 9 * S, 1);
    expect(mp.nodes.map((n) => n.t)).toEqual([0, 4 * S, 9 * S]);
    expect(mp.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    const before = at(curve, 2.2);
    const ins = motion.insertOnSegment(curve, 1, 0.5, A);
    expect(ins.path.nodes.map((n) => n.id)).toEqual(["a", "b", "n4", "c"]);
    const mid = ins.path.nodes[2], shapeAt = motion.bezierAt(motion.segmentPoints(curve.nodes, 1), 0.5);
    expect(mid.x).toBeCloseTo(shapeAt.x, 6);
    expect(mid.y).toBeCloseTo(shapeAt.y, 6);
    expect(Math.abs(motion.bezierAt(motion.segmentPoints(ins.path.nodes, 2), 0.5).x - motion.bezierAt(motion.segmentPoints(curve.nodes, 1), 0.75).x)).toBeLessThan(1e-4);
    expect(before).toHaveLength(3);
    const sm = motion.setNodeSmooth(mp, "n2", true, 1);
    expect(motion.isSmooth(sm.nodes[1])).toBe(true);
    expect(sm.nodes[1].in!.x).toBeCloseTo(-sm.nodes[1].out!.x, 6);
    expect(motion.isSmooth(motion.setNodeSmooth(sm, "n2", false, 1).nodes[1])).toBe(false);
    const h = motion.setNodeHandle(sm, "n2", "out", 0.1, 0.05);
    expect(h.nodes[1].in).toEqual({ x: -0.1, y: -0.05 });
    expect(motion.setNodeHandle(sm, "n2", "out", 0.1, 0.05, false).nodes[1].in).toEqual(sm.nodes[1].in);
    const even = { ...mp, constantSpeed: true };
    const timed = motion.setNodeTime(even, "n2", 100 * S, 1);
    expect(timed.constantSpeed).toBeUndefined();
    expect(timed.nodes[1].t).toBe(9 * S - 1);
    expect(motion.setNodeEase(mp, "n1", "out").nodes[0].ease).toBe("out");
    expect(motion.setNodeEase(motion.setNodeEase(mp, "n1", "out"), "n1", "linear").nodes[0].ease).toBeUndefined();
    expect(motion.setOrient(mp, { offset: 400 }).orient).toEqual({ offset: 360 });
    expect(motion.deleteNode(mp, "n2").nodes.map((n) => n.id)).toEqual(["n1", "n3"]);
    expect(motion.nearestOnPath(mp, 0.2, 0.15, 1)!.i).toBe(1);
    const pt = motion.setPointAt(mp, 2 * S, { x: 0.1 }, { x: 0, y: 0 }, 1);
    expect(pt.nodes.map((n) => [n.t, n.x])).toEqual([[0, -0.4], [2 * S, 0.1], [4 * S, 0], [9 * S, 0.4]]);
  });
  it("turns x / y keyframes (tracking Follow) into a path, dropping points the neighbours already give", () => {
    const xs = Array.from({ length: 31 }, (_, i) => ({ t: i * 4000, v: i * 0.01 }));
    const ys = Array.from({ length: 31 }, (_, i) => ({ t: i * 4000, v: i < 15 ? 0 : (i - 15) * 0.02 }));
    const mp = motion.pathFromKeys(xs, ys, { x: 0, y: 0 });
    expect(mp.nodes.map((n) => [n.t, n.x, n.y])).toEqual([[0, 0, 0], [15 * 4000, 0.15, 0], [30 * 4000, 0.3, 0.3]]);
    expect(motion.pathFromKeys(xs, ys, { x: 0, y: 0 }, 0).nodes).toHaveLength(31);
    expect(motion.pathFromKeys(undefined, [{ t: 0, v: 0.1 }, { t: S, v: 0.2 }], { x: 0.3, y: 0 }).nodes.map((n) => n.x)).toEqual([0.3, 0.3]);
  });
});

describe("motion path JSON (P89)", () => {
  const opts = { durationSec: 4, aspect: 1, ticksPerSecond: S };
  it("parses seconds, spreads missing times by distance, and reports every problem with its path", () => {
    const r = motion.parseMotionPath({ nodes: [{ x: -0.4, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0.4 }], orient: true }, opts);
    expect(r.issues).toEqual([]);
    expect(r.path).toMatchObject({ constantSpeed: true, orient: { offset: 0 } });
    expect(r.path!.nodes.map((n) => [n.id, n.t])).toEqual([["n1", 0], ["n2", 2 * S], ["n3", 4 * S]]);
    const t = motion.parseMotionPath({ nodes: [{ id: "a", t: 0, x: 0, y: 0, out: { x: 0.1, y: 0 }, ease: "out" }, { id: "b", t: 1.5, x: 0.2, y: 0 }] }, opts);
    expect(t.path!.nodes[1]).toEqual({ id: "b", t: 1.5 * S, x: 0.2, y: 0 });
    expect(motion.motionPathToJson(t.path!, S)).toEqual({ nodes: [{ id: "a", t: 0, x: 0, y: 0, out: { x: 0.1, y: 0 }, ease: "out" }, { id: "b", t: 1.5, x: 0.2, y: 0 }] });
    const bad = motion.parseMotionPath({ nodes: [{ t: 1, x: 0, y: 0 }, { t: 0.5, x: 9, y: 0 }, { x: 0, y: 0, ease: "bounce" }], extra: 1 }, opts);
    expect(bad.path).toBeUndefined();
    expect(bad.issues.map((i) => `${i.level} ${i.path}`)).toEqual(["warning motionPath.extra", "error motionPath.nodes", "error motionPath.nodes[1]", "error motionPath.nodes[2].ease"]);
    expect(motion.parseMotionPath({ nodes: [{ t: 1, x: 0, y: 0 }, { t: 0.5, x: 0, y: 0 }] }, opts).issues[0].message).toMatch(/Times must increase/);
    expect(motion.parseMotionPath({ nodes: [] }, opts).issues[0].level).toBe("error");
    expect(motion.parseMotionPath({ nodes: [{ t: 0, x: 0, y: 0 }, { t: 9, x: 0, y: 0 }] }, opts).issues[0]).toMatchObject({ level: "warning" });
  });
});

describe("motion path on a clip (P89)", () => {
  const setup = () => {
    const p = createProject("MP"), c = p.compositions[p.rootCompositionId];
    const ov = { id: "ov", kind: "video" as const, name: "Overlay", placements: [] as Placement[] };
    c.tracks.push(ov);
    ov.placements.push({ id: "t1", startTicks: S, durationTicks: 4 * S, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "v" }, clipType: "image", keyframes: { x: [{ t: 0, v: 0.3 }], y: [{ t: 0, v: 0.1 }], scale: [{ t: 0, v: 2 }], rotation: [{ t: 0, v: 10 }] } });
    return new Engine(p);
  };
  const clip = (e: Engine) => { const p = e.getState().project; return findPlacement(p.compositions[p.rootCompositionId], "t1")!.placement; };
  it("setMotionPath replaces x / y (and rotation when it orients) keyframes in one undo step; transformAt follows it", () => {
    const e = setup();
    const mp: MotionPath = { nodes: [{ id: "a", t: 0, x: -0.4, y: 0 }, { id: "b", t: 2 * S, x: 0.4, y: 0 }], orient: { offset: 5 } };
    expect(e.dispatch(cmd.setMotionPath("t1", mp))).toBe(true);
    expect(clip(e).keyframes).toEqual({ scale: [{ t: 0, v: 2 }] });
    const tr = transformAt(clip(e), 3 * S, A); // absolute time: 2 s into the clip
    expect([tr.x, tr.y, tr.rotation, tr.scale]).toEqual([0.4, 0, 5, 2]);
    expect(e.dispatch(cmd.setMotionPath("t1", mp))).toBe(false);
    e.undo();
    expect(clip(e).motionPath).toBeUndefined();
    expect(clip(e).keyframes?.x).toEqual([{ t: 0, v: 0.3 }]);
    expect(() => cmd.setMotionPath("t1", { nodes: [{ id: "a", t: S, x: 0, y: 0 }, { id: "a", t: 0, x: 0, y: 0 }] }).apply(e.getState().project)).toThrow(/increase|unique|duplicate/i);
    expect(e.dispatch(cmd.setMotionPath("t1", null))).toBe(false);
  });
  it("split and trim keep the path on the same frames", () => {
    const e = setup();
    e.dispatch(cmd.setMotionPath("t1", { nodes: [{ id: "a", t: 0, x: -0.4, y: 0 }, { id: "b", t: 4 * S, x: 0.4, y: 0 }] }));
    const p = e.getState().project, c = p.compositions[p.rootCompositionId];
    const before = transformAt(clip(e), 4 * S, A).x; // absolute times
    const split = ops.splitPlacement(c, "t1", 3 * S, "right");
    const right = split.tracks.flatMap((t) => t.placements).find((x) => x.id === "right")!;
    expect(before).toBeCloseTo(0.2, 9);
    expect(transformAt(right, 4 * S, A).x).toBeCloseTo(before, 9);
    expect(right.motionPath!.nodes[0].t).toBe(-2 * S);
  });
});

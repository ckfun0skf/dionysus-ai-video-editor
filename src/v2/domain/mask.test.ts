import { describe, expect, it } from "vitest";
import { createProject, type Placement } from "./model";
import { TICKS_PER_SECOND as S } from "./time";
import { splitPlacement as splitOp } from "./ops";
import { duplicateAbove, setClipMask, splitPlacement } from "../engine/commands";
import { Engine } from "../engine/engine";
import { migrateProject } from "../persistence/schema";
import type { NamedTrack } from "./tracking";
import {
  addPoint, closePath, defaultMask, deletePoint, evalMask, keyMask, maskAt, maskErrors, maskInside, maskToJson, moveBy,
  parseMask, prepareMask, resizeFromCorner, setHandle, shiftMaskKeys, signedDistance, sourceToCanvas, type ClipMask,
} from "./mask";

const square = (shape: ClipMask["shape"], extra: Partial<ClipMask> = {}): ClipMask => ({ ...defaultMask(shape), ...extra });
const prep = (m: ClipMask, w = 100, h = 100) => prepareMask(m, w, h);

describe("P49 mask geometry", () => {
  it("keeps the inside of a rect, ellipse, top-half split and band", () => {
    expect(maskInside(prep(square("rect")), 0.5, 0.5)).toBe(true);
    expect(maskInside(prep(square("rect")), 0.05, 0.05)).toBe(false);
    expect(maskInside(prep(square("ellipse")), 0.5, 0.5)).toBe(true);
    expect(maskInside(prep(square("ellipse")), 0.5, 0.05)).toBe(false);
    const split = square("linear");
    expect(maskInside(prep(split), 0.5, 0.2)).toBe(true);
    expect(maskInside(prep(split), 0.5, 0.8)).toBe(false);
    const band = square("band", { w: 0.2 });
    expect(maskInside(prep(band), 0.5, 0.5)).toBe(true);
    expect(maskInside(prep(band), 0.5, 0.05)).toBe(false);
  });

  it("rotates a rect about its centre and rounds corners", () => {
    const wide = square("rect", { w: 0.6, h: 0.16, rotation: 90 });
    expect(maskInside(prep(wide), 0.5, 0.3)).toBe(true);
    expect(maskInside(prep(wide), 0.7, 0.5)).toBe(false);
    const round = square("rect", { radius: 0.5 });
    expect(signedDistance(prep(round), 0.24, 0.24)).toBeLessThan(0);
    expect(signedDistance(prep(square("rect")), 0.24, 0.24)).toBeGreaterThan(0);
  });

  it("feather and expand move the boundary without a canvas filter", () => {
    const edge = square("rect", { expand: 0.08 });
    expect(maskInside(prep(square("rect")), 0.5, 0.2)).toBe(false);
    expect(maskInside(prep(edge), 0.5, 0.2)).toBe(true);
    const soft = signedDistance(prep(square("rect", { feather: 0.05 })), 0.5, 0.5);
    expect(soft).toBeGreaterThan(0);
  });

  it("a closed bezier path contains its centre and ignores an unclosed draft", () => {
    let path = defaultMask("path");
    for (const [x, y] of [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]] as const) path = addPoint(path, x, y);
    expect(closePath(path).error).toBeUndefined();
    path = closePath(path).mask;
    path = setHandle(path, path.nodes![0].id, "out", 0.1, 0);
    expect(maskInside(prep(path), 0.5, 0.5)).toBe(true);
    expect(maskInside(prep(path), 0.05, 0.05)).toBe(false);
    expect(maskInside(prep({ ...path, closed: false }), 0.5, 0.5)).toBe(false);
  });

  it("resize keeps the opposite corner, including when rotated", () => {
    const start = square("rect", { x: 0.5, y: 0.5, w: 0.4, h: 0.2 });
    const next = resizeFromCorner(start, "se", 0.8, 0.7);
    expect(next.x).toBeCloseTo(0.55, 2);
    expect(next.y).toBeCloseTo(0.55, 2);
    const turned = resizeFromCorner({ ...start, rotation: 90 }, "se", 0.6, 0.8);
    expect(turned.w).toBeGreaterThanOrEqual(0.02);
    expect(turned.h).toBeGreaterThanOrEqual(0.02);
    expect(maskErrors(turned)).toEqual([]);
  });
});

describe("P49 path topology and validation", () => {
  const quad = () => {
    let m = defaultMask("path");
    for (const [x, y] of [[0.2, 0.2], [0.8, 0.3], [0.7, 0.8]] as const) m = addPoint(m, x, y);
    return closePath(m).mask;
  };
  it("adding and deleting a point does not renumber the others' keys", () => {
    let m = keyMask(quad(), 0);
    const [a, b] = m.nodes!.map((n) => n.id);
    m = keyMask({ ...moveBy(m, 0.2, 0), nodes: m.nodes!.map((n) => (n.id === a ? { ...n, x: n.x + 0.2 } : n)) }, S);
    // key the moved node only, then put the node back so the authored place differs from the key — eval interpolates.
    m = { ...quad(), keys: m.keys };
    m = addPoint(m, 0.5, 0.9, 1);
    const added = m.nodes![1].id;
    expect(m.nodes!.map((n) => n.id)).toEqual([a, added, b, m.nodes![3].id]);
    const mid = evalMask(m, S / 2);
    expect(mid.nodes!.find((n) => n.id === a)!.x).toBeGreaterThan(quad().nodes![0].x);
    expect(mid.nodes!.find((n) => n.id === added)!.x).toBeCloseTo(0.5, 5);
    const gone = deletePoint(m, b);
    expect(gone.error).toBeUndefined();
    expect(gone.mask.keys?.nodes?.[a]).toBeTruthy();
    expect(gone.mask.keys?.nodes?.[b]).toBeUndefined();
    expect(gone.mask.nodes!.some((n) => n.id === a)).toBe(true);
    expect(deletePoint(gone.mask, gone.mask.nodes![0].id).error).toMatch(/at least 3/);
  });

  it("rejects an unclosed, degenerate or malformed path without throwing", () => {
    expect(parseMask({ shape: "path", nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }] }).ok).toBe(false);
    expect(parseMask({ shape: "path", closed: false, nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }, { id: "c", x: 0, y: 1 }] }).issues[0].message).toMatch(/closed/);
    expect(parseMask({ shape: "nope" }).ok).toBe(false);
    expect(parseMask(null).ok).toBe(false);
    const flat = parseMask({ shape: "path", nodes: [{ id: "a", x: 0.2, y: 0.2 }, { id: "b", x: 0.2, y: 0.2 }, { id: "c", x: 0.2, y: 0.2 }] });
    expect(flat.ok).toBe(true);
    expect(flat.issues.some((i) => /no area/.test(i.message))).toBe(true);
    expect(() => maskInside(prepareMask(flat.mask!, 10, 10), 0.2, 0.2)).not.toThrow();
    expect(maskErrors(defaultMask("rect"))).toEqual([]);
  });

  it("round-trips storyboard seconds and drops an unknown point's keys", () => {
    const raw = { shape: "rect", x: 0.4, y: 0.4, w: 0.2, h: 0.3, feather: 0.04, invert: true, keys: { x: [{ t: 0, v: 0.4 }, { t: 1, v: 0.6 }] }, track: "Subject" };
    const parsed = parseMask(raw);
    expect(parsed.ok).toBe(true);
    expect(parsed.mask!.keys!.x![1].t).toBe(S);
    expect(maskToJson(parsed.mask!)).toMatchObject({ shape: "rect", feather: 0.04, invert: true, track: "Subject", keys: { x: [{ t: 0, v: 0.4 }, { t: 1, v: 0.6 }] } });
    const path = parseMask({ shape: "path", nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }, { id: "c", x: 0, y: 1 }], nodeKeys: { a: { x: [{ t: 0, v: 0 }] }, missing: { x: [{ t: 0, v: 1 }] } } });
    expect(path.ok).toBe(true);
    expect(path.mask!.keys?.nodes?.missing).toBeUndefined();
    expect(path.issues.some((i) => /missing/.test(i.message))).toBe(true);
  });
});

describe("P49 tracker follow, split and persistence", () => {
  const track = (samples: NamedTrack["samples"], mask?: ClipMask): Placement => ({
    id: "c", startTicks: 0, durationTicks: 2 * S, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "v" }, clipType: "video",
    mask, motionTracks: [{ id: "mt1", name: "Subject", inS: 0, outS: S, srcW: 100, srcH: 100, samples }],
  });
  const sample = (s: number, x: number, lost = false) => ({ s, x, y: 0.5, w: 0.2, h: 0.2, scale: 1, conf: lost ? 0.1 : 1, ...(lost ? { lost: true } : {}) });

  it("follows a found tracker and holds the last found sample when lost or out of range", () => {
    const mask: ClipMask = { ...square("ellipse"), trackId: "Subject", trackAnchor: { x: 0.4, y: 0.5, scale: 1 } };
    const found = maskAt(track([sample(0, 0.4), sample(S / 2, 0.7)], mask), S / 2, 0);
    expect(found.follow.found).toBe(true);
    expect(found.mask!.x).toBeCloseTo(0.8, 3);
    const lost = maskAt(track([sample(0, 0.4), sample(S / 2, 0.7, true)], mask), S / 2, 0);
    expect(lost.follow.found).toBe(false);
    expect(lost.follow.held).toBe(true);
    expect(lost.mask!.x).toBeCloseTo(0.5, 3);
    const early = maskAt(track([sample(0, 0.4)], mask), 0, 0);
    // source tick 0 is the first sample; a time before the range holds nothing and does not invent a position
    const before = maskAt({ ...track([sample(1000, 0.4)], mask), mask }, -10, 0);
    expect(before.follow.found).toBe(false);
    expect(before.mask!.x).toBeCloseTo(0.5, 3);
    expect(early.mask!.x).toBeCloseTo(0.5, 3);
    void early;
  });

  it("split shifts only the right half's key times; duplicate and save-as-clip keep the mask", () => {
    const mask = keyMask(square("rect"), 0);
    const keyed = keyMask({ ...mask, x: 0.2 }, S);
    const made = createProject("m");
    let comp = made.compositions[made.rootCompositionId];
    // build a one-clip composition without depending on ids from createProject
    comp = { ...comp, tracks: [{ ...comp.tracks[0], placements: [{ id: "c", startTicks: 0, durationTicks: 2 * S, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "v" }, clipType: "image", mask: keyed }] }] };
    const split = splitOp(comp, "c", S, "c2");
    const right = split.tracks[0].placements.find((p) => p.id === "c2")!;
    expect(right.mask?.shape).toBe("rect");
    expect(right.mask?.keys?.x?.map((k) => k.t).sort((a, b) => a - b)).toEqual([-S, 0]);
    expect(shiftMaskKeys(keyed, -S)?.keys?.x?.[1].t).toBe(0);
    const e = new Engine(createProject("d"));
    e.dispatch(setClipMask("missing", square("rect")));
    const p = createProject("p");
    comp = { ...comp, id: p.rootCompositionId };
    p.compositions[p.rootCompositionId] = comp;
    const stored = migrateProject(JSON.parse(JSON.stringify({ ...p, schema: "dionysus/3.1" })));
    expect(stored.compositions[stored.rootCompositionId].tracks[0].placements[0].mask?.shape).toBe("rect");
    const eng = new Engine(stored);
    expect(eng.dispatch(duplicateAbove("c", "copy", 0.02, 0.02, "trk2"))).toBe(true);
    const copy = eng.getState().project.compositions[stored.rootCompositionId].tracks.flatMap((t) => t.placements).find((pl) => pl.id === "copy");
    expect(copy?.mask?.keys?.x?.length).toBe(keyed.keys?.x?.length);
    expect(eng.dispatch(splitPlacement("c", S, "half"))).toBe(true);
    expect(eng.undo()).toBe(true);
    expect(eng.getState().project.compositions[stored.rootCompositionId].tracks.flatMap((t) => t.placements).some((pl) => pl.id === "half")).toBe(false);
  });
});

describe("P49 source mapping", () => {
  it("letterboxes and crops in source space, not viewport pixels", () => {
    const placed = { cx: 100, cy: 50, w: 100, h: 100, rot: 0, sx: 0, sy: 0, sw: 100, sh: 100 };
    expect(sourceToCanvas(0, 0.5, 100, 100, placed).x).toBeCloseTo(50, 3);
    const cropped = { ...placed, w: 50, h: 100, sx: 50, sw: 50 };
    expect(sourceToCanvas(0.5, 0.5, 100, 100, cropped).x).toBeCloseTo(75, 3);
    const turned = { ...placed, rot: Math.PI / 2 };
    const p = sourceToCanvas(1, 0.5, 100, 100, turned);
    expect(p.y).toBeGreaterThan(placed.cy);
  });
});

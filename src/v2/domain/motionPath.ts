/**
 * P89 Motion path (docs/v2/MOTION_PATH.md): a clip's position follows a hand-drawn Bezier path, After Effects style.
 *
 * `Placement.motionPath` holds the path's nodes in order. Each node is the clip centre at a time: `x` / `y` are the
 * same offsets from the frame centre as the transform (fractions of the frame width / height), `t` is ticks from
 * the clip start like transform keyframes, `in` / `out` are Bezier handle offsets from the node (frame fractions) and
 * `ease` shapes the time of the segment that starts at the node. Node ids are stable (like mask path nodes).
 *
 * While a clip has a motion path, it alone gives the clip's x / y (x / y keyframes are removed when a path is set).
 * Between two nodes the clip moves along the cubic segment at an even speed over the segment's length (an arc-length
 * table), shaped by the segment's ease. `constantSpeed` ignores the inner nodes' times and eases: the first and last
 * node times stay, and every inner node gets the time that gives one even speed along the whole path. `orient`
 * turns the clip along the path's direction: rotation = tangent angle + `offset` degrees (it replaces the clip's own
 * rotation). Lengths and angles are measured on the frame (x scaled by the frame aspect).
 *
 * Pure and deterministic (a fixed number of samples per segment), so preview, export and any seek order match.
 * This module has no runtime imports from the model (model.ts calls it).
 */
export const MOTION_EASES = ["linear", "in", "out", "inOut"] as const;
export type MotionEase = (typeof MOTION_EASES)[number];
export interface MotionHandle { x: number; y: number }
export interface MotionNode { id: string; t: number; x: number; y: number; in?: MotionHandle; out?: MotionHandle; ease?: MotionEase }
export interface MotionPath {
  nodes: MotionNode[];
  /** Even speed along the whole path between the first and last node times (inner times and eases ignored). */
  constantSpeed?: boolean;
  /** Rotation follows the path direction plus `offset` degrees (clockwise). */
  orient?: { offset: number };
}

export const MOTION_LIMITS = { nodes: 500, coord: 4, handle: 4, offset: 360 } as const;
/** Samples per segment for the arc-length table. Fixed, so evaluation never depends on the device. */
const SAMPLES = 48;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number) => Math.round(v * 1e5) / 1e5;

export function easeValue(ease: MotionEase | undefined, u: number): number {
  switch (ease) {
    case "in": return u * u;
    case "out": return 1 - (1 - u) * (1 - u);
    case "inOut": return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
    default: return u;
  }
}

/** The u that gives eased value f (for placing a split point at the time the clip passes it). */
export function easeInverse(ease: MotionEase | undefined, f: number): number {
  const v = clamp(f, 0, 1);
  switch (ease) {
    case "in": return Math.sqrt(v);
    case "out": return 1 - Math.sqrt(1 - v);
    case "inOut": return v < 0.5 ? Math.sqrt(v / 2) : 1 - Math.sqrt((1 - v) / 2);
    default: return v;
  }
}

type Pt = { x: number; y: number };
/** The four control points of segment i (frame fractions). */
export function segmentPoints(nodes: readonly MotionNode[], i: number): [Pt, Pt, Pt, Pt] {
  const a = nodes[i], b = nodes[i + 1];
  // A straight segment (no handles) gets its control points at the thirds: the same line, evenly parameterised.
  if (!a.out && !b.in) { const dx = (b.x - a.x) / 3, dy = (b.y - a.y) / 3; return [{ x: a.x, y: a.y }, { x: a.x + dx, y: a.y + dy }, { x: b.x - dx, y: b.y - dy }, { x: b.x, y: b.y }]; }
  return [{ x: a.x, y: a.y }, { x: a.x + (a.out?.x ?? 0), y: a.y + (a.out?.y ?? 0) }, { x: b.x + (b.in?.x ?? 0), y: b.y + (b.in?.y ?? 0) }, { x: b.x, y: b.y }];
}
export function bezierAt(p: readonly Pt[], s: number): Pt {
  const m = 1 - s, a = m * m * m, b = 3 * m * m * s, c = 3 * m * s * s, d = s * s * s;
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
}
function bezierTangent(p: readonly Pt[], s: number): Pt {
  const m = 1 - s;
  return {
    x: 3 * m * m * (p[1].x - p[0].x) + 6 * m * s * (p[2].x - p[1].x) + 3 * s * s * (p[3].x - p[2].x),
    y: 3 * m * m * (p[1].y - p[0].y) + 6 * m * s * (p[2].y - p[1].y) + 3 * s * s * (p[3].y - p[2].y),
  };
}

interface Prepared { segs: { p: [Pt, Pt, Pt, Pt]; cum: Float64Array; len: number }[]; total: number; times: number[] }
const cache = new WeakMap<MotionPath, Map<number, Prepared>>();

/** Arc-length tables (measured with x × aspect) and the effective node times. Cached per path object and aspect. */
export function prepareMotionPath(mp: MotionPath, aspect: number): Prepared {
  let byAspect = cache.get(mp);
  const hit = byAspect?.get(aspect);
  if (hit) return hit;
  const nodes = mp.nodes, segs: Prepared["segs"] = [];
  let total = 0;
  for (let i = 0; i + 1 < nodes.length; i += 1) {
    const p = segmentPoints(nodes, i), cum = new Float64Array(SAMPLES + 1);
    let prev = p[0], len = 0;
    for (let k = 1; k <= SAMPLES; k += 1) {
      const q = bezierAt(p, k / SAMPLES);
      len += Math.hypot((q.x - prev.x) * aspect, q.y - prev.y);
      cum[k] = len; prev = q;
    }
    segs.push({ p, cum, len }); total += len;
  }
  let times = nodes.map((n) => n.t);
  if (mp.constantSpeed && nodes.length > 2) {
    const t0 = nodes[0].t, t1 = nodes[nodes.length - 1].t;
    let acc = 0;
    times = nodes.map((_n, i) => {
      if (i === 0) return t0;
      acc += segs[i - 1].len;
      return i === nodes.length - 1 ? t1 : Math.round(total > 0 ? t0 + ((t1 - t0) * acc) / total : t0 + ((t1 - t0) * i) / (nodes.length - 1));
    });
  }
  const out = { segs, total, times };
  if (!byAspect) { byAspect = new Map(); cache.set(mp, byAspect); }
  byAspect.set(aspect, out);
  return out;
}

/** Bezier parameter at arc-length fraction `f` of segment `seg`. */
function paramAt(seg: Prepared["segs"][number], f: number): number {
  const target = f * seg.len, c = seg.cum;
  if (seg.len <= 0) return f;
  let lo = 0, hi = SAMPLES;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] < target) lo = mid; else hi = mid; }
  const span = c[hi] - c[lo];
  return (lo + (span > 0 ? (target - c[lo]) / span : 0)) / SAMPLES;
}

/** The effective node times (with constantSpeed applied). */
export const motionPathTimes = (mp: MotionPath, aspect: number): number[] => prepareMotionPath(mp, aspect).times;

/**
 * Position (frame-centre offsets) and direction (degrees clockwise, undefined when it can't be told) at `offset`
 * ticks from the clip start. Held at the first / last node outside their times. undefined for an empty path.
 */
export function motionPathAt(mp: MotionPath | undefined, offset: number, aspect = 16 / 9): { x: number; y: number; angle?: number } | undefined {
  const nodes = mp?.nodes;
  if (!mp || !nodes?.length) return undefined;
  if (nodes.length === 1) return { x: nodes[0].x, y: nodes[0].y };
  const prep = prepareMotionPath(mp, aspect), times = prep.times, last = nodes.length - 1;
  let i: number, s: number;
  if (offset <= times[0]) { i = 0; s = 0; }
  else if (offset >= times[last]) { i = last - 1; s = 1; }
  else {
    i = 0;
    while (i < last - 1 && offset >= times[i + 1]) i += 1;
    const span = times[i + 1] - times[i];
    const u = span > 0 ? clamp((offset - times[i]) / span, 0, 1) : 1;
    s = paramAt(prep.segs[i], mp.constantSpeed ? u : easeValue(nodes[i].ease, u));
  }
  const seg = prep.segs[i], pos = bezierAt(seg.p, s);
  let tan = bezierTangent(seg.p, s);
  if (Math.hypot(tan.x * aspect, tan.y) < 1e-9) tan = { x: seg.p[3].x - seg.p[0].x, y: seg.p[3].y - seg.p[0].y };
  const angle = Math.hypot(tan.x * aspect, tan.y) < 1e-9 ? undefined : (Math.atan2(tan.y, tan.x * aspect) * 180) / Math.PI;
  return { x: pos.x, y: pos.y, ...(angle !== undefined ? { angle } : {}) };
}

/** Rotation the path gives at `offset` when it orients the clip (offset alone where the direction is unknown). */
export function motionPathRotation(mp: MotionPath, offset: number, aspect = 16 / 9): number | undefined {
  if (!mp.orient) return undefined;
  const at = motionPathAt(mp, offset, aspect);
  return at ? (at.angle ?? 0) + mp.orient.offset : undefined;
}

// ---------------------------------------------------------------- edits (pure; the UI and tools build on them)

export function freshMotionId(nodes: readonly Pick<MotionNode, "id">[]): string {
  const ids = new Set(nodes.map((n) => n.id));
  let i = nodes.length + 1;
  while (ids.has(`n${i}`)) i += 1;
  return `n${i}`;
}
const sortNodes = (nodes: MotionNode[]) => nodes.map((n, i) => [n, i] as const).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([n]) => n);

/**
 * Spread the nodes' times by distance over [t0, t1] (even speed): the first node at t0, the last at t1. Keeps the
 * node order. Used when points are placed by hand and by the tools when no times are given.
 */
export function spreadByDistance(mp: MotionPath, t0: number, t1: number, aspect: number): MotionPath {
  const n = mp.nodes.length;
  if (!n) return mp;
  if (n === 1) return { ...mp, nodes: [{ ...mp.nodes[0], t: Math.round(t0) }] };
  const prep = prepareMotionPath({ nodes: mp.nodes }, aspect);
  let acc = 0;
  const nodes = mp.nodes.map((node, i) => {
    if (i > 0) acc += prep.segs[i - 1].len;
    const t = i === n - 1 ? t1 : prep.total > 0 ? t0 + ((t1 - t0) * acc) / prep.total : t0 + ((t1 - t0) * i) / (n - 1);
    return { ...node, t: Math.round(t) };
  });
  return { ...mp, nodes: ensureIncreasing(nodes) };
}
/** Times strictly increase by at least one tick (a zero-length segment would be a jump). */
function ensureIncreasing(nodes: MotionNode[]): MotionNode[] {
  const out = nodes.map((n) => ({ ...n }));
  for (let i = 1; i < out.length; i += 1) if (out[i].t <= out[i - 1].t) out[i].t = out[i - 1].t + 1;
  return out;
}

/** Freeze the effective times (after constantSpeed) into the nodes and turn constantSpeed off (before editing a time). */
export function materializeTimes(mp: MotionPath, aspect: number): MotionPath {
  if (!mp.constantSpeed) return mp;
  const times = motionPathTimes(mp, aspect);
  const { constantSpeed: _c, ...rest } = mp;
  return { ...rest, nodes: mp.nodes.map((n, i) => ({ ...n, t: Math.round(times[i]) })) };
}

/** Append a point (the path's new end). With `range`, the times are spread by distance over it (even speed). */
export function appendPoint(mp: MotionPath, x: number, y: number, t: number): { path: MotionPath; id: string } {
  const id = freshMotionId(mp.nodes);
  const last = mp.nodes[mp.nodes.length - 1];
  return { path: { ...mp, nodes: [...mp.nodes, { id, t: last ? Math.max(t, last.t + 1) : t, x, y }] }, id };
}
/** Split segment i at Bezier parameter s (de Casteljau): the shape is unchanged, the new node gets the time there. */
export function insertOnSegment(mp: MotionPath, i: number, s: number, aspect: number): { path: MotionPath; id: string } {
  const nodes = mp.nodes;
  if (i < 0 || i + 1 >= nodes.length) return { path: mp, id: "" };
  const [p0, p1, p2, p3] = segmentPoints(nodes, i), lerp = (a: Pt, b: Pt, k: number) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  const a = lerp(p0, p1, s), b = lerp(p1, p2, s), c = lerp(p2, p3, s), d = lerp(a, b, s), e = lerp(b, c, s), m = lerp(d, e, s);
  const prep = prepareMotionPath(mp, aspect), times = prep.times;
  // The time the clip passes that point: the arc-length fraction there, through the inverse of the segment's ease.
  const seg = prep.segs[i], sk = s * SAMPLES, k0 = Math.floor(sk), k1 = Math.min(SAMPLES, k0 + 1);
  const f = seg.len > 0 ? (seg.cum[k0] + (seg.cum[k1] - seg.cum[k0]) * (sk - k0)) / seg.len : s;
  const t = Math.round(times[i] + (times[i + 1] - times[i]) * (mp.constantSpeed ? f : easeInverse(nodes[i].ease, f)));
  const id = freshMotionId(nodes);
  const curved = !!(nodes[i].out || nodes[i + 1].in);
  const A = { ...nodes[i], ...(curved ? { out: { x: round(a.x - p0.x), y: round(a.y - p0.y) } } : {}) };
  const B = { ...nodes[i + 1], ...(curved ? { in: { x: round(c.x - p3.x), y: round(c.y - p3.y) } } : {}) };
  const M: MotionNode = { id, t: clamp(t, nodes[i].t + 1, Math.max(nodes[i].t + 1, nodes[i + 1].t - 1)), x: round(m.x), y: round(m.y), ...(curved ? { in: { x: round(d.x - m.x), y: round(d.y - m.y) }, out: { x: round(e.x - m.x), y: round(e.y - m.y) } } : {}), ...(nodes[i].ease ? { ease: nodes[i].ease } : {}) };
  const next = [...nodes.slice(0, i), A, M, B, ...nodes.slice(i + 2)];
  return { path: { ...mp, nodes: mp.constantSpeed ? next : ensureIncreasing(next) }, id };
}
/** The point on the path nearest to frame point (x, y): segment index, parameter and distance (aspect-scaled). */
export function nearestOnPath(mp: MotionPath, x: number, y: number, aspect: number): { i: number; s: number; d: number } | undefined {
  let best: { i: number; s: number; d: number } | undefined;
  for (let i = 0; i + 1 < mp.nodes.length; i += 1) {
    const p = segmentPoints(mp.nodes, i);
    for (let k = 0; k <= 64; k += 1) {
      const q = bezierAt(p, k / 64), d = Math.hypot((q.x - x) * aspect, q.y - y);
      if (!best || d < best.d) best = { i, s: k / 64, d };
    }
  }
  return best;
}
export function deleteNode(mp: MotionPath, id: string): MotionPath {
  return { ...mp, nodes: mp.nodes.filter((n) => n.id !== id) };
}
export function moveNode(mp: MotionPath, id: string, x: number, y: number): MotionPath {
  return { ...mp, nodes: mp.nodes.map((n) => (n.id === id ? { ...n, x: round(x), y: round(y) } : n)) };
}
/** Set one handle (offset from its node). `mirror` keeps the other handle opposite (a smooth point). */
export function setNodeHandle(mp: MotionPath, id: string, which: "in" | "out", hx: number, hy: number, mirror = true): MotionPath {
  return { ...mp, nodes: mp.nodes.map((n) => {
    if (n.id !== id) return n;
    const other = which === "in" ? "out" : "in";
    const h = { x: round(hx), y: round(hy) };
    if (Math.hypot(hx, hy) < 1e-6) { const { [which]: _drop, ...rest } = n; return rest as MotionNode; }
    return { ...n, [which]: h, ...(mirror ? { [other]: { x: -h.x, y: -h.y } } : {}) };
  }) };
}
/** Smooth: handles along the neighbours' direction (a third of the shorter neighbour distance); corner: no handles. */
export function setNodeSmooth(mp: MotionPath, id: string, smooth: boolean, aspect: number): MotionPath {
  const i = mp.nodes.findIndex((n) => n.id === id);
  if (i < 0) return mp;
  const n = mp.nodes[i];
  if (!smooth) { const { in: _i, out: _o, ...rest } = n; return { ...mp, nodes: mp.nodes.map((m) => (m.id === id ? rest : m)) }; }
  const prev = mp.nodes[i - 1] ?? n, next = mp.nodes[i + 1] ?? n;
  let dx = next.x - prev.x, dy = next.y - prev.y;
  const L = Math.hypot(dx * aspect, dy);
  if (L < 1e-9) { dx = 1 / aspect; dy = 0; }
  const ux = dx / (L || 1), uy = dy / (L || 1);
  const dPrev = Math.hypot((n.x - prev.x) * aspect, n.y - prev.y), dNext = Math.hypot((next.x - n.x) * aspect, next.y - n.y);
  const k = (Math.min(dPrev || dNext, dNext || dPrev) || 0.2) / 3;
  const out = { x: round(ux * k), y: round(uy * k) };
  return { ...mp, nodes: mp.nodes.map((m) => (m.id === id ? { ...m, ...(i < mp.nodes.length - 1 || i === 0 ? { out } : {}), ...(i > 0 ? { in: { x: -out.x, y: -out.y } } : {}) } : m)) };
}
export const isSmooth = (n: MotionNode) => !!(n.in || n.out);
/** Set one node's time (ticks from the clip start); stays between its neighbours. Turns constantSpeed off. */
export function setNodeTime(mp: MotionPath, id: string, t: number, aspect: number): MotionPath {
  const m = materializeTimes(mp, aspect), i = m.nodes.findIndex((n) => n.id === id);
  if (i < 0) return mp;
  const lo = i > 0 ? m.nodes[i - 1].t + 1 : -Infinity, hi = i < m.nodes.length - 1 ? m.nodes[i + 1].t - 1 : Infinity;
  return { ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, t: Math.round(clamp(t, lo, hi)) } : n)) };
}
export function setNodeEase(mp: MotionPath, id: string, ease: MotionEase): MotionPath {
  return { ...mp, nodes: mp.nodes.map((n) => { if (n.id !== id) return n; const { ease: _e, ...rest } = n; return ease === "linear" ? rest : { ...rest, ease }; }) };
}
export function setOrient(mp: MotionPath, orient: { offset: number } | undefined): MotionPath {
  const { orient: _o, ...rest } = mp;
  return orient ? { ...rest, orient: { offset: round(clamp(orient.offset, -MOTION_LIMITS.offset, MOTION_LIMITS.offset)) } } : rest;
}
export function setConstantSpeed(mp: MotionPath, on: boolean, aspect: number): MotionPath {
  if (on) return { ...mp, constantSpeed: true };
  return materializeTimes(mp, aspect);
}
/** Set or add a node at `offset` (within 600 ticks = the same node): the gizmo and the X / Y fields on a clip with a path. */
export function setPointAt(mp: MotionPath, offset: number, patch: { x?: number; y?: number }, base: { x: number; y: number }, aspect: number): MotionPath {
  const m = materializeTimes(mp, aspect);
  const hit = m.nodes.find((n) => Math.abs(n.t - offset) <= 600);
  if (hit) return { ...m, nodes: m.nodes.map((n) => (n.id === hit.id ? { ...n, ...(patch.x !== undefined ? { x: round(patch.x) } : {}), ...(patch.y !== undefined ? { y: round(patch.y) } : {}) } : n)) };
  const id = freshMotionId(m.nodes);
  return { ...m, nodes: sortNodes([...m.nodes, { id, t: Math.round(offset), x: round(patch.x ?? base.x), y: round(patch.y ?? base.y) }]) };
}

/** Shift every node time (trim start, split). */
export function shiftMotionPath(mp: MotionPath | undefined, by: number): MotionPath | undefined {
  if (!mp || !by) return mp;
  return { ...mp, nodes: mp.nodes.map((n) => ({ ...n, t: n.t + by })) };
}

/**
 * A path from x / y keyframes (the times of both, x / y evaluated linearly between their keys). Points that the
 * neighbours already give within `tolerance` (frame fractions, at their time) are left out (Ramer-Douglas-Peucker on
 * time, so the motion stays the same); 0 keeps every key. Nodes are corners with linear timing.
 */
export function pathFromKeys(xs: readonly { t: number; v: number }[] | undefined, ys: readonly { t: number; v: number }[] | undefined, base: { x: number; y: number }, tolerance = 0.001): MotionPath {
  const ev = (keys: readonly { t: number; v: number }[] | undefined, t: number, d: number) => {
    if (!keys?.length) return d;
    if (t <= keys[0].t) return keys[0].v;
    for (let i = 1; i < keys.length; i += 1) { const a = keys[i - 1], b = keys[i]; if (t <= b.t) return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t || 1); }
    return keys[keys.length - 1].v;
  };
  const times = [...new Set([...(xs ?? []), ...(ys ?? [])].map((k) => Math.round(k.t)))].sort((a, b) => a - b);
  const pts = times.map((t) => ({ t, x: ev(xs, t, base.x), y: ev(ys, t, base.y) }));
  const keep = new Array(pts.length).fill(tolerance <= 0);
  if (pts.length) { keep[0] = true; keep[pts.length - 1] = true; }
  const rdp = (a: number, b: number) => {
    let worst = -1, wd = tolerance;
    for (let i = a + 1; i < b; i += 1) {
      const k = (pts[i].t - pts[a].t) / (pts[b].t - pts[a].t || 1);
      const d = Math.hypot(pts[i].x - (pts[a].x + (pts[b].x - pts[a].x) * k), pts[i].y - (pts[a].y + (pts[b].y - pts[a].y) * k));
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = true; rdp(a, worst); rdp(worst, b); }
  };
  if (tolerance > 0 && pts.length > 2) rdp(0, pts.length - 1);
  return { nodes: pts.filter((_, i) => keep[i]).map((p, i) => ({ id: `n${i + 1}`, t: p.t, x: round(p.x), y: round(p.y) })) };
}

// ---------------------------------------------------------------- validation and JSON (seconds)

export interface MotionIssue { level: "error" | "warning"; path: string; message: string }
/** Problems of a stored path (ticks). */
export function motionPathErrors(mp: MotionPath | undefined): string[] {
  if (!mp) return [];
  const e: string[] = [];
  if (!Array.isArray(mp.nodes) || !mp.nodes.length) return ["A motion path needs at least one point."];
  if (mp.nodes.length > MOTION_LIMITS.nodes) e.push(`At most ${MOTION_LIMITS.nodes} points.`);
  const ids = new Set<string>();
  mp.nodes.forEach((n, i) => {
    if (typeof n.id !== "string" || !n.id || ids.has(n.id)) e.push(`Point ${i + 1}: needs a unique id.`);
    ids.add(n.id);
    if (![n.t, n.x, n.y].every(finite)) e.push(`Point ${i + 1}: t, x and y must be numbers.`);
    if (i > 0 && !mp.constantSpeed && !(n.t > mp.nodes[i - 1].t)) e.push(`Point ${i + 1}: its time must be after point ${i}'s.`);
  });
  if (mp.constantSpeed && mp.nodes.length > 1 && !(mp.nodes[mp.nodes.length - 1].t > mp.nodes[0].t)) e.push("The last point's time must be after the first's.");
  return e;
}

/**
 * Parse a motion path from JSON (storyboard layers, WebMCP): `{ nodes: [{ id?, t?, x, y, in?, out?, ease? }],
 * constantSpeed?, orient?: { offset } | true }` with `t` in seconds from the clip start. With no `t` on any point the
 * times are spread by distance over [0, durationSec] and constantSpeed is on. Coordinates are frame-centre offsets
 * (fractions of the frame), as get_timeline's transform; with `frame` (storyboard layers) they are points on the frame
 * (0–1 from the top-left, the clip centre, like a text layer's `position`) and are stored as centre offsets.
 */
export function parseMotionPath(raw: unknown, opts: { path?: string; durationSec: number; aspect: number; ticksPerSecond: number; frame?: boolean }): { path?: MotionPath; issues: MotionIssue[] } {
  const o0 = opts.frame ? 0.5 : 0;
  const p = opts.path ?? "motionPath", issues: MotionIssue[] = [];
  const err = (q: string, message: string) => issues.push({ level: "error", path: q, message });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { err(p, 'A motion path is { "nodes": [{ "t"?, "x", "y", "in"?, "out"?, "ease"? }], "constantSpeed"?, "orient"? }.'); return { issues }; }
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!["nodes", "constantSpeed", "orient"].includes(k)) issues.push({ level: "warning", path: `${p}.${k}`, message: `Unknown field "${k}" is ignored.` });
  if (!Array.isArray(r.nodes) || !r.nodes.length) { err(`${p}.nodes`, '"nodes" must be a list of at least one point { "x", "y", "t"? }.'); return { issues }; }
  if (r.nodes.length > MOTION_LIMITS.nodes) { err(`${p}.nodes`, `At most ${MOTION_LIMITS.nodes} points.`); return { issues }; }
  const T = opts.ticksPerSecond, nodes: MotionNode[] = [], ids = new Set<string>();
  const withT = r.nodes.filter((n) => n && typeof n === "object" && (n as Record<string, unknown>).t !== undefined).length;
  if (withT && withT !== r.nodes.length) err(`${p}.nodes`, 'Give "t" on every point or on none (none = spread by distance over the clip, even speed).');
  const handle = (v: unknown, q: string): MotionHandle | undefined => {
    if (v === undefined) return undefined;
    const h = v as Record<string, unknown>;
    if (!h || typeof h !== "object" || !finite(h.x) || !finite(h.y) || Math.abs(h.x) > MOTION_LIMITS.handle || Math.abs(h.y) > MOTION_LIMITS.handle) { err(q, `A handle is { "x", "y" }: offsets from the point, each within ±${MOTION_LIMITS.handle}.`); return undefined; }
    return { x: round(h.x), y: round(h.y) };
  };
  r.nodes.forEach((v, i) => {
    const q = `${p}.nodes[${i}]`, n = v as Record<string, unknown>;
    if (!n || typeof n !== "object" || Array.isArray(n)) { err(q, 'A point is { "x", "y", "t"?, "in"?, "out"?, "ease"?, "id"? }.'); return; }
    if (!finite(n.x) || !finite(n.y) || Math.abs(n.x - o0) > MOTION_LIMITS.coord || Math.abs(n.y - o0) > MOTION_LIMITS.coord) { err(q, opts.frame ? `"x" and "y" are numbers: where the layer's centre is, as fractions of the frame from the top-left (0.5, 0.5 = centred; outside 0–1 = off screen; within ±${MOTION_LIMITS.coord}).` : `"x" and "y" are numbers: offsets of the clip centre from the frame centre (fractions of the frame; 0 = centre, ±0.5 = the edges; within ±${MOTION_LIMITS.coord}).`); return; }
    if (n.t !== undefined && (!finite(n.t) || n.t < 0)) { err(`${q}.t`, '"t" is seconds from the clip start (≥ 0).'); return; }
    if (n.ease !== undefined && !MOTION_EASES.includes(n.ease as MotionEase)) { err(`${q}.ease`, `"ease" is one of ${MOTION_EASES.map((x) => `"${x}"`).join(", ")}.`); return; }
    let id = typeof n.id === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(n.id) ? n.id : "";
    if (n.id !== undefined && !id) issues.push({ level: "warning", path: `${q}.id`, message: "Ids are 1–32 letters, digits, _ or -; a new one is used." });
    if (id && ids.has(id)) { issues.push({ level: "warning", path: `${q}.id`, message: `Id "${id}" is used twice; a new one is used.` }); id = ""; }
    const inH = handle(n.in, `${q}.in`), outH = handle(n.out, `${q}.out`);
    const node: MotionNode = { id: id || "", t: finite(n.t) ? Math.round(n.t * T) : 0, x: round(n.x - o0), y: round(n.y - o0), ...(inH ? { in: inH } : {}), ...(outH ? { out: outH } : {}), ...(n.ease && n.ease !== "linear" ? { ease: n.ease as MotionEase } : {}) };
    if (id) ids.add(id);
    nodes.push(node);
  });
  if (issues.some((x) => x.level === "error")) return { issues };
  for (const n of nodes) if (!n.id) { n.id = freshMotionId(nodes.filter((m) => m.id)); }
  let mp: MotionPath = { nodes };
  if (withT) {
    for (let i = 1; i < nodes.length; i += 1) if (!(nodes[i].t > nodes[i - 1].t) && !r.constantSpeed) err(`${p}.nodes[${i}].t`, `Times must increase: point ${i + 1} (${nodes[i].t / T} s) is not after point ${i} (${nodes[i - 1].t / T} s).`);
    if (r.constantSpeed === true) mp.constantSpeed = true;
  } else {
    mp = { ...spreadByDistance(mp, 0, Math.max(1, Math.round(opts.durationSec * T)), opts.aspect), constantSpeed: true };
    if (r.constantSpeed === false) delete mp.constantSpeed;
  }
  if (r.constantSpeed !== undefined && typeof r.constantSpeed !== "boolean") err(`${p}.constantSpeed`, '"constantSpeed" is true or false.');
  if (r.orient !== undefined && r.orient !== false) {
    const o = r.orient === true ? { offset: 0 } : r.orient as Record<string, unknown>;
    if (!o || typeof o !== "object" || (o.offset !== undefined && !finite(o.offset))) err(`${p}.orient`, '"orient" is true or { "offset": degrees } (rotation follows the path direction plus the offset).');
    else mp.orient = { offset: round(clamp(finite(o.offset) ? o.offset : 0, -MOTION_LIMITS.offset, MOTION_LIMITS.offset)) };
  }
  const last = nodes[nodes.length - 1];
  if (last && last.t / T > opts.durationSec + 1e-6) issues.push({ level: "warning", path: `${p}.nodes[${nodes.length - 1}].t`, message: `The last point is at ${last.t / T} s, after the clip ends (${opts.durationSec} s); the clip stops before it.` });
  return issues.some((x) => x.level === "error") ? { issues } : { path: mp, issues };
}

/** A stored path as JSON (seconds, 3 decimals); `frame` = points from the frame's top-left (storyboard layers). */
export function motionPathToJson(mp: MotionPath, ticksPerSecond: number, frame = false): Record<string, unknown> {
  const o0 = frame ? 0.5 : 0;
  return {
    nodes: mp.nodes.map((n) => ({ id: n.id, t: Math.round((n.t / ticksPerSecond) * 1000) / 1000, x: round(n.x + o0), y: round(n.y + o0), ...(n.in ? { in: n.in } : {}), ...(n.out ? { out: n.out } : {}), ...(n.ease ? { ease: n.ease } : {}) })),
    ...(mp.constantSpeed ? { constantSpeed: true } : {}),
    ...(mp.orient ? { orient: { offset: mp.orient.offset } } : {}),
  };
}

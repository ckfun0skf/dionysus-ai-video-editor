/**
 * P89b: named motion paths on a storyboard (docs/v2/MOTION_PATH.md §9, STORYBOARD_FORMAT §2.11).
 *
 * A storyboard can plan paths before any video exists: root `paths[]`, each with an id, a name and either planned
 * points (`motionPath`, frame points 0–1 from the top-left and seconds from the path start), a reference to make it
 * from (`from`: a video or image asset, with `track` saying what to follow), or both (the plan moves the layer until
 * the path is made). A layer uses one with `"motionPath": { "ref": "<path id>", "stretch"?, "offset"? }`.
 *
 * In memory the points are centre offsets and ticks (like Placement.motionPath). Send / Update / Re-lay resolve a
 * ref into the layer clip's own path (`resolvePathRef`) and keep `pathRef` on the clip so Sync can write edits back.
 * Pure: no DOM, no engine.
 */
import { motionPathAt, motionPathToJson, parseMotionPath, pathFromKeys, setNodeSmooth, type MotionPath } from "./motionPath";
import type { MotionTrack, NamedTrack } from "./tracking";

/** How a path was made after planning: tracked in its reference (Track sheet) or drawn by hand. */
export const PATH_CREATED_BY = ["track", "draw"] as const;
export type PathCreatedBy = (typeof PATH_CREATED_BY)[number];

export interface StoryPath {
  id: string;
  name?: string;
  /** What the path is for (shown in the guide step and to the AI). */
  description?: string;
  /** The asset (video or image) to make it from: "Create path <name> from <reference>". */
  from?: string;
  /** With `from`: what to follow in the reference ("the bee", "the ball"). */
  track?: string;
  /** The path's own length (seconds). Default: its last point's time, else the longest layer using it, else 3. */
  durationSec?: number;
  /** Points: centre offsets and ticks from the path start in memory; frame points and seconds in the JSON. */
  motionPath?: MotionPath;
  /** Set once the path was made from its reference or drawn (the guide step is then done). */
  createdBy?: PathCreatedBy;
  /**
   * P90: the guide step was skipped. The planned points (if any) are final and keep moving the layers; with no points
   * the layers stay where their box puts them. Reopen = remove the flag. Tracking or drawing the path clears it.
   */
  skipped?: true;
}

/** A layer's (or clip's) link to a named path. `stretch`: fit the path's times to the layer; `offset`: move it. */
export interface StoryPathRef { ref: string; stretch?: true; offset?: { x: number; y: number } }

export const DEFAULT_PATH_SEC = 3;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

interface BoardLike {
  paths?: StoryPath[];
  shots?: Record<string, { id: string; title?: string; layers?: { id: string; type: string; startSec: number; endSec: number; pathRef?: StoryPathRef }[] }>;
  order?: string[];
}

export const pathName = (p: Pick<StoryPath, "id" | "name">): string => p.name?.trim() || p.id;
export const findPath = (b: Pick<BoardLike, "paths"> | undefined, id: string | undefined): StoryPath | undefined => (id ? b?.paths?.find((p) => p.id === id) : undefined);
export const hasPoints = (p: StoryPath | undefined): boolean => !!p?.motionPath?.nodes.length;

/** Every layer that uses path `id` (shot order). */
export function pathUsers(b: BoardLike, id: string): { shot: string; layer: string; durSec: number }[] {
  const out: { shot: string; layer: string; durSec: number }[] = [];
  for (const sid of b.order ?? Object.keys(b.shots ?? {})) for (const l of b.shots?.[sid]?.layers ?? []) if (l.pathRef?.ref === id) out.push({ shot: sid, layer: l.id, durSec: Math.max(0, l.endSec - l.startSec) });
  return out;
}

/** The path's length in seconds (see StoryPath.durationSec). */
export function pathDurationSec(b: BoardLike, p: StoryPath, ticksPerSecond: number): number {
  if (p.durationSec && p.durationSec > 0) return p.durationSec;
  const last = p.motionPath?.nodes.at(-1)?.t;
  if (last && last > 0) return last / ticksPerSecond;
  const longest = Math.max(0, ...pathUsers(b, p.id).map((u) => u.durSec));
  return longest > 0 ? longest : DEFAULT_PATH_SEC;
}

/**
 * The path a layer clip of `layerTicks` gets from `ref` (undefined when the path has no points yet: the layer stays
 * where its box / position puts it). `stretch` scales the times so the path ends with the layer; `offset` moves it.
 */
export function resolvePathRef(b: Pick<BoardLike, "paths"> | undefined, ref: StoryPathRef | undefined, layerTicks: number): MotionPath | undefined {
  const src = ref && findPath(b, ref.ref)?.motionPath;
  if (!src?.nodes.length) return undefined;
  const last = src.nodes[src.nodes.length - 1].t;
  const k = ref!.stretch && last > 0 ? layerTicks / last : 1;
  const dx = ref!.offset?.x ?? 0, dy = ref!.offset?.y ?? 0;
  const nodes = src.nodes.map((n) => ({ ...n, t: Math.max(0, Math.round(n.t * k)), x: r4(n.x + dx), y: r4(n.y + dy) }));
  for (let i = 1; i < nodes.length; i += 1) if (nodes[i].t <= nodes[i - 1].t) nodes[i].t = nodes[i - 1].t + 1;
  return { ...structuredClone(src), nodes };
}

/** Same points, times and options (ids ignored): is the clip's path still exactly what the ref gives? */
export function samePath(a: MotionPath | undefined, b: MotionPath | undefined): boolean {
  const norm = (m: MotionPath | undefined) => (m ? JSON.stringify({ ...m, nodes: m.nodes.map(({ id: _id, ...n }) => n) }) : "");
  return norm(a) === norm(b);
}

/**
 * The inverse of resolvePathRef for Sync: the named path's points that give `clip` under `ref` (undo the offset and
 * the stretch). Undefined when that can't be done exactly (no points to scale against).
 */
export function unresolvePath(ref: StoryPathRef, clip: MotionPath, srcLastTicks: number | undefined, layerTicks: number): MotionPath | undefined {
  // A stretched ref keeps the named path's length (its last point's time) when there is one; else the clip's own times.
  const k = ref.stretch && srcLastTicks && srcLastTicks > 0 ? layerTicks / srcLastTicks : 1;
  if (!(k > 0) || !clip.nodes.length) return undefined;
  const dx = ref.offset?.x ?? 0, dy = ref.offset?.y ?? 0;
  return { ...structuredClone(clip), nodes: clip.nodes.map((n) => ({ ...n, t: Math.round(n.t / k), x: r4(n.x - dx), y: r4(n.y - dy) })) };
}

/** Where a path stands in production. "planned" = points from the plan, nothing to make. */
export type PathStepState = "todo" | "waiting" | "planned" | "done" | "skipped";
export function pathStepState(p: StoryPath, refHasVersion: (slotId: string) => boolean): PathStepState {
  if (p.createdBy) return "done";
  if (p.skipped) return "skipped";
  if (p.from) return refHasVersion(p.from) ? "todo" : "waiting";
  return hasPoints(p) ? "planned" : "todo";
}

/**
 * The guide step's title: "Create path <name> from <reference>"; without a reference "Path <name>" for a planned path
 * (already done) or "Draw path <name>" when it has no points yet.
 */
export function pathStepTitle(p: StoryPath, refName?: string): string {
  return p.from ? `Create path ${pathName(p)} from ${refName ?? p.from}` : hasPoints(p) ? `Path ${pathName(p)}` : `Draw path ${pathName(p)}`;
}

/** At most this many points from a track (the tolerance grows until it fits). */
export const MAX_TRACK_POINTS = 12;
/**
 * A tracker's box centre as a path in a frame of `frameAspect` (width / height): the reference is contain-fitted into
 * the frame like Send places a video layer, times are seconds from the tracker's in point, lost or weak frames are
 * left out; the rest is simplified to at most MAX_TRACK_POINTS points (0.6 % of the frame or looser) with smooth
 * inner points.
 */
export function pathFromTrack(track: Pick<NamedTrack, "samples" | "inS"> & Pick<MotionTrack, "srcW" | "srcH">, frameAspect: number, minConf = 0.45): MotionPath {
  const a = track.srcW / Math.max(1, track.srcH);
  const fw = a >= frameAspect ? 1 : a / frameAspect, fh = a >= frameAspect ? frameAspect / a : 1;
  const ok = track.samples.filter((s) => !s.lost && s.conf >= minConf);
  const t0 = track.inS ?? ok[0]?.s ?? 0;
  const xs = ok.map((s) => ({ t: Math.max(0, s.s - t0), v: (s.x - 0.5) * fw }));
  const ys = ok.map((s) => ({ t: Math.max(0, s.s - t0), v: (s.y - 0.5) * fh }));
  // An editable path, not a polyline of every frame: simplify (looser until at most MAX_TRACK_POINTS), then make the
  // inner points smooth so the curve flows through them.
  let tol = 0.006, mp = pathFromKeys(xs, ys, { x: 0, y: 0 }, tol);
  while (mp.nodes.length > MAX_TRACK_POINTS && tol < 0.05) { tol *= 1.5; mp = pathFromKeys(xs, ys, { x: 0, y: 0 }, tol); }
  if (mp.nodes.length && mp.nodes[0].t > 0) { const d = mp.nodes[0].t; mp.nodes = mp.nodes.map((n) => ({ ...n, t: n.t - d })); }
  for (const n of mp.nodes.slice(1, -1)) mp = setNodeSmooth(mp, n.id, true, frameAspect);
  return mp;
}

/** A path input of a code clip at clip offset `offset` (ticks): x / y 0–1 of the frame, angle in degrees, progress 0–1. */
export interface PathSignal { x: number; y: number; angle: number; progress: number; found: boolean }
export const NO_PATH: PathSignal = { x: 0.5, y: 0.5, angle: 0, progress: 0, found: false };
export function pathSignal(mp: MotionPath | undefined, offset: number, aspect: number): PathSignal {
  if (!mp?.nodes.length) return NO_PATH;
  const at = motionPathAt(mp, offset, aspect);
  if (!at) return NO_PATH;
  const t0 = mp.nodes[0].t, t1 = mp.nodes[mp.nodes.length - 1].t;
  return { x: r4(at.x + 0.5), y: r4(at.y + 0.5), angle: r4(at.angle ?? 0), progress: r4(t1 > t0 ? Math.max(0, Math.min(1, (offset - t0) / (t1 - t0))) : 1), found: true };
}

// ---------------------------------------------------------------- JSON

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/;
type Issue = (path: string, message: string) => void;
const PATH_KEYS = ["id", "name", "description", "from", "track", "durationSec", "motionPath", "createdBy", "skipped"];

/**
 * Root `paths` (parse step; errors only for what makes the list unusable: a bad id, a duplicate). A bad path's points
 * or a reference to an unknown asset only warn and drop that field.
 */
export function parseStoryPaths(raw: unknown, o: { aspect: number; ticksPerSecond: number; assetType: (id: string) => string | undefined; err: Issue; warn: Issue }): StoryPath[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { o.err("paths", '"paths" must be a list of { "id", "name"?, "motionPath"?, "from"?, "track"? }.'); return []; }
  const ids = new Set<string>(), out: StoryPath[] = [];
  raw.forEach((v, i) => {
    const at = `paths[${i}]`;
    if (!isObj(v)) return o.err(at, "Each path must be an object.");
    const id = typeof v.id === "string" ? v.id : "";
    if (!ID_RE.test(id)) return o.err(`${at}.id`, `Path id ${JSON.stringify(v.id ?? "")} must be 1–48 letters, digits, ".", "_" or "-".`);
    if (ids.has(id)) return o.err(`${at}.id`, `Path id "${id}" is used twice.`);
    ids.add(id);
    for (const k of Object.keys(v)) if (!PATH_KEYS.includes(k)) o.warn(`${at}.${k}`, `Unknown field "${k}" on a path is ignored.`);
    const p: StoryPath = { id };
    if (typeof v.name === "string" && v.name.trim()) p.name = v.name.trim();
    if (typeof v.description === "string" && v.description.trim()) p.description = v.description.trim();
    if (v.durationSec !== undefined) {
      if (typeof v.durationSec === "number" && v.durationSec > 0 && v.durationSec <= 3600) p.durationSec = v.durationSec;
      else o.warn(`${at}.durationSec`, `durationSec ${JSON.stringify(v.durationSec)} is ignored: seconds, more than 0.`);
    }
    if (v.from !== undefined) {
      const t = typeof v.from === "string" ? o.assetType(v.from) : undefined;
      if (!t) o.warn(`${at}.from`, `"from" ${JSON.stringify(v.from)} is not an asset id; the path has nothing to be made from (it can still be drawn).`);
      else if (t !== "video" && t !== "image" && t !== "frame" && t !== "html") o.warn(`${at}.from`, `"from" is a ${t} asset; a path is made from a video (tracked) or a picture (drawn over). It is ignored.`);
      else p.from = v.from as string;
    }
    if (v.track !== undefined) { if (typeof v.track === "string" && v.track.trim()) { if (p.from) p.track = v.track.trim(); else o.warn(`${at}.track`, '"track" says what to follow in "from"; it is ignored without "from".'); } else o.warn(`${at}.track`, '"track" must be text.'); }
    if (v.createdBy !== undefined) { if ((PATH_CREATED_BY as readonly unknown[]).includes(v.createdBy)) p.createdBy = v.createdBy as PathCreatedBy; else o.warn(`${at}.createdBy`, `createdBy is "track" or "draw"; ${JSON.stringify(v.createdBy)} is ignored.`); }
    if (v.motionPath !== undefined) {
      if (isObj(v.motionPath) && "ref" in v.motionPath) o.warn(`${at}.motionPath`, "A path's points can't refer to another path; it is ignored.");
      else {
        const parsed = parseMotionPath(v.motionPath, { path: `${at}.motionPath`, durationSec: p.durationSec ?? DEFAULT_PATH_SEC, aspect: o.aspect, ticksPerSecond: o.ticksPerSecond, frame: true });
        for (const is of parsed.issues) o.warn(is.path, is.level === "error" ? `${is.message} The path's points are ignored.` : is.message);
        if (parsed.path) p.motionPath = parsed.path;
      }
    }
    if (v.skipped !== undefined) { if (v.skipped === true) p.skipped = true; else if (v.skipped !== false) o.warn(`${at}.skipped`, '"skipped" is true (the guide step was skipped: the planned points are final) or false.'); }
    if (p.createdBy && p.skipped) delete p.skipped; // a made path is done, not skipped
    if (p.createdBy && !p.motionPath) { o.warn(`${at}.createdBy`, "createdBy without points is ignored (the path still has to be made)."); delete p.createdBy; }
    if (!p.motionPath && !p.from && !p.skipped) o.warn(at, `Path "${id}" has no points and nothing to make it from: the guide asks to draw it.`);
    out.push(p);
  });
  return out;
}

/** A layer's `"motionPath": { "ref", "stretch"?, "offset"? }`. Unknown path ids warn and drop the ref. */
export function parsePathRef(v: Record<string, unknown>, at: string, known: ReadonlySet<string>, warn: Issue): StoryPathRef | undefined {
  for (const k of Object.keys(v)) if (!["ref", "stretch", "offset"].includes(k)) warn(`${at}.${k}`, `A path reference has "ref", "stretch"? and "offset"?; "${k}" is ignored (put points on the path in "paths").`);
  if (typeof v.ref !== "string" || !known.has(v.ref)) { warn(`${at}.ref`, `No path ${JSON.stringify(v.ref ?? "")} in "paths"${known.size ? ` (paths: ${[...known].join(", ")})` : ""}; the layer doesn't move.`); return undefined; }
  const r: StoryPathRef = { ref: v.ref };
  if (v.stretch !== undefined) { if (v.stretch === true) r.stretch = true; else if (v.stretch !== false) warn(`${at}.stretch`, '"stretch" is true (fit the path to the layer) or false.'); }
  if (v.offset !== undefined) {
    const off = v.offset;
    if (isObj(off) && typeof off.x === "number" && typeof off.y === "number" && Math.abs(off.x) <= 2 && Math.abs(off.y) <= 2) { if (off.x || off.y) r.offset = { x: r4(off.x), y: r4(off.y) }; }
    else warn(`${at}.offset`, '"offset" is { "x", "y" }: how far to move the whole path, fractions of the frame (−2 to 2).');
  }
  return r;
}

export function pathRefToJson(r: StoryPathRef): Record<string, unknown> {
  return { ref: r.ref, ...(r.stretch ? { stretch: true } : {}), ...(r.offset ? { offset: { ...r.offset } } : {}) };
}
export function storyPathToJson(p: StoryPath, ticksPerSecond: number): Record<string, unknown> {
  return {
    id: p.id, ...(p.name ? { name: p.name } : {}), ...(p.description ? { description: p.description } : {}),
    ...(p.from ? { from: p.from } : {}), ...(p.track ? { track: p.track } : {}), ...(p.durationSec ? { durationSec: p.durationSec } : {}),
    ...(p.motionPath ? { motionPath: motionPathToJson(p.motionPath, ticksPerSecond, true) } : {}), ...(p.createdBy ? { createdBy: p.createdBy } : {}),
    ...(p.skipped ? { skipped: true } : {}),
  };
}

/** Change (or add, or with null remove) one path on a board; layers that used a removed path keep their place. */
export function withPath<B extends BoardLike>(b: B, id: string, next: StoryPath | null): B {
  const paths = b.paths ?? [];
  const i = paths.findIndex((p) => p.id === id);
  const list = next === null ? paths.filter((p) => p.id !== id) : i < 0 ? [...paths, next] : paths.map((p) => (p.id === id ? next : p));
  const out = { ...b } as B;
  if (list.length) out.paths = list; else delete out.paths;
  if (next === null && b.shots) {
    const shots: Record<string, unknown> = {};
    for (const [sid, s] of Object.entries(b.shots)) shots[sid] = s.layers?.some((l) => l.pathRef?.ref === id) ? { ...s, layers: s.layers.map((l) => { if (l.pathRef?.ref !== id) return l; const { pathRef: _r, ...rest } = l; return rest; }) } : s;
    (out as BoardLike).shots = shots as BoardLike["shots"];
  }
  return out;
}

/** P90: skip (keep the planned points as final) or reopen a path's guide step. */
export function withPathSkipped(p: StoryPath, skipped: boolean): StoryPath {
  if (!!p.skipped === skipped || (skipped && p.createdBy)) return p;
  if (skipped) return { ...p, skipped: true };
  const { skipped: _s, ...rest } = p;
  return rest;
}

/** A fresh path id from a name ("Bee flight" → "bee-flight", "bee-flight-2" …). */
export function freshPathId(b: Pick<BoardLike, "paths">, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "path";
  const used = new Set((b.paths ?? []).map((p) => p.id));
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}

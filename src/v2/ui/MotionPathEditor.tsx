/**
 * P89 Motion path (After Effects style). docs/v2/MOTION_PATH.md.
 *
 * - `MotionPathOverlay` draws the path of the selected clip over the preview (always while it is selected; existing
 *   x / y keyframes, e.g. from tracking Follow, show dashed) and, in the Motion path mode, edits it: click / tap to add
 *   a point (drag while adding pulls Bezier handles), drag points and handles, click a segment to insert a point,
 *   double-click a point for smooth / corner.
 * - P90 view: zoom and pan are one view transform (`View`: zoom about a point, pan, clamped so the frame always
 *   covers its box). The frame element gets it as a CSS transform; the overlay is drawn in screen space from the same
 *   mapping, so points and handles keep 44 px targets at any zoom. Pinch / ⌘-Ctrl+wheel / − + / the % field zoom;
 *   two fingers, a drag on an empty area (Add point off), Space + drag, the middle button or the wheel pan;
 *   double-tap / double-click an empty area or Fit (0) resets.
 * - The mode is a draft session (`useMotionSession`): ✕ / Esc discards it, ✓ / Enter commits it as ONE undo step.
 *   Inside the mode every gesture is one step of the session's own undo (⌘/Ctrl+Z).
 * - `MotionPathBar` (desktop toolbar + timing strip), `MotionPathPhoneBar` (phone bottom context toolbar and number
 *   sheets) and `MotionPathSection` (desktop inspector) all edit the same draft.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPE, type ReactNode } from "react";
import { cmd, type Engine } from "../engine";
import { motion, storyPaths, transformOf, ticksToSeconds, secondsToTicks, type MotionEase, type MotionPath, type Placement } from "../domain";
import { Ic } from "./Icon";
import { Sheet } from "./Sheet";
import { SliderField } from "./SliderField";

const EASE_LABEL: Record<MotionEase, string> = { linear: "Linear", in: "Ease in", out: "Ease out", inOut: "Ease in-out" };
const EASE_HINT: Record<MotionEase, string> = { linear: "Even speed along this segment", in: "Starts slow, speeds up", out: "Starts fast, slows down", inOut: "Slow at both ends" };
/** Hit radius (CSS px) for points and handles: a 44px target. */
const HIT = 22;
const SEG_HIT = 12;

/** The path a clip shows: its motion path, else (dashed in the overlay) its x / y keyframes as a path. */
export function shownPath(pl: Placement): { path: MotionPath; fromKeys: boolean } | undefined {
  if (pl.motionPath?.nodes.length) return { path: pl.motionPath, fromKeys: false };
  if ((pl.keyframes?.x?.length ?? 0) + (pl.keyframes?.y?.length ?? 0) < 2) return undefined;
  const t = transformOf(pl), p = motion.pathFromKeys(pl.keyframes?.x, pl.keyframes?.y, { x: t.x, y: t.y });
  return p.nodes.length > 1 ? { path: p, fromKeys: true } : undefined;
}
/** The draft a Motion path session starts from. */
export function initialDraft(pl: Placement): MotionPath {
  return shownPath(pl)?.path ? structuredClone(shownPath(pl)!.path) : { nodes: [], constantSpeed: true };
}

export interface MotionSession {
  id: string; draft: MotionPath; sel?: string; add: boolean;
  past: MotionPath[]; future: MotionPath[];
  /** The preview zoom while editing (1 = fit). */
  view: View;
  /** P90: Space is held (the hand: a drag pans). */
  hand?: boolean;
}

/** P90: the editing view. z = zoom (1 = fit), tx / ty = pan of the frame centre from its fitted place (CSS px). */
export interface View { z: number; tx: number; ty: number }
export const FIT: View = { z: 1, tx: 0, ty: 0 };
export const MAX_ZOOM = 8;
/** A box in the wrapper's CSS px. */
export interface Box { left: number; top: number; width: number; height: number }
/** Where the frame is drawn under `v` (its fitted box `base` scaled about its centre, then panned). */
export function viewBox(base: Box, v: View): Box {
  const w = base.width * v.z, h = base.height * v.z;
  return { left: base.left + base.width / 2 + v.tx - w / 2, top: base.top + base.height / 2 + v.ty - h / 2, width: w, height: h };
}
/** Keep the zoom in 1–MAX_ZOOM and the zoomed frame covering its fitted box (no empty margin can be panned in). */
export function clampView(v: View, base: Pick<Box, "width" | "height">): View {
  if (!(v.z > 1.001)) return FIT;
  const z = Math.min(MAX_ZOOM, v.z), mx = ((z - 1) * base.width) / 2, my = ((z - 1) * base.height) / 2;
  return { z, tx: Math.max(-mx, Math.min(mx, v.tx)), ty: Math.max(-my, Math.min(my, v.ty)) };
}
/** Zoom to `z` keeping the wrapper point (px, py) where it is. */
export function zoomAt(v: View, base: Box, z: number, px: number, py: number): View {
  const cx = base.left + base.width / 2, cy = base.top + base.height / 2, k = z / v.z;
  return clampView({ z, tx: px - cx - (px - cx - v.tx) * k, ty: py - cy - (py - cy - v.ty) * k }, base);
}
export const panBy = (v: View, base: Box, dx: number, dy: number): View => clampView({ ...v, tx: v.tx + dx, ty: v.ty + dy }, base);
const sameView = (a: View, b: View) => Math.abs(a.z - b.z) < 1e-6 && Math.abs(a.tx - b.tx) < 0.01 && Math.abs(a.ty - b.ty) < 0.01;

/** The Motion path draft session (one per app). `onPreview` shows a draft on the preview (null = stop). */
export function useMotionSession(engine: Engine, onPreview: (s: { id: string; path: MotionPath | null } | null) => void, onToast: (m: string) => void) {
  const [s, setS] = useState<MotionSession>();
  const ref = useRef(s); ref.current = s;
  const preview = useRef(onPreview); preview.current = onPreview;
  /** P89b: a session started for something that is not a clip (a storyboard path) commits through this instead. */
  const commitTo = useRef<(path: MotionPath | null) => void>();
  /** P90: whether the view moved while Space was held (a Space tap without a pan plays / pauses). */
  const handUsed = useRef(false);
  useEffect(() => { preview.current(s ? { id: s.id, path: s.draft.nodes.length ? s.draft : null } : null); }, [s?.id, s?.draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const api = {
    session: s,
    start(pl: Placement, opts: { draft?: MotionPath; onCommit?: (path: MotionPath | null) => void } = {}) { commitTo.current = opts.onCommit; const draft = opts.draft ? structuredClone(opts.draft) : initialDraft(pl); setS({ id: pl.id, draft, add: draft.nodes.length < 2, past: [], future: [], sel: undefined, view: FIT }); },
    /** Close without changing the project. */
    cancel() { commitTo.current = undefined; setS(undefined); },
    /** One undo step with the draft (nothing when unchanged). */
    commit() {
      const cur = ref.current;
      if (!cur) return;
      setS(undefined);
      if (!cur.past.length) return;
      const to = commitTo.current;
      if (to) { commitTo.current = undefined; to(cur.draft.nodes.length ? cur.draft : null); return; }
      const ok = engine.dispatch(cmd.setMotionPath(cur.id, cur.draft.nodes.length ? cur.draft : null), cur.draft.nodes.length ? "Motion path" : "Remove motion path");
      onToast(ok ? (cur.draft.nodes.length ? `Motion path saved (${cur.draft.nodes.length} point${cur.draft.nodes.length === 1 ? "" : "s"})` : "Motion path removed") : "Motion path unchanged");
    },
    /** Start of a gesture: remember the draft for the session's undo. */
    begin() { setS((c) => c && { ...c, past: [...c.past.slice(-99), c.draft], future: [] }); },
    /** Change the draft inside a gesture (no new undo step). */
    change(draft: MotionPath, sel?: string | null) { setS((c) => c && { ...c, draft, ...(sel === undefined ? {} : { sel: sel ?? undefined }) }); },
    /** A one-shot edit: its own undo step. */
    edit(fn: (d: MotionPath) => MotionPath, sel?: string | null) { setS((c) => { if (!c) return c; const d = fn(c.draft); return d === c.draft ? c : { ...c, draft: d, past: [...c.past.slice(-99), c.draft], future: [], ...(sel === undefined ? {} : { sel: sel ?? undefined }) }; }); },
    /** P90: drop the gesture in progress (back to the draft before `begin`, no redo step). */
    dropStep() { setS((c) => (c && c.past.length ? { ...c, draft: c.past[c.past.length - 1], past: c.past.slice(0, -1), sel: c.past[c.past.length - 1].nodes.some((n) => n.id === c.sel) ? c.sel : undefined } : c)); },
    undo() { setS((c) => (c && c.past.length ? { ...c, draft: c.past[c.past.length - 1], past: c.past.slice(0, -1), future: [c.draft, ...c.future], sel: c.past[c.past.length - 1].nodes.some((n) => n.id === c.sel) ? c.sel : undefined } : c)); },
    redo() { setS((c) => (c && c.future.length ? { ...c, draft: c.future[0], future: c.future.slice(1), past: [...c.past, c.draft] } : c)); },
    select(id?: string) { setS((c) => c && { ...c, sel: id }); },
    setAdd(add: boolean) { setS((c) => c && { ...c, add }); },
    setView(view: View) { if (ref.current?.hand) handUsed.current = true; setS((c) => (c && !sameView(c.view, view) ? { ...c, view } : c)); },
    /** P90: zoom by `k` about the frame centre (keys, − / +); the overlay clamps the pan. */
    zoomBy(k: number) { setS((c) => { if (!c) return c; const z = Math.max(1, Math.min(MAX_ZOOM, c.view.z * k)); const f = z / c.view.z; return { ...c, view: z <= 1.001 ? FIT : { z, tx: c.view.tx * f, ty: c.view.ty * f } }; }); },
    fit() { setS((c) => (c && !sameView(c.view, FIT) ? { ...c, view: FIT } : c)); },
    /** P90: Space down / up. Returns, on up, whether the view was panned during the hold. */
    setHand(on: boolean): boolean { const used = handUsed.current; if (on) handUsed.current = false; setS((c) => (c && !!c.hand !== on ? { ...c, hand: on || undefined } : c)); return used; },
  };
  return api;
}
export type MotionApi = ReturnType<typeof useMotionSession>;

/** Append a point at the path's end with sensible timing: even speed spreads over the clip; set times go after the last. */
export function addEnd(mp: MotionPath, x: number, y: number, dur: number, at: number, aspect: number): { path: MotionPath; id: string } {
  const n = mp.nodes.length;
  if (mp.constantSpeed || !n) {
    const r = motion.appendPoint(mp, x, y, n ? dur : 0);
    const t0 = r.path.nodes[0].t;
    return { path: n ? motion.spreadByDistance(r.path, t0, Math.max(t0 + 1, dur), aspect) : r.path, id: r.id };
  }
  const last = mp.nodes[n - 1].t;
  const t = at > last + 1 && at <= dur ? at : Math.min(dur, last + secondsToTicks(0.5));
  if (t > last) return motion.appendPoint(mp, x, y, t);
  // No room left in the clip: squeeze the times so the new point ends at the clip end.
  const k = (dur * n) / (n + 1) / Math.max(1, last);
  return motion.appendPoint({ ...mp, nodes: mp.nodes.map((m) => ({ ...m, t: Math.round(m.t * k) })) }, x, y, dur);
}

/**
 * Frame ↔ CSS px mapping for the frame element inside its wrapper under the view `v`. `applied` is the view whose CSS
 * transform the element has now (its rect is measured through it), so the fitted box is recovered exactly and the
 * mapping is right even before the new transform is applied.
 */
function frameMap(canvas: HTMLElement, v: View, applied: View) {
  const cr = canvas.getBoundingClientRect(), w = canvas.parentElement!.getBoundingClientRect();
  const bw = cr.width / applied.z, bh = cr.height / applied.z;
  const base: Box = { left: cr.left - w.left + cr.width / 2 - applied.tx - bw / 2, top: cr.top - w.top + cr.height / 2 - applied.ty - bh / 2, width: bw, height: bh };
  const b = viewBox(base, v);
  // r: the drawn frame in client px (for hit tests against pointer events).
  const r = { left: w.left + b.left, top: w.top + b.top, width: b.width, height: b.height };
  return {
    r, w, base,
    px: (x: number) => b.left + (x + 0.5) * b.width,
    py: (y: number) => b.top + (y + 0.5) * b.height,
    fx: (cx: number) => (cx - r.left) / Math.max(1, r.width) - 0.5,
    fy: (cy: number) => (cy - r.top) / Math.max(1, r.height) - 0.5,
    /** Client px → wrapper px. */
    wx: (cx: number) => cx - w.left, wy: (cy: number) => cy - w.top,
    kx: r.width, ky: r.height,
  };
}

/**
 * The path over the preview. Display only (pointer-events none) unless `api` is given (the mode).
 * `offset` = playhead ticks from the clip start (the dot shows where the clip is now).
 */
export function MotionPathOverlay({ canvas, placement, path, fromKeys, offset, aspect, api, onSeekOffset, zoomUi = true }: {
  /** The frame element (the preview canvas, or a reference image / video) inside a positioned wrapper. */
  canvas: HTMLElement; placement: Placement; path: MotionPath; fromKeys?: boolean; offset: number; aspect: number;
  api?: MotionApi; onSeekOffset?: (ticks: number) => void;
  /** P90: draw the zoom control over the frame's corner (false: the host places `ZoomControl` itself). */
  zoomUi?: boolean;
}) {
  const [, force] = useState(0);
  // Follow the canvas size (window resize, panel drag).
  useEffect(() => {
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => force((n) => n + 1)) : undefined;
    ro?.observe(canvas.parentElement!);
    return () => ro?.disconnect();
  }, [canvas]);
  const s = api?.session;
  const view = s?.view ?? FIT;
  // P90: the frame element shows the view as a CSS transform (about its centre); `applied` is what it has now.
  const applied = useRef<View>(FIT);
  const m = frameMap(canvas, view, applied.current);
  useLayoutEffect(() => {
    const fit = sameView(view, FIT);
    canvas.style.transformOrigin = fit ? "" : "50% 50%";
    canvas.style.transform = fit ? "" : `translate(${view.tx}px, ${view.ty}px) scale(${view.z})`;
    canvas.parentElement?.classList.toggle("is-mp-zoomed", !fit);
    applied.current = view;
    // Keys and − / + zoom about the centre: keep the pan inside the frame.
    const c = clampView(view, m.base);
    if (api && !sameView(c, view)) api.setView(c);
  }, [canvas, view.z, view.tx, view.ty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { canvas.style.transform = ""; canvas.style.transformOrigin = ""; canvas.parentElement?.classList.remove("is-mp-zoomed"); applied.current = FIT; }, [canvas]);
  const nodes = path.nodes;
  const dur = placement.durationTicks;
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; v: View; mx: number; my: number }>();
  /** P90: a pan in progress (hand, middle button, or a drag on an empty area when Add point is off). */
  const pan = useRef<{ x: number; y: number; v: View; moved: boolean; tap: boolean }>();
  const lastEmptyTap = useRef(0);
  const drag = useRef<{ kind: "node" | "in" | "out" | "pull"; id: string; x0: number; y0: number; start: MotionPath; moved: boolean; node0: { x: number; y: number } }>();
  const lastTap = useRef<{ id: string; at: number }>();

  const segs = useMemo(() => nodes.slice(0, -1).map((_, i) => motion.segmentPoints(nodes, i)), [nodes]);
  const d = segs.map((p) => `M${m.px(p[0].x)},${m.py(p[0].y)} C${m.px(p[1].x)},${m.py(p[1].y)} ${m.px(p[2].x)},${m.py(p[2].y)} ${m.px(p[3].x)},${m.py(p[3].y)}`).join(" ");
  const now = motion.motionPathAt(path, offset, aspect);
  const times = nodes.length ? motion.motionPathTimes(path, aspect) : [];
  const sel = s?.sel ? nodes.find((n) => n.id === s.sel) : undefined;

  const local = (e: { clientX: number; clientY: number }) => ({ x: m.fx(e.clientX), y: m.fy(e.clientY) });
  const nearSeg = (cx: number, cy: number) => {
    let best: { i: number; s: number; d: number } | undefined;
    segs.forEach((p, i) => {
      for (let k = 0; k <= 32; k += 1) {
        const q = motion.bezierAt(p, k / 32), dd = Math.hypot(m.r.left + (q.x + 0.5) * m.kx - cx, m.r.top + (q.y + 0.5) * m.ky - cy);
        if (!best || dd < best.d) best = { i, s: k / 32, d: dd };
      }
    });
    return best && best.d <= SEG_HIT ? best : undefined;
  };
  const down = (e: RPE<SVGSVGElement>) => {
    if (!api || !s) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) {
      // A second finger: zoom; the one-finger gesture that had started (a point added, inserted or moved) is dropped,
      // so a pinch never leaves a stray point (P90 fix: it used to keep a point the first finger had added).
      if (drag.current) api.dropStep();
      drag.current = undefined; pan.current = undefined;
      const [a, b] = [...ptrs.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), v: view, mx: m.wx((a.x + b.x) / 2), my: m.wy((a.y + b.y) / 2) };
      return;
    }
    if (ptrs.current.size > 2) return;
    // P90: the hand (Space held) or the middle button pans from anywhere.
    if (s.hand || e.button === 1) { pan.current = { x: e.clientX, y: e.clientY, v: view, moved: false, tap: false }; return; }
    const hit = (e.target as Element).closest?.("[data-mp]") as HTMLElement | SVGElement | null;
    const kind = hit?.getAttribute("data-mp"), id = hit?.getAttribute("data-id") ?? "";
    const p = local(e);
    if (kind === "node" || kind === "in" || kind === "out") {
      const n = nodes.find((x) => x.id === id)!;
      api.begin();
      drag.current = { kind, id, x0: p.x, y0: p.y, start: path, moved: false, node0: kind === "node" ? { x: n.x, y: n.y } : { x: n[kind]?.x ?? 0, y: n[kind]?.y ?? 0 } };
      api.select(id);
      return;
    }
    const seg = nodes.length > 1 ? nearSeg(e.clientX, e.clientY) : undefined;
    if (seg) {
      api.begin();
      const r = motion.insertOnSegment(path, seg.i, seg.s, aspect);
      api.change(r.path, r.id);
      const n = r.path.nodes.find((x) => x.id === r.id)!;
      drag.current = { kind: "node", id: r.id, x0: p.x, y0: p.y, start: r.path, moved: true, node0: { x: n.x, y: n.y } };
      return;
    }
    if (s.add) {
      api.begin();
      const r = addEnd(path, round(p.x), round(p.y), dur, offset, aspect);
      api.change(r.path, r.id);
      drag.current = { kind: "pull", id: r.id, x0: p.x, y0: p.y, start: r.path, moved: true, node0: { x: p.x, y: p.y } };
      return;
    }
    // P90: an empty area with Add point off: a drag pans (when zoomed), a tap deselects, a double tap fits / zooms in.
    pan.current = { x: e.clientX, y: e.clientY, v: view, moved: false, tap: true };
  };
  const move = (e: RPE<SVGSVGElement>) => {
    if (!api || !ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && ptrs.current.size === 2) {
      // Two fingers: zoom about where they started and pan with their midpoint.
      const [a, b] = [...ptrs.current.values()], pc = pinch.current;
      const z = Math.max(1, Math.min(MAX_ZOOM, pc.v.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pc.d)));
      api.setView(panBy(zoomAt(pc.v, m.base, z, pc.mx, pc.my), m.base, m.wx((a.x + b.x) / 2) - pc.mx, m.wy((a.y + b.y) / 2) - pc.my));
      return;
    }
    const pn = pan.current;
    if (pn) {
      const dx = e.clientX - pn.x, dy = e.clientY - pn.y;
      if (!pn.moved && Math.hypot(dx, dy) < 4) return;
      pn.moved = true;
      if (pn.v.z > 1) api.setView(panBy(pn.v, m.base, dx, dy));
      return;
    }
    const dr = drag.current;
    if (!dr) return;
    const p = local(e), dx = p.x - dr.x0, dy = p.y - dr.y0;
    if (!dr.moved && Math.hypot(dx * m.kx, dy * m.ky) < 3) return;
    dr.moved = true;
    if (dr.kind === "node") api.change(motion.moveNode(dr.start, dr.id, round(dr.node0.x + dx), round(dr.node0.y + dy)));
    else if (dr.kind === "pull") { if (Math.hypot(dx * m.kx, dy * m.ky) >= 4) api.change(motion.setNodeHandle(dr.start, dr.id, "out", round(dx), round(dy), true)); }
    else api.change(motion.setNodeHandle(dr.start, dr.id, dr.kind, round(dr.node0.x + dx), round(dr.node0.y + dy), !e.altKey));
  };
  const up = (e: RPE<SVGSVGElement>) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = undefined;
    const pn = pan.current;
    pan.current = undefined;
    if (api && pn?.tap && !pn.moved && e.type === "pointerup") {
      api.select(undefined);
      const t = Date.now();
      if (t - lastEmptyTap.current < 350) {
        lastEmptyTap.current = 0;
        if (view.z > 1.001) api.fit(); else api.setView(zoomAt(view, m.base, 2.5, m.wx(e.clientX), m.wy(e.clientY)));
      } else lastEmptyTap.current = t;
    }
    const dr = drag.current;
    drag.current = undefined;
    if (!api || !dr) return;
    if (dr.kind === "node" && !dr.moved) {
      api.undo(); // a tap: nothing changed, drop the empty step
      const t = Date.now(), lt = lastTap.current;
      if (lt && lt.id === dr.id && t - lt.at < 350) { api.edit((d0) => motion.setNodeSmooth(d0, dr.id, !motion.isSmooth(d0.nodes.find((n) => n.id === dr.id)!), aspect)); lastTap.current = undefined; }
      else lastTap.current = { id: dr.id, at: t };
      const i = nodes.findIndex((n) => n.id === dr.id);
      if (i >= 0 && onSeekOffset) onSeekOffset(Math.min(dur - 1, Math.max(0, times[i])));
      api.select(dr.id);
    }
  };
  // P90: ⌘/Ctrl + wheel (and a trackpad pinch) zooms about the pointer; the plain wheel pans once zoomed (⇧ = sideways)
  // and zooms in at fit, where there is nothing to pan.
  const wheel = (e: WheelEvent) => {
    if (!api) return;
    e.preventDefault(); // ⌘/Ctrl + wheel would zoom the page
    const px = m.wx(e.clientX), py = m.wy(e.clientY);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey || view.z <= 1.001) {
      const z = Math.max(1, Math.min(MAX_ZOOM, view.z * Math.exp(-dy * (e.ctrlKey && !e.metaKey && Math.abs(dy) < 50 ? 0.01 : 0.0015))));
      api.setView(zoomAt(view, m.base, z, px, py));
    } else api.setView(panBy(view, m.base, -(e.shiftKey ? dy : dx), -(e.shiftKey ? 0 : dy)));
  };
  const editing = !!api;
  // A native non-passive listener: React's wheel listener is passive, so it could not stop the page zoom.
  const svgRef = useRef<SVGSVGElement>(null);
  const onWheel = useRef(wheel); onWheel.current = wheel;
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !editing) return;
    const h = (e: WheelEvent) => onWheel.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [editing]);
  const handle = (n: MotionPath["nodes"][number], which: "in" | "out") => {
    const h = n[which];
    if (!h) return null;
    const hx = m.px(n.x + h.x), hy = m.py(n.y + h.y);
    return <g key={`${n.id}-${which}`}>
      <line x1={m.px(n.x)} y1={m.py(n.y)} x2={hx} y2={hy} className="v2-mp-hline" />
      <circle cx={hx} cy={hy} r={5} className="v2-mp-handle" />
      <circle cx={hx} cy={hy} r={HIT - 4} className="v2-mp-hit" data-mp={which} data-id={n.id} role="slider" aria-label={`Point ${nodes.indexOf(n) + 1} ${which === "in" ? "in" : "out"} handle`} aria-valuetext={`${round2(h.x)}, ${round2(h.y)}`} />
    </g>;
  };
  return (<>
    <svg className={`v2-mp-overlay${editing ? " is-editing" : ""}${fromKeys ? " is-keys" : ""}${s?.hand ? " is-hand" : ""}${pan.current?.moved ? " is-panning" : ""}`} data-testid={editing ? "motion-path-editor" : "motion-path-shown"} width={m.w.width} height={m.w.height}
      role={editing ? "application" : undefined} aria-label={editing ? "Motion path: click to add points, drag points and handles, click a segment to insert a point" : undefined}
      ref={svgRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {d && <path d={d} className="v2-mp-line-under" />}
      {d && <path d={d} className="v2-mp-line" />}
      {editing && sel && <>{handle(sel, "in")}{handle(sel, "out")}</>}
      {nodes.map((n, i) => {
        const x = m.px(n.x), y = m.py(n.y), on = sel?.id === n.id, smooth = motion.isSmooth(n);
        return <g key={n.id}>
          {smooth ? <circle cx={x} cy={y} r={on ? 6 : 4.5} className={`v2-mp-node${on ? " is-sel" : ""}`} /> : <rect x={x - (on ? 6 : 4.5)} y={y - (on ? 6 : 4.5)} width={on ? 12 : 9} height={on ? 12 : 9} className={`v2-mp-node${on ? " is-sel" : ""}`} />}
          {editing && <circle cx={x} cy={y} r={HIT} className="v2-mp-hit" data-mp="node" data-id={n.id} role="button" aria-pressed={on}
            aria-label={`Point ${i + 1} at ${ticksToSeconds(times[i] ?? n.t).toFixed(2)} s${smooth ? ", smooth" : ", corner"}`} />}
        </g>;
      })}
      {now && <circle cx={m.px(now.x)} cy={m.py(now.y)} r={7} className="v2-mp-now" />}
    </svg>
    {api && s && zoomUi && <ZoomControl api={api} view={view} />}
  </>);
}

/** P90: − / exact % / + / Fit for the editing view (top right of the frame). */
export function ZoomControl({ api, view, inline }: { api: MotionApi; view: View; /** Laid out in the flow (outside the frame). */ inline?: boolean }) {
  const pct = Math.round(view.z * 100);
  const [text, setText] = useState(String(pct));
  useEffect(() => setText(String(pct)), [pct]);
  const apply = () => { const v = Number(text.replace(/[^0-9.]/g, "")); if (v > 0) api.zoomBy(Math.max(100, Math.min(MAX_ZOOM * 100, v)) / 100 / view.z); else setText(String(pct)); };
  return (
    <div className={`v2-mp-zoom${inline ? " is-inline" : ""}`} role="group" aria-label="Zoom" data-testid="mp-zoom" onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="v2-mp-zbtn" aria-label="Zoom out" title="Zoom out (−)" disabled={view.z <= 1.001} onClick={() => api.zoomBy(1 / 1.25)}><Ic g="zoom-out" size={16} /></button>
      <label className="v2-mp-zfield" title="Zoom in percent (100 = fit). Scroll pans, ⌘/Ctrl + scroll or pinch zooms, Space + drag pans">
        <input aria-label="Zoom percent" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); apply(); (e.target as HTMLInputElement).blur(); } }} /><span aria-hidden>%</span>
      </label>
      <button type="button" className="v2-mp-zbtn" aria-label="Zoom in" title="Zoom in (+)" disabled={view.z >= MAX_ZOOM - 1e-6} onClick={() => api.zoomBy(1.25)}><Ic g="zoom-in" size={16} /></button>
      <button type="button" className="v2-mp-zbtn v2-mp-zfit" aria-label="Fit" title="Fit the frame (0, or double-tap an empty area)" disabled={view.z <= 1.001} onClick={() => api.fit()}><Ic g="fit" size={16} /> <span>Fit</span></button>
    </div>
  );
}
const round = (v: number) => Math.round(v * 1e4) / 1e4;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Keys while the mode is open: Esc cancel, Enter done, Delete the point, ⌘/Ctrl+Z / ⇧Z the session's undo / redo. */
export function useMotionKeys(api: MotionApi, opts: { /** P90: Space pressed and released without panning (play / pause). */ onSpaceTap?: () => void } = {}) {
  const tap = useRef(opts.onSpaceTap); tap.current = opts.onSpaceTap;
  const ref = useRef(api); ref.current = api;
  const on = !!api.session;
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      const a = ref.current, s = a.session;
      if (!s) return;
      const inField = !!(e.target as HTMLElement)?.closest?.("input,textarea,select,[contenteditable=true]");
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      let handled = true;
      // Esc with one of the mode's sheets open closes that sheet (the Sheet handles it), not the session.
      if (e.key === "Escape" && document.querySelector(".v2-mp-sheet")) return;
      if (e.key === "Escape" && !inField) a.cancel();
      else if (e.key === "Enter" && !inField && !(e.target as HTMLElement)?.closest?.("button")) a.commit();
      else if ((e.key === "Delete" || e.key === "Backspace") && !inField && s.sel) { const id = s.sel; a.edit((d) => motion.deleteNode(d, id), null); }
      else if (mod && k === "z" && !inField) { if (e.shiftKey) a.redo(); else a.undo(); }
      else if (mod && k === "y" && !inField) a.redo();
      else if (k === "p" && !mod && !inField) a.setAdd(!s.add);
      // P90: Space held = the hand (drag pans); a tap still plays / pauses. 0 fits, + / − zoom.
      else if (e.key === " " && !inField && !(e.target as HTMLElement)?.closest?.("button")) { if (!e.repeat && !s.hand) a.setHand(true); }
      else if (k === "0" && !mod && !inField) a.fit();
      else if ((k === "=" || k === "+") && !mod && !inField) a.zoomBy(1.25);
      else if ((k === "-" || k === "_") && !mod && !inField) a.zoomBy(1 / 1.25);
      else handled = false;
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    const onUp = (e: KeyboardEvent) => {
      const a = ref.current;
      if (e.key !== " " || !a.session?.hand) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!a.setHand(false)) tap.current?.();
    };
    const onBlur = () => { if (ref.current.session?.hand) ref.current.setHand(false); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("keyup", onUp, true); window.removeEventListener("blur", onBlur); };
  }, [on]);
}

/** Time ruler of the clip with a marker per point (drag to retime; click the ruler to seek). */
export function TimingStrip({ api, placement, aspect, offset, onSeekOffset }: { api: MotionApi; placement: Placement; aspect: number; offset: number; onSeekOffset: (t: number) => void }) {
  const s = api.session!, mp = s.draft, dur = placement.durationTicks;
  const times = mp.nodes.length ? motion.motionPathTimes(mp, aspect) : [];
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; moved: boolean; start: MotionPath }>();
  const tAt = (cx: number) => { const r = bar.current!.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (cx - r.left) / Math.max(1, r.width))) * dur); };
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / Math.max(1, dur)) * 100))}%`;
  return (
    <div className="v2-mp-strip" ref={bar} data-testid="motion-timing" aria-label="Point times along the clip"
      onPointerDown={(e) => { if ((e.target as Element).closest("[data-mpt]")) return; onSeekOffset(tAt(e.clientX)); }}>
      <span className="v2-mp-strip-line" aria-hidden />
      <span className="v2-mp-strip-head" style={{ left: pct(offset) }} aria-hidden />
      {mp.nodes.map((n, i) => (
        <button key={n.id} type="button" data-mpt className={`v2-mp-mark${s.sel === n.id ? " is-sel" : ""}`} style={{ left: pct(times[i]) }}
          role="slider" aria-label={`Point ${i + 1} time`} aria-valuemin={0} aria-valuemax={ticksToSeconds(dur)} aria-valuenow={round2(ticksToSeconds(times[i]))} aria-valuetext={`${ticksToSeconds(times[i]).toFixed(2)} s`}
          title={`Point ${i + 1}: ${ticksToSeconds(times[i]).toFixed(2)} s — drag to change when the clip passes it`}
          onPointerDown={(e) => { e.stopPropagation(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ } api.begin(); drag.current = { id: n.id, moved: false, start: mp }; api.select(n.id); }}
          onPointerMove={(e) => { const dr = drag.current; if (!dr) return; dr.moved = true; api.change(motion.setNodeTime(motion.materializeTimes(dr.start, aspect), dr.id, tAt(e.clientX), aspect)); }}
          onPointerUp={() => { const dr = drag.current; drag.current = undefined; if (dr && !dr.moved) { api.undo(); api.select(dr.id); onSeekOffset(Math.min(dur - 1, times[i])); } }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault(); e.stopPropagation();
            const step = secondsToTicks(e.shiftKey ? 0.5 : 0.05) * (e.key === "ArrowLeft" ? -1 : 1);
            api.edit((d) => motion.setNodeTime(motion.materializeTimes(d, aspect), n.id, times[i] + step, aspect), n.id);
          }}><i aria-hidden /></button>
      ))}
    </div>
  );
}

/** The selected point's numbers (time, X, Y) and its segment's ease; with `none` a hint when nothing is selected. */
export function PointFields({ api, placement, aspect, compact }: { api: MotionApi; placement: Placement; aspect: number; compact?: boolean }) {
  const s = api.session!, mp = s.draft, i = mp.nodes.findIndex((n) => n.id === s.sel), n = mp.nodes[i];
  if (!n) return <p className="v2-abnote v2-mp-hint">{mp.nodes.length ? "Select a point to set its time and position." : "Click or tap the preview to add the first point."}</p>;
  const times = motion.motionPathTimes(mp, aspect), dur = placement.durationTicks;
  const pct = { unit: "%", scale: 100 };
  return <div className={`v2-mp-fields${compact ? " is-compact" : ""}`}>
    <SliderField className="v2-insp-sf" label={`Point ${i + 1} time`} aria="Point time" value={ticksToSeconds(times[i])} min={0} max={ticksToSeconds(dur)} step={0.01} unit="s"
      title="When the clip passes this point (seconds from the clip start). Setting a time turns Even speed off."
      onBegin={() => api.begin()} onChange={(v) => api.change(motion.setNodeTime(motion.materializeTimes(api.session!.draft, aspect), n.id, secondsToTicks(v), aspect))} />
    <SliderField className="v2-insp-sf" label="X" aria="Point X" value={n.x} min={-1} max={1} step={0.005} {...pct} title="Centre of the clip at this point, from the frame centre (−50% = left edge)"
      onBegin={() => api.begin()} onChange={(v) => api.change(motion.moveNode(api.session!.draft, n.id, v, n.y))} />
    <SliderField className="v2-insp-sf" label="Y" aria="Point Y" value={n.y} min={-1} max={1} step={0.005} {...pct} title="Centre of the clip at this point, from the frame centre (−50% = top edge)"
      onBegin={() => api.begin()} onChange={(v) => api.change(motion.moveNode(api.session!.draft, n.id, n.x, v))} />
    {i < mp.nodes.length - 1 && <EaseChoice value={n.ease ?? "linear"} even={!!mp.constantSpeed} onPick={(e) => api.edit((d) => motion.setNodeEase(motion.setConstantSpeed(d, false, aspect), n.id, e))} />}
  </div>;
}

/** Ease of one segment. With Even speed on, picking an ease turns it off (the times stay where they are). */
function EaseChoice({ value, onPick, even }: { value: MotionEase; onPick: (e: MotionEase) => void; even?: boolean }) {
  return <div className="v2-mp-ease" role="radiogroup" aria-label="Ease of the segment after this point">
    {motion.MOTION_EASES.map((e) => <button key={e} type="button" role="radio" aria-checked={!even && value === e} className={`v2-seg-btn${!even && value === e ? " is-active" : ""}`} title={`${EASE_HINT[e]}${even ? " (turns Even speed off)" : ""}`} onClick={() => onPick(e)}>{EASE_LABEL[e]}</button>)}
  </div>;
}

/** Orient along the path (+ offset) and Even speed: the path-wide options. */
export function PathOptions({ api, aspect, dur }: { api: MotionApi; aspect: number; dur: number }) {
  const mp = api.session!.draft;
  return <div className="v2-mp-opts">
    <button type="button" className={`v2-btn v2-mp-toggle${mp.orient ? " is-active" : ""}`} role="switch" aria-checked={!!mp.orient} title="Turn the clip along its direction of travel (replaces its rotation)"
      onClick={() => api.edit((d) => motion.setOrient(d, d.orient ? undefined : { offset: 0 }))}><Ic g="mp-orient" size={16} /> Orient along path<span className="v2-mp-state">{mp.orient ? "On" : "Off"}</span></button>
    {mp.orient && <SliderField className="v2-insp-sf" label="Orient offset" value={mp.orient.offset} min={-180} max={180} step={1} unit="°" title="Added to the direction of travel"
      onBegin={() => api.begin()} onChange={(v) => api.change(motion.setOrient(api.session!.draft, { offset: v }))} />}
    <button type="button" className={`v2-btn v2-mp-toggle${mp.constantSpeed ? " is-active" : ""}`} role="switch" aria-checked={!!mp.constantSpeed} title="One even speed over the whole path: the inner points' times follow their distance"
      onClick={() => api.edit((d) => motion.setConstantSpeed(d, !d.constantSpeed, aspect))}><Ic g="mp-even" size={16} /> Even speed<span className="v2-mp-state">{mp.constantSpeed ? "On" : "Off"}</span></button>
    {!mp.nodes.length && <span className="v2-abnote">{ticksToSeconds(dur).toFixed(1)} s clip</span>}
  </div>;
}

const tool = (icon: string, label: string, run: () => void, o: { on?: boolean; disabled?: boolean; title?: string; danger?: boolean; testid?: string } = {}) =>
  <button key={label} type="button" className={`v2-tool${o.on ? " is-on" : ""}${o.danger ? " v2-sed-danger" : ""}`} aria-pressed={o.on} disabled={o.disabled} title={o.title ?? label} data-testid={o.testid} onClick={run}><b aria-hidden><Ic g={icon} /></b><span>{label}</span></button>;

/** The point tools both bars share. */
function pointTools(api: MotionApi, aspect: number) {
  const s = api.session!, sel = s.draft.nodes.find((n) => n.id === s.sel);
  const smooth = sel ? motion.isSmooth(sel) : false;
  return {
    add: tool("mp-add", "Add point", () => api.setAdd(!s.add), { on: s.add, title: "Add points: click / tap the preview to add a point at the path's end; drag while adding to pull curve handles (P)", testid: "mp-add" }),
    del: tool("🗑", "Delete", () => { if (sel) api.edit((d) => motion.deleteNode(d, sel.id), null); }, { disabled: !sel, title: "Delete the selected point (Del)", testid: "mp-delete" }),
    smooth: tool(smooth ? "mp-corner" : "mp-smooth", smooth ? "Corner" : "Smooth", () => { if (sel) api.edit((d) => motion.setNodeSmooth(d, sel.id, !smooth, aspect)); }, { disabled: !sel, title: smooth ? "Make a sharp corner (no handles)" : "Make a smooth curve through this point (handles)", testid: "mp-smooth" }),
  };
}

/** Desktop: the mode's toolbar under the preview (point tools, timing strip, ✕ / ✓). */
export function MotionPathBar({ api, placement, aspect, offset, onSeekOffset, name, title = "Motion path" }: { api: MotionApi; placement: Placement; aspect: number; offset: number; onSeekOffset: (t: number) => void; name: string; title?: string }) {
  const s = api.session!, t = pointTools(api, aspect);
  return <div className="v2-mp-bar" role="toolbar" aria-label="Motion path tools" data-testid="motion-path-bar">
    <div className="v2-mp-bar-row">
      <span className="v2-mp-title" title={`${title} of ${name}`}><Ic g="motion-path" size={16} /> <b>{title}</b> <span className="v2-mp-sub" data-testid="mp-count">{s.draft.nodes.length} pt{s.draft.nodes.length === 1 ? "" : "s"}</span></span>
      {t.add}{t.del}{t.smooth}
      <span className="v2-dsep" aria-hidden />
      {tool("↶", "Undo", () => api.undo(), { disabled: !s.past.length, title: "Undo the last path edit (⌘/Ctrl+Z)" })}
      <span className="v2-spacer" />
      <span className="v2-mp-keys" aria-hidden>Esc cancel · Enter done</span>
      <button type="button" className="v2-btn v2-mp-cancel" data-testid="mp-cancel" title="Discard the changes and leave (Esc)" onClick={() => api.cancel()}><Ic g="✕" size={16} /> Cancel</button>
      <button type="button" className="v2-btn primary v2-mp-done" data-testid="mp-done" title="Keep the path: one undo step (Enter)" onClick={() => api.commit()}><Ic g="✓" size={16} /> Done</button>
    </div>
    <TimingStrip api={api} placement={placement} aspect={aspect} offset={offset} onSeekOffset={onSeekOffset} />
  </div>;
}

/** Phone: the bottom context toolbar (replaces the clip tools) and its number sheets. */
export function MotionPathPhoneBar({ api, placement, aspect, offset, onSeekOffset }: { api: MotionApi; placement: Placement; aspect: number; offset: number; onSeekOffset: (t: number) => void }) {
  const [part, setPart] = useState<"point" | "ease" | "path">();
  const s = api.session!, t = pointTools(api, aspect), sel = s.draft.nodes.find((n) => n.id === s.sel);
  const selIdx = sel ? s.draft.nodes.indexOf(sel) : -1;
  const open = (p: typeof part) => setPart((x) => (x === p ? undefined : p));
  let sheet: ReactNode = null;
  if (part === "point") sheet = <Sheet label={sel ? `Point ${selIdx + 1}` : "Point"} className="v2-msheet-insp v2-mp-sheet" snaps={[0.42, 0.7]} initial={0} dim={false} onClose={() => setPart(undefined)}><PointFields api={api} placement={placement} aspect={aspect} compact /></Sheet>;
  if (part === "ease") sheet = <Sheet label="Ease" className="v2-msheet-insp v2-mp-sheet" snaps={[0.3, 0.5]} initial={0} dim={false} onClose={() => setPart(undefined)}>
    {sel && selIdx < s.draft.nodes.length - 1 ? <><p className="v2-abnote">How the clip speeds up and slows down between point {selIdx + 1} and point {selIdx + 2}.</p><EaseChoice value={sel.ease ?? "linear"} even={!!s.draft.constantSpeed} onPick={(e) => api.edit((d) => motion.setNodeEase(motion.setConstantSpeed(d, false, aspect), sel.id, e))} />{s.draft.constantSpeed && <p className="v2-abnote">Even speed is on: picking an ease turns it off and keeps the point times.</p>}</> : <p className="v2-abnote">Select a point that has a segment after it.</p>}
  </Sheet>;
  if (part === "path") sheet = <Sheet label="Path options" className="v2-msheet-insp v2-mp-sheet" snaps={[0.36, 0.6]} initial={0} dim={false} onClose={() => setPart(undefined)}><PathOptions api={api} aspect={aspect} dur={placement.durationTicks} /></Sheet>;
  return <>
    <div className="v2-mp-phone-strip"><TimingStrip api={api} placement={placement} aspect={aspect} offset={offset} onSeekOffset={onSeekOffset} /></div>
    <nav className="v2-toolbar v2-sed-ctx v2-mp-ctx" aria-label="Motion path tools" data-testid="motion-path-phonebar">
      <button type="button" className="v2-tool v2-tool-back" aria-label="Cancel motion path" title="Discard the changes and leave" data-testid="mp-cancel" onClick={() => api.cancel()}><b aria-hidden><Ic g="✕" /></b></button>
      <div className="v2-toolbar-scroll">
        {t.add}{t.del}{t.smooth}
        {tool("mp-time", "Point", () => open("point"), { on: part === "point", disabled: !sel, title: "The selected point's time and position" })}
        {tool("mp-ease", "Ease", () => open("ease"), { on: part === "ease", disabled: !sel, title: "Ease of the segment after the selected point" })}
        {tool("mp-orient", "Orient", () => open("path"), { on: part === "path" || !!s.draft.orient, title: "Orient along the path, its offset, and even speed" })}
        {tool("↶", "Undo", () => api.undo(), { disabled: !s.past.length })}
        {tool("✓", "Done", () => api.commit(), { title: "Keep the path (one undo step)", testid: "mp-done" })}
      </div>
    </nav>
    {sheet}
  </>;
}

/** Desktop inspector section: the path's state and entry, or (in the mode) the selected point and path options. */
export function MotionPathSection({ engine, placement, api, aspect, onStart }: { engine: Engine; placement: Placement; api: MotionApi; aspect: number; onStart: () => void }) {
  const s = api.session?.id === placement.id ? api.session : undefined;
  const mp = placement.motionPath, keys = !mp && shownPath(placement)?.fromKeys;
  const box = useRef<HTMLElement>(null);
  // Entering the mode brings this section into view (it holds the point's numbers).
  useEffect(() => { if (s) box.current?.scrollIntoView?.({ block: "nearest" }); }, [!!s]); // eslint-disable-line react-hooks/exhaustive-deps
  if (s) return <section ref={box} className="v2-psettings v2-mp-sec" aria-label="Motion path" data-testid="motion-path-section">
    <h4><Ic g="motion-path" size={14} /> Motion path · editing</h4>
    <PointFields api={api} placement={placement} aspect={aspect} />
    <PathOptions api={api} aspect={aspect} dur={placement.durationTicks} />
  </section>;
  const set = (next: MotionPath | null, label: string) => engine.dispatch(cmd.setMotionPath(placement.id, next), label);
  return <section ref={box} className="v2-psettings v2-mp-sec" aria-label="Motion path" data-testid="motion-path-section">
    <h4><Ic g="motion-path" size={14} /> Motion path</h4>
    <p className="v2-abnote">{mp ? `${mp.nodes.length} point${mp.nodes.length === 1 ? "" : "s"}${mp.constantSpeed ? " · even speed" : ""}${mp.orient ? ` · orients${mp.orient.offset ? ` ${mp.orient.offset > 0 ? "+" : ""}${mp.orient.offset}°` : ""}` : ""}.` : keys ? "Moves by X / Y keyframes (dashed on the preview). Edit them as a path." : "Draw a route on the preview for this clip to follow."}</p>
    <div className="v2-insp-actions">
      <button type="button" className="v2-btn" data-testid="mp-edit" onClick={onStart}><Ic g="motion-path" size={16} /> {mp || keys ? "Edit path" : "Draw path"}</button>
      {mp && <button type="button" className="v2-btn" title="Remove the path; the clip stays at its own position" onClick={() => set(null, "Remove motion path")}>Remove</button>}
    </div>
    {mp && <>
      <button type="button" className={`v2-btn v2-mp-toggle${mp.orient ? " is-active" : ""}`} role="switch" aria-checked={!!mp.orient} title="Turn the clip along its direction of travel" onClick={() => set(motion.setOrient(mp, mp.orient ? undefined : { offset: 0 }), "Orient along path")}><Ic g="mp-orient" size={16} /> Orient along path<span className="v2-mp-state">{mp.orient ? "On" : "Off"}</span></button>
      {mp.orient && <SliderField className="v2-insp-sf" label="Orient offset" value={mp.orient.offset} min={-180} max={180} step={1} unit="°" onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()} onChange={(v) => set(motion.setOrient(mp, { offset: v }), "Orient offset")} />}
      <button type="button" className={`v2-btn v2-mp-toggle${mp.constantSpeed ? " is-active" : ""}`} role="switch" aria-checked={!!mp.constantSpeed} title="One even speed over the whole path" onClick={() => set(motion.setConstantSpeed(mp, !mp.constantSpeed, aspect), "Even speed")}><Ic g="mp-even" size={16} /> Even speed<span className="v2-mp-state">{mp.constantSpeed ? "On" : "Off"}</span></button>
    </>}
    <NamedPaths engine={engine} placement={placement} />
  </section>;
}

/**
 * P89b named paths: link the clip to a storyboard path (Send / Update keep it fitted to the clip), copy a saved path
 * onto it, save its path under a name for other clips, unlink. Each is one undo step.
 */
export function NamedPaths({ engine, placement }: { engine: Engine; placement: Placement }) {
  const project = engine.getState().project;
  const b = project.storyboard;
  const board = (b?.paths ?? []).filter((x) => x.motionPath?.nodes.length);
  const saved = project.motionPaths ?? [];
  const mp = placement.motionPath, ref = placement.pathRef;
  const linked = ref ? storyPaths.findPath(b, ref.ref) : undefined;
  const [naming, setNaming] = useState<string>();
  const [note, setNote] = useState<string>();
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(undefined), 5000); return () => clearTimeout(t); }, [note]);
  const link = (id: string) => {
    const sp = storyPaths.findPath(b, id);
    if (!sp) return;
    const r: storyPaths.StoryPathRef = { ref: sp.id, stretch: true };
    const path = storyPaths.resolvePathRef(b, r, placement.durationTicks);
    if (path && engine.dispatch(cmd.setMotionPath(placement.id, path, `Path “${storyPaths.pathName(sp)}”`, { pathRef: r }))) setNote(`Linked to “${storyPaths.pathName(sp)}”, fitted to the clip`);
  };
  const use = (id: string) => {
    const sv = saved.find((x) => x.id === id);
    const path = sv && storyPaths.resolvePathRef({ paths: [{ id: "s", motionPath: sv.path }] }, { ref: "s", stretch: true }, placement.durationTicks);
    if (path && engine.dispatch(cmd.setMotionPath(placement.id, path, `Path “${sv!.name}”`, { pathRef: null }))) setNote(`“${sv!.name}” copied onto the clip, fitted to its length`);
  };
  const save = () => {
    const name = (naming ?? "").trim();
    if (!name || !mp) return;
    if (engine.dispatch(cmd.saveMotionPath(name, mp), `Save path “${name}”`)) { setNote(`Saved as “${name}”: use it on any clip`); setNaming(undefined); }
  };
  if (!board.length && !saved.length && !mp && !ref) return null;
  return <div className="v2-mp-named" data-testid="named-paths">
    {ref && <p className="v2-mp-link" role="note"><Ic g="link" size={14} /> <span>From storyboard path <b>“{linked ? storyPaths.pathName(linked) : ref.ref}”</b>{ref.stretch ? ", fitted to the clip" : ""}. Update keeps it in step with the board.</span>
      <button type="button" className="v2-btn v2-mp-mini" data-testid="mp-unlink" title="Keep the points as the clip's own path; changes on the board no longer move it" onClick={() => { if (mp && engine.dispatch(cmd.setMotionPath(placement.id, mp, "Unlink path", { pathRef: null }))) setNote("Unlinked: the path is the clip's own now"); }}><Ic g="unlink" size={16} /> Unlink</button></p>}
    {(board.length > 0 || saved.length > 0) && <>
      <h5 className="v2-mp-subhead">Named paths</h5>
      <ul className="v2-mp-list" aria-label="Named paths">
        {board.map((x) => <li key={`b:${x.id}`}>
          <span className="v2-mp-list-name"><Ic g="board" size={14} /> {storyPaths.pathName(x)}<em>{x.motionPath!.nodes.length} pts · storyboard</em></span>
          <button type="button" className="v2-btn v2-mp-mini" disabled={ref?.ref === x.id} aria-label={`Link to storyboard path ${storyPaths.pathName(x)}`} title="Move along this storyboard path, fitted to the clip (stays linked)" onClick={() => link(x.id)}><Ic g="link" size={16} /> {ref?.ref === x.id ? "Linked" : "Link"}</button>
        </li>)}
        {saved.map((x) => <li key={`s:${x.id}`}>
          <span className="v2-mp-list-name"><Ic g="bookmark" size={14} /> {x.name}<em>{x.path.nodes.length} pts · saved</em></span>
          <button type="button" className="v2-btn v2-mp-mini" aria-label={`Use saved path ${x.name}`} title="Copy this path onto the clip, fitted to its length" onClick={() => use(x.id)}><Ic g="motion-path" size={16} /> Use</button>
          <button type="button" className="v2-icon v2-mp-mini" aria-label={`Delete saved path ${x.name}`} title="Remove it from the saved paths (clips keep their copies)" onClick={() => { if (engine.dispatch(cmd.removeSavedMotionPath(x.id), `Delete saved path “${x.name}”`)) setNote(`“${x.name}” removed from saved paths (Undo restores it)`); }}><Ic g="🗑" size={16} /></button>
        </li>)}
      </ul>
    </>}
    {mp && (naming === undefined
      ? <button type="button" className="v2-btn v2-mp-mini" data-testid="mp-save-as" title="Save this path under a name to use it on other clips" onClick={() => setNaming(`Path ${saved.length + 1}`)}><Ic g="bookmark" size={16} /> Save as named path</button>
      : <form className="v2-mp-saveform" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input aria-label="Path name" value={naming} maxLength={40} autoFocus onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setNaming(undefined); } }} />
          <button type="submit" className="v2-btn primary v2-mp-mini" disabled={!naming.trim()}><Ic g="✓" size={16} /> Save</button>
          <button type="button" className="v2-icon v2-mp-mini" aria-label="Cancel saving" onClick={() => setNaming(undefined)}><Ic g="✕" size={16} /></button>
        </form>)}
    {note && <p className="v2-hint" role="status">{note}</p>}
  </div>;
}

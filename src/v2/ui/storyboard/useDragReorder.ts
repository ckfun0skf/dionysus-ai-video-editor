/**
 * Drag to reorder a vertical list (V2-CUT-02, reused by the production list in V2-CUT-07).
 *
 * - Mouse: press and move a few pixels to pick an item up (or use its grip).
 * - Touch (CapCut style): long-press lifts the item; drag to move it, or let go without moving to get its
 *   action sheet (`onHold`). A quick move before the long-press is an ordinary scroll.
 * - Works on iOS Safari: while an item is lifted, touchmove is cancelled so the page does not scroll, and
 *   the list auto-scrolls when the finger nears the top or bottom edge.
 *
 * Items are the list's children marked `data-reorder`. Only transforms are written during the drag; the
 * order changes once, on drop, through `onMove` (one undo step).
 */
import { useEffect, useRef } from "react";
import { haptic, LONG_PRESS_MS, LONG_PRESS_SLOP } from "../gestures";

const MOUSE_SLOP = 5, EDGE = 56, MAX_SCROLL = 14;

export interface DragReorderOpts {
  /**
   * Drop: move item `from` to index `to` (both in the current order). With `clamp`, `to` is the clamped
   * index and `wanted` the index the user dropped on, so the caller can explain why it stopped short.
   * Also called when the clamp blocks the move entirely (`to === from`, `wanted !== from`).
   */
  onMove: (from: number, to: number, wanted: number) => void;
  /** Touch long-press released without moving (open the action sheet). */
  onHold?: (index: number) => void;
  /** Clamp a target index (e.g. to keep dependency order); defaults to any index. */
  clamp?: (from: number, to: number) => number;
}

type G = {
  id: number; touch: boolean; index: number; el: HTMLElement; list: HTMLElement; x0: number; y0: number;
  state: "wait" | "lifted" | "drag"; timer?: number; tops: number[]; heights: number[]; to: number; want: number;
  scroller: HTMLElement | null; scroll0: number; y: number; raf?: number;
};

const scrollParent = (el: HTMLElement): HTMLElement | null => {
  for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n; }
  return null;
};

export function useDragReorder(opts: DragReorderOpts) {
  const optsRef = useRef(opts); optsRef.current = opts;
  const api = useRef<ReturnType<typeof makeDrag>>();
  if (!api.current) api.current = makeDrag(optsRef);
  useEffect(() => () => api.current!.cancel(), []);
  return api.current;
}

/** The gesture state machine; created once per hook so window listeners can be removed reliably. */
function makeDrag(optsRef: { current: DragReorderOpts }) {
  const g: { current: G | null } = { current: null };

  const items = (list: HTMLElement) => [...list.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute("data-reorder"));
  const reset = (s: G) => {
    for (const it of items(s.list)) { it.style.transform = ""; it.style.transition = ""; it.classList.remove("v2-drag-item", "v2-drag-lift"); }
    s.list.classList.remove("v2-dragging");
  };
  const end = (drop: boolean) => {
    const s = g.current; if (!s) return;
    g.current = null;
    window.clearTimeout(s.timer);
    if (s.raf) cancelAnimationFrame(s.raf);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("touchmove", blockTouch);
    reset(s);
    if (s.state === "wait") return;
    // A lift or drag must not also click the item (only the item: the action sheet may already be up).
    const swallow = (e: Event) => { if (e.target instanceof Node && s.el.contains(e.target)) { e.stopPropagation(); e.preventDefault(); } };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
    if (!drop) return;
    if (s.state === "lifted") optsRef.current.onHold?.(s.index);
    else if (s.to !== s.index || s.want !== s.index) optsRef.current.onMove(s.index, s.to, s.want);
  };
  const layout = (s: G) => {
    const dy = s.y - s.y0 + ((s.scroller?.scrollTop ?? 0) - s.scroll0);
    const mid = s.tops[s.index] + s.heights[s.index] / 2 + dy;
    let to = s.index;
    for (let i = 0; i < s.tops.length; i += 1) {
      const c = s.tops[i] + s.heights[i] / 2;
      if (i < s.index && mid < c) { to = i; break; }
      if (i > s.index && mid > c) to = i;
    }
    const clamp = optsRef.current.clamp;
    s.want = to;
    s.to = clamp ? clamp(s.index, to) : to;
    const gap = s.index + 1 < s.tops.length ? s.tops[s.index + 1] - s.tops[s.index] : s.heights[s.index];
    items(s.list).forEach((it, i) => {
      if (i === s.index) { it.style.transform = `translateY(${dy}px) scale(1.02)`; return; }
      const shift = s.to > s.index && i > s.index && i <= s.to ? -gap : s.to < s.index && i < s.index && i >= s.to ? gap : 0;
      it.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  };
  const autoscroll = () => {
    const s = g.current; if (!s || s.state !== "drag" || !s.scroller) return;
    const r = s.scroller.getBoundingClientRect();
    const v = s.y < r.top + EDGE ? -Math.ceil(((r.top + EDGE - s.y) / EDGE) * MAX_SCROLL) : s.y > r.bottom - EDGE ? Math.ceil(((s.y - (r.bottom - EDGE)) / EDGE) * MAX_SCROLL) : 0;
    if (v) { s.scroller.scrollTop += v; layout(s); }
    s.raf = requestAnimationFrame(autoscroll);
  };
  const begin = (s: G, state: "lifted" | "drag") => {
    const first = s.state === "wait";
    s.state = state;
    if (first) {
      const els = items(s.list);
      s.tops = els.map((e) => e.offsetTop); s.heights = els.map((e) => e.offsetHeight);
      s.scroll0 = s.scroller?.scrollTop ?? 0;
      els.forEach((e) => { if (e !== s.el) e.style.transition = "transform 160ms ease"; });
      s.el.classList.add("v2-drag-lift");
      haptic(12);
      if (s.touch) window.addEventListener("touchmove", blockTouch, { passive: false });
    }
    if (state === "drag") {
      s.el.classList.add("v2-drag-item"); s.list.classList.add("v2-dragging");
      try { s.el.setPointerCapture?.(s.id); } catch { /* the element may be gone */ }
      if (!s.raf) s.raf = requestAnimationFrame(autoscroll);
    }
  };
  function blockTouch(e: TouchEvent) { if (g.current && g.current.state !== "wait" && e.cancelable) e.preventDefault(); }
  function onMove(e: PointerEvent) {
    const s = g.current; if (!s || e.pointerId !== s.id) return;
    s.y = e.clientY;
    const d = Math.hypot(e.clientX - s.x0, e.clientY - s.y0);
    if (s.state === "wait") {
      if (s.touch) { if (d > LONG_PRESS_SLOP) end(false); return; }
      if (d < MOUSE_SLOP) return;
      begin(s, "drag");
    } else if (s.state === "lifted") {
      if (d < LONG_PRESS_SLOP) return;
      begin(s, "drag");
    }
    e.preventDefault();
    layout(s);
  }
  function onUp(e: PointerEvent) { if (g.current && e.pointerId === g.current.id) end(true); }
  function onCancel(e: PointerEvent) { if (g.current && e.pointerId === g.current.id) end(false); }

  /** Call from an item's (or its grip's) onPointerDown. `now`: a grip, so touch drags without the long-press. */
  const start = (e: React.PointerEvent, index: number, now = false) => {
    if (g.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-reorder]");
    const list = el?.parentElement;
    if (!el || !list) return;
    const s: G = { id: e.pointerId, touch: e.pointerType !== "mouse", index, el, list, x0: e.clientX, y0: e.clientY, y: e.clientY, state: "wait", tops: [], heights: [], to: index, want: index, scroller: scrollParent(list), scroll0: 0 };
    g.current = s;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    if (now) { e.preventDefault(); begin(s, s.touch ? "lifted" : "drag"); if (s.touch) begin(s, "drag"); }
    else if (s.touch) s.timer = window.setTimeout(() => { if (g.current === s && s.state === "wait") begin(s, "lifted"); }, LONG_PRESS_MS);
  };
  return { start, cancel: () => end(false), dragging: () => !!g.current && g.current.state !== "wait" };
}

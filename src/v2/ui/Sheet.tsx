import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Ic } from "./Icon";
import { DISMISS, useSnapDrag } from "./snapDrag";

/** V2-112: sheet snap points as fractions of the viewport height — peek, half, full (dismiss below peek). */
export const SHEET_SNAPS = [0.3, 0.55, 0.9];
const HANDLE = ".v2-grabber, .v2-sheet-head, .v2-cuelist-head, .v2-panel-head";
// Sliders/canvas keep their own gestures; a focused field keeps text selection. An unfocused field is just content (a tap still focuses it).
const NO_DRAG = "input[type=range], canvas, input:focus, textarea:focus, select:focus, [contenteditable]:focus";

/** True when some scroller between `el` and `root` is scrolled away from the top. */
function scrolledAbove(el: Element | null, root: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.scrollTop > 0) { const oy = getComputedStyle(n).overflowY; if (oy === "auto" || oy === "scroll") return true; }
    if (n === root) break;
  }
  return false;
}

/**
 * Mobile bottom sheet with Google Maps–style snapping: drag the grabber/header freely (1:1, rAF, no re-render),
 * release springs to peek / half / full, or closes below peek. Flicks move ≥ 1 snap. Dragging the content
 * expands the sheet first; at full it scrolls, and pulling down while scrolled to the top collapses the sheet.
 */
export function Sheet({ onClose, label, className = "", children, head = true, extra, snaps = SHEET_SNAPS, initial = 1, snapTo, dim = true }: {
  onClose: () => void; label: string; className?: string; children: ReactNode; head?: boolean; extra?: ReactNode;
  /** Snap heights as viewport fractions, ascending. */ snaps?: number[];
  /** Initial snap index. */ initial?: number;
  /** Request a snap (e.g. collapse to peek while an animation loops). */ snapTo?: number;
  /** False: no dimming and taps outside the sheet reach the app (the preview stays usable; close with ✓ or the grabber). */ dim?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cur = useRef(initial);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const suppressClick = useRef(false);
  const points = () => snaps.map((f) => Math.round(f * window.innerHeight));
  const drag = useSnapDrag({
    points,
    size: () => ref.current?.getBoundingClientRect().height ?? 0,
    apply: (px) => { const el = ref.current; if (el) el.style.height = `${px}px`; },
    onSettle: (i) => { if (i === DISMISS) closeRef.current(); else cur.current = i; },
    dismissible: true,
  });
  useLayoutEffect(() => { const el = ref.current; if (el) el.style.height = `${points()[initial] ?? points()[1]}px`; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (snapTo != null && snapTo !== cur.current) drag.animateTo(snapTo); }, [snapTo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fit = () => { const el = ref.current; if (el && !drag.dragging()) el.style.height = `${points()[cur.current]}px`; };
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Touch: decide on the first real move whether this is a sheet drag or a content scroll.
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let t: { id: number; x0: number; y0: number; target: Element; mode: "?" | "drag" | "native" } | null = null;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) { if (t?.mode === "drag") drag.end(); t = null; return; }
      const target = e.target as Element;
      if (target.closest(NO_DRAG) && !target.closest(".v2-grabber")) { t = null; return; }
      const p = e.touches[0];
      t = { id: p.identifier, x0: p.clientX, y0: p.clientY, target, mode: "?" };
    };
    const move = (e: TouchEvent) => {
      if (!t) return;
      const p = Array.from(e.touches).find((q) => q.identifier === t!.id); if (!p) return;
      if (t.mode === "?") {
        const dx = p.clientX - t.x0, dy = p.clientY - t.y0;
        if (Math.hypot(dx, dy) < 6) return;
        const onHandle = !!t.target.closest(HANDLE);
        const pts = points(), size = el.getBoundingClientRect().height;
        const vertical = Math.abs(dy) > Math.abs(dx);
        const grab = onHandle ? true
          : !vertical ? false
          : dy < 0 ? size < pts[pts.length - 1] - 2 // pull up: expand the sheet before scrolling content
          : !scrolledAbove(t.target, el); // pull down at the top of the content: collapse
        t.mode = grab ? "drag" : "native";
        if (grab) drag.begin(t.y0, e.timeStamp || performance.now());
      }
      if (t.mode === "drag") { if (e.cancelable) e.preventDefault(); drag.move(p.clientY, e.timeStamp || performance.now()); }
    };
    const end = (e: TouchEvent) => {
      if (!t) return;
      if (t.mode === "drag") { suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 350); drag.end(e.timeStamp || performance.now()); }
      t = null;
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => { el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move); el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mouse/pen: drag from the grabber or header (touch is handled above).
  const pd = useRef<{ id: number; y0: number; moved: boolean } | null>(null);
  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const target = e.target as Element;
    if (!target.closest(HANDLE) || (target.closest(NO_DRAG) && !target.closest(".v2-grabber"))) return;
    pd.current = { id: e.pointerId, y0: e.clientY, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = pd.current; if (!d || d.id !== e.pointerId) return;
    if (!d.moved) { if (Math.abs(e.clientY - d.y0) < 6) return; d.moved = true; try { ref.current?.setPointerCapture?.(e.pointerId); } catch { /* pointer gone */ } drag.begin(d.y0, e.timeStamp); }
    drag.move(e.clientY, e.timeStamp);
  };
  const up = (e: React.PointerEvent) => {
    const d = pd.current; pd.current = null; if (!d || !d.moved) return;
    suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0);
    drag.end(e.timeStamp);
  };
  return (
    <div className={`v2-sheet-backdrop ${dim ? "" : "is-clear"}`} onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div ref={ref} role="dialog" aria-label={label} className={`v2-sheet is-snap ${className}`}
        onClickCapture={(e) => { if (suppressClick.current) { e.stopPropagation(); e.preventDefault(); suppressClick.current = false; } }}
        onClick={(e) => e.stopPropagation()} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { if (pd.current?.moved) drag.end(); pd.current = null; }}>
        <button className="v2-grabber" aria-label={`Close ${label}`} title="Drag to resize · tap to close" onClick={onClose}><span /></button>
        {/* V2-111: CapCut-style header — title on the left, optional controls, ✓ Done at the top right (always reachable). */}
        {head && <div className="v2-sheet-head"><h3 className="v2-sheet-title">{label}</h3>{extra}<SheetDone onClick={onClose} /></div>}
        {children}
      </div>
    </div>
  );
}

/** The ✓ that closes a sheet; also used inside panels that draw their own header row. */
export function SheetDone({ onClick }: { onClick: () => void }) {
  return <button className="v2-icon v2-sheet-done" aria-label="Done" title="Done" onClick={onClick}><Ic g="✓" size={22} /><span className="v2-sr">Done</span></button>;
}

/** V2-112: mobile preview height snaps (dvh): compact timeline (big preview), default, expanded timeline. */
export const PREVIEW_SNAPS = [62, 45, 20];
export const PREVIEW_MIN = 20, PREVIEW_MAX = 62, PREVIEW_DEFAULT = 45;
const SPLIT_KEY = "v2.mobile.previewVh";
export function loadPreviewVh(): number {
  try { const v = Number(localStorage.getItem(SPLIT_KEY)); return PREVIEW_SNAPS.includes(v) ? v : PREVIEW_DEFAULT; } catch { return PREVIEW_DEFAULT; }
}
/** Timeline-panel sizes (px, ascending) for the preview snaps. */
const panelPoints = () => PREVIEW_SNAPS.map((vh) => Math.round(((100 - vh) / 100) * window.innerHeight));

/**
 * The grabber between preview and timeline: free 1:1 drag (preview height written straight to the DOM),
 * release springs to compact / default / expanded; flicks move ≥ 1 snap; tap toggles big preview ↔ default.
 * The last snap is remembered.
 */
export function PanelGrabber({ vh, onChange, target }: { vh: number; onChange: (vh: number) => void; target: () => HTMLElement | null }) {
  const pd = useRef<{ id: number; y0: number; moved: boolean } | null>(null);
  const drag = useSnapDrag({
    points: panelPoints,
    size: () => { const el = target(); return el ? window.innerHeight - el.getBoundingClientRect().height : 0; },
    apply: (px) => { const el = target(); if (el) el.style.height = `${window.innerHeight - px}px`; },
    onSettle: (i) => {
      const v = PREVIEW_SNAPS[Math.max(0, i)];
      const el = target(); if (el) el.style.height = `${v}dvh`;
      try { localStorage.setItem(SPLIT_KEY, String(v)); } catch { /* private mode */ }
      onChange(v);
    },
  });
  const idx = Math.max(0, PREVIEW_SNAPS.indexOf(vh));
  return (
    <div className="v2-panel-grabber" role="separator" aria-orientation="horizontal" aria-label="Resize timeline panel" aria-valuenow={Math.round(vh)} aria-valuemin={PREVIEW_MIN} aria-valuemax={PREVIEW_MAX} tabIndex={0}
      title="Drag to resize · tap to collapse/expand"
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") { e.preventDefault(); drag.animateTo(Math.min(PREVIEW_SNAPS.length - 1, idx + 1)); }
        if (e.key === "ArrowDown") { e.preventDefault(); drag.animateTo(Math.max(0, idx - 1)); }
      }}
      onPointerDown={(e) => { if (e.button !== 0) return; pd.current = { id: e.pointerId, y0: e.clientY, moved: false }; try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* pointer gone */ } }}
      onPointerMove={(e) => {
        const d = pd.current; if (!d || d.id !== e.pointerId) return;
        if (!d.moved) { if (Math.abs(e.clientY - d.y0) < 5) return; d.moved = true; drag.begin(d.y0, e.timeStamp); }
        drag.move(e.clientY, e.timeStamp);
      }}
      onPointerUp={(e) => { const d = pd.current; pd.current = null; if (!d) return; if (d.moved) drag.end(e.timeStamp); else drag.animateTo(vh >= PREVIEW_MAX - 1 ? 1 : 0); }}
      onPointerCancel={() => { if (pd.current?.moved) drag.end(); pd.current = null; }}>
      <span />
    </div>
  );
}

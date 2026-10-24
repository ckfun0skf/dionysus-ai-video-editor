import { useRef, useState, type ReactNode } from "react";
import { Ic } from "./Icon";

/** Close when dragged down past 35% of the sheet (or 120px), or flicked down faster than 0.6 px/ms. */
export function shouldDismiss(dy: number, height: number, velocity: number): boolean {
  return dy > Math.min(120, height * 0.35) || (dy > 24 && velocity > 0.6);
}

/**
 * Mobile bottom sheet: slides up, drag the grabber (or the sheet while scrolled to the top) down to
 * dismiss, tap the backdrop or press Escape to close. Motion is disabled under prefers-reduced-motion (CSS).
 */
export function Sheet({ onClose, label, className = "", children, head = true, extra }: { onClose: () => void; label: string; className?: string; children: ReactNode; head?: boolean; extra?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number; t0: number; id: number }>();
  const [dy, setDy] = useState(0);
  const down = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || (el.scrollTop > 0 && !(e.target as HTMLElement).closest(".v2-grabber"))) return;
    if ((e.target as HTMLElement).closest("input, textarea, select, button, a, [contenteditable]") ) return;
    drag.current = { y0: e.clientY, t0: e.timeStamp, id: e.pointerId };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const v = Math.max(0, e.clientY - d.y0);
    if (v > 6) ref.current?.setPointerCapture?.(e.pointerId);
    setDy(v);
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = undefined;
    if (!d) return;
    const v = Math.max(0, e.clientY - d.y0);
    const ms = Math.max(1, e.timeStamp - d.t0);
    if (shouldDismiss(v, ref.current?.offsetHeight ?? 400, v / ms)) onClose();
    setDy(0);
  };
  return (
    <div className="v2-sheet-backdrop" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div ref={ref} role="dialog" aria-label={label} className={`v2-sheet ${dy ? "is-dragging" : ""} ${className}`} style={dy ? { transform: `translateY(${dy}px)` } : undefined}
        onClick={(e) => e.stopPropagation()} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = undefined; setDy(0); }}>
        <button className="v2-grabber" aria-label={`Close ${label}`} title="Drag down or tap to close" onClick={onClose}><span /></button>
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

/** Mobile preview height (dvh) from a drag on the panel grabber; clamped so both panes stay usable. */
export const PREVIEW_MIN = 28, PREVIEW_MAX = 72, PREVIEW_DEFAULT = 45;
export function previewHeightAfterDrag(startVh: number, dyPx: number, viewportPx: number): number {
  return Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, startVh + (dyPx / Math.max(1, viewportPx)) * 100));
}

/** Drag down to shrink the timeline/controls panel (grow the preview), up to grow it; tap toggles. */
export function PanelGrabber({ vh, onChange }: { vh: number; onChange: (vh: number) => void }) {
  const drag = useRef<{ y0: number; vh0: number; moved: boolean }>();
  return (
    <div className="v2-panel-grabber" role="separator" aria-orientation="horizontal" aria-label="Resize timeline panel" aria-valuenow={Math.round(vh)} aria-valuemin={PREVIEW_MIN} aria-valuemax={PREVIEW_MAX} tabIndex={0}
      title="Drag to resize · tap to collapse/expand"
      onKeyDown={(e) => { if (e.key === "ArrowDown") onChange(previewHeightAfterDrag(vh, 40, window.innerHeight)); if (e.key === "ArrowUp") onChange(previewHeightAfterDrag(vh, -40, window.innerHeight)); }}
      onPointerDown={(e) => { drag.current = { y0: e.clientY, vh0: vh, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; if (Math.abs(e.clientY - d.y0) > 4) d.moved = true; if (d.moved) onChange(previewHeightAfterDrag(d.vh0, e.clientY - d.y0, window.innerHeight)); }}
      onPointerUp={() => { const d = drag.current; drag.current = undefined; if (d && !d.moved) onChange(vh >= PREVIEW_MAX - 1 ? PREVIEW_DEFAULT : PREVIEW_MAX); }}
      onPointerCancel={() => { drag.current = undefined; }}>
      <span />
    </div>
  );
}

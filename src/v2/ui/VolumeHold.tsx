/**
 * P11-VOLUME: the phone toolbar volume control. A tap or a normal horizontal drag works like the plain slider;
 * press and hold (350 ms) then slide up / down to set the volume with a big vertical meter that shows the value.
 * P13: the control is `touch-action: pan-x`, so a horizontal swipe that starts on it still scrolls the toolbar (and
 * cancels a pending hold); the browser never takes vertical moves, and only after the hold does a vertical slide set
 * the volume (a non-passive touchmove preventDefault then blocks any scroll and the pointer is captured, so the finger
 * can leave the control). The whole hold is one undo step (onBegin / onEnd).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const HOLD_MS = 350;
/** Pixels of vertical travel for the full 0..max range. */
export const HOLD_TRAVEL_PX = 200;

export function VolumeHold({ value, max = 1, step = 0.05, onChange, onBegin, onEnd, icon }: {
  value: number; max?: number; step?: number; onChange: (v: number) => void; onBegin?: () => void; onEnd?: () => void; icon?: React.ReactNode;
}) {
  const [holding, setHolding] = useState<null | { x: number; bottom: number }>(null);
  const ref = useRef<HTMLLabelElement>(null);
  const st = useRef<{ t?: ReturnType<typeof setTimeout>; x0: number; y0: number; v0: number; id: number; on: boolean; moved: boolean }>({ x0: 0, y0: 0, v0: 0, id: -1, on: false, moved: false });
  const snap = (v: number) => Math.min(max, Math.max(0, Math.round(v / step) * step));
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const block = (e: TouchEvent) => { if (st.current.on) e.preventDefault(); };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);
  const end = () => {
    clearTimeout(st.current.t);
    if (st.current.on) { st.current.on = false; setHolding(null); onEnd?.(); }
  };
  useEffect(() => () => clearTimeout(st.current.t), []);
  const down = (e: React.PointerEvent<HTMLLabelElement>) => {
    if (e.button > 0) return;
    const target = e.currentTarget, id = e.pointerId;
    st.current = { ...st.current, x0: e.clientX, y0: e.clientY, v0: value, id, moved: false };
    st.current.t = setTimeout(() => {
      if (st.current.moved) return;
      st.current.on = true;
      const r = target.getBoundingClientRect();
      setHolding({ x: r.left + r.width / 2, bottom: (window.innerHeight || 0) - r.top + 10 }); onBegin?.();
      try { target.setPointerCapture(id); } catch { /* pointer already gone */ }
    }, HOLD_MS);
  };
  const move = (e: React.PointerEvent) => {
    const s = st.current;
    if (!s.on) { if (Math.abs(e.clientY - s.y0) > 8 || Math.abs(e.clientX - s.x0) > 8) { s.moved = true; clearTimeout(s.t); } return; }
    e.preventDefault();
    const v = snap(s.v0 + ((s.y0 - e.clientY) / HOLD_TRAVEL_PX) * max);
    if (v !== value) onChange(v);
  };
  const pct = Math.round((value / max) * 100);
  return (
    <label ref={ref} className={`v2-tool v2-volume ${holding ? "is-holding" : ""}`} title="Volume: tap or drag; press and hold, then slide up or down"
      onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={(e) => { if (e.target === e.currentTarget) end(); }}>
      <b aria-hidden>{icon}</b>
      <input type="range" min={0} max={max} step={step} value={value} aria-label="Volume" aria-valuetext={`${pct}%`}
        onPointerDown={() => onBegin?.()} onPointerUp={() => { if (!st.current.on) onEnd?.(); }} onBlur={() => { if (!st.current.on) onEnd?.(); }}
        onChange={(e) => { if (!st.current.on) onChange(Number(e.target.value)); }} />
      {holding && createPortal(
        <div className="v2-vol-pop" role="status" aria-live="polite" data-testid="volume-meter" style={{ left: holding.x, bottom: holding.bottom }}>
          <strong className="v2-vol-num">{pct}%</strong>
          <div className="v2-vol-meter" aria-hidden><div className="v2-vol-fill" style={{ height: `${pct}%` }} /></div>
        </div>, document.body,
      )}
    </label>
  );
}

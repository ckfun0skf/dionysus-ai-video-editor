/**
 * P11-SLIDER: the one inspector slider: [−] slider [+] plus a numeric field.
 * - The numeric field is step-aware and clamped, shows the unit, commits on Enter or blur (Esc reverts) and opens
 *   the decimal keypad on phones (inputmode="decimal"; "," is read as ".").
 * - − / + step once on tap; held down they repeat (after 400 ms, every 70 ms). One hold, one drag, or one typed
 *   value is one undo step (onBegin / onEnd wrap it).
 * - Every target is at least 44 px tall (v2.css .v2-sf).
 * `scale` maps the stored value to the shown one (e.g. 0..1 shown as 0..100 %).
 */
import { useEffect, useRef, useState } from "react";

export interface SliderFieldProps {
  label: React.ReactNode;
  /** Accessible name of the slider (the field is "<aria> value", the buttons "Decrease/Increase <aria>"). */
  aria?: string;
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
  onBegin?: () => void; onEnd?: () => void;
  unit?: string; scale?: number; disabled?: boolean; title?: string; className?: string;
  /** Shown value text for the slider (aria-valuetext). */
  valueText?: string;
  /** Extra controls after the field (e.g. a keyframe button). */
  extra?: React.ReactNode;
}

const decimalsOf = (step: number) => { const s = String(step); const i = s.indexOf("."); return i < 0 ? (/e-(\d+)/.exec(s) ? Number(/e-(\d+)/.exec(s)![1]) : 0) : s.length - i - 1; };
export function snapToStep(v: number, min: number, max: number, step: number): number {
  const c = Math.min(max, Math.max(min, v));
  if (!(step > 0)) return c;
  const n = Math.round((c - min) / step) * step + min;
  const r = Number(n.toFixed(Math.min(10, decimalsOf(step) + 2)));
  return Math.min(max, Math.max(min, r));
}
/** Parse a typed number ("1,5" ok); NaN when it isn't one. */
export const parseNum = (s: string) => { const t = s.trim().replace(",", "."); return t === "" || t === "-" ? NaN : Number(t); };

export function SliderField({ label, aria, value, min, max, step, onChange, onBegin, onEnd, unit, scale = 1, disabled, title, className, valueText, extra }: SliderFieldProps) {
  const name = aria ?? (typeof label === "string" ? label : "Value");
  const dStep = step * scale, dec = Math.min(4, decimalsOf(Number(dStep.toPrecision(6))));
  const shown = (v: number) => (v * scale).toFixed(dec);
  const [text, setText] = useState(shown(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(shown(value)); }); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useRef(value); live.current = value;
  const set = (v: number) => { const n = snapToStep(v, min, max, step); if (n !== live.current) { live.current = n; onChange(n); } };
  const commit = () => {
    setEditing(false);
    const n = parseNum(text);
    if (!Number.isFinite(n)) { setText(shown(value)); return; }
    onBegin?.(); set(n / scale); onEnd?.();
    setText(shown(snapToStep(n / scale, min, max, step)));
  };

  // Hold-to-repeat on − / +.
  const timer = useRef<{ t?: ReturnType<typeof setTimeout>; i?: ReturnType<typeof setInterval> }>({});
  const held = useRef(false);
  const stop = () => { clearTimeout(timer.current.t); clearInterval(timer.current.i); timer.current = {}; if (held.current) { held.current = false; onEnd?.(); } };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  const press = (dir: 1 | -1) => (e: React.PointerEvent) => {
    if (disabled || e.button > 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    held.current = true; onBegin?.();
    set(live.current + dir * step);
    timer.current.t = setTimeout(() => { timer.current.i = setInterval(() => set(live.current + dir * step), 70); }, 400);
  };
  // Keyboard (Enter / Space) clicks have detail 0; pointer taps are handled on pointerdown.
  const key = (dir: 1 | -1) => (e: React.MouseEvent) => { if (e.detail === 0 && !disabled) { onBegin?.(); set(live.current + dir * step); onEnd?.(); } };
  const btn = (dir: 1 | -1) => (
    <button type="button" className="v2-sf-btn" aria-label={`${dir < 0 ? "Decrease" : "Increase"} ${name}`} disabled={disabled || (dir < 0 ? value <= min : value >= max)}
      onPointerDown={press(dir)} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onClick={key(dir)} onContextMenu={(e) => e.preventDefault()}>{dir < 0 ? "−" : "+"}</button>
  );
  return (
    <div className={`v2-sf ${className ?? ""}`} title={title} data-testid="slider-field">
      <span className="v2-sf-label">{label}</span>
      <div className="v2-sf-row">
        {btn(-1)}
        <input type="range" className="v2-sf-range" min={min} max={max} step={step} value={value} aria-label={name} disabled={disabled} aria-valuetext={valueText}
          onPointerDown={onBegin} onPointerUp={onEnd} onBlur={onEnd} onChange={(e) => set(Number(e.target.value))} />
        {btn(1)}
        <span className="v2-sf-num">
          <input type="text" inputMode="decimal" enterKeyHint="done" aria-label={`${name} value`} value={text} disabled={disabled} autoComplete="off" spellCheck={false}
            onFocus={(e) => { setEditing(true); e.currentTarget.select(); }} onChange={(e) => setText(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.currentTarget as HTMLInputElement).blur(); } else if (e.key === "Escape") { e.stopPropagation(); setEditing(false); setText(shown(value)); } }} />
          {unit && <span className="v2-sf-unit" aria-hidden>{unit}</span>}
        </span>
        {extra}
      </div>
    </div>
  );
}

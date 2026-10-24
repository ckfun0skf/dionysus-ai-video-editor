/**
 * V2-106: panel splitter. Drag (pointer capture), arrow keys (8px, Shift 32px), double-click resets.
 * `dir` = which way the panel grows: "right" (left panel), "left" (right panel), "up" (timeline).
 */
export function Splitter({ label, value, dir, onChange, onCommit, onReset, min, max }: {
  label: string; value: number; dir: "right" | "left" | "up"; min: number; max: number;
  onChange: (v: number) => void; onCommit?: () => void; onReset?: () => void;
}) {
  const vertical = dir !== "up";
  const sign = dir === "left" || dir === "up" ? -1 : 1;
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget, start = vertical ? e.clientX : e.clientY, v0 = value;
    el.setPointerCapture?.(e.pointerId);
    el.classList.add("is-dragging");
    document.body.classList.add(vertical ? "v2-resizing-x" : "v2-resizing-y");
    const move = (ev: PointerEvent) => onChange(v0 + sign * ((vertical ? ev.clientX : ev.clientY) - start));
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      el.classList.remove("is-dragging"); document.body.classList.remove("v2-resizing-x", "v2-resizing-y");
      onCommit?.();
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8;
    const grow = vertical ? (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) * sign : (e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0);
    if (grow) { e.preventDefault(); e.stopPropagation(); onChange(value + grow * step); onCommit?.(); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); onChange(e.key === "Home" ? min : max); onCommit?.(); }
  };
  return (
    <div className={`v2-splitter ${vertical ? "is-v" : "is-h"}`} role="separator" tabIndex={0} aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"} aria-valuenow={Math.round(value)} aria-valuemin={min} aria-valuemax={max}
      title={`${label}: drag to resize · double-click to reset`} onPointerDown={down} onKeyDown={key} onDoubleClick={() => { onReset?.(); onCommit?.(); }}>
      <span className="v2-splitter-grip" aria-hidden />
    </div>
  );
}

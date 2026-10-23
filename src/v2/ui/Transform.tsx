import { useRef, type PointerEvent as RPE } from "react";
import { cmd, type Engine } from "../engine";
import { transformOf, type Placement } from "../domain";
import type { Placed } from "../render";

type Patch = Parameters<typeof cmd.setTransform>[1];

/** Slider inspector for a visual clip's transform. Each drag is one undo step. */
export function TransformInspector({ engine, placement }: { engine: Engine; placement: Placement }) {
  const t = transformOf(placement);
  const set = (patch: Patch) => engine.dispatch(cmd.setTransform(placement.id, patch));
  const row = (label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, patch: (v: number) => Patch) => (
    <label className="v2-insp-row" key={label}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()}
        onChange={(e) => set(patch(Number(e.target.value)))} />
      <output>{fmt(value)}</output>
    </label>
  );
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <section className="v2-inspector" aria-label="Transform">
      <div className="v2-panel-head"><strong>Transform</strong>
        <button className="v2-btn" title="Reset position, scale, rotation, opacity and crop" disabled={!placement.transform} onClick={() => set(null)}>Reset</button>
      </div>
      {row("Position X", t.x, -1, 1, 0.005, pct, (x) => ({ x }))}
      {row("Position Y", t.y, -1, 1, 0.005, pct, (y) => ({ y }))}
      {row("Scale", t.scale, 0.05, 4, 0.01, pct, (scale) => ({ scale }))}
      {row("Rotation", t.rotation, -180, 180, 1, (v) => `${Math.round(v)}°`, (rotation) => ({ rotation }))}
      {row("Opacity", t.opacity, 0, 1, 0.01, pct, (opacity) => ({ opacity }))}
      {row("Crop left", t.crop.l, 0, 0.9, 0.005, pct, (l) => ({ crop: { l } }))}
      {row("Crop right", t.crop.r, 0, 0.9, 0.005, pct, (r) => ({ crop: { r } }))}
      {row("Crop top", t.crop.t, 0, 0.9, 0.005, pct, (v) => ({ crop: { t: v } }))}
      {row("Crop bottom", t.crop.b, 0, 0.9, 0.005, pct, (b) => ({ crop: { b } }))}
    </section>
  );
}

/**
 * On-canvas handles over the selected clip: drag the box to move, a corner to scale, the top knob to rotate.
 * `box` is in canvas pixels; `canvas` gives the CSS scale. One gesture = one undo step.
 */
export function TransformHandles({ engine, placement, box, canvas }: { engine: Engine; placement: Placement; box: Placed; canvas: HTMLCanvasElement }) {
  const drag = useRef<{ mode: "move" | "scale" | "rotate"; x0: number; y0: number; t0: ReturnType<typeof transformOf>; cx: number; cy: number }>();
  const rect = canvas.getBoundingClientRect();
  const parent = canvas.parentElement!.getBoundingClientRect();
  const k = rect.width / canvas.width || 1;
  const style = {
    left: rect.left - parent.left + (box.cx - box.w / 2) * k, top: rect.top - parent.top + (box.cy - box.h / 2) * k,
    width: box.w * k, height: box.h * k, transform: `rotate(${box.rot}rad)`,
  };
  const start = (mode: "move" | "scale" | "rotate") => (e: RPE) => {
    e.stopPropagation(); e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    engine.beginGesture();
    drag.current = { mode, x0: e.clientX, y0: e.clientY, t0: transformOf(placement), cx: rect.left + box.cx * k, cy: rect.top + box.cy * k };
  };
  const move = (e: RPE) => {
    const d = drag.current;
    if (!d) return;
    let patch: Patch;
    if (d.mode === "move") patch = { x: d.t0.x + (e.clientX - d.x0) / k / canvas.width, y: d.t0.y + (e.clientY - d.y0) / k / canvas.height };
    else if (d.mode === "scale") {
      const r0 = Math.hypot(d.x0 - d.cx, d.y0 - d.cy) || 1;
      patch = { scale: d.t0.scale * (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) / r0) };
    } else {
      let deg = (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI + 90;
      if (deg > 180) deg -= 360;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      patch = { rotation: deg };
    }
    engine.dispatch(cmd.setTransform(placement.id, patch));
  };
  const end = () => { if (drag.current) { drag.current = undefined; engine.endGesture(); } };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  return (
    <div className="v2-xform" style={style} {...handlers} onPointerDown={start("move")} title="Drag to move · corners scale · top knob rotates (Shift snaps 15°)" data-testid="transform-box" onClick={(e) => e.stopPropagation()}>
      {(["nw", "ne", "sw", "se"] as const).map((c) => <span key={c} className={`v2-xform-h ${c}`} onPointerDown={start("scale")} {...handlers} aria-label="Scale" />)}
      <span className="v2-xform-rot" onPointerDown={start("rotate")} {...handlers} aria-label="Rotate" />
    </div>
  );
}

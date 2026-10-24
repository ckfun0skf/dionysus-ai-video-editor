import { useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { cmd, type Engine } from "../engine";
import { evalKeys, transformOf, ticksToSeconds, secondsToTicks, type KeyframeProp, type Placement } from "../domain";
import type { Placed } from "../render";
import { listPresets } from "../registry";
import { Ic } from "./Icon";
import { classifyPreview, pinchPatch, TAP_SLOP } from "./gestures";
import { SNAP_PX, snapMove, snapRotation, snapScale, snapTargets, type Guides, type SnapBox } from "./snap";

type Patch = Parameters<typeof cmd.setTransform>[1];
const KEYED: KeyframeProp[] = ["x", "y", "scale", "rotation", "opacity"];

/** Transform value at absolute time (keyframes applied, fades not). */
export function valuesAt(p: Placement, time: number) {
  const t = transformOf(p);
  for (const k of KEYED) { const v = evalKeys(p.keyframes?.[k], time - p.startTicks); if (v !== undefined) t[k] = v; }
  return t;
}

/** Route a patch: keyframed props get a key at the playhead, the rest go to the static transform. */
export function applyPatch(engine: Engine, p: Placement, time: number, patch: Patch) {
  if (patch === null) { engine.dispatch(cmd.setTransform(p.id, null)); return; }
  const rest: Exclude<Patch, null> = { ...patch };
  for (const k of KEYED) {
    if (patch[k] !== undefined && p.keyframes?.[k]?.length) { engine.dispatch(cmd.setKeyframe(p.id, k, time - p.startTicks, patch[k]!)); delete rest[k]; }
  }
  if (Object.keys(rest).length) engine.dispatch(cmd.setTransform(p.id, rest));
}

/** Slider inspector for a visual clip's transform. Each drag is one undo step. */
export function TransformInspector({ engine, placement, time }: { engine: Engine; placement: Placement; time: number }) {
  const t = valuesAt(placement, time);
  const offset = time - placement.startTicks;
  const inside = offset >= 0 && offset <= placement.durationTicks;
  const set = (patch: Patch) => applyPatch(engine, placement, time, patch);
  const row = (label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, patch: (v: number) => Patch, prop?: KeyframeProp) => {
    const keys = prop ? placement.keyframes?.[prop] : undefined;
    const onKey = !!keys?.some((k) => Math.abs(k.t - offset) <= 600);
    return (
    <label className="v2-insp-row" key={label}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()}
        onChange={(e) => set(patch(Number(e.target.value)))} />
      <output>{fmt(value)}</output>
      {prop ? <button type="button" className={`v2-kf ${onKey ? "is-on" : keys?.length ? "is-keyed" : ""}`} disabled={!inside} aria-pressed={onKey}
        title={onKey ? `Remove ${label} keyframe at playhead` : `Add ${label} keyframe at playhead`} aria-label={`${label} keyframe`}
        onClick={(e) => { e.preventDefault(); engine.dispatch(cmd.setKeyframe(placement.id, prop, offset, onKey ? null : value)); }}><Ic g="◆" /></button> : <span />}
    </label>
    );
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const maxFade = Math.min(10, ticksToSeconds(placement.durationTicks));
  const fade = (label: string, ticks: number | undefined, key: "in" | "out") => row(label, ticksToSeconds(ticks ?? 0), 0, maxFade, 0.05, (v) => `${v.toFixed(1)}s`, (v) => { engine.dispatch(cmd.setFades(placement.id, { [key]: secondsToTicks(v) })); return {}; });
  const fades = <>{fade("Fade in", placement.fadeInTicks, "in")}{fade("Fade out", placement.fadeOutTicks, "out")}</>;
  if (placement.clipType === "audio") return <section className="v2-inspector" aria-label="Fades"><div className="v2-panel-head"><strong>Fades</strong></div>{fades}</section>;
  return (
    <section className="v2-inspector" aria-label="Transform">
      <div className="v2-panel-head"><strong>Transform</strong>
        <button className="v2-btn" title="Reset position, scale, rotation, opacity and crop" disabled={!placement.transform} onClick={() => set(null)}>Reset</button>
      </div>
      {row("Position X", t.x, -1, 1, 0.005, pct, (x) => ({ x }), "x")}
      {row("Position Y", t.y, -1, 1, 0.005, pct, (y) => ({ y }), "y")}
      {row("Scale", t.scale, 0.05, 4, 0.01, pct, (scale) => ({ scale }), "scale")}
      {row("Rotation", t.rotation, -180, 180, 1, (v) => `${Math.round(v)}°`, (rotation) => ({ rotation }), "rotation")}
      {row("Opacity", t.opacity, 0, 1, 0.01, pct, (opacity) => ({ opacity }), "opacity")}
      <label className="v2-insp-row v2-insp-blend" key="blend" title="How this clip mixes with the layers under it">
        <span>Blend</span>
        <select aria-label="Blend mode" value={placement.blend ?? "normal"} onChange={(e) => engine.dispatch(cmd.setBlend(placement.id, e.target.value))}>
          {listPresets("blend").map((d) => <option key={d.id} value={d.id} title={d.description}>{d.name}</option>)}
          {placement.blend && !listPresets("blend").some((d) => d.id === placement.blend) && <option value={placement.blend}>{placement.blend} (unknown)</option>}
        </select>
      </label>
      {row("Crop left", t.crop.l, 0, 0.9, 0.005, pct, (l) => ({ crop: { l } }))}
      {row("Crop right", t.crop.r, 0, 0.9, 0.005, pct, (r) => ({ crop: { r } }))}
      {row("Crop top", t.crop.t, 0, 0.9, 0.005, pct, (v) => ({ crop: { t: v } }))}
      {row("Crop bottom", t.crop.b, 0, 0.9, 0.005, pct, (b) => ({ crop: { b } }))}
      {fades}
    </section>
  );
}

/**
 * On-canvas handles over the selected clip: drag the box to move, a corner to scale, the top knob to rotate.
 * `box` is in canvas pixels; `canvas` gives the CSS scale. One gesture = one undo step.
 */
/** Gap kept between the gizmo frame and the preview edge so the 26px corner buttons (offset 13px) stay tappable. */
export const GIZMO_INSET = 16;
export interface GizmoActions {
  onDelete: () => void; onEdit: () => void; onDuplicate: () => void; onDoubleTap?: () => void;
  /** V2-113: a tap (no drag) at client point; `onGizmo` when it landed on the selected element's frame. */
  onTap?: (clientX: number, clientY: number, onGizmo: boolean) => void;
  /** V2-113: another (non-background) element under this client point, if any. */
  otherAt?: (clientX: number, clientY: number) => string | undefined;
}

/**
 * CapCut-style gizmo: drag body to move; corner buttons delete (top-left), edit (top-right),
 * duplicate (bottom-left), and one-finger rotate+scale (bottom-right). Two fingers anywhere on
 * the box pinch to scale and twist to rotate. Each gesture is one undo step.
 */
export function TransformHandles({ engine, placement, box, canvas, time, actions, others = [], snapping = true, route }: { engine: Engine; placement: Placement; box: Placed; canvas: HTMLCanvasElement; time: number; actions?: GizmoActions; others?: SnapBox[]; snapping?: boolean; /** V2-103: send gesture patches elsewhere (Whole layer). */ route?: (patch: Patch) => void }) {
  const drag = useRef<{ mode: "move" | "spin"; x0: number; y0: number; t0: ReturnType<typeof valuesAt>; cx: number; cy: number; b0: Placed }>();
  const [guides, setGuides] = useState<Guides>({});
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ a0: { x: number; y: number }; b0: { x: number; y: number }; t0: ReturnType<typeof valuesAt>; box: Placed }>();
  const rect = canvas.getBoundingClientRect();
  const parent = canvas.parentElement!.getBoundingClientRect();
  const k = rect.width / canvas.width || 1;
  // Keep the gizmo at least 64px so its corner buttons never overlap on small elements.
  const bw = Math.max(64, box.w * k), bh = Math.max(64, box.h * k);
  let left = rect.left - parent.left + box.cx * k - bw / 2, top = rect.top - parent.top + box.cy * k - bh / 2, width = bw, height = bh;
  // V2-109: a clip filling the preview would push its corner buttons outside (clipped, untappable):
  // inset the unrotated gizmo frame so every handle stays inside the preview, as CapCut does.
  if (Math.abs(Math.sin(box.rot)) < 0.02 && parent.width > 0) {
    const r = Math.min(left + width, parent.width - GIZMO_INSET), b = Math.min(top + height, parent.height - GIZMO_INSET);
    left = Math.max(left, GIZMO_INSET); top = Math.max(top, GIZMO_INSET);
    width = Math.max(48, r - left); height = Math.max(48, b - top);
  }
  const style = { left, top, width, height, transform: `rotate(${box.rot}rad)` };
  const lastTap = useRef(0);
  const began = useRef(false);
  /** V2-113: one-finger press in the preview outside the frame (or a tap candidate on the frame). */
  const press = useRef<{ id: number; x0: number; y0: number; onOther: boolean; state: "pending" | "move" | "ignore"; gizmo: boolean }>();
  const tapTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(tapTimer.current), []);
  const startGesture = () => { if (!began.current) { began.current = true; engine.beginGesture(); } };
  const capture = (e: RPE) => { try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* synthetic or lost pointer */ } };
  const enterPinch = () => {
    const [a0, b0] = [...pts.current.values()];
    startGesture();
    drag.current = undefined;
    if (press.current) press.current.state = "ignore";
    pinch.current = { a0, b0, t0: valuesAt(placement, time), box };
  };
  const start = (mode: "move" | "spin") => (e: RPE) => {
    e.stopPropagation(); e.preventDefault();
    capture(e);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) { enterPinch(); return; }
    if (mode === "move" && pts.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 320) { lastTap.current = 0; clearTimeout(tapTimer.current); pts.current.clear(); actions?.onDoubleTap?.(); return; }
      lastTap.current = now;
      press.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, onOther: false, state: "move", gizmo: true };
    }
    startGesture();
    drag.current = { mode, x0: e.clientX, y0: e.clientY, t0: valuesAt(placement, time), cx: rect.left + box.cx * k, cy: rect.top + box.cy * k, b0: box };
  };
  /** V2-113: press anywhere else on the preview — tap selects/deselects, drag moves the selection, two fingers pinch it. */
  const startOutside = (e: RPE) => {
    if (e.button > 0) return;
    e.preventDefault();
    capture(e);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) { enterPinch(); return; }
    if (pts.current.size > 2) return;
    press.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, onOther: !!actions?.otherAt?.(e.clientX, e.clientY), state: "pending", gizmo: false };
  };
  /**
   * Resolve one gesture frame: move by (dx, dy) screen px, scale by `ratio`, rotate to `rot`.
   * Smart snapping (canvas centre/edges, other elements, right angles) unless disabled (toggle or Alt).
   */
  const solve = (t0: ReturnType<typeof valuesAt>, b0: Placed, dx: number, dy: number, ratio: number, rot: number, off: boolean, mode: "move" | "scale") => {
    const W = canvas.width, H = canvas.height, thr = SNAP_PX / k;
    let cdx = dx / k, cdy = dy / k, r = ratio, deg = rot;
    const g: Guides = {};
    let snapped = false;
    if (snapping && !off) {
      const sr = snapRotation(deg);
      if (sr.snapped && deg !== t0.rotation) { deg = sr.deg; snapped = true; }
      const b: SnapBox = { cx: b0.cx + cdx, cy: b0.cy + cdy, w: b0.w * r, h: b0.h * r, rot: (deg * Math.PI) / 180 };
      const tg = snapTargets(W, H, others);
      if (mode === "move") { const m = snapMove(b, tg, thr); cdx += m.dx; cdy += m.dy; Object.assign(g, m.guides); snapped ||= m.guides.x !== undefined || m.guides.y !== undefined; }
      else { const m = snapScale(b, tg, thr); r *= m.k; Object.assign(g, m.guides); snapped ||= m.k !== 1; }
    }
    const was = guides.x !== undefined || guides.y !== undefined;
    const now = g.x !== undefined || g.y !== undefined;
    if (now && (!was || g.x !== guides.x || g.y !== guides.y)) navigator.vibrate?.(8); // light haptic tick on snap
    void snapped;
    setGuides(g);
    (route ?? ((pt: Patch) => applyPatch(engine, placement, time, pt)))({ x: t0.x + cdx / W, y: t0.y + cdy / H, scale: t0.scale * r, rotation: deg });
  };
  const move = (e: RPE) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pr = press.current;
    if (pr && pr.id === e.pointerId && !pinch.current) {
      const moved = Math.hypot(e.clientX - pr.x0, e.clientY - pr.y0);
      if (pr.gizmo) { if (moved > TAP_SLOP) pr.gizmo = false; }
      else if (pr.state === "pending") {
        const g = classifyPreview({ fingers: pts.current.size, moved, released: false, onOther: pr.onOther, hasSelection: true });
        if (g === "move") {
          pr.state = "move";
          startGesture();
          drag.current = { mode: "move", x0: pr.x0, y0: pr.y0, t0: valuesAt(placement, time), cx: rect.left + box.cx * k, cy: rect.top + box.cy * k, b0: box };
        } else if (g === "ignore") pr.state = "ignore";
      }
    }
    const pc = pinch.current;
    if (pc && pts.current.size >= 2) {
      const [a1, b1] = [...pts.current.values()];
      // Pinch + twist + pan in one gesture: the touch midpoint drives translation.
      const pp = pinchPatch(pc.t0, pc.a0, pc.b0, a1, b1);
      const mdx = (a1.x + b1.x - pc.a0.x - pc.b0.x) / 2, mdy = (a1.y + b1.y - pc.a0.y - pc.b0.y) / 2;
      solve(pc.t0, pc.box, mdx, mdy, pp.scale / (pc.t0.scale || 1), pp.rotation, e.altKey, "move");
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.mode === "move") { solve(d.t0, d.b0, e.clientX - d.x0, e.clientY - d.y0, 1, d.t0.rotation, e.altKey, "move"); return; }
    // One-finger rotate+scale around the centre (bottom-right knob).
    const p0 = { x: d.cx, y: d.cy };
    const pp = pinchPatch(d.t0, p0, { x: d.x0, y: d.y0 }, p0, { x: e.clientX, y: e.clientY });
    const rot = e.shiftKey ? Math.round(pp.rotation / 15) * 15 : pp.rotation;
    solve(d.t0, d.b0, 0, 0, pp.scale / (d.t0.scale || 1), rot, e.altKey, "scale");
  };
  const end = (e: RPE) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.delete(e.pointerId);
    const pr = press.current;
    if (pr?.id === e.pointerId && !pinch.current && e.type === "pointerup") {
      const { clientX: x, clientY: y } = e;
      // A tap outside the frame selects / deselects now; a tap on the frame waits out the double-tap window.
      if (!pr.gizmo && pr.state === "pending") actions?.onTap?.(x, y, false);
      else if (pr.gizmo && Date.now() - lastTap.current < 600) {
        clearTimeout(tapTimer.current);
        tapTimer.current = setTimeout(() => actions?.onTap?.(x, y, true), 320);
      }
    }
    if (pts.current.size > 0) return;
    press.current = undefined;
    setGuides({});
    drag.current = undefined; pinch.current = undefined;
    if (began.current) { began.current = false; engine.endGesture(); }
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  const btn = (c: string, label: string, g: string, run?: () => void) => run && (
    <button key={c} type="button" className={`v2-giz ${c}`} aria-label={label} title={label} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); run(); }}><Ic g={g} size={14} /></button>
  );
  return (
    <>
    <div className="v2-xform-catch" data-testid="preview-catch" {...handlers} onPointerDown={startOutside} onClick={(e) => e.stopPropagation()}
      title="Drag anywhere to move the selection · pinch or twist to scale and rotate · tap empty space to deselect" />
    {guides.x !== undefined && <div className="v2-guide v" data-testid="guide-x" style={{ left: rect.left - parent.left + guides.x * k, top: rect.top - parent.top, height: rect.height }} />}
    {guides.y !== undefined && <div className="v2-guide h" data-testid="guide-y" style={{ top: rect.top - parent.top + guides.y * k, left: rect.left - parent.left, width: rect.width }} />}
    <div className="v2-xform" style={style} data-testid="transform-box">
      {/* V2-113: the drag surface is a sibling of the corner buttons, not their parent, so a finger in
          the middle of a small frame isn't touch-adjusted onto a nearby button or the rotate knob. */}
      <div className="v2-xform-body" tabIndex={-1} data-testid="transform-body" {...handlers} onPointerDown={start("move")} title="Drag to move · pinch to scale · twist to rotate · hold Alt to skip snapping" onClick={(e) => e.stopPropagation()} />
      {btn("nw", "Delete", "🗑", actions?.onDelete)}
      {btn("ne", "Edit", "✎", actions?.onEdit)}
      {btn("sw", "Duplicate", "⧉", actions?.onDuplicate)}
      <span className="v2-giz se" role="slider" aria-label="Rotate and scale" aria-valuenow={Math.round(valuesAt(placement, time).rotation)} onPointerDown={start("spin")} {...handlers}><Ic g="⟳" size={14} /></span>
    </div>
    </>
  );
}

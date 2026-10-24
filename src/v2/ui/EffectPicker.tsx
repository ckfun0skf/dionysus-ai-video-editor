import { useEffect, useRef, useState } from "react";
import { useEdgeFade } from "./useEdgeFade";
import { cmd, type Engine } from "../engine";
import { newId, type Placement } from "../domain";
import { applyEffectFrame } from "../render";
import { applyPreset, categories, defaultsOf, getPreset, identityFrame, listPresets } from "../registry";

const CYCLE_MS = 1800;

/** Procedural sample picture (sky, sun, hills) so tiles preview effects without any media. */
function drawSample(g: CanvasRenderingContext2D, w: number, h: number) {
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#3b82f6"); sky.addColorStop(1, "#f9a8d4");
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = "#fde047"; g.beginPath(); g.arc(w * 0.7, h * 0.35, h * 0.16, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#16a34a"; g.beginPath(); g.moveTo(0, h); g.lineTo(0, h * 0.7); g.quadraticCurveTo(w * 0.3, h * 0.45, w * 0.6, h * 0.72); g.quadraticCurveTo(w * 0.85, h * 0.6, w, h * 0.68); g.lineTo(w, h); g.fill();
  g.fillStyle = "#ef4444"; g.fillRect(w * 0.18, h * 0.55, w * 0.12, h * 0.2);
}

/** Live tile: the sample picture run through the same applyEffectFrame the player uses. */
function EffectTile({ id, label, active, onPick }: { id: string; label: string; active?: boolean; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext?.("2d");
    if (!c || !g) return;
    let raf = 0; const t0 = performance.now();
    const draw = (now: number) => {
      g.setTransform(1, 0, 0, 1, 0, 0); g.filter = "none"; g.globalAlpha = 1;
      drawSample(g, c.width, c.height);
      if (id !== "none") applyEffectFrame(g, c.width, c.height, applyPreset("videoEffect", id, ((now - t0) % CYCLE_MS) / CYCLE_MS, identityFrame()));
      if (id !== "none") raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [id]);
  return (
    <button className={`v2-ptile ${active ? "is-active" : ""}`} role="radio" aria-checked={!!active} aria-label={label} title={id === "none" ? "No effect" : `${label}: tap to apply`} onClick={onPick}>
      <canvas ref={ref} width={144} height={96} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

/**
 * V2-101 effect picker. Without `placement`: a pick adds an effect clip at the playhead (default length).
 * With `placement` (an effect clip): a pick changes its preset; None deletes the clip; sliders edit params.
 */
export function EffectPicker({ engine, at, placement, onAdded, onClose }: { engine: Engine; at: number; placement?: Placement; onAdded?: (id: string) => void; onClose?: () => void }) {
  const tabsFade = useEdgeFade<HTMLDivElement>();
  const cats = categories("videoEffect");
  const [cat, setCat] = useState<string>("All");
  const cur = placement?.effect?.preset;
  const list = listPresets("videoEffect").filter((d) => cat === "All" || d.category === cat);
  const pick = (id: string) => {
    if (placement) {
      if (id === "none") { engine.dispatch(cmd.deletePlacement(placement.id)); onClose?.(); }
      else if (id !== cur) engine.dispatch(cmd.setEffect(placement.id, { preset: id }));
      return;
    }
    if (id === "none") { onClose?.(); return; }
    const nid = newId("plc");
    engine.dispatch(cmd.addEffectClip(at, id, undefined, nid));
    onAdded?.(nid);
  };
  const d = getPreset("videoEffect", cur);
  const vals = d ? defaultsOf(d, placement?.effect?.params) : {};
  return (
    <div className="v2-anim v2-effects">
      <div ref={tabsFade} className="v2-tp-tabs" role="tablist" aria-label="Effect category">
        {["All", ...cats].map((c) => <button key={c} role="tab" aria-selected={c === cat} className={`v2-tp-tab ${c === cat ? "is-active" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="v2-ptiles" role="radiogroup" aria-label="Effects">
        <EffectTile id="none" label="None" active={!!placement && !cur} onPick={() => pick("none")} />
        {list.map((p) => <EffectTile key={p.id} id={p.id} label={p.name} active={cur === p.id} onPick={() => pick(p.id)} />)}
      </div>
      {d && placement && d.params.map((s) => s.type === "number" && (
        <label key={s.key} className="v2-tp-row" title={s.description}>{s.label} <output>{Number(vals[s.key]).toFixed(2)}</output>
          <input type="range" aria-label={`${d.name} ${s.label}`} min={s.min} max={s.max} step={s.step ?? 0.01} value={Number(vals[s.key])}
            onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()}
            onChange={(e) => engine.dispatch(cmd.setEffect(placement.id, { params: { [s.key]: Number(e.target.value) } }))} />
        </label>
      ))}
      {!placement && <p className="v2-empty-hint">Pick an effect — it’s added at the playhead on the Effects layer and changes only the main track.</p>}
    </div>
  );
}

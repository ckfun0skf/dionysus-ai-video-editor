/**
 * P3B: VN-style clip panels.
 * - ChromaKeyPanel (item 12): on/off, eyedropper (tap the preview), colour swatch + hex field, Range and Spill sliders.
 * - VolumeCurve (item 11): keyframe points over the clip's waveform; tap to add, drag to move, select + Remove;
 *   fade-in / fade-out handles at the top corners.
 * - AudioFxPanel (item 11): audio effect presets (registry kind "audioFx") with an Intensity slider.
 * Every change is one command (drags coalesce), so all of it is undoable. All targets are at least 44 px.
 */
import { useRef, useState } from "react";
import { cmd, type Engine } from "../engine";
import { CHROMA_DEFAULT, evalKeys, TICKS_PER_SECOND, type ChromaKey, type Keyframe, type Placement } from "../domain";
import { listPresets } from "../registry";
import type { Peaks } from "./media";
import { SliderField } from "./SliderField";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const normHex = (s: string) => { const m = HEX.exec(s.trim()); if (!m) return undefined; const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]; return `#${h.toLowerCase()}`; };

export function ChromaKeyPanel({ engine, placement: pl, picking, onPick }: { engine: Engine; placement: Placement; picking: boolean; onPick: (on: boolean) => void }) {
  const key: ChromaKey | undefined = pl.chromaKey;
  const cur = key ?? CHROMA_DEFAULT;
  const on = !!key && !key.off;
  const [hex, setHex] = useState(cur.color);
  const [lastColor, setLast] = useState(cur.color);
  if (cur.color !== lastColor) { setLast(cur.color); setHex(cur.color); }
  const set = (k: Partial<ChromaKey>) => engine.dispatch(cmd.setChromaKey(pl.id, { ...cur, ...k, off: undefined }));
  const slider = (label: string, prop: "range" | "spill", hint: string) => (
    <SliderField className="v2-ck-sf" title={hint} label={label} min={0} max={1} step={0.01} value={cur[prop]} disabled={!on} unit="%" scale={100}
      onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()} onChange={(v) => set({ [prop]: v })} />
  );
  return (
    <div className="v2-psettings v2-chroma" data-testid="chroma-panel">
      <section aria-label="Chroma key">
        <div className="v2-ck-head">
          <h4>Chroma key</h4>
          <button role="switch" aria-checked={on} className={`v2-switch ${on ? "is-on" : ""}`} aria-label="Chroma key on"
            onClick={() => { if (on) { onPick(false); engine.dispatch(cmd.setChromaKey(pl.id, { ...cur, off: true })); } else set({}); }}><i aria-hidden /></button>
        </div>
        <p className="v2-hint">Removes one colour (a green or blue screen). Pick it from the preview, then tune Range and Spill.</p>
        <div className="v2-ck-colour">
          <button className={`v2-btn v2-ck-pick ${picking ? "is-active" : ""}`} aria-pressed={picking} title="Tap the preview to pick the colour to remove"
            onClick={() => { if (!on) set({}); onPick(!picking); }}>🎯 {picking ? "Tap the preview…" : "Pick colour"}</button>
          <label className="v2-ck-swatch" title="Choose a colour"><input type="color" value={cur.color} aria-label="Key colour" onChange={(e) => set({ color: e.target.value })} /></label>
          <input className="v2-ck-hex" value={hex} aria-label="Key colour hex" spellCheck={false} maxLength={7}
            onChange={(e) => { setHex(e.target.value); const h = normHex(e.target.value); if (h) set({ color: h }); }} onBlur={() => setHex(cur.color)} />
        </div>
        {slider("Range", "range", "Tolerance: how close to the colour is removed")}
        {slider("Spill", "spill", "Removes the colour's tint from edges and hair")}
        {key && <button className="v2-btn v2-btn-sm v2-ck-reset" onClick={() => { onPick(false); engine.dispatch(cmd.setChromaKey(pl.id, null)); }}>Remove chroma key</button>}
      </section>
    </div>
  );
}

const CURVE_H = 132;
/** Map v 0..2 to y (1 = middle line). */
const yOf = (v: number) => CURVE_H - 10 - (v / 2) * (CURVE_H - 20);
const vOf = (y: number) => Math.max(0, Math.min(2, ((CURVE_H - 10 - y) / (CURVE_H - 20)) * 2));

export function VolumeCurve({ engine, placement: pl, peaks, time }: { engine: Engine; placement: Placement; peaks?: Peaks; time: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [selKey, setSelKey] = useState<number>();
  const drag = useRef<{ i?: number; fade?: "in" | "out"; moved: boolean }>();
  const keys: Keyframe[] = pl.keyframes?.volume ?? [];
  const dur = Math.max(1, pl.durationTicks);
  const W = 1000;
  const xOf = (t: number) => (t / dur) * W;
  const pointer = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { t: Math.max(0, Math.min(dur, ((e.clientX - r.left) / (r.width || 1)) * dur)), y: ((e.clientY - r.top) / (r.height || 1)) * CURVE_H };
  };
  const put = (next: Keyframe[], label?: string) => engine.dispatch(cmd.setVolumeKeys(pl.id, next, label));
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const { t, y } = pointer(e);
    const target = (e.target as Element).closest("[data-key],[data-fade]");
    engine.beginGesture();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (target?.getAttribute("data-fade")) { drag.current = { fade: target.getAttribute("data-fade") as "in" | "out", moved: false }; return; }
    if (target?.getAttribute("data-key")) { const i = Number(target.getAttribute("data-key")); setSelKey(i); drag.current = { i, moved: false }; return; }
    // Tap on empty space: add a point there (the curve's value when tapped near the line, else where tapped).
    const v = Math.round(vOf(y) * 100) / 100;
    const next = [...keys, { t: Math.round(t), v }].sort((a, b) => a.t - b.t);
    put(next, "Add volume point");
    const i = next.findIndex((k) => k.t === Math.round(t));
    setSelKey(i); drag.current = { i, moved: false };
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current; if (!d) return;
    const { t, y } = pointer(e);
    d.moved = true;
    if (d.fade === "in") { engine.dispatch(cmd.setFades(pl.id, { in: Math.round(t) })); return; }
    if (d.fade === "out") { engine.dispatch(cmd.setFades(pl.id, { out: Math.round(dur - t) })); return; }
    if (d.i === undefined) return;
    const lo = d.i > 0 ? keys[d.i - 1].t + 1 : 0, hi = d.i < keys.length - 1 ? keys[d.i + 1].t - 1 : dur;
    const next = keys.map((k, j) => (j === d.i ? { t: Math.round(Math.max(lo, Math.min(hi, t))), v: Math.round(vOf(y) * 100) / 100 } : k));
    put(next);
  };
  const onUp = () => { drag.current = undefined; engine.endGesture(); };
  const remove = () => { if (selKey === undefined) return; put(keys.filter((_, j) => j !== selKey), "Remove volume point"); setSelKey(undefined); };
  const addAtPlayhead = () => {
    const t = Math.round(Math.max(0, Math.min(dur, time - pl.startTicks)));
    const next = [...keys, { t, v: Math.round((evalKeys(keys, t) ?? 1) * 100) / 100 }].sort((a, b) => a.t - b.t);
    put(next, "Add volume point"); setSelKey(next.findIndex((k) => k.t === t));
  };
  // Waveform bars of the clip's span (source in → in + length × speed).
  const speed = pl.speed ?? 1, inSec = pl.sourceInTicks / TICKS_PER_SECOND, lenSec = (dur / TICKS_PER_SECOND) * speed;
  const bars: JSX.Element[] = [];
  const N = 100;
  for (let i = 0; i < N; i++) {
    let v = 0.03;
    if (peaks) { const a = Math.floor((inSec + (i / N) * lenSec) * peaks.perSecond), z = Math.max(a + 1, Math.ceil((inSec + ((i + 1) / N) * lenSec) * peaks.perSecond)); for (let j = a; j < z && j < peaks.data.length; j++) v = Math.max(v, peaks.data[j]); }
    const h = v * (CURVE_H - 20) * 0.9;
    bars.push(<rect key={i} x={i * 10 + 1} y={CURVE_H / 2 - h / 2} width={7} height={Math.max(1, h)} className="v2-vc-bar" />);
  }
  const line = keys.length ? [{ t: 0, v: keys[0].v }, ...keys, { t: dur, v: keys[keys.length - 1].v }] : [{ t: 0, v: 1 }, { t: dur, v: 1 }];
  const fi = Math.min(dur, pl.fadeInTicks ?? 0), fo = Math.min(dur, pl.fadeOutTicks ?? 0);
  const sec = (t: number) => `${(t / TICKS_PER_SECOND).toFixed(1)} s`;
  return (
    <div className="v2-psettings v2-vcurve" data-testid="volume-curve">
      <section aria-label="Volume curve">
        <h4>Volume curve</h4>
        <p className="v2-hint">Tap to add a point, drag to move it. Drag the ◢ ◣ handles for fade in and out.</p>
        <div className="v2-vc-box" style={{ height: CURVE_H }}>
        <svg ref={svg} className="v2-vc-svg" viewBox={`0 0 ${W} ${CURVE_H}`} preserveAspectRatio="none" role="application" aria-label="Volume curve editor"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ height: CURVE_H }}>
          {bars}
          <line x1={0} x2={W} y1={yOf(1)} y2={yOf(1)} className="v2-vc-unity" />
          {fi > 0 && <polygon points={`0,${CURVE_H} 0,0 ${xOf(fi)},0`} className="v2-vc-fade" />}
          {fo > 0 && <polygon points={`${W},${CURVE_H} ${W},0 ${W - xOf(fo)},0`} className="v2-vc-fade" />}
          <polyline points={line.map((k) => `${xOf(k.t)},${yOf(k.v)}`).join(" ")} className="v2-vc-line" />
          {time >= pl.startTicks && time <= pl.startTicks + dur && <line x1={xOf(time - pl.startTicks)} x2={xOf(time - pl.startTicks)} y1={0} y2={CURVE_H} className="v2-vc-head" />}
        </svg>
        {/* Points and fade handles as HTML overlays so they keep a round 44 px hit area at any width. */}
        <div className="v2-vc-points">
          {keys.map((k, i) => (
            <button key={i} data-key={i} className={`v2-vc-pt ${selKey === i ? "is-sel" : ""}`} style={{ left: `${(k.t / dur) * 100}%`, top: yOf(k.v) }}
              aria-label={`Volume point ${i + 1}: ${pct(k.v)} at ${sec(k.t)}`} aria-pressed={selKey === i}
              onPointerDown={(e) => { e.stopPropagation(); onDown(e as unknown as React.PointerEvent<SVGSVGElement>); svg.current?.setPointerCapture?.(e.pointerId); }}
              onPointerMove={(e) => onMove(e as unknown as React.PointerEvent<SVGSVGElement>)} onPointerUp={onUp} onPointerCancel={onUp}><i /></button>
          ))}
          <button data-fade="in" className="v2-vc-fh is-in" style={{ left: `${(fi / dur) * 100}%` }} aria-label={`Fade in ${sec(fi)}`}
            onPointerDown={(e) => { e.stopPropagation(); onDown(e as unknown as React.PointerEvent<SVGSVGElement>); }} onPointerMove={(e) => onMove(e as unknown as React.PointerEvent<SVGSVGElement>)} onPointerUp={onUp} onPointerCancel={onUp}>◢</button>
          <button data-fade="out" className="v2-vc-fh is-out" style={{ left: `${100 - (fo / dur) * 100}%` }} aria-label={`Fade out ${sec(fo)}`}
            onPointerDown={(e) => { e.stopPropagation(); onDown(e as unknown as React.PointerEvent<SVGSVGElement>); }} onPointerMove={(e) => onMove(e as unknown as React.PointerEvent<SVGSVGElement>)} onPointerUp={onUp} onPointerCancel={onUp}>◣</button>
        </div>
        </div>
        <div className="v2-vc-actions">
          <button className="v2-btn v2-btn-sm" onClick={addAtPlayhead}>＋ Point at playhead</button>
          <button className="v2-btn v2-btn-sm" disabled={selKey === undefined || !keys[selKey]} onClick={remove}>Remove point</button>
          <button className="v2-btn v2-btn-sm" disabled={!keys.length} onClick={() => { put([], "Clear volume curve"); setSelKey(undefined); }}>Clear</button>
        </div>
        {selKey !== undefined && keys[selKey] && <p className="v2-hint" role="status">Point {selKey + 1}: {pct(keys[selKey].v)} at {sec(keys[selKey].t)}</p>}
      </section>
    </div>
  );
}

export function AudioFxPanel({ engine, placement: pl }: { engine: Engine; placement: Placement }) {
  const fx = pl.audioFx;
  const list = listPresets("audioFx");
  return (
    <div className="v2-psettings v2-afx" data-testid="audio-fx">
      <section aria-label="Audio effects">
        <h4>Audio effects</h4>
        <div className="v2-afx-grid" role="radiogroup" aria-label="Audio effect">
          <button role="radio" aria-checked={!fx} className={`v2-afx-btn ${!fx ? "is-active" : ""}`} onClick={() => engine.dispatch(cmd.setAudioFx(pl.id, null))}>None</button>
          {list.map((d) => (
            <button key={d.id} role="radio" aria-checked={fx?.preset === d.id} title={d.description} className={`v2-afx-btn ${fx?.preset === d.id ? "is-active" : ""}`}
              onClick={() => engine.dispatch(cmd.setAudioFx(pl.id, { preset: d.id, amount: fx?.amount ?? 1 }))}>{d.name}</button>
          ))}
        </div>
        <SliderField className="v2-ck-sf" label="Intensity" aria="Effect intensity" min={0} max={1} step={0.01} value={fx?.amount ?? 1} disabled={!fx} unit="%" scale={100}
          onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()} onChange={(v) => { if (fx) engine.dispatch(cmd.setAudioFx(pl.id, { preset: fx.preset, amount: v })); }} />
      </section>
    </div>
  );
}

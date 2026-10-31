/**
 * P14-SPATIAL: the sound position pad. A top-down square with the listener's head in the centre (front at the top):
 * drag the dot to set azimuth (angle) and distance (radius). Preset chips, a width slider, keyframes at the playhead
 * (the animated path is drawn on the pad), "use for the whole track", and the project's output mode / environment.
 * The pad has touch-action: none and captures the pointer, so a touch drag never scrolls the page.
 */
import { useRef, useState } from "react";
import { cmd, type Engine } from "../engine";
import { audioOutputOf, keyPosAt, POSITION_PRESETS, spatialAt, spatialOf, TICKS_PER_SECOND, type Placement, type PositionKey, type Project, type SpatialPos, type Track } from "../domain";
import { SliderField } from "./SliderField";

const HEAD = 0.14;
/** Pad unit coords (-1..1, y down) ↔ position. */
export function padToPos(x: number, y: number): { azimuth: number; distance: number } {
  const r = Math.hypot(x, y);
  return { azimuth: r < 1e-6 ? 0 : Math.round((Math.atan2(x, -y) * 180) / Math.PI), distance: Math.round(Math.max(0, Math.min(1, (r - HEAD) / (1 - HEAD))) * 100) / 100 };
}
export function posToPad(p: { azimuth: number; distance: number }): { x: number; y: number } {
  const a = (p.azimuth * Math.PI) / 180, r = HEAD + (1 - HEAD) * p.distance;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}
const describe = (p: { azimuth: number; distance: number }) => {
  const a = p.azimuth, side = Math.abs(a) < 15 ? "front" : Math.abs(a) > 165 ? "behind" : `${a < 0 ? "left" : "right"}${Math.abs(a) > 105 ? " behind" : Math.abs(a) < 75 ? " front" : ""}`;
  return `${side}, ${Math.round(a)}°, distance ${Math.round(p.distance * 100)}%`;
};

export function SpatialPad({ engine, project, placement: pl, track, time }: { engine: Engine; project: Project; placement: Placement; track: Track; time: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState(false);
  const sp = spatialOf(pl, track);
  const rel = Math.max(0, Math.min(pl.durationTicks, time - pl.startTicks));
  const cur: SpatialPos = sp ? spatialAt(sp, rel) : { azimuth: 0, distance: 0, width: 1 };
  const keys = pl.positionKeys ?? [];
  const keyHere = keys.findIndex((k) => Math.abs(k.t - rel) < TICKS_PER_SECOND / 20);
  const fromTrack = !pl.position && !keys.length && !!track.position;
  const out = audioOutputOf(project);

  const commit = (p: { azimuth: number; distance: number }) => {
    if (keys.length) {
      const next: PositionKey[] = keyHere >= 0 ? keys.map((k, i) => (i === keyHere ? { t: k.t, ...p } : k)) : [...keys, { t: rel, ...p }];
      engine.dispatch(cmd.setPosition(pl.id, undefined, next, "Move position key"));
    } else engine.dispatch(cmd.setPosition(pl.id, { ...p, width: pl.position?.width ?? track.position?.width }));
  };
  const at = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return padToPos(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const dot = posToPad(cur);
  const path = keys.length > 1 ? Array.from({ length: 41 }, (_, i) => posToPad(keyPosAt(keys, keys[0].t + ((keys[keys.length - 1].t - keys[0].t) * i) / 40)!)) : [];
  const nudge = (da: number, dd: number) => commit({ azimuth: ((((cur.azimuth + da + 180) % 360) + 360) % 360) - 180, distance: Math.max(0, Math.min(1, cur.distance + dd)) });

  return (
    <section className="v2-psettings v2-spatial" aria-label="Position" data-testid="spatial-pad">
      <h4>Position</h4>
      <div className="v2-sp-wrap">
        <svg ref={svg} className={`v2-sp-pad ${drag ? "is-drag" : ""}`} viewBox="-1 -1 2 2" role="slider" tabIndex={0} aria-label="Sound position: drag the dot; front is at the top"
          aria-valuetext={sp ? describe(cur) : "centre (not positioned)"} aria-valuemin={-180} aria-valuemax={180} aria-valuenow={Math.round(cur.azimuth)}
          onPointerDown={(e) => { e.preventDefault(); svg.current!.setPointerCapture(e.pointerId); setDrag(true); engine.beginGesture(); commit(at(e)); }}
          onPointerMove={(e) => { if (drag) { e.preventDefault(); commit(at(e)); } }}
          onPointerUp={(e) => { if (drag) { setDrag(false); engine.endGesture(); svg.current!.releasePointerCapture?.(e.pointerId); } }}
          onPointerCancel={() => { if (drag) { setDrag(false); engine.endGesture(); } }}
          onKeyDown={(e) => { const m: Record<string, [number, number]> = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -0.05], ArrowDown: [0, 0.05] }; const d = m[e.key]; if (d) { e.preventDefault(); nudge(...d); } }}>
          <rect x={-1} y={-1} width={2} height={2} rx={0.08} className="v2-sp-bg" />
          {[0.35, 0.6, 1].map((r) => <circle key={r} r={HEAD + (1 - HEAD) * (r === 1 ? 0.999 : r)} className="v2-sp-ring" />)}
          <line x1={0} y1={-1} x2={0} y2={1} className="v2-sp-axis" /><line x1={-1} y1={0} x2={1} y2={0} className="v2-sp-axis" />
          <text x={0} y={-0.9} className="v2-sp-lbl">Front</text><text x={0} y={0.96} className="v2-sp-lbl">Behind</text>
          <text x={-0.94} y={0.03} className="v2-sp-lbl" textAnchor="start">L</text><text x={0.94} y={0.03} className="v2-sp-lbl" textAnchor="end">R</text>
          <g className="v2-sp-head"><circle r={HEAD * 0.75} /><path d={`M ${-HEAD * 0.25} ${-HEAD * 0.7} L 0 ${-HEAD * 1.05} L ${HEAD * 0.25} ${-HEAD * 0.7} Z`} /></g>
          {path.length > 0 && <polyline className="v2-sp-path" points={path.map((p) => `${p.x},${p.y}`).join(" ")} />}
          {keys.map((k, i) => { const p = posToPad(k); return <circle key={i} cx={p.x} cy={p.y} r={0.035} className={`v2-sp-key ${i === keyHere ? "is-here" : ""}`} />; })}
          <circle cx={dot.x} cy={dot.y} r={0.075} className={`v2-sp-dot ${sp ? "" : "is-off"}`} />
        </svg>
        <p className="v2-hint" role="status">{sp ? `${describe(cur)}${fromTrack ? " (track default)" : ""}${keys.length ? ` · ${keys.length} key${keys.length > 1 ? "s" : ""}` : ""}` : "Centre — not positioned (no processing)"}</p>
      </div>
      <div className="v2-sp-chips" role="group" aria-label="Position presets">
        <button className={`v2-afx-btn ${!sp ? "is-active" : ""}`} onClick={() => engine.dispatch(cmd.setPosition(pl.id, null, null, "Reset position"))}>Centre (off)</button>
        {POSITION_PRESETS.map((p) => <button key={p.id} className="v2-afx-btn" onClick={() => commit(p)}>{p.label}</button>)}
      </div>
      <div className="v2-sp-row">
        <button className="v2-btn" aria-pressed={keyHere >= 0} title="Add a position keyframe at the playhead (animates the path)" onClick={() => {
          if (keyHere >= 0) engine.dispatch(cmd.setPosition(pl.id, undefined, keys.filter((_, i) => i !== keyHere), "Remove position key"));
          else engine.dispatch(cmd.setPosition(pl.id, keys.length ? undefined : { azimuth: cur.azimuth, distance: cur.distance, width: cur.width }, [...keys, { t: rel, azimuth: cur.azimuth, distance: cur.distance }], "Add position key"));
        }}>◆ {keyHere >= 0 ? "Remove key" : "Key at playhead"}</button>
        <button className="v2-btn" disabled={!keys.length} onClick={() => engine.dispatch(cmd.setPosition(pl.id, { azimuth: cur.azimuth, distance: cur.distance, width: cur.width }, null, "Clear position path"))}>Clear path</button>
        <button className="v2-btn" disabled={!sp} title="Make this the default position of every clip on this track without its own" onClick={() => engine.dispatch(cmd.setTrackPosition(track.id, { azimuth: cur.azimuth, distance: cur.distance, width: cur.width }))}>Use for track</button>
      </div>
      <SliderField className="v2-ck-sf" label="Stereo width" aria="Stereo width" min={0} max={1} step={0.01} value={cur.width ?? 1} unit="%" scale={100} disabled={!sp}
        onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()} onChange={(v) => engine.dispatch(cmd.setPosition(pl.id, { azimuth: pl.position?.azimuth ?? cur.azimuth, distance: pl.position?.distance ?? cur.distance, width: v }))} />
      <p className="v2-hint">100% keeps a stereo file's own left/right movement; mono files are point sources.</p>
      <div className="v2-sp-row" role="radiogroup" aria-label="Output (whole project)">
        <span className="v2-sp-k">Output</span>
        {(["stereo", "binaural"] as const).map((m) => <button key={m} role="radio" aria-checked={out.mode === m} className={`v2-afx-btn ${out.mode === m ? "is-active" : ""}`} title={m === "binaural" ? "3D for headphones (HRTF), front/behind cues" : "Speakers and headphones"} onClick={() => engine.dispatch(cmd.setProjectSettings({ audioOutput: { mode: m, environment: out.environment } }, "Audio output"))}>{m === "stereo" ? "Stereo" : "Binaural (headphones)"}</button>)}
      </div>
      <div className="v2-sp-row" role="radiogroup" aria-label="Environment (whole project)">
        <span className="v2-sp-k">Space</span>
        {(["room", "outdoor"] as const).map((v) => <button key={v} role="radio" aria-checked={out.environment === v} className={`v2-afx-btn ${out.environment === v ? "is-active" : ""}`} onClick={() => engine.dispatch(cmd.setProjectSettings({ audioOutput: { mode: out.mode, environment: v } }, "Audio environment"))}>{v === "room" ? "Room" : "Outdoor"}</button>)}
      </div>
    </section>
  );
}

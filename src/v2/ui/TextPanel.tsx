import { useState } from "react";
import { useEdgeFade } from "./useEdgeFade";
import { cmd, type Engine } from "../engine";
import { layers, text as T, type Placement, type TextData, type Track } from "../domain";
import { AnimationPicker } from "./AnimationPicker";
import { PresetTile } from "./PresetTile";
import { Ic } from "./Icon";
import { listPresets, type PresetKind } from "../registry";

/** Chip ids for a preset kind, "none" first; labels come from the registry. */
const presetIds = (k: PresetKind) => ["none", ...listPresets(k).map((d) => d.id)];
const presetName = (k: PresetKind, id: string) => (id === "none" ? "None" : listPresets(k).find((d) => d.id === id)?.name ?? id);

const TABS = ["Templates", "Font", "Style", "Effects", "Animation"] as const;
export type Tab = (typeof TABS)[number];

/** Text clip editor: templates, fonts, style, effects, animations. Every change is undoable; slider drags are one step. */
/**
 * V2-103: `layer` = layer mode ("Edit all"): edits go to the layer style and reach every clip on it.
 * `track` (clip mode) = the clip's layer, for the "custom" dot and "Reset to layer style".
 * `placement` must be the effective placement (layers.effectivePlacement) so the controls show what renders.
 */
export function TextPanel({ engine, placement, onAnimPicked, initialTab = "Templates", layer, track }: { engine: Engine; placement?: Placement; onAnimPicked?: () => void; initialTab?: Tab; layer?: Track; track?: Track }) {
  const tabsFade = useEdgeFade<HTMLDivElement>();
  const [tab, setTab] = useState<Tab>(initialTab);
  const ls = layer?.layerStyle;
  const pl: Placement = placement ?? layer?.placements.find((p) => p.clipType === "text") ?? { id: "", startTicks: 0, durationTicks: T.DEFAULT_TEXT_TICKS, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "", versionId: "" }, clipType: "text" };
  const d = layer ? T.textOf(ls?.text) : T.textOf(pl.text);
  const setLayer = (patch: Partial<TextData>, label?: string) => { const { text: _x, ...rest } = patch; void _x; engine.dispatch(cmd.setLayerStyle(layer!.id, { text: rest }, label)); };
  const set = layer ? setLayer : (patch: Partial<TextData>, label?: string) => engine.dispatch(cmd.updateText(pl.id, patch, label));
  const lt = { x: 0, y: 0, scale: 1, ...ls?.transform };
  const tf = (label: string, key: "x" | "y" | "scale", min: number, max: number, step: number) => (
    <label className="v2-tp-row">{label}
      <input type="range" min={min} max={max} step={step} value={lt[key]} aria-label={`Layer ${label}`}
        onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()}
        onChange={(e) => engine.dispatch(cmd.setLayerStyle(layer!.id, { transform: { [key]: Number(e.target.value) } }, `Layer ${label}`))} />
    </label>
  );
  const custom = !layer && track?.layerStyle && placement ? layers.isCustom(track, track.placements.find((p) => p.id === placement.id) ?? placement) : false;
  const range = (label: string, key: "size" | "letterSpacing" | "lineHeight" | "strokeWidth", min: number, max: number, step: number) => (
    <label className="v2-tp-row">{label}
      <input type="range" min={min} max={max} step={step} value={d[key] ?? (key === "lineHeight" ? 1.25 : 0)} aria-label={label}
        onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()}
        onChange={(e) => set({ [key]: Number(e.target.value) })} />
    </label>
  );
  const color = (label: string, value: string, on: (v: string) => void) => (
    <label className="v2-tp-row v2-tp-color">{label}<span className="v2-color-val"><code>{value.toUpperCase()}</code><input type="color" aria-label={label} value={value} onFocus={() => engine.beginGesture()} onBlur={() => engine.endGesture()} onChange={(e) => on(e.target.value)} /></span></label>
  );
  const chips = <K extends string>(label: string, list: readonly K[], value: K, on: (v: K) => void, name: (v: K) => string = (v) => v) => (
    <div className="v2-tp-chips" role="radiogroup" aria-label={label}>
      {list.map((v) => <button key={v} role="radio" aria-checked={v === value} className={`v2-chip ${v === value ? "is-active" : ""}`} onClick={() => on(v)}>{name(v)}</button>)}
    </div>
  );
  return (
    <div className={`v2-textpanel ${layer ? "is-layer" : ""}`}>
      {layer && <div className="v2-tp-layerhead" role="status"><Ic g="layers" size={14} /> Editing all {layers.textClipCount(layer)} clips in layer <b>{layer.name}</b></div>}
      {!layer && track?.layerStyle && <div className="v2-tp-layerhead">
        {custom ? <><span className="v2-custom-dot" aria-hidden /> Custom style on this clip</> : <>Follows layer style <b>{track.name}</b></>}
        <button className="v2-btn" disabled={!custom} title="Drop this clip's own style so it matches the rest of the layer (undoable)" onClick={() => engine.dispatch(cmd.resetToLayerStyle(pl.id))}>Reset to layer style</button>
      </div>}
      {!layer && <textarea className="v2-tp-text" aria-label="Text content" value={d.text} rows={2} onFocus={() => engine.beginGesture()} onBlur={() => engine.endGesture()} onChange={(e) => set({ text: e.target.value }, "Type text")} />}
      <div ref={tabsFade} className="v2-tp-tabs" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={t === tab} className={`v2-tp-tab ${t === tab ? "is-active" : ""}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      <div className="v2-tp-body" role="tabpanel" aria-label={tab}>
        {tab === "Templates" && <div className="v2-tp-grid">{T.textTemplates().map((tp) => {
          const s = T.textOf(tp.data);
          return <button key={tp.id} className="v2-tp-tpl" title={`Apply ${tp.label}`} onClick={() => set(tp.data, `Template ${tp.label}`)}
            style={{ fontFamily: s.font, fontWeight: s.bold ? 700 : 400, fontStyle: s.italic ? "italic" : "normal", color: s.effect === "hollow" ? "transparent" : s.color, WebkitTextStroke: s.strokeWidth ? `1px ${s.strokeColor}` : undefined, textShadow: s.effect === "neon" || s.effect === "glow" ? `0 0 6px ${s.effectColor}` : undefined, background: s.background ? s.background.color : undefined }}>{tp.label}</button>;
        })}</div>}
        {tab === "Font" && <>
          <div className="v2-tp-grid">{T.FONTS.map((f) => <button key={f.label} className={`v2-tp-tpl ${d.font === f.stack ? "is-active" : ""}`} aria-pressed={d.font === f.stack} style={{ fontFamily: f.stack }} onClick={() => set({ font: f.stack }, "Font")}>{f.label}</button>)}</div>
          <div className="v2-tp-chips">
            <button className={`v2-chip ${d.bold ? "is-active" : ""}`} aria-pressed={!!d.bold} onClick={() => set({ bold: !d.bold })}><b>B</b></button>
            <button className={`v2-chip ${d.italic ? "is-active" : ""}`} aria-pressed={!!d.italic} onClick={() => set({ italic: !d.italic })}><i>I</i></button>
          </div>
        </>}
        {tab === "Style" && <>
          {layer && <>{tf("Position X", "x", -0.5, 0.5, 0.01)}{tf("Position Y", "y", -0.5, 0.5, 0.01)}{tf("Scale", "scale", 0.3, 3, 0.05)}</>}
          {color("Color", d.color, (v) => set({ color: v }))}
          {range("Size", "size", 0.03, 0.3, 0.005)}
          {chips("Alignment", ["left", "center", "right"] as const, d.align, (v) => set({ align: v }))}
          {range("Letter spacing", "letterSpacing", -0.1, 0.5, 0.01)}
          {range("Line height", "lineHeight", 0.8, 2.5, 0.05)}
          {range("Outline", "strokeWidth", 0, 0.2, 0.01)}
          {color("Outline color", d.strokeColor ?? "#000000", (v) => set({ strokeColor: v }))}
          <label className="v2-tp-row">Shadow<input type="checkbox" checked={!!d.shadow} onChange={(e) => set({ shadow: e.target.checked ? { color: "#000000", blur: 0.15, x: 0.03, y: 0.03 } : undefined })} /></label>
          <label className="v2-tp-row">Background<input type="checkbox" checked={!!d.background} onChange={(e) => set({ background: e.target.checked ? { color: "#000000", opacity: 0.6 } : undefined })} /></label>
          {d.background && color("Background color", d.background.color, (v) => set({ background: { ...d.background!, color: v } }))}
        </>}
        {tab === "Effects" && <>
          <div className="v2-ptiles" role="radiogroup" aria-label="Effect">
            {presetIds("effect").map((id) => <PresetTile key={id} kind="effect" id={id} label={presetName("effect", id)} active={(d.effect ?? "none") === id} animate={false} onPick={() => set({ effect: id }, "Effect")} />)}
          </div>
          {color("Effect color", d.effectColor ?? "#20d5ec", (v) => set({ effectColor: v }))}
        </>}
        {tab === "Animation" && <AnimationPicker engine={engine} placement={layer ? { ...pl, text: d } : pl} onPicked={onAnimPicked} onSet={layer ? setLayer : undefined} />}
      </div>
    </div>
  );
}

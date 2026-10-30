/**
 * P2B editors used by ShotEditor:
 * - BackgroundEditor (item 20): a still shot's solid colour or linear / radial gradient (stops, angle).
 * - LayersEditor (item 21): the shot's layers as an editable list with "Add layer" → Text, Overlay (an image or video
 *   asset over the picture) or Code (an html asset). Effects stay listed (remove only).
 */
import { useState } from "react";
import { story, storyAuto, type AssetSlot, type Storyboard } from "../../domain";
type StoryBackground = story.StoryBackground; type StoryColorStop = story.StoryColorStop; type StoryEffect = story.StoryEffect; type StoryLayer = story.StoryLayer;
const { STILL_ASSET_TYPES } = story;
import { Ic } from "../Icon";
import { TYPE_ICON } from "./BoardView";

type Kind = "solid" | "linear" | "radial";
const kindOf = (bg: StoryBackground): Kind => (typeof bg === "string" ? "solid" : bg.type);
const firstColor = (bg: StoryBackground) => (typeof bg === "string" ? bg : bg.stops[0]?.color ?? "#000000");
const pct = (x: number | undefined) => (x === undefined ? "" : String(Math.round(x * 100)));

export function BackgroundEditor({ value, onChange }: { value: StoryBackground; onChange: (bg: StoryBackground) => void }) {
  const kind = kindOf(value);
  const stops: StoryColorStop[] = typeof value === "string" ? [] : value.stops;
  const setKind = (k: Kind) => {
    if (k === kind) return;
    if (k === "solid") return onChange(firstColor(value));
    const st = typeof value === "string" ? [{ color: value }, { color: "#1a2a4a" }] : value.stops;
    onChange(k === "linear" ? { type: "linear", angle: typeof value !== "string" && value.angle !== undefined ? value.angle : 180, stops: st } : { type: "radial", stops: st });
  };
  const setStops = (next: StoryColorStop[]) => { if (typeof value !== "string") onChange({ ...value, stops: next }); };
  return (
    <div className="v2-sb-bg" data-testid="bg-editor">
      <div className="v2-sb-seg" role="radiogroup" aria-label="Background type">
        {(["solid", "linear", "radial"] as const).map((k) => <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k === "solid" ? "Solid" : k === "linear" ? "Linear" : "Radial"}</button>)}
      </div>
      <div className="v2-sb-bg-preview" style={{ background: storyAuto.backgroundCss(value) }} aria-hidden="true" data-testid="bg-preview" />
      {typeof value === "string" ? (
        <label className="v2-sb-field v2-sb-bg-row">Colour<input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Background colour" /></label>
      ) : (
        <>
          {value.type === "linear" && <label className="v2-sb-field v2-sb-bg-row">Angle (°)<input inputMode="numeric" value={value.angle ?? 180} onChange={(e) => { const a = Number(e.target.value); onChange({ ...value, angle: Number.isFinite(a) ? ((a % 360) + 360) % 360 : 180 }); }} aria-label="Gradient angle" title="0 = bottom to top, 90 = left to right, 180 = top to bottom" /></label>}
          <ul className="v2-sb-editlist" aria-label="Colour stops">
            {stops.map((s, i) => (
              <li key={i} className="v2-sb-bg-stop">
                <input type="color" value={s.color} onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} aria-label={`Stop ${i + 1} colour`} />
                <input inputMode="numeric" placeholder="auto" value={pct(s.at)} onChange={(e) => { const t = e.target.value.trim(); const n = Number(t); setStops(stops.map((x, j) => (j === i ? (t === "" || !Number.isFinite(n) ? { color: x.color } : { ...x, at: Math.min(1, Math.max(0, n / 100)) }) : x))); }} aria-label={`Stop ${i + 1} position (%)`} title="Position along the gradient, 0–100 % (empty = spread evenly)" />
                <button type="button" className="v2-icon v2-sb-icon" aria-label={`Remove stop ${i + 1}`} disabled={stops.length <= 2} onClick={() => setStops(stops.filter((_, j) => j !== i))}><Ic g="✕" size={16} /></button>
              </li>
            ))}
          </ul>
          <button type="button" className="v2-btn v2-sb-btn" disabled={stops.length >= 8} onClick={() => setStops([...stops, { color: stops.at(-1)?.color ?? "#ffffff" }])}><Ic g="+" size={16} /> Add stop</button>
        </>
      )}
    </div>
  );
}

const sec = (x: number) => `${Math.round(x * 100) / 100}`;
const isOverlay = (s: AssetSlot) => s.type === "video" || STILL_ASSET_TYPES.includes(s.type);
const FULL = { x: 0, y: 0, width: 1, height: 1 };

/** A layer id not used in `layers` ("title", "overlay", "code", then "-2" …). */
export function nextLayerId(layers: StoryLayer[], base: string): string {
  const ids = new Set(layers.map((l) => l.id));
  if (!ids.has(base)) return base;
  let i = 2; while (ids.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function LayersEditor({ b, layers, effects, dur, onLayers, onEffects, effectName }: {
  b: Storyboard; layers: StoryLayer[]; effects: StoryEffect[]; dur: number;
  onLayers: (l: StoryLayer[]) => void; onEffects: (e: StoryEffect[]) => void; effectName: (id: string) => string;
}) {
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<string>();
  const overlays = Object.values(b.slots).filter((s) => isOverlay(s) && s.implicit !== "background");
  const codes = Object.values(b.slots).filter((s) => s.type === "html");
  const end = Number.isFinite(dur) && dur > 0 ? dur : 5;
  const add = (kind: "text" | "overlay" | "code") => {
    setMenu(false);
    let l: StoryLayer;
    if (kind === "text") l = { id: nextLayerId(layers, "title"), type: "text", text: "Title", startSec: 0, endSec: end, position: { x: 0.5, y: 0.5 } };
    else {
      const a = (kind === "code" ? codes : overlays)[0];
      if (!a) return;
      l = { id: nextLayerId(layers, kind), type: kind === "code" ? "html" : a.type === "video" ? "video" : "image", asset: a.id, box: { ...FULL }, startSec: 0, endSec: end };
    }
    onLayers([...layers, l]);
    setOpen(l.id);
  };
  const set = (i: number, patch: Partial<StoryLayer>) => onLayers(layers.map((x, j) => (j === i ? ({ ...x, ...patch } as StoryLayer) : x)));
  const num = (v: string, fb: number) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? Math.max(0, n) : fb; };
  return (
    <fieldset className="v2-sb-field v2-sb-layers" data-testid="layers-editor">
      <legend>Layers & effects</legend>
      <p className="v2-hint">Layers sit on top of the picture, the last one on top: a title over a black background, a logo, a code animation.</p>
      <ul className="v2-sb-editlist" aria-label="Layers">
        {layers.map((l, i) => {
          const isOpen = open === l.id;
          const name = l.type === "text" ? `Text “${l.text.split("\n").join(" / ")}”` : `${l.type === "html" ? "Code" : "Overlay"} · ${b.slots[l.asset]?.name ?? l.asset}`;
          return (
            <li key={l.id} className={isOpen ? "v2-sb-layer open" : "v2-sb-layer"}>
              <div className="v2-sb-layer-row">
                <button type="button" className="v2-sb-layer-name" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? undefined : l.id)} title="Edit this layer">
                  <Ic g={l.type === "text" ? "T" : l.type === "html" ? "</>" : TYPE_ICON[b.slots[l.asset]?.type ?? "image"] ?? "image"} size={14} /> <span>{name} · {sec(l.startSec)}–{sec(l.endSec)} s</span>
                </button>
                <button type="button" className="v2-icon v2-sb-icon" aria-label={`Remove layer ${i + 1}`} onClick={() => onLayers(layers.filter((x) => x !== l))}><Ic g="✕" size={16} /></button>
              </div>
              {isOpen && (
                <div className="v2-sb-layer-fields">
                  {l.type === "text"
                    ? <label className="v2-sb-field">Text<textarea rows={2} value={l.text} onChange={(e) => set(i, { text: e.target.value })} aria-label={`Layer ${i + 1} text`} /></label>
                    : <label className="v2-sb-field">{l.type === "html" ? "HTML asset" : "Asset"}
                        <select value={l.asset} aria-label={`Layer ${i + 1} asset`} onChange={(e) => { const a = b.slots[e.target.value]; if (a) set(i, { asset: a.id, ...(l.type !== "html" ? { type: a.type === "video" ? "video" : "image" } : {}) } as Partial<StoryLayer>); }}>
                          {(l.type === "html" ? codes : overlays).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select></label>}
                  <div className="v2-sb-row2">
                    <label className="v2-sb-field">From (s)<input inputMode="decimal" value={sec(l.startSec)} onChange={(e) => set(i, { startSec: num(e.target.value, l.startSec) })} aria-label={`Layer ${i + 1} start`} /></label>
                    <label className="v2-sb-field">To (s)<input inputMode="decimal" value={sec(l.endSec)} onChange={(e) => set(i, { endSec: num(e.target.value, l.endSec) })} aria-label={`Layer ${i + 1} end`} /></label>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {effects.map((e, i) => (
          <li key={`e${i}`}>
            <span className="v2-sb-editlist-text"><Ic g="effect" size={14} /> {effectName(e.preset)}{e.startSec !== undefined || e.endSec !== undefined ? ` · ${sec(e.startSec ?? 0)}–${e.endSec === undefined ? "end" : `${sec(e.endSec)} s`}` : ""}</span>
            <button type="button" className="v2-icon v2-sb-icon" aria-label={`Remove effect ${i + 1}`} onClick={() => onEffects(effects.filter((x) => x !== e))}><Ic g="✕" size={16} /></button>
          </li>
        ))}
      </ul>
      {menu ? (
        <div className="v2-sb-addlayer" role="group" aria-label="Add layer">
          <button type="button" className="v2-btn v2-sb-btn" onClick={() => add("text")}><Ic g="T" size={16} /> Text</button>
          <button type="button" className="v2-btn v2-sb-btn" disabled={!overlays.length} title={overlays.length ? "An image or video asset over the picture" : "Add an image or video asset first"} onClick={() => add("overlay")}><Ic g="image" size={16} /> Overlay</button>
          <button type="button" className="v2-btn v2-sb-btn" disabled={!codes.length} title={codes.length ? "An HTML (code) asset over the picture" : "Add an HTML asset first"} onClick={() => add("code")}><Ic g="</>" size={16} /> Code</button>
          <button type="button" className="v2-btn v2-sb-btn" onClick={() => setMenu(false)}>Cancel</button>
        </div>
      ) : <button type="button" className="v2-btn v2-sb-btn" onClick={() => setMenu(true)} aria-haspopup="true"><Ic g="+" size={16} /> Add layer</button>}
      {(layers.length > 0 || effects.length > 0) && <p className="v2-hint">Changes here don’t touch clips already on the timeline; send again to update them.</p>}
    </fieldset>
  );
}

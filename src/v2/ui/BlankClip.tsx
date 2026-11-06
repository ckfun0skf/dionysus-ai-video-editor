/** P36: blank (solid colour) clips — the colour swatches used when adding one and when changing its colour. */
import { useState } from "react";
import { Ic } from "./Icon";

export const BLANK_SWATCHES = ["#000000", "#ffffff", "#1f1f24", "#00ff00", "#0047ff", "#e53935", "#fdd835", "#8e24aa"];

/** Swatch row + a custom colour well; every target is at least 44px. */
export function BlankColorPicker({ value, onChange, label = "Blank clip colour" }: { value: string; onChange: (c: string) => void; label?: string }) {
  return (
    <div className="v2-blank-colors" role="radiogroup" aria-label={label}>
      {BLANK_SWATCHES.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} aria-label={c} title={c} className={`v2-blank-swatch ${value.toLowerCase() === c ? "is-on" : ""}`} onClick={() => onChange(c)}>
          <span style={{ background: c }} />
        </button>
      ))}
      <label className="v2-blank-custom" title="Any colour">
        <input type="color" aria-label="Custom colour" value={value} onChange={(e) => onChange(e.target.value)} />
        <Ic g="palette" size={18} />
      </label>
    </div>
  );
}

/** "Blank" block for Add media / the Photos panel: pick a colour, then add (to main or as an overlay). */
export function BlankAdd({ targets }: { targets: { label: string; title: string; run: (color: string) => void }[] }) {
  const [color, setColor] = useState("#000000");
  return (
    <section className="v2-blank-add" aria-label="Blank clip">
      <h4 className="v2-pick-section">Blank clip</h4>
      <BlankColorPicker value={color} onChange={setColor} />
      <div className="v2-blank-add-btns">
        {targets.map((t) => <button key={t.label} className="v2-btn" title={t.title} onClick={() => t.run(color)}><span className="v2-blank-dot" style={{ background: color }} aria-hidden /> {t.label}</button>)}
      </div>
    </section>
  );
}

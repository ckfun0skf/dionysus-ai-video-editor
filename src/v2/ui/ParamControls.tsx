import type { ParamSpec, Params } from "../registry";

/**
 * Inspector controls generated from a preset's ParamSpec list (V2-FX-MOD): a slider for numbers, a colour well for
 * colours, a text field for strings. A new preset module gets its controls for free; the param `description` is the
 * tooltip. `onBegin`/`onEnd` bracket a drag so it is one undo step.
 */
export function ParamControls({ name, params, values, onChange, onBegin, onEnd }: {
  name: string; params: ParamSpec[]; values: Params;
  onChange: (key: string, value: number | string) => void; onBegin?: () => void; onEnd?: () => void;
}) {
  return (
    <>
      {params.map((s) => {
        const v = values[s.key] ?? s.default;
        if (s.type === "number") return (
          <label key={s.key} className="v2-tp-row" title={s.description}>{s.label} <output>{Number(v).toFixed(2)}</output>
            <input type="range" aria-label={`${name} ${s.label}`} min={s.min} max={s.max} step={s.step ?? 0.01} value={Number(v)}
              onPointerDown={onBegin} onPointerUp={onEnd} onBlur={onEnd} onChange={(e) => onChange(s.key, Number(e.target.value))} />
          </label>
        );
        if (s.type === "color") return (
          <label key={s.key} className="v2-tp-row" title={s.description}>{s.label}
            <input type="color" aria-label={`${name} ${s.label}`} value={String(v)} onChange={(e) => onChange(s.key, e.target.value)} />
          </label>
        );
        return (
          <label key={s.key} className="v2-tp-row" title={s.description}>{s.label}
            <input type="text" aria-label={`${name} ${s.label}`} value={String(v)} onFocus={onBegin} onBlur={onEnd} onChange={(e) => onChange(s.key, e.target.value)} />
          </label>
        );
      })}
    </>
  );
}

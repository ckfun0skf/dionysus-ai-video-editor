import type { ParamSpec, Params } from "../registry";
import { SliderField } from "./SliderField";

interface Base { key: string; label: string; description?: string }
/**
 * A control spec: a registry ParamSpec, or one of the extra kinds an HTML clip may expose (V2-HTML-PARAMS): a number
 * without a range (number field), `text` (same as `string`), `boolean` (switch) and `select` (drop-down).
 */
export type ControlSpec = ParamSpec | (Base & (
  | { type: "number"; min?: number; max?: number; step?: number; default: number }
  | { type: "text"; default: string }
  | { type: "boolean"; default: boolean }
  | { type: "select"; options: string[]; default: string }));
/** What a control reports back: booleans only for specs that can be boolean. */
export type ControlValue<S> = S extends { type: "boolean" } ? boolean : number | string;

/**
 * Inspector controls generated from a param spec list (V2-FX-MOD): a slider for ranged numbers, a number field for
 * open ones, a colour well for colours, a text field for strings, a switch for booleans and a drop-down for selects.
 * A new preset module (or an HTML clip's manifest) gets its controls for free; the param `description` is the
 * tooltip. `onBegin`/`onEnd` bracket a drag or a typing session so it is one undo step. Every control is at least
 * 44px tall for touch.
 */
export function ParamControls<S extends ControlSpec>({ name, params, values, onChange, onBegin, onEnd }: {
  name: string; params: S[]; values: Params | Record<string, number | string | boolean>;
  onChange: (key: string, value: ControlValue<S>) => void; onBegin?: () => void; onEnd?: () => void;
}) {
  const change = onChange as (key: string, value: number | string | boolean) => void;
  return (
    <>
      {params.map((s: ControlSpec) => {
        const v = values[s.key] ?? s.default;
        const aria = `${name} ${s.label}`;
        if (s.type === "number" && s.min !== undefined && s.max !== undefined) {
          const step = s.step ?? 0.01;
          return (
            <SliderField key={s.key} className="v2-tp-sf" title={s.description} label={s.label} aria={aria} min={s.min} max={s.max} step={step} value={Number(v)}
              unit={(s as { unit?: string }).unit} onBegin={onBegin} onEnd={onEnd} onChange={(x) => change(s.key, x)} />
          );
        }
        if (s.type === "number") return (
          <label key={s.key} className="v2-tp-row" title={s.description}>{s.label}
            <input type="number" className="v2-tp-field" aria-label={aria} step={s.step ?? "any"} value={Number(v)} onFocus={onBegin} onBlur={onEnd}
              onChange={(e) => { if (e.target.value !== "" && Number.isFinite(Number(e.target.value))) change(s.key, Number(e.target.value)); }} />
          </label>
        );
        if (s.type === "color") return (
          <label key={s.key} className="v2-tp-row" title={s.description}>{s.label}
            <input type="color" aria-label={aria} value={String(v)} onFocus={onBegin} onBlur={onEnd} onChange={(e) => change(s.key, e.target.value)} />
          </label>
        );
        if (s.type === "boolean") return (
          <div key={s.key} className="v2-tp-row" title={s.description}><span>{s.label}</span>
            <button type="button" role="switch" className="v2-tp-switch" aria-checked={!!v} aria-label={aria} onClick={() => change(s.key, !v)}><span aria-hidden /></button>
          </div>
        );
        if (s.type === "select") return (
          <label key={s.key} className="v2-tp-row" title={s.description}>{s.label}
            <select className="v2-tp-field" aria-label={aria} value={String(v)} onChange={(e) => change(s.key, e.target.value)}>
              {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        );
        return (
          <label key={s.key} className="v2-tp-row" title={s.description}>{s.label}
            <input type="text" className="v2-tp-field" aria-label={aria} value={String(v)} onFocus={onBegin} onBlur={onEnd} onChange={(e) => change(s.key, e.target.value)} />
          </label>
        );
      })}
    </>
  );
}

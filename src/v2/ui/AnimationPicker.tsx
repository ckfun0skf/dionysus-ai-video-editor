import { useState } from "react";
import { cmd, type Engine } from "../engine";
import { text as T, type Placement, type TextData } from "../domain";
import { listPresets, type PresetKind } from "../registry";
import { PresetTile } from "./PresetTile";

const TABS: { id: "In" | "Out" | "Loop"; kind: PresetKind; key: "animIn" | "animOut" | "loop" }[] = [
  { id: "In", kind: "textAnimIn", key: "animIn" },
  { id: "Out", kind: "textAnimOut", key: "animOut" },
  { id: "Loop", kind: "textAnimLoop", key: "loop" },
];
const TPS = 120_000;
export const ANIM_MIN_S = 0.1, ANIM_MAX_S = 2;

/**
 * CapCut-style animation picker (V2-098): In / Out / Loop tabs, a grid of live tiles rendered with the registry's
 * own render functions, and a duration slider. Every pick and slider drag is one undo step.
 */
export function AnimationPicker({ engine, placement, onPicked, onSet }: { engine: Engine; placement: Placement; onPicked?: () => void; /** V2-103 layer mode: route edits to the layer style. */ onSet?: (patch: Partial<TextData>, label?: string) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("In");
  const d = T.textOf(placement.text);
  const cur = TABS.find((t) => t.id === tab)!;
  const set = onSet ?? ((patch: Partial<TextData>, label?: string) => engine.dispatch(cmd.updateText(placement.id, patch, label)));
  const value = d[cur.key] ?? "none";
  const durS = Math.min((d.animTicks ?? 60_000), placement.durationTicks / 2) / TPS;
  return (
    <div className="v2-anim">
      <div className="v2-tp-tabs" role="tablist" aria-label="Animation type">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={t.id === tab} className={`v2-tp-tab ${t.id === tab ? "is-active" : ""}`} onClick={() => setTab(t.id)}>{t.id}{d[t.key] && d[t.key] !== "none" ? " •" : ""}</button>)}
      </div>
      <div className="v2-ptiles" role="radiogroup" aria-label={`${tab} animation`}>
        <PresetTile kind={cur.kind} id="none" label="None" active={value === "none"} animate={false} onPick={() => set({ [cur.key]: "none" }, `${tab} animation`)} />
        {listPresets(cur.kind).map((p) => (
          <PresetTile key={p.id} kind={cur.kind} id={p.id} label={p.name} active={value === p.id} onPick={() => { set({ [cur.key]: p.id }, `${tab} animation: ${p.name}`); onPicked?.(); }} />
        ))}
      </div>
      {tab !== "Loop" && (
        <label className="v2-tp-row">Duration <output>{durS.toFixed(1)}s</output>
          <input type="range" aria-label="Animation duration" min={ANIM_MIN_S} max={ANIM_MAX_S} step={0.1} value={durS}
            onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()}
            onChange={(e) => set({ animTicks: Math.round(Number(e.target.value) * TPS) }, "Animation duration")} />
        </label>
      )}
      {value === "none" && <p className="v2-empty-hint">Pick an animation — tiles preview it live.</p>}
    </div>
  );
}

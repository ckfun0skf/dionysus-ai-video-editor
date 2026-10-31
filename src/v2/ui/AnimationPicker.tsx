import { useState } from "react";
import { useEdgeFade } from "./useEdgeFade";
import { cmd, type Engine } from "../engine";
import { text as T, type Placement, type TextData } from "../domain";
import { defaultsOf, getPreset, listPresets, type PresetKind } from "../registry";
import { ParamControls } from "./ParamControls";
import { PresetTile } from "./PresetTile";
import { SliderField } from "./SliderField";

const TABS: { id: "In" | "Out" | "Loop"; kind: PresetKind; key: "animIn" | "animOut" | "loop"; pkey: "animInParams" | "animOutParams" | "loopParams" }[] = [
  { id: "In", kind: "textAnimIn", key: "animIn", pkey: "animInParams" },
  { id: "Out", kind: "textAnimOut", key: "animOut", pkey: "animOutParams" },
  { id: "Loop", kind: "textAnimLoop", key: "loop", pkey: "loopParams" },
];
const TPS = 120_000;
export const ANIM_MIN_S = 0.1, ANIM_MAX_S = 2;

/**
 * CapCut-style animation picker (V2-098): In / Out / Loop tabs, a grid of live tiles rendered with the registry's
 * own render functions, and a duration slider. Every pick and slider drag is one undo step. V2-SB-130: the picked
 * preset's own params (blur, distance, period…) appear below as controls generated from its ParamSpec.
 */
export function AnimationPicker({ engine, placement, onPicked, onSet }: { engine: Engine; placement: Placement; onPicked?: () => void; /** V2-103 layer mode: route edits to the layer style. */ onSet?: (patch: Partial<TextData>, label?: string) => void }) {
  const tabsFade = useEdgeFade<HTMLDivElement>();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("In");
  const d = T.textOf(placement.text);
  const cur = TABS.find((t) => t.id === tab)!;
  const set = onSet ?? ((patch: Partial<TextData>, label?: string) => engine.dispatch(cmd.updateText(placement.id, patch, label)));
  const value = d[cur.key] ?? "none";
  const desc = getPreset(cur.kind, value);
  // A new pick starts from the new preset's defaults (only clear when there is something to clear).
  const pick = (id: string, label: string) => set({ [cur.key]: id, ...(d[cur.pkey] ? { [cur.pkey]: undefined } : {}) }, label);
  const durS = Math.min((d.animTicks ?? 60_000), placement.durationTicks / 2) / TPS;
  return (
    <div className="v2-anim">
      <div ref={tabsFade} className="v2-tp-tabs" role="tablist" aria-label="Animation type">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={t.id === tab} className={`v2-tp-tab ${t.id === tab ? "is-active" : ""}`} onClick={() => setTab(t.id)}>{t.id}{d[t.key] && d[t.key] !== "none" ? " •" : ""}</button>)}
      </div>
      <div className="v2-ptiles" role="radiogroup" aria-label={`${tab} animation`}>
        <PresetTile kind={cur.kind} id="none" label="None" active={value === "none"} animate={false} onPick={() => pick("none", `${tab} animation`)} />
        {listPresets(cur.kind).map((p) => (
          <PresetTile key={p.id} kind={cur.kind} id={p.id} label={p.name} active={value === p.id} onPick={() => { pick(p.id, `${tab} animation: ${p.name}`); onPicked?.(); }} />
        ))}
      </div>
      {tab !== "Loop" && (
        <SliderField className="v2-tp-sf" label="Duration" aria="Animation duration" min={ANIM_MIN_S} max={ANIM_MAX_S} step={0.1} value={durS} unit="s"
          onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()} onChange={(x) => set({ animTicks: Math.round(x * TPS) }, "Animation duration")} />
      )}
      {desc && desc.params.length > 0 && <ParamControls name={`${tab} ${desc.name}`} params={desc.params} values={defaultsOf(desc, d[cur.pkey])}
        onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()}
        onChange={(k, v) => set({ [cur.pkey]: { ...d[cur.pkey], [k]: v } }, `${tab} animation ${desc.params.find((s) => s.key === k)?.label ?? k}`)} />}
      {value === "none" && <p className="v2-empty-hint">Pick an animation — tiles preview it live.</p>}
    </div>
  );
}

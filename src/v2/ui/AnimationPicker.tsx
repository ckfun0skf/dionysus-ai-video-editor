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
/** P45: raise the cap so Fit duration (slotCount × scramble) is not clamped for longer captions. */
export const ANIM_MIN_S = 0.1, ANIM_MAX_S = 8;
/** Sample text is used on the selected tile when at most this many characters (so newlines stay readable). */
const PREVIEW_TEXT_MAX = 32;

/**
 * CapCut-style animation picker (V2-098): In / Out / Loop tabs, a grid of live tiles rendered with the registry's
 * own render functions, and a duration slider. Every pick and slider drag is one undo step. V2-SB-130: the picked
 * preset's own params (blur, distance, period…) appear below as controls generated from its ParamSpec.
 * P45: selected tile previews with the user's Duration + params; typewriter gets Fit duration + includeBreaks.
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
  // P47: Captions presets apply as modes — word-highlight keeps one cue; word-pop expands to word clips.
  const pick = (id: string, label: string) => {
    if (tab === "In" && id === "word-highlight" && !onSet) {
      engine.dispatch([cmd.setClipCaptionOverride(placement.id, true), cmd.applyWordHighlight(placement.id)], label);
      onPicked?.();
      return;
    }
    if (tab === "In" && id === "word-pop" && !onSet) {
      const entrance = typeof d.animInParams?.entrance === "string" ? d.animInParams.entrance : "pop";
      engine.dispatch([cmd.setClipCaptionOverride(placement.id, true), cmd.expandWordPop(placement.id, entrance)], label);
      onPicked?.();
      return;
    }
    if (tab === "In" && (id === "word-highlight" || id === "word-pop") && onSet) {
      // Edit all: set the mode + default params on the layer style; timings stay per-clip.
      onSet({ animIn: id, animInParams: id === "word-highlight" ? { pendingOpacity: 0.4, highlightColor: "#20d5ec", currentScale: 0.08 } : { entrance: "pop" } }, label);
      onPicked?.();
      return;
    }
    set({ [cur.key]: id, ...(d[cur.pkey] ? { [cur.pkey]: undefined } : {}), ...(tab === "In" && !onSet ? { captionOverride: true } : {}) }, label);
  };
  const halfClipS = placement.durationTicks / 2 / TPS;
  const durS = Math.min((d.animTicks ?? 60_000) / TPS, halfClipS, ANIM_MAX_S);
  const params = desc ? defaultsOf(desc, d[cur.pkey]) : {};
  const cursorGlyphs = typeof params.cursor === "string" ? [...params.cursor] : [];
  const scramble = typeof params.scramble === "number" ? params.scramble : 0;
  const includeBreaks = params.includeBreaks === true;
  const fitAvailable = tab === "In" && value === "typewriter" && cursorGlyphs.length > 1 && scramble > 0;
  const fitNeeded = fitAvailable ? T.typewriterFitDurationSec(d.text, scramble, includeBreaks) : 0;
  const fitHint = fitAvailable && fitNeeded > halfClipS + 1e-6
    ? `Clip is too short for sequential scramble (${fitNeeded.toFixed(2)} s needed; typing uses at most half the clip, ${halfClipS.toFixed(2)} s). Lengthen the clip or shorten Scramble time.`
    : fitAvailable && fitNeeded > ANIM_MAX_S + 1e-6
      ? `Fit duration needs ${fitNeeded.toFixed(2)} s; the Duration slider tops out at ${ANIM_MAX_S} s. Shorten the text or Scramble time.`
      : undefined;
  const fitDuration = () => {
    if (!fitAvailable) return;
    const sec = Math.min(ANIM_MAX_S, Math.max(ANIM_MIN_S, fitNeeded || ANIM_MIN_S));
    set({ animTicks: Math.round(sec * TPS) }, "Fit typewriter duration");
  };
  const clipText = d.text?.trim() ?? "";
  const selectedSample = clipText.length > 0 && clipText.length <= PREVIEW_TEXT_MAX ? clipText : undefined;
  return (
    <div className="v2-anim">
      <div ref={tabsFade} className="v2-tp-tabs" role="tablist" aria-label="Animation type">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={t.id === tab} className={`v2-tp-tab ${t.id === tab ? "is-active" : ""}`} onClick={() => setTab(t.id)}>{t.id}{d[t.key] && d[t.key] !== "none" ? " •" : ""}</button>)}
      </div>
      <div className="v2-ptiles" role="radiogroup" aria-label={`${tab} animation`}>
        <PresetTile kind={cur.kind} id="none" label="None" active={value === "none"} animate={false} onPick={() => pick("none", `${tab} animation`)} />
        {listPresets(cur.kind).map((p) => {
          const active = value === p.id;
          return (
            <PresetTile key={p.id} kind={cur.kind} id={p.id} label={p.name} active={active}
              durationSec={active && tab !== "Loop" ? Math.max(ANIM_MIN_S, durS) : undefined}
              params={active ? params : undefined}
              sample={active ? selectedSample : undefined}
              onPick={() => { pick(p.id, `${tab} animation: ${p.name}`); onPicked?.(); }} />
          );
        })}
      </div>
      {tab !== "Loop" && (
        <SliderField className="v2-tp-sf" label="Duration" aria="Animation duration" min={ANIM_MIN_S} max={ANIM_MAX_S} step={0.1} value={durS} unit="s"
          onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()} onChange={(x) => set({ animTicks: Math.round(x * TPS) }, "Animation duration")}
          extra={fitAvailable ? <button type="button" className="v2-btn v2-anim-fit" aria-label="Fit duration" title={`Set Duration to ${T.typingSlotCount(d.text, includeBreaks)} × Scramble time so each character finishes before the next starts`} onClick={fitDuration}>Fit duration</button> : undefined} />
      )}
      {fitHint && <p className="v2-empty-hint" role="status">{fitHint}</p>}
      {desc && desc.params.length > 0 && <ParamControls name={`${tab} ${desc.name}`} params={desc.params} values={params}
        onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()}
        onChange={(k, v) => set({ [cur.pkey]: { ...d[cur.pkey], [k]: v } }, `${tab} animation ${desc.params.find((s) => s.key === k)?.label ?? k}`)} />}
      {value === "none" && <p className="v2-empty-hint">Pick an animation — tiles preview it live.</p>}
    </div>
  );
}

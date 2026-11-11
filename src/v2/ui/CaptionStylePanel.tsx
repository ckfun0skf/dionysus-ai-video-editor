/**
 * P60: track-level Caption style (none / word-highlight / word-pop), three-state
 * highlight editors, Align all with AI, and a per-clip "Use track style" reset.
 */
import { useEffect, useState } from "react";
import { cmd, type Engine } from "../engine";
import { captions, text as T, type Placement, type Track } from "../domain";
import type { CaptionMode, WordPhaseStyle } from "../domain";
import { Ic } from "./Icon";
import { SliderField } from "./SliderField";

const TPS = 120_000;
const MODES: { id: CaptionMode; label: string; icon: string; hint: string }[] = [
  { id: "none", label: "None", icon: "caption-none", hint: "Clips keep their own animations. New clips on this track are not word-styled." },
  { id: "word-highlight", label: "Word highlight", icon: "word-highlight", hint: "The whole line stays on screen. Pending, current and spoken words each have their own look." },
  { id: "word-pop", label: "Word pop", icon: "word-pop", hint: "Each word becomes its own short clip and pops (or fades / slides) in." },
];
const WEIGHTS = [
  { value: 0, label: "Match clip" },
  { value: 400, label: "400" },
  { value: 500, label: "500" },
  { value: 600, label: "600" },
  { value: 700, label: "700" },
  { value: 800, label: "800" },
  { value: 900, label: "900" },
];
const PHASES: { key: "pending" | "current" | "spoken"; label: string; hint: string }[] = [
  { key: "pending", label: "Pending", hint: "Not yet reached" },
  { key: "current", label: "Current", hint: "Being spoken" },
  { key: "spoken", label: "Spoken", hint: "Already passed" },
];

function audioNearTrack(engine: Engine, track: Track): { id: string; name: string; durationTicks: number }[] {
  const p = engine.getState().project;
  const root = p.compositions[p.rootCompositionId];
  const cues = track.placements.filter((x) => x.clipType === "text");
  if (!cues.length) return [];
  const start = Math.min(...cues.map((c) => c.startTicks));
  const end = Math.max(...cues.map((c) => c.startTicks + c.durationTicks));
  const out: { id: string; name: string; durationTicks: number }[] = [];
  for (const tr of root.tracks) {
    if (tr.kind !== "audio" && tr.kind !== "video") continue;
    for (const pl of tr.placements) {
      if (pl.clipType !== "audio" && pl.clipType !== "video") continue;
      if (pl.startTicks + pl.durationTicks <= start || pl.startTicks >= end) continue;
      const assetId = pl.source.kind === "assetVersion" ? pl.source.assetId : "";
      const asset = assetId ? p.assets[assetId] : undefined;
      out.push({ id: pl.id, name: asset?.name || tr.name || pl.id, durationTicks: pl.durationTicks });
    }
  }
  return out;
}

export function CaptionStylePanel({
  engine, track, placement,
}: {
  engine: Engine;
  track: Track;
  placement?: Placement;
}) {
  const style = track.captionStyle ?? { mode: "none" as const };
  const mode = style.mode ?? "none";
  const resolved = placement ? captions.resolveCaption(track, placement) : undefined;
  const overrides = !!(placement && placement.text?.captionOverride);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string>();
  const [copied, setCopied] = useState(false);
  const audio = audioNearTrack(engine, track);
  const [audioId, setAudioId] = useState(audio[0]?.id ?? "");
  useEffect(() => { if (audio[0] && !audio.some((a) => a.id === audioId)) setAudioId(audio[0].id); }, [audio, audioId]);

  const setStyle = (next: typeof style, label = "Caption style") => {
    engine.dispatch(cmd.setTrackCaptionStyle(track.id, next, label));
  };

  const setHighlight = (phase: "pending" | "current" | "spoken", patch: WordPhaseStyle | undefined, label: string) => {
    const prev = style.highlight?.[phase] ?? {};
    const merged = patch ? { ...prev, ...patch } : undefined;
    const highlight = { ...style.highlight };
    if (!merged || (merged.color === undefined && merged.opacity === undefined && merged.scale === undefined && merged.weight === undefined)) {
      delete highlight[phase];
    } else {
      highlight[phase] = merged;
    }
    setStyle({ ...style, mode: mode === "none" ? "word-highlight" : mode, highlight }, label);
  };

  const copyAlignPrompt = async () => {
    const cues = captions.trackCaptionCues(track);
    if (!cues.length) { setMsg("This track has no captions yet."); return; }
    const a = audio.find((x) => x.id === audioId);
    const prompt = captions.trackWordAlignPrompt({
      cues,
      ...(a ? { audioDurationSec: a.durationTicks / TPS, audioName: a.name } : {}),
    });
    try { await navigator.clipboard.writeText(prompt); } catch { /* shown below */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setMsg("Prompt copied — paste into your AI, then Paste reply here.");
  };

  const applyPaste = () => {
    const parsed = captions.parseTrackWordsJson(paste);
    if (!parsed.ok) { setMsg(parsed.error); return; }
    const matched = captions.matchTrackWordUpdates(track, parsed.cues);
    if (!matched.ok) { setMsg(matched.error); return; }
    engine.dispatch(cmd.setTrackCaptionWords(track.id, matched.updates));
    setPasteOpen(false);
    setPaste("");
    setMsg(`Applied timings to ${matched.updates.length} cue${matched.updates.length === 1 ? "" : "s"}`);
  };

  const clipColor = placement ? T.textOf(placement.text).color : "#ffffff";

  return (
    <div className="v2-caption-style" data-testid="caption-style-panel" aria-label="Caption style">
      <p className="v2-caption-lead">Applies to every clip on <b>{track.name}</b>, including ones you add or paste later.</p>

      <div className="v2-caption-modes" role="radiogroup" aria-label="Caption style">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={mode === m.id}
            className={`v2-caption-mode ${mode === m.id ? "is-active" : ""}`}
            data-testid={`caption-mode-${m.id}`}
            title={m.hint}
            onClick={() => setStyle({ ...style, mode: m.id }, `Caption style: ${m.label}`)}>
            <Ic g={m.icon} size={20} />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <p className="v2-caption-hint">{MODES.find((m) => m.id === mode)?.hint}</p>

      {mode === "word-pop" && (
        <label className="v2-caption-row">Entrance
          <select aria-label="Word pop entrance" value={style.entrance ?? "pop"}
            onChange={(e) => setStyle({ ...style, mode: "word-pop", entrance: e.target.value as "pop" | "fade" | "slide-up" }, "Caption entrance")}>
            <option value="pop">Pop</option>
            <option value="fade">Fade</option>
            <option value="slide-up">Slide up</option>
          </select>
        </label>
      )}

      {mode === "word-highlight" && (
        <div className="v2-caption-phases" aria-label="Word highlight styles">
          {PHASES.map((ph) => {
            const st = style.highlight?.[ph.key] ?? {};
            const fallback = captions.DEFAULT_HIGHLIGHT[ph.key];
            const color = st.color ?? (ph.key === "current" ? (fallback.color ?? "#20d5ec") : clipColor);
            const inherit = !st.color && ph.key !== "current";
            return (
              <section key={ph.key} className="v2-caption-phase" aria-label={ph.label}>
                <header>
                  <strong>{ph.label}</strong>
                  <span>{ph.hint}</span>
                </header>
                <label className="v2-tp-row v2-tp-color">Colour
                  <span className="v2-color-val">
                    <code>{inherit ? "Clip" : color.toUpperCase()}</code>
                    <input type="color" aria-label={`${ph.label} colour`} value={color}
                      onFocus={() => engine.beginGesture()} onBlur={() => engine.endGesture()}
                      onChange={(e) => setHighlight(ph.key, { color: e.target.value }, `${ph.label} colour`)} />
                  </span>
                </label>
                {ph.key !== "current" && (
                  <button type="button" className="v2-btn v2-caption-inherit" aria-pressed={inherit}
                    onClick={() => setHighlight(ph.key, { color: undefined }, `${ph.label} clip colour`)}>
                    Use clip colour
                  </button>
                )}
                <SliderField className="v2-tp-sf" label="Opacity" aria={`${ph.label} opacity`} min={0} max={1} step={0.05}
                  value={st.opacity ?? fallback.opacity ?? 1}
                  onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()}
                  onChange={(v) => setHighlight(ph.key, { opacity: v }, `${ph.label} opacity`)} />
                <SliderField className="v2-tp-sf" label="Scale" aria={`${ph.label} scale`} min={0} max={0.5} step={0.01}
                  value={st.scale ?? fallback.scale ?? 0} unit="%" scale={100}
                  onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()}
                  onChange={(v) => setHighlight(ph.key, { scale: v }, `${ph.label} scale`)} />
                <label className="v2-caption-row">Weight
                  <select aria-label={`${ph.label} weight`} value={st.weight ?? 0}
                    onChange={(e) => setHighlight(ph.key, { weight: Number(e.target.value) || undefined }, `${ph.label} weight`)}>
                    {WEIGHTS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                  </select>
                </label>
              </section>
            );
          })}
        </div>
      )}

      {placement && track.captionStyle && (
        <div className="v2-caption-clip" role="status">
          {overrides || (resolved && !resolved.followsTrack)
            ? <>This clip overrides the track style.
                <button type="button" className="v2-btn primary" data-testid="use-track-caption-style"
                  title="Drop this clip's own caption style so it follows the track again"
                  onClick={() => { engine.dispatch(cmd.resetClipCaptionStyle(placement.id)); setMsg("This clip now uses the track Caption style"); }}>
                  Use track style
                </button>
              </>
            : <>This clip follows the track Caption style.</>}
        </div>
      )}

      <div className="v2-caption-align" aria-label="Align all with AI">
        <h4>Align all with AI</h4>
        <p className="v2-caption-hint">One prompt for every cue on this track. Paste back a single JSON covering all of them. Per-clip Even split and Align with AI still work in the text inspector.</p>
        <div className="v2-words-toolbar">
          <button type="button" className="v2-btn" aria-label="Align all with AI" data-testid="align-all-ai"
            title="Copy a prompt listing every cue, then paste the AI's JSON"
            onClick={() => setPasteOpen((v) => !v)}>{pasteOpen ? "Hide AI" : "Align all with AI"}</button>
        </div>
        {pasteOpen && (
          <div className="v2-words-ai" role="region" aria-label="Align all with AI">
            {audio.length > 0 && (
              <label className="v2-words-audio">Narration
                <select aria-label="Narration audio" value={audioId} onChange={(e) => setAudioId(e.target.value)}>
                  {audio.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
            <div className="v2-words-ai-actions">
              <button type="button" className="v2-btn" onClick={() => void copyAlignPrompt()}><Ic g="⎘" size={16} /> {copied ? "Copied" : "Copy prompt"}</button>
            </div>
            <textarea className="v2-words-paste" aria-label="Paste track words JSON" rows={5}
              placeholder={'Paste {"cues":[{"id":"…","words":[{"text":"Hello","atSec":0.12}, ...]}, ...]}'}
              value={paste} onChange={(e) => setPaste(e.target.value)} />
            <button type="button" className="v2-btn primary" disabled={!paste.trim()} onClick={applyPaste}>Apply timings</button>
          </div>
        )}
      </div>

      {msg && <p className="v2-cue-msg" role="status" onClick={() => setMsg(undefined)}>{msg}</p>}
    </div>
  );
}

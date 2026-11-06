/**
 * P47: first-class word-timing editor for captions.
 * Word chips (≥44px), a draggable timing ruler, nudge −/+, Even split, Align with AI (copy/paste),
 * and play/pause so the main preview stays in sync while the sheet is open.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cmd, type Engine } from "../engine";
import { text as T, words as W, type Placement, type WordTiming } from "../domain";
import { Ic } from "./Icon";

const TPS = 120_000;

function audioClipsNear(engine: Engine, cue: Placement): { id: string; name: string; startTicks: number; durationTicks: number }[] {
  const p = engine.getState().project;
  const root = p.compositions[p.rootCompositionId];
  const cueEnd = cue.startTicks + cue.durationTicks;
  const out: { id: string; name: string; startTicks: number; durationTicks: number }[] = [];
  for (const tr of root.tracks) {
    if (tr.kind !== "audio" && tr.kind !== "video") continue;
    for (const pl of tr.placements) {
      if (pl.clipType !== "audio" && pl.clipType !== "video") continue;
      const end = pl.startTicks + pl.durationTicks;
      if (end <= cue.startTicks || pl.startTicks >= cueEnd) continue;
      const assetId = pl.source.kind === "assetVersion" ? pl.source.assetId : "";
      const asset = assetId ? p.assets[assetId] : undefined;
      out.push({ id: pl.id, name: asset?.name || tr.name || pl.id, startTicks: pl.startTicks, durationTicks: pl.durationTicks });
    }
  }
  return out.sort((a, b) => a.startTicks - b.startTicks);
}

export function WordTimingEditor({
  engine, placement, time, playing, onSeek, onTogglePlay, desktop,
}: {
  engine: Engine;
  placement: Placement;
  time: number;
  playing: boolean;
  onSeek: (ticks: number) => void;
  onTogglePlay?: () => void;
  desktop?: boolean;
}) {
  const d = T.textOf(placement.text);
  const durSec = placement.durationTicks / TPS;
  const list = d.words ?? [];
  const localT = Math.max(0, (time - placement.startTicks) / TPS);
  const active = W.wordIndexAt(list, localT);
  const [selected, setSelected] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string>();
  const [copied, setCopied] = useState(false);
  const rulerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; x0: number; at0: number }>();

  useEffect(() => {
    if (active >= 0) setSelected(active);
  }, [active]);

  const setWords = (next: WordTiming[], label = "Edit word timings") => {
    engine.dispatch(cmd.setCueWords(placement.id, next), label);
  };

  const ensureWords = () => {
    if (list.length) return list;
    engine.dispatch(cmd.evenSplitCueWords(placement.id));
    return W.evenSplitWords(d.text, durSec);
  };

  const seekWord = (i: number, words = list) => {
    if (i < 0 || i >= words.length) return;
    setSelected(i);
    onSeek(placement.startTicks + Math.round(words[i].atSec * TPS));
  };

  const nudge = (delta: number) => {
    const words = ensureWords();
    const i = Math.min(selected, words.length - 1);
    const next = W.nudgeWordAt(words, i, delta, durSec);
    setWords(next, "Nudge word timing");
    seekWord(i, next);
  };

  const onChipPointer = (i: number) => {
    const words = ensureWords();
    seekWord(i, words);
  };

  const pxPerSec = useMemo(() => {
    // Fit the cue into ~280–520px, min 40px/s so short cues stay draggable.
    const base = desktop ? 420 : 300;
    return Math.max(40, base / Math.max(0.5, durSec));
  }, [durSec, desktop]);

  const onRulerDown = (e: React.PointerEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const words = ensureWords();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    engine.beginGesture();
    drag.current = { index, x0: e.clientX, at0: words[index]?.atSec ?? 0 };
    setSelected(index);
    seekWord(index, words);
  };
  const onRulerMove = (e: React.PointerEvent) => {
    const g = drag.current; if (!g) return;
    const words = ensureWords();
    const dx = e.clientX - g.x0;
    const at = g.at0 + dx / pxPerSec;
    const next = W.setWordAtSec(words, g.index, at, durSec);
    setWords(next);
    onSeek(placement.startTicks + Math.round(next[g.index].atSec * TPS));
  };
  const onRulerUp = () => {
    if (!drag.current) return;
    drag.current = undefined;
    engine.endGesture();
  };

  const audio = audioClipsNear(engine, placement);
  const [audioId, setAudioId] = useState(audio[0]?.id ?? "");
  useEffect(() => { if (audio[0] && !audio.some((a) => a.id === audioId)) setAudioId(audio[0].id); }, [audio, audioId]);

  const copyAlignPrompt = async () => {
    const a = audio.find((x) => x.id === audioId);
    const prompt = W.wordAlignPrompt({
      text: d.text,
      cueDurationSec: durSec,
      ...(a ? { audioDurationSec: a.durationTicks / TPS, audioName: a.name } : {}),
    });
    try { await navigator.clipboard.writeText(prompt); } catch { /* shown below */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setMsg("Prompt copied — paste into your AI, then Paste reply here.");
  };

  const applyPaste = () => {
    const r = W.parseWordsJson(paste);
    if (!r.ok) { setMsg(r.error); return; }
    const next = W.clampWordTimes(r.words, durSec);
    setWords(next, "Paste word timings");
    setPasteOpen(false);
    setPaste("");
    setMsg(`Applied ${next.length} word timing${next.length === 1 ? "" : "s"}`);
    if (next[0]) seekWord(0, next);
  };

  const hasWords = list.length > 0;
  const sel = Math.min(selected, Math.max(0, list.length - 1));

  return (
    <div className={`v2-words ${desktop ? "is-desktop" : ""}`} aria-label="Word timings">
      <div className="v2-words-toolbar">
        <button type="button" className="v2-btn" aria-label="Even split" title="Space words evenly across the cue" onClick={() => { engine.dispatch(cmd.evenSplitCueWords(placement.id)); setMsg("Even split applied"); }}>Even split</button>
        <button type="button" className="v2-btn" aria-label="Align with AI" title="Copy a prompt for any AI, then paste its words JSON" onClick={() => setPasteOpen((v) => !v)}>{pasteOpen ? "Hide AI" : "Align with AI"}</button>
        {onTogglePlay && (
          <button type="button" className="v2-icon" aria-label={playing ? "Pause" : "Play cue"} title={playing ? "Pause" : "Play this cue"}
            onClick={() => { if (!playing) onSeek(placement.startTicks); onTogglePlay(); }}>
            <Ic g={playing ? "❚❚" : "▶"} size={18} />
          </button>
        )}
      </div>

      {pasteOpen && (
        <div className="v2-words-ai" role="region" aria-label="Align with AI">
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
          <textarea className="v2-words-paste" aria-label="Paste words JSON" rows={4} placeholder={'Paste {"words":[{"text":"Hello","atSec":0.12}, ...]}'} value={paste} onChange={(e) => setPaste(e.target.value)} />
          <button type="button" className="v2-btn primary" disabled={!paste.trim()} onClick={applyPaste}>Apply timings</button>
        </div>
      )}

      {msg && <p className="v2-cue-msg" role="status" onClick={() => setMsg(undefined)}>{msg}</p>}

      {!hasWords && (
        <p className="v2-empty-hint">No word timings yet. Tap Even split, or Align with AI, then drag the blocks to fine-tune.</p>
      )}

      <div className="v2-word-chips" role="listbox" aria-label="Words">
        {(hasWords ? list : W.tokenizeWords(d.text).map((text, i) => ({ text, atSec: 0, i }))).map((w, i) => {
          const on = hasWords && i === active;
          const selOn = hasWords && i === sel;
          return (
            <button key={`${w.text}-${i}`} type="button" role="option" aria-selected={selOn}
              className={`v2-word-chip ${on ? "is-active" : ""} ${selOn ? "is-selected" : ""}`}
              onClick={() => onChipPointer(i)}>
              <span className="v2-word-chip-text">{w.text}</span>
              {hasWords && <span className="v2-word-chip-t">{(w as WordTiming).atSec.toFixed(2)}s</span>}
            </button>
          );
        })}
      </div>

      {hasWords && (
        <>
          <div className="v2-word-ruler-wrap" ref={rulerRef}>
            <div className="v2-word-ruler" style={{ width: Math.max(pxPerSec * durSec, 200) }} aria-label="Word timing ruler"
              onPointerMove={onRulerMove} onPointerUp={onRulerUp} onPointerCancel={onRulerUp}>
              <div className="v2-word-ruler-track" />
              <div className="v2-word-playhead" style={{ left: `${Math.min(durSec, Math.max(0, localT)) * pxPerSec}px` }} aria-hidden />
              {list.map((w, i) => {
                const next = i + 1 < list.length ? list[i + 1].atSec : durSec;
                const width = Math.max(24, (next - w.atSec) * pxPerSec);
                return (
                  <button key={i} type="button"
                    className={`v2-word-block ${i === active ? "is-active" : ""} ${i === sel ? "is-selected" : ""}`}
                    style={{ left: `${w.atSec * pxPerSec}px`, width }}
                    aria-label={`Move ${w.text} timing`}
                    title={`${w.text} @ ${w.atSec.toFixed(2)}s — drag to adjust`}
                    onPointerDown={(e) => onRulerDown(e, i)}
                    onPointerMove={onRulerMove}
                    onPointerUp={onRulerUp}>
                    <span>{w.text}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="v2-word-nudge">
            <button type="button" className="v2-icon" aria-label="Word earlier" title={`−${W.WORD_STEP_SEC}s`} disabled={!hasWords} onClick={() => nudge(-W.WORD_STEP_SEC)}><Ic g="⇤" size={18} /></button>
            <label className="v2-word-at">
              <span>at</span>
              <input type="number" step={W.WORD_STEP_SEC} min={0} max={durSec} aria-label="Word time seconds"
                value={list[sel]?.atSec ?? 0}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v)) return;
                  const next = W.setWordAtSec(list, sel, v, durSec);
                  setWords(next);
                  seekWord(sel, next);
                }} />
              <span>s</span>
            </label>
            <button type="button" className="v2-icon" aria-label="Word later" title={`+${W.WORD_STEP_SEC}s`} disabled={!hasWords} onClick={() => nudge(W.WORD_STEP_SEC)}><Ic g="⏭" size={18} /></button>
          </div>
        </>
      )}
    </div>
  );
}

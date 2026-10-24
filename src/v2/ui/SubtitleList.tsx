/**
 * V2-104: CapCut-style subtitle list editor for one text layer. One row per cue: editable start/end,
 * inline text, + after / split at cursor / merge with next / delete. Find & replace across the layer,
 * Export SRT. Tap a row to seek; typing previews live; one undo step per text session (blur) or op.
 */
import { useEffect, useRef, useState } from "react";
import { cmd, type Engine } from "../engine";
import { cues as cueOps, newId, type Track } from "../domain";
import { Ic } from "./Icon";
import { SheetDone } from "./Sheet";

export function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-subrip" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name || "subtitles"}.srt` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Tc({ value, label, onCommit }: { value: number; label: string; onCommit: (t: number) => void }) {
  const [draft, setDraft] = useState<string>();
  const commit = () => { if (draft !== undefined) { const t = cueOps.parseTc(draft); if (t !== undefined) onCommit(t); setDraft(undefined); } };
  return <input className="v2-cue-tc" aria-label={label} title={`${label} (mm:ss.mmm) — Enter to apply`} inputMode="decimal" value={draft ?? cueOps.fmtTc(value)}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setDraft(undefined); }} />;
}

export function SubtitleList({ engine, track, time, playing, onSeek, desktop, name, focusCue, onDone }: { engine: Engine; track: Track; time: number; playing: boolean; onSeek: (t: number) => void; desktop: boolean; name: string; focusCue?: string; onDone?: () => void }) {
  const list = cueOps.cuesOf(track);
  const active = cueOps.activeCue(track, time);
  const rowsRef = useRef<HTMLDivElement>(null);
  const caret = useRef<Record<string, number>>({});
  const [find, setFind] = useState(""); const [repl, setRepl] = useState(""); const [frOpen, setFrOpen] = useState(false); const [msg, setMsg] = useState<string>();
  const matches = cueOps.countMatches(track, find);

  // Keep the active cue in view during playback.
  useEffect(() => {
    if (!playing || !active) return;
    rowsRef.current?.querySelector<HTMLElement>(`[data-cue="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, playing]);

  // V2-105: opened from a selected clip → scroll to that line and jump the playhead there.
  const [target, setTarget] = useState(focusCue);
  useEffect(() => {
    setTarget(focusCue);
    const c = focusCue && list.find((x) => x.id === focusCue);
    if (!c) return;
    onSeek(c.startTicks);
    requestAnimationFrame(() => rowsRef.current?.querySelector<HTMLElement>(`[data-cue="${focusCue}"]`)?.scrollIntoView?.({ block: "center" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCue, track.id]);

  const focusRow = (id: string) => requestAnimationFrame(() => rowsRef.current?.querySelector<HTMLTextAreaElement>(`[data-cue="${id}"] textarea`)?.focus());
  const addAfter = (id: string) => { const n = newId("plc"); const before = engine.getState().project; engine.dispatch(cmd.addCueAfter(id, n)); if (engine.getState().project === before) setMsg("No room after this subtitle — shorten it or move the next one"); else focusRow(n); };
  const caretOf = (id: string) => { const el = rowsRef.current?.querySelector<HTMLTextAreaElement>(`[data-cue="${id}"] textarea`); return el && document.activeElement === el ? el.selectionStart : caret.current[id] ?? 0; };
  const split = (id: string) => { const n = newId("plc"); const before = engine.getState().project; engine.dispatch(cmd.splitCue(id, caretOf(id), n)); if (engine.getState().project === before) setMsg("Put the text cursor between words to split"); };
  const replaceAll = () => { if (!matches) return; engine.dispatch(cmd.replaceInLayer(track.id, find, repl)); setMsg(`Replaced ${matches} match${matches === 1 ? "" : "es"} (Undo to revert)`); };

  return (
    <section className="v2-cuelist" aria-label={`Edit subtitles: ${track.name}`}>
      <div className="v2-panel-head v2-cuelist-head">
        <strong title="Edit subtitles">Subtitles · {list.length}</strong>
        <span className="v2-cuelist-actions">
          <button className="v2-icon" aria-label="Undo" title="Undo (⌘/Ctrl+Z)" disabled={!engine.getState().canUndo} onPointerDown={(e) => e.preventDefault()} onClick={() => { (document.activeElement as HTMLElement | null)?.blur?.(); engine.undo(); }}><Ic g="↶" size={18} /></button>
          <button className="v2-icon" aria-label="Redo" title="Redo (⇧⌘/Ctrl+Shift+Z)" disabled={!engine.getState().canRedo} onClick={() => engine.redo()}><Ic g="↷" size={18} /></button>
          <button className={`v2-icon ${frOpen ? "is-on" : ""}`} aria-pressed={frOpen} aria-label="Find and replace" title="Find & replace in every subtitle on this layer" onClick={() => setFrOpen(!frOpen)}><Ic g="⤢" size={18} /></button>
          <button className="v2-icon v2-cue-export" aria-label="Export SRT" title="Download this layer as an .srt file" disabled={!list.length} onClick={() => downloadText(cueOps.layerToSrt(track), name)}><Ic g="⇩" size={18} /></button>
          {onDone && <SheetDone onClick={onDone} />}
        </span>
      </div>
      {frOpen && <div className="v2-findrep">
        <input aria-label="Find" placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
        <input aria-label="Replace with" placeholder="Replace with" value={repl} onChange={(e) => setRepl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") replaceAll(); }} />
        <button className="v2-btn" disabled={!matches} title={matches ? `Replace all ${matches}` : "No matches"} onClick={replaceAll}>Replace all{find ? ` (${matches})` : ""}</button>
      </div>}
      {msg && <p className="v2-cue-msg" role="status" onClick={() => setMsg(undefined)}>{msg}</p>}
      {!list.length && <p className="v2-empty-hint">No subtitles on this layer yet. Import an SRT file or add text.</p>}
      <div className="v2-cuerows" ref={rowsRef}>
        {list.map((c, i) => (
          <div key={c.id} data-cue={c.id} className={`v2-cue ${c.id === active ? "is-active" : ""} ${c.id === target ? "is-target" : ""}`} onPointerDown={(e) => { setTarget(undefined); if (!(e.target as HTMLElement).closest("button,input")) onSeek(c.startTicks); }}>
            <div className="v2-cue-times">
              <span className="v2-cue-n">{i + 1}</span>
              <Tc label={`Start of subtitle ${i + 1}`} value={c.startTicks} onCommit={(s) => engine.dispatch(cmd.setCueTimes(c.id, s, c.startTicks + c.durationTicks))} />
              <span aria-hidden>→</span>
              <Tc label={`End of subtitle ${i + 1}`} value={c.startTicks + c.durationTicks} onCommit={(e) => engine.dispatch(cmd.setCueTimes(c.id, c.startTicks, e))} />
            </div>
            <textarea className="v2-cue-text" aria-label={`Subtitle ${i + 1} text`} rows={Math.min(3, c.text.split("\n").length)} value={c.text}
              onFocus={() => { engine.beginGesture(); onSeek(c.startTicks); }} onBlur={(e) => { caret.current[c.id] = e.target.selectionStart; engine.endGesture(); }}
              onSelect={(e) => { caret.current[c.id] = (e.target as HTMLTextAreaElement).selectionStart; }}
              onChange={(e) => { caret.current[c.id] = e.target.selectionStart; engine.dispatch(cmd.setCueText(c.id, e.target.value)); }}
              onKeyDown={(e) => { if (desktop && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const nx = list[i + 1]; if (nx) focusRow(nx.id); else (e.target as HTMLTextAreaElement).blur(); } }} />
            <div className="v2-cue-ops">
              <button className="v2-icon" aria-label={`Add subtitle after ${i + 1}`} title="Add a subtitle after this one" onClick={() => addAfter(c.id)}><Ic g="＋" size={16} /></button>
              <button className="v2-icon" aria-label={`Split subtitle ${i + 1} at cursor`} title="Split at the text cursor (time divides by characters)" onPointerDown={(e) => e.preventDefault()} onClick={() => split(c.id)}><Ic g="✂" size={16} /></button>
              <button className="v2-icon" aria-label={`Merge subtitle ${i + 1} with next`} title="Merge with the next subtitle" disabled={!list[i + 1]} onClick={() => engine.dispatch(cmd.mergeCueNext(c.id))}><Ic g="⧓" size={16} /></button>
              <button className="v2-icon v2-danger-icon" aria-label={`Delete subtitle ${i + 1}`} title="Delete this subtitle" onClick={() => engine.dispatch(cmd.deleteCue(c.id))}><Ic g="🗑" size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

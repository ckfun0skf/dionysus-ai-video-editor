import { useId, useRef, useState } from "react";
import { Ic } from "./Icon";
import { cmd, type Engine } from "../engine";
import { newId, secondsToTicks, subs, ticksToSeconds, type Subtitle } from "../domain";

export const DEFAULT_CUE_TICKS = secondsToTicks(3);

/** Add a cue at the playhead; returns its id, or undefined when another cue is already there. */
export function addCueAt(engine: Engine, time: number): string | undefined {
  const id = newId("sub");
  const before = engine.getState().project;
  engine.dispatch(cmd.addSubtitle({ id, startTicks: Math.round(time), durationTicks: DEFAULT_CUE_TICKS, text: "Text" }));
  return engine.getState().project === before ? undefined : id;
}

export async function importSrtFile(engine: Engine, file: File, trackId?: string): Promise<number> {
  const list = subs.parseSrt(await file.text());
  if (list.length) engine.dispatch(cmd.importSrtLayer(list, trackId));
  return list.length;
}

/** P36: import pasted SRT / VTT text as a new text layer (or onto trackId); returns the cue count. */
export function importSrtText(engine: Engine, text: string, trackId?: string): number {
  const list = subs.parseSrt(text);
  if (list.length) engine.dispatch(cmd.importSrtLayer(list, trackId));
  return list.length;
}

/** P36 / P50: Import SRT — the paste box is always shown (no clipboard permission). Choose file is optional. */
export function SubtitleImport({ onPasteImport, onChooseFile, onClose }: { onPasteImport: (text: string) => void; onChooseFile: () => void; onClose: () => void }) {
  const fieldId = useId();
  const [text, setText] = useState("");
  const n = text.trim() ? subs.parseSrt(text).length : 0;
  const canPaste = typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";
  const confirm = () => { if (n) onPasteImport(text); };
  return (
    <div className="v2-subimport" role="dialog" aria-modal="true" aria-label="Import SRT">
      <header className="v2-subimport-head">
        <button type="button" className="v2-icon-btn" aria-label="Cancel" title="Cancel (Esc)" onClick={onClose}><Ic g="✕" /></button>
        <h3>Import SRT</h3>
        <button type="button" className="v2-icon-btn" aria-label="Import pasted subtitles" title="Import the pasted text as a new text layer" disabled={!n} onClick={confirm}><Ic g="✓" /></button>
      </header>
      <label className="v2-subimport-label" htmlFor={fieldId}>Paste SRT or VTT</label>
      <textarea id={fieldId} className="v2-subimport-text" aria-label="Paste SRT or VTT subtitles" placeholder={"1\n00:00:01,000 --> 00:00:03,000\nHello"} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} />
      <div className="v2-subimport-foot">
        <span role="status" className={text.trim() && !n ? "v2-err" : "v2-muted"}>{!text.trim() ? "Paste or type into the box above. Clipboard permission is not required." : n ? `${n} subtitle${n === 1 ? "" : "s"} found` : "No subtitles found: each needs a 00:00:01,000 --> 00:00:03,000 line"}</span>
        {canPaste && <button type="button" className="v2-btn" onClick={() => void navigator.clipboard.readText().then(setText, () => {})}><Ic g="📋" size={16} /> Paste from clipboard</button>}
        <button type="button" className="v2-btn" onClick={onChooseFile}><Ic g="srt-in" size={16} /> Choose file</button>
        <button type="button" className="v2-btn primary" title="Import the pasted text as a new text layer" disabled={!n} onClick={confirm}><Ic g="srt-in" size={16} /> Import</button>
      </div>
    </div>
  );
}

export function downloadSrt(list: Subtitle[], name: string) {
  const url = URL.createObjectURL(new Blob([subs.formatSrt(list)], { type: "application/x-subrip" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${name || "subtitles"}.srt` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Timeline lane: cues as blocks; click selects, drag moves (one undo step). */
export function SubtitleLane({ engine, list, selectedId, onSelect, toPx, toTicks }: { engine: Engine; list: Subtitle[]; selectedId?: string; onSelect: (id?: string) => void; toPx: (t: number) => number; toTicks: (px: number) => number }) {
  const drag = useRef<{ id: string; x0: number; s0: number }>();
  return (
    <div className="v2-lane kind-text" aria-label="Subtitles" onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(undefined); }}>
      {list.map((s) => (
        <div key={s.id} className={`v2-clip clip-text ${s.id === selectedId ? "is-selected" : ""}`} data-subtitle-id={s.id} title={`${s.text} — drag to move`}
          style={{ left: toPx(s.startTicks), width: Math.max(4, toPx(s.durationTicks)) }}
          onPointerDown={(e) => { e.stopPropagation(); onSelect(s.id); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); engine.beginGesture(); drag.current = { id: s.id, x0: e.clientX, s0: s.startTicks }; }}
          onPointerMove={(e) => { const d = drag.current; if (d) engine.dispatch(cmd.updateSubtitle(d.id, { startTicks: d.s0 + toTicks(e.clientX - d.x0) })); }}
          onPointerUp={() => { if (drag.current) { drag.current = undefined; engine.endGesture(); } }}>
          <span className="v2-clip-name">T {s.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Inspector for one cue: text, start/end (seconds), delete. */
export function SubtitleEditor({ engine, sub, onDelete }: { engine: Engine; sub: Subtitle; onDelete: () => void }) {
  const upd = (patch: Partial<Subtitle>) => engine.dispatch(cmd.updateSubtitle(sub.id, patch));
  const num = (label: string, value: number, set: (s: number) => void) => (
    <label className="v2-insp-row v2-sub-time"><span>{label}</span>
      <input type="number" step={0.1} min={0} value={ticksToSeconds(value).toFixed(2)} aria-label={label} onChange={(e) => set(secondsToTicks(Number(e.target.value)))} /><output>s</output><span />
    </label>
  );
  return (
    <section className="v2-inspector" aria-label="Text">
      <div className="v2-panel-head"><strong>Text</strong><button className="v2-btn" title="Delete this text (Del)" onClick={onDelete}>Delete</button></div>
      <textarea className="v2-sub-text" aria-label="Subtitle text" rows={3} value={sub.text}
        onFocus={() => engine.beginGesture()} onBlur={() => engine.endGesture()} onChange={(e) => upd({ text: e.target.value })} />
      {num("Start", sub.startTicks, (startTicks) => upd({ startTicks }))}
      {num("End", sub.startTicks + sub.durationTicks, (end) => upd({ durationTicks: end - sub.startTicks }))}
    </section>
  );
}

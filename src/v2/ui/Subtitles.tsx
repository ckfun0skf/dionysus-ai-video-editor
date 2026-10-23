import { useRef } from "react";
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

export async function importSrtFile(engine: Engine, file: File): Promise<number> {
  const list = subs.parseSrt(await file.text());
  if (list.length) engine.dispatch(cmd.setSubtitles(list));
  return list.length;
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

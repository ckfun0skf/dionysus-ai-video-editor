import { board, story, storyEdit, storyRefs, type AssetSlot, type Project, type Shot, type Staleness } from "../../domain";
import { getPreset, parsePresetRef } from "../../registry";
import { Ic } from "../Icon";
import { useDragReorder } from "./useDragReorder";
import { paramThumbKey } from "./useVersionThumbs";

export type BoardTarget = { slot: string } | { shot: string };

export const TYPE_ICON: Record<string, string> = { video: "▭", audio: "♫", frame: "link", html: "</>" };
/** Shot icon by how its clip is made: generated video, an HTML page, or a still. */
export const shotIcon = (s: Shot) => (s.render === "html" ? "</>" : s.render === "still" ? "image" : "▭");
const CONN_LABEL: Record<string, string> = { continuity: "Continuity", match: "Match cut", cut: "Cut" };

/** " · Crossfade 0.8 s" for a connection transition (the registry name; unknown presets play as a cut). */
export function transitionLabel(t: { preset: string; params?: Record<string, number | string> } | undefined): string {
  if (!t) return "";
  const r = parsePresetRef(t.preset);
  const d = r && getPreset("transition", r.id);
  if (!d) return " · cut (unknown transition)";
  const sec = typeof t.params?.durationSec === "number" ? t.params.durationSec : story.DEFAULT_TRANSITION_SEC;
  return ` · ${d.name} ${sec} s`;
}

/** "2 of 3" for the selected version, or what is still missing. */
export function versionLabel(p: Project, o: AssetSlot | Shot, empty: string): string {
  const vs = board.versionsOf(p, o);
  if (!vs.length) return o.skipped ? "Skipped" : empty;
  const i = vs.findIndex((v) => v.id === board.selectedOf(p, o));
  return vs.length === 1 ? "1 version" : `v${i + 1} of ${vs.length}`;
}

export function Thumb({ src, icon, count }: { src?: string; icon: string; count: number }) {
  return (
    <span className={`v2-sb-thumb ${src ? "" : "empty"}`} style={src ? { backgroundImage: `url(${src})` } : undefined}>
      {!src && <Ic g={icon} size={18} />}
      {count > 1 && <span className="v2-sb-count" aria-hidden>{count}</span>}
    </span>
  );
}

/** "3s · planned 5s" when the picked clip's length is off the plan by more than half a second (V2-SB-R06). */
export function LengthWarn({ project, shot }: { project: Project; shot: Shot }) {
  const m = board.shotLengthMismatch(project, shot);
  if (!m) return null;
  const sec = (x: number) => `${Math.round(x * 10) / 10}s`;
  return <span className="v2-sb-len" title={`The picked clip is ${sec(m.actualSec)} long but the shot is planned at ${sec(m.plannedSec)}. The timeline uses the clip's length.`}><Ic g="⚠" size={12} /> {sec(m.actualSec)} · planned {sec(m.plannedSec)}</span>;
}

export function Warn({ st }: { st?: Staleness }) {
  if (!st?.stale) return null;
  return <span className="v2-sb-stale" title={`May not match: ${st.reasons.join("; ")}`}><Ic g="⚠" size={13} /> May not match</span>;
}

/** Board editing (V2-CUT-02). Absent = read-only board. */
export interface BoardEdit {
  /** Move shot `from` to index `to`. */
  move: (id: string, to: number) => void;
  /** Shot actions: a menu at (x, y) on desktop, the action sheet on phones (no point). */
  menu: (id: string, at?: { x: number; y: number }) => void;
  remove: (id: string) => void;
  add: () => void;
  /** V2-CUT-05: start a new asset slot. */
  addAsset?: () => void;
  connection: (from: string, to: string) => void;
}

/** Storyboard overview: shots in order with their connections, the assets each needs, version counts and warnings. */
export function BoardView({ project, thumbs, onOpen, openKey, edit, mobile }: { project: Project; thumbs: Record<string, string>; onOpen: (t: BoardTarget) => void; openKey?: string; edit?: BoardEdit; mobile?: boolean }) {
  const b = project.storyboard!;
  const status = board.storyStatus(project);
  const shots = b.order.map((id) => b.shots[id]).filter(Boolean);
  const slots = Object.values(b.slots);
  const used = new Set(shots.flatMap((s) => s.slotIds));
  const others = slots.filter((s) => !used.has(s.id));
  const done = (o: AssetSlot | Shot) => board.versionsOf(project, o).length > 0 || !!o.skipped;
  const placed = new Set(board.sendPlan(project).filter((x) => x.state === "placed").map((x) => x.shotId));
  const staleCount = [...Object.values(status.slots), ...Object.values(status.shots)].filter((s) => s.stale).length;
  const total = shots.reduce((t, s) => t + s.durationSec, 0);
  const shotNo = (id: string) => b.order.indexOf(id) + 1;
  const drag = useDragReorder({ onMove: (from, to) => edit?.move(shots[from].id, to), onHold: (i) => edit?.menu(shots[i].id) });
  const keys = (e: React.KeyboardEvent, id: string, i: number) => {
    if (!edit) return;
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const to = i + (e.key === "ArrowUp" ? -1 : 1);
      if (to >= 0 && to < shots.length) { edit.move(id, to); requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-shot]")].find((x) => x.dataset.shot === id)?.querySelector<HTMLElement>(".v2-sb-shot-main")?.focus()); }
    } else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); edit.remove(id); }
    else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); edit.menu(id, { x: r.left + 24, y: r.top + 24 }); }
  };

  const slotChip = (s: AssetSlot, shot?: Shot) => {
    const pin = shot && board.pinOf(project, shot, s.id);
    const sel = pin ?? board.selectedOf(project, s);
    const n = board.versionsOf(project, s).length;
    const sub = pin ? `Pinned ${storyRefs.pinLabel(project, shot!, s.id)} here` : s.source.type === "lastFrame" && !n ? (shotNo(s.source.shotId) ? `Taken from shot ${shotNo(s.source.shotId)}’s clip` : "Taken from a shot’s clip") : versionLabel(project, s, s.source.type === "upload" ? "Upload needed" : s.source.type === "json" ? "Needs audio JSON" : "Needs generating");
    return (
      <li key={s.id}>
        <button className={`v2-sb-slot ${pin ? "pinned" : ""} ${status.slots[s.id]?.stale ? "stale" : ""} ${n ? "" : "todo"} ${openKey === s.id ? "open" : ""}`} aria-current={openKey === s.id || undefined} onClick={() => onOpen({ slot: s.id })} aria-label={`${s.name}: ${sub}${status.slots[s.id]?.stale ? ", may not match" : ""}`} title={s.prompt || s.name}>
          <Thumb src={sel && thumbs[sel]} icon={TYPE_ICON[s.type] ?? "image"} count={n} />
          <span className="v2-sb-slot-text"><b>{s.name}</b><em>{status.slots[s.id]?.stale && !pin ? <Warn st={status.slots[s.id]} /> : <>{pin && <Ic g="pin" size={11} />}{sub}</>}</em></span>
        </button>
      </li>
    );
  };

  return (
    <div className="v2-sb-board">
      <div className="v2-sb-meta">
        <h3>{b.meta.title}</h3>
        {b.meta.logline && <p>{b.meta.logline}</p>}
        <div className="v2-sb-stats">
          <span>{shots.length} shots · {Math.round(total * 10) / 10}s · {b.meta.aspect}</span>
          <span><Ic g="image-up" size={14} /> Assets {slots.filter(done).length}/{slots.length}</span>
          <span><Ic g="▭" size={14} /> Clips {shots.filter(done).length}/{shots.length}</span>
          {staleCount > 0 && <span className="v2-sb-stale"><Ic g="⚠" size={14} /> {staleCount} may not match</span>}
        </div>
      </div>
      <ol className="v2-sb-shots" aria-label="Shots">
        {shots.map((s, i) => {
          const sel = board.selectedOf(project, s);
          const n = board.versionsOf(project, s).length;
          const next = shots[i + 1];
          const conn = next && storyEdit.connectionBetween(b, s.id, next.id);
          const connText = <>{conn?.kind === "continuity" ? <Ic g="link" size={12} /> : null}{CONN_LABEL[conn?.kind ?? "cut"]}{transitionLabel(conn?.transition)}{conn?.note ? ` · ${conn.note}` : ""}</>;
          const connLabel = `${CONN_LABEL[conn?.kind ?? "cut"]}${transitionLabel(conn?.transition)} to shot ${i + 2}`;
          return (
            <li key={s.id} className="v2-sb-shotwrap" data-reorder={edit ? "" : undefined} data-shot={s.id}>
              <article className={`v2-sb-shot ${status.shots[s.id]?.stale ? "stale" : ""} ${edit ? "editable" : ""} ${edit && !mobile ? "grip" : ""}`} aria-label={`Shot ${i + 1}: ${s.title}`}
                onPointerDown={edit ? (e) => { if (!(e.target as Element).closest(".v2-sb-slots, .v2-sb-shot-more")) drag.start(e, i); } : undefined}
                onContextMenu={edit ? (e) => { if ((e.target as Element).closest(".v2-sb-slots")) return; e.preventDefault(); if (!mobile) edit.menu(s.id, { x: e.clientX, y: e.clientY }); } : undefined}>
                {edit && !mobile && <span className="v2-sb-grip" aria-hidden title="Drag to reorder" onPointerDown={(e) => { e.stopPropagation(); drag.start(e, i, true); }}><Ic g="grip-v" size={16} /></span>}
                <button className={`v2-sb-shot-main ${openKey === s.id ? "open" : ""}`} aria-current={openKey === s.id || undefined} onClick={() => onOpen({ shot: s.id })} onKeyDown={(e) => keys(e, s.id, i)}
                  title={edit ? (mobile ? "Open shot · long-press to move or edit" : "Open shot · drag to reorder · right-click for more · Alt+↑/↓ moves") : "Open shot: clip prompt, versions and QA"}
                  aria-keyshortcuts={edit && !mobile ? "Alt+ArrowUp Alt+ArrowDown Delete" : undefined}>
                  <Thumb src={sel && (thumbs[paramThumbKey(sel, s.params)] ?? thumbs[sel])} icon={shotIcon(s)} count={n} />
                  <span className="v2-sb-shot-text">
                    <b><span className="v2-sb-no">{i + 1}</span>{s.title}</b>
                    <em>{s.durationSec}s{s.description ? ` · ${s.description}` : ""}</em>
                    <span className="v2-sb-shot-status">{versionLabel(project, s, "No clip yet")}{placed.has(s.id) && <span className="v2-sb-placed" title="This shot is on the timeline and follows the version you pick"> · On timeline</span>}<Warn st={status.shots[s.id]} /><LengthWarn project={project} shot={s} /></span>
                    {(s.needsPrompt || s.layers?.some((l) => l.needsPrompt) || project.storyboard?.audio?.some((c) => c.needsPrompt && c.from === s.id)) && <span className="v2-needs-prompt" title="Made on the timeline by Sync to Storyboard: write its description and prompt (or ask your AI)">⚠ Needs description / prompt</span>}
                    {s.removedFromTimeline && <span className="v2-removed-tl" title="Its clip was removed from the timeline. The shot is kept; Send to timeline puts it back">Removed from timeline</span>}
                  </span>
                  {edit ? <span aria-hidden /> : <Ic g="anim-out" size={16} />}
                </button>
                {edit && <button className="v2-icon v2-sb-icon v2-sb-shot-more" aria-label={`Shot ${i + 1} actions`} aria-haspopup="menu" title="Edit, duplicate, move, delete"
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); edit.menu(s.id, mobile ? undefined : { x: r.right - 220, y: r.bottom + 4 }); }}><Ic g="⋯" size={18} /></button>}
                {s.slotIds.length > 0 && <ul className="v2-sb-slots" aria-label={`Assets for shot ${i + 1}`}>{s.slotIds.map((id) => b.slots[id]).filter(Boolean).map((x) => slotChip(x, s))}</ul>}
              </article>
              {next && (edit
                ? <button className={`v2-sb-conn ${conn?.kind ?? "cut"} ${conn?.transition ? "has-tr" : ""}`} aria-label={`${connLabel}. Edit connection`} title="Edit how this shot leads into the next" onClick={() => edit.connection(s.id, next.id)}>
                    <span className="v2-sb-conn-line" /><span className="v2-sb-conn-label">{connText}</span><Ic g="✎" size={12} className="v2-sb-conn-edit" />
                  </button>
                : <div className={`v2-sb-conn ${conn?.kind ?? "cut"}`} aria-label={connLabel}>
                    <span className="v2-sb-conn-line" /><span className="v2-sb-conn-label">{connText}</span>
                  </div>)}
            </li>
          );
        })}
      </ol>
      {edit && <button className="v2-sb-addshot" onClick={edit.add} title="Add a shot at the end"><Ic g="+" size={18} /> Add shot</button>}
      {(others.length > 0 || edit?.addAsset) && (
        <section className="v2-sb-others"><h4>Other assets</h4>
          {others.length > 0 && <ul className="v2-sb-slots">{others.map((x) => slotChip(x))}</ul>}
          {edit?.addAsset && <button className="v2-btn v2-sb-btn v2-sb-addasset" onClick={edit.addAsset} title="Add a character, place, prop, style or other asset"><Ic g="+" size={16} /> Add asset</button>}
        </section>
      )}
    </div>
  );
}

import { board, type AssetSlot, type Project, type Shot, type Staleness } from "../../domain";
import { Ic } from "../Icon";

export type BoardTarget = { slot: string } | { shot: string };

export const TYPE_ICON: Record<string, string> = { video: "▭", audio: "♫", frame: "link" };
const CONN_LABEL: Record<string, string> = { continuity: "Continuity", match: "Match cut", cut: "Cut" };

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

/** Storyboard overview: shots in order with their connections, the assets each needs, version counts and warnings. */
export function BoardView({ project, thumbs, onOpen, openKey }: { project: Project; thumbs: Record<string, string>; onOpen: (t: BoardTarget) => void; openKey?: string }) {
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

  const slotChip = (s: AssetSlot) => {
    const sel = board.selectedOf(project, s);
    const n = board.versionsOf(project, s).length;
    const sub = s.source.type === "lastFrame" && !n ? (shotNo(s.source.shotId) ? `Taken from shot ${shotNo(s.source.shotId)}’s clip` : "Taken from a shot’s clip") : versionLabel(project, s, s.source.type === "upload" ? "Upload needed" : "Needs generating");
    return (
      <li key={s.id}>
        <button className={`v2-sb-slot ${status.slots[s.id]?.stale ? "stale" : ""} ${n ? "" : "todo"} ${openKey === s.id ? "open" : ""}`} aria-current={openKey === s.id || undefined} onClick={() => onOpen({ slot: s.id })} aria-label={`${s.name}: ${sub}${status.slots[s.id]?.stale ? ", may not match" : ""}`} title={s.prompt || s.name}>
          <Thumb src={sel && thumbs[sel]} icon={TYPE_ICON[s.type] ?? "image"} count={n} />
          <span className="v2-sb-slot-text"><b>{s.name}</b><em>{status.slots[s.id]?.stale ? <Warn st={status.slots[s.id]} /> : sub}</em></span>
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
          const conn = next && b.connections.find((c) => c.from === s.id && c.to === next.id);
          return (
            <li key={s.id} className="v2-sb-shotwrap">
              <article className={`v2-sb-shot ${status.shots[s.id]?.stale ? "stale" : ""}`} aria-label={`Shot ${i + 1}: ${s.title}`}>
                <button className={`v2-sb-shot-main ${openKey === s.id ? "open" : ""}`} aria-current={openKey === s.id || undefined} onClick={() => onOpen({ shot: s.id })} title="Open shot: clip prompt, versions and QA">
                  <Thumb src={sel && thumbs[sel]} icon="▭" count={n} />
                  <span className="v2-sb-shot-text">
                    <b><span className="v2-sb-no">{i + 1}</span>{s.title}</b>
                    <em>{s.durationSec}s{s.description ? ` · ${s.description}` : ""}</em>
                    <span className="v2-sb-shot-status">{versionLabel(project, s, "No clip yet")}{placed.has(s.id) && <span className="v2-sb-placed" title="This shot is on the timeline and follows the version you pick"> · On timeline</span>}<Warn st={status.shots[s.id]} /><LengthWarn project={project} shot={s} /></span>
                  </span>
                  <Ic g="anim-out" size={16} />
                </button>
                {s.slotIds.length > 0 && <ul className="v2-sb-slots" aria-label={`Assets for shot ${i + 1}`}>{s.slotIds.map((id) => b.slots[id]).filter(Boolean).map(slotChip)}</ul>}
              </article>
              {next && (
                <div className={`v2-sb-conn ${conn?.kind ?? "cut"}`} aria-label={`${CONN_LABEL[conn?.kind ?? "cut"]} to shot ${i + 2}`}>
                  <span className="v2-sb-conn-line" />
                  <span className="v2-sb-conn-label">{conn?.kind === "continuity" ? <Ic g="link" size={12} /> : null}{CONN_LABEL[conn?.kind ?? "cut"]}{conn?.note ? ` · ${conn.note}` : ""}</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {others.length > 0 && (
        <section className="v2-sb-others"><h4>Other assets</h4><ul className="v2-sb-slots">{others.map(slotChip)}</ul></section>
      )}
    </div>
  );
}

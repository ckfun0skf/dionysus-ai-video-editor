/**
 * P89b storyboard paths: the production step "Create path <name> from <reference>" (or "Draw path <name>").
 *
 * - `PathStepDetail`: what the path is for, a preview over the reference, the layers that move along it, and how to
 *   make it: Track in reference (the Track sheet on the reference video; ✓ turns the box centre into points) or Draw
 *   (the Motion path editor over the reference frame, or an empty frame). Each is one undo step.
 * - `PathDrawSheet`: the editor's Motion path tools (`MotionPathOverlay`, bars, timing strip) on a stand-in clip of
 *   the path's length; the reference video follows the timing strip so a point's time is the frame under it.
 * docs/v2/MOTION_PATH.md "Storyboard paths".
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { board, motion, storyPaths, TICKS_PER_SECOND, type AssetVersion, type MotionPath, type NamedTrack, type Placement, type Project, type StoryPath } from "../../domain";
import { cmd, type Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { Ic } from "../Icon";
import { MotionPathBar, MotionPathOverlay, MotionPathPhoneBar, PathOptions, PointFields, useMotionKeys, useMotionSession } from "../MotionPathEditor";
import { TrackSheet } from "../TrackSheet";
import type { TrackAnalyse } from "../trackAnalyse";
import type { BoardTarget } from "./BoardView";

const STATE_TEXT = (p: StoryPath, n: number) =>
  p.createdBy === "track" ? `Made by tracking · ${n} point${n === 1 ? "" : "s"}`
    : p.createdBy === "draw" ? `Drawn · ${n} point${n === 1 ? "" : "s"}`
      : n ? `Planned · ${n} point${n === 1 ? "" : "s"} (moves the layers until you make it)` : "No points yet";

/** Who moves along a path, for its step ("Shot 2 · “Hello”"). */
export function pathUserLabels(project: Project, id: string): { shot: string; label: string }[] {
  const b = project.storyboard!;
  return storyPaths.pathUsers(b, id).map((u) => {
    const l = b.shots[u.shot]?.layers?.find((x) => x.id === u.layer);
    const what = !l ? u.layer : l.type === "text" ? `“${l.text.slice(0, 24)}”` : b.slots[l.asset]?.name ?? l.asset;
    return { shot: u.shot, label: `Shot ${b.order.indexOf(u.shot) + 1} · ${what}` };
  });
}

/** The project frame aspect (width / height). */
const frameAspect = (p: Project) => (p.settings?.width && p.settings?.height ? p.settings.width / p.settings.height : 16 / 9);

/** Read-only picture of a path in the frame (the reference thumbnail under it when there is one). */
export function PathPreview({ path, aspect, thumb, label }: { path?: MotionPath; aspect: number; thumb?: string; label: string }) {
  const W = 100 * aspect, H = 100;
  const nodes = path?.nodes ?? [];
  const d = nodes.slice(0, -1).map((_, i) => motion.segmentPoints(nodes, i)).map((p) => `M${(p[0].x + 0.5) * W},${(p[0].y + 0.5) * H} C${(p[1].x + 0.5) * W},${(p[1].y + 0.5) * H} ${(p[2].x + 0.5) * W},${(p[2].y + 0.5) * H} ${(p[3].x + 0.5) * W},${(p[3].y + 0.5) * H}`).join(" ");
  return (
    <div className="v2-pathprev" style={{ aspectRatio: `${aspect}` }} role="img" aria-label={label} data-testid="path-preview">
      {thumb ? <img src={thumb} alt="" /> : <span className="v2-pathprev-grid" aria-hidden />}
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden>
        {d && <path d={d} className="v2-pathprev-line" />}
        {nodes.map((n, i) => <circle key={n.id} cx={(n.x + 0.5) * W} cy={(n.y + 0.5) * H} r={i === 0 ? 2.6 : 1.8} className={i === 0 ? "is-first" : undefined} />)}
      </svg>
      {!nodes.length && <span className="v2-pathprev-empty">No points yet</span>}
    </div>
  );
}

export function PathStepDetail({ project, pathId, thumbs, engine, blobs, mobile, head, onOpen, onNote, analyse }: {
  project: Project; pathId: string; thumbs: Record<string, string>; engine: Engine; blobs: BlobStore; mobile: boolean; head?: ReactNode;
  onOpen: (t: BoardTarget) => void; onNote?: (text: string) => void; /** Tests: the tracker. */ analyse?: TrackAnalyse;
}) {
  const b = project.storyboard!;
  const p = storyPaths.findPath(b, pathId);
  const [sheet, setSheet] = useState<"track" | "draw">();
  if (!p) return null;
  const ref = p.from ? b.slots[p.from] : undefined;
  const refV: AssetVersion | undefined = ref ? board.versionsOf(project, ref).find((v) => v.id === board.selectedOf(project, ref)) : undefined;
  const aspect = frameAspect(project);
  const title = storyPaths.pathStepTitle(p, ref?.name);
  const n = p.motionPath?.nodes.length ?? 0;
  const dur = storyPaths.pathDurationSec(b, p, TICKS_PER_SECOND);
  const users = pathUserLabels(project, p.id);
  const canTrack = ref?.type === "video" && !!refV && !!ref.assetId;
  const save = (next: StoryPath, label: string, note: string) => { if (engine.dispatch(cmd.setStoryPath(p.id, next, label))) onNote?.(note); };
  const clear = () => { const { motionPath: _m, createdBy: _c, ...rest } = p; save(rest, "Clear storyboard path", `${storyPaths.pathName(p)}: points cleared (Undo to restore)`); };
  const onTrack = (t: NamedTrack) => {
    const mp = storyPaths.pathFromTrack(t, aspect);
    setSheet(undefined);
    if (mp.nodes.length < 2) { onNote?.("The tracker found too few steady frames for a path: redraw the box on something with clear edges, or draw the path"); return; }
    save({ ...p, motionPath: mp, createdBy: "track" }, `Track path ${storyPaths.pathName(p)}`, `${storyPaths.pathName(p)}: ${mp.nodes.length} points from tracking`);
  };
  const onDraw = (mp: MotionPath | null) => {
    setSheet(undefined);
    if (!mp) { clear(); return; }
    save({ ...p, motionPath: mp, createdBy: "draw" }, `Draw path ${storyPaths.pathName(p)}`, `${storyPaths.pathName(p)}: ${mp.nodes.length} point${mp.nodes.length === 1 ? "" : "s"} drawn`);
  };
  const standIn = canTrack ? ({ id: `path:${p.id}`, startTicks: 0, durationTicks: Math.max(1, refV!.media.durationTicks ?? Math.round(dur * TICKS_PER_SECOND)), sourceInTicks: 0, source: { assetId: ref!.assetId!, versionId: refV!.id }, clipType: "video" } as Placement) : undefined;

  return (
    <section className="v2-sb-inline v2-pathstep" aria-label={title} data-testid="path-step">
      <div className="v2-sb-detail-body">
        {head}
        <div className="v2-sb-detail-head"><Ic g="motion-path" size={18} /><h3>{title}</h3></div>
        <p className="v2-sb-detail-desc">{[p.description, p.track ? `follows ${p.track}` : "", `${Math.round(dur * 100) / 100} s`].filter(Boolean).join(" · ")}</p>
        <div className="v2-pathstep-main">
          <PathPreview path={p.motionPath} aspect={aspect} thumb={refV && thumbs[refV.id]} label={`Path ${storyPaths.pathName(p)}: ${STATE_TEXT(p, n)}`} />
          <div className="v2-pathstep-side">
            <p className={`v2-pathstep-state${p.createdBy ? " is-made" : ""}`} data-testid="path-state"><Ic g={p.createdBy ? "ok" : n ? "motion-path" : "todo"} size={14} /> {STATE_TEXT(p, n)}</p>
            {ref && !refV && <p className="v2-hint" role="note">Made from “{ref.name}”, which has no version yet. Add it first{ref.type === "video" ? " to track it" : ""}, or draw the path now.</p>}
            {ref && !refV && <button type="button" className="v2-btn v2-sb-btn" onClick={() => onOpen({ slot: ref.id })}><Ic g="link" size={16} /> Open “{ref.name}”</button>}
            <div className="v2-pathstep-actions">
              {canTrack && <button type="button" className="v2-btn primary v2-sb-btn" data-testid="path-track" title={`Track something in “${ref!.name}”: its centre becomes the path`} onClick={() => setSheet("track")}><Ic g="track" size={16} /> {p.createdBy === "track" ? "Track again" : "Track in reference"}</button>}
              <button type="button" className={`v2-btn v2-sb-btn${canTrack ? "" : " primary"}`} data-testid="path-draw" title={ref && refV ? `Draw the path over “${ref.name}”` : "Draw the path on an empty frame"} onClick={() => setSheet("draw")}><Ic g="mp-add" size={16} /> {n ? "Edit points" : ref && refV ? "Draw over reference" : "Draw path"}</button>
              {n > 0 && <button type="button" className="v2-btn v2-sb-btn" data-testid="path-clear" title="Remove the points (Undo restores them)" onClick={clear}><Ic g="🗑" size={16} /> Clear</button>}
            </div>
          </div>
        </div>
        <section className="v2-sb-sec">
          <div className="v2-sb-sec-head"><h4>Moves {users.length ? `${users.length} layer${users.length === 1 ? "" : "s"}` : "no layer yet"}</h4></div>
          {users.length ? <ul className="v2-pathstep-users">{users.map((u, i) => <li key={i}><button type="button" className="v2-linkbtn" onClick={() => onOpen({ shot: u.shot })}><Ic g="layers" size={14} /> {u.label}</button></li>)}</ul>
            : <p className="v2-hint">Pick it as the motion path of a text, image or HTML layer in a shot (Edit shot → layer → Path), or with the AI (motionPath.ref).</p>}
          <p className="v2-hint">On Send, Update and Re-lay each layer gets this path fitted to its length and stays linked: change the path here and Update moves the clips. Editing a linked clip's path in the editor writes back here on Sync when it is the only user.</p>
        </section>
      </div>
      {sheet === "track" && standIn && (
        <div className="v2-modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) setSheet(undefined); }}>
          <TrackSheet engine={engine} project={project} placement={standIn} time={0} label={`Track for path ${storyPaths.pathName(p)}`}
            loadBlob={async () => blobs.get(refV!.media.blobKey)} analyse={analyse} onClose={() => setSheet(undefined)} onDone={() => setSheet(undefined)} onCommitTrack={onTrack} />
        </div>
      )}
      {sheet === "draw" && <PathDrawSheet project={project} path={p} refVersion={refV} refKind={ref?.type} blobs={blobs} engine={engine} mobile={mobile} onCancel={() => setSheet(undefined)} onSave={onDraw} />}
    </section>
  );
}

/** Full-screen (phone) / modal (desktop) drawing of a storyboard path over its reference. */
export function PathDrawSheet({ project, path, refVersion, refKind, blobs, engine, mobile, onCancel, onSave }: {
  project: Project; path: StoryPath; refVersion?: AssetVersion; refKind?: string; blobs: BlobStore; engine: Engine; mobile: boolean;
  onCancel: () => void; onSave: (mp: MotionPath | null) => void;
}) {
  const b = project.storyboard!;
  const aspect = frameAspect(project);
  const durTicks = Math.max(TICKS_PER_SECOND / 2, Math.round(storyPaths.pathDurationSec(b, path, TICKS_PER_SECOND) * TICKS_PER_SECOND));
  const pl = useMemo(() => ({ id: `path:${path.id}`, startTicks: 0, durationTicks: durTicks, sourceInTicks: 0, source: { assetId: "", versionId: "" }, clipType: "image" } as Placement), [path.id, durTicks]);
  const api = useMotionSession(engine, () => undefined, () => undefined);
  useMotionKeys(api);
  const started = useRef(false);
  const [offset, setOffset] = useState(0);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const [url, setUrl] = useState<string>();
  const done = useRef(onSave); done.current = onSave;
  const quit = useRef(onCancel); quit.current = onCancel;
  const saved = useRef(false);
  useEffect(() => {
    api.start(pl, { draft: path.motionPath ?? { nodes: [], constantSpeed: true }, onCommit: (mp) => { saved.current = true; done.current(mp); } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ✕ / Esc ends the session without a commit; ✓ with no change ends it too: either way the sheet closes.
  useEffect(() => { if (api.session) started.current = true; else if (started.current && !saved.current) quit.current(); }, [api.session]);
  const kind = refVersion ? (refKind === "video" ? "video" : refKind === "image" ? "image" : undefined) : undefined;
  useEffect(() => {
    if (!kind || !refVersion) return;
    let live = true, made = "";
    void blobs.get(refVersion.media.blobKey).then((bl) => { if (live && bl) { made = URL.createObjectURL(bl); setUrl(made); } }).catch(() => undefined);
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [kind, refVersion, blobs]);
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { const v = video.current; if (v && url) { const t = offset / TICKS_PER_SECOND; if (Math.abs(v.currentTime - t) > 1 / 60) v.currentTime = t; } }, [offset, url]);
  const s = api.session;
  const name = storyPaths.pathName(path);
  const frameEl = kind === "video" && url
    ? <video ref={(el) => { video.current = el; setFrame(el); }} className="v2-pathdraw-frame" src={url} muted playsInline preload="auto" aria-label="Reference frame" />
    : kind === "image" && url ? <img ref={setFrame} className="v2-pathdraw-frame" src={url} alt="Reference frame" />
      : <div ref={setFrame} className="v2-pathdraw-frame v2-pathdraw-blank" aria-label="Empty frame" />;
  return (
    <div className={`v2-pathdraw${mobile ? " is-mobile" : ""}`} role="dialog" aria-label={`Draw path ${name}`} data-testid="path-draw-sheet">
      <header className="v2-pathdraw-head">
        <Ic g="motion-path" size={18} />
        <b>Path · {name}</b>
        <span className="v2-pathdraw-sub">{refVersion ? "over the reference" : "on an empty frame"} · {(durTicks / TICKS_PER_SECOND).toFixed(2)} s</span>
      </header>
      <div className="v2-pathdraw-body">
        <div className="v2-pathdraw-stagebox">
          <div className="v2-pathdraw-stage" style={{ aspectRatio: `${aspect}`, width: `min(100%, calc((100dvh - ${mobile ? 250 : 200}px) * ${aspect}))` }}>
            {frameEl}
            {s && frame && <MotionPathOverlay canvas={frame} placement={pl} path={s.draft} offset={offset} aspect={aspect} api={api} onSeekOffset={setOffset} />}
          </div>
          {s && !s.draft.nodes.length && <p className="v2-hint v2-pathdraw-tip" role="status">{mobile ? "Tap" : "Click"} the frame to add points; drag while adding to curve.</p>}
        </div>
        {!mobile && s && <aside className="v2-pathdraw-side" aria-label="Point and path">
          <PointFields api={api} placement={pl} aspect={aspect} />
          <PathOptions api={api} aspect={aspect} dur={durTicks} />
        </aside>}
      </div>
      {s && (mobile
        ? <MotionPathPhoneBar api={api} placement={pl} aspect={aspect} offset={offset} onSeekOffset={setOffset} />
        : <MotionPathBar api={api} placement={pl} aspect={aspect} offset={offset} onSeekOffset={setOffset} name={name} title={`Path ${name}`} />)}
    </div>
  );
}

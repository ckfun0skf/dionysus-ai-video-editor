/**
 * P26 "Adjust range" (slip edit) and "Replace asset" for the selected clip. Mobile shows it in a bottom sheet, desktop
 * in a side panel; the content is the same.
 * - A preview loops the chosen source range. Below it the whole source (filmstrip for video, waveform for audio) has a
 *   window box over the range: dragging the box slips the range (the clip's start and length stay). The box edges
 *   resize the range only when the length is unlocked (the clip's length then follows). −/+ step one frame and the
 *   start field takes exact seconds; in, out and the change are shown.
 * - Video and audio work on a draft: nothing changes until Apply, which is ONE undo step (replace + slip together);
 *   Cancel drops the draft. HTML/code clips have no source file to preview here, so their offset is applied live
 *   (one coalesced undo step) and the main preview shows it; Cancel undoes it.
 * - "Replace asset…" picks another asset of the same kind (project library or an upload). A shorter source asks
 *   "Shorten clip" or "Keep length (freeze last frame)" before the draft continues.
 */
import { clipTimeAt, fmtSec } from "./clipTime";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from "react";
import { cmd, type Command, type Engine } from "../engine";
import { clipRange, findPlacement, slip, ticksToSeconds, TICKS_PER_SECOND, type Asset, type Placement, type Project } from "../domain";
import type { BlobStore } from "../ports";
import { Waveform } from "./ClipPreview";
import { mediaKey } from "./useMedia";
import { nearestFrame, type Filmstrip, type Peaks } from "./media";

const root = (p: Project) => p.compositions[p.rootCompositionId];
const fmt = (t: number) => `${ticksToSeconds(t).toFixed(2)} s`;
const signed = (t: number) => `${t >= 0 ? "+" : "−"}${Math.abs(ticksToSeconds(t)).toFixed(2)} s`;

/** Whether the selected clip offers Adjust range (video, audio, HTML; not stills, text or freeze frames). */
export const canAdjustRange = (p: Placement | undefined): boolean => !!p && !!slip.slipKind(p);

export interface AdjustRangeProps {
  /** P29-CLIP-TIME: main playhead; its source time is marked on the filmstrip while it is inside the clip. */
  time?: number;
  engine: Engine;
  project: Project;
  clipId: string;
  blobs: BlobStore;
  peaks: Record<string, Peaks>;
  strips: Record<string, Filmstrip>;
  thumbs?: Record<string, string>;
  /** Upload files into the project; resolves to the new asset ids. */
  onUpload?: (files: File[]) => Promise<string[]>;
  /** Move the main playhead (HTML live preview). */
  onSeek?: (ticks: number) => void;
  onDone: (message?: string) => void;
  /** Open on the asset picker (the "Replace asset" entry). */
  startInPicker?: boolean;
  /** P27 Mix preview: show this draft project in the main preview (undefined restores the real one). */
  onMix?: (draft: Project | undefined) => void;
  /** P27 Mix preview: play the main preview over [from, to) of the timeline. */
  onPlayRange?: (from: number, to: number) => void;
}


function useBlobUrl(blobs: BlobStore, key: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true, made: string | undefined;
    setUrl(undefined);
    if (key) void blobs.get(key).then((b) => { if (alive && b && typeof URL.createObjectURL === "function") { made = URL.createObjectURL(b); setUrl(made); } }).catch(() => undefined);
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [blobs, key]);
  return url;
}

/** The looping preview of [inS, outS) of the source. */
function LoopPreview({ blobs, blobKey, kind, inS, outS }: { blobs: BlobStore; blobKey?: string; kind: "video" | "audio"; inS: number; outS: number }) {
  const url = useBlobUrl(blobs, blobKey);
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(kind === "video");
  useEffect(() => { const el = ref.current; if (el && Number.isFinite(inS)) { try { el.currentTime = inS; } catch { /* not loaded yet */ } } }, [inS, url]);
  useEffect(() => { const el = ref.current; if (!el) return; if (playing) void el.play?.()?.catch?.(() => setPlaying(false)); else el.pause?.(); }, [playing, url]);
  const onTime = () => { const el = ref.current; if (el && (el.currentTime >= outS || el.currentTime < inS - 0.05)) el.currentTime = inS; };
  if (kind === "audio") return (
    <div className="v2-slip-preview is-audio">
      <audio ref={ref} src={url} onTimeUpdate={onTime} aria-label="Range preview" />
      <button type="button" className="v2-btn v2-slip-play" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => setPlaying(!playing)}>{playing ? "❚❚ Pause" : "▶ Play range"}</button>
    </div>
  );
  return (
    <div className="v2-slip-preview">
      {kind === "video"
        ? <video ref={ref} src={url} muted playsInline onTimeUpdate={onTime} aria-label="Range preview" />
        : <audio ref={ref} src={url} onTimeUpdate={onTime} aria-label="Range preview" />}
      {!url && <span className="v2-slip-noprev">{kind === "video" ? "Loading preview…" : "Audio preview"}</span>}
      <button type="button" className="v2-btn v2-slip-play" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
    </div>
  );
}

/** The whole source with the selected range boxed. Drag the box to slip; edges resize when unlocked. */
function SourceBar({ total, inT, span, locked, strip, peaks, onChange, onCommit, srcAt }: {
  srcAt?: number;
  total: number; inT: number; span: number; locked: boolean; strip?: Filmstrip; peaks?: Peaks;
  onChange: (inT: number, span: number) => void; onCommit?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useEffect(() => { const el = ref.current; if (!el) return; const m = () => setW(el.clientWidth || 320); m(); const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(m) : undefined; ro?.observe(el); return () => ro?.disconnect(); }, []);
  const drag = useRef<{ x: number; inT: number; span: number; mode: "move" | "l" | "r" } | null>(null);
  const perPx = total / Math.max(1, w);
  const down = (mode: "move" | "l" | "r") => (e: RPE<HTMLDivElement>) => {
    if (mode !== "move" && locked) return;
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, inT, span, mode };
  };
  const move = (e: RPE<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    const dt = Math.round((e.clientX - d.x) * perPx);
    if (d.mode === "move") onChange(Math.max(0, Math.min(total - d.span, d.inT + dt)), d.span);
    else if (d.mode === "l") { const ni = Math.max(0, Math.min(d.inT + d.span - TICKS_PER_SECOND / 10, d.inT + dt)); onChange(ni, d.inT + d.span - ni); }
    else onChange(d.inT, Math.max(TICKS_PER_SECOND / 10, Math.min(total - d.inT, d.span + dt)));
  };
  const up = () => { if (drag.current) { drag.current = null; onCommit?.(); } };
  const n = Math.max(1, Math.round(w / 56));
  const frames = strip?.frames.length ? Array.from({ length: n }, (_, i) => strip.frames[nearestFrame(strip.times, ((i + 0.5) / n) * ticksToSeconds(total))]) : [];
  const full = useMemo(() => ({ id: "src", startTicks: 0, durationTicks: total, sourceInTicks: 0, clipType: "audio", source: { kind: "assetVersion", assetId: "", versionId: "" } }) as Placement, [total]);
  const left = (inT / total) * 100, width = (span / total) * 100;
  return (
    <div className="v2-slip-bar" ref={ref} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="slip-bar">
      <div className="v2-slip-src" aria-hidden>
        {frames.length ? frames.map((f, i) => <img key={i} src={f} alt="" draggable={false} />) : peaks ? <Waveform peaks={peaks} p={full} width={w} height={56} kind="audio" /> : <span className="v2-slip-plain" />}
      </div>
      <div className="v2-slip-shade" style={{ left: 0, width: `${left}%` }} />
      {srcAt !== undefined && total > 0 && <div className="v2-slip-ph" data-testid="slip-playhead" style={{ left: `${Math.min(100, Math.max(0, (srcAt / total) * 100))}%` }}><span>src {fmtSec(srcAt)}</span></div>}
      <div className="v2-slip-shade" style={{ left: `${left + width}%`, right: 0 }} />
      <div className="v2-slip-box" role="slider" tabIndex={0} aria-label="Selected range — drag to slip" aria-valuemin={0} aria-valuemax={Math.round(ticksToSeconds(total - span) * 100) / 100} aria-valuenow={Math.round(ticksToSeconds(inT) * 100) / 100}
        style={{ left: `${left}%`, width: `${width}%` }} onPointerDown={down("move")} data-testid="slip-box">
        <div className={`v2-slip-edge is-l${locked ? " is-locked" : ""}`} onPointerDown={down("l")} aria-label="Range start edge" title={locked ? "Unlock length to resize" : "Drag to set the in point"} />
        <div className={`v2-slip-edge is-r${locked ? " is-locked" : ""}`} onPointerDown={down("r")} aria-label="Range end edge" title={locked ? "Unlock length to resize" : "Drag to set the out point"} />
      </div>
    </div>
  );
}

function AssetPicker({ project, kind, current, thumbs, onPick, onUpload, onBack, kindOf, story }: { story?: string; kindOf: (id: string) => string | undefined; project: Project; kind: Asset["kind"]; current: string; thumbs?: Record<string, string>; onPick: (id: string) => void; onUpload?: (files: File[]) => Promise<string[]>; onBack: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string>();
  const list = Object.values(project.assets).filter((a) => a.kind === kind && a.id !== current && a.versions.length);
  const dur = (a: Asset) => { const v = slip.replaceVersion(project, a.id); return v?.media.durationTicks ? fmt(v.media.durationTicks) : ""; };
  return (
    <div className="v2-slip-picker" role="group" aria-label="Replace asset">
      <p className="v2-abnote">{story
        ? <>This clip is {story} of the storyboard: the file you choose becomes a <b>new version</b> of {story} (the timeline follows it; earlier versions stay selectable in the storyboard).</>
        : <>Choose another {kind} for this clip. Position, length, effects, Adjust, transitions, volume, sound position, keyframes and links stay.</>}</p>
      <div className="v2-slip-assets" role="list">
        {list.length ? list.map((a) => (
          <button key={a.id} type="button" role="listitem" className="v2-slip-asset" onClick={() => onPick(a.id)} aria-label={`Use ${a.name}`}>
            {thumbs?.[a.id] ? <img src={thumbs[a.id]} alt="" /> : <span className="v2-slip-asset-ph">{kind}</span>}
            <span className="v2-slip-asset-name">{a.name}</span><span className="v2-slip-asset-dur">{dur(a)}</span>
          </button>
        )) : <p className="v2-abnote">No other {kind} in this project yet — upload one.</p>}
      </div>
      {note && <p className="v2-abnote" role="status">{note}</p>}
      <div className="v2-slip-actions">
        {onUpload && <button type="button" className="v2-btn primary" onClick={() => file.current?.click()}>Upload {kind}…</button>}
        <span className="v2-slip-spacer" />
        <button type="button" className="v2-btn" onClick={onBack}>Back</button>
        <input ref={file} type="file" hidden accept={kind === "audio" ? "audio/*" : kind === "video" ? "video/*" : kind === "html" ? ".html,.htm,text/html,.zip" : "image/*"} aria-label={`Upload ${kind}`}
          onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (!fs.length || !onUpload) return; setNote("Uploading…"); void onUpload(fs).then((ids) => { const id = ids.find((x) => kindOf(x) === kind); if (id) onPick(id); else setNote(`That file isn't ${kind === "audio" ? "an" : "a"} ${kind}; choose a ${kind} file.`); }); }} />
      </div>
    </div>
  );
}

export function AdjustRange({ engine, project, clipId, blobs, peaks, strips, thumbs, onUpload, onSeek, onDone, startInPicker, onMix, onPlayRange, time }: AdjustRangeProps) {
  const orig = findPlacement(root(project), clipId)?.placement;
  const [assetId, setAssetId] = useState(orig?.source.assetId ?? "");
  const [onShort, setOnShort] = useState<slip.OnShort>();
  const [picking, setPicking] = useState(!!startInPicker);
  const [locked, setLocked] = useState(true);
  const linked = orig ? root(project).tracks.flatMap((t) => t.placements).filter((p) => p.link?.parent === clipId) : [];
  const [moveLinked, setMoveLinked] = useState(linked.length > 0);
  const live = orig?.clipType === "html";
  const startProject = useRef(project);
  const liveDirty = useRef(0);
  const fps = project.settings.fps;
  const story = useMemo(() => slip.storyTargetOf(project, clipId), [project, clipId]);
  /** P27: Solo previews the clip alone in the sheet; Mix shows the composed timeline in the main preview. */
  const [view, setView] = useState<"solo" | "mix">("solo");

  // The draft: the project with the replace applied (when another asset is chosen and its length is settled).
  const replacing = !!orig && assetId !== orig.source.assetId;
  const plan = replacing ? slip.replacePlan(project, clipId, assetId) : undefined;
  const needsChoice = !!plan?.short && !onShort;
  const draft = useMemo(() => {
    if (!replacing || needsChoice) return project;
    const r = slip.replaceClipAsset(project, clipId, assetId, onShort);
    return r.ok ? r.project : project;
  }, [project, replacing, needsChoice, clipId, assetId, onShort]);
  const base = findPlacement(root(draft), clipId)?.placement;
  const bounds = base ? slip.slipBounds(draft, base) : undefined;
  const [inT, setInT] = useState(base?.sourceInTicks ?? 0);
  const [span, setSpan] = useState(base ? slip.spanOf(base) : 0);
  const baseKey = `${base?.source.assetId}:${base?.source.versionId}:${base?.durationTicks}`;
  useEffect(() => { if (base && !live) { setInT(base.sourceInTicks); setSpan(slip.spanOf(base)); } }, [baseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const kind0 = orig ? slip.slipKind(orig) : undefined;
  const mixOn = view === "mix" && !live && !!base;
  useEffect(() => {
    if (!mixOn || !onMix) return;
    const lockedNow = locked || kind0 !== "media";
    try { onMix(lockedNow ? slip.slipClip(draft, clipId, inT, { moveLinked }) : slip.setSlipRange(draft, clipId, inT, inT + span)); } catch { onMix(draft); }
  }, [mixOn, draft, inT, span, locked, moveLinked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!mixOn) onMix?.(undefined); }, [mixOn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onMix?.(undefined), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!orig || !base) return <p className="v2-abnote">Select a video, audio or HTML clip.</p>;
  const kind = slip.slipKind(orig);
  const assetKind = project.assets[orig.source.assetId]?.kind ?? (orig.clipType as Asset["kind"]);

  // P27: a storyboard shot's main-track clip gets the picked file as a new version of the shot (one undo step).
  const pickAsVersion = (id: string) => {
    const a = engine.getState().project.assets[id];
    const ver = a && slip.replaceVersion(engine.getState().project, id);
    if (!story || !ver) return false;
    const ok = engine.dispatch(cmd.addStoryVersion(story.target, ver.media));
    const after = engine.getState().project, nb = after.storyboard;
    const own = nb && ("shot" in story.target ? nb.shots[story.target.shot] : nb.slots[story.target.slot]);
    const n = own?.assetId ? after.assets[own.assetId]?.versions.length : undefined;
    onDone(ok ? `${story.label}: added as a new version${n ? ` (v${n})` : ""} — earlier versions stay in the storyboard.` : "Couldn't add the version.");
    return true;
  };
  const head = (title: string, onX: () => void, xLabel: string, onOk?: () => void, okDisabled?: boolean) => (
    <header className="v2-slip-head v2-sheet-head">
      <button type="button" className="v2-icon v2-slip-hbtn" aria-label={xLabel} title={xLabel} onClick={onX}>✕</button>
      <h3>{title}</h3>
      {onOk ? <button type="button" className="v2-icon v2-slip-hbtn is-ok" aria-label="Apply" title="Apply" disabled={okDisabled} onClick={onOk}>✓</button> : <span className="v2-slip-hbtn" aria-hidden />}
    </header>
  );

  if (picking) return (
    <div className="v2-slip is-picking" data-testid="adjust-range">
      {head(story ? `New version · ${story.label}` : "Replace asset", () => (startInPicker ? onDone() : setPicking(false)), startInPicker ? "Cancel" : "Back")}
      <AssetPicker story={story?.label} kindOf={(id) => engine.getState().project.assets[id]?.kind} project={project} kind={assetKind} current={orig.source.assetId} thumbs={thumbs} onUpload={onUpload} onBack={() => (startInPicker ? onDone() : setPicking(false))} onPick={(id) => { if (pickAsVersion(id)) return; setAssetId(id); setOnShort(undefined); setPicking(false); }} />
    </div>
  );

  const v = draft.assets[base.source.assetId]?.versions.find((x) => x.id === base.source.versionId);
  const media = bounds?.mediaTicks ?? (bounds ? bounds.max + span : span);
  const total = Math.max(media, inT + span, 1);
  const frame = clipRange.frameTicks(fps);
  const maxIn = Math.max(0, (bounds?.mediaTicks ?? bounds?.max ?? 0) - (bounds?.mediaTicks ? span : 0));
  const clampIn = (t: number) => Math.max(0, Math.min(bounds?.mediaTicks ? maxIn : bounds?.max ?? 0, Math.round(t)));
  const speed = base.speed ?? 1;

  const pushLive = (t: number) => {
    if (!live) return;
    if (!liveDirty.current) engine.beginGesture();
    if (engine.dispatch(cmd.slipClip(clipId, t, moveLinked))) liveDirty.current += 1;
    onSeek?.(base.startTicks);
  };
  const setIn = (t: number) => { const c = clampIn(t); setInT(c); pushLive(c); };
  const onBar = (ni: number, ns: number) => { if (locked) setIn(ni); else { setInT(Math.max(0, ni)); setSpan(Math.max(frame, ns)); } };

  const delta = inT - orig.sourceInTicks;
  const outT = inT + span;
  const durNow = Math.round(span / speed);

  const apply = () => {
    if (live) { engine.endGesture(); onDone(liveDirty.current ? `Range adjusted (${signed(delta)}).` : undefined); return; }
    const cmds: Command[] = [];
    if (replacing) cmds.push(cmd.replaceClipAsset(clipId, assetId, onShort));
    if (locked || kind !== "media") cmds.push(cmd.slipClip(clipId, inT, moveLinked));
    else cmds.push(cmd.setSlipRange(clipId, inT, outT));
    const ok = engine.dispatch(cmds, replacing ? "Replace asset" : "Adjust range");
    onDone(ok ? (replacing ? `Asset replaced${inT !== base.sourceInTicks || !locked ? " and range adjusted" : ""}.` : `Range adjusted (${signed(delta)}).`) : replacing ? "Couldn't replace the asset." : undefined);
  };
  const cancel = () => {
    if (live) { engine.endGesture(); while (liveDirty.current > 0 && engine.getState().project !== startProject.current) { if (!engine.undo()) break; liveDirty.current -= 1; } }
    onDone();
  };

  const linkedNote = linked.length ? (
    <label className="v2-slip-check"><input type="checkbox" checked={moveLinked} onChange={(e) => setMoveLinked(e.target.checked)} /> Move linked audio/overlays too <span className="v2-abnote">({linked.length} linked)</span></label>
  ) : null;

  const isAudio = orig.clipType === "audio";
  const mediaKind = kind === "media" && !live;
  return (
    <div className="v2-slip" data-testid="adjust-range">
      {head(replacing ? "Replace asset" : "Adjust range", cancel, "Cancel", apply, needsChoice)}
      <div className="v2-slip-tools">
        {mediaKind && (
          <div className="v2-seg" role="radiogroup" aria-label="Preview">
            <button type="button" role="radio" aria-checked={view === "solo"} className={view === "solo" ? "is-on" : ""} onClick={() => setView("solo")} title="Preview this clip alone">Solo</button>
            <button type="button" role="radio" aria-checked={view === "mix"} className={view === "mix" ? "is-on" : ""} onClick={() => { setView("mix"); onSeek?.(base.startTicks); }} title="Preview the whole timeline (all layers) at this clip">Mix</button>
          </div>
        )}
        <span className="v2-slip-spacer" />
        {!live && <button type="button" className="v2-btn v2-slip-replace" onClick={() => setPicking(true)} title={story ? `Add a new version of ${story.label}` : "Use another file for this clip"}>⇄ {story ? "New version…" : "Replace asset…"}</button>}
      </div>
      {!mediaKind
        ? <p className="v2-abnote">HTML clip: the preview above shows the new offset as you change it.</p>
        : view === "solo"
          ? <LoopPreview blobs={blobs} blobKey={v?.media.blobKey} kind={isAudio ? "audio" : "video"} inS={ticksToSeconds(inT)} outS={ticksToSeconds(outT)} />
          : <div className="v2-slip-preview is-mix">
              <span className="v2-abnote">Mix: the main preview shows every layer with this range.</span>
              <button type="button" className="v2-btn v2-slip-play" aria-label="Play mix" onClick={() => onPlayRange?.(base.startTicks, base.startTicks + durNow)}>▶ Play mix</button>
            </div>}
      {replacing && (
        <p className="v2-slip-replacing" role="status">Replacing with <b>{project.assets[assetId]?.name}</b>{onShort === "hold" ? " · last frame holds" : onShort === "shorten" ? " · clip shortened" : ""}{plan?.shifted && !plan.short ? " · in point moved earlier to fit" : ""}</p>
      )}
      {needsChoice && plan ? (
        <div className="v2-slip-warn" role="alertdialog" aria-label="New source is too short">
          <p><b>The new source is shorter than the clip.</b> It is {fmt(plan.mediaTicks!)} long; the clip plays {fmt(plan.needTicks)}.</p>
          <div className="v2-slip-actions">
            <button type="button" className="v2-btn" onClick={() => setOnShort("shorten")}>Shorten clip</button>
            <button type="button" className="v2-btn" onClick={() => setOnShort("hold")}>Keep length (freeze last frame)</button>
            <button type="button" className="v2-btn" onClick={() => setPicking(true)}>Choose another</button>
          </div>
        </div>
      ) : (
        <>
          <SourceBar total={total} inT={inT} span={span} locked={locked} strip={strips[mediaKey(base.source.assetId, base.source.versionId)]} peaks={peaks[mediaKey(base.source.assetId, base.source.versionId)]} onChange={onBar}
            srcAt={time === undefined ? undefined : clipTimeAt({ ...base, sourceInTicks: inT }, time)?.source} />
          <div className="v2-slip-row" role="group" aria-label="Range start">
            <button type="button" className="v2-btn" aria-label="One frame earlier" disabled={inT <= 0} onClick={() => setIn(inT - frame)}>−</button>
            <label className="v2-slip-num">Start <input type="number" step="0.01" min={0} inputMode="decimal" aria-label="Start in seconds" value={Math.round(ticksToSeconds(inT) * 1000) / 1000}
              onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setIn(n * TICKS_PER_SECOND); }} /> s</label>
            <button type="button" className="v2-btn" aria-label="One frame later" disabled={inT >= clampIn(Infinity)} onClick={() => setIn(inT + frame)}>+</button>
          </div>
          <dl className="v2-slip-read is-compact" aria-live="polite">
            <div><dt>In</dt><dd data-testid="slip-in">{fmt(inT)}</dd></div>
            <div><dt>Out</dt><dd data-testid="slip-out">{fmt(outT)}</dd></div>
            <div><dt>Change</dt><dd data-testid="slip-delta">{signed(delta)}</dd></div>
            {!locked && <div><dt>Clip length</dt><dd>{fmt(durNow)}</dd></div>}
          </dl>
          {kind === "media" && !live && (
            <label className="v2-slip-check"><input type="checkbox" checked={locked} onChange={(e) => { setLocked(e.target.checked); if (e.target.checked) setSpan(slip.spanOf(base)); }} /> Lock clip length <span className="v2-abnote" title={locked ? "Edges locked: drag the box to slip." : "Edges change the clip length; ripple follows your ripple setting."}>{locked ? "(drag the box)" : "(edges change length)"}</span></label>
          )}
          {linkedNote}
        </>
      )}
    </div>
  );
}

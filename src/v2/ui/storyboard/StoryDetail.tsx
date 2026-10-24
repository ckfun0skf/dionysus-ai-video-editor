import { useEffect, useRef, useState, type ReactNode } from "react";
import { board, storyRefs, TICKS_PER_SECOND, type AssetSlot, type AssetVersion, type MediaKind, type MediaRef, type Project, type Shot } from "../../domain";
import { cmd, type Command, type Engine } from "../../engine";
import { importFile } from "../../persistence";
import type { BlobStore } from "../../ports";
import { Ic } from "../Icon";
import { extFor, safeName, saveFile } from "../saveFile";
import { Sheet } from "../Sheet";
import { type BoardTarget, LengthWarn, shotIcon, Thumb, TYPE_ICON, Warn } from "./BoardView";
import { extractLastFrame } from "./lastFrame";
import { CopyButton } from "./StoryImport";
import { TrimPicker } from "./TrimPicker";

const ACCEPT: Partial<Record<MediaKind, string>> = { image: "image/*", video: "video/*", audio: "audio/*", html: ".html,.htm,text/html" };
const KIND_NAME: Partial<Record<MediaKind, string>> = { image: "an image", html: "an HTML file", audio: "an audio file", video: "a video file" };
const kindName = (k: MediaKind) => KIND_NAME[k] ?? `a ${k} file`;
const fmtDate = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };

/** Details for one shot or asset slot: versions (pick one), upload, prompt to copy, last-frame extraction. */
export function StoryDetail({ project, target, thumbs, engine, blobs, mobile, onClose, onOpen, inline, head, onEdit }: {
  project: Project; target: BoardTarget; thumbs: Record<string, string>; engine: Engine; blobs: BlobStore; mobile: boolean;
  onClose: () => void; onOpen: (t: BoardTarget) => void;
  /** V2-CUT-02 / V2-CUT-05: open the shot or asset editor. */
  onEdit?: () => void;
  /** Production wizard: render in place (no sheet / side panel) under `head`. */
  inline?: boolean; head?: ReactNode;
}) {
  const b = project.storyboard!;
  const isSlot = "slot" in target;
  const owner: AssetSlot | Shot | undefined = isSlot ? b.slots[target.slot] : b.shots[target.shot];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const [model, setModel] = useState("");
  const [swapNote, setSwapNote] = useState<string>();
  const [refNote, setRefNote] = useState<string>();
  /** V2-SB-121: the trim dialog, for a long upload or for "Adjust trim" on a version. */
  const [trimFor, setTrimFor] = useState<{ mode: "upload"; clip: Blob; media: MediaRef; model?: string } | { mode: "adjust"; clip: Blob; version: AssetVersion }>();
  useEffect(() => { if (!refNote) return; const t = setTimeout(() => setRefNote(undefined), 6000); return () => clearTimeout(t); }, [refNote]);
  useEffect(() => { if (!swapNote) return; const t = setTimeout(() => setSwapNote(undefined), 6000); return () => clearTimeout(t); }, [swapNote]);
  if (!owner) return null;
  const shotNo = (id: string) => b.order.indexOf(id) + 1;
  const slot = isSlot ? (owner as AssetSlot) : undefined;
  const shot = isSlot ? undefined : (owner as Shot);
  /** html/still shot: its clip is this slot (versions, upload and checks of the clip live there). */
  const clipSlot = shot?.clipSlot ? b.slots[shot.clipSlot] : undefined;
  const kind: MediaKind = slot ? board.kindForSlot(slot.type) : clipSlot ? board.kindForSlot(clipSlot.type) : "video";
  const versions = board.versionsOf(project, owner);
  const selected = board.selectedOf(project, owner);
  const status = board.storyStatus(project);
  const st = isSlot ? status.slots[owner.id] : status.shots[owner.id];
  const title = slot ? slot.name : `Shot ${shotNo(owner.id)} · ${shot!.title}`;
  const icon = slot ? TYPE_ICON[slot.type] ?? "image" : shotIcon(shot!);
  const lf = slot?.source.type === "lastFrame" ? slot.source.shotId : undefined;
  const lfShot = lf ? b.shots[lf] : undefined;
  const lfVersion = lfShot ? board.selectedOf(project, lfShot) : undefined;
  /** V2-CUT-05: shots that pin a version of this slot. */
  const pins = slot ? b.order.flatMap((id) => { const v = board.pinOf(project, b.shots[id], slot.id); return v ? [{ shot: id, version: v }] : []; }) : [];
  /** Pin (or follow) a reference version for this shot; say what changed on the timeline. */
  const pin = (slotId: string, versionId: string | null) => {
    if (!shot) return;
    const before = engine.getState().project;
    engine.dispatch(cmd.setRefOverride(shot.id, slotId, versionId));
    const after = engine.getState().project;
    const s = after.storyboard?.slots[slotId];
    if (!s || after === before) return;
    const aid = s.assetId;
    const ver = (p: Project) => new Map(Object.values(p.compositions).flatMap((c) => c.tracks.flatMap((t) => t.placements.filter((pl) => pl.source.assetId === aid).map((pl) => [pl.id, pl.source.versionId] as const))));
    const was = ver(before);
    const moved = [...ver(after)].filter(([id, v]) => was.get(id) !== v).length;
    const vNo = (id?: string) => board.versionsOf(after, s).findIndex((v) => v.id === id) + 1;
    const what = versionId ? `Shot ${shotNo(shot.id)} keeps v${vNo(versionId)} of “${s.name}”` : `Shot ${shotNo(shot.id)} follows “${s.name}” again (v${vNo(board.selectedOf(after, s))})`;
    setRefNote(`${what}${moved ? ` · ${moved} layer${moved > 1 ? "s" : ""} on the timeline updated` : ""} · Undo to go back`);
  };

  /** Change the version in use; when linked timeline clips change length, say so (V2-SB-R01). */
  const swap = (c: Command) => {
    const before = engine.getState().project;
    engine.dispatch(c);
    const after = engine.getState().project;
    const nb = after.storyboard, o = nb && (isSlot ? nb.slots[owner.id] : nb.shots[owner.id]);
    const changes = o?.assetId ? board.linkedLengthChanges(before, after, o.assetId) : [];
    if (!changes.length || !o?.assetId) return;
    const a = after.assets[o.assetId];
    const vNo = a.versions.findIndex((v) => v.id === a.selectedVersionId) + 1;
    const sec = (t: number) => `${Math.round(t / 12_000) / 10} s`;
    const { fromTicks, toTicks } = changes[0];
    setSwapNote(`${shot ? `Shot ${shotNo(owner.id)}` : slot!.name} on timeline updated to v${vNo} (${sec(toTicks)}, was ${sec(fromTicks)})${changes.length > 1 ? ` · ${changes.length} clips` : ""}`);
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setErr(undefined); setBusy(label);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(undefined); }
  };
  const upload = (f: File) => run("Adding…", async () => {
    const a = await importFile(f, blobs);
    if (!a) throw new Error("That file type isn't supported.");
    const media = a.versions[0].media;
    if (a.kind !== kind) { await blobs.delete(media.blobKey).catch(() => undefined); throw new Error(`This needs ${kindName(kind)}, but “${f.name}” is ${kindName(a.kind)}.`); }
    // V2-SB-121: a shot clip more than 0.5 s longer than planned: trim it or keep it whole (one undo step either way).
    if (shot && !clipSlot && kind === "video" && media.durationTicks && media.durationTicks / TICKS_PER_SECOND > shot.durationSec + 0.5) {
      setTrimFor({ mode: "upload", clip: f, media, model: model.trim() || undefined });
      return;
    }
    swap(cmd.addStoryVersion(target, media, model.trim() ? { model: model.trim() } : {}));
  });
  const adjustTrim = (v: AssetVersion) => run("Opening the clip…", async () => {
    const blob = await blobs.get(v.media.blobKey);
    if (!blob) throw new Error("The clip's file is missing from this device.");
    setTrimFor({ mode: "adjust", clip: blob, version: v });
  });
  const trimDialog = () => {
    if (!trimFor || !shot) return null;
    const total = (trimFor.mode === "upload" ? trimFor.media.durationTicks : trimFor.version.media.durationTicks) ?? 0;
    const totalSec = total / TICKS_PER_SECOND, win = Math.min(shot.durationSec, totalSec);
    const range = (inSec: number) => ({ inTicks: Math.round(inSec * TICKS_PER_SECOND), outTicks: Math.min(total, Math.round((inSec + win) * TICKS_PER_SECOND)) });
    const close = () => setTrimFor(undefined);
    if (trimFor.mode === "upload") {
      const { media, model: m } = trimFor;
      return <TrimPicker clip={trimFor.clip} totalSec={totalSec} windowSec={shot.durationSec} mode="upload"
        onTrim={(x) => { close(); swap(cmd.addTrimmedShotVersion(shot.id, media, { trim: range(x), model: m })); }}
        onFull={() => { close(); swap(cmd.addTrimmedShotVersion(shot.id, media, { keepFullSec: Math.round(totalSec * 100) / 100, model: m })); }}
        onCancel={() => { close(); void blobs.delete(media.blobKey).catch(() => undefined); }} />;
    }
    const v = trimFor.version, t = b.versions[v.id]?.trim;
    return <TrimPicker clip={trimFor.clip} totalSec={totalSec} windowSec={shot.durationSec} mode="adjust" initialInSec={t ? t.inTicks / TICKS_PER_SECOND : undefined}
      onTrim={(x) => { close(); if (owner.assetId) swap(cmd.setVersionTrim(owner.assetId, v.id, range(x))); }}
      onFull={() => { close(); if (owner.assetId) swap(cmd.setVersionTrim(owner.assetId, v.id, undefined)); }}
      onCancel={close} />;
  };
  const useLastFrame = () => run("Taking the last frame…", async () => {
    const v = lfShot && board.versionsOf(project, lfShot).find((x) => x.id === lfVersion);
    if (!v || !lf) throw new Error("Shot has no clip yet.");
    const blob = await blobs.get(v.media.blobKey);
    if (!blob) throw new Error("The clip's file is missing from this device.");
    // V2-SB-121: the clip ends where its trim ends.
    const span = board.versionSpan(b, v);
    const fr = await extractLastFrame(blob, 8000, span && span.inTicks + span.lenTicks < (v.media.durationTicks ?? 0) ? (span.inTicks + span.lenTicks) / TICKS_PER_SECOND : undefined);
    const key = `lastframe/${owner.id}/${v.id}/${Date.now()}`;
    await blobs.put(key, fr.blob);
    engine.dispatch(cmd.addStoryVersion(target, { blobKey: key, mime: "image/png", width: fr.width, height: fr.height }, { derivedFrom: { shotId: lf, versionId: v.id } }));
  });

  const body = (
    <div className="v2-sb-detail-body">
      {head}
      {(inline || !mobile) && <div className="v2-sb-detail-head"><Ic g={icon} size={18} /><h3>{title}</h3>{onEdit && <button className="v2-btn v2-sb-btn" onClick={onEdit} title={shot ? "Edit title, length, prompt, references, how the clip is made, checks…" : "Edit name, type, prompt, what it is made from, checks…"}><Ic g="✎" size={16} /> Edit</button>}{!inline && <button className="v2-icon v2-sb-icon" aria-label="Close details" title="Close (Esc)" onClick={onClose}><Ic g="✕" size={18} /></button>}</div>}
      {shot && <p className="v2-sb-detail-desc">{shot.durationSec}s{shot.genDurationSec ? <> · <span title="Ask the video model for this length; the upload is trimmed to the shot length">generate {shot.genDurationSec}s</span></> : null} · {shot.description}</p>}
      {clipSlot && (
        <p className="v2-sb-cliplink" role="note">
          <Ic g={TYPE_ICON[clipSlot.type] ?? "image"} size={14} /> {shot!.render === "html" ? "Plays the HTML" : "Shows the still"} “{clipSlot.name}” for {shot!.durationSec} s. Its versions are shared with that asset.{" "}
          <button className="v2-linkbtn" onClick={() => onOpen({ slot: clipSlot.id })}>Open “{clipSlot.name}”</button>
        </p>
      )}
      {st?.stale && <div className="v2-sb-warnbox" role="note"><Warn st={st} /><ul>{st.reasons.map((r) => <li key={r}>{r}</li>)}</ul><p>Upload a new version made with the current assets, or keep this one if it still looks right.</p></div>}

      <Section title={versions.length ? `Versions (${versions.length})` : "Versions"}>
        {versions.length ? (
          <ul className="v2-sb-versions" aria-label="Versions">
            {versions.map((v, i) => {
              const on = v.id === selected;
              const info = b.versions[v.id];
              const pinnedIn = slot ? pins.filter((x) => x.version === v.id).map((x) => shotNo(x.shot)) : [];
              // V2-SB-121: shot clips longer than planned (or already trimmed) can be trimmed here.
              const span = shot && !clipSlot ? board.versionSpan(b, v) : undefined;
              const trimmed = span && info?.trim ? span : undefined;
              const canTrim = !!span && (!!trimmed || (v.media.durationTicks ?? 0) / TICKS_PER_SECOND > shot!.durationSec + 0.5);
              const s1 = (t: number) => Math.round(t / 12_000) / 10;
              return (
                <li key={v.id}>
                  <button className={`v2-sb-version ${on ? "on" : ""}`} aria-pressed={on} title={on ? undefined : "Use this version"}
                    onClick={() => { if (!on && owner.assetId) swap(cmd.selectStoryVersion(owner.assetId, v.id)); }}>
                    <Thumb src={thumbs[v.id]} icon={icon} count={0} />
                    <span><b>v{i + 1}{on && <span className="v2-sb-inuse"><Ic g="ok" size={13} /> In use</span>}</b><em>{info?.derivedFrom ? `Frame of shot ${shotNo(info.derivedFrom.shotId)}` : fmtDate(v.createdAt)}</em>{info?.model && <em title="Made with">{info.model}</em>}{pinnedIn.length > 0 && <em className="v2-sb-pinned"><Ic g="pin" size={12} /> Pinned in shot {pinnedIn.join(", ")}</em>}{trimmed && <em className="v2-sb-trimmed" title="Part of the clip in use"><Ic g="✂" size={12} /> {s1(trimmed.inTicks)}–{s1(trimmed.inTicks + trimmed.lenTicks)} s of {s1(v.media.durationTicks ?? 0)} s</em>}</span>
                  </button>
                  {canTrim && <button className="v2-btn v2-sb-trimbtn" disabled={!!busy} onClick={() => adjustTrim(v)} aria-label={`Adjust trim of v${i + 1}`} title="Choose which part of the clip the shot uses"><Ic g="✂" size={14} /> {trimmed ? "Adjust trim" : "Trim"}</button>}
                </li>
              );
            })}
          </ul>
        ) : <p className="v2-hint">{lf ? `Nothing yet. Use the last frame of shot ${shotNo(lf)} once it has a clip, or upload an image.` : `Nothing yet. ${slot?.source.type === "upload" ? "Upload your file" : "Generate it in your AI tool with the prompt below"}, then add it here.`}</p>}
        {slot && pins.length > 0 && versions.length > 1 && <p className="v2-hint">{pins.length > 1 ? "Shots" : "Shot"} {pins.map((x) => shotNo(x.shot)).join(", ")} {pins.length > 1 ? "keep their" : "keeps its"} pinned version when you pick another one here.</p>}
        {shot && board.shotLengthMismatch(project, shot) && <p className="v2-sb-lenline"><LengthWarn project={project} shot={shot} /></p>}
        <div className="v2-sb-actions">
          {lf && (
            <button className="v2-btn primary v2-sb-btn" disabled={!lfVersion || !!busy} onClick={useLastFrame} title={lfVersion ? "Grab the final frame of the selected clip" : `Shot ${shotNo(lf)} needs a clip first`}>
              <Ic g="link" size={16} /> Use last frame of shot {shotNo(lf)}
            </button>
          )}
          {!lf && <input className="v2-sb-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Made with (optional), e.g. Veo 3" aria-label="AI tool or model used (saved with the upload)" maxLength={60} />}
          <button className={`v2-btn v2-sb-btn ${lf ? "" : "primary"}`} disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <Ic g="⇪" size={16} /> {versions.length ? "Upload new version" : clipSlot ? (kind === "html" ? "Upload HTML" : "Upload image") : shot ? "Upload clip" : kind === "html" ? "Upload HTML" : "Upload"}
          </button>
          <input ref={fileRef} type="file" hidden accept={ACCEPT[kind]} aria-label={`Upload ${kind} for ${title}`}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
        </div>
        {lf && !lfVersion && <p className="v2-hint">Shot {shotNo(lf)} needs a clip first. <button className="v2-linkbtn" onClick={() => onOpen({ shot: lf })}>Open shot {shotNo(lf)}</button></p>}
        {swapNote && <p className="v2-sb-swapnote" role="status"><Ic g="to-timeline" size={14} /> {swapNote}</p>}
        {busy && <p className="v2-hint" role="status">{busy}</p>}
        {err && <p className="v2-sb-err" role="alert"><Ic g="alert" size={14} /> {err}</p>}
      </Section>

      {owner.prompt && (
        <Section title={shot ? "Clip prompt" : "Prompt"} extra={<CopyButton text={() => (shot ? storyRefs.promptWithReferences(b, shot) : slot ? storyRefs.slotPromptWithReferences(b, slot) : owner.prompt)} label="Copy prompt" testId="copy-clip-prompt" />}>
          <p className="v2-sb-prompt">{owner.prompt}</p>
          {(shot || slot) && <AttachOrder shot={shot} slot={shot ? undefined : slot} project={project} thumbs={thumbs} blobs={blobs} />}
        </Section>
      )}
      {shot && (shot.camera || shot.dialogue) && <Section title="Direction">{shot.camera && <p className="v2-sb-kv"><b>Camera</b> {shot.camera}</p>}{shot.dialogue && <p className="v2-sb-kv"><b>Dialogue</b> {shot.dialogue}</p>}</Section>}
      {shot && <ShotLayers shot={shot} project={project} onOpen={onOpen} />}
      {shot && <ShotRefs shot={shot} project={project} thumbs={thumbs} onOpen={onOpen} onPin={pin} onEdit={onEdit} note={refNote} />}
      {slot && slot.references.length > 0 && <Section title="Made using"><Chips ids={slot.references} project={project} thumbs={thumbs} onOpen={onOpen} /></Section>}
      {slot && <UsedIn slot={slot} project={project} onOpen={onOpen} />}
      {owner.qa.length > 0 && <Checks owner={owner} selected={selected} project={project} engine={engine} />}
      <div className="v2-sb-actions">
        <button className="v2-btn v2-sb-btn" aria-pressed={!!owner.skipped} title={owner.skipped ? "Put this back on the production list" : "Not needed — leave it off the production list"} onClick={() => engine.dispatch(cmd.setStorySkipped(target, !owner.skipped))}>
          <Ic g={owner.skipped ? "↶" : "skip"} size={16} /> {owner.skipped ? "Include again" : "Skip this"}
        </button>
      </div>
      {slot?.notes && <Section title="Notes"><p className="v2-sb-prompt">{slot.notes}</p></Section>}
      {trimDialog()}
    </div>
  );
  if (inline) return <section className="v2-sb-inline" aria-label={title}>{body}</section>;
  return mobile
    ? <Sheet label={title} onClose={onClose} className="v2-sb-sheet" initial={2} extra={onEdit && <button className="v2-btn v2-sb-btn" onClick={onEdit}><Ic g="✎" size={16} /> Edit</button>}>{body}</Sheet>
    : <aside className="v2-sb-detail" role="dialog" aria-label={title}>{body}</aside>;
}

function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return <section className="v2-sb-sec"><div className="v2-sb-sec-head"><h4>{title}</h4>{extra}</div>{children}</section>;
}

function Chips({ ids, project, thumbs, onOpen }: { ids: string[]; project: Project; thumbs: Record<string, string>; onOpen: (t: BoardTarget) => void }) {
  const b = project.storyboard!;
  return (
    <ul className="v2-sb-slots">
      {ids.map((id) => b.slots[id]).filter(Boolean).map((s) => {
        const v = board.selectedOf(project, s);
        return <li key={s.id}><button className="v2-sb-slot" onClick={() => onOpen({ slot: s.id })}><Thumb src={v && thumbs[v]} icon={TYPE_ICON[s.type] ?? "image"} count={0} /><span className="v2-sb-slot-text"><b>{s.name}</b><em>{board.versionsOf(project, s).length ? `${board.versionsOf(project, s).length} version${board.versionsOf(project, s).length > 1 ? "s" : ""}` : "Not added yet"}</em></span></button></li>;
      })}
    </ul>
  );
}

/**
 * A shot's references (V2-CUT-05): the version each one uses for this shot, with a picker to pin one.
 * The picker is a native select, so phones get the system wheel / list.
 */
function ShotRefs({ shot, project, thumbs, onOpen, onPin, onEdit, note }: { note?: string; shot: Shot; project: Project; thumbs: Record<string, string>; onOpen: (t: BoardTarget) => void; onPin: (slotId: string, versionId: string | null) => void; onEdit?: () => void }) {
  const b = project.storyboard!;
  const ids = storyRefs.shotRefIds(b, shot);
  const layerAssets = new Set((shot.layers ?? []).flatMap((l) => (l.type === "text" ? [] : [l.asset])));
  if (!ids.length && !onEdit) return null;
  return (
    <Section title={ids.length ? `References (${ids.length})` : "References"} extra={onEdit && <button className="v2-linkbtn" onClick={onEdit}>Edit references</button>}>
      {ids.length ? (
        <ul className="v2-sb-refs" aria-label="References">
          {ids.map((id) => {
            const s = b.slots[id];
            const vs = board.versionsOf(project, s);
            const pinned = board.pinOf(project, shot, id);
            const used = board.refVersionOf(project, shot, id);
            const no = (v?: string) => vs.findIndex((x) => x.id === v) + 1;
            const sub = !vs.length ? "Not added yet" : pinned ? `Pinned v${no(pinned)} for this shot` : `Uses v${no(used)} · in use`;
            return (
              <li key={id} className={pinned ? "pinned" : ""}>
                <button className="v2-sb-slot" onClick={() => onOpen({ slot: id })} aria-label={`${s.name}: ${sub}${layerAssets.has(id) ? ", also a layer" : ""}`}>
                  <Thumb src={used && thumbs[used]} icon={TYPE_ICON[s.type] ?? "image"} count={0} />
                  <span className="v2-sb-slot-text"><b>{s.name}</b><em>{pinned && <Ic g="pin" size={12} />} {sub}{layerAssets.has(id) ? " · layer" : ""}</em></span>
                </button>
                {vs.length > 0 && (
                  <select className="v2-sb-refpick" aria-label={`Version of ${s.name} for this shot`} value={pinned ?? ""} onChange={(e) => onPin(id, e.target.value || null)}>
                    <option value="">Follow asset (v{no(board.selectedOf(project, s))})</option>
                    {vs.map((v, i) => <option key={v.id} value={v.id}>Pin v{i + 1}</option>)}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="v2-hint">No reference assets yet. Add the characters, places, props or frames this shot is made from.</p>}
      {note && <p className="v2-sb-swapnote" role="status"><Ic g="pin" size={14} /> {note}</p>}
      {ids.some((id) => board.versionsOf(project, b.slots[id]).length > 1) && <p className="v2-hint">Pin a version to keep this shot on it when the asset changes; other shots follow the version in use.</p>}
    </Section>
  );
}

/**
 * "Attach in this order" (V2-SB-120): the images to give the video model with the clip prompt, numbered as the
 * prompt's References block names them, each with the version this shot uses (pins respected), its role and a Save
 * button. Blobs are loaded ahead so Save can open the iOS share sheet within the tap.
 */
function AttachOrder({ shot, slot, project, thumbs, blobs }: { shot?: Shot; slot?: AssetSlot; project: Project; thumbs: Record<string, string>; blobs: BlobStore }) {
  const b = project.storyboard!;
  const owner = (shot ?? slot)!;
  const rows = storyRefs.attachVersions(project, owner);
  const labels = shot ? storyRefs.ROLE_LABEL : storyRefs.ASSET_ROLE_LABEL;
  const filePrefix = shot ? `shot${b.order.indexOf(shot.id) + 1}` : safeName(owner.id);
  const media = (versionId?: string, slotId?: string) => {
    const s = slotId ? b.slots[slotId] : undefined;
    return versionId && s ? board.versionsOf(project, s).find((v) => v.id === versionId)?.media : undefined;
  };
  const keys = rows.map((r) => media(r.versionId, r.item.slotId)?.blobKey ?? "").join("|");
  const [loaded, setLoaded] = useState<Record<string, Blob>>({});
  const [note, setNote] = useState<string>();
  useEffect(() => {
    let live = true;
    const want = keys.split("|").filter(Boolean);
    void Promise.all(want.map(async (k) => [k, await blobs.get(k).catch(() => undefined)] as const)).then((xs) => {
      if (live) setLoaded(Object.fromEntries(xs.filter((x): x is readonly [string, Blob] => !!x[1])));
    });
    return () => { live = false; };
  }, [keys, blobs]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(undefined), 5000); return () => clearTimeout(t); }, [note]);
  if (!rows.length) return null;
  const added = !storyRefs.hasReferencesBlock(owner.prompt);
  const save = async (no: number, name: string, key: string, mime: string) => {
    const blob = loaded[key] ?? (await blobs.get(key));
    if (!blob) { setNote("This image's file is missing from this device."); return; }
    const r = await saveFile(blob, `${filePrefix}-image${no}-${safeName(name)}.${extFor(blob.type || mime)}`);
    if (r === "downloaded") setNote(`Image ${no} downloaded`);
  };
  return (
    <div className="v2-sb-attach" data-testid="attach-order">
      <h5>Attach in this order</h5>
      <ol className="v2-sb-attach-list" aria-label="Images to attach, in order">
        {rows.map(({ item, versionId }) => {
          const s = b.slots[item.slotId];
          const m = media(versionId, item.slotId);
          const vNo = board.versionsOf(project, s).findIndex((v) => v.id === versionId) + 1;
          const pinned = !!shot && !!board.pinOf(project, shot, item.slotId);
          const role = labels[item.role];
          return (
            <li key={item.slotId} className={`v2-sb-attach-item role-${item.role}`}>
              <span className="v2-sb-attach-no" aria-hidden>{item.no}</span>
              <Thumb src={versionId && thumbs[versionId]} icon={TYPE_ICON[s.type] ?? "image"} count={0} />
              <span className="v2-sb-slot-text">
                <b>Image {item.no} · {s.name}</b>
                <em><span className="v2-sb-role">{role}</span>{vNo > 0 ? ` · ${pinned ? "pinned " : ""}v${vNo}` : " · not added yet"}{item.note ? ` · ${item.note}` : ""}</em>
              </span>
              <button className="v2-btn v2-sb-btn v2-sb-attach-save" disabled={!m} aria-label={`Save image ${item.no}: ${s.name}`} title={m ? "Save this image to attach it in your AI tool" : "Upload a version of this asset first"}
                onClick={() => m && void save(item.no, s.name, m.blobKey, m.mime)}>
                <Ic g="⇩" size={16} /> Save
              </button>
            </li>
          );
        })}
      </ol>
      <p className="v2-hint">{added ? "Copy prompt adds a numbered References block that says how to use each image." : "The prompt already has a References block; check it matches this order."}</p>
      {note && <p className="v2-sb-swapnote" role="status">{note}</p>}
    </div>
  );
}

const secs = (a?: number, z?: number) => (a === undefined && z === undefined ? "" : ` · ${a ?? 0}–${z === undefined ? "end" : `${z} s`}`);

/** What "Send to timeline" adds with this shot (v1.1): text and media layers, captions, effects. */
function ShotLayers({ shot, project, onOpen }: { shot: Shot; project: Project; onOpen: (t: BoardTarget) => void }) {
  const b = project.storyboard!;
  const layers = shot.layers ?? [], effects = shot.effects ?? [];
  if (!layers.length && !effects.length && !shot.captions) return null;
  return (
    <Section title="Layers & effects">
      <ul className="v2-sb-layers">
        {layers.map((l, i) => l.type === "text"
          ? <li key={i}><Ic g="T" size={14} /> <span>Text “{l.text.split("\n").join(" / ")}”{l.textStyle ? ` · ${l.textStyle}` : ""}{secs(l.startSec, l.endSec)}</span></li>
          : <li key={i}><Ic g={TYPE_ICON[l.type] ?? "image"} size={14} /> <span>{l.type === "html" ? "HTML" : l.type === "image" ? "Image" : "Video"} layer{" "}
              {b.slots[l.asset] ? <button className="v2-linkbtn" onClick={() => onOpen({ slot: l.asset })}>{b.slots[l.asset].name}</button> : l.asset}{secs(l.startSec, l.endSec)}</span></li>)}
        {shot.captions && <li><Ic g="≡" size={14} /> <span>Captions from the dialogue{shot.dialogue ? "" : " (none written)"}</span></li>}
        {effects.map((e, i) => <li key={`e${i}`}><Ic g="effect" size={14} /> <span>Effect {e.preset}{secs(e.startSec, e.endSec)}</span></li>)}
      </ul>
      <p className="v2-hint">Added with the shot by Send to timeline. They follow the shot when you swap its version.</p>
    </Section>
  );
}

function UsedIn({ slot, project, onOpen }: { slot: AssetSlot; project: Project; onOpen: (t: BoardTarget) => void }) {
  const b = project.storyboard!;
  const shots = b.order.filter((id) => b.shots[id] && storyRefs.shotRefIds(b, b.shots[id]).includes(slot.id));
  if (!shots.length) return null;
  return <Section title="Used in"><div className="v2-sb-actions">{shots.map((id) => { const pin = storyRefs.pinLabel(project, b.shots[id], slot.id); return <button key={id} className="v2-btn v2-sb-btn" onClick={() => onOpen({ shot: id })}><Ic g="▭" size={14} /> Shot {b.order.indexOf(id) + 1}{pin && <span className="v2-sb-pinned"> · <Ic g="pin" size={12} /> {pin}</span>}</button>; })}</div></Section>;
}

/** QA checklist for the version in use: pass / fail per check, saved with that version (V2-CUT-10). */
function Checks({ owner, selected, project, engine }: { owner: AssetSlot | Shot; selected?: string; project: Project; engine: Engine }) {
  const res = (selected && project.storyboard!.versions[selected]?.qa) || {};
  const done = owner.qa.filter((q) => res[q.id] === "pass").length;
  return (
    <Section title={selected ? `Checks · ${done}/${owner.qa.length} passed` : "Checks"}>
      {!selected && <p className="v2-hint">Upload a version, then tick these off.</p>}
      <ul className="v2-sb-qa">
        {owner.qa.map((q) => {
          const r = res[q.id];
          const set = (v: "pass" | "fail") => selected && engine.dispatch(cmd.setQaResult(selected, q.id, r === v ? undefined : v));
          return (
            <li key={q.id} className={r ?? ""}>
              <span className="v2-sb-qa-text"><Ic g={r === "pass" ? "ok" : r === "fail" ? "alert" : "☑"} size={14} /> {q.text}</span>
              {selected && <span className="v2-sb-qa-btns" role="group" aria-label={`Check: ${q.text}`}>
                <button className={`v2-sb-qa-btn ${r === "pass" ? "on" : ""}`} aria-pressed={r === "pass"} title="Looks right" onClick={() => set("pass")}>Pass</button>
                <button className={`v2-sb-qa-btn fail ${r === "fail" ? "on" : ""}`} aria-pressed={r === "fail"} title="Needs another version" onClick={() => set("fail")}>Fail</button>
              </span>}
            </li>
          );
        })}
      </ul>
      {owner.qa.some((q) => res[q.id] === "fail") && <p className="v2-hint">Failed? Generate it again and upload it as a new version — the old one stays here.</p>}
    </Section>
  );
}

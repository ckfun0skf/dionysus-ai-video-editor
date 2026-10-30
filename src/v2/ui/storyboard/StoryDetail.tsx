import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { board, cleanParamDecls, htmlClipPackagePrompt, readManifest, resolveHtmlParams, type HtmlClipParam, type HtmlParamValues, lintHtmlClip, runtimeAiLinks, slotBindings, slotPackageInput, story, storyRefs, TICKS_PER_SECOND, type AssetSlot, type AssetVersion, type MediaKind, type MediaRef, type Project, type Shot } from "../../domain";
import { cmd, type Command, type Engine } from "../../engine";
import { importFile } from "../../persistence";
import { CLIP_LIBRARIES } from "../../render";
import { AssetPreview, blobText, type PreviewKind } from "../AssetPreview";
import { CodeEditor } from "../CodeEditor";
import { htmlParamSpecs } from "../HtmlParamsPanel";
import { HtmlExportButtons, HtmlImport } from "../HtmlImport";
import { ParamControls } from "../ParamControls";
import { HTML_IMPORT_ACCEPT, importHtmlPackage } from "../htmlPackage";
import type { BlobStore } from "../../ports";
import { Ic } from "../Icon";
import { extFor, safeName, saveFile } from "../saveFile";
import { Sheet } from "../Sheet";
import { type BoardTarget, LengthWarn, shotIcon, Thumb, TYPE_ICON, Warn } from "./BoardView";
import { extractLastFrame } from "./lastFrame";
import { CopyButton } from "./StoryImport";
import { AudioTrim } from "./AudioTrim";
import { StoryAssetPicker, type LibraryEntry } from "./StoryAssetPicker";
import { TrimPicker } from "./TrimPicker";

const ACCEPT: Partial<Record<MediaKind, string>> = { image: "image/*", video: "video/*", audio: "audio/*", html: HTML_IMPORT_ACCEPT };
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
  const [trimFor, setTrimFor] = useState<{ mode: "upload"; clip: Blob; media: MediaRef; model?: string; shared?: boolean } | { mode: "adjust"; clip: Blob; version: AssetVersion }>();
  /** P2C: the Add version picker, a version's inline preview, the code being edited, the audio being trimmed. */
  const [picking, setPicking] = useState(false);
  const [peek, setPeek] = useState<string>();
  const [codeFor, setCodeFor] = useState<{ source: string; name: string }>();
  const [audioTrim, setAudioTrim] = useState<{ clip: Blob; version: AssetVersion }>();
  const modelList = useId();
  const models = board.usedModels(project);
  useEffect(() => { if (!refNote) return; const t = setTimeout(() => setRefNote(undefined), 6000); return () => clearTimeout(t); }, [refNote]);
  useEffect(() => { if (!swapNote) return; const t = setTimeout(() => setSwapNote(undefined), 6000); return () => clearTimeout(t); }, [swapNote]);
  if (!owner) return null;
  const shotNo = (id: string) => b.order.indexOf(id) + 1;
  const slot = isSlot ? (owner as AssetSlot) : undefined;
  const shot = isSlot ? undefined : (owner as Shot);
  /** html/still shot: its clip is this slot (versions, upload and checks of the clip live there). */
  const clipSlot = shot?.clipSlot ? b.slots[shot.clipSlot] : undefined;
  const kind: MediaKind = slot ? board.kindForSlot(slot.type) : clipSlot ? board.kindForSlot(clipSlot.type) : "video";
  /**
   * The part of a video clip in use: a shot clip's planned length (V2-SB-121), or for a video asset the longest
   * video layer that shows it (V2-SB-133). Undefined = nothing to trim to.
   */
  const trimWin = shot && !clipSlot ? shot.durationSec : slot?.type === "video" ? board.slotLayerSec(b, slot.id) : undefined;
  /** V2-HTML-PKG: the html asset whose package this panel imports, exports and prompts for. */
  const htmlSlot = kind === "html" ? slot ?? clipSlot : undefined;
  const expectBindings = htmlSlot ? Object.fromEntries(slotBindings(b, htmlSlot).map((x) => [x.name, x.type])) : undefined;
  const packagePrompt = (full: boolean) => htmlClipPackagePrompt(slotPackageInput(b, htmlSlot!), { libs: CLIP_LIBRARIES, specUrl: runtimeAiLinks().htmlClipSpec, full });
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
  /** Add a validated single-file HTML clip as a new version (V2-HTML-PKG). */
  const addHtml = (html: string, name: string) => run("Adding…", async () => {
    const a = await importFile(new File([html], `${name || "clip"}.html`, { type: "text/html" }), blobs);
    if (!a) throw new Error("Couldn't store the clip.");
    swap(cmd.addStoryVersion(target, a.versions[0].media, model.trim() ? { model: model.trim() } : {}));
  });
  const upload = (f: File) => run("Adding…", async () => {
    if (kind === "html") {
      // A .html or .dionysus-html.zip: convert to the single file and validate before it becomes a version.
      const html = await importHtmlPackage(f);
      const errors = lintHtmlClip(html, { libs: CLIP_LIBRARIES, expectBindings, expectParams: htmlSlot?.params }).issues.filter((i) => i.level === "error");
      if (errors.length) throw new Error(`“${f.name}” can't be added: ${errors.map((e) => e.message).join(" ")}`);
      const a = await importFile(new File([html], f.name.replace(/(\.dionysus-html)?\.zip$/i, ".html"), { type: "text/html" }), blobs);
      if (!a) throw new Error("Couldn't store the clip.");
      swap(cmd.addStoryVersion(target, a.versions[0].media, model.trim() ? { model: model.trim() } : {}));
      return;
    }
    const a = await importFile(f, blobs);
    if (!a) throw new Error("That file type isn't supported.");
    const media = a.versions[0].media;
    if (a.kind !== kind) { await blobs.delete(media.blobKey).catch(() => undefined); throw new Error(`This needs ${kindName(kind)}, but “${f.name}” is ${kindName(a.kind)}.`); }
    // V2-SB-121: a shot clip more than 0.5 s longer than planned: trim it or keep it whole (one undo step either way).
    // V2-SB-133: a video asset longer than the layers using it: the same choice, the window being the layer length.
    if (trimWin !== undefined && kind === "video" && media.durationTicks && media.durationTicks / TICKS_PER_SECOND > trimWin + 0.5) {
      setTrimFor({ mode: "upload", clip: f, media, model: model.trim() || undefined });
      return;
    }
    swap(cmd.addStoryVersion(target, media, model.trim() ? { model: model.trim() } : {}));
  });
  /** P2C (item 7): add an existing project file (shared, not copied) as a new version. */
  const pickLibrary = (e: LibraryEntry) => run("Adding…", async () => {
    setPicking(false);
    const opts = model.trim() ? { model: model.trim() } : {};
    if (trimWin !== undefined && kind === "video" && e.media.durationTicks && e.media.durationTicks / TICKS_PER_SECOND > trimWin + 0.5) {
      const clip = await blobs.get(e.media.blobKey);
      if (!clip) throw new Error("That file is missing from this device.");
      setTrimFor({ mode: "upload", clip, media: e.media, model: opts.model, shared: true });
      return;
    }
    swap(cmd.addStoryVersion(target, e.media, opts));
  });
  /** P2C (item 4): open a version's HTML in the Code Editor; saving adds a new version. */
  const editCode = (v: AssetVersion, label: string) => run("Opening the code…", async () => {
    const blob = await blobs.get(v.media.blobKey);
    if (!blob) throw new Error("The clip's file is missing from this device.");
    setCodeFor({ source: await blobText(blob), name: `${htmlSlot?.id ?? "clip"}-${label}` });
  });
  /** P2C (item 4): trim an audio version (the part Send to timeline uses). */
  const trimAudio = (v: AssetVersion) => run("Opening the audio…", async () => {
    const blob = await blobs.get(v.media.blobKey);
    if (!blob) throw new Error("The audio file is missing from this device.");
    setAudioTrim({ clip: blob, version: v });
  });
  const audioTrimDialog = () => {
    if (!audioTrim || !owner.assetId) return null;
    const v = audioTrim.version, total = v.media.durationTicks ?? 0, t = board.versionSpan(b, v);
    const close = () => setAudioTrim(undefined);
    const aid = owner.assetId;
    return <AudioTrim clip={audioTrim.clip} name={title} totalSec={total / TICKS_PER_SECOND} initial={t ? { inSec: t.inTicks / TICKS_PER_SECOND, outSec: (t.inTicks + t.lenTicks) / TICKS_PER_SECOND } : undefined}
      onSave={(a, z) => { close(); swap(cmd.setVersionTrim(aid, v.id, { inTicks: Math.round(a * TICKS_PER_SECOND), outTicks: Math.round(z * TICKS_PER_SECOND) })); }}
      onFull={() => { close(); swap(cmd.setVersionTrim(aid, v.id, undefined)); }} onCancel={close} />;
  };
  const codeDialog = () => {
    if (!codeFor) return null;
    const host = document.querySelector(".v2-app") ?? document.body;
    return createPortal(<CodeEditor source={codeFor.source} mobile={mobile} onSave={(h) => { setCodeFor(undefined); void addHtml(h, codeFor.name); }} onClose={() => setCodeFor(undefined)} />, host);
  };
  const adjustTrim = (v: AssetVersion) => run("Opening the clip…", async () => {
    const blob = await blobs.get(v.media.blobKey);
    if (!blob) throw new Error("The clip's file is missing from this device.");
    setTrimFor({ mode: "adjust", clip: blob, version: v });
  });
  const trimDialog = () => {
    if (!trimFor || trimWin === undefined) return null;
    const total = (trimFor.mode === "upload" ? trimFor.media.durationTicks : trimFor.version.media.durationTicks) ?? 0;
    const totalSec = total / TICKS_PER_SECOND, win = Math.min(trimWin, totalSec);
    const subject = shot ? "shot" : "layer";
    const range = (inSec: number) => ({ inTicks: Math.round(inSec * TICKS_PER_SECOND), outTicks: Math.min(total, Math.round((inSec + win) * TICKS_PER_SECOND)) });
    const close = () => setTrimFor(undefined);
    if (trimFor.mode === "upload") {
      const { media, model: m } = trimFor;
      const opts = m ? { model: m } : {};
      return <TrimPicker clip={trimFor.clip} totalSec={totalSec} windowSec={trimWin} mode="upload" subject={subject}
        onTrim={(x) => { close(); swap(shot ? cmd.addTrimmedShotVersion(shot.id, media, { trim: range(x), model: m }) : cmd.addStoryVersion(target, media, { ...opts, trim: range(x) })); }}
        onFull={() => { close(); swap(shot ? cmd.addTrimmedShotVersion(shot.id, media, { keepFullSec: Math.round(totalSec * 100) / 100, model: m }) : cmd.addStoryVersion(target, media, opts)); }}
        onCancel={() => { close(); if (!trimFor.shared) void blobs.delete(media.blobKey).catch(() => undefined); }} />;
    }
    const v = trimFor.version, t = b.versions[v.id]?.trim;
    return <TrimPicker clip={trimFor.clip} totalSec={totalSec} windowSec={trimWin} mode="adjust" subject={subject} initialInSec={t ? t.inTicks / TICKS_PER_SECOND : undefined}
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
    const endSec = span && span.inTicks + span.lenTicks < (v.media.durationTicks ?? 0) ? (span.inTicks + span.lenTicks) / TICKS_PER_SECOND : undefined;
    const fr = await extractLastFrame(blob, 8000, endSec);
    const key = `lastframe/${owner.id}/${v.id}/${Date.now()}`;
    await blobs.put(key, fr.blob);
    engine.dispatch(cmd.addStoryVersion(target, { blobKey: key, mime: "image/png", width: fr.width, height: fr.height }, { derivedFrom: { shotId: lf, versionId: v.id }, ...(endSec !== undefined ? { lfEnd: endSec } : {}) }));
  });

  const body = (
    <div className="v2-sb-detail-body">
      {head}
      {(inline || !mobile) && <div className="v2-sb-detail-head"><Ic g={icon} size={18} /><h3>{title}</h3>{onEdit && <button className="v2-btn v2-sb-btn" onClick={onEdit} title={shot ? "Edit title, length, prompt, references, how the clip is made, checks…" : "Edit name, type, prompt, what it is made from, checks…"}><Ic g="✎" size={16} /> Edit</button>}{!inline && <button className="v2-icon v2-sb-icon" aria-label="Close details" title="Close (Esc)" onClick={onClose}><Ic g="✕" size={18} /></button>}</div>}
      {slot?.type === "video" && (slot.genDurationSec || trimWin !== undefined) && <p className="v2-sb-detail-desc">{slot.genDurationSec ? <span title="Ask the video model for this length">generate {slot.genDurationSec}s</span> : null}{slot.genDurationSec && trimWin !== undefined ? " · " : null}{trimWin !== undefined ? <span title="The longest video layer that shows this asset">layers use {Math.round(trimWin * 100) / 100}s</span> : null}</p>}
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
              // V2-SB-121 / V2-SB-133: clips longer than the shot (or a video asset's layers), or already trimmed, can be trimmed here.
              const span = trimWin !== undefined && kind === "video" ? board.versionSpan(b, v) : undefined;
              const trimmed = span && info?.trim ? span : undefined;
              const canTrim = !!span && (!!trimmed || (v.media.durationTicks ?? 0) / TICKS_PER_SECOND > trimWin! + 0.5);
              const s1 = (t: number) => Math.round(t / 12_000) / 10;
              const aSpan = kind === "audio" && info?.trim ? board.versionSpan(b, v) : undefined;
              const pv = (["video", "image", "audio", "html"] as MediaKind[]).includes(kind) ? (kind as PreviewKind) : undefined;
              return (
                <li key={v.id}>
                  <button className={`v2-sb-version ${on ? "on" : ""}`} aria-pressed={on} title={on ? undefined : "Use this version"}
                    onClick={() => { if (!on && owner.assetId) swap(cmd.selectStoryVersion(owner.assetId, v.id)); }}>
                    <Thumb src={thumbs[v.id]} icon={icon} count={0} />
                    <span><b>v{i + 1}{on && <span className="v2-sb-inuse"><Ic g="ok" size={13} /> In use</span>}</b><em>{info?.derivedFrom ? `Frame of shot ${shotNo(info.derivedFrom.shotId)}` : fmtDate(v.createdAt)}</em>{info?.model && <em title="Made with">{info.model}</em>}{pinnedIn.length > 0 && <em className="v2-sb-pinned"><Ic g="pin" size={12} /> Pinned in shot {pinnedIn.join(", ")}</em>}{(trimmed ?? aSpan) && <em className="v2-sb-trimmed" title="Part of the clip in use"><Ic g="✂" size={12} /> {s1((trimmed ?? aSpan)!.inTicks)}–{s1((trimmed ?? aSpan)!.inTicks + (trimmed ?? aSpan)!.lenTicks)} s of {s1(v.media.durationTicks ?? 0)} s</em>}</span>
                  </button>
                  {htmlSlot && <HtmlExportButtons small name={htmlSlot.id} label={`v${i + 1}`} html={() => blobs.get(v.media.blobKey).then((x) => x?.text())} />}
                  {pv && <span className="v2-sb-vtools">
                    <button className="v2-btn v2-sb-trimbtn" aria-expanded={peek === v.id} aria-label={`${peek === v.id ? "Hide preview of" : "Preview"} v${i + 1}`} onClick={() => setPeek(peek === v.id ? undefined : v.id)}><Ic g={peek === v.id ? "eye-off" : "▶"} size={14} /> {peek === v.id ? "Hide" : "Preview"}</button>
                    {kind === "html" && <button className="v2-btn v2-sb-trimbtn" disabled={!!busy} aria-label={`Edit code of v${i + 1}`} title="Open in the Code Editor; saving adds a new version" onClick={() => editCode(v, `v${i + 1}`)}><Ic g="</>" size={14} /> Edit code</button>}
                    {kind === "audio" && !!v.media.durationTicks && <button className="v2-btn v2-sb-trimbtn" disabled={!!busy} aria-label={`Trim v${i + 1}`} title="Choose the part of the audio to use" onClick={() => trimAudio(v)}><Ic g="✂" size={14} /> {aSpan ? "Adjust trim" : "Trim"}</button>}
                  </span>}
                  {canTrim && <button className="v2-btn v2-sb-trimbtn" disabled={!!busy} onClick={() => adjustTrim(v)} aria-label={`Adjust trim of v${i + 1}`} title={shot ? "Choose which part of the clip the shot uses" : "Choose which part of the clip its layers start from"}><Ic g="✂" size={14} /> {trimmed ? "Adjust trim" : "Trim"}</button>}
                </li>
              );
            })}
          </ul>
        ) : null}
        {(() => { const pi = versions.findIndex((x) => x.id === peek), pvv = versions[pi]; return pvv ? <div className="v2-sb-vpreview"><AssetPreview kind={kind as PreviewKind} name={`${title} v${pi + 1}`} cacheKey={pvv.id} load={() => blobs.get(pvv.media.blobKey)} durationSec={kind === "html" ? (shot?.durationSec ?? (pvv.media.durationTicks ? pvv.media.durationTicks / TICKS_PER_SECOND : undefined)) : pvv.media.durationTicks ? pvv.media.durationTicks / TICKS_PER_SECOND : undefined} width={pvv.media.width ?? project.settings?.width} height={pvv.media.height ?? project.settings?.height} /></div> : null; })()}
        {versions.length ? null : <p className="v2-hint">{lf ? `Nothing yet. Use the last frame of shot ${shotNo(lf)} once it has a clip, or upload an image.` : `Nothing yet. ${slot?.source.type === "upload" ? "Upload your file" : "Generate it in your AI tool with the prompt below"}, then add it here.`}</p>}
        {slot && pins.length > 0 && versions.length > 1 && <p className="v2-hint">{pins.length > 1 ? "Shots" : "Shot"} {pins.map((x) => shotNo(x.shot)).join(", ")} {pins.length > 1 ? "keep their" : "keeps its"} pinned version when you pick another one here.</p>}
        {shot && board.shotLengthMismatch(project, shot) && <p className="v2-sb-lenline"><LengthWarn project={project} shot={shot} /></p>}
        <div className="v2-sb-actions">
          {lf && (
            <button className="v2-btn primary v2-sb-btn" disabled={!lfVersion || !!busy} onClick={useLastFrame} title={lfVersion ? "Grab the final frame of the selected clip" : `Shot ${shotNo(lf)} needs a clip first`}>
              <Ic g="link" size={16} /> Use last frame of shot {shotNo(lf)}
            </button>
          )}
          {!lf && <div className="v2-sb-modelbox">
            <input className="v2-sb-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Made with (optional), e.g. Veo 3" aria-label="AI tool or model used (saved with the upload)" maxLength={60} list={models.length ? modelList : undefined} autoComplete="off" />
            {models.length > 0 && <datalist id={modelList}>{models.map((m) => <option key={m} value={m} />)}</datalist>}
            {models.length > 0 && <div className="v2-sb-modelchips" role="group" aria-label="Models used in this project" data-testid="model-chips">
              {models.slice(0, 6).map((m) => <button key={m} type="button" className={`v2-sb-modelchip ${model.trim().toLowerCase() === m.toLowerCase() ? "on" : ""}`} aria-pressed={model.trim().toLowerCase() === m.toLowerCase()} onClick={() => setModel(model.trim().toLowerCase() === m.toLowerCase() ? "" : m)}>{m}</button>)}
            </div>}
          </div>}
          <button className={`v2-btn v2-sb-btn ${lf ? "" : "primary"}`} disabled={!!busy} onClick={() => setPicking(true)} aria-haspopup="dialog">
            <Ic g="⇪" size={16} /> {versions.length ? "Add new version" : clipSlot ? (kind === "html" ? "Add HTML" : "Add image") : shot ? "Add clip" : kind === "html" ? "Add HTML" : "Add file"}
          </button>
          <input ref={fileRef} type="file" hidden accept={ACCEPT[kind]} aria-label={`Upload ${kind} for ${title}`}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
        </div>
        {htmlSlot && (
          <details className="v2-sb-htmlimport" open={!versions.length}>
            <summary>Paste the AI's reply or import a package</summary>
            <HtmlImport expectBindings={expectBindings} expectParams={htmlSlot?.params} busy={!!busy} onAdd={(h, n) => addHtml(h, n)} />
          </details>
        )}
        {lf && !lfVersion && <p className="v2-hint">Shot {shotNo(lf)} needs a clip first. <button className="v2-linkbtn" onClick={() => onOpen({ shot: lf })}>Open shot {shotNo(lf)}</button></p>}
        {swapNote && <p className="v2-sb-swapnote" role="status"><Ic g="to-timeline" size={14} /> {swapNote}</p>}
        {busy && <p className="v2-hint" role="status">{busy}</p>}
        {err && <p className="v2-sb-err" role="alert"><Ic g="alert" size={14} /> {err}</p>}
      </Section>

      {shot && !shot.render && <Keyframe shot={shot} project={project} thumbs={thumbs} engine={engine} onOpen={onOpen} />}
      {slot?.keyframeOf && b.shots[slot.keyframeOf] && (
        <p className="v2-hint v2-sb-kfnote">Keyframe of shot {shotNo(slot.keyframeOf)}: make this still first; the clip animates from it (Image 1, the start frame).{" "}
          <button className="v2-linkbtn" onClick={() => onOpen({ shot: slot.keyframeOf! })}>Open shot {shotNo(slot.keyframeOf)}</button></p>
      )}
      {slot?.stateOf && b.slots[slot.stateOf] && (
        <p className="v2-hint v2-sb-kfnote" data-testid="state-of">State “{slot.stateName ?? slot.id}” of “{b.slots[slot.stateOf].name}”: the same {slot.type}, with its own prompt and versions. The base image is attached first so it stays the same thing.{" "}
          <button className="v2-linkbtn" onClick={() => onOpen({ slot: slot.stateOf! })}>Open “{b.slots[slot.stateOf].name}”</button></p>
      )}
      {slot && !slot.stateOf && !storyRefs.stateBlock(b, slot.id) && <States slot={slot} project={project} thumbs={thumbs} engine={engine} onOpen={onOpen} />}
      {htmlSlot && (
        <Section title={shot ? `HTML clip prompt · ${htmlSlot.name}` : "Prompt"} extra={<span className="v2-sb-copyrow">
          <CopyButton text={() => packagePrompt(false)} label="Copy prompt" testId="copy-html-prompt" />
          <CopyButton text={() => packagePrompt(true)} label="Copy full prompt" testId="copy-html-prompt-full" />
        </span>}>
          <p className="v2-hint">The design brief plus the HTML clip package instructions (dionysus.htmlclip/1: length, size, bound assets, allowed libraries). Paste the AI's reply above. “Full” includes the whole spec, for AIs that can't open links.</p>
          {htmlSlot.prompt && <p className="v2-sb-prompt">{htmlSlot.prompt}</p>}
          {shot && <ShotHtmlParams shot={shot} slot={htmlSlot} project={project} engine={engine} blobs={blobs} />}
          {!shot && htmlSlot.params && Object.keys(htmlSlot.params).length > 0 && (
            <p className="v2-sb-kv" data-testid="v2-sb-html-params"><b>Params</b> {Object.entries(htmlSlot.params).map(([k, d]) => `${d.label || k}: ${JSON.stringify(d.default)}`).join(" · ")}</p>
          )}
        </Section>
      )}
      {owner.prompt && !(htmlSlot && slot) && (
        <Section title={shot ? "Clip prompt" : "Prompt"} extra={<CopyButton text={() => (shot ? storyRefs.promptWithReferences(b, shot) : slot ? storyRefs.slotPromptWithReferences(b, slot) : owner.prompt)} label="Copy prompt" testId="copy-clip-prompt" />}>
          <p className="v2-sb-prompt">{owner.prompt}</p>
          {(shot || slot) && <AttachOrder shot={shot} slot={shot ? undefined : slot} project={project} thumbs={thumbs} blobs={blobs} />}
        </Section>
      )}
      {shot && (shot.camera || shot.dialogue) && <Section title="Direction">{shot.camera && <p className="v2-sb-kv"><b>Camera</b> {shot.camera}</p>}{shot.dialogue && !shot.lines?.length && <p className="v2-sb-kv"><b>Dialogue</b> {shot.dialogue}</p>}{shot.lines?.length ? <DialogueLines lines={shot.lines} /> : null}</Section>}
      {shot && <ShotLayers shot={shot} project={project} onOpen={onOpen} />}
      {shot && <LayerHtmlParams shot={shot} project={project} engine={engine} blobs={blobs} />}
      {(shot || slot?.type === "audio") && <AudioCues shotId={shot?.id} assetId={shot ? undefined : slot?.id} project={project} onOpen={onOpen} />}
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
      {audioTrimDialog()}
      {codeDialog()}
      {picking && createPortal(<StoryAssetPicker project={project} kind={kind} title={`Add a version · ${title}`} exclude={owner.assetId} thumbs={thumbs} blobs={blobs}
        uploadLabel={`${kindName(kind).replace(/^an? /, "")} from this device`} onUpload={() => { setPicking(false); fileRef.current?.click(); }} onPick={(e) => void pickLibrary(e)} onClose={() => setPicking(false)} />, document.querySelector(".v2-app") ?? document.body)}
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

/** V2-SB-126: a layer with follow "shot" gets the shot's zoom and pan as keyframes on Send to timeline. */
const follows = (l: { follow?: "shot" }) => (l.follow === "shot" ? " · moves with the shot" : "");

/** What "Send to timeline" adds with this shot (v1.1): text and media layers, captions, effects. */
function ShotLayers({ shot, project, onOpen }: { shot: Shot; project: Project; onOpen: (t: BoardTarget) => void }) {
  const b = project.storyboard!;
  const layers = shot.layers ?? [], effects = shot.effects ?? [];
  if (!layers.length && !effects.length && !shot.captions) return null;
  return (
    <Section title="Layers & effects">
      <ul className="v2-sb-layers">
        {layers.map((l, i) => l.type === "text"
          ? <li key={i}><Ic g="T" size={14} /> <span>Text “{l.text.split("\n").join(" / ")}”{l.textStyle ? ` · ${l.textStyle}` : ""}{secs(l.startSec, l.endSec)}{follows(l)}</span></li>
          : <li key={i}><Ic g={TYPE_ICON[l.type] ?? "image"} size={14} /> <span>{l.type === "html" ? "HTML" : l.type === "image" ? "Image" : "Video"} layer{" "}
              {b.slots[l.asset] ? <button className="v2-linkbtn" onClick={() => onOpen({ slot: l.asset })}>{b.slots[l.asset].name}</button> : l.asset}{secs(l.startSec, l.endSec)}{follows(l)}</span></li>)}
        {shot.captions && <li><Ic g="≡" size={14} /> <span>Captions from the dialogue{shot.dialogue ? "" : " (none written)"}</span></li>}
        {effects.map((e, i) => <li key={`e${i}`}><Ic g="effect" size={14} /> <span>Effect {e.preset}{secs(e.startSec, e.endSec)}</span></li>)}
      </ul>
      <p className="v2-hint">Added with the shot by Send to timeline. They follow the shot when you swap its version.{layers.length && effects.length ? " Effects zoom and pan only the picture: layers stay fixed to the frame unless marked “moves with the shot”." : ""}</p>
    </Section>
  );
}

/** V2-SB-135: a shot's dialogue lines, off-screen ones marked (heard, not seen: no lip-sync). */
function DialogueLines({ lines }: { lines: NonNullable<Shot["lines"]> }) {
  return (
    <div className="v2-sb-kv" data-testid="dialogue-lines"><b>Dialogue</b>
      <ol className="v2-sb-dialogue">
        {lines.map((l, i) => (
          <li key={i}>{l.speaker && <b>{l.speaker}</b>}{l.offscreen && <em className="v2-sb-os" title="Off-screen: heard, not seen; not lip-synced"> (off-screen)</em>}{l.speaker || l.offscreen ? ": " : ""}{l.text}</li>
        ))}
      </ol>
    </div>
  );
}

const AUDIO_KIND_LABEL = { voiceover: "Voiceover", music: "Music", sfx: "Sound effect", ambience: "Ambience", sting: "Sting", dialogue: "Dialogue line" } as const;

/**
 * Audio cues (V2-SB-125) that play under a shot, or that place an audio asset: where they run, volume and fades.
 * Send to timeline puts them on one audio layer per kind; ambience (and music with `loop`) repeats to fill its span.
 */
function AudioCues({ shotId, assetId, project, onOpen }: { shotId?: string; assetId?: string; project: Project; onOpen: (t: BoardTarget) => void }) {
  const b = project.storyboard!;
  const no = (id: string) => b.order.indexOf(id) + 1;
  const cues = (b.audio ?? []).filter((c) => {
    if (assetId) return c.asset === assetId;
    const i = no(shotId!), from = no(c.from), to = c.to ? no(c.to) : from;
    return i >= from && i <= Math.max(from, to);
  });
  if (!cues.length) return null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Section title="Audio">
      <ul className="v2-sb-layers v2-sb-audio" data-testid="audio-cues">
        {cues.map((c) => {
          const d = story.AUDIO_DEFAULTS[c.kind];
          const where = c.to ? `shots ${no(c.from)}–${no(c.to)}` : `shot ${no(c.from)}`;
          const at = c.atSec ? ` from ${c.atSec} s` : "";
          const len = c.durationSec !== undefined ? ` · ${c.durationSec} s` : "";
          const fi = c.fadeInSec ?? d.fadeInSec, fo = c.fadeOutSec ?? d.fadeOutSec;
          const fades = fi || fo ? ` · fade ${fi} s in, ${fo} s out` : "";
          const loop = story.audioLoops(c) ? " · loops" : "";
          const line = c.line ? ` · line ${c.line}` : "";
          const name = b.slots[c.asset]?.name ?? c.asset;
          return (
            <li key={c.id}><Ic g={TYPE_ICON.audio} size={14} /> <span>{AUDIO_KIND_LABEL[c.kind]}{" "}
              {assetId ? <b>{name}</b> : <button className="v2-linkbtn" onClick={() => onOpen({ slot: c.asset })}>{name}</button>}
              {" "}· {where}{at}{len}{line} · volume {pct(c.volume ?? d.volume)}{fades}{loop}</span></li>
          );
        })}
      </ul>
      <p className="v2-hint">{assetId ? "Upload the audio file above. " : ""}Send to timeline adds {cues.length > 1 ? "these" : "this"} on audio layers, one per kind (Voiceover, Music, Ambience …); change volume and fades there.</p>
    </Section>
  );
}

/**
 * Keyframe then animate (V2-SB-124): the opening still made first, with its own prompt and versions, attached to the
 * clip as Image 1 (start frame). Without one, offer to add it.
 */
function Keyframe({ shot, project, thumbs, engine, onOpen }: { shot: Shot; project: Project; thumbs: Record<string, string>; engine: Engine; onOpen: (t: BoardTarget) => void }) {
  const b = project.storyboard!;
  const kf = shot.keyframe ? b.slots[shot.keyframe] : undefined;
  if (kf) {
    const vs = board.versionsOf(project, kf);
    const used = board.refVersionOf(project, shot, kf.id);
    const no = vs.findIndex((v) => v.id === used) + 1;
    const sub = no > 0 ? `v${no} · Image 1, the start frame` : "Not added yet · make this still first";
    return (
      <Section title="Keyframe">
        <button className="v2-sb-slot" data-testid="keyframe-open" onClick={() => onOpen({ slot: kf.id })} aria-label={`Keyframe ${kf.name}: ${sub}`}>
          <Thumb src={used && thumbs[used]} icon="image" count={0} />
          <span className="v2-sb-slot-text"><b>{kf.name}</b><em>{sub}</em></span>
        </button>
      </Section>
    );
  }
  const add = () => {
    let id = `${shot.id}.keyframe`;
    for (let i = 2; b.slots[id] || b.shots[id]; i++) id = `${shot.id}.keyframe${i}`;
    engine.dispatch(cmd.addKeyframe(shot.id, id));
    if (engine.getState().project.storyboard?.slots[id]) onOpen({ slot: id });
  };
  return (
    <Section title="Keyframe">
      <p className="v2-hint">Make the opening still first, then animate it: you pick the exact first frame before paying for video.</p>
      <div className="v2-sb-actions"><button className="v2-btn v2-sb-btn" data-testid="keyframe-add" onClick={add}><Ic g="image" size={16} /> Add keyframe</button></div>
    </Section>
  );
}

/**
 * Asset states (V2-SB-136): the same character, place or prop in another state (lit, wet, broken…), each with its own
 * prompt and versions, made from this asset. Shots and layers use a state like any asset.
 */
function States({ slot, project, thumbs, engine, onOpen }: { slot: AssetSlot; project: Project; thumbs: Record<string, string>; engine: Engine; onOpen: (t: BoardTarget) => void }) {
  const b = project.storyboard!;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const states = storyRefs.statesOf(b, slot.id);
  const add = () => {
    if (!name.trim()) return;
    const id = storyRefs.nextStateId(b, slot.id, name);
    engine.dispatch(cmd.addAssetState(slot.id, name));
    setName(""); setAdding(false);
    if (engine.getState().project.storyboard?.slots[id]) onOpen({ slot: id });
  };
  return (
    <Section title={states.length ? `States (${states.length})` : "States"}>
      {states.length > 0 ? (
        <ul className="v2-sb-slots" data-testid="asset-states">
          {states.map((x) => {
            const v = board.selectedOf(project, x), n = board.versionsOf(project, x).length;
            return <li key={x.id}><button className="v2-sb-slot" onClick={() => onOpen({ slot: x.id })} aria-label={`State ${x.stateName ?? x.id}: ${n ? `${n} version${n > 1 ? "s" : ""}` : "not added yet"}`}><Thumb src={v && thumbs[v]} icon={TYPE_ICON[x.type] ?? "image"} count={n} /><span className="v2-sb-slot-text"><b>{x.stateName ?? x.name}</b><em>{x.id}</em></span></button></li>;
          })}
        </ul>
      ) : <p className="v2-hint">The same {slot.type} in another state (lit, wet, broken, older…), made from this image so it stays recognisably the same. Shots use it as “{slot.id}@&lt;state&gt;”.</p>}
      {adding ? (
        <form className="v2-sb-stateform" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input className="v2-sb-model" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="State name, e.g. lit" aria-label={`Name of the new state of ${slot.name}`} maxLength={40} data-testid="state-name" />
          <button className="v2-btn primary v2-sb-btn" type="submit" disabled={!name.trim()} data-testid="state-create">Add</button>
          <button className="v2-btn v2-sb-btn" type="button" onClick={() => { setAdding(false); setName(""); }}>Cancel</button>
        </form>
      ) : <div className="v2-sb-actions"><button className="v2-btn v2-sb-btn" data-testid="state-add" onClick={() => setAdding(true)}><Ic g="+" size={16} /> Add state</button></div>}
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

/** P2C (item 4): an html asset's param declarations: from its brief (`params`), else from the selected version's manifest. */
function useParamDecls(project: Project, slot: AssetSlot | undefined, blobs: BlobStore): Record<string, HtmlClipParam> | undefined {
  const a = slot?.assetId ? project.assets[slot.assetId] : undefined;
  const v = a && board.selectedOf(project, slot!);
  const key = v ? a.versions.find((x) => x.id === v)?.media.blobKey : undefined;
  const [fromFile, setFromFile] = useState<{ key: string; params?: Record<string, HtmlClipParam> }>();
  const declared = slot?.params && Object.keys(slot.params).length ? slot.params : undefined;
  useEffect(() => {
    if (declared || !key) return;
    let live = true;
    void blobs.get(key).then(async (b) => {
      let params: Record<string, HtmlClipParam> | undefined;
      try { params = b ? readManifest(await blobText(b)).params : undefined; } catch { params = undefined; }
      if (live) setFromFile({ key, params });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [declared, key, blobs]);
  return declared ?? (fromFile?.key === key ? fromFile?.params : undefined);
}

/** The param controls of one use of an html asset (its values override the defaults), with Reset. */
function ParamsBox({ name, decls, values, engine, onChange, onReset, testId }: {
  name: string; decls: Record<string, HtmlClipParam>; values: HtmlParamValues | undefined; engine: Engine;
  onChange: (key: string, value: string | number | boolean) => void; onReset: () => void; testId: string;
}) {
  const specs = htmlParamSpecs(decls);
  if (!specs.length) return null;
  const changed = Object.keys(values ?? {}).some((k) => k in cleanParamDecls(decls));
  return (
    <div className="v2-hp v2-sb-params" data-testid={testId}>
      <ParamControls name={name} params={specs} values={resolveHtmlParams(decls, values ?? {}) as Record<string, number | string | boolean>}
        onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()} onChange={(k, v) => onChange(k, v)} />
      <div className="v2-hp-actions"><button className="v2-btn v2-sb-btn" disabled={!changed} title="Back to the clip's defaults" onClick={onReset}><Ic g="↶" size={14} /> Reset to defaults</button></div>
    </div>
  );
}

/** P2C (item 4): an html shot's param values, edited in the storyboard (saved on the shot; sent with it). */
function ShotHtmlParams({ shot, slot, project, engine, blobs }: { shot: Shot; slot: AssetSlot; project: Project; engine: Engine; blobs: BlobStore }) {
  const decls = useParamDecls(project, slot, blobs);
  if (!decls || !Object.keys(cleanParamDecls(decls)).length) {
    return shot.params ? <p className="v2-sb-kv" data-testid="v2-sb-html-params"><b>Params</b> {Object.entries(shot.params).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(" · ")}</p> : null;
  }
  return (
    <>
      <h5 className="v2-sb-subhead">Params for this shot</h5>
      <ParamsBox name="Shot" decls={decls} values={shot.params} engine={engine} testId="v2-sb-html-params"
        onChange={(k, v) => engine.dispatch(cmd.updateShot(shot.id, { params: { ...(shot.params ?? {}), [k]: v } }, `Shot ${decls[k]?.label || k}`))}
        onReset={() => engine.dispatch(cmd.updateShot(shot.id, { params: null }, "Reset params"))} />
    </>
  );
}

/** P2C (item 4): the params of the shot's html layers, edited in the storyboard. */
function LayerHtmlParams({ shot, project, engine, blobs }: { shot: Shot; project: Project; engine: Engine; blobs: BlobStore }) {
  const b = project.storyboard!;
  const layers = shot.layers ?? [];
  const html = layers.map((l, i) => ({ l, i })).filter(({ l }) => l.type === "html" && !!b.slots[(l as { asset: string }).asset]);
  if (!html.length) return null;
  return (
    <Section title="HTML layer params">
      {html.map(({ l, i }) => <LayerParams key={i} shot={shot} index={i} slot={b.slots[(l as { asset: string }).asset]} project={project} engine={engine} blobs={blobs} />)}
    </Section>
  );
}

function LayerParams({ shot, index, slot, project, engine, blobs }: { shot: Shot; index: number; slot: AssetSlot; project: Project; engine: Engine; blobs: BlobStore }) {
  const decls = useParamDecls(project, slot, blobs);
  const layer = shot.layers![index] as { params?: HtmlParamValues };
  const set = (params: HtmlParamValues | undefined, label: string) => {
    const layers = shot.layers!.map((x, j) => {
      if (j !== index) return x;
      const { params: _old, ...rest } = x as typeof x & { params?: HtmlParamValues };
      return (params && Object.keys(params).length ? { ...rest, params } : rest) as typeof x;
    });
    engine.dispatch(cmd.updateShot(shot.id, { layers }, label));
  };
  if (!decls || !Object.keys(cleanParamDecls(decls)).length) return <p className="v2-hint">“{slot.name}” exposes no params.</p>;
  return (
    <div className="v2-sb-layerparams">
      <h5 className="v2-sb-subhead">“{slot.name}” (layer {index + 1})</h5>
      <ParamsBox name={`Layer ${index + 1}`} decls={decls} values={layer.params} engine={engine} testId={`v2-sb-layer-params-${index}`}
        onChange={(k, v) => set({ ...(layer.params ?? {}), [k]: v }, `Layer ${decls[k]?.label || k}`)} onReset={() => set(undefined, "Reset layer params")} />
    </div>
  );
}

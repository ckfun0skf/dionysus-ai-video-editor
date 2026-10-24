import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hitTest, Player, THREE_TEMPLATE } from "../render";
import { cmd } from "../engine";
import { importFile } from "../persistence";
import { compositionDuration, edit, layers, ops, transitions, findPlacement, newId, formatTimecode, secondsToTicks, type Asset } from "../domain";
import { useEditorBoot, useEngineState, useIsMobile, type EditorContext, type LoadFailure } from "./useEditor";
import { Timeline } from "./Timeline";
import { clampPps } from "./gestures";
import { useThumbs } from "./useThumbs";
import { useMediaPreviews } from "./useMedia";
import { TransformHandles, TransformInspector } from "./Transform";
import { TextPanel } from "./TextPanel";
import { AnimationPicker } from "./AnimationPicker";
import { HtmlEditor } from "./HtmlEditor";
import { ExportDialog } from "./ExportDialog";
import { ProjectsDialog } from "./Projects";
import type { Resolution } from "../render";
import { addCueAt, downloadSrt, importSrtFile, SubtitleEditor, SubtitleLane } from "./Subtitles";
import { Ic } from "./Icon";
import { MediaPicker, type Picked } from "./MediaPicker";
import { projectMediaList } from "./projectMedia";
import { libraryFile, stickerFile } from "./libraryItems";
import { EffectPicker } from "./EffectPicker";
import { PanelGrabber, PREVIEW_DEFAULT, Sheet } from "./Sheet";

type Menu = "multi" | "root" | "edit" | "audio" | "speed" | "text" | "effect" | "overlay";
const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

/** `openStorage` is injectable for tests; production uses IndexedDB (memory fallback). */
export function V2App({ openStorage }: { openStorage?: () => Promise<EditorContext["storage"]> } = {}) {
  const [key, setKey] = useState(0);
  const boot = useEditorBoot(openStorage, key);
  if (boot.status === "loading") return <div className="v2-loading">Loading Dionysus v2…</div>;
  if (boot.status === "error") return <div className="v2-loading" role="alert">Could not start the v2 editor: {boot.error}. <button onClick={() => location.reload()}>Retry</button></div>;
  const switchTo = async (id: string) => { await boot.ctx.flush(); boot.ctx.storage.lastProjectId.set(id); setKey((k) => k + 1); };
  return <Editor key={key} {...boot.ctx} onSwitch={(id) => void switchTo(id)} />;
}

function Editor({ engine, storage, recovery, onSwitch }: EditorContext & { onSwitch: (id: string) => void }) {
  const [notice, setNotice] = useState(recovery);
  const { project, canUndo, canRedo } = useEngineState(engine);
  const mobile = useIsMobile();
  const [previewVh, setPreviewVh] = useState(PREVIEW_DEFAULT);
  const [sideOpen, setSideOpen] = useState(true);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const selectedId = sel.length === 1 ? sel[0] : undefined;
  const setSelectedId = (id?: string) => setSel(id ? [id] : []);
  const [multiMode, setMultiMode] = useState(false);
  const clipboard = useRef<edit.ClipboardItem[]>([]);
  const [hasClip, setHasClip] = useState(false);
  const [pps, setPps] = useState(40);
  const [sheet, setSheet] = useState(false);
  const [picker, setPicker] = useState<null | "main" | "overlay" | "audio" | "stickers">(null);
  const [busy, setBusy] = useState(0);
  const [menu, setMenu] = useState<Menu>("root");
  /** Mobile: which timeline group is expanded into its layers (the toolbar ‹ collapses it). */
  const [expanded, setExpanded] = useState<ops.TrackGroup>();
  const [res, setRes] = useState<Resolution>("1080p");
  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState(false);
  const openExport = () => { player.pause(); setExporting(true); };
  const [fs, setFs] = useState(false);
  const [toast, setToast] = useState<string>();
  const [inspOpen, setInspOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  /** V2-103: text layer being edited as a whole ("Edit all"). */
  const [layerEdit, setLayerEdit] = useState<string>();
  /** V2-103: gizmo scope on styled text layers; undefined = layer default (Whole layer for subtitles). */
  const [gizmoScope, setGizmoScope] = useState<"clip" | "layer">();
  /** V2-098: animation sheet; after a pick the sheet shrinks and the preview loops over the clip's time range. */
  const [animOpen, setAnimOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [animLoop, setAnimLoop] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  const [htmlEdit, setHtmlEdit] = useState<{ placementId: string; assetId: string; source: string }>();
  const [inlineId, setInlineId] = useState<string>();
  const [subId, setSubId] = useState<string>();
  const [ripple, setRippleState] = useState(() => localStorage.getItem("v2.ripple") === "1");
  const setRipple = (on: boolean) => { setRippleState(on); localStorage.setItem("v2.ripple", on ? "1" : "0"); setToast(on ? "Ripple on: delete and trim close gaps" : "Ripple off"); };
  const srtRef = useRef<HTMLInputElement>(null);
  const [, setFrame] = useState(0); // bumps on every drawn frame so on-canvas handles track player.boxes
  const thumbs = useThumbs(project, storage.blobs);
  const { peaks, strips } = useMediaPreviews(project, storage.blobs);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(undefined), 3000); return () => clearTimeout(t); }, [toast]);
  const playerRef = useRef<Player>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const comp = project.compositions[project.rootCompositionId];
  const selected = selectedId ? findPlacement(comp, selectedId) : undefined;
  const duration = compositionDuration(comp);
  const cues = comp.subtitles ?? [];
  const cue = subId ? cues.find((s) => s.id === subId) : undefined;
  const selectClip = (id?: string) => { setSelectedId(id); if (id) setSubId(undefined); else setMultiMode(false); };
  const toggleClip = (id: string) => { setSubId(undefined); setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); };
  const allIds = comp.tracks.flatMap((t) => t.placements.map((p) => p.id));
  const copy = () => { if (!sel.length) return; clipboard.current = edit.copyClips(comp, sel); setHasClip(true); setToast(`Copied ${sel.length} clip${sel.length > 1 ? "s" : ""}`); };
  const paste = () => {
    if (!clipboard.current.length) { setToast("Nothing to paste — copy a clip first"); return; }
    const ids = clipboard.current.map(() => newId("plc"));
    engine.dispatch(cmd.pasteClips(clipboard.current, Math.round(player.time), ids));
    setSel(ids);
  };
  const duplicate = () => { if (!sel.length) return; const ids = sel.map(() => newId("plc")); engine.dispatch(cmd.duplicateClips(sel, ids)); setSel(ids); };
  /** Preview duplicate: copy on a new track right above, same time, nudged ~20px, copy selected. */
  const duplicateAbove = () => {
    if (sel.length !== 1) return duplicate();
    const st = engine.getState().project.settings; const id = newId("plc");
    engine.dispatch(cmd.duplicateAbove(sel[0], id, 20 / (st?.width || 1080), 20 / (st?.height || 1920))); setSel([id]);
  };
  const delSel = (rippleOverride?: boolean) => { if (sel.length) { engine.dispatch(cmd.deleteClips(sel, rippleOverride ?? ripple)); setSel([]); setMultiMode(false); } };
  const onTransition = (id: string) => {
    const p = findPlacement(comp, id)?.placement;
    if (p && !p.transitionIn) { engine.dispatch(cmd.setTransition(id, { kind: "crossfade", durationTicks: transitions.DEFAULT_TRANSITION_TICKS })); setToast("Crossfade added (Undo to remove)"); }
    setSel([id]); setSubId(undefined);
  };
  const selectCue = (id?: string) => { setSubId(id); if (id) setSelectedId(undefined); };
  const addSubtitle = () => { const id = addCueAt(engine, player.time); if (id) selectCue(id); else setToast("There is already a subtitle at the playhead"); };
  const addText = () => { const id = newId("plc"); if (engine.dispatch(cmd.addTextClip(Math.round(player.time), {}, id))) { setSel([id]); setSubId(undefined); } };
  const delCue = () => { if (subId) { engine.dispatch(cmd.removeSubtitle(subId)); setSubId(undefined); } };
  const onSrt = async (f?: File) => { if (!f) return; const n = await importSrtFile(engine, f); setToast(n ? `Imported ${n} subtitles (Undo to revert)` : `${f.name}: no subtitles found`); };
  const exportSrt = () => (cues.length ? downloadSrt(cues, project.name) : setToast("No subtitles to export — add text first"));
  const topLane = cues.length ? { label: "Text", render: (toPx: (t: number) => number, toTicks: (px: number) => number) => <SubtitleLane engine={engine} list={cues} selectedId={subId} onSelect={selectCue} toPx={toPx} toTicks={toTicks} /> } : undefined;
  const textTools = [
    { icon: "T", label: "Add text", title: "Add a text clip at the playhead (T)", run: addText },
    { icon: "≡", label: "Add subtitle", title: "Add a subtitle cue at the playhead", run: addSubtitle },
    { icon: "⇪", label: "Import SRT", title: "Import an .srt file as a new text layer", run: () => srtRef.current?.click() },
    { icon: "⇩", label: "Export SRT", title: "Download subtitles as .srt", run: exportSrt },
  ];
  // V2-103: controls and gizmo work on the effective placement (layer style merged under the clip's overrides).
  const selTrack = selected?.track;
  const effSel = selected ? layers.effectivePlacement(selTrack, selected.placement) : undefined;
  const visual = effSel && effSel.clipType !== "audio" ? effSel : undefined;
  const styledText = !!(selTrack?.layerStyle && selected?.placement.clipType === "text");
  const scope = styledText ? gizmoScope ?? (selTrack!.layerStyle!.subtitle ? "layer" : "clip") : "clip";
  useEffect(() => { setGizmoScope(undefined); }, [selectedId]);
  useEffect(() => { if (selectedId) setLayerEdit(undefined); }, [selectedId]);
  const layerTrack = layerEdit ? comp.tracks.find((t) => t.id === layerEdit) : undefined;
  useEffect(() => { if (layerEdit && !layerTrack) setLayerEdit(undefined); }, [layerEdit, layerTrack]);
  const editLayer = (id: string) => { setSel([]); setSubId(undefined); setLayerEdit(id); if (!mobile) setSideOpen(true); };
  const layerRoute = scope === "layer" && selTrack ? (patch: { x?: number; y?: number; scale?: number; rotation?: number } | null) => {
    if (!patch) return;
    const { x, y, scale, rotation } = patch;
    engine.dispatch(cmd.setLayerStyle(selTrack.id, { transform: Object.fromEntries(Object.entries({ x, y, scale, rotation }).filter(([, v]) => v !== undefined)) }, "Move layer"));
  } : undefined;
  const scopeChip = styledText && <div className="v2-scope-chip" role="radiogroup" aria-label="Gizmo applies to">
    {(["clip", "layer"] as const).map((k) => <button key={k} role="radio" aria-checked={scope === k} className={`v2-chip ${scope === k ? "is-active" : ""}`}
      title={k === "clip" ? "Move/scale only this clip (it gets a custom position)" : `Move/scale every clip on ${selTrack!.name}`} onClick={() => setGizmoScope(k)}>{k === "clip" ? "This clip" : "Whole layer"}</button>)}
  </div>;

  if (!playerRef.current) playerRef.current = new Player(project, storage.blobs);
  const player = playerRef.current;
  useEffect(() => { player.onTime = (t, p) => { setTime(t); setPlaying(p); setFrame((f) => f + 1); }; return () => player.dispose(); }, [player]);
  useEffect(() => { player.canvas = canvasRef.current ?? undefined; player.draw(); }, [player, mobile]);
  useEffect(() => { player.setProject(project); }, [player, project]);
  useEffect(() => { const live = sel.filter((id) => allIds.includes(id)); if (live.length !== sel.length) setSel(live); });
  useEffect(() => { if (subId && !cue) setSubId(undefined); }, [subId, cue]);

  const seek = useCallback((t: number) => player.seek(t), [player]);
  const closeAnim = () => { setAnimOpen(false); setTextOpen(false); if (animLoop) { setAnimLoop(false); player.pause(); } };
  const togglePlay = useCallback(() => (player.isPlaying ? player.pause() : player.play()), [player]);
  const split = useCallback(() => { if (selectedId) engine.dispatch(cmd.splitPlacement(selectedId, Math.round(player.time))); }, [engine, player, selectedId]);
  // Tap in the preview selects the topmost element (rotation-aware); empty space deselects, then toggles play.
  const onCanvasTap = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget, r = c.getBoundingClientRect();
    const k = c.width / (r.width || 1);
    const id = hitTest(player.boxes, (e.clientX - r.left) * k, (e.clientY - r.top) * k);
    if (id) { setSel([id]); setSubId(undefined); }
    else if (selectedId) setSelectedId(undefined);
    else togglePlay();
  };
  const isText = selected?.placement.clipType === "text";
  const isEffect = selected?.placement.clipType === "effect";
  const loopClip = (mobile ? animOpen || textOpen : true) && animLoop && isText ? selected!.placement : undefined;
  useEffect(() => {
    if (!loopClip) return;
    const end = loopClip.startTicks + loopClip.durationTicks;
    if (time < loopClip.startTicks || time >= end - 1) player.seek(loopClip.startTicks);
    if (!player.isPlaying) player.play();
  }, [loopClip, time, player]);
  const wasLooping = useRef(false);
  useEffect(() => { if (wasLooping.current && !loopClip) { player.pause(); setAnimLoop(false); } wasLooping.current = !!loopClip; }, [loopClip, player]);
  const openCode = async () => {
    const pl = selected?.placement;
    const ver = pl && project.assets[pl.source.assetId]?.versions.find((v) => v.id === pl.source.versionId);
    const blob = ver && (await storage.blobs.get(ver.media.blobKey));
    if (pl && blob) setHtmlEdit({ placementId: pl.id, assetId: pl.source.assetId, source: await blob.text() });
    else setToast("Could not load this clip's code");
  };
  const saveCode = async (html: string) => {
    if (!htmlEdit) return;
    const asset = project.assets[htmlEdit.assetId];
    const prev = asset?.versions.find((v) => v.id === asset.selectedVersionId) ?? asset?.versions[0];
    if (!asset || !prev) return;
    const id = newId("ver"), blobKey = `${asset.id}/${id}`;
    await storage.blobs.put(blobKey, new Blob([html], { type: "text/html" }));
    engine.dispatch(cmd.addAssetVersion(asset.id, { ...prev, id, createdAt: new Date().toISOString(), media: { ...prev.media, blobKey }, provenance: { source: "import", inputs: [] } }, htmlEdit.placementId));
    setHtmlEdit(undefined); setToast("HTML clip updated (Undo to revert)");
  };
  const isHtml = selected?.placement.clipType === "html";
  const gizmo = { onDelete: () => del(false), onEdit: () => (isText ? setTextOpen(true) : isHtml ? void openCode() : setInspOpen(true)), onDuplicate: () => duplicateAbove(), onDoubleTap: () => { if (isText) setInlineId(selected!.placement.id); } };
  const inlineBox = inlineId && selected?.placement.id === inlineId ? player.boxes.get(inlineId) : undefined;
  const inlineEditor = inlineBox && canvasRef.current && (() => {
    const c = canvasRef.current, r = c.getBoundingClientRect(), pr = c.parentElement!.getBoundingClientRect(), k = r.width / c.width;
    const w = Math.max(120, inlineBox.w * k), h = Math.max(44, inlineBox.h * k);
    return <textarea className="v2-inline-edit" aria-label="Edit text inline" autoFocus defaultValue={selected!.placement.text?.text ?? ""}
      style={{ left: r.left - pr.left + inlineBox.cx * k - w / 2, top: r.top - pr.top + inlineBox.cy * k - h / 2, width: w, height: h }}
      onFocus={(e) => { engine.beginGesture(); e.currentTarget.select(); }} onBlur={() => { engine.endGesture(); setInlineId(undefined); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); e.currentTarget.blur(); } }}
      onChange={(e) => engine.dispatch(cmd.updateText(inlineId!, { text: e.target.value }, "Type text"))} />;
  })();
  const del = useCallback((rippleOverride?: boolean) => { if (selectedId) { engine.dispatch(cmd.deleteClips([selectedId], rippleOverride ?? ripple)); setSelectedId(undefined); } }, [engine, selectedId, ripple]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exporting || projects || (e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) engine.redo(); else engine.undo(); }
      else if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); openExport(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); engine.redo(); }
      else if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key.toLowerCase() === "s" && !mod) split();
      else if ((e.key === "Delete" || e.key === "Backspace") && subId) delCue();
      else if (e.key === "Delete" || e.key === "Backspace") delSel(e.shiftKey ? true : undefined);
      else if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); copy(); }
      else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); paste(); }
      else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(); }
      else if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSubId(undefined); setSel(allIds); }
      else if (e.key === "Escape") { setSel([]); setMultiMode(false); }
      else if (e.key.toLowerCase() === "r" && !mod) setRipple(!ripple);
      else if (e.key.toLowerCase() === "t" && !mod) addText();
      else if (e.key.toLowerCase() === "f" && !mod && selectedId) engine.dispatch(cmd.freezeFrame(selectedId, Math.round(player.time)));
      else if (e.key === "ArrowLeft") seek(player.time - secondsToTicks(1 / project.settings.fps));
      else if (e.key === "ArrowRight") seek(player.time + secondsToTicks(1 / project.settings.fps));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setBusy((b) => b + files.length);
    for (const f of Array.from(files)) {
      try {
        const asset = await importFile(f, storage.blobs);
        if (asset) engine.dispatch(cmd.importAsset(asset));
        else setToast(`${f.name}: unsupported file type`);
      } catch (e) {
        setToast(`${f.name}: ${e instanceof Error ? e.message : "import failed"}`);
      } finally { setBusy((b) => b - 1); }
    }
  };
  /** Import picked files + library items, then lay them out from the playhead in one undo step. */
  const addPicked = async ({ files, library, stickers, assets = [] }: Picked, mode: "main" | "overlay") => {
    setPicker(null);
    const at = Math.round(player.time);
    const all = [...files, ...library.map(libraryFile).filter((f): f is File => !!f)];
    const ids: string[] = assets.filter((id) => project.assets[id]), stickerIds: string[] = [];
    const stickerFiles = await Promise.all(stickers.map((s) => stickerFile(s).catch(() => undefined)));
    const jobs = [...all.map((f) => ({ f, out: ids })), ...stickerFiles.filter((f): f is File => !!f).map((f) => ({ f, out: stickerIds }))];
    setBusy((b) => b + jobs.length);
    for (const { f, out } of jobs) {
      try {
        const asset = await importFile(f, storage.blobs);
        if (asset && engine.dispatch(cmd.importAsset(asset))) out.push(asset.id);
        else if (!asset) setToast(`${f.name}: unsupported file type`);
      } catch (e) { setToast(`${f.name}: ${e instanceof Error ? e.message : "import failed"}`); } finally { setBusy((b) => b - 1); }
    }
    const steps = [];
    if (ids.length) steps.push(cmd.addAssetsInSequence(ids, at, mode === "overlay" ? newId("trk") : undefined));
    if (library.some((l) => l.id === "text")) steps.push(cmd.addTextClip(at, {}));
    if (stickerIds.length) steps.push(cmd.addAssetsInSequence(stickerIds, at, newId("trk"), "text"));
    if (steps.length) engine.dispatch(steps, mode === "overlay" ? "Add overlay" : "Add media");
  };
  const projectMedia = useMemo(() => projectMediaList(project, thumbs), [project, thumbs]);
  const addToTimeline = (a: Asset) => { engine.dispatch(cmd.addAssetToTimeline(a.id, mobile ? player.time : duration)); if (mobile) setSheet(false); };

  const browser = (
    <section className="v2-browser" aria-label="Media">
      <div className="v2-panel-head">
        <strong>Media</strong>
        <button className="v2-btn primary" onClick={() => fileRef.current?.click()}><Ic g="＋" size={16} /> Import</button>
        <button className="v2-btn" title="Add an HTML clip (example uses three.js) (edit the .html and re-import to change it)" onClick={() => void onFiles([new File([THREE_TEMPLATE], "three-scene.html", { type: "text/html" })])}><Ic g="＋" size={16} /> HTML clip</button>
        {mobile && <button className="v2-btn" onClick={() => setSheet(false)}>Done</button>}
      </div>
      {busy > 0 && <p className="v2-hint">Importing {busy}…</p>}
      {Object.values(project.assets).length === 0 && <p className="v2-hint">Import video, image, audio or HTML files, then {mobile ? "tap" : "drag or click"} + to add them to the timeline.</p>}
      <ul className="v2-assets">
        {Object.values(project.assets).map((a) => (
          <li key={a.id} draggable onDragStart={(e) => e.dataTransfer.setData("application/x-dionysus-asset", a.id)} className={`v2-asset kind-${a.kind}`}>
            <AssetThumb asset={a} engineBlobs={storage.blobs} />
            <span className="v2-asset-name" title={a.name}>{a.name}</span>
            <small>{a.kind}{a.versions[0]?.media.durationTicks ? ` · ${formatTimecode(a.versions[0].media.durationTicks, project.settings.fps).slice(0, 5)}` : ""}</small>
            <button className="v2-btn" aria-label={`Add ${a.name} to timeline`} onClick={() => addToTimeline(a)}><Ic g="＋" /></button>
            <button className="v2-icon" aria-label={`Remove ${a.name}`} onClick={() => engine.dispatch(cmd.removeAsset(a.id))}><Ic g="✕" /></button>
          </li>
        ))}
      </ul>
      <input ref={fileRef} type="file" hidden multiple accept="video/*,image/*,audio/*,.html,.htm,text/html" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      <input ref={srtRef} type="file" hidden accept=".srt,.vtt,text/plain" aria-label="Import SRT file" onChange={(e) => { void onSrt(e.target.files?.[0]); e.target.value = ""; }} />
    </section>
  );

  const transport = (
    <div className="v2-transport">
      <button className="v2-icon" aria-label="Undo" disabled={!canUndo} onClick={() => engine.undo()}><Ic g="↶" /></button>
      <button className="v2-icon" aria-label="Redo" disabled={!canRedo} onClick={() => engine.redo()}><Ic g="↷" /></button>
      <button className="v2-icon" aria-label="Go to start" onClick={() => seek(0)}><Ic g="⏮" /></button>
      <button className="v2-play" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}><Ic g={playing ? "❚❚" : "▶"} /></button>
      <span className="v2-time">{formatTimecode(time, project.settings.fps)} / {formatTimecode(duration, project.settings.fps)}</span>
    </div>
  );

  const rippleToggle = (
    <button key="ripple" className={`v2-tool ${ripple ? "is-active" : ""}`} aria-pressed={ripple} title="Ripple: delete and trim move later clips to close gaps (R)" onClick={() => setRipple(!ripple)}><b aria-hidden><Ic g="⇤" /></b><span>Ripple {ripple ? "on" : "off"}</span></button>
  );

  const snapToggle = (
    <button key="snap" className={`v2-tool ${snapOn ? "is-active" : ""}`} aria-pressed={snapOn} title="Smart snapping and alignment guides in the preview (hold Alt to skip once)" onClick={() => setSnapOn(!snapOn)}><b aria-hidden><Ic g="🧲" /></b><span>Snap {snapOn ? "on" : "off"}</span></button>
  );

  const clipActions = [
    { icon: "⧉", label: "Duplicate", title: "Duplicate onto a new track above, same time (⌘/Ctrl+D duplicates after on the same track)", run: duplicateAbove },
    { icon: "⎘", label: "Copy", title: "Copy (⌘/Ctrl+C) — paste at the playhead with ⌘/Ctrl+V", run: copy },
  ];
  const pasteAction = { icon: "📋", label: "Paste", title: hasClip ? "Paste at the playhead (⌘/Ctrl+V)" : "Copy a clip first", run: paste };
  const multiBar = sel.length > 1 ? (
    <>
      <span className="v2-sel-count" role="status">{sel.length} selected</span>
      <button className="v2-tool" title={ripple ? "Delete all and close gaps (Del)" : "Delete all (Del)"} onClick={() => delSel()}><b><Ic g="🗑" /></b><span>{ripple ? "Ripple delete" : "Delete"}</span></button>
      {clipActions.map((a) => <button key={a.label} className="v2-tool" title={a.title} onClick={a.run}><b aria-hidden><Ic g={a.icon} /></b><span>{a.label}</span></button>)}
      <button className="v2-tool" title="Clear selection (Esc)" onClick={() => selectClip(undefined)}><b><Ic g="✓" /></b><span>Done</span></button>
    </>
  ) : null;

  // Linked audio (owned child of a video clip): extract / duplicate / mute-restore. All undoable commands.
  const linkedAudioActions = selected && selected.placement.clipType === "video" ? [
    { icon: "⤓", label: "Extract audio", title: "Move this clip's audio to an audio track (mutes the clip's own audio)", run: () => { engine.dispatch(cmd.extractAudio(selected.placement.id, "extract")); setToast("Audio extracted to an audio track"); } },
    { icon: "⧉", label: "Duplicate audio", title: "Copy this clip's audio to an audio track (keeps the clip's own audio)", run: () => { engine.dispatch(cmd.extractAudio(selected.placement.id, "duplicate")); setToast("Audio duplicated to an audio track"); } },
    selected.placement.linkedAudio?.muted
      ? { icon: "🔈", label: "Restore clip audio", title: "Play this clip's own audio again", run: () => engine.dispatch(cmd.setLinkedAudioMuted(selected.placement.id, false)) }
      : { icon: "🔇", label: "Mute clip audio", title: "Silence only this clip's own audio", run: () => engine.dispatch(cmd.setLinkedAudioMuted(selected.placement.id, true)) },
  ] : [];

  // Speed / reverse / freeze (video only; freeze clips are held frames so only reverse/speed are hidden).
  const sp = selected?.placement;
  const timeActions = sp && sp.clipType === "video" && !sp.freeze ? [
    { icon: "❄", label: "Freeze", title: "Hold the frame under the playhead for 3 s (F)", run: () => { engine.dispatch(cmd.freezeFrame(sp.id, Math.round(player.time))); setToast("Freeze frame inserted (3 s)"); } },
    { icon: "⟲", label: sp.reverse ? "Play forward" : "Reverse", title: sp.reverse ? "Play this clip forwards again" : "Play this clip backwards (muted)", run: () => engine.dispatch(cmd.setReverse(sp.id, !sp.reverse)) },
  ] : [];
  const speedSelect = sp && sp.clipType !== "image" && sp.clipType !== "text" && !sp.freeze ? (
    <label className="v2-tool" title="Playback speed — changes the clip's length"><b aria-hidden><Ic g="⏩" /></b>
      <select aria-label="Speed" value={sp.speed ?? 1} onChange={(e) => engine.dispatch(cmd.setSpeed(sp.id, Number(e.target.value)))}>
        {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
    </label>
  ) : null;

  const trIn = sp?.transitionIn;
  const transitionTools = sp && trIn ? (
    <span className="v2-trans-tools" role="group" aria-label="Transition">
      {transitions.transitionKinds().map((k) => (
        <button key={k.id} className={`v2-tool ${trIn.kind === k.id ? "is-active" : ""}`} aria-pressed={trIn.kind === k.id} title={k.label} onClick={() => engine.dispatch(cmd.setTransition(sp.id, { kind: k.id, durationTicks: trIn.durationTicks }))}><b aria-hidden><Ic g={k.icon} /></b><span>{k.label}</span></button>
      ))}
      {transitions.TRANSITION_LENGTHS.map((d) => (
        <button key={d} className={`v2-tool ${trIn.durationTicks === d ? "is-active" : ""}`} aria-pressed={trIn.durationTicks === d} title={`Transition length ${d / 120000}s`} onClick={() => engine.dispatch(cmd.setTransition(sp.id, { kind: trIn.kind, durationTicks: d }))}><span>{d / 120000}s</span></button>
      ))}
      <button className="v2-tool" title="Remove the transition into this clip" onClick={() => engine.dispatch(cmd.setTransition(sp.id, undefined))}><b aria-hidden><Ic g="✕" /></b><span>No transition</span></button>
    </span>
  ) : null;

  const selectionActions = multiBar ?? (selected ? (
    <>
      {transitionTools}
      <button className="v2-tool" onClick={split}><b><Ic g="✂" /></b><span>Split</span></button>
      <button className="v2-tool" title={ripple ? "Delete and close the gap (Del)" : "Delete (Del) · Shift+Del ripple delete"} onClick={() => del()}><b><Ic g="🗑" /></b><span>{ripple ? "Ripple delete" : "Delete"}</span></button>
      {speedSelect}
      {isHtml && <button className="v2-tool" title="Edit HTML, CSS and JS with live preview" onClick={() => void openCode()}><b aria-hidden><Ic g="</>" /></b><span>Edit code</span></button>}
      {[...clipActions, ...timeActions, ...linkedAudioActions].map((a) => <button key={a.label} className="v2-tool" title={a.title} onClick={a.run}><b aria-hidden><Ic g={a.icon} /></b><span>{a.label}</span></button>)}
      {!["image", "html", "text"].includes(selected.placement.clipType) && (
        <label className="v2-tool v2-volume"><b><Ic g="🔊" /></b>
          <input type="range" min={0} max={1} step={0.05} value={selected.placement.volume ?? 1} aria-label="Volume" onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()} onChange={(e) => engine.dispatch(cmd.setPlacementVolume(selected.placement.id, Number(e.target.value)))} />
        </label>
      )}
      <button className="v2-tool" onClick={() => engine.dispatch(cmd.toggleTrackMute(selected.track.id))}><b><Ic g={selected.track.muted ? "🔈" : "🔇"} /></b><span>{selected.track.muted ? "Unmute track" : "Mute track"}</span></button>
      {rippleToggle}{snapToggle}
      <button className="v2-tool" onClick={() => setSelectedId(undefined)}><b><Ic g="✓" /></b><span>Done</span></button>
    </>
  ) : (
    <>
      <button className="v2-tool" onClick={() => (mobile ? setSheet(true) : fileRef.current?.click())}><b><Ic g="＋" /></b><span>Media</span></button>
      <button className="v2-tool" onClick={() => engine.dispatch(cmd.addTrack("video"))}><b><Ic g="▭" /></b><span>Video track</span></button>
      <button className="v2-tool" onClick={() => engine.dispatch(cmd.addTrack("audio"))}><b><Ic g="♫" /></b><span>Audio track</span></button>
      {!mobile && <button className="v2-tool v2-fx-tool" title="Add an effect layer (blur, zoom, B&W…)" onClick={() => { setSel([]); setSideOpen(true); setFxOpen(true); }}><b aria-hidden><Ic g="effect" /></b><span>Effect</span></button>}
      {textTools.map((a) => <button key={a.label} className="v2-tool" title={a.title} onClick={a.run}><b aria-hidden><Ic g={a.icon} /></b><span>{a.label}</span></button>)}
      {rippleToggle}{snapToggle}
      <button className="v2-tool" onClick={() => setPps((p) => Math.min(400, p * 1.5))}><b><Ic g="zoom-in" /></b><span>Zoom in</span></button>
      <button className="v2-tool" onClick={() => setPps((p) => Math.max(4, p / 1.5))}><b><Ic g="zoom-out" /></b><span>Zoom out</span></button>
      <button className="v2-tool" title={pasteAction.title} disabled={!hasClip} onClick={paste}><b aria-hidden><Ic g="📋" /></b><span>Paste</span></button>
    </>
  ));

  const preview = (
    <section className="v2-preview" aria-label="Preview" style={mobile ? { height: `${previewVh}dvh` } : undefined}>
      <div className="v2-canvas-wrap"><canvas ref={canvasRef} width={1280} height={720} onClick={onCanvasTap} title="Tap an element to select it · tap empty space to play/pause" />
        {visual && player.boxes.get(visual.id) && canvasRef.current && <TransformHandles engine={engine} placement={visual} time={time} box={player.boxes.get(visual.id)!} canvas={canvasRef.current} actions={gizmo} route={layerRoute} snapping={snapOn} others={[...player.boxes].filter(([id]) => id !== visual.id).map(([, b]) => b)} />}
        {inlineEditor}
        {visual && scopeChip}
      </div>
      {!mobile && transport}
    </section>
  );

  const firstVideoTrack = ops.mainTrack(comp);
  const firstClip = firstVideoTrack?.placements[0];
  const fullscreen = () => {
    const el = canvasRef.current?.parentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el?.requestFullscreen) void el.requestFullscreen().catch(() => setFs((f) => !f));
    else setFs((f) => !f);
  };
  const focusGroup = menu === "audio" || menu === "text" || menu === "overlay" || menu === "effect" ? menu : undefined;
  const activeMenu: Menu = multiMode || sel.length > 1 ? "multi" : selected ? (menu === "speed" ? "speed" : "edit") : menu === "speed" ? "root" : cue ? "text" : menu;
  /** CapCut root modes. Edit edits the main-track clip under the playhead; Audio/Text/Overlay expand their group. */
  const mainAt = (t: number) => { const m = ops.mainTrack(comp); return m?.placements.find((p) => p.startTicks <= t && t < p.startTicks + p.durationTicks) ?? (m && t >= compositionDuration(comp) ? m.placements[m.placements.length - 1] : undefined); };
  const enterMode = (m: "edit" | "audio" | "text" | "effect" | "overlay") => {
    setSubId(undefined); setMultiMode(false);
    if (m === "edit") { const p = mainAt(player.time); setSel(p ? [p.id] : []); setExpanded(undefined); }
    else { setSel([]); setExpanded(m); }
    setMenu(m);
  };
  const toRoot = () => { setSel([]); setSubId(undefined); setMultiMode(false); setExpanded(undefined); setMenu("root"); };
  const back = () => {
    if (multiMode || sel.length > 1) { selectClip(undefined); return; }
    if (menu === "speed") { setMenu(selected && ops.groupOf(comp, selected.track) !== "main" ? (expanded && expanded !== "main" ? expanded : "root") : "edit"); return; }
    if ((selected && menu !== "edit") || (subId && menu === "text")) { setSel([]); setSubId(undefined); return; }
    toRoot();
  };
  const onExpand = (g?: ops.TrackGroup) => {
    setExpanded(g);
    if (g && g !== "main") setMenu(g);
    else if (!g && menu !== "root" && menu !== "speed" && menu !== "multi") setMenu("root");
  };
  // Edit mode follows the playhead: scrolling the timeline changes which main-track clip is being edited.
  useEffect(() => { if (!mobile || menu !== "edit" || multiMode) return; const p = mainAt(time); if (p && p.id !== selectedId) setSel([p.id]); }, [time, menu]); // eslint-disable-line react-hooks/exhaustive-deps
  // Tapping a clip enters its mode: main → Edit, otherwise that group's mode (the group is expanded by the timeline).
  useEffect(() => {
    if (!mobile || !selected) return;
    const g = ops.groupOf(comp, selected.track);
    if (g === "main") { if (menu !== "edit" && menu !== "speed") setMenu("edit"); } else if (menu === "root" || menu === "edit" || menu === "effect") setMenu(g);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  const addTransitionNearPlayhead = () => {
    const ps = [...(ops.mainTrack(comp)?.placements ?? [])].sort((a, b) => a.startTicks - b.startTicks).slice(1);
    if (!ps.length) { setToast("Transitions go between two main-track clips — add another clip first"); return; }
    const t = player.time;
    const p = ps.reduce((a, b) => (Math.abs(b.startTicks - t) < Math.abs(a.startTicks - t) ? b : a));
    if (p.transitionIn) { setSel([p.id]); setToast("This cut already has a transition — adjust it below"); } else onTransition(p.id);
    seek(p.startTicks);
  };
  const tool = (icon: string, label: string, onClick: () => void, key = label, title?: string) => (
    <button key={key} className="v2-tool" title={title} onClick={onClick}><b aria-hidden><Ic g={icon} /></b><span>{label}</span></button>
  );
  const mobileTools: Record<Menu, JSX.Element[]> = {
    root: [
      tool("✂", "Edit", () => enterMode("edit"), "edit", "Edit the main-track clip under the playhead"),
      tool("♫", "Audio", () => enterMode("audio"), "audio", "Audio layers: add music and sounds"),
      tool("T", "Text", () => enterMode("text"), "text", "Text, stickers and subtitles"),
      tool("effect", "Effect", () => enterMode("effect"), "effect", "Effect layers (blur, zoom, B&W…) and transitions"),
      tool("overlay", "Overlay", () => enterMode("overlay"), "overlay", "Photos and videos on layers above the main track"),
    ],
    edit: !selected ? [<span key="h" className="v2-tool-hint">Move the playhead over a main-track clip to edit it</span>] : isEffect ? [
      tool("effect", "Effect", () => setFxOpen(true), "fx-edit", "Change the preset or its settings"),
      tool("✂", "Split", split),
      tool("🗑", "Delete", () => del(), "delete", "Delete this effect clip"),
      ...clipActions.map((a) => tool(a.icon, a.label, a.run, a.label, a.title)),
    ] : [
      ...(transitionTools ? [<span key="tr" className="v2-trans-wrap">{transitionTools}</span>] : []),
      tool("✂", "Split", split),
      tool("🗑", ripple ? "Ripple delete" : "Delete", () => del(), "delete", ripple ? "Delete and close the gap" : "Delete"),
      ...(isHtml ? [tool("</>", "Edit code", () => void openCode(), "edit-code", "Edit HTML, CSS and JS with live preview")] : []),
      ...(isText ? [tool("T", "Edit text", () => setTextOpen(true), "edit-text", "Templates, font, style, effects, animation"), tool("anim", "Animation", () => setAnimOpen(true), "anim", "In, out and loop animations")] : []),
      tool("⤧", "Adjust", () => setInspOpen(true), "adjust", "Transform, keyframes and fades"),
      ...(speedSelect ? [tool("⏩", `Speed ${sp!.speed ?? 1}×`, () => setMenu("speed"), "speed", "Playback speed")] : []),
      tool("☑", "Select", () => setMultiMode(true), "multi", "Select several clips"),
      ...[...clipActions, ...timeActions, ...linkedAudioActions].map((a) => tool(a.icon, a.label, a.run, a.label, a.title)),
      ...(!["image", "html", "text"].includes(selected.placement.clipType) ? [
        <label key="vol" className="v2-tool v2-volume"><b aria-hidden><Ic g="🔊" /></b>
          <input type="range" min={0} max={1} step={0.05} value={selected.placement.volume ?? 1} aria-label="Volume" onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()} onChange={(e) => engine.dispatch(cmd.setPlacementVolume(selected.placement.id, Number(e.target.value)))} />
        </label>] : []),
      tool(selected.track.muted ? "🔈" : "🔇", selected.track.muted ? "Unmute track" : "Mute track", () => engine.dispatch(cmd.toggleTrackMute(selected.track.id))),
      ...(hasClip ? [tool(pasteAction.icon, pasteAction.label, paste, "paste", pasteAction.title)] : []),
      rippleToggle, snapToggle,
    ],
    multi: [
      <span key="n" className="v2-sel-count" role="status">{sel.length} selected · tap clips</span>,
      tool("🗑", "Delete", () => delSel(), "del"),
      ...clipActions.map((a) => tool(a.icon, a.label, a.run, a.label, a.title)),
    ],
    audio: [tool("＋", "Add audio", () => setPicker("audio"), "add-audio", "Add music or sound from this project or your device")],
    speed: sp ? SPEEDS.map((s) => (
      <button key={s} className={`v2-tool ${(sp.speed ?? 1) === s ? "is-active" : ""}`} aria-pressed={(sp.speed ?? 1) === s} onClick={() => engine.dispatch(cmd.setSpeed(sp.id, s))}><b>{s}×</b><span>{s === 1 ? "Normal" : s < 1 ? "Slow" : "Fast"}</span></button>
    )) : [],
    text: [
      tool("T", "Add text", addText, "add-text", "Add a text clip at the playhead"),
      tool("sticker", "Stickers", () => setPicker("stickers"), "stickers", "Add stickers to the Text & Stickers group"),
      ...textTools.slice(1).map((a) => tool(a.icon, a.label, a.run, a.label, a.title)),
      tool("template", "Templates", () => { addText(); setTextOpen(true); }, "templates", "Add a text clip and pick a template"),
    ],
    effect: [
      tool("＋", "Add effect", () => setFxOpen(true), "add-effect", "Add an effect clip at the playhead (changes only the main track)"),
      tool("⧓", "Transition", addTransitionNearPlayhead, "transition", "Add a crossfade at the cut nearest the playhead"),
    ],
    overlay: [tool("＋", "Add overlay", () => setPicker("overlay"), "add-overlay", "Add photos, videos or clips on a new layer above, at the playhead")],
  };

  return (
    <div className={`v2-app ${mobile ? "is-mobile" : "is-desktop"} ${fs ? "is-fs" : ""}`}>
      {mobile ? (
        <header className="v2-header v2-mheader">
          <a className="v2-icon v2-close" href={window.location.pathname} aria-label="Close (back to classic editor)"><Ic g="✕" /></a>
          <button className="v2-icon v2-projects-btn" aria-label="Projects" title="Projects: new, open, rename, delete" onClick={() => setProjects(true)}><Ic g="☰" /></button>
          <span className="v2-spacer" />
          <select className="v2-res" aria-label="Export resolution" value={res} onChange={(e) => setRes(e.target.value as Resolution)}>
            {["720p", "1080p", "2K", "4K"].map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="v2-export" title="Export MP4 (⌘/Ctrl+E)" onClick={openExport}>Export</button>
        </header>
      ) : (
        <header className="v2-header">
          <a className="v2-back" href={window.location.pathname} title="Back to classic editor">‹ Classic</a>
          <button className="v2-btn v2-projects-btn" aria-label="Projects" title="Projects: new, open, rename, delete" onClick={() => setProjects(true)}><Ic g="☰" size={16} /> Projects</button>
          <input className="v2-title" value={project.name} aria-label="Project name" onFocus={() => engine.beginGesture()} onBlur={() => engine.endGesture()} onChange={(e) => engine.dispatch(cmd.renameProject(e.target.value))} />
          <span className="v2-badge">v2 preview</span>
          <button className="v2-btn primary v2-export-d" title="Export MP4 (⌘/Ctrl+E)" onClick={openExport}>Export</button>
        </header>
      )}
      {notice && <RecoveryNotice failure={notice} storage={storage} onDismiss={() => setNotice(undefined)} />}
      {projects && <ProjectsDialog storage={storage} current={project} onOpen={(id) => { setProjects(false); onSwitch(id); }} onRenameCurrent={(n) => engine.dispatch(cmd.renameProject(n))} onClose={() => setProjects(false)} />}
      {exporting && <ExportDialog project={project} blobs={storage.blobs} res={res} onRes={setRes} onClose={() => setExporting(false)} />}
      {htmlEdit && <HtmlEditor source={htmlEdit.source} mobile={mobile} onSave={(h) => void saveCode(h)} onClose={() => setHtmlEdit(undefined)} />}
      {toast && <div className="v2-toast" role="status" onClick={() => setToast(undefined)}>{toast}</div>}
      {mobile ? (
        <>
          {preview}
          <div className="v2-mcontrols">
            <button className="v2-icon" aria-label="Fullscreen" onClick={fullscreen}><Ic g="⛶" /></button>
            <button className="v2-icon v2-mplay" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}><Ic g={playing ? "❚❚" : "▶"} /></button>
            <span className="v2-mundo">
              <button className="v2-icon" aria-label="Undo" disabled={!canUndo} onClick={() => engine.undo()}><Ic g="↶" /></button>
              <button className="v2-icon" aria-label="Redo" disabled={!canRedo} onClick={() => engine.redo()}><Ic g="↷" /></button>
            </span>
          </div>
          <PanelGrabber vh={previewVh} onChange={setPreviewVh} />
          <Timeline focus={focusGroup} engine={engine} project={project} time={time} playing={playing} onSeek={seek} selectedId={selectedId} selectedIds={sel} onToggleSelect={toggleClip} multiMode={multiMode} onSelect={selectClip} peaks={peaks} strips={strips} pps={pps} onZoom={(z) => setPps(clampPps(z))} centered topLane={topLane} ripple={ripple} onTransition={onTransition} onEditLayer={editLayer} expanded={expanded} onExpand={onExpand}
            thumbs={thumbs} onAddMedia={() => setPicker("main")}
            timeLabel={<><b>{formatTimecode(time, project.settings.fps).slice(0, 5)}</b> / {formatTimecode(duration, project.settings.fps).slice(0, 5)}</>}
            sideColumn={<>
              {firstVideoTrack && <button className="v2-side-btn" onClick={() => engine.dispatch(cmd.toggleTrackMute(firstVideoTrack.id))}><b aria-hidden><Ic g={firstVideoTrack.muted ? "🔇" : "🔊"} /></b><span>{firstVideoTrack.muted ? "Unmute clip audio" : "Mute clip audio"}</span></button>}
              <button className="v2-side-btn v2-cover" onClick={() => seek(0)} style={firstClip && thumbs[firstClip.source.assetId] ? { backgroundImage: `url(${thumbs[firstClip.source.assetId]})` } : undefined}><span>Cover</span></button>
            </>} />
          <nav className="v2-toolbar" aria-label={selected ? "Clip actions" : "Timeline actions"}>
            {(activeMenu !== "root" || expanded) && <button className="v2-tool v2-tool-back" aria-label={activeMenu === "root" && expanded ? `Collapse ${ops.GROUP_LABEL[expanded]}` : "Back"} title={activeMenu === "root" && expanded ? `Collapse ${ops.GROUP_LABEL[expanded]}` : "Back"} onClick={back}>‹</button>}
            {mobileTools[activeMenu]}
          </nav>
          {picker && <MediaPicker media={projectMedia} title={picker === "overlay" ? "Add overlay" : picker === "audio" ? "Add audio" : picker === "stickers" ? "Add stickers" : "Add media"} only={picker === "audio" ? "audio" : undefined} initialTab={picker === "stickers" ? "stickers" : undefined} onClose={() => setPicker(null)} onAdd={(p) => void addPicked(p, picker === "overlay" || picker === "stickers" ? "overlay" : "main")} />}
          {sheet && <Sheet label="Media" onClose={() => setSheet(false)}>{browser}</Sheet>}
          {!sheet && <div hidden>{browser}</div>}
          {cue && <div className="v2-msub"><SubtitleEditor engine={engine} sub={cue} onDelete={delCue} /></div>}
          {inspOpen && selected && <Sheet label="Adjust" className="v2-msheet-insp" onClose={() => setInspOpen(false)}><TransformInspector engine={engine} placement={selected.placement} time={time} /><button className="v2-btn" onClick={() => setInspOpen(false)}>Done</button></Sheet>}
          {layerTrack && !selected && <Sheet label="Edit all" className="v2-msheet-insp" onClose={() => setLayerEdit(undefined)}><TextPanel key={layerTrack.id} engine={engine} layer={layerTrack} initialTab="Style" /><button className="v2-btn" onClick={() => setLayerEdit(undefined)}>Done</button></Sheet>}
          {textOpen && selected && isText && <Sheet label="Text" className={`v2-msheet-insp ${animLoop ? "is-compact" : ""}`} onClose={closeAnim}><TextPanel engine={engine} placement={effSel} track={selTrack} onAnimPicked={() => setAnimLoop(true)} /><button className="v2-btn" onClick={closeAnim}>Done</button></Sheet>}
          {fxOpen && <Sheet label="Effects" className="v2-msheet-insp" onClose={() => setFxOpen(false)}><EffectPicker engine={engine} at={time} placement={isEffect ? selected!.placement : undefined} onAdded={(id) => setSel([id])} onClose={() => setFxOpen(false)} /><button className="v2-btn" onClick={() => setFxOpen(false)}>Done</button></Sheet>}
          {animOpen && !textOpen && selected && isText && <Sheet label="Animation" className={`v2-msheet-insp v2-anim-sheet ${animLoop ? "is-compact" : ""}`} onClose={closeAnim}><AnimationPicker engine={engine} placement={selected.placement} onPicked={() => setAnimLoop(true)} /><button className="v2-btn" onClick={closeAnim}>Done</button></Sheet>}
        </>
      ) : (
        <div className={`v2-desktop-grid ${sideOpen ? "" : "side-closed"}`}>
          <button className="v2-icon v2-side-toggle" aria-label={sideOpen ? "Hide side panel" : "Show side panel"} title={sideOpen ? "Hide side panel" : "Show side panel"} aria-expanded={sideOpen} onClick={() => setSideOpen(!sideOpen)}><Ic g={sideOpen ? "panel-close" : "panel-open"} size={18} /></button>
          <div className="v2-side" hidden={!sideOpen}>{selected && isText && <TextPanel engine={engine} placement={effSel} track={selTrack} onAnimPicked={() => setAnimLoop(true)} />}{selected && isEffect && <EffectPicker engine={engine} at={time} placement={selected.placement} />}{selected && !isEffect && <TransformInspector engine={engine} placement={selected.placement} time={time} />}{layerTrack && !selected && <TextPanel key={layerTrack.id} engine={engine} layer={layerTrack} initialTab="Style" />}{!selected && !cue && !layerTrack && <details className="v2-side-fx" open={fxOpen} onToggle={(e) => setFxOpen((e.currentTarget as HTMLDetailsElement).open)}><summary title="Effect layers: blur, zoom, B&W, vignette… applied to the main track">Effects</summary><EffectPicker engine={engine} at={time} onAdded={(id) => setSel([id])} /></details>}{cue && <SubtitleEditor engine={engine} sub={cue} onDelete={delCue} />}{browser}</div>
          {preview}
          <section className="v2-timeline-panel" aria-label="Timeline">
            <div className="v2-timeline-toolbar">{selectionActions}<span className="v2-hint">Space play · S split · F freeze · Del delete · Shift+Del ripple · R ripple · Shift-click multi-select · ⌘C/⌘V/⌘D · ⌘/Ctrl+Z undo</span></div>
            <Timeline focus={focusGroup} engine={engine} project={project} time={time} playing={playing} onSeek={seek} selectedId={selectedId} selectedIds={sel} onToggleSelect={toggleClip} multiMode={multiMode} onSelect={selectClip} peaks={peaks} strips={strips} pps={pps} onZoom={(z) => setPps(clampPps(z))} centered={false} topLane={topLane} ripple={ripple} onTransition={onTransition} onEditLayer={editLayer} />
          </section>
        </div>
      )}
    </div>
  );
}

function AssetThumb({ asset, engineBlobs }: { asset: Asset; engineBlobs: EditorContext["storage"]["blobs"] }) {
  const [url, setUrl] = useState<string>();
  const key = (asset.versions.find((v) => v.id === asset.selectedVersionId) ?? asset.versions[0])?.media.blobKey;
  useEffect(() => {
    if (asset.kind === "audio" || asset.kind === "html" || !key) return;
    let u: string | undefined;
    let alive = true;
    void engineBlobs.get(key).then((b) => { if (b && alive) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [key, asset.kind, engineBlobs]);
  if (asset.kind === "html") return <span className="v2-thumb" title="HTML clip (sandboxed)"><Ic g="</>" /></span>;
  if (asset.kind === "audio" || !url) return <span className="v2-thumb">{asset.kind === "audio" ? <Ic g="♫" /> : "…"}</span>;
  return asset.kind === "image" ? <img className="v2-thumb" src={url} alt="" /> : <video className="v2-thumb" src={`${url}#t=0.1`} muted preload="metadata" />;
}

/** Shown when the last project failed its schema check. The original record is never modified. */
function RecoveryNotice({ failure, storage, onDismiss }: { failure: LoadFailure; storage: EditorContext["storage"]; onDismiss: () => void }) {
  const download = async () => {
    const raw = await storage.projects.loadRaw(failure.projectId);
    const url = URL.createObjectURL(new Blob([JSON.stringify(raw, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `dionysus-backup-${failure.projectId}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="v2-recovery" role="alert">
      <strong>Your last project couldn’t be opened.</strong>
      <p>{failure.error} It is still saved and has not been changed; you are in a new “Recovered session”.</p>
      <div className="v2-recovery-actions">
        <button className="v2-btn primary" onClick={() => void download()}>Download backup</button>
        <button className="v2-btn" onClick={() => location.reload()}>Retry</button>
        <button className="v2-btn" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}


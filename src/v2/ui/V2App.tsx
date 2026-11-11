import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hitCandidates, isBackdrop, pickAt, Player, readClipConfig } from "../render";
import { cmd } from "../engine";
import { htmlRoleOf, importFile } from "../persistence";
const withoutRole = <T extends { role?: unknown }>(m: T): Omit<T, "role"> => { const { role: _r, ...rest } = m; return rest; };
import { sourceAt, tracking, masking, board as storyDomain, chain, compositionDuration, edit, layers, ops, findPlacement, newId, formatTimecode, secondsToTicks, TICKS_PER_SECOND, versionOfPlacement, clipVersion, type Asset } from "../domain";
import type { Composition, Project } from "../domain";
import { useEditorBoot, useEngineState, useIsMobile, type EditorContext, type LoadFailure } from "./useEditor";
import { Timeline } from "./Timeline";
import { clampPps } from "./gestures";
import { useThumbs } from "./useThumbs";
import { clipTimeAt, clipTimeText } from "./clipTime";
import type { ClipLoad } from "../render";
import { useMediaPreviews } from "./useMedia";
import { TransformHandles, TransformInspector } from "./Transform";
import { TextPanel } from "./TextPanel";
import { AnimationPicker } from "./AnimationPicker";
import { CodeEditor } from "./CodeEditor";
import { mixFromPlayer } from "./codeClipMix";
import { CodeAiWizard } from "./CodeAiWizard";
import { AudioEditor } from "./AudioEditor";
import { audioClipAsset, storeAudioClip } from "./audioClipAsset";
import type { AudioClip } from "../domain";
import { clipFileFrom } from "./htmlPackage";
import { ExportDialog } from "./ExportDialog";
import { ProjectsDialog } from "./Projects";
import { StoryboardView } from "./storyboard/StoryboardView";
import { connectAgentBridge } from "./agent/webMcp";
import { AgentIndicator } from "./agent/AgentPanel";
import type { BoardTarget } from "./storyboard/BoardView";
import type { Resolution } from "../render";
import { BlankColorPicker } from "./BlankClip";
import { AudioAiSheet } from "./AudioAiSheet";
import { downloadSrt, importSrtFile, importSrtText, SubtitleImport, SubtitleEditor, SubtitleLane } from "./Subtitles";
import { downloadText, SubtitleList } from "./SubtitleList";
import { cues as cueLayer } from "../domain";
import { Ic } from "./Icon";
import { canSetInPoint, InPointControl } from "./InPoint";
import { AdjustRange, canAdjustRange, canReplaceAsset } from "./AdjustRange";
import { ClipVersionPicker } from "./ClipVersionPicker";
import { BrandLogo } from "./BrandLogo";
import { PreviewFsControls } from "./PreviewFsControls";
import { canLockOrientation, needsCssRotate, preferredPreviewOrient, previewOrientFallback, toggleOrient, type PreviewOrient } from "./previewOrient";
import { PastePlaceDialog } from "./PastePlaceDialog";
import { ClipFrames } from "./ClipFrames";
import { makeAnalyse, MatchFrames } from "./MatchFrames";
import { clipRange, links } from "../domain";
import { MediaPicker, type Picked } from "./MediaPicker";
import type { FromVideoPick, UploadedVideo } from "./FromVideoTab";
import { extractAudioWav, probeVideoAudio, readFileWithProgress } from "./media";
import { fromVideo as fromVideoDomain, type MediaRef } from "../domain";
import { projectMediaList } from "./projectMedia";
import { stickerFile, stickers } from "./libraryItems";
import { newCodeClipHtml } from "./codeSamples";
import { CleanupDialog } from "./CleanupDialog";
import { TrackSheet } from "./TrackSheet";
import { MaskSheet } from "./MaskSheet";
import type { TrackRangeChange } from "./TracksLane";
import { makeTrackAnalyse, rangeTrack } from "./trackAnalyse";
import { EffectPicker } from "./EffectPicker";
import { SyncSheet } from "./SyncSheet";
import { ProjectSettings as MobileProjectSettings } from "./desktop/ProjectSettings";
import { HtmlParamsPanel } from "./HtmlParamsPanel";
import { TransitionPicker, cutOf } from "./TransitionPicker";
import { loadPreviewVh, PanelGrabber, Sheet, SheetDone } from "./Sheet";
import { ActionGrid } from "./ActionGrid";
import { useEdgeFade } from "./useEdgeFade";
import { AssetBrowser, browserTab, type BrowserTab } from "./desktop/AssetBrowser";
import { Inspector, type InspectorTab } from "./desktop/Inspector";
import { ProjectSettings } from "./desktop/ProjectSettings";
import { SeriesLibrary } from "./series/SeriesLibrary";
import { useSeriesSync } from "./series/seriesStore";
import { Splitter } from "./desktop/Splitter";
import { clampSizes, DEFAULT_SIZES, LIMITS, loadSizes, previewCanvasSize, saveSizes, type PanelSizes } from "./desktop/layout";
import { readDragItem } from "./desktop/dnd";
import "./desktop/desktop.css";
import { ContextMenu, type MenuItem } from "./desktop/ContextMenu";
import { PromoteSheet } from "./PromoteSheet";
import { ShortcutsOverlay } from "./desktop/ShortcutsOverlay";
import { DesktopTooltips } from "./desktop/Tooltip";
import { editPoints, jumpEditPoint, MOD, shuttleLabel, shuttleNext, splitTargets } from "./desktop/shortcuts";
import { type Sticker } from "./libraryItems";
import { text as textDomain } from "../domain";
import { canChromaKey, CHROMA_DEFAULT, hasSound } from "../domain";
import { codePresetId, codeRoleOf, promote } from "../domain";
import { AudioFxPanel, ChromaKeyPanel, VolumeCurve } from "./SoundAndKey";
import { SpatialPad } from "./SpatialPad";
import { mediaKey } from "./useMedia";
import { SliderField } from "./SliderField";

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
  // P4C: WebMCP storyboard tools, registered only while the user allows agent access and the browser has WebMCP.
  useEffect(() => connectAgentBridge(engine, storage.blobs), [engine, storage.blobs]);
  const [notice, setNotice] = useState(recovery);
  const { project, canUndo, canRedo } = useEngineState(engine);
  // P5: keep the project and its Series in step (both directions).
  useSeriesSync(engine, project);
  const [seriesLib, setSeriesLib] = useState(false);
  const mobile = useIsMobile();
  const [previewVh, setPreviewVh] = useState(loadPreviewVh);
  /** Opening a side editor on desktop reveals the inspector if it was hidden. */
  const setSideOpen = (open: boolean) => { if (open) setSizes((z) => (z.rightOpen ? z : { ...z, rightOpen: true })); };
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const selectedId = sel.length === 1 ? sel[0] : undefined;
  const setSelectedId = (id?: string) => setSel(id ? [id] : []);
  const [multiMode, setMultiMode] = useState(false);
  const clipboard = useRef<edit.ClipboardItem[]>([]);
  const [hasClip, setHasClip] = useState(false);
  /** P51/P52: paste asks where to land and which track; false means the dialog is closed. */
  const [pasteAsk, setPasteAsk] = useState(false);
  const [pasteTrack, setPasteTrack] = useState(chain.NEW_PASTE_TRACK);
  /** Ticks captured when "Insert new clip after" opens, so the picker stays aimed at that cut. */
  const insertAt = useRef(0);
  /** V2-107 desktop: J/K/L shuttle rate (0 = stopped, 1 = normal play), "?" sheet, right-click menu. */
  const [rate, setRate] = useState(0);
  const [kbdOpen, setKbdOpen] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; placementId?: string; trackId?: string; ticks: number }>();
  const [pps, setPps] = useState(40);
  const [sheet, setSheet] = useState(false);
  const [picker, setPicker] = useState<null | "main" | "overlay" | "audio" | "fromVideo" | "stickers" | "insert">(null);
  const [busy, setBusy] = useState(0);
  const [menu, setMenu] = useState<Menu>("root");
  /** Mobile: which timeline group is expanded into its layers (the toolbar ‹ collapses it). */
  const [expanded, setExpanded] = useState<ops.TrackGroup>();
  const [res, setRes] = useState<Resolution>("1080p");
  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState(false);
  const [board, setBoard] = useState(false);
  const [boardOpen, setBoardOpen] = useState<BoardTarget>(); // shot or slot to open with the board ("Open in storyboard")
  const openExport = () => { player.pause(); setExporting(true); };
  const [fs, setFs] = useState(false);
  const [docFs, setDocFs] = useState(false);
  const [fsOrient, setFsOrient] = useState<PreviewOrient>(() => preferredPreviewOrient(project.settings.width, project.settings.height));
  const [previewMute, setPreviewMute] = useState(false);
  const [toast, setToast] = useState<string>();
  /** Toast with an inline Undo button (linked-clip delete). */
  const [toastUndo, setToastUndo] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [inspOpen, setInspOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  /** P26: the "Adjust range" / "Replace asset" sheet (mobile) or side panel (desktop) for one clip. */
  const [rangeFor, setRangeFor] = useState<{ id: string; picker?: boolean }>();
  const [verOpen, setVerOpen] = useState(false);
  /** V2-SB-133: the phone "In point" sheet. */
  const [inOpen, setInOpen] = useState(false);
  /** P20: clip id whose "Promote to main track" sheet is open. */
  const [promoteFor, setPromoteFor] = useState<string>();
  // P3B: chroma key / volume curve / audio FX sheets (phone) and the eyedropper (the clip id being picked for).
  const [ckOpen, setCkOpen] = useState(false);
  const [vcOpen, setVcOpen] = useState(false);
  /** P32: clip-bar sheets — Trim (start/end), Audio (volume & sound tools), More (everything else). */
  const [barSheet, setBarSheet] = useState<"trim" | "audio" | "colour">();
  const [afxOpen, setAfxOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  const [eyedrop, setEyedrop] = useState<string>();
  const [textOpen, setTextOpen] = useState(false);
  /** V2-103: text layer being edited as a whole ("Edit all"). */
  const [layerEdit, setLayerEdit] = useState<string>();
  const [subsEdit, setSubsEdit] = useState<string>();
  const [subsCue, setSubsCue] = useState<string>();
  const [subsPick, setSubsPick] = useState(false);
  const toolbarFade = useEdgeFade<HTMLElement>();
  /** V2-111: the layer the last SRT import created — "Edit subtitles" opens it directly instead of asking. */
  const [srtLayer, setSrtLayer] = useState<string>();
  /** V2-103: gizmo scope on styled text layers; undefined = layer default (Whole layer for subtitles). */
  const [gizmoScope, setGizmoScope] = useState<"clip" | "layer">();
  /** V2-098: animation sheet; after a pick the sheet shrinks and the preview loops over the clip's time range. */
  const [animOpen, setAnimOpen] = useState(false);
  const [fxOpen, setFxOpen] = useState(false);
  const [cleanOpen, setCleanOpen] = useState(false);
  /** P40: the Track sheet: `{}` adds a tracker, `{ trackId }` reviews one. */
  /** P40: a Tracks-lane span was dragged: shrink drops analysis outside, extend analyses only the new part. */
  const trackRange = async ({ clipId, trackId, start, end }: TrackRangeChange) => {
    const pl = findPlacement(engine.getState().project.compositions[engine.getState().project.rootCompositionId], clipId)?.placement, tr = pl && tracking.tracksOf(pl).find((t) => t.id === trackId);
    if (!pl || !tr) return;
    const inS = sourceAt(pl, start), outS = sourceAt(pl, end - 1) + 1;
    if (!tracking.missingRanges(tr, inS, outS).length) { engine.dispatch(cmd.commitTrack(clipId, tracking.withRange(tr, inS, outS))); return; }
    setToast(`${tr.name}: tracking the new part…`);
    try {
      const next = await rangeTrack(makeTrackAnalyse(() => loadAssetBlob(pl.source.assetId)), engine.getState().project, pl, tr, inS, outS);
      engine.dispatch(cmd.commitTrack(clipId, next)); setToast(`${tr.name}: range updated (${next.samples.length} frames)`);
    } catch (e) { setToast((e as Error).message || "Tracking failed"); }
  };
  const openTrack = (clipId: string, trackId: string) => { player.pause(); selectClip(clipId); setTrackOpen({ trackId }); };
  const [trackOpen, setTrackOpen] = useState<false | { trackId?: string }>(false);
  /** P49: the Mask sheet (shape and freeform). The draft is previewed, not stored, until ✓. */
  const [maskOpen, setMaskOpen] = useState(false);
  /** V2-HTML-PARAMS: the mobile sheet with the selected HTML clip's param values. */
  const [paramsOpen, setParamsOpen] = useState(false);
  /** V2-TL-TRANS: incoming clip of the cut whose transition picker sheet is open (mobile). */
  const [transFor, setTransFor] = useState<string>();
  /** Stop time (ticks) of a junction preview started by the transition picker. */
  const stopAt = useRef<number>();
  const [animLoop, setAnimLoop] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  /** The Code Editor: an existing clip (new version on save), or `create` a new one (Add Media → Code → Create). */
  /** P4A-3: the Audio editor (create: a new clip added to the timeline; else a new version of the asset). */
  const [audioEdit, setAudioEdit] = useState<{ placementId?: string; assetId?: string; source?: string; create?: boolean }>();
  const [htmlEdit, setHtmlEdit] = useState<{ placementId?: string; assetId?: string; source: string; create?: "main" | "overlay" | "insert" }>();
  const [inlineId, setInlineId] = useState<string>();
  const [subId, setSubId] = useState<string>();
  const [ripple, setRippleState] = useState(() => localStorage.getItem("v2.ripple") === "1");
  const setRipple = (on: boolean) => { setRippleState(on); localStorage.setItem("v2.ripple", on ? "1" : "0"); setToast(on ? "Ripple on: delete and trim close gaps" : "Ripple off"); };
  const srtRef = useRef<HTMLInputElement>(null);
  const [subImport, setSubImport] = useState(false);
  /** V2-106 desktop shell: panel sizes (persisted), browser tab, inspector tab. */
  const [sizes, setSizes] = useState<PanelSizes>(() => loadSizes(undefined, window.innerHeight));
  const sizesRef = useRef(sizes); sizesRef.current = sizes;
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => { const r = () => setVp({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", r); window.addEventListener("orientationchange", r); return () => { window.removeEventListener("resize", r); window.removeEventListener("orientationchange", r); }; }, []);
  const lay = clampSizes(sizes, vp.w, vp.h);
  const resize = (patch: Partial<PanelSizes>) => {
    // Update the ref synchronously so a keyboard step can commit (persist) in the same tick.
    const n = clampSizes({ ...sizesRef.current, ...patch }, window.innerWidth, window.innerHeight);
    sizesRef.current = n; setSizes(n);
  };
  const commitSizes = () => saveSizes(sizesRef.current);
  const togglePanel = (k: "leftOpen" | "rightOpen") => setSizes((s) => { const n = { ...s, [k]: !s[k] }; saveSizes(n); return n; });
  const [btab, setBtabState] = useState<BrowserTab>(() => browserTab(localStorage.getItem("v2.browserTab")));
  const setBtab = (t: BrowserTab) => { setBtabState(t); localStorage.setItem("v2.browserTab", t); };
  const [itab, setItab] = useState<string>();
  const preferTab = useRef<string>();
  const [, setFrame] = useState(0); // bumps on every drawn frame so on-canvas handles track player.boxes
  const thumbs = useThumbs(project, storage.blobs);
  const { peaks, strips } = useMediaPreviews(project, storage.blobs);
  /** P2C (item 7): the selected version's file of a project asset, for the picker's preview. */
  const loadAssetBlob = (assetId: string) => {
    const a = engine.getState().project.assets[assetId];
    const v = a && (a.versions.find((x) => x.id === a.selectedVersionId) ?? a.versions[a.versions.length - 1]);
    return v ? storage.blobs.get(v.media.blobKey) : Promise.resolve(undefined);
  };
  useEffect(() => { if (!toast) { setToastUndo(false); return; } const t = setTimeout(() => setToast(undefined), toastUndo ? 6000 : 3000); return () => clearTimeout(t); }, [toast, toastUndo]);
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
    setPasteTrack(chain.defaultPasteTrackId(comp, clipboard.current));
    setPasteAsk(true);
  };
  /** P51/P52: one undo step. Cancel never reaches here. "after" is refused when there is no current clip. */
  const commitPaste = (where: chain.PasteWhere) => {
    setPasteAsk(false);
    const opts = { selectedIds: sel, time: Math.round(player.time) };
    const at = chain.pasteOrigin(comp, where, opts);
    if (at === undefined) { setToast("No current clip — select a main-track clip, or move the playhead onto one"); return; }
    const ids = clipboard.current.map(() => newId("plc"));
    const target = pasteTrack === chain.NEW_PASTE_TRACK ? { newTrack: true as const } : { trackId: pasteTrack };
    const exact = where === "playhead";
    if (exact && chain.pasteOverlaps(comp, clipboard.current, at, target)) {
      setToast("Can't paste at the playhead: a clip is already there");
      return;
    }
    if (engine.dispatch(cmd.pasteClips(clipboard.current, at, ids, !exact, { target, exact }), "Paste clip")) setSel(ids);
    else if (exact) setToast("Can't paste at the playhead: a clip is already there");
  };
  const duplicate = () => { if (!sel.length) return; const ids = sel.map(() => newId("plc")); engine.dispatch(cmd.duplicateClips(sel, ids)); setSel(ids); };
  /** Preview duplicate: copy on a new track right above, same time, nudged ~20px, copy selected. */
  const duplicateAbove = () => {
    if (sel.length !== 1) return duplicate();
    const st = engine.getState().project.settings; const id = newId("plc");
    engine.dispatch(cmd.duplicateAbove(sel[0], id, 20 / (st?.width || 1080), 20 / (st?.height || 1920))); setSel([id]);
  };
  /** P9-LINK: deleting a main clip deletes its linked clips in the same undo step; say so. */
  const linkedGone = (ids: string[]) => { const c = engine.getState().project.compositions[engine.getState().project.rootCompositionId]; return ids.flatMap((id) => links.linkedTo(c, id)).filter((x) => !ids.includes(x.id)).length; };
  const delToast = (n: number) => { if (n) { setToast(`Deleted ${n} linked clip${n > 1 ? "s" : ""} with it`); setToastUndo(true); } };
  const delSel = (rippleOverride?: boolean) => { if (sel.length) { const n = linkedGone(sel); if (engine.dispatch(cmd.deleteClips(sel, rippleOverride ?? ripple))) delToast(n); setSel([]); setMultiMode(false); } };
  /** Junction button: open the transition picker for the cut before clip `id` (sheet on mobile, inspector tab on desktop). */
  const onTransition = (id: string) => {
    if (!cutOf(comp, id)) return;
    if (mobile) { setTransFor(id); return; }
    setSel([id]); setSubId(undefined); preferTab.current = "transition"; setItab("transition");
  };
  const selectCue = (id?: string) => { setSubId(id); if (id) setSelectedId(undefined); };
  const addText = () => { const id = newId("plc"); if (engine.dispatch(cmd.addTextClip(Math.round(player.time), {}, id))) { setSel([id]); setSubId(undefined); } };
  const delCue = () => { if (subId) { engine.dispatch(cmd.removeSubtitle(subId)); setSubId(undefined); } };
  const onSubPaste = (text: string) => {
    const rootOf = () => { const p = engine.getState().project; return p.compositions[p.rootCompositionId]; };
    const before = new Set(rootOf().tracks.map((t) => t.id));
    const n = importSrtText(engine, text);
    const added = rootOf().tracks.find((t) => !before.has(t.id) && t.kind === "text");
    if (added) setSrtLayer(added.id);
    setSubImport(false);
    setToast(`Imported ${n} subtitle${n === 1 ? "" : "s"} (Undo to revert)`);
  };
  const onSrt = async (f?: File) => {
    setSubImport(false);
    if (!f) return;
    const rootOf = () => { const p = engine.getState().project; return p.compositions[p.rootCompositionId]; };
    const before = new Set(rootOf().tracks.map((t) => t.id));
    const n = await importSrtFile(engine, f);
    const added = rootOf().tracks.find((t) => !before.has(t.id) && t.kind === "text");
    if (added) setSrtLayer(added.id);
    setToast(n ? `Imported ${n} subtitle${n === 1 ? "" : "s"} (Undo to revert)` : `${f.name}: no subtitles found`);
  };
  const subLayer = comp.tracks.find((t) => t.kind === "text" && t.layerStyle?.subtitle && t.placements.length) ?? comp.tracks.find((t) => t.kind === "text" && t.placements.some((p) => p.clipType === "text"));
  const exportSrt = () => (subLayer ? downloadText(cueLayer.layerToSrt(subLayer), project.name) : cues.length ? downloadSrt(cues, project.name) : setToast("No subtitles to export — import an SRT or add text first"));
  const topLane = cues.length ? { label: "Text", render: (toPx: (t: number) => number, toTicks: (px: number) => number) => <SubtitleLane engine={engine} list={cues} selectedId={subId} onSelect={selectCue} toPx={toPx} toTicks={toTicks} /> } : undefined;
  const openSubImport = () => { setSheet(false); setSubsEdit(undefined); setSubImport(true); };
  const textTools = [
    { icon: "T", label: "Add text", title: "Add a text clip at the playhead (T)", run: addText },
    { icon: "srt-in", label: "Import SRT", title: "Paste SRT or VTT text, or choose a file, as a new text layer", run: openSubImport },
    { icon: "≡", label: "Subtitles", title: "Edit every subtitle in a list: text, timing, split, merge, find & replace", run: () => editSubtitles() },
    { icon: "srt-out", label: "Export SRT", title: "Download subtitles as an .srt file", run: exportSrt },
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
  const subsTrack = subsEdit ? comp.tracks.find((t) => t.id === subsEdit) : undefined;
  useEffect(() => { if (subsEdit && !subsTrack) setSubsEdit(undefined); }, [subsEdit, subsTrack]);
  const openSubs = (id: string, cueId?: string) => { setSubsEdit(id); setSubsCue(cueId); setSubsPick(false); setLayerEdit(undefined); setSel([]); setSideOpen(true); };
  // V2-105: toolbar entry. Selected clip's layer → else the only text layer → else a picker (subtitle layers first).
  const textLayers = comp.tracks.filter((t) => t.kind === "text" && t.placements.some((p) => p.clipType === "text")).sort((a, b) => Number(!!b.layerStyle?.subtitle) - Number(!!a.layerStyle?.subtitle));
  const editSubtitles = () => {
    const cur = selected && selected.track.kind === "text" && selected.placement.clipType === "text" ? selected : undefined;
    if (cur) return openSubs(cur.track.id, cur.placement.id);
    if (!textLayers.length) return setToast("No subtitles yet — Import SRT or Add text first");
    if (textLayers.length === 1) return openSubs(textLayers[0].id);
    const recent = textLayers.find((t) => t.id === srtLayer);
    setSrtLayer(undefined); // one-shot: straight after Import SRT, open the layer that was just made
    if (recent) return openSubs(recent.id);
    setSubsPick(true);
  };
  const editLayer = (id: string) => { setSel([]); setSubId(undefined); setLayerEdit(id); if (!mobile) setSideOpen(true); };
  const layerRoute = scope === "layer" && selTrack ? (patch: { x?: number; y?: number; scale?: number; rotation?: number } | null) => {
    if (!patch) return;
    const { x, y, scale, rotation } = patch;
    engine.dispatch(cmd.setLayerStyle(selTrack.id, { transform: Object.fromEntries(Object.entries({ x, y, scale, rotation }).filter(([, v]) => v !== undefined)) }, "Move layer"));
  } : undefined;
  // V2-111: only while a styled text clip is selected; on mobile it lives in the Text/Animation/Adjust sheet header.
  const scopeChip = styledText && <div className="v2-scope-chip" role="radiogroup" aria-label="Move and scale apply to">
    <span className="v2-scope-label" aria-hidden>Apply to:</span>
    {(["clip", "layer"] as const).map((k) => <button key={k} role="radio" aria-checked={scope === k} className={`v2-chip ${scope === k ? "is-active" : ""}`}
      title={k === "clip" ? "Move/scale only this clip (it gets a custom position)" : `Move/scale every clip on ${selTrack!.name}`} onClick={() => setGizmoScope(k)}>{k === "clip" ? "This clip" : "All in layer"}</button>)}
  </div>;

  if (!playerRef.current) playerRef.current = new Player(project, storage.blobs);
  const player = playerRef.current;
  useEffect(() => { player.onTime = (t, p) => { if (p && stopAt.current !== undefined && t >= stopAt.current) { stopAt.current = undefined; player.pause(); return; } setTime(t); setPlaying(p); setFrame((f) => f + 1); }; return () => player.dispose(); }, [player]);
  useEffect(() => { player.previewMute = previewMute; }, [player, previewMute]);
  useEffect(() => {
    const onFs = () => {
      const on = !!document.fullscreenElement;
      setDocFs(on);
      if (!on) {
        setFs(false);
        try { screen.orientation.unlock(); } catch { /* unsupported */ }
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const fsActive = fs || docFs;
  useEffect(() => { player.canvas = canvasRef.current ?? undefined; player.draw(); }, [player, mobile]);
  /** P27-PREVIEW-STABILITY: "Loading" badge while the preview waits for media. */
  const [mediaLoading, setMediaLoading] = useState(false);
  useEffect(() => { player.onLoading = setMediaLoading; return () => { player.onLoading = undefined; }; }, [player]);
  /** P29-CLIP-LOADING: per-clip loading state for the timeline. */
  const [clipLoads, setClipLoads] = useState<ReadonlyMap<string, ClipLoad>>(() => new Map());
  useEffect(() => { player.onClipLoads = setClipLoads; return () => { player.onClipLoads = undefined; }; }, [player]);
  /** P27: Adjust range "Mix" shows its draft in the main preview until Apply/Cancel. */
  const [mixDraft, setMixDraft] = useState<Project>();
  const [mergeDraft, setMergeDraft] = useState<Composition>();
  useEffect(() => {
    player.setProject(mixDraft ?? (mergeDraft ? { ...project, compositions: { ...project.compositions, [project.rootCompositionId]: mergeDraft } } : project));
  }, [player, project, mixDraft, mergeDraft]);
  useEffect(() => { const live = sel.filter((id) => allIds.includes(id)); if (live.length !== sel.length) setSel(live); });
  useEffect(() => { if (subId && !cue) setSubId(undefined); }, [subId, cue]);

  const seek = useCallback((t: number) => { stopAt.current = undefined; player.seek(t); }, [player]);
  const mergePlay = useCallback((p: boolean) => { stopAt.current = undefined; if (p) player.play(); else player.pause(); }, [player]);
  const closeAnim = () => { setAnimOpen(false); setTextOpen(false); if (animLoop) { setAnimLoop(false); player.pause(); } };
  const togglePlay = useCallback(() => { stopAt.current = undefined; return player.isPlaying ? player.pause() : player.play(); }, [player]);
  /** V2-TL-TRANS: play the cut at `at` from about 1 s before the transition to 1 s after it, then pause. */
  const previewCut = useCallback((at: number, d: number) => {
    player.pause(); stopAt.current = undefined;
    player.seek(Math.max(0, at - Math.floor(d / 2) - TICKS_PER_SECOND));
    stopAt.current = at + Math.ceil(d / 2) + TICKS_PER_SECOND;
    player.play();
  }, [player]);
  const playRange = useCallback((from: number, to: number) => { player.pause(); player.seek(from); stopAt.current = to; player.play(); }, [player]);
  const splitAtPlayhead = () => {
    const t = Math.round(player.time), ids = splitTargets(comp, sel, t);
    if (!ids.length) { setToast("No clip under the playhead to split — move the playhead inside a clip"); return; }
    engine.dispatch(ids.map((id) => cmd.splitPlacement(id, t)), ids.length > 1 ? `Split ${ids.length} clips` : "Split clip");
  };
  /** P3A-15: trim the clip(s) under the playhead so they start (or end) exactly there; one undo step, ripple-aware. */
  const trimToPlayhead = (edge: "left" | "right") => {
    const t = Math.round(player.time), ids = splitTargets(comp, sel, t);
    if (!ids.length) { setToast("No clip under the playhead to trim — move the playhead inside a clip"); return; }
    const what = edge === "left" ? "start" : "end";
    engine.dispatch(ids.map((id) => cmd.trimPlacement(id, edge, t, ripple)), ids.length > 1 ? `Trim ${ids.length} clips' ${what} to playhead` : `Trim ${what} to playhead`);
  };
  const cut = () => { if (!sel.length) return; clipboard.current = edit.copyClips(comp, sel); setHasClip(true); engine.dispatch(cmd.deleteClips(sel, ripple)); setToast(`Cut ${sel.length} clip${sel.length > 1 ? "s" : ""} — ${MOD} V to paste`); setSel([]); setMultiMode(false); };
  const split = useCallback(() => { if (selectedId) engine.dispatch(cmd.splitPlacement(selectedId, Math.round(player.time))); }, [engine, player, selectedId]);
  // V2-113: tap selection is forgiving — every element has at least a 48px hit box, near-misses
  // (24px on touch) count, the smallest wins, and tapping the same spot again cycles through overlaps.
  // Empty space deselects, then toggles play.
  const lastTap = useRef<{ x: number; y: number; id?: string }>();
  const canvasPoint = (cx: number, cy: number) => {
    const c = canvasRef.current!, r = c.getBoundingClientRect();
    const k = c.width / (r.width || 1);
    return { x: (cx - r.left) * k, y: (cy - r.top) * k, k, W: c.width, H: c.height };
  };
  /**
   * P3B-12 eyedropper: redraw the frame with this clip's key bypassed, average a 5×5 patch of the preview canvas at
   * the tap, restore, and set it as the key colour (one undo step).
   */
  const sampleKey = (cx: number, cy: number) => {
    const c = canvasRef.current, id = eyedrop;
    if (!c || !id) return;
    const pl = findPlacement(engine.getState().project.compositions[engine.getState().project.rootCompositionId], id)?.placement;
    const { x, y } = canvasPoint(cx, cy);
    let hex: string | undefined;
    try {
      player.keyBypass = id; player.draw();
      const d = c.getContext("2d")!.getImageData(Math.max(0, Math.round(x) - 2), Math.max(0, Math.round(y) - 2), 5, 5).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      if (n) hex = "#" + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("");
    } catch { /* tainted or no 2D context */ } finally { player.keyBypass = null; player.draw(); }
    setEyedrop(undefined);
    if (!hex || !pl) { setToast("Couldn't read a colour there"); return; }
    engine.dispatch(cmd.setChromaKey(id, { ...(pl.chromaKey ?? CHROMA_DEFAULT), color: hex, off: undefined }));
    setToast(`Key colour ${hex}`);
  };
  const tapAt = (cx: number, cy: number, onGizmo = false) => {
    if (!canvasRef.current) return;
    if (eyedrop) { sampleKey(cx, cy); return; }
    const { x, y, k, W, H } = canvasPoint(cx, cy);
    const prev = lastTap.current;
    const again = !!prev && prev.id === selectedId && Math.hypot(cx - prev.x, cy - prev.y) <= 16;
    if (onGizmo && !again) { lastTap.current = { x: cx, y: cy, id: selectedId }; return; }
    const id = pickAt(player.boxes, x, y, { tol: (mobile ? 24 : 8) * k, min: 48 * k, current: selectedId, cycle: again,
      // Re-tapping the selected overlay never jumps to the full-frame background behind it.
      skip: onGizmo ? (pid, b) => pid !== selectedId && isBackdrop(b, W, H) : undefined });
    lastTap.current = { x: cx, y: cy, id };
    if (id) { if (id !== selectedId || sel.length !== 1) { setSel([id]); setSubId(undefined); } }
    else if (selectedId) setSelectedId(undefined);
    else if (!(mobile && (fs || document.fullscreenElement))) togglePlay();
  };
  const otherAt = (cx: number, cy: number) => {
    if (!canvasRef.current) return undefined;
    const { x, y, k, W, H } = canvasPoint(cx, cy);
    return hitCandidates(player.boxes, x, y, { min: 48 * k, skip: (id, b) => id === selectedId || isBackdrop(b, W, H) })[0];
  };
  const onCanvasTap = (e: React.MouseEvent<HTMLCanvasElement>) => tapAt(e.clientX, e.clientY);
  const isText = selected?.placement.clipType === "text";
  const isEffect = selected?.placement.clipType === "effect";
  const selLink = selected?.placement.source.assetId ? storyDomain.storyLinkOf(project, selected.placement.source.assetId) : undefined;
  const openStory = (t: BoardTarget) => { player.pause(); setBoardOpen(t); setBoard(true); };
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
    const ver = pl ? versionOfPlacement(project, pl) : undefined;
    const blob = ver && (await storage.blobs.get(ver.media.blobKey));
    if (pl && blob) setHtmlEdit({ placementId: pl.id, assetId: pl.source.assetId, source: await blob.text() });
    else setToast("Could not load this clip's code");
  };
  /** P38: edit a code effect's package (a new version of the asset; every clip using it follows the selected version). */
  const editCodeAsset = async (assetId: string) => {
    const a = project.assets[assetId];
    const ver = a?.versions.find((v) => v.id === a.selectedVersionId) ?? a?.versions[0];
    const blob = ver && (await storage.blobs.get(ver.media.blobKey));
    if (blob) { setFxOpen(false); setHtmlEdit({ assetId, source: await blob.text() }); } else setToast("Could not load this effect's code");
  };
  /** V2-ADD-MEDIA-TABS: Create opens the Code Editor on a new clip; nothing is imported until it is added. */
  /** P4B: Create code → AI mode wizard (the mode the new clip is added in). */
  const [codeAi, setCodeAi] = useState<"main" | "overlay">();
  const addBlank = (color: string, where: "main" | "overlay") => {
    const id = newId("plc");
    if (engine.dispatch(cmd.addBlankClip(Math.round(player.time), color, where, undefined, id))) { setSel([id]); setSubId(undefined); }
    setPicker(null); setSheet(false);
  };
  /** P51: a blank clip at the cut "Insert after" was opened on. Later main clips ripple. One undo step. */
  const insertBlank = (color: string) => {
    const id = newId("plc");
    if (engine.dispatch(cmd.insertBlankAfter(insertAt.current, color, id))) { setSel([id]); setSubId(undefined); setToast("Blank clip inserted after the current clip"); }
    setPicker(null); setSheet(false);
  };
  const createCode = (mode: "main" | "overlay" | "insert" = "main") => { setPicker(null); setSheet(false); setHtmlEdit({ source: newCodeClipHtml(), create: mode }); };
  /** P38: Effects / Transitions → Custom (code) → New: the editor opens on a starter whose manifest role routes the save. */
  const createCodeRole = (role: "effect" | "transition") => { setFxOpen(false); setTransFor(undefined); setHtmlEdit({ source: newCodeClipHtml(role), create: "main" }); };
  const saveCode = async (html: string, saveMode?: clipVersion.VersionSaveMode) => {
    if (!htmlEdit) return;
    if (htmlEdit.create) {
      const name = (readClipConfig(html).name || "Code clip").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Code clip";
      try {
        const asset = await importFile(new File([html], `${name}.html`, { type: "text/html" }), storage.blobs);
        if (!asset) throw new Error("not an HTML clip");
        const at = htmlEdit.create === "insert" ? insertAt.current : Math.round(player.time);
        const role = htmlRoleOf(html);
        // P38: an effect package becomes an effect clip at the playhead; a transition package waits in Transitions → Custom (code).
        if (role === "effect") { if (engine.dispatch([cmd.importAsset(asset), cmd.addEffectClip(at, codePresetId(asset.id))], "Create code effect")) { setHtmlEdit(undefined); setToast("Code effect added on the Effects layer (Undo to remove)"); } return; }
        if (role === "transition") { if (engine.dispatch(cmd.importAsset(asset), "Create code transition")) { setHtmlEdit(undefined); setToast("Code transition saved: tap a cut → Transitions → Custom (code)"); } return; }
        const place = htmlEdit.create === "insert" ? cmd.insertClipAfter({ at, main: [asset.id] }, [newId("plc")]) : cmd.addAssetsInSequence([asset.id], at, htmlEdit.create === "overlay" ? newId("trk") : undefined);
        if (engine.dispatch([cmd.importAsset(asset), place], htmlEdit.create === "insert" ? "Insert clip after" : "Create code clip")) {
          setHtmlEdit(undefined); setToast(htmlEdit.create === "insert" ? "Code clip inserted after the current clip (Undo to remove)" : "Code clip added (Undo to remove)");
        }
      } catch (e) { setToast(`Could not add the clip: ${e instanceof Error ? e.message : "import failed"}`); }
      return;
    }
    const asset = htmlEdit.assetId ? project.assets[htmlEdit.assetId] : undefined;
    const prev = asset?.versions.find((v) => v.id === asset.selectedVersionId) ?? asset?.versions[0];
    if (!asset || !prev) return;
    const id = newId("ver"), blobKey = `${asset.id}/${id}`;
    await storage.blobs.put(blobKey, new Blob([html], { type: "text/html" }));
    const mode = saveMode === "replace" ? "replace" : "new";
    engine.dispatch(cmd.addAssetVersion(asset.id, { ...prev, id, createdAt: new Date().toISOString(), media: { ...withoutRole(prev.media), blobKey, ...(htmlRoleOf(html) ? { role: htmlRoleOf(html) } : {}) }, provenance: { source: "import", inputs: [] } }, htmlEdit.placementId, { mode }));
    setHtmlEdit(undefined); setToast(mode === "replace" ? "HTML clip updated in place (Undo to revert)" : "HTML clip updated (Undo to revert)");
  };
  const selVersion = selected ? versionOfPlacement(project, selected.placement) : undefined;
  const selAudioSpec = selVersion?.media.specKey;
  const openAudio = async () => {
    const pl = selected?.placement;
    const blob = selAudioSpec ? await storage.blobs.get(selAudioSpec) : undefined;
    if (pl && blob) setAudioEdit({ placementId: pl.id, assetId: pl.source.assetId, source: await blob.text() });
    else setToast("Could not load this clip's audio JSON");
  };
  const [audioAi, setAudioAi] = useState(false);
  const openAudioAi = () => { setPicker(null); setSheet(false); setAudioAi(true); };
  const addAiAudio = async (clip: AudioClip) => {
    const asset = await audioClipAsset(storage.blobs, clip);
    if (engine.dispatch([cmd.importAsset(asset), cmd.addAssetsInSequence([asset.id], Math.round(player.time))], "Create audio with AI")) { setAudioAi(false); setToast("Audio added (Undo to remove)"); }
  };
  const createAudio = () => { setPicker(null); setSheet(false); setAudioEdit({ create: true }); };
  const saveAudio = async (clip: AudioClip) => {
    if (!audioEdit) return;
    if (audioEdit.create) {
      const asset = await audioClipAsset(storage.blobs, clip);
      if (engine.dispatch([cmd.importAsset(asset), cmd.addAssetsInSequence([asset.id], Math.round(player.time))], "Create audio")) { setAudioEdit(undefined); setToast("Audio added (Undo to remove)"); }
      return;
    }
    const asset = audioEdit.assetId ? project.assets[audioEdit.assetId] : undefined;
    const prev = asset?.versions.find((v) => v.id === asset.selectedVersionId) ?? asset?.versions[0];
    if (!asset || !prev) return;
    const id = newId("ver");
    const media = await storeAudioClip(storage.blobs, clip, asset.id, id);
    engine.dispatch(cmd.addAssetVersion(asset.id, { ...prev, id, createdAt: new Date().toISOString(), media, provenance: { source: "import", inputs: [] } }, audioEdit.placementId, { mode: clipVersion.versionSaveModeOf(project) }));
    setAudioEdit(undefined); setToast("Audio updated (Undo to revert)");
  };
  const isHtml = selected?.placement.clipType === "html";
  const gizmo = { onDelete: () => del(false), onEdit: () => (isText ? setTextOpen(true) : isHtml ? void openCode() : setInspOpen(true)), onDuplicate: () => duplicateAbove(), onDoubleTap: () => { if (isText) setInlineId(selected!.placement.id); }, onTap: tapAt, otherAt };
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
  const del = useCallback((rippleOverride?: boolean) => { if (selectedId) { const n = linkedGone([selectedId]); if (engine.dispatch(cmd.deleteClips([selectedId], rippleOverride ?? ripple))) delToast(n); setSelectedId(undefined); } }, [engine, selectedId, ripple]); // eslint-disable-line react-hooks/exhaustive-deps

  const shuttle = (k: "j" | "k" | "l") => {
    const cur = rate === 0 && player.isPlaying ? 1 : rate;
    const next = shuttleNext(cur, k);
    setRate(next);
    if (next === 1) player.play(); else player.pause();
  };
  // Shuttle at any rate other than 1× drives the playhead from a rAF loop (the player has no playback rate).
  useEffect(() => {
    if (rate === 0 || rate === 1) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const t = player.time + secondsToTicks(((now - last) / 1000) * rate); last = now;
      const end = player.duration();
      if (t <= 0 || t >= end) { player.seek(Math.min(Math.max(t, 0), end)); setRate(0); return; }
      player.seek(t); raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [rate, player]);
  useEffect(() => { if (!playing && rate === 1) setRate(0); }, [playing, rate]);
  /** Space / play button: stops a shuttle first; otherwise toggles normal playback. */
  const playPause = () => { if (rate !== 0 && rate !== 1) { setRate(0); return; } setRate(0); togglePlay(); };
  const zoomFit = () => { const w = (document.querySelector(".v2-dshell .v2-scroll") as HTMLElement | null)?.clientWidth ?? 800; setPps(clampPps((w - 80) / Math.max(1, duration / 120000))); };
  /** Alt+←/→: move the selected clip(s) by whole frames on their own track; one undo step. */
  const nudge = (dt: number) => {
    const moves = sel.map((id) => findPlacement(comp, id)).filter((f): f is NonNullable<typeof f> => !!f && !!f.track);
    if (!moves.length) return;
    const ok = engine.dispatch(moves.map((f) => cmd.movePlacement(f.placement.id, f.track.id, Math.max(0, f.placement.startTicks + dt))), "Nudge clip");
    if (!ok) setToast("Can't nudge — another clip is in the way");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exporting || projects || kbdOpen || ctx || pasteAsk || (e.target as HTMLElement)?.closest?.("input,textarea,select,[contenteditable=true],[role=menu],[role=dialog]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      // Storyboard open: the timeline is hidden, so only undo/redo pass through (never Delete/Space on hidden clips).
      if (board) { if (mod && (k === "z" || k === "y")) { e.preventDefault(); if (k === "y" || e.shiftKey) engine.redo(); else engine.undo(); } return; }
      // V2-107 desktop-only keys (mobile keeps its existing map).
      if (!mobile && !mod) {
        const fpsTicks = secondsToTicks(1 / project.settings.fps);
        if (e.key === "?") { e.preventDefault(); setKbdOpen(true); return; }
        if (k === "j" || k === "k" || k === "l") { e.preventDefault(); shuttle(k); return; }
        if (e.key === "=" || e.key === "+") { e.preventDefault(); setPps((p) => clampPps(p * 1.5)); return; }
        if (e.key === "-" || e.key === "_") { e.preventDefault(); setPps((p) => clampPps(p / 1.5)); return; }
        if (e.key === "Z" && e.shiftKey) { e.preventDefault(); zoomFit(); return; }
        if (e.key === "Home" || e.key === "End") { e.preventDefault(); setRate(0); player.pause(); seek(e.key === "Home" ? 0 : duration); return; }
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.altKey) { e.preventDefault(); nudge((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1) * fpsTicks); return; }
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.shiftKey) { e.preventDefault(); seek(player.time + (e.key === "ArrowLeft" ? -1 : 1) * secondsToTicks(document.fullscreenElement || fs ? 5 : 1)); return; }
        if (e.key === " ") { e.preventDefault(); playPause(); return; }
        if ((k === "q" || k === "w") && !e.altKey && !e.shiftKey) { e.preventDefault(); trimToPlayhead(k === "q" ? "left" : "right"); return; }
      }
      // V2-110: NLE keys — Cmd/Ctrl+B (CapCut) and Cmd/Ctrl+K (Premiere) split at the playhead, Cmd+X cuts, ↑/↓ jump edit points.
      if (mod && (k === "b" || k === "k") && !e.shiftKey && !e.altKey) { e.preventDefault(); splitAtPlayhead(); return; }
      if (mod && k === "x") { e.preventDefault(); cut(); return; }
      if (!mod && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const to = jumpEditPoint(editPoints(comp), player.time, e.key === "ArrowUp" ? -1 : 1, secondsToTicks(0.5 / project.settings.fps));
        if (to !== undefined) { setRate(0); player.pause(); seek(to); }
        return;
      }
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

  const onFiles = async (files: FileList | File[] | null): Promise<string[]> => {
    const ids: string[] = [];
    if (!files?.length) return ids;
    setBusy((b) => b + files.length);
    for (const f of Array.from(files)) {
      try {
        const asset = await importFile(await clipFileFrom(f), storage.blobs);
        if (asset) { if (engine.dispatch(cmd.importAsset(asset))) ids.push(asset.id); }
        else setToast(`${f.name}: unsupported file type`);
      } catch (e) {
        setToast(`${f.name}: ${e instanceof Error ? e.message : "import failed"}`);
      } finally { setBusy((b) => b - 1); }
    }
    return ids;
  };
  /**
   * P51: current main-track clip for insert / paste. See domain/chain.ts.
   * Selected main clip, else the clip under the playhead, else the nearest one that already ended.
   */
  const chainPoint = () => ({ selectedIds: sel, time: Math.round(player.time) });
  const canInsert = chain.insertAfterTicks(comp, chainPoint()) !== undefined;
  const openInsert = (afterId?: string) => {
    const found = afterId ? findPlacement(comp, afterId) : undefined;
    const onMain = found && ops.mainTrack(comp)?.id === found.track.id;
    const at = onMain ? found.placement.startTicks + found.placement.durationTicks : chain.insertAfterTicks(comp, chainPoint());
    if (at === undefined) { setToast("Select a main-track clip, or move the playhead onto one, to insert after it"); return; }
    insertAt.current = at;
    setPicker("insert");
  };
  /** Import picked files and insert them after the clip Insert was opened on. One undo step. */
  const addInserted = async ({ files, stickers: stickerPicks, assets = [] }: Picked) => {
    setPicker(null);
    const at = insertAt.current;
    const mainIds: string[] = assets.filter((id) => project.assets[id] && project.assets[id].kind !== "audio");
    const stickerIds: string[] = [];
    const imported: Asset[] = [];
    const stickerFiles = await Promise.all(stickerPicks.map((s) => stickerFile(s).catch(() => undefined)));
    const jobs = [...files.map((f) => ({ f, bucket: "main" as const })), ...stickerFiles.filter((f): f is File => !!f).map((f) => ({ f, bucket: "text" as const }))];
    setBusy((b) => b + jobs.length);
    for (const { f, bucket } of jobs) {
      try {
        const asset = await importFile(await clipFileFrom(f), storage.blobs);
        if (!asset) { setToast(`${f.name}: unsupported file type`); continue; }
        imported.push(asset);
        (bucket === "text" ? stickerIds : mainIds).push(asset.id);
      } catch (e) { setToast(`${f.name}: ${e instanceof Error ? e.message : "import failed"}`); }
      finally { setBusy((b) => b - 1); }
    }
    const ids = [...mainIds, ...stickerIds].map(() => newId("plc"));
    const steps = [...imported.map((a) => cmd.importAsset(a))];
    if (mainIds.length || stickerIds.length) steps.push(cmd.insertClipAfter({ at, main: mainIds, text: stickerIds }, ids));
    if (!steps.length) return;
    if (engine.dispatch(steps, "Insert clip after")) { setSel(ids.slice(0, mainIds.length || 1)); setToast("Inserted after the current clip"); }
    else setToast("Couldn't insert that clip");
  };
  /** Import picked files, re-add project media and stickers, then lay them out from the playhead in one undo step. */
  const addPicked = async ({ files, stickers, assets = [] }: Picked, mode: "main" | "overlay") => {
    setPicker(null);
    const at = Math.round(player.time);
    const all = files;
    const ids: string[] = assets.filter((id) => project.assets[id]), stickerIds: string[] = [];
    const stickerFiles = await Promise.all(stickers.map((s) => stickerFile(s).catch(() => undefined)));
    const jobs = [...all.map((f) => ({ f, out: ids })), ...stickerFiles.filter((f): f is File => !!f).map((f) => ({ f, out: stickerIds }))];
    setBusy((b) => b + jobs.length);
    for (const { f, out } of jobs) {
      try {
        const asset = await importFile(await clipFileFrom(f), storage.blobs);
        if (asset && engine.dispatch(cmd.importAsset(asset))) out.push(asset.id);
        else if (!asset) setToast(`${f.name}: unsupported file type`);
      } catch (e) { setToast(`${f.name}: ${e instanceof Error ? e.message : "import failed"}`); } finally { setBusy((b) => b - 1); }
    }
    const steps = [];
    if (ids.length) steps.push(cmd.addAssetsInSequence(ids, at, mode === "overlay" ? newId("trk") : undefined));
    if (stickerIds.length) steps.push(cmd.addAssetsInSequence(stickerIds, at, newId("trk"), "text"));
    if (steps.length) engine.dispatch(steps, mode === "overlay" ? "Add overlay" : "Add media");
  };
  /** P18: Add audio → From Video: decode the video's audio span to a WAV audio asset (or reference the video's sound when it can't be decoded) at the playhead. */
  const addFromVideo = async (fv: FromVideoPick) => {
    setPicker(null);
    const video = project.assets[fv.assetId];
    const version = video && (video.versions.find((x) => x.id === video.selectedVersionId) ?? video.versions[video.versions.length - 1]);
    if (!video || !version) return;
    const at = Math.round(player.time);
    const ids = { assetId: newId("ast"), versionId: newId("ver") };
    setBusy((b) => b + 1);
    let extracted: MediaRef | undefined;
    try {
      const blob = await loadAssetBlob(video.id);
      if (blob) {
        const { wav, seconds } = await extractAudioWav(blob, fv.inSec, fv.outSec);
        const blobKey = `${ids.assetId}/${ids.versionId}`;
        await storage.blobs.put(blobKey, wav);
        extracted = { blobKey, mime: "audio/wav", durationTicks: secondsToTicks(seconds) };
      }
    } catch { extracted = undefined; } finally { setBusy((b) => b - 1); }
    const made = fromVideoDomain.audioFromVideo(video, version, fv, extracted, ids);
    const mute = fv.muteOriginal ? Object.values(project.compositions[project.rootCompositionId].tracks).flatMap((t) => t.placements).filter((q) => q.clipType === "video" && q.source.assetId === video.id).map((q) => q.id) : [];
    const add = cmd.addAudioFromVideo(made.asset, fromVideoDomain.audioFromVideoPlacement(made, at), mute);
    // P19: an audio-only upload is removed once its sound is extracted; if decoding failed the audio references it, so it stays.
    const drop = fv.discardVideo && extracted;
    if (!engine.dispatch(drop ? [add, cmd.removeAsset(video.id)] : add, "Add audio from video")) return;
    setToast(drop ? `Added the audio of ${video.name}; the video was not kept` : extracted ? `Added the audio of ${video.name}` : fv.discardVideo ? `Kept ${video.name} in the library: its sound could not be decoded, so the audio plays from the video file` : `Added the sound of ${video.name} (plays from the video file)`);
  };
  /** P19: From Video → Upload video: the same import path as Add media (clipFileFrom + importFile), with read progress and an audio-track check. */
  const uploadFromVideo = async (f: File, _keep: boolean, progress: (x: number) => void): Promise<UploadedVideo> => {
    if (!/^video\//.test(f.type) && !/\.(mp4|m4v|mov|webm)$/i.test(f.name)) return { error: "Not a video file (MP4, MOV or WebM)" };
    setBusy((b) => b + 1);
    try {
      const read = await readFileWithProgress(f, (x) => progress(x * 0.9));
      const asset = await importFile(await clipFileFrom(read), storage.blobs);
      if (!asset || asset.kind !== "video") return { error: "Unsupported video file" };
      if (!engine.dispatch(cmd.importAsset(asset))) return { error: "Import failed" };
      progress(0.95);
      const audio = await probeVideoAudio(read).catch(() => undefined);
      progress(1);
      return { assetId: asset.id, audio };
    } catch (e) { return { error: e instanceof Error ? e.message : "Upload failed" }; } finally { setBusy((b) => b - 1); }
  };
  const videoOnTimeline = (assetId: string) => project.compositions[project.rootCompositionId].tracks.some((t) => t.placements.some((q) => q.clipType === "video" && q.source.assetId === assetId));
  const projectMedia = useMemo(() => projectMediaList(project, thumbs), [project, thumbs]);
  const addToTimeline = (a: Asset) => { engine.dispatch(cmd.addAssetToTimeline(a.id, mobile ? player.time : duration)); if (mobile) setSheet(false); };

  // One mount, at the app root (see the render below). On mobile the Media browser is wrapped in
  // [hidden] while its sheet is closed; a dialog or file input inside that wrapper cannot be shown.
  const fileInputs = (
    <>
      <input ref={fileRef} type="file" hidden multiple accept="video/*,image/*,audio/*,.html,.htm,text/html,.zip,application/zip" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      {subImport && <div className="v2-modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) setSubImport(false); }}>
        <SubtitleImport onPasteImport={onSubPaste} onChooseFile={() => srtRef.current?.click()} onClose={() => setSubImport(false)} />
      </div>}
      <input ref={srtRef} type="file" hidden accept=".srt,.vtt,text/plain" aria-label="Import SRT file" onChange={(e) => { void onSrt(e.target.files?.[0]); e.target.value = ""; }} />
    </>
  );
  const browser = (
    <section className="v2-browser" aria-label="Media">
      <div className="v2-panel-head">
        <strong>Media</strong>
        <button className="v2-btn primary" onClick={() => fileRef.current?.click()}><Ic g="＋" size={16} /> Import</button>
        <button className="v2-btn" title="Create a code clip: a canvas script with params, in the Code Editor" onClick={() => createCode()}><Ic g="</>" size={16} /> Code clip</button>
        {mobile && <SheetDone onClick={() => setSheet(false)} />}
      </div>
      {busy > 0 && <p className="v2-hint">Importing {busy}…</p>}
      {Object.values(project.assets).length === 0 && <p className="v2-hint">Import video, image, audio or HTML files, then {mobile ? "tap" : "drag or click"} + to add them to the timeline.</p>}
      <ul className="v2-assets">
        {Object.values(project.assets).filter((a) => codeRoleOf(a) === "clip").map((a) => (
          <li key={a.id} draggable onDragStart={(e) => e.dataTransfer.setData("application/x-dionysus-asset", a.id)} className={`v2-asset kind-${a.kind}`}>
            <AssetThumb asset={a} engineBlobs={storage.blobs} />
            <span className="v2-asset-name" title={a.name}>{a.name}</span>
            <small>{a.kind}{a.versions[0]?.media.durationTicks ? ` · ${formatTimecode(a.versions[0].media.durationTicks, project.settings.fps).slice(0, 5)}` : ""}</small>
            <button className="v2-btn" aria-label={`Add ${a.name} to timeline`} onClick={() => addToTimeline(a)}><Ic g="＋" /></button>
            <button className="v2-icon" aria-label={`Remove ${a.name}`} onClick={() => engine.dispatch(cmd.removeAsset(a.id))}><Ic g="✕" /></button>
          </li>
        ))}
      </ul>
    </section>
  );




  const clipActions = [
    { icon: "⧉", label: "Duplicate", title: "Duplicate onto a new track above, same time (⌘/Ctrl+D duplicates after on the same track)", run: duplicateAbove },
    { icon: "⎘", label: "Copy", title: "Copy (⌘/Ctrl+C) — ⌘/Ctrl+V asks where to paste", run: copy },
  ];
  // P9-LINK: "Link to main" for non-main clips (overlay, text, effect, audio).
  const selIsMain = !!selected && ops.mainTrack(comp)?.id === selected.track.id;
  const selLinked = selected && !selIsMain ? selected.placement.link : undefined;
  const linkActions = selected && !selIsMain ? [selLinked
    ? { icon: "🔗", label: "Unlink", title: "Linked to a main clip: it moves, trims and deletes with it. Tap to unlink", run: () => { engine.dispatch(cmd.setClipLink(selected.placement.id, false)); setToast("Unlinked from the main clip"); } }
    : { icon: "🔗", label: "Link to main", title: "Link to the main clip under this clip's start: it then moves, trims and deletes with it", run: () => setToast(engine.dispatch(cmd.setClipLink(selected.placement.id, true)) ? "Linked to the main clip" : "No main clip under this clip's start to link to") }] : [];
  // P20: overlay video / image / HTML clips can move onto the main track.
  const promoteActions = selected && !selIsMain && promote.canPromote(comp, selected.placement.id) ? [{ icon: "to-main", label: "Promote to main", title: "Promote to main track: replace what the main track shows here, or insert it and move later clips", run: () => setPromoteFor(selected.placement.id) }] : [];
  const pasteAction = { icon: "📋", label: "Paste", title: hasClip ? "Paste: after the current clip, at the end of the current chain, or at the playhead on a chosen track (⌘/Ctrl+V)" : "Copy a clip first", run: paste };

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
  /** V2-SB-133: the selected video clip can slip its in point. */
  const inPointable = !!selected && canSetInPoint(project, selected.placement);
  const rangeable = !!selected && sel.length <= 1 && canAdjustRange(selected.placement);
  const replaceable = !!selected && sel.length <= 1 && canReplaceAsset(selected.placement);
  const versionable = !!selected && sel.length <= 1 && !!project.assets[selected.placement.source.assetId]?.versions.length;
  useEffect(() => { setInOpen(false); setBarSheet(undefined); }, [selectedId]);
  const speedSelect = sp && sp.clipType !== "image" && sp.clipType !== "text" && !sp.freeze ? (
    <label className="v2-tool" title="Playback speed — changes the clip's length"><b aria-hidden><Ic g="⏩" /></b>
      <select aria-label="Speed" value={sp.speed ?? 1} onChange={(e) => engine.dispatch(cmd.setSpeed(sp.id, Number(e.target.value)))}>
        {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
    </label>
  ) : null;

  /** The selected clip starts a cut, so it can have a transition in. */
  const spCut = sp ? cutOf(comp, sp.id) : undefined;
  const transitionTools = sp && spCut ? (
    <TransitionPicker key={sp.id} engine={engine} comp={comp} placementId={sp.id} thumbs={thumbs} onPreview={previewCut} onToast={setToast} onNewCode={() => createCodeRole("transition")} />
  ) : null;



  const firstVideoTrack = ops.mainTrack(comp);
  const firstClip = firstVideoTrack?.placements[0];
  const preferredFsOrient = preferredPreviewOrient(project.settings.width, project.settings.height);
  const fullscreen = () => {
    const el = canvasRef.current?.parentElement;
    const prefer = preferredFsOrient;
    const lockIfWeCan = () => {
      setFsOrient(prefer);
      if (canLockOrientation()) void (screen.orientation as ScreenOrientation & { lock: (o: PreviewOrient) => Promise<void> }).lock(prefer).catch(() => undefined);
    };
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      try { screen.orientation.unlock(); } catch { /* unsupported */ }
      return;
    }
    if (fs) {
      setFs(false);
      try { screen.orientation.unlock(); } catch { /* unsupported */ }
      return;
    }
    if (el?.requestFullscreen) {
      void el.requestFullscreen().then(() => { setDocFs(true); lockIfWeCan(); }).catch(() => { setFs(true); lockIfWeCan(); });
    } else {
      setFs(true);
      lockIfWeCan();
    }
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
  // P27: Overlay and Audio modes follow the playhead too: the clip under it on the selected clip's track (else the
  // group's top-most track) becomes the selection; in a gap the selection clears.
  useEffect(() => {
    if (!mobile || multiMode) return;
    if (menu === "edit") { const p = mainAt(time); if (p && p.id !== selectedId) setSel([p.id]); return; }
    if (menu !== "overlay" && menu !== "audio") return;
    const p = ops.clipAtInGroup(comp, menu, time, selected?.track.id);
    if (p?.id !== selectedId && (p || (selected && ops.groupOf(comp, selected.track) === menu))) setSel(p ? [p.id] : []);
  }, [time, menu]); // eslint-disable-line react-hooks/exhaustive-deps
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
    seek(p.startTicks);
    onTransition(p.id);
  };
  const tool = (icon: string, label: string, onClick: () => void, key = label, title?: string) => (
    <button key={key} className={`v2-tool${label.length > 9 ? " v2-tool-wide" : ""}`} title={title} onClick={onClick}><b aria-hidden><Ic g={icon} /></b><span>{label}</span></button>
  );
  const pair = sp ? clipRange.matchPair(project, comp, sp.id) : undefined;
  /** P32: one clip-bar action. Labels are short and never change with state; state shows as `active` (background only). */
  type BarAct = { key: string; icon: string; label: string; title?: string; run: () => void; active?: boolean; danger?: boolean };
  const barTool = (a: BarAct) => (
    <button key={a.key} className={`v2-tool ${a.active ? "is-active" : ""} ${a.danger ? "is-danger" : ""}`} data-tool={a.key} title={a.title ?? a.label} aria-label={a.title ? undefined : a.label}
      aria-pressed={a.active === undefined ? undefined : a.active} onClick={a.run}><b aria-hidden><Ic g={a.icon} /></b><span>{a.label}</span></button>
  );
  const clipBar = ((): BarAct[][] => {
    if (!selected) return [];
    const pl = selected.placement;
    const A = (key: string, icon: string, label: string, run: () => void, title?: string, active?: boolean): BarAct => ({ key, icon, label, run, title, active });
    const sound = hasSound(pl) || pl.clipType === "audio";
    const edit = [
      A("split", "✂", "Split", split, "Split at the playhead (S)"),
      A("trim", "trim-start", "Trim", () => setBarSheet("trim"), "Trim start or end to the playhead (Q / W)"),
      { ...A("delete", "🗑", "Delete", () => del(), ripple ? "Delete and close the gap (ripple is on)" : "Delete and leave a gap (ripple is off)"), danger: true },
      A("ripple", "⇤", "Ripple", () => setRipple(!ripple), "Ripple: delete and trim move later clips to close gaps (R)", ripple),
    ];
    const adjust = A("adjust", "⤧", "Adjust", () => setInspOpen(true), "Transform, keyframes and fades");
    const audio = sound ? A("audio", "🔊", "Audio", () => setBarSheet("audio"), "Volume, mute, volume curve, audio FX and position") : undefined;
    const speed = speedSelect ? A("speed", "⏩", "Speed", () => setMenu("speed"), `Playback speed (now ${sp!.speed ?? 1}×)`) : undefined;
    const link = linkActions[0] ? A("link", selLinked ? "unlink" : "link", "Link", linkActions[0].run, linkActions[0].title, !!selLinked) : undefined;
    const toMain = promoteActions[0] ? A("promote", "to-main", "To main", promoteActions[0].run, promoteActions[0].title) : undefined;
    const colour = pl.blank ? A("colour", "palette", "Colour", () => setBarSheet("colour"), "Change this blank clip's colour") : undefined;
    const primaryAll = (pl.blank ? [colour, adjust, link, toMain] : isEffect ? [A("fx", "effect", "Effect", () => setFxOpen(true), "Change the preset or its settings"), link, adjust]
      : isText ? [A("style", "T", "Style", () => setTextOpen(true), "Templates, font, style, effects, animation"), A("anim", "anim", "Animate", () => setAnimOpen(true), "In, out and loop animations"), A("subs", "≡", "Subtitles", () => openSubs(selected.track.id, pl.id), "Open this layer's subtitle list at this clip")]
      : isHtml ? [A("params", "settings", "Params", () => setParamsOpen(true), "This clip's values: text, colours and other params the HTML clip exposes"), A("code", "</>", "Code", () => void openCode(), "Edit HTML, CSS and JS with live preview"), adjust]
      : pl.clipType === "audio" ? [audio, speed, selAudioSpec ? A("edit-audio", "♫", "Edit", () => void openAudio(), "Open this clip in the Audio editor; saving makes a new version") : adjust]
      : selIsMain ? [adjust, audio, speed]
      : [adjust, link, toMain]).filter((a): a is BarAct => !!a);
    // P33: every tool on one scrollable row, in a fixed group order for every clip type; thin dividers between groups.
    const seen = new Set<string>();
    const uniq = (xs: (BarAct | undefined | false | null)[]) => xs.filter((a): a is BarAct => !!a && !seen.has(a.key) && !!seen.add(a.key));
    return [
      uniq(edit),
      uniq(primaryAll),
      uniq([speed,
        spCut && A("transition", "⧓", "Transition", () => setTransFor(sp!.id), "Pick the transition into this clip"),
        pair && A("match", "match", "Match", () => setMatchOpen(true), "Find the most similar frames across this cut and join there"),
        ...timeActions.map((a, i) => A(i ? "reverse" : "freeze", a.icon, i ? "Reverse" : "Freeze", a.run, a.title, i ? !!sp?.reverse : undefined))]),
      uniq([
        selLink && A("storyboard", "board", "Storyboard", () => openStory(selLink.target), `Open ${selLink.label} in the storyboard: pick versions there`),
        pl.placeholder && A("fill", "⇄", "Fill", () => setRangeFor({ id: pl.id, picker: true }), "Fill this placeholder: pick a video, image or code clip, or upload one. The upload is applied in the same step"),
        rangeable && A("range", "⇔", "Range", () => setRangeFor({ id: pl.id }), "Choose which part of the source this clip plays (slip); its place and length stay"),
        replaceable && A("replace", "⇄", "Replace", () => setRangeFor({ id: pl.id, picker: true }), "Swap this clip's media for another of the same kind, or add a new shot version. Upload a file in the picker"),
        versionable && A("version", "pin", "Version", () => setVerOpen(true), "Pick which take this clip uses, or follow the storyboard"),
        inPointable && A("in-point", "⇤", "In point", () => setInOpen(true), "Where the clip starts in its video (slip)"),
        tracking.canTrack(pl) && A("track", "track", "Track", () => { player.pause(); setTrackOpen({}); }, "Add a tracker to this clip so text, overlays or code can follow it"),
        masking.canMask(pl) && A("mask", "mask", "Mask", () => { player.pause(); setMaskOpen(true); }, "Hide part of this picture with a shape or a freeform path"),
        canChromaKey(pl) && A("chroma", "chroma", "Chroma", () => setCkOpen(true), "Remove a green or blue screen colour"),
        isText && adjust,
        !!selAudioSpec && pl.clipType !== "audio" && A("edit-audio", "♫", "Edit audio", () => void openAudio(), "Open this clip in the Audio editor")]),
      uniq([audio,
        ...linkedAudioActions.slice(0, 2).map((a, i) => A(i ? "dup-audio" : "extract", a.icon, i ? "Copy audio" : "Extract", a.run, a.title)),
        A("mute-track", selected.track.muted ? "🔇" : "🔊", "Mute track", () => engine.dispatch(cmd.toggleTrackMute(selected.track.id)), "Mute or unmute this whole track", !!selected.track.muted)]),
      uniq([link, toMain,
        A("duplicate", "⧉", "Duplicate", duplicateAbove, clipActions[0].title), A("copy", "⎘", "Copy", copy, clipActions[1].title),
        hasClip && A("paste", "📋", "Paste", paste, pasteAction.title),
        canInsert && A("insert-after", "＋", "Insert", () => openInsert(), "Insert a new clip after the current clip. Later clips move later; linked layers stay with their clips"),
        A("select", "☑", "Select", () => setMultiMode(true), "Select several clips")]),
      [A("snap", "🧲", "Snap", () => setSnapOn(!snapOn), "Smart snapping and alignment guides", snapOn)],
    ].filter((g) => g.length);
  })();
  const mobileTools: Record<Menu, JSX.Element[]> = {
    root: [
      tool("✂", "Edit", () => enterMode("edit"), "edit", "Edit the main-track clip under the playhead"),
      tool("♫", "Audio", () => enterMode("audio"), "audio", "Audio layers: add music and sounds"),
      tool("T", "Text", () => enterMode("text"), "text", "Text, stickers and subtitles"),
      tool("effect", "Effect", () => enterMode("effect"), "effect", "Effect layers (blur, zoom, B&W…) and transitions"),
      tool("overlay", "Overlay", () => enterMode("overlay"), "overlay", "Photos and videos on layers above the main track"),
      ...(project.storyboard ? [tool("board", "Sync", () => setSyncOpen(true), "sync-story", "Sync to Storyboard: write timeline edits back to the storyboard (review first)")] : []),
      tool("settings", "Project", () => setProjOpen(true), "project-settings", "Project settings: size, frame rate, background, auto-link"),
    ],
    edit: !selected ? [<span key="h" className="v2-tool-hint">Move the playhead over a main-track clip to edit it</span>, ...(canInsert ? [tool("＋", "Insert", () => openInsert(), "insert-after", "Insert a new clip after the current clip. Later clips move later; linked layers stay with their clips")] : [])] : [
      // P33: Edit | type primaries | timing | source | audio | arrange | timeline — fixed cells, horizontally scrollable.
      ...clipBar.flatMap((g, i) => [...(i ? [<span key={`div-${i}`} className="v2-tool-div" aria-hidden />] : []), <span key={`g-${i}`} className="v2-tool-group" role="group">{g.map(barTool)}</span>]),
    ],
    multi: [
      <span key="n" className="v2-sel-count" role="status">{sel.length} selected · tap clips</span>,
      tool("🗑", "Delete", () => delSel(), "del"),
      ...clipActions.map((a) => tool(a.icon, a.label, a.run, a.label, a.title)),
    ],
    audio: [tool("＋", "Add", () => setPicker("audio"), "add-audio", "Add music or sound from this project or your device, or take the sound of a video"), tool("♫", "Create", createAudio, "create-audio", "Make music or sound effects in the Audio editor")],
    speed: sp ? SPEEDS.map((s) => (
      <button key={s} className={`v2-tool ${(sp.speed ?? 1) === s ? "is-active" : ""}`} aria-pressed={(sp.speed ?? 1) === s} onClick={() => engine.dispatch(cmd.setSpeed(sp.id, s))}><b>{s}×</b><span>{s === 1 ? "Normal" : s < 1 ? "Slow" : "Fast"}</span></button>
    )) : [],
    text: [
      tool("T", "Add", addText, "add-text", "Add a text clip at the playhead"),
      tool("sticker", "Stickers", () => setPicker("stickers"), "stickers", "Add stickers to the Text & Stickers group"),
      ...textTools.slice(1).map((a) => tool(a.icon, a.label, a.run, a.label, a.title)),
      tool("template", "Template", () => { addText(); setTextOpen(true); }, "templates", "Add a text clip and pick a template"),
    ],
    effect: [
      tool("＋", "Add", () => setFxOpen(true), "add-effect", "Add an effect clip at the playhead (changes only the main track)"),
      tool("⧓", "Transition", addTransitionNearPlayhead, "transition", "Pick a transition for the cut nearest the playhead"),
    ],
    overlay: [tool("＋", "Add", () => setPicker("overlay"), "add-overlay", "Add photos, videos or clips on a new layer above, at the playhead")],
  };

  // ───────────── V2-106 desktop shell ─────────────
  const DEFAULT_ACCEPT = "video/*,image/*,audio/*,.html,.htm,text/html,.zip,application/zip";
  const importDialog = (accept?: string) => { const f = fileRef.current; if (!f) return; f.accept = accept ?? DEFAULT_ACCEPT; f.click(); };
  /** Import files, then place them at `at` (one undo step for the placement). */
  const importAt = async (files: File[], at: number, trackId?: string) => {
    const ids = await onFiles(files);
    if (!ids.length) return;
    if (ids.length === 1 && trackId) engine.dispatch(cmd.addAssetToTimeline(ids[0], at, trackId));
    else engine.dispatch(cmd.addAssetsInSequence(ids, at));
  };
  const addTextAt = (at: number, template?: string) => {
    const id = newId("plc");
    const data = template ? textDomain.textStyleData(template) : undefined;
    const pos = template ? textDomain.textStylePosition(template) : undefined;
    if (engine.dispatch(pos ? [cmd.addTextClip(Math.round(at), data ?? {}, id), cmd.setTransform(id, pos)] : cmd.addTextClip(Math.round(at), data ?? {}, id), "Add text")) { setSel([id]); setSubId(undefined); }
  };
  const addStickerAt = async (st: Sticker, at: number) => {
    try {
      const asset = await importFile(await stickerFile(st), storage.blobs);
      if (asset) engine.dispatch([cmd.importAsset(asset), cmd.addAssetsInSequence([asset.id], Math.round(at), newId("trk"), "text")], "Add sticker");
    } catch { setToast("Could not add that sticker"); }
  };
  const addEffectAt = (preset: string, at: number) => { const id = newId("plc"); if (engine.dispatch(cmd.addEffectClip(Math.round(at), preset, undefined, id))) setSel([id]); };
  const onDropData = (dt: DataTransfer, at: number, trackId?: string) => {
    const it = readDragItem(dt);
    if (it?.kind === "text") addTextAt(at, it.template);
    else if (it?.kind === "effect") addEffectAt(it.id, at);
    else if (it?.kind === "sticker") { const st = stickers().find((x) => x.id === it.id); if (st) void addStickerAt(st, at); }
    else if (dt.files?.length) void importAt(Array.from(dt.files), at, trackId);
  };
  const inserting = picker === "insert";
  const pickerEl = picker ? <MediaPicker media={projectMedia} title={inserting ? "Insert after current clip" : picker === "overlay" ? "Add overlay" : picker === "audio" || picker === "fromVideo" ? "Add audio" : picker === "stickers" ? "Add stickers" : "Add media"} lead={inserting ? "The new clip goes just after the current clip. Later clips move later, and linked layers and subtitles stay with the clips they belong to. Upload a file and it is selected here — then Insert." : undefined} confirmLabel={inserting ? "Insert" : "Add"} only={picker === "audio" || picker === "fromVideo" ? "audio" : undefined} initialTab={picker === "stickers" ? "stickers" : picker === "fromVideo" ? "fromVideo" : undefined} onClose={() => setPicker(null)} onAdd={(p) => void (inserting ? addInserted(p) : addPicked(p, picker === "overlay" || picker === "stickers" ? "overlay" : "main"))} onCreateCode={picker === "audio" || picker === "fromVideo" ? undefined : () => createCode(inserting ? "insert" : picker === "overlay" ? "overlay" : "main")} onCreateAudio={picker === "audio" || picker === "fromVideo" ? createAudio : undefined} onCreateAudioAi={picker === "audio" || picker === "fromVideo" ? openAudioAi : undefined} onAddFromVideo={picker === "audio" || picker === "fromVideo" ? (fv) => void addFromVideo(fv) : undefined} onTimeline={videoOnTimeline} onUploadVideo={picker === "audio" || picker === "fromVideo" ? uploadFromVideo : undefined} onDiscardVideo={(id) => engine.dispatch(cmd.removeAsset(id))} onAddBlank={picker === "audio" || picker === "fromVideo" || picker === "stickers" ? undefined : inserting ? insertBlank : (c) => addBlank(c, picker === "overlay" ? "overlay" : "main")} loadMedia={loadAssetBlob} /> : null;
  const assetBrowser = (
    <AssetBrowser project={project} thumbs={thumbs} busy={busy} tab={btab} onTab={setBtab}
      onImport={importDialog} onFiles={(fs) => void onFiles(fs)} onAddAsset={addToTimeline} onRemoveAsset={(a) => engine.dispatch(cmd.removeAsset(a.id))}
      onAddBlank={addBlank} onAddText={(tp) => addTextAt(player.time, tp)} onImportSrt={openSubImport}
      onAddSticker={(st) => void addStickerAt(st, player.time)} onAddEffect={(id) => addEffectAt(id, player.time)}
      onAddTransition={addTransitionNearPlayhead} onCreateCode={() => createCode()} onCreateAudio={createAudio} onCreateAudioAi={openAudioAi} onAudioFromVideo={() => setPicker("fromVideo")} />
  );
  useEffect(() => { setItab(preferTab.current); preferTab.current = undefined; }, [selectedId]);
  const fpsNow = project.settings.fps;
  const clipName = (p: NonNullable<typeof selected>["placement"]) => p.clipType === "text" ? (p.text?.text?.split("\n")[0] || "Text") : p.clipType === "effect" ? `Effect · ${p.effect?.preset ?? ""}` : project.assets[p.source.assetId]?.name ?? p.clipType;
  const KIND_ICON: Record<string, string> = { video: "▭", image: "image", audio: "♫", text: "T", html: "</>", effect: "effect" };
  const volumeRow = (pl: NonNullable<typeof selected>["placement"]) => (
    <SliderField className="v2-insp-sf" label="Volume" min={0} max={1} step={0.05} value={pl.volume ?? 1} unit="%" scale={100}
      onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()} onChange={(v) => engine.dispatch(cmd.setPlacementVolume(pl.id, v))} />
  );
  const actionList = (list: { icon: string; label: string; title: string; run: () => void }[]) => (
    <div className="v2-insp-actions">{list.map((a) => <button key={a.label} className="v2-btn" title={a.title} onClick={a.run}><Ic g={a.icon} size={16} /> {a.label}</button>)}</div>
  );
  const inspectorTabs = (): { icon: string; title: string; subtitle?: string; tabs: InspectorTab[]; actions?: JSX.Element; onDone?: () => void } => {
    if (sel.length > 1) return { icon: "☑", title: `${sel.length} clips`, onDone: () => selectClip(undefined), tabs: [{ id: "multi", label: "Selection", render: () => <div className="v2-psettings">
      <p className="v2-sel-count" role="status">{sel.length} selected</p>
      {actionList([{ icon: "🗑", label: ripple ? "Ripple delete all" : "Delete all", title: "Delete every selected clip (Del)", run: () => delSel() }, ...clipActions.map((a) => ({ ...a, label: `${a.label} all` }))])}
      <p className="v2-abnote">Shift-click clips on the timeline to add or remove them from the selection.</p></div> }] };
    if (subsTrack && !selected) return { icon: "≡", title: "Edit subtitles", subtitle: subsTrack.name, onDone: () => setSubsEdit(undefined), tabs: [{ id: "subs", label: "Subtitles", render: () => <SubtitleList engine={engine} track={subsTrack} time={time} playing={playing} onSeek={seek} onTogglePlay={togglePlay} desktop name={project.name} focusCue={subsCue} onImport={openSubImport} /> }] };
    if (layerTrack && !selected) return { icon: "layers", title: "Edit all", subtitle: layerTrack.name, onDone: () => setLayerEdit(undefined), tabs: [{ id: "layer", label: "Layer style", render: () => <TextPanel key={layerTrack.id} engine={engine} layer={layerTrack} initialTab="Style" /> }] };
    if (cue && !selected) return { icon: "≡", title: "Subtitle", onDone: () => setSubId(undefined), tabs: [{ id: "cue", label: "Subtitle", render: () => <SubtitleEditor engine={engine} sub={cue} onDelete={delCue} /> }] };
    if (!selected) return { icon: "settings", title: "Project", subtitle: `${project.settings.width}×${project.settings.height} · ${fpsNow} fps`, tabs: [{ id: "project", label: "Project", render: () => <ProjectSettings engine={engine} project={project} onSeries={() => setSeriesLib(true)} onCleanup={() => setCleanOpen(true)} extra={textLayers.length ? <section aria-label="Subtitles"><h4>Subtitles</h4>{actionList([{ icon: "≡", label: "Subtitles", title: "Edit every subtitle in a list: text, timing, split, merge, find & replace", run: editSubtitles }, { icon: "srt-out", label: "Export SRT", title: "Download subtitles as an .srt file", run: exportSrt }])}</section> : undefined} /> }] };
    const pl = selected.placement, kind = pl.clipType;
    const rel = clipTimeAt(pl, time);
    const sub = `${formatTimecode(pl.startTicks, fpsNow).slice(0, 8)} · ${(pl.durationTicks / 120000).toFixed(1)}s${rel ? ` · ${clipTimeText(rel)}` : ""}`;
    const base = { icon: KIND_ICON[kind] ?? "▭", title: clipName(pl), subtitle: sub, onDone: () => setSelectedId(undefined) };
    const promoteSec = promoteActions.length ? <section className="v2-psettings v2-promote-sec" aria-label="Main track"><h4>Main track</h4><button className="v2-btn v2-link-btn" data-testid="promote-panel" title={promoteActions[0].title} onClick={promoteActions[0].run}><Ic g="to-main" size={16} /> Promote to main track</button></section> : null;
    const linkSec = linkActions.length ? <><section className="v2-psettings v2-link-sec" aria-label="Link to main"><h4>Link to main</h4>
      <button className={`v2-btn v2-link-btn ${selLinked ? "is-active" : ""}`} role="switch" aria-checked={!!selLinked} title={linkActions[0].title} onClick={linkActions[0].run}><Ic g={selLinked ? "unlink" : "link"} size={16} /> {selLinked ? `Linked to ${clipName(findPlacement(comp, selLinked.parent)?.placement ?? pl)}` : "Link to main"}</button>
    </section>{promoteSec}</> : null;
    const rangeSec = pl.placeholder ? <section className="v2-psettings v2-range-sec" aria-label="Placeholder"><h4>Not generated</h4>
      <p className="v2-abnote">{pl.placeholder.label} has no clip yet. Generate it in the storyboard and Update, or fill it now.</p>
      <div className="v2-insp-actions"><button className="v2-btn" data-testid="replace-asset-btn" title="Fill this placeholder with a video, image or code clip, or upload one. The upload is applied in the same step" onClick={() => setRangeFor({ id: pl.id, picker: true })}><Ic g="⇄" size={16} /> Fill placeholder</button></div></section>
      : canAdjustRange(pl) || canReplaceAsset(pl) ? <section className="v2-psettings v2-range-sec" aria-label="Source range"><h4>Source range</h4>
      <div className="v2-insp-actions">{canAdjustRange(pl) && <button className="v2-btn" data-testid="adjust-range-btn" title="Choose which part of the source this clip plays (slip); its place and length stay (Alt+drag on the clip)" onClick={() => setRangeFor({ id: pl.id })}><Ic g="⇔" size={16} /> Adjust range</button>}
      {canReplaceAsset(pl) && <button className="v2-btn" data-testid="replace-asset-btn" title="Swap this clip's media for another of the same kind, or add a new shot version. The picker can upload a file" onClick={() => setRangeFor({ id: pl.id, picker: true })}><Ic g="⇄" size={16} /> Replace asset</button>}</div></section> : null;
    const versionSec = project.assets[pl.source.assetId]?.versions.length ? <section className="v2-psettings v2-cver-sec" aria-label="Clip version"><h4>Version</h4>
      <p className="v2-abnote">This clip can stay on its own take, or follow the storyboard&apos;s current version.</p>
      <ClipVersionPicker engine={engine} project={project} clipId={pl.id} onToast={setToast} /></section> : null;
    const transform: InspectorTab = { id: "basic", label: "Basic", icon: "⤧", render: () => pl.placeholder ? rangeSec : kind === "video" && !pl.freeze && !linkSec ? <>{rangeSec}{versionSec}
      <section className="v2-psettings v2-frames-sec" aria-label="In and out frames"><h4>In / out frames</h4><ClipFrames engine={engine} project={project} placement={pl} /></section>
      <TransformInspector engine={engine} placement={pl} time={time} />
    </> : <>{rangeSec}{versionSec}{linkSec}{kind === "video" && !pl.freeze && <section className="v2-psettings v2-frames-sec" aria-label="In and out frames"><h4>In / out frames</h4><ClipFrames engine={engine} project={project} placement={pl} /></section>}<TransformInspector engine={engine} placement={pl} time={time} /></> };
    const speedTab: InspectorTab = { id: "speed", label: "Speed", icon: "⏩", render: () => <div className="v2-psettings">
      <section aria-label="Speed"><h4>Speed</h4>
        <div className="v2-seg" role="radiogroup" aria-label="Speed">{SPEEDS.map((x) => <button key={x} role="radio" aria-checked={(pl.speed ?? 1) === x} className={`v2-seg-btn ${(pl.speed ?? 1) === x ? "is-active" : ""}`} title={x === 1 ? "Normal speed" : `${x}× — changes the clip's length`} onClick={() => engine.dispatch(cmd.setSpeed(pl.id, x))}>{x}×</button>)}</div>
      </section>
      {inPointable && <section aria-label="In point"><h4>In point</h4><InPointControl engine={engine} project={project} placement={pl} /></section>}
      {timeActions.length > 0 && <section aria-label="Time"><h4>Time</h4>{actionList(timeActions)}</section>}
    </div> };
    const audioTab: InspectorTab = { id: "audio", label: "Audio", icon: "🔊", render: () => <div className="v2-psettings">
      {linkSec}
      {selAudioSpec && <section aria-label="Audio clip"><h4>Audio clip</h4><button className="v2-btn v2-ae-editbtn" title="Open in the Audio editor; saving makes a new version" onClick={() => void openAudio()}><Ic g="♫" size={16} /> Edit audio</button></section>}
      <section aria-label="Volume"><h4>Volume</h4>{volumeRow(pl)}</section>
      <VolumeCurve engine={engine} placement={pl} time={time} peaks={peaks[mediaKey(pl.source.assetId, pl.source.versionId)]} />
      <AudioFxPanel engine={engine} placement={pl} />
      <SpatialPad engine={engine} project={project} placement={pl} track={selected.track} time={time} />
      {kind === "audio" && <TransformInspector engine={engine} placement={pl} time={time} />}
      {linkedAudioActions.length > 0 && <section aria-label="Clip audio"><h4>Clip audio</h4>{actionList(linkedAudioActions)}</section>}
      <section aria-label="Track"><h4>Track</h4>{actionList([{ icon: selected.track.muted ? "🔈" : "🔇", label: selected.track.muted ? "Unmute track" : "Mute track", title: "Silence the whole track", run: () => engine.dispatch(cmd.toggleTrackMute(selected.track.id)) }])}</section>
    </div> };
    const chromaTab: InspectorTab = { id: "chroma", label: "Chroma key", icon: "chroma", render: () => <ChromaKeyPanel engine={engine} placement={pl} picking={eyedrop === pl.id} onPick={(on) => setEyedrop(on ? pl.id : undefined)} /> };
    const transTab: InspectorTab | undefined = transitionTools ? { id: "transition", label: "Transition", icon: "⧓", render: () => transitionTools } : undefined;
    if (kind === "text") return { ...base, actions: <>
      {selTrack?.layerStyle && <button className="v2-btn v2-btn-sm" title={`Style every clip on ${selTrack.name}`} onClick={() => editLayer(selTrack.id)}><Ic g="layers" size={14} /> Edit all</button>}
      <button className="v2-btn v2-btn-sm" title="Open this layer's subtitle list at this clip" onClick={() => openSubs(selected.track.id, pl.id)}><Ic g="≡" size={14} /> Subtitles</button>
    </>, tabs: [{ id: "text", label: "Text", icon: "T", render: () => <>{linkSec}<TextPanel engine={engine} placement={effSel} track={selTrack} onAnimPicked={() => setAnimLoop(true)} initialTab="Font" time={time} playing={playing} onSeek={seek} onTogglePlay={togglePlay} /></> }, { ...transform, label: "Transform" }] };
    if (kind === "effect") return { ...base, tabs: [{ id: "effect", label: "Effect", icon: "effect", render: () => <>{linkSec}<EffectPicker engine={engine} at={time} placement={pl} onNewCode={() => createCodeRole("effect")} onEditCode={(id) => void editCodeAsset(id)} /></> }] };
    if (kind === "audio") return { ...base, tabs: [audioTab, ...(speedSelect ? [speedTab] : [])] };
    if (kind === "html") return { ...base, actions: <button className="v2-btn v2-btn-sm" title="Edit HTML, CSS and JS with live preview" onClick={() => void openCode()}><Ic g="</>" size={14} /> Edit code</button>, tabs: [{ id: "params", label: "Params", icon: "settings", render: () => <HtmlParamsPanel engine={engine} project={project} placement={pl} blobs={storage.blobs} onEditCode={() => void openCode()} /> }, transform, chromaTab, ...(transTab ? [transTab] : [])] };
    if (pl.blank) return { ...base, tabs: [{ id: "colour", label: "Colour", icon: "palette", render: () => <div className="v2-psettings"><section aria-label="Colour"><h4>Colour</h4><BlankColorPicker value={pl.blank!.color} onChange={(c) => engine.dispatch(cmd.setBlankColor(pl.id, c))} /></section></div> }, transform, ...(transTab ? [transTab] : [])] };
    if (kind === "image") return { ...base, tabs: [transform, chromaTab, ...(transTab ? [transTab] : [])] };
    return { ...base, tabs: [transform, ...(speedSelect || timeActions.length || inPointable ? [speedTab] : []), audioTab, chromaTab, ...(transTab ? [transTab] : [])] };
  };
  const insp = !mobile ? inspectorTabs() : undefined;
  const iconBtn = (icon: string, label: string, run: () => void, opts: { title?: string; disabled?: boolean; pressed?: boolean; key?: string } = {}) => (
    <button key={opts.key ?? label} className={`v2-dtool ${opts.pressed ? "is-active" : ""}`} aria-label={label} aria-pressed={opts.pressed} title={opts.title ?? label} disabled={opts.disabled} onClick={run}><Ic g={icon} size={18} /><span className="v2-sr">{label}</span></button>
  );
  const anySel = sel.length > 0;
  const desktopToolbar = (
    <div className="v2-dtoolbar" role="toolbar" aria-label="Timeline tools">
      {iconBtn("✂", "Split", split, { title: `Split at the playhead (S · ${MOD}B · ${MOD}K)`, disabled: !selectedId })}
      {iconBtn("🗑", ripple ? "Ripple delete" : "Delete", () => delSel(), { title: ripple ? "Delete and close the gap (Del)" : "Delete (Del) · Shift+Del ripple delete", disabled: !anySel, key: "del" })}
      {iconBtn("⧉", "Duplicate", duplicateAbove, { title: "Duplicate (⌘/Ctrl+D)", disabled: !anySel })}
      {iconBtn("⎘", "Copy", copy, { title: "Copy (⌘/Ctrl+C)", disabled: !anySel })}
      {iconBtn("📋", "Paste", paste, { title: hasClip ? "Paste: after the current clip, at the end of the current chain, or at the playhead on a chosen track (⌘/Ctrl+V)" : "Copy a clip first", disabled: !hasClip })}
      <button className="v2-dtool v2-dtool-text" data-testid="insert-after" aria-label="Insert new clip after current clip" title="Insert a new clip after the current clip (selected main clip, else the clip under the playhead). Later clips move later; linked layers stay with their clips" disabled={!canInsert} onClick={() => openInsert()}><Ic g="＋" size={16} /><span>Insert after</span></button>
      {iconBtn("❄", "Freeze", () => { if (sp) { engine.dispatch(cmd.freezeFrame(sp.id, Math.round(player.time))); setToast("Freeze frame inserted (3 s)"); } }, { title: "Freeze the frame under the playhead for 3 s (F)", disabled: !(sp && sp.clipType === "video" && !sp.freeze) })}
      <span className="v2-dsep" aria-hidden />
      <button className="v2-dtool v2-dtool-text" title="Trim start to playhead (Q)" aria-label="Trim start to playhead" onClick={() => trimToPlayhead("left")}><Ic g="trim-start" size={16} /><span>Trim start</span></button>
      <button className="v2-dtool v2-dtool-text" title="Trim end to playhead (W)" aria-label="Trim end to playhead" onClick={() => trimToPlayhead("right")}><Ic g="trim-end" size={16} /><span>Trim end</span></button>
      <button className="v2-dtool v2-dtool-text" title={tracking.canTrack(sp) ? "Track a region of this clip (text, overlays and code can follow it)" : "Select a video clip to track"} disabled={!tracking.canTrack(sp)} onClick={() => { player.pause(); setTrackOpen({}); }}><Ic g="track" size={16} /><span>Track</span></button>
      <button className="v2-dtool v2-dtool-text" title={sp && masking.canMask(sp) ? "Mask this picture: shapes or an editable freeform path" : "Select an image, video or HTML clip to mask"} disabled={!(sp && masking.canMask(sp))} onClick={() => { player.pause(); setMaskOpen(true); }}><Ic g="mask" size={16} /><span>Mask</span></button>
      <button className="v2-dtool v2-dtool-text" title={pair ? "Match frames across the cut between these two clips" : "Select a video clip that touches another video clip"} disabled={!pair} onClick={() => setMatchOpen(true)}><Ic g="match" size={16} /><span>Match frames</span></button>
      <span className="v2-dsep" aria-hidden />
      <button className="v2-dtool v2-dtool-text" title="Add an empty video (overlay) track" onClick={() => engine.dispatch(cmd.addTrack("video"))}><Ic g="▭" size={16} /><span>Video track</span></button>
      <button className="v2-dtool v2-dtool-text" title="Add an empty audio track" onClick={() => engine.dispatch(cmd.addTrack("audio"))}><Ic g="♫" size={16} /><span>Audio track</span></button>
      {project.storyboard && <><span className="v2-dsep" aria-hidden /><button className="v2-dtool v2-dtool-text v2-sync-btn" title="Sync to Storyboard: write timeline edits (length, order, trim, layers, effects, audio) back to the storyboard — review first" onClick={() => setSyncOpen(true)}><Ic g="board" size={16} /><span>Sync to Storyboard</span></button></>}
      <span className="v2-spacer" />
      {sel.length > 1 && <span className="v2-sel-count v2-sel-pill" role="status">{sel.length} selected</span>}
      <button className={`v2-dtool ${ripple ? "is-active" : ""}`} aria-pressed={ripple} aria-label="Ripple" title="Ripple: delete and trim move later clips to close gaps (R)" onClick={() => setRipple(!ripple)}><Ic g="⇤" size={18} /><span className="v2-sr">Ripple {ripple ? "on" : "off"}</span></button>
      <button className={`v2-dtool ${snapOn ? "is-active" : ""}`} aria-pressed={snapOn} aria-label="Snap" title="Smart snapping and alignment guides in the preview (hold Alt to skip once)" onClick={() => setSnapOn(!snapOn)}><Ic g="🧲" size={18} /><span className="v2-sr">Snap {snapOn ? "on" : "off"}</span></button>
      <span className="v2-dsep" aria-hidden />
      {iconBtn("zoom-out", "Zoom out", () => setPps((p) => clampPps(p / 1.5)), { title: "Zoom out (−)" })}
      <input className="v2-zoom" type="range" min={Math.log(4)} max={Math.log(400)} step={0.01} value={Math.log(pps)} aria-label="Timeline zoom" title="Timeline zoom (⌘/Ctrl+scroll)" onChange={(e) => setPps(clampPps(Math.exp(Number(e.target.value))))} />
      {iconBtn("zoom-in", "Zoom in", () => setPps((p) => clampPps(p * 1.5)), { title: "Zoom in (+)" })}
      {iconBtn("fit", "Zoom to fit", zoomFit, { title: "Fit the whole project in view (⇧Z)" })}
    </div>
  );
  const stepFrame = (n: number) => seek(player.time + n * secondsToTicks(1 / fpsNow));
  const shuttling = rate !== 0 && rate !== 1;
  const openCtx = (at: { x: number; y: number; placementId?: string; trackId?: string; ticks: number }) => {
    if (at.placementId && !sel.includes(at.placementId)) selectClip(at.placementId);
    setCtx(at);
  };
  const ctxItems = (): MenuItem[] => {
    if (!ctx) return [];
    const k = (s: string) => `${MOD}${MOD === "⌘" ? "" : "+"}${s}`;
    if (!ctx.placementId) return [
      { label: "Paste…", icon: "📋", shortcut: k("V"), disabled: !hasClip, onSelect: paste },
      { label: "Insert new clip after current clip", icon: "＋", disabled: !canInsert, onSelect: () => openInsert() },
      { label: "Add text here", icon: "T", shortcut: "T", onSelect: () => addTextAt(Math.round(ctx.ticks)) },
      { label: "Import media…", icon: "⇪", onSelect: () => importDialog() },
      "sep",
      { label: "Select all clips", shortcut: k("A"), disabled: !allIds.length, onSelect: () => { setSubId(undefined); setSel(allIds); } },
    ];
    const f = findPlacement(comp, ctx.placementId);
    if (!f) return [];
    const p = f.placement, t = Math.round(time);
    const inside = t > p.startTicks && t < p.startTicks + p.durationTicks;
    const many = sel.length > 1 ? ` ${sel.length} clips` : "";
    const ctxLink = p.source.assetId ? storyDomain.storyLinkOf(project, p.source.assetId) : undefined;
    return [
      ...(p.placeholder && sel.length <= 1 ? [{ label: "Fill placeholder…", icon: "⇄", onSelect: () => { selectClip(p.id); setRangeFor({ id: p.id, picker: true }); } }, "sep" as const] : []),
      ...(ops.mainTrack(comp)?.id === f.track.id && sel.length <= 1 ? [{ label: "Insert new clip after", icon: "＋", onSelect: () => openInsert(p.id) }, "sep" as const] : []),
      ...(canAdjustRange(p) && sel.length <= 1 ? [{ label: "Adjust range…", icon: "⇔", shortcut: "Alt+drag", onSelect: () => { selectClip(p.id); setRangeFor({ id: p.id }); } }] : []),
      ...(canReplaceAsset(p) && sel.length <= 1 ? [{ label: "Replace asset…", icon: "⇄", onSelect: () => { selectClip(p.id); setRangeFor({ id: p.id, picker: true }); } }, "sep" as const] : []),
      { label: "Split at playhead", icon: "✂", shortcut: "S", disabled: !inside || sel.length > 1, onSelect: () => engine.dispatch(cmd.splitPlacement(p.id, t)) },
      { label: "Trim start to playhead", icon: "trim-start", shortcut: "Q", disabled: !inside, onSelect: () => trimToPlayhead("left") },
      { label: "Trim end to playhead", icon: "trim-end", shortcut: "W", disabled: !inside, onSelect: () => trimToPlayhead("right") },
      "sep",
      { label: `Copy${many}`, icon: "⎘", shortcut: k("C"), onSelect: copy },
      { label: `Cut${many}`, icon: "✂", shortcut: k("X"), onSelect: cut },
      { label: "Paste…", icon: "📋", shortcut: k("V"), disabled: !hasClip, onSelect: paste },
      { label: `Duplicate${many}`, icon: "⧉", shortcut: k("D"), onSelect: duplicate },
      ...(p.clipType === "video" && !p.freeze && sel.length === 1 ? [{ label: "Freeze frame", icon: "❄", shortcut: "F", disabled: !inside, onSelect: () => { engine.dispatch(cmd.freezeFrame(p.id, t)); setToast("Freeze frame inserted (3 s)"); } }] : []),
      ...(sel.length <= 1 && promote.canPromote(comp, p.id) ? [{ label: "Promote to main track…", icon: "⤓", onSelect: () => setPromoteFor(p.id) }] : []),
      ...(ctxLink && sel.length === 1 ? [{ label: "Open in storyboard", icon: "board", onSelect: () => openStory(ctxLink.target) }] : []),
      ...(p.clipType === "html" && sel.length === 1 ? [{ label: "Edit code…", icon: "✎", onSelect: () => void openCode() }] : []),
      "sep",
      { label: `Delete${many}`, icon: "🗑", shortcut: "Del", danger: true, onSelect: () => delSel(false) },
      { label: "Ripple delete", icon: "🗑", shortcut: "⇧Del", danger: true, onSelect: () => delSel(true) },
    ];
  };
  const desktopTransport = (
    <div className="v2-dtransport">
      <span className="v2-time"><b>{formatTimecode(time, fpsNow)}</b> / {formatTimecode(duration, fpsNow)}</span>
      <span className="v2-dtransport-mid">
        {iconBtn("⏮", "Go to start", () => seek(0), { title: "Go to start (Home)" })}
        {iconBtn("step-back", "Previous frame", () => stepFrame(-1), { title: "Previous frame (←)" })}
        <button className="v2-play" aria-label={playing || shuttling ? "Pause" : "Play"} title={playing || shuttling ? "Pause (Space · K)" : "Play (Space · L)"} onClick={playPause}><Ic g={playing || shuttling ? "❚❚" : "▶"} /></button>
        {iconBtn("step-fwd", "Next frame", () => stepFrame(1), { title: "Next frame (→)" })}
        {iconBtn("⏭", "Go to end", () => seek(duration), { title: "Go to end (End)" })}
      </span>
      <span className="v2-dtransport-end">
        {shuttling && <span className="v2-shuttle" role="status" aria-label={`Shuttle ${shuttleLabel(rate)}`} title="J/K/L shuttle — K stops">{shuttleLabel(rate)}</span>}
        <span className="v2-ratio" title="Project aspect — change it in the inspector with nothing selected">{project.settings.width}×{project.settings.height}</span>
        {iconBtn("⛶", "Fullscreen", fullscreen, { title: "Fullscreen preview" })}
      </span>
    </div>
  );
  const canvasSize = previewCanvasSize(project.settings);
  useEffect(() => { player.draw(); }, [player, canvasSize.width, canvasSize.height, project.settings.background]);
  const preview = (
    <section className="v2-preview" aria-label="Preview" style={mobile ? { height: `${previewVh}dvh` } : undefined}>
      <div className={`v2-canvas-wrap${mobile && fsActive && previewOrientFallback() === "css-rotate" && needsCssRotate(fsOrient, vp.w, vp.h) ? " is-fs-rotate" : ""}`}>{mediaLoading && <div className="v2-buffering" role="status" aria-live="polite" data-testid="preview-loading"><span className="v2-buffering-spin" aria-hidden="true" />Loading…</div>}<canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} onClick={onCanvasTap} title={mobile ? "Tap an element to select it · tap empty space to play/pause" : "Click an element to select it · click empty space to play/pause"} />
        {visual && player.boxes.get(visual.id) && canvasRef.current && <TransformHandles engine={engine} placement={visual} time={time} box={player.boxes.get(visual.id)!} canvas={canvasRef.current} actions={gizmo} route={layerRoute} snapping={snapOn} others={[...player.boxes].filter(([id]) => id !== visual.id).map(([, b]) => b)} />}
        {inlineEditor}
        {!mobile && visual && scopeChip}
        {mobile && fsActive && (
          <PreviewFsControls playing={playing} timeTicks={time} durationTicks={duration} fps={project.settings.fps} muted={previewMute} orient={fsOrient}
            onTogglePlay={togglePlay} onSeek={seek} onExit={fullscreen} onMute={() => setPreviewMute((m) => !m)}
            onOrient={() => {
              const next = toggleOrient(fsOrient);
              setFsOrient(next);
              if (canLockOrientation()) void (screen.orientation as ScreenOrientation & { lock: (o: PreviewOrient) => Promise<void> }).lock(next).catch(() => undefined);
            }} />
        )}
      </div>
      {!mobile && desktopTransport}
    </section>
  );
  return (
    <div className={`v2-app ${mobile ? "is-mobile" : "is-desktop"} ${fsActive ? "is-fs" : ""}`}>
      {fileInputs}
      {pasteAsk && (() => {
        const t = Math.round(player.time);
        const target = pasteTrack === chain.NEW_PASTE_TRACK ? { newTrack: true as const } : { trackId: pasteTrack };
        const canPlayhead = !chain.pasteOverlaps(comp, clipboard.current, t, target);
        return <PastePlaceDialog canAfter={chain.insertAfterTicks(comp, { selectedIds: sel, time: t }) !== undefined} canPlayhead={canPlayhead}
          playheadTitle={canPlayhead ? "Place it at the playhead without moving other clips" : "A clip already occupies the playhead on this track — choose another place or another track"}
          tracks={chain.pasteTrackOptions(comp, clipboard.current)} trackId={pasteTrack} onTrackChange={setPasteTrack}
          newTrackLabel={chain.newPasteTrackLabel(comp, clipboard.current)} onChoose={commitPaste} onCancel={() => setPasteAsk(false)} />;
      })()}
      {mobile ? (
        <header className="v2-header v2-mheader">
          <button type="button" className="v2-brand" aria-label="Dionysus" title="Dionysus — Projects" onClick={() => setProjects(true)}><BrandLogo /></button>
          <button className="v2-icon v2-projects-btn" aria-label="Projects" title="Projects: new, open, rename, delete, export, import" onClick={() => setProjects(true)}><Ic g="☰" /></button>
          <button className="v2-icon v2-board-btn" aria-label="Storyboard" title="Storyboard: plan shots with your own AI" onClick={() => { player.pause(); setBoard(true); }}><Ic g="board" /></button>
          <span className="v2-spacer" />
          <select className="v2-res" aria-label="Export resolution" value={res} onChange={(e) => setRes(e.target.value as Resolution)}>
            {["720p", "1080p", "2K", "4K"].map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="v2-export" aria-label="Export MP4" title="Export MP4 (⌘/Ctrl+E)" onClick={openExport}><Ic g="film" size={16} /> Export</button>
        </header>
      ) : (
        <header className="v2-header v2-dheader">
          <button type="button" className="v2-brand v2-brand-d" aria-label="Dionysus" title="Dionysus — Projects" onClick={() => setProjects(true)}><BrandLogo /></button>
          <button className="v2-dtool" aria-label={lay.leftOpen ? "Hide asset panel" : "Show asset panel"} title={lay.leftOpen ? "Hide asset panel" : "Show asset panel"} aria-pressed={lay.leftOpen} onClick={() => togglePanel("leftOpen")}><Ic g={lay.leftOpen ? "panel-close" : "panel-open"} size={18} /></button>
          <button className="v2-btn v2-projects-btn" aria-label="Projects" title="Projects: new, open, rename, delete, export, import" onClick={() => setProjects(true)}><Ic g="☰" size={16} /> Projects</button>
          <button className="v2-btn v2-board-btn" aria-label="Storyboard" title="Storyboard: plan shots with your own AI, import its JSON" onClick={() => { player.pause(); setBoard(true); }}><Ic g="board" size={16} /> Storyboard</button>
          <input className="v2-title" value={project.name} aria-label="Project name" title="Rename project" onFocus={() => engine.beginGesture()} onBlur={() => engine.endGesture()} onChange={(e) => engine.dispatch(cmd.renameProject(e.target.value))} />
          <span className="v2-badge">v2 preview</span>
          <span className="v2-spacer" />
          <span className="v2-dgroup">
            <button className="v2-dtool" aria-label="Undo" title="Undo (⌘/Ctrl+Z)" disabled={!canUndo} onClick={() => engine.undo()}><Ic g="↶" size={18} /></button>
            <button className="v2-dtool" aria-label="Redo" title="Redo (⇧⌘Z / Ctrl+Y)" disabled={!canRedo} onClick={() => engine.redo()}><Ic g="↷" size={18} /></button>
          </span>
          <button className="v2-dtool" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setKbdOpen(true)}><Ic g="keyboard" size={18} /></button>
          <button className="v2-dtool" aria-label={lay.rightOpen ? "Hide inspector" : "Show inspector"} title={lay.rightOpen ? "Hide inspector" : "Show inspector"} aria-pressed={lay.rightOpen} onClick={() => togglePanel("rightOpen")}><Ic g={lay.rightOpen ? "panel-r-close" : "panel-r-open"} size={18} /></button>
          <button className="v2-btn primary v2-export-d" aria-label="Export MP4" title="Export MP4 (⌘/Ctrl+E)" onClick={openExport}><Ic g="film" size={16} /> Export MP4</button>
        </header>
      )}
      {board && <StoryboardView engine={engine} blobs={storage.blobs} player={player} initialOpen={boardOpen} onSeries={() => setSeriesLib(true)} onClose={() => { setBoard(false); setBoardOpen(undefined); }}
        onView={(id) => { setBoard(false); setBoardOpen(undefined); const pl = ops.mainTrack(engine.getState().project.compositions[engine.getState().project.rootCompositionId])?.placements.find((x) => x.id === id); if (pl) { if (mobile) setMenu("edit"); selectClip(id); seek(pl.startTicks); } }} />}
      {seriesLib && <SeriesLibrary engine={engine} project={project} storage={storage} onClose={() => setSeriesLib(false)} />}
      <AgentIndicator engine={engine} />
      {notice && <RecoveryNotice failure={notice} storage={storage} onDismiss={() => setNotice(undefined)} />}
      {projects && <ProjectsDialog storage={storage} current={project} onOpen={(id) => { setProjects(false); onSwitch(id); }} onRenameCurrent={(n) => engine.dispatch(cmd.renameProject(n))} onClose={() => setProjects(false)} />}
      {exporting && <ExportDialog project={project} blobs={storage.blobs} res={res} onRes={setRes} onClose={() => setExporting(false)} />}
      {audioAi && <div className="v2-modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) setAudioAi(false); }}><AudioAiSheet onAdd={addAiAudio} onClose={() => setAudioAi(false)} /></div>}
      {audioEdit && <AudioEditor key={audioEdit.create ? "new-audio" : audioEdit.placementId} source={audioEdit.source} create={audioEdit.create} mobile={mobile} onSave={saveAudio} onClose={() => setAudioEdit(undefined)} />}
      {codeAi && <CodeAiWizard mobile={mobile} initialRole={codeAi === "overlay" ? "overlay" : "scene"} onClose={() => { setHtmlEdit({ source: newCodeClipHtml(), create: codeAi }); setCodeAi(undefined); }} onImport={(html) => { setHtmlEdit({ source: html, create: codeAi }); setCodeAi(undefined); }} />}
      {htmlEdit && (() => {
        const editPl = htmlEdit.placementId ? findPlacement(comp, htmlEdit.placementId)?.placement : undefined;
        return <CodeEditor key={htmlEdit.create ? "new" : htmlEdit.placementId} source={htmlEdit.source} create={!!htmlEdit.create} mobile={mobile} previewParams={editPl?.htmlParams} mixUnderlay={editPl ? (t) => mixFromPlayer(player, editPl, t) : undefined} mixPlacement={editPl} onAiMode={htmlEdit.create === "main" || htmlEdit.create === "overlay" ? () => { setCodeAi(htmlEdit.create === "overlay" ? "overlay" : "main"); setHtmlEdit(undefined); } : undefined} defaultSaveMode={clipVersion.versionSaveModeOf(project)} onSave={(h, mode) => void saveCode(h, mode)} onClose={() => setHtmlEdit(undefined)} />;
      })()}
      {subsPick && <div className="v2-menu-backdrop v2-confirm-backdrop" onPointerDown={() => setSubsPick(false)}>
        <div className="v2-confirm v2-subs-pick" role="dialog" aria-modal="true" aria-label="Choose a text layer" onPointerDown={(e) => e.stopPropagation()}>
          <h4>Edit subtitles</h4><p>Which text layer?</p>
          {textLayers.map((t) => <button key={t.id} className="v2-btn v2-subs-pick-row" onClick={() => openSubs(t.id)}><Ic g="≡" size={16} /><span className="v2-subs-pick-name"><b>{t.name}</b><em>{(() => { const c = cueLayer.cuesOf(t); const f = c[0]?.text.replace(/\s+/g, " ") ?? ""; return `${f.length > 24 ? f.slice(0, 24) + "…" : f} · ${c.length} line${c.length === 1 ? "" : "s"}`; })()}</em></span></button>)}
          <div className="v2-confirm-actions"><button className="v2-btn" onClick={() => setSubsPick(false)}>Cancel</button></div>
        </div>
      </div>}
      {!mobile && <DesktopTooltips />}
      {!mobile && matchOpen && pair && <div className="v2-match-back" onClick={(e) => { if (e.target === e.currentTarget) setMatchOpen(false); }}>
        <div className="v2-match-dialog" role="dialog" aria-modal="true" aria-label="Match frames" onKeyDown={(e) => { if (e.key === "Escape") setMatchOpen(false); }}>
          <header><h3>Match frames</h3><button className="v2-icon" aria-label="Close" onClick={() => setMatchOpen(false)}><Ic g="✕" /></button></header>
          <MatchFrames engine={engine} project={project} a={pair[0]} b={pair[1]} analyse={makeAnalyse(project, loadAssetBlob)} loadMedia={loadAssetBlob} onDone={(m) => { setMatchOpen(false); if (m) setToast(m); }} />
        </div>
      </div>}
      {!mobile && rangeFor && findPlacement(comp, rangeFor.id) && <aside className="v2-slip-panel" role="dialog" aria-label={findPlacement(comp, rangeFor.id)?.placement.placeholder && rangeFor.picker ? "Fill placeholder" : rangeFor.picker ? "Replace asset" : "Adjust range"} onKeyDown={(e) => { if (e.key === "Escape") setRangeFor(undefined); }}>
        <AdjustRange key={`${rangeFor.id}:${rangeFor.picker ? 1 : 0}`} engine={engine} project={project} clipId={rangeFor.id} blobs={storage.blobs} peaks={peaks} strips={strips} thumbs={thumbs} startInPicker={rangeFor.picker} ripple={ripple} onUpload={(fs) => onFiles(fs)} onSeek={seek} onMix={setMixDraft} onPlayRange={playRange} time={time} onDone={(m) => { setRangeFor(undefined); if (m) setToast(m); }} />
      </aside>}
      {!mobile && kbdOpen && <ShortcutsOverlay onClose={() => setKbdOpen(false)} />}
      {!mobile && ctx && <ContextMenu x={ctx.x} y={ctx.y} label={ctx.placementId ? "Clip actions" : "Track actions"} items={ctxItems()} onClose={() => setCtx(undefined)} />}
      {toast && <div className={`v2-toast ${toastUndo ? "has-undo" : ""}`} role="status" onClick={() => setToast(undefined)}><span>{toast}</span>{toastUndo && <button className="v2-toast-undo" title={`Undo (${MOD} Z)`} onClick={(e) => { e.stopPropagation(); engine.undo(); setToast(undefined); }}>Undo</button>}</div>}
      {promoteFor && findPlacement(comp, promoteFor) && <PromoteSheet engine={engine} project={project} clipId={promoteFor} onDone={(m) => { setPromoteFor(undefined); if (m) setToast(m); }} />}
      {syncOpen && <SyncSheet engine={engine} project={project} onDone={(m) => { setSyncOpen(false); if (m) setToast(m); }} />}
      {maskOpen && selected?.placement && masking.canMask(selected.placement) && <div className="v2-modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) { player.maskPreview = null; player.draw(); setMaskOpen(false); } }}>
        <MaskSheet key={selected.placement.id} engine={engine} project={project} placement={selected.placement} time={Math.round(player.time)} loadBlob={loadAssetBlob}
          onPreview={(m) => { player.maskPreview = { id: selected.placement!.id, mask: m }; player.draw(); }}
          onSeek={seek}
          onClose={() => { player.maskPreview = null; player.draw(); setMaskOpen(false); }}
          onDone={(m) => { player.maskPreview = null; player.draw(); setMaskOpen(false); setToast(m); }} />
      </div>}
      {trackOpen && selected?.placement && tracking.canTrack(selected?.placement) && <div className="v2-modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) setTrackOpen(false); }}>
        <TrackSheet key={`${selected?.placement.id}:${trackOpen.trackId ?? "new"}`} trackId={trackOpen.trackId} engine={engine} project={project} placement={selected?.placement} time={Math.round(player.time)} loadBlob={loadAssetBlob} onClose={() => setTrackOpen(false)} onDone={(m) => { setTrackOpen(false); setToast(m); }} />
      </div>}
      {cleanOpen && <div className="v2-modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) setCleanOpen(false); }}>
        <CleanupDialog engine={engine} project={project} blobs={storage.blobs} onClose={() => setCleanOpen(false)} onDone={(m) => { setCleanOpen(false); setToast(m); }} />
      </div>}
      {projOpen && <Sheet label="Project settings" className="v2-msheet-insp" onClose={() => setProjOpen(false)}><MobileProjectSettings engine={engine} project={project} onSeries={() => { setProjOpen(false); setSeriesLib(true); }} onCleanup={() => { setProjOpen(false); setCleanOpen(true); }} /></Sheet>}
      {mobile ? (
        <>
          {preview}
          <div className="v2-mcontrols">
            <button className="v2-icon" aria-label="Fullscreen" onClick={fullscreen}><Ic g="⛶" /></button>
            <span className="v2-mtransport">
            <button className="v2-icon v2-mstep" aria-label="Previous frame" title="Previous frame" onClick={() => stepFrame(-1)}><Ic g="step-back" /></button>
            <button className="v2-icon v2-mplay" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}><Ic g={playing ? "❚❚" : "▶"} /></button>
            <button className="v2-icon v2-mstep" aria-label="Next frame" title="Next frame" onClick={() => stepFrame(1)}><Ic g="step-fwd" /></button>
            </span>
            <span className="v2-mundo">
              <button className="v2-icon" aria-label="Undo" disabled={!canUndo} onClick={() => engine.undo()}><Ic g="↶" /></button>
              <button className="v2-icon" aria-label="Redo" disabled={!canRedo} onClick={() => engine.redo()}><Ic g="↷" /></button>
            </span>
          </div>
          <PanelGrabber vh={previewVh} onChange={setPreviewVh} target={() => document.querySelector<HTMLElement>(".v2-app.is-mobile .v2-preview")} />
          <Timeline onOpenTrack={openTrack} onTrackRange={(c) => void trackRange(c)} focus={focusGroup} engine={engine} project={project} time={time} playing={playing} onSeek={seek} selectedId={selectedId} selectedIds={sel} onToggleSelect={toggleClip} multiMode={multiMode} onSelect={selectClip} peaks={peaks} strips={strips} loads={clipLoads} pps={pps} onZoom={(z) => setPps(clampPps(z))} centered onPlayback={(p) => { stopAt.current = undefined; if (p) player.play(); else player.pause(); }} topLane={topLane} ripple={ripple} onTransition={onTransition} onEditSubs={openSubs} onEditLayer={editLayer} onMergeDraft={setMergeDraft} onMergePlay={mergePlay} expanded={expanded} onExpand={onExpand}
            thumbs={thumbs} onAddMedia={() => setPicker("main")}
            timeLabel={<><b>{formatTimecode(time, project.settings.fps).slice(0, 5)}</b> / {formatTimecode(duration, project.settings.fps).slice(0, 5)}</>}
            sideColumn={<>
              {firstVideoTrack && <button className="v2-side-btn" onClick={() => engine.dispatch(cmd.toggleTrackMute(firstVideoTrack.id))}><b aria-hidden><Ic g={firstVideoTrack.muted ? "🔇" : "🔊"} /></b><span>{firstVideoTrack.muted ? "Unmute clip audio" : "Mute clip audio"}</span></button>}
              <button className="v2-side-btn v2-cover" onClick={() => seek(0)} style={firstClip && thumbs[firstClip.source.assetId] ? { backgroundImage: `url(${thumbs[firstClip.source.assetId]})` } : undefined}><span>Cover</span></button>
            </>} />
          <nav className="v2-toolbar" aria-label={selected ? "Clip actions" : "Timeline actions"}>
            {(activeMenu !== "root" || expanded) && <button className="v2-tool v2-tool-back" aria-label={activeMenu === "root" && expanded ? `Collapse ${ops.GROUP_LABEL[expanded]}` : "Back"} title={activeMenu === "root" && expanded ? `Collapse ${ops.GROUP_LABEL[expanded]}` : "Back"} onClick={back}>‹</button>}
            <div ref={toolbarFade} className="v2-toolbar-scroll" data-testid="toolbar-scroll">{mobileTools[activeMenu]}</div>
          </nav>
          {pickerEl}
          {barSheet && selected && <Sheet label={barSheet === "trim" ? "Trim" : barSheet === "colour" ? "Colour" : "Audio"} className="v2-msheet-insp v2-bar-sheet" snaps={[0.3, 0.42, 0.9]} onClose={() => setBarSheet(undefined)}>
            {barSheet === "colour" ? (selected.placement.blank ? <BlankColorPicker value={selected.placement.blank.color} onChange={(c) => engine.dispatch(cmd.setBlankColor(selected.placement.id, c))} /> : null)
            : barSheet === "trim" ? <ActionGrid groups={[{ title: "Trim to the playhead", items: [
              { key: "trim-start", icon: "trim-start", label: "Start", title: "Trim start to playhead: the clip starts here (Q)", run: () => { trimToPlayhead("left"); setBarSheet(undefined); } },
              { key: "trim-end", icon: "trim-end", label: "End", title: "Trim end to playhead: the clip ends here (W)", run: () => { trimToPlayhead("right"); setBarSheet(undefined); } }] }]} />
            : <div className="v2-audio-sheet">
              {selected.placement.clipType !== "image" && selected.placement.clipType !== "text" && selected.placement.clipType !== "effect" && volumeRow(selected.placement)}
              <ActionGrid groups={[{ title: "Sound", items: [
                ...(selected.placement.clipType === "video" ? [{ key: "mute-clip", icon: selected.placement.linkedAudio?.muted ? "🔇" : "🔊", label: "Mute", title: selected.placement.linkedAudio?.muted ? "Play this clip's own audio again" : "Silence only this clip's own audio", active: !!selected.placement.linkedAudio?.muted, run: () => engine.dispatch(cmd.setLinkedAudioMuted(selected.placement.id, !selected.placement.linkedAudio?.muted)) }] : []),
                { key: "vcurve", icon: "curve", label: "Curve", title: "Volume points over the waveform, and fades", run: () => { setBarSheet(undefined); setVcOpen(true); } },
                { key: "afx", icon: "afx", label: "Audio FX", title: "Echo, telephone, radio, robot…", run: () => { setBarSheet(undefined); setAfxOpen(true); } },
                { key: "position", icon: "spatial", label: "Position", title: "Where the sound sits: left, right, behind, near or far", run: () => { setBarSheet(undefined); setPosOpen(true); } },
              ] }]} />
            </div>}
          </Sheet>}
          {sheet && <Sheet label="Media" head={false} onClose={() => setSheet(false)}>{browser}</Sheet>}
          {!sheet && <div hidden>{browser}</div>}
          {cue && <div className="v2-msub"><SubtitleEditor engine={engine} sub={cue} onDelete={delCue} /></div>}
          {inspOpen && selected && <Sheet label="Adjust" className="v2-msheet-insp" extra={scopeChip || undefined} onClose={() => setInspOpen(false)}>{selected.placement.clipType === "video" && !selected.placement.freeze && <section className="v2-psettings v2-frames-sec" aria-label="In and out frames"><h4>In / out frames</h4><ClipFrames engine={engine} project={project} placement={selected.placement} /></section>}<TransformInspector engine={engine} placement={selected.placement} time={time} /></Sheet>}
          {matchOpen && pair && <Sheet label="Match frames" className="v2-msheet-insp" onClose={() => setMatchOpen(false)}><MatchFrames engine={engine} project={project} a={pair[0]} b={pair[1]} analyse={makeAnalyse(project, loadAssetBlob)} loadMedia={loadAssetBlob} onDone={(m) => { setMatchOpen(false); if (m) setToast(m); }} /></Sheet>}
          {ckOpen && selected && canChromaKey(selected.placement) && <Sheet label="Chroma key" className="v2-msheet-insp" dim={false} onClose={() => { setCkOpen(false); setEyedrop(undefined); }}><ChromaKeyPanel engine={engine} placement={selected.placement} picking={eyedrop === selected.placement.id} onPick={(on) => setEyedrop(on ? selected.placement.id : undefined)} /></Sheet>}
          {vcOpen && selected && hasSound(selected.placement) && <Sheet label="Volume curve" className="v2-msheet-insp" onClose={() => setVcOpen(false)}><VolumeCurve engine={engine} placement={selected.placement} time={time} peaks={peaks[mediaKey(selected.placement.source.assetId, selected.placement.source.versionId)]} /></Sheet>}
          {afxOpen && selected && hasSound(selected.placement) && <Sheet label="Audio FX" className="v2-msheet-insp" onClose={() => setAfxOpen(false)}><AudioFxPanel engine={engine} placement={selected.placement} /></Sheet>}
          {posOpen && selected && hasSound(selected.placement) && <Sheet label="Position" className="v2-msheet-insp" onClose={() => setPosOpen(false)}><SpatialPad engine={engine} project={project} placement={selected.placement} track={selected.track} time={time} /></Sheet>}
          {rangeFor && findPlacement(comp, rangeFor.id) && <Sheet label={findPlacement(comp, rangeFor.id)?.placement.placeholder && rangeFor.picker ? "Fill placeholder" : rangeFor.picker ? "Replace asset" : "Adjust range"} className="v2-msheet-insp v2-msheet-slip" head={false} snaps={[0.3, 0.62, 0.9]} onClose={() => setRangeFor(undefined)}><AdjustRange key={`${rangeFor.id}:${rangeFor.picker ? 1 : 0}`} engine={engine} project={project} clipId={rangeFor.id} blobs={storage.blobs} peaks={peaks} strips={strips} thumbs={thumbs} startInPicker={rangeFor.picker} ripple={ripple} onUpload={(fs) => onFiles(fs)} onSeek={seek} onMix={setMixDraft} onPlayRange={playRange} time={time} onDone={(m) => { setRangeFor(undefined); if (m) setToast(m); }} /></Sheet>}
          {verOpen && selected && <Sheet label="Version" className="v2-msheet-insp" onClose={() => setVerOpen(false)}><ClipVersionPicker engine={engine} project={project} clipId={selected.placement.id} onToast={(m) => { if (m) setToast(m); }} /></Sheet>}
          {inOpen && selected && inPointable && <Sheet label="In point" className="v2-msheet-insp" onClose={() => setInOpen(false)}><InPointControl engine={engine} project={project} placement={selected.placement} /></Sheet>}
          {subsTrack && <Sheet label="Edit subtitles" className="v2-msheet-tall" head={false} onClose={() => setSubsEdit(undefined)}><SubtitleList engine={engine} track={subsTrack} time={time} playing={playing} onSeek={seek} onTogglePlay={togglePlay} desktop={false} name={project.name} focusCue={subsCue} onDone={() => setSubsEdit(undefined)} onImport={openSubImport} /></Sheet>}
          {layerTrack && !selected && <Sheet label={`Edit all · ${layerTrack.name}`} className="v2-msheet-insp" onClose={() => setLayerEdit(undefined)}><TextPanel key={layerTrack.id} engine={engine} layer={layerTrack} initialTab="Style" /></Sheet>}
          {textOpen && selected && isText && <Sheet label="Text" className="v2-msheet-insp" snapTo={animLoop ? 0 : undefined} extra={scopeChip || undefined} onClose={closeAnim}><TextPanel engine={engine} placement={effSel} track={selTrack} onAnimPicked={() => setAnimLoop(true)} time={time} playing={playing} onSeek={seek} onTogglePlay={togglePlay} /></Sheet>}
          {transFor && cutOf(comp, transFor) && <Sheet label="Transitions" head={false} dim={false} className="v2-trans-sheet" onClose={() => setTransFor(undefined)}><TransitionPicker key={transFor} engine={engine} comp={comp} placementId={transFor} thumbs={thumbs} onPreview={previewCut} onToast={setToast} onNewCode={() => createCodeRole("transition")} onDone={() => setTransFor(undefined)} /></Sheet>}
          {fxOpen && <Sheet label="Effects" className="v2-msheet-insp" onClose={() => setFxOpen(false)}><EffectPicker engine={engine} at={time} placement={isEffect ? selected!.placement : undefined} onAdded={(id) => setSel([id])} onClose={() => setFxOpen(false)} onNewCode={() => createCodeRole("effect")} onEditCode={(id) => void editCodeAsset(id)} /></Sheet>}
          {paramsOpen && selected && isHtml && <Sheet label="Clip params" className="v2-msheet-insp" onClose={() => setParamsOpen(false)}><HtmlParamsPanel engine={engine} project={project} placement={selected.placement} blobs={storage.blobs} onEditCode={() => { setParamsOpen(false); void openCode(); }} /></Sheet>}
          {animOpen && !textOpen && selected && isText && <Sheet label="Animation" className="v2-msheet-insp v2-anim-sheet" snapTo={animLoop ? 0 : undefined} extra={scopeChip || undefined} onClose={closeAnim}><AnimationPicker engine={engine} placement={selected.placement} onPicked={() => setAnimLoop(true)} /></Sheet>}
        </>
      ) : (
        <div className="v2-dshell" style={{ gridTemplateColumns: `${lay.leftOpen ? lay.left : 0}px ${lay.leftOpen ? 5 : 0}px minmax(0,1fr) ${lay.rightOpen ? 5 : 0}px ${lay.rightOpen ? lay.right : 0}px`, gridTemplateRows: `minmax(0,1fr) 5px ${lay.timeline}px` }}>
          {lay.leftOpen && <div className="v2-dpane v2-dpane-left">{assetBrowser}</div>}
          {pickerEl}
          {lay.leftOpen && <Splitter label="Resize asset panel" value={lay.left} dir="right" min={LIMITS.left[0]} max={LIMITS.left[1]} onChange={(v) => resize({ left: v })} onCommit={commitSizes} onReset={() => { resize({ left: DEFAULT_SIZES.left }); commitSizes(); }} />}
          <div className="v2-dpane v2-dpane-center">{preview}</div>
          {lay.rightOpen && <Splitter label="Resize inspector" value={lay.right} dir="left" min={LIMITS.right[0]} max={LIMITS.right[1]} onChange={(v) => resize({ right: v })} onCommit={commitSizes} onReset={() => { resize({ right: DEFAULT_SIZES.right }); commitSizes(); }} />}
          {lay.rightOpen && insp && <div className="v2-dpane v2-dpane-right"><Inspector key={insp.title === "Project" ? "project" : selectedId ?? insp.title} {...insp} tab={itab} onTab={setItab} /></div>}
          <div className="v2-dsplit-h"><Splitter label="Resize timeline" value={lay.timeline} dir="up" min={LIMITS.timeline[0]} max={LIMITS.timeline[1]} onChange={(v) => resize({ timeline: v })} onCommit={commitSizes} onReset={() => { resize({ timeline: DEFAULT_SIZES.timeline }); commitSizes(); }} /></div>
          <section className="v2-timeline-panel v2-dtimeline" aria-label="Timeline">
            {desktopToolbar}
            <Timeline onOpenTrack={openTrack} onTrackRange={(c) => void trackRange(c)} focus={focusGroup} onFocusGroup={(g) => { setSel([]); setMenu(g && g !== "main" ? g : "root"); }} engine={engine} project={project} time={time} playing={playing} onSeek={seek} selectedId={selectedId} selectedIds={sel} onToggleSelect={toggleClip} multiMode={multiMode} onSelect={selectClip} peaks={peaks} strips={strips} loads={clipLoads} thumbs={thumbs} pps={pps} onZoom={(z) => setPps(clampPps(z))} centered={false} topLane={topLane} ripple={ripple} onTransition={onTransition} onEditSubs={openSubs} onEditLayer={editLayer} onDropData={onDropData} onContextMenu={openCtx} onMergeDraft={setMergeDraft} onMergePlay={mergePlay} />
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


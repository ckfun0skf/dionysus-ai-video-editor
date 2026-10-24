import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hitCandidates, isBackdrop, pickAt, Player, THREE_TEMPLATE } from "../render";
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
import { downloadSrt, importSrtFile, SubtitleEditor, SubtitleLane } from "./Subtitles";
import { downloadText, SubtitleList } from "./SubtitleList";
import { cues as cueLayer } from "../domain";
import { Ic } from "./Icon";
import { MediaPicker, type Picked } from "./MediaPicker";
import { projectMediaList } from "./projectMedia";
import { libraryFile, stickerFile, stickers } from "./libraryItems";
import { EffectPicker } from "./EffectPicker";
import { loadPreviewVh, PanelGrabber, Sheet, SheetDone } from "./Sheet";
import { useEdgeFade } from "./useEdgeFade";
import { AssetBrowser, type BrowserTab } from "./desktop/AssetBrowser";
import { Inspector, type InspectorTab } from "./desktop/Inspector";
import { ProjectSettings } from "./desktop/ProjectSettings";
import { Splitter } from "./desktop/Splitter";
import { clampSizes, DEFAULT_SIZES, LIMITS, loadSizes, previewCanvasSize, saveSizes, type PanelSizes } from "./desktop/layout";
import { readDragItem } from "./desktop/dnd";
import "./desktop/desktop.css";
import { ContextMenu, type MenuItem } from "./desktop/ContextMenu";
import { ShortcutsOverlay } from "./desktop/ShortcutsOverlay";
import { DesktopTooltips } from "./desktop/Tooltip";
import { editPoints, jumpEditPoint, MOD, shuttleLabel, shuttleNext, splitTargets } from "./desktop/shortcuts";
import { LIBRARY_ITEMS, type LibraryItem, type Sticker } from "./libraryItems";
import { text as textDomain } from "../domain";

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
  /** V2-107 desktop: J/K/L shuttle rate (0 = stopped, 1 = normal play), "?" sheet, right-click menu. */
  const [rate, setRate] = useState(0);
  const [kbdOpen, setKbdOpen] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; placementId?: string; trackId?: string; ticks: number }>();
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
  const [animLoop, setAnimLoop] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  const [htmlEdit, setHtmlEdit] = useState<{ placementId: string; assetId: string; source: string }>();
  const [inlineId, setInlineId] = useState<string>();
  const [subId, setSubId] = useState<string>();
  const [ripple, setRippleState] = useState(() => localStorage.getItem("v2.ripple") === "1");
  const setRipple = (on: boolean) => { setRippleState(on); localStorage.setItem("v2.ripple", on ? "1" : "0"); setToast(on ? "Ripple on: delete and trim close gaps" : "Ripple off"); };
  const srtRef = useRef<HTMLInputElement>(null);
  /** V2-106 desktop shell: panel sizes (persisted), browser tab, inspector tab. */
  const [sizes, setSizes] = useState<PanelSizes>(() => loadSizes(undefined, window.innerHeight));
  const sizesRef = useRef(sizes); sizesRef.current = sizes;
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => { const r = () => setVp({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, []);
  const lay = clampSizes(sizes, vp.w, vp.h);
  const resize = (patch: Partial<PanelSizes>) => {
    // Update the ref synchronously so a keyboard step can commit (persist) in the same tick.
    const n = clampSizes({ ...sizesRef.current, ...patch }, window.innerWidth, window.innerHeight);
    sizesRef.current = n; setSizes(n);
  };
  const commitSizes = () => saveSizes(sizesRef.current);
  const togglePanel = (k: "leftOpen" | "rightOpen") => setSizes((s) => { const n = { ...s, [k]: !s[k] }; saveSizes(n); return n; });
  const [btab, setBtabState] = useState<BrowserTab>(() => (localStorage.getItem("v2.browserTab") as BrowserTab) || "media");
  const setBtab = (t: BrowserTab) => { setBtabState(t); localStorage.setItem("v2.browserTab", t); };
  const [itab, setItab] = useState<string>();
  const preferTab = useRef<string>();
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
    setSel([id]); setSubId(undefined); preferTab.current = "transition"; setItab("transition");
  };
  const selectCue = (id?: string) => { setSubId(id); if (id) setSelectedId(undefined); };
  const addText = () => { const id = newId("plc"); if (engine.dispatch(cmd.addTextClip(Math.round(player.time), {}, id))) { setSel([id]); setSubId(undefined); } };
  const delCue = () => { if (subId) { engine.dispatch(cmd.removeSubtitle(subId)); setSubId(undefined); } };
  const onSrt = async (f?: File) => {
    if (!f) return;
    const rootOf = () => { const p = engine.getState().project; return p.compositions[p.rootCompositionId]; };
    const before = new Set(rootOf().tracks.map((t) => t.id));
    const n = await importSrtFile(engine, f);
    const added = rootOf().tracks.find((t) => !before.has(t.id) && t.kind === "text");
    if (added) setSrtLayer(added.id);
    setToast(n ? `Imported ${n} subtitles (Undo to revert)` : `${f.name}: no subtitles found`);
  };
  const subLayer = comp.tracks.find((t) => t.kind === "text" && t.layerStyle?.subtitle && t.placements.length) ?? comp.tracks.find((t) => t.kind === "text" && t.placements.some((p) => p.clipType === "text"));
  const exportSrt = () => (subLayer ? downloadText(cueLayer.layerToSrt(subLayer), project.name) : cues.length ? downloadSrt(cues, project.name) : setToast("No subtitles to export — import an SRT or add text first"));
  const topLane = cues.length ? { label: "Text", render: (toPx: (t: number) => number, toTicks: (px: number) => number) => <SubtitleLane engine={engine} list={cues} selectedId={subId} onSelect={selectCue} toPx={toPx} toTicks={toTicks} /> } : undefined;
  const textTools = [
    { icon: "T", label: "Add text", title: "Add a text clip at the playhead (T)", run: addText },
    { icon: "⇪", label: "Import SRT", title: "Import an .srt file as a new text layer", run: () => srtRef.current?.click() },
    { icon: "≡", label: "Edit subtitles", title: "Edit every subtitle in a list: text, timing, split, merge, find & replace", run: () => editSubtitles() },
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
  useEffect(() => { player.onTime = (t, p) => { setTime(t); setPlaying(p); setFrame((f) => f + 1); }; return () => player.dispose(); }, [player]);
  useEffect(() => { player.canvas = canvasRef.current ?? undefined; player.draw(); }, [player, mobile]);
  useEffect(() => { player.setProject(project); }, [player, project]);
  useEffect(() => { const live = sel.filter((id) => allIds.includes(id)); if (live.length !== sel.length) setSel(live); });
  useEffect(() => { if (subId && !cue) setSubId(undefined); }, [subId, cue]);

  const seek = useCallback((t: number) => player.seek(t), [player]);
  const closeAnim = () => { setAnimOpen(false); setTextOpen(false); if (animLoop) { setAnimLoop(false); player.pause(); } };
  const togglePlay = useCallback(() => (player.isPlaying ? player.pause() : player.play()), [player]);
  const splitAtPlayhead = () => {
    const t = Math.round(player.time), ids = splitTargets(comp, sel, t);
    if (!ids.length) { setToast("No clip under the playhead to split — move the playhead inside a clip"); return; }
    engine.dispatch(ids.map((id) => cmd.splitPlacement(id, t)), ids.length > 1 ? `Split ${ids.length} clips` : "Split clip");
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
  const tapAt = (cx: number, cy: number, onGizmo = false) => {
    if (!canvasRef.current) return;
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
    else togglePlay();
  };
  const otherAt = (cx: number, cy: number) => {
    if (!canvasRef.current) return undefined;
    const { x, y, k, W, H } = canvasPoint(cx, cy);
    return hitCandidates(player.boxes, x, y, { min: 48 * k, skip: (id, b) => id === selectedId || isBackdrop(b, W, H) })[0];
  };
  const onCanvasTap = (e: React.MouseEvent<HTMLCanvasElement>) => tapAt(e.clientX, e.clientY);
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
  const del = useCallback((rippleOverride?: boolean) => { if (selectedId) { engine.dispatch(cmd.deleteClips([selectedId], rippleOverride ?? ripple)); setSelectedId(undefined); } }, [engine, selectedId, ripple]);

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
      if (exporting || projects || kbdOpen || ctx || (e.target as HTMLElement)?.closest?.("input,textarea,select,[contenteditable=true],[role=menu],[role=dialog]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
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
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.shiftKey) { e.preventDefault(); seek(player.time + (e.key === "ArrowLeft" ? -1 : 1) * secondsToTicks(1)); return; }
        if (e.key === " ") { e.preventDefault(); playPause(); return; }
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
        const asset = await importFile(f, storage.blobs);
        if (asset) { if (engine.dispatch(cmd.importAsset(asset))) ids.push(asset.id); }
        else setToast(`${f.name}: unsupported file type`);
      } catch (e) {
        setToast(`${f.name}: ${e instanceof Error ? e.message : "import failed"}`);
      } finally { setBusy((b) => b - 1); }
    }
    return ids;
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

  const fileInputs = (
    <>
      <input ref={fileRef} type="file" hidden multiple accept="video/*,image/*,audio/*,.html,.htm,text/html" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      <input ref={srtRef} type="file" hidden accept=".srt,.vtt,text/plain" aria-label="Import SRT file" onChange={(e) => { void onSrt(e.target.files?.[0]); e.target.value = ""; }} />
    </>
  );
  const browser = (
    <section className="v2-browser" aria-label="Media">
      <div className="v2-panel-head">
        <strong>Media</strong>
        <button className="v2-btn primary" onClick={() => fileRef.current?.click()}><Ic g="＋" size={16} /> Import</button>
        <button className="v2-btn" title="Add an HTML clip (example uses three.js) (edit the .html and re-import to change it)" onClick={() => void onFiles([new File([THREE_TEMPLATE], "three-scene.html", { type: "text/html" })])}><Ic g="＋" size={16} /> HTML clip</button>
        {mobile && <SheetDone onClick={() => setSheet(false)} />}
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
      {fileInputs}
    </section>
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
      ...(isText ? [tool("T", "Edit text", () => setTextOpen(true), "edit-text", "Templates, font, style, effects, animation"), tool("anim", "Animation", () => setAnimOpen(true), "anim", "In, out and loop animations"), tool("≡", "Subtitles", () => openSubs(selected.track.id, selected.placement.id), "subs-list", "Open this layer's subtitle list at this clip")] : []),
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

  // ───────────── V2-106 desktop shell ─────────────
  const DEFAULT_ACCEPT = "video/*,image/*,audio/*,.html,.htm,text/html";
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
    const data = template ? textDomain.TEXT_TEMPLATES.find((t) => t.id === template)?.data : undefined;
    if (engine.dispatch(cmd.addTextClip(Math.round(at), data ?? {}, id))) { setSel([id]); setSubId(undefined); }
  };
  const addStickerAt = async (st: Sticker, at: number) => {
    try {
      const asset = await importFile(await stickerFile(st), storage.blobs);
      if (asset) engine.dispatch([cmd.importAsset(asset), cmd.addAssetsInSequence([asset.id], Math.round(at), newId("trk"), "text")], "Add sticker");
    } catch { setToast("Could not add that sticker"); }
  };
  const addEffectAt = (preset: string, at: number) => { const id = newId("plc"); if (engine.dispatch(cmd.addEffectClip(Math.round(at), preset, undefined, id))) setSel([id]); };
  const addLibraryAt = async (it: LibraryItem, at: number, trackId?: string) => {
    if (it.id === "text") return addTextAt(at);
    const f = libraryFile(it);
    if (f) await importAt([f], Math.round(at), trackId);
  };
  const onDropData = (dt: DataTransfer, at: number, trackId?: string) => {
    const it = readDragItem(dt);
    if (it?.kind === "text") addTextAt(at, it.template);
    else if (it?.kind === "effect") addEffectAt(it.id, at);
    else if (it?.kind === "sticker") { const st = stickers().find((x) => x.id === it.id); if (st) void addStickerAt(st, at); }
    else if (it?.kind === "library") { const li = LIBRARY_ITEMS.find((x) => x.id === it.id); if (li) void addLibraryAt(li, at, trackId); }
    else if (dt.files?.length) void importAt(Array.from(dt.files), at, trackId);
  };
  const assetBrowser = (
    <AssetBrowser project={project} thumbs={thumbs} busy={busy} tab={btab} onTab={setBtab}
      onImport={importDialog} onFiles={(fs) => void onFiles(fs)} onAddAsset={addToTimeline} onRemoveAsset={(a) => engine.dispatch(cmd.removeAsset(a.id))}
      onAddText={(tp) => addTextAt(player.time, tp)} onImportSrt={() => srtRef.current?.click()}
      onAddSticker={(st) => void addStickerAt(st, player.time)} onAddEffect={(id) => addEffectAt(id, player.time)}
      onAddTransition={addTransitionNearPlayhead} onAddLibrary={(it) => void addLibraryAt(it, player.time)} />
  );
  useEffect(() => { setItab(preferTab.current); preferTab.current = undefined; }, [selectedId]);
  const fpsNow = project.settings.fps;
  const clipName = (p: NonNullable<typeof selected>["placement"]) => p.clipType === "text" ? (p.text?.text?.split("\n")[0] || "Text") : p.clipType === "effect" ? `Effect · ${p.effect?.preset ?? ""}` : project.assets[p.source.assetId]?.name ?? p.clipType;
  const KIND_ICON: Record<string, string> = { video: "▭", image: "image", audio: "♫", text: "T", html: "</>", effect: "effect" };
  const volumeRow = (pl: NonNullable<typeof selected>["placement"]) => (
    <label className="v2-insp-row"><span>Volume</span>
      <input type="range" min={0} max={1} step={0.05} value={pl.volume ?? 1} aria-label="Volume" onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()} onChange={(e) => engine.dispatch(cmd.setPlacementVolume(pl.id, Number(e.target.value)))} />
      <output>{Math.round((pl.volume ?? 1) * 100)}%</output><span />
    </label>
  );
  const actionList = (list: { icon: string; label: string; title: string; run: () => void }[]) => (
    <div className="v2-insp-actions">{list.map((a) => <button key={a.label} className="v2-btn" title={a.title} onClick={a.run}><Ic g={a.icon} size={16} /> {a.label}</button>)}</div>
  );
  const inspectorTabs = (): { icon: string; title: string; subtitle?: string; tabs: InspectorTab[]; actions?: JSX.Element; onDone?: () => void } => {
    if (sel.length > 1) return { icon: "☑", title: `${sel.length} clips`, onDone: () => selectClip(undefined), tabs: [{ id: "multi", label: "Selection", render: () => <div className="v2-psettings">
      <p className="v2-sel-count" role="status">{sel.length} selected</p>
      {actionList([{ icon: "🗑", label: ripple ? "Ripple delete all" : "Delete all", title: "Delete every selected clip (Del)", run: () => delSel() }, ...clipActions.map((a) => ({ ...a, label: `${a.label} all` }))])}
      <p className="v2-abnote">Shift-click clips on the timeline to add or remove them from the selection.</p></div> }] };
    if (subsTrack && !selected) return { icon: "≡", title: "Edit subtitles", subtitle: subsTrack.name, onDone: () => setSubsEdit(undefined), tabs: [{ id: "subs", label: "Subtitles", render: () => <SubtitleList engine={engine} track={subsTrack} time={time} playing={playing} onSeek={seek} desktop name={project.name} focusCue={subsCue} /> }] };
    if (layerTrack && !selected) return { icon: "layers", title: "Edit all", subtitle: layerTrack.name, onDone: () => setLayerEdit(undefined), tabs: [{ id: "layer", label: "Layer style", render: () => <TextPanel key={layerTrack.id} engine={engine} layer={layerTrack} initialTab="Style" /> }] };
    if (cue && !selected) return { icon: "≡", title: "Subtitle", onDone: () => setSubId(undefined), tabs: [{ id: "cue", label: "Subtitle", render: () => <SubtitleEditor engine={engine} sub={cue} onDelete={delCue} /> }] };
    if (!selected) return { icon: "settings", title: "Project", subtitle: `${project.settings.width}×${project.settings.height} · ${fpsNow} fps`, tabs: [{ id: "project", label: "Project", render: () => <ProjectSettings engine={engine} project={project} extra={textLayers.length ? <section aria-label="Subtitles"><h4>Subtitles</h4>{actionList([{ icon: "≡", label: "Edit subtitles", title: "Edit every subtitle in a list: text, timing, split, merge, find & replace", run: editSubtitles }, { icon: "⇩", label: "Export SRT", title: "Download subtitles as .srt", run: exportSrt }])}</section> : undefined} /> }] };
    const pl = selected.placement, kind = pl.clipType;
    const sub = `${formatTimecode(pl.startTicks, fpsNow).slice(0, 8)} · ${(pl.durationTicks / 120000).toFixed(1)}s`;
    const base = { icon: KIND_ICON[kind] ?? "▭", title: clipName(pl), subtitle: sub, onDone: () => setSelectedId(undefined) };
    const transform: InspectorTab = { id: "basic", label: "Basic", icon: "⤧", render: () => <TransformInspector engine={engine} placement={pl} time={time} /> };
    const speedTab: InspectorTab = { id: "speed", label: "Speed", icon: "⏩", render: () => <div className="v2-psettings">
      <section aria-label="Speed"><h4>Speed</h4>
        <div className="v2-seg" role="radiogroup" aria-label="Speed">{SPEEDS.map((x) => <button key={x} role="radio" aria-checked={(pl.speed ?? 1) === x} className={`v2-seg-btn ${(pl.speed ?? 1) === x ? "is-active" : ""}`} title={x === 1 ? "Normal speed" : `${x}× — changes the clip's length`} onClick={() => engine.dispatch(cmd.setSpeed(pl.id, x))}>{x}×</button>)}</div>
      </section>
      {timeActions.length > 0 && <section aria-label="Time"><h4>Time</h4>{actionList(timeActions)}</section>}
    </div> };
    const audioTab: InspectorTab = { id: "audio", label: "Audio", icon: "🔊", render: () => <div className="v2-psettings">
      <section aria-label="Volume"><h4>Volume</h4>{volumeRow(pl)}</section>
      {kind === "audio" && <TransformInspector engine={engine} placement={pl} time={time} />}
      {linkedAudioActions.length > 0 && <section aria-label="Clip audio"><h4>Clip audio</h4>{actionList(linkedAudioActions)}</section>}
      <section aria-label="Track"><h4>Track</h4>{actionList([{ icon: selected.track.muted ? "🔈" : "🔇", label: selected.track.muted ? "Unmute track" : "Mute track", title: "Silence the whole track", run: () => engine.dispatch(cmd.toggleTrackMute(selected.track.id)) }])}</section>
    </div> };
    const transTab: InspectorTab | undefined = transitionTools ? { id: "transition", label: "Transition", icon: "⧓", render: () => <div className="v2-psettings"><section aria-label="Transition in"><h4>Transition in</h4>{transitionTools}</section></div> } : undefined;
    if (kind === "text") return { ...base, actions: <>
      {selTrack?.layerStyle && <button className="v2-btn v2-btn-sm" title={`Style every clip on ${selTrack.name}`} onClick={() => editLayer(selTrack.id)}><Ic g="layers" size={14} /> Edit all</button>}
      <button className="v2-btn v2-btn-sm" title="Open this layer's subtitle list at this clip" onClick={() => openSubs(selected.track.id, pl.id)}><Ic g="≡" size={14} /> Subtitles</button>
    </>, tabs: [{ id: "text", label: "Text", icon: "T", render: () => <TextPanel engine={engine} placement={effSel} track={selTrack} onAnimPicked={() => setAnimLoop(true)} initialTab="Font" /> }, { ...transform, label: "Transform" }] };
    if (kind === "effect") return { ...base, tabs: [{ id: "effect", label: "Effect", icon: "effect", render: () => <EffectPicker engine={engine} at={time} placement={pl} /> }] };
    if (kind === "audio") return { ...base, tabs: [audioTab, ...(speedSelect ? [speedTab] : [])] };
    if (kind === "html") return { ...base, actions: <button className="v2-btn v2-btn-sm" title="Edit HTML, CSS and JS with live preview" onClick={() => void openCode()}><Ic g="</>" size={14} /> Edit code</button>, tabs: [transform, ...(transTab ? [transTab] : [])] };
    if (kind === "image") return { ...base, tabs: [transform, ...(transTab ? [transTab] : [])] };
    return { ...base, tabs: [transform, ...(speedSelect || timeActions.length ? [speedTab] : []), audioTab, ...(transTab ? [transTab] : [])] };
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
      {iconBtn("📋", "Paste", paste, { title: hasClip ? "Paste at the playhead (⌘/Ctrl+V)" : "Copy a clip first", disabled: !hasClip })}
      {iconBtn("❄", "Freeze", () => { if (sp) { engine.dispatch(cmd.freezeFrame(sp.id, Math.round(player.time))); setToast("Freeze frame inserted (3 s)"); } }, { title: "Freeze the frame under the playhead for 3 s (F)", disabled: !(sp && sp.clipType === "video" && !sp.freeze) })}
      <span className="v2-dsep" aria-hidden />
      <button className="v2-dtool v2-dtool-text" title="Add an empty video (overlay) track" onClick={() => engine.dispatch(cmd.addTrack("video"))}><Ic g="▭" size={16} /><span>Video track</span></button>
      <button className="v2-dtool v2-dtool-text" title="Add an empty audio track" onClick={() => engine.dispatch(cmd.addTrack("audio"))}><Ic g="♫" size={16} /><span>Audio track</span></button>
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
      { label: "Paste here", icon: "📋", shortcut: k("V"), disabled: !hasClip, onSelect: () => { seek(ctx.ticks); const ids = clipboard.current.map(() => newId("plc")); engine.dispatch(cmd.pasteClips(clipboard.current, Math.round(ctx.ticks), ids)); setSel(ids); } },
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
    return [
      { label: "Split at playhead", icon: "✂", shortcut: "S", disabled: !inside || sel.length > 1, onSelect: () => engine.dispatch(cmd.splitPlacement(p.id, t)) },
      "sep",
      { label: `Copy${many}`, icon: "⎘", shortcut: k("C"), onSelect: copy },
      { label: `Cut${many}`, icon: "✂", shortcut: k("X"), onSelect: cut },
      { label: "Paste at playhead", icon: "📋", shortcut: k("V"), disabled: !hasClip, onSelect: paste },
      { label: `Duplicate${many}`, icon: "⧉", shortcut: k("D"), onSelect: duplicate },
      ...(p.clipType === "video" && !p.freeze && sel.length === 1 ? [{ label: "Freeze frame", icon: "❄", shortcut: "F", disabled: !inside, onSelect: () => { engine.dispatch(cmd.freezeFrame(p.id, t)); setToast("Freeze frame inserted (3 s)"); } }] : []),
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
      <div className="v2-canvas-wrap"><canvas ref={canvasRef} width={canvasSize.width} height={canvasSize.height} onClick={onCanvasTap} title={mobile ? "Tap an element to select it · tap empty space to play/pause" : "Click an element to select it · click empty space to play/pause"} />
        {visual && player.boxes.get(visual.id) && canvasRef.current && <TransformHandles engine={engine} placement={visual} time={time} box={player.boxes.get(visual.id)!} canvas={canvasRef.current} actions={gizmo} route={layerRoute} snapping={snapOn} others={[...player.boxes].filter(([id]) => id !== visual.id).map(([, b]) => b)} />}
        {inlineEditor}
        {!mobile && visual && scopeChip}
      </div>
      {!mobile && desktopTransport}
    </section>
  );
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
        <header className="v2-header v2-dheader">
          <a className="v2-back" href={window.location.pathname} title="Back to classic editor">‹ Classic</a>
          <button className="v2-dtool" aria-label={lay.leftOpen ? "Hide asset panel" : "Show asset panel"} title={lay.leftOpen ? "Hide asset panel" : "Show asset panel"} aria-pressed={lay.leftOpen} onClick={() => togglePanel("leftOpen")}><Ic g={lay.leftOpen ? "panel-close" : "panel-open"} size={18} /></button>
          <button className="v2-btn v2-projects-btn" aria-label="Projects" title="Projects: new, open, rename, delete" onClick={() => setProjects(true)}><Ic g="☰" size={16} /> Projects</button>
          <input className="v2-title" value={project.name} aria-label="Project name" title="Rename project" onFocus={() => engine.beginGesture()} onBlur={() => engine.endGesture()} onChange={(e) => engine.dispatch(cmd.renameProject(e.target.value))} />
          <span className="v2-badge">v2 preview</span>
          <span className="v2-spacer" />
          <span className="v2-dgroup">
            <button className="v2-dtool" aria-label="Undo" title="Undo (⌘/Ctrl+Z)" disabled={!canUndo} onClick={() => engine.undo()}><Ic g="↶" size={18} /></button>
            <button className="v2-dtool" aria-label="Redo" title="Redo (⇧⌘Z / Ctrl+Y)" disabled={!canRedo} onClick={() => engine.redo()}><Ic g="↷" size={18} /></button>
          </span>
          <button className="v2-dtool" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setKbdOpen(true)}><Ic g="keyboard" size={18} /></button>
          <button className="v2-dtool" aria-label={lay.rightOpen ? "Hide inspector" : "Show inspector"} title={lay.rightOpen ? "Hide inspector" : "Show inspector"} aria-pressed={lay.rightOpen} onClick={() => togglePanel("rightOpen")}><Ic g={lay.rightOpen ? "panel-r-close" : "panel-r-open"} size={18} /></button>
          <button className="v2-btn primary v2-export-d" title="Export MP4 (⌘/Ctrl+E)" onClick={openExport}><Ic g="⇪" size={16} /> Export</button>
        </header>
      )}
      {notice && <RecoveryNotice failure={notice} storage={storage} onDismiss={() => setNotice(undefined)} />}
      {projects && <ProjectsDialog storage={storage} current={project} onOpen={(id) => { setProjects(false); onSwitch(id); }} onRenameCurrent={(n) => engine.dispatch(cmd.renameProject(n))} onClose={() => setProjects(false)} />}
      {exporting && <ExportDialog project={project} blobs={storage.blobs} res={res} onRes={setRes} onClose={() => setExporting(false)} />}
      {htmlEdit && <HtmlEditor source={htmlEdit.source} mobile={mobile} onSave={(h) => void saveCode(h)} onClose={() => setHtmlEdit(undefined)} />}
      {subsPick && <div className="v2-menu-backdrop v2-confirm-backdrop" onPointerDown={() => setSubsPick(false)}>
        <div className="v2-confirm v2-subs-pick" role="dialog" aria-modal="true" aria-label="Choose a text layer" onPointerDown={(e) => e.stopPropagation()}>
          <h4>Edit subtitles</h4><p>Which text layer?</p>
          {textLayers.map((t) => <button key={t.id} className="v2-btn v2-subs-pick-row" onClick={() => openSubs(t.id)}><Ic g="≡" size={16} /><span className="v2-subs-pick-name"><b>{t.name}</b><em>{(() => { const c = cueLayer.cuesOf(t); const f = c[0]?.text.replace(/\s+/g, " ") ?? ""; return `${f.length > 24 ? f.slice(0, 24) + "…" : f} · ${c.length} line${c.length === 1 ? "" : "s"}`; })()}</em></span></button>)}
          <div className="v2-confirm-actions"><button className="v2-btn" onClick={() => setSubsPick(false)}>Cancel</button></div>
        </div>
      </div>}
      {!mobile && <DesktopTooltips />}
      {!mobile && kbdOpen && <ShortcutsOverlay onClose={() => setKbdOpen(false)} />}
      {!mobile && ctx && <ContextMenu x={ctx.x} y={ctx.y} label={ctx.placementId ? "Clip actions" : "Track actions"} items={ctxItems()} onClose={() => setCtx(undefined)} />}
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
          <PanelGrabber vh={previewVh} onChange={setPreviewVh} target={() => document.querySelector<HTMLElement>(".v2-app.is-mobile .v2-preview")} />
          <Timeline focus={focusGroup} engine={engine} project={project} time={time} playing={playing} onSeek={seek} selectedId={selectedId} selectedIds={sel} onToggleSelect={toggleClip} multiMode={multiMode} onSelect={selectClip} peaks={peaks} strips={strips} pps={pps} onZoom={(z) => setPps(clampPps(z))} centered topLane={topLane} ripple={ripple} onTransition={onTransition} onEditSubs={openSubs} onEditLayer={editLayer} expanded={expanded} onExpand={onExpand}
            thumbs={thumbs} onAddMedia={() => setPicker("main")}
            timeLabel={<><b>{formatTimecode(time, project.settings.fps).slice(0, 5)}</b> / {formatTimecode(duration, project.settings.fps).slice(0, 5)}</>}
            sideColumn={<>
              {firstVideoTrack && <button className="v2-side-btn" onClick={() => engine.dispatch(cmd.toggleTrackMute(firstVideoTrack.id))}><b aria-hidden><Ic g={firstVideoTrack.muted ? "🔇" : "🔊"} /></b><span>{firstVideoTrack.muted ? "Unmute clip audio" : "Mute clip audio"}</span></button>}
              <button className="v2-side-btn v2-cover" onClick={() => seek(0)} style={firstClip && thumbs[firstClip.source.assetId] ? { backgroundImage: `url(${thumbs[firstClip.source.assetId]})` } : undefined}><span>Cover</span></button>
            </>} />
          <nav ref={toolbarFade} className="v2-toolbar" aria-label={selected ? "Clip actions" : "Timeline actions"}>
            {(activeMenu !== "root" || expanded) && <button className="v2-tool v2-tool-back" aria-label={activeMenu === "root" && expanded ? `Collapse ${ops.GROUP_LABEL[expanded]}` : "Back"} title={activeMenu === "root" && expanded ? `Collapse ${ops.GROUP_LABEL[expanded]}` : "Back"} onClick={back}>‹</button>}
            {mobileTools[activeMenu]}
          </nav>
          {picker && <MediaPicker media={projectMedia} title={picker === "overlay" ? "Add overlay" : picker === "audio" ? "Add audio" : picker === "stickers" ? "Add stickers" : "Add media"} only={picker === "audio" ? "audio" : undefined} initialTab={picker === "stickers" ? "stickers" : undefined} onClose={() => setPicker(null)} onAdd={(p) => void addPicked(p, picker === "overlay" || picker === "stickers" ? "overlay" : "main")} />}
          {sheet && <Sheet label="Media" head={false} onClose={() => setSheet(false)}>{browser}</Sheet>}
          {!sheet && <div hidden>{browser}</div>}
          {cue && <div className="v2-msub"><SubtitleEditor engine={engine} sub={cue} onDelete={delCue} /></div>}
          {inspOpen && selected && <Sheet label="Adjust" className="v2-msheet-insp" extra={scopeChip || undefined} onClose={() => setInspOpen(false)}><TransformInspector engine={engine} placement={selected.placement} time={time} /></Sheet>}
          {subsTrack && <Sheet label="Edit subtitles" className="v2-msheet-tall" head={false} onClose={() => setSubsEdit(undefined)}><SubtitleList engine={engine} track={subsTrack} time={time} playing={playing} onSeek={seek} desktop={false} name={project.name} focusCue={subsCue} onDone={() => setSubsEdit(undefined)} /></Sheet>}
          {layerTrack && !selected && <Sheet label={`Edit all · ${layerTrack.name}`} className="v2-msheet-insp" onClose={() => setLayerEdit(undefined)}><TextPanel key={layerTrack.id} engine={engine} layer={layerTrack} initialTab="Style" /></Sheet>}
          {textOpen && selected && isText && <Sheet label="Text" className="v2-msheet-insp" snapTo={animLoop ? 0 : undefined} extra={scopeChip || undefined} onClose={closeAnim}><TextPanel engine={engine} placement={effSel} track={selTrack} onAnimPicked={() => setAnimLoop(true)} /></Sheet>}
          {fxOpen && <Sheet label="Effects" className="v2-msheet-insp" onClose={() => setFxOpen(false)}><EffectPicker engine={engine} at={time} placement={isEffect ? selected!.placement : undefined} onAdded={(id) => setSel([id])} onClose={() => setFxOpen(false)} /></Sheet>}
          {animOpen && !textOpen && selected && isText && <Sheet label="Animation" className="v2-msheet-insp v2-anim-sheet" snapTo={animLoop ? 0 : undefined} extra={scopeChip || undefined} onClose={closeAnim}><AnimationPicker engine={engine} placement={selected.placement} onPicked={() => setAnimLoop(true)} /></Sheet>}
        </>
      ) : (
        <div className="v2-dshell" style={{ gridTemplateColumns: `${lay.leftOpen ? lay.left : 0}px ${lay.leftOpen ? 5 : 0}px minmax(0,1fr) ${lay.rightOpen ? 5 : 0}px ${lay.rightOpen ? lay.right : 0}px`, gridTemplateRows: `minmax(0,1fr) 5px ${lay.timeline}px` }}>
          {fileInputs}
          {lay.leftOpen && <div className="v2-dpane v2-dpane-left">{assetBrowser}</div>}
          {lay.leftOpen && <Splitter label="Resize asset panel" value={lay.left} dir="right" min={LIMITS.left[0]} max={LIMITS.left[1]} onChange={(v) => resize({ left: v })} onCommit={commitSizes} onReset={() => { resize({ left: DEFAULT_SIZES.left }); commitSizes(); }} />}
          <div className="v2-dpane v2-dpane-center">{preview}</div>
          {lay.rightOpen && <Splitter label="Resize inspector" value={lay.right} dir="left" min={LIMITS.right[0]} max={LIMITS.right[1]} onChange={(v) => resize({ right: v })} onCommit={commitSizes} onReset={() => { resize({ right: DEFAULT_SIZES.right }); commitSizes(); }} />}
          {lay.rightOpen && insp && <div className="v2-dpane v2-dpane-right"><Inspector key={insp.title === "Project" ? "project" : selectedId ?? insp.title} {...insp} tab={itab} onTab={setItab} /></div>}
          <div className="v2-dsplit-h"><Splitter label="Resize timeline" value={lay.timeline} dir="up" min={LIMITS.timeline[0]} max={LIMITS.timeline[1]} onChange={(v) => resize({ timeline: v })} onCommit={commitSizes} onReset={() => { resize({ timeline: DEFAULT_SIZES.timeline }); commitSizes(); }} /></div>
          <section className="v2-timeline-panel v2-dtimeline" aria-label="Timeline">
            {desktopToolbar}
            <Timeline focus={focusGroup} onFocusGroup={(g) => { setSel([]); setMenu(g && g !== "main" ? g : "root"); }} engine={engine} project={project} time={time} playing={playing} onSeek={seek} selectedId={selectedId} selectedIds={sel} onToggleSelect={toggleClip} multiMode={multiMode} onSelect={selectClip} peaks={peaks} strips={strips} pps={pps} onZoom={(z) => setPps(clampPps(z))} centered={false} topLane={topLane} ripple={ripple} onTransition={onTransition} onEditSubs={openSubs} onEditLayer={editLayer} onDropData={onDropData} onContextMenu={openCtx} />
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


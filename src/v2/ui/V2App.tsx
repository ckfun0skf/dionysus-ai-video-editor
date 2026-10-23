import { useCallback, useEffect, useRef, useState } from "react";
import { Player, THREE_TEMPLATE } from "../render";
import { cmd } from "../engine";
import { importFile } from "../persistence";
import { compositionDuration, edit, transitions, findPlacement, newId, formatTimecode, secondsToTicks, type Asset } from "../domain";
import { useEditorBoot, useEngineState, useIsMobile, type EditorContext, type LoadFailure } from "./useEditor";
import { Timeline } from "./Timeline";
import { clampPps } from "./gestures";
import { useThumbs } from "./useThumbs";
import { useMediaPreviews } from "./useMedia";
import { TransformHandles, TransformInspector } from "./Transform";
import { ExportDialog } from "./ExportDialog";
import { ProjectsDialog } from "./Projects";
import type { Resolution } from "../render";
import { addCueAt, downloadSrt, importSrtFile, SubtitleEditor, SubtitleLane } from "./Subtitles";

type Menu = "multi" | "root" | "edit" | "edit-hint" | "audio" | "zoom" | "speed" | "text";
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
  const [busy, setBusy] = useState(0);
  const [menu, setMenu] = useState<Menu>("root");
  const [res, setRes] = useState<Resolution>("1080p");
  const [exporting, setExporting] = useState(false);
  const [projects, setProjects] = useState(false);
  const openExport = () => { player.pause(); setExporting(true); };
  const [fs, setFs] = useState(false);
  const [toast, setToast] = useState<string>();
  const [inspOpen, setInspOpen] = useState(false);
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
  const delSel = (rippleOverride?: boolean) => { if (sel.length) { engine.dispatch(cmd.deleteClips(sel, rippleOverride ?? ripple)); setSel([]); setMultiMode(false); } };
  const onTransition = (id: string) => {
    const p = findPlacement(comp, id)?.placement;
    if (p && !p.transitionIn) { engine.dispatch(cmd.setTransition(id, { kind: "crossfade", durationTicks: transitions.DEFAULT_TRANSITION_TICKS })); setToast("Crossfade added (Undo to remove)"); }
    setSel([id]); setSubId(undefined);
  };
  const selectCue = (id?: string) => { setSubId(id); if (id) setSelectedId(undefined); };
  const addText = () => { const id = addCueAt(engine, player.time); if (id) selectCue(id); else setToast("There is already text at the playhead"); };
  const delCue = () => { if (subId) { engine.dispatch(cmd.removeSubtitle(subId)); setSubId(undefined); } };
  const onSrt = async (f?: File) => { if (!f) return; const n = await importSrtFile(engine, f); setToast(n ? `Imported ${n} subtitles (Undo to revert)` : `${f.name}: no subtitles found`); };
  const exportSrt = () => (cues.length ? downloadSrt(cues, project.name) : setToast("No subtitles to export — add text first"));
  const topLane = cues.length ? { label: "Text", render: (toPx: (t: number) => number, toTicks: (px: number) => number) => <SubtitleLane engine={engine} list={cues} selectedId={subId} onSelect={selectCue} toPx={toPx} toTicks={toTicks} /> } : undefined;
  const textTools = [
    { icon: "T", label: "Add text", title: "Add a subtitle at the playhead (T)", run: addText },
    { icon: "⇪", label: "Import SRT", title: "Replace subtitles with an .srt file", run: () => srtRef.current?.click() },
    { icon: "⇩", label: "Export SRT", title: "Download subtitles as .srt", run: exportSrt },
  ];
  const visual = selected && selected.placement.clipType !== "audio" ? selected.placement : undefined;

  if (!playerRef.current) playerRef.current = new Player(project, storage.blobs);
  const player = playerRef.current;
  useEffect(() => { player.onTime = (t, p) => { setTime(t); setPlaying(p); setFrame((f) => f + 1); }; return () => player.dispose(); }, [player]);
  useEffect(() => { player.canvas = canvasRef.current ?? undefined; player.draw(); }, [player, mobile]);
  useEffect(() => { player.setProject(project); }, [player, project]);
  useEffect(() => { const live = sel.filter((id) => allIds.includes(id)); if (live.length !== sel.length) setSel(live); });
  useEffect(() => { if (subId && !cue) setSubId(undefined); }, [subId, cue]);

  const seek = useCallback((t: number) => player.seek(t), [player]);
  const togglePlay = useCallback(() => (player.isPlaying ? player.pause() : player.play()), [player]);
  const split = useCallback(() => { if (selectedId) engine.dispatch(cmd.splitPlacement(selectedId, Math.round(player.time))); }, [engine, player, selectedId]);
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
  const addToTimeline = (a: Asset) => { engine.dispatch(cmd.addAssetToTimeline(a.id, mobile ? player.time : duration)); if (mobile) setSheet(false); };

  const browser = (
    <section className="v2-browser" aria-label="Media">
      <div className="v2-panel-head">
        <strong>Media</strong>
        <button className="v2-btn primary" onClick={() => fileRef.current?.click()}>＋ Import</button>
        <button className="v2-btn" title="Add an HTML/three.js clip (edit the .html and re-import to change it)" onClick={() => void onFiles([new File([THREE_TEMPLATE], "three-scene.html", { type: "text/html" })])}>＋ HTML clip</button>
        {mobile && <button className="v2-btn" onClick={() => setSheet(false)}>Done</button>}
      </div>
      {busy > 0 && <p className="v2-hint">Importing {busy}…</p>}
      {Object.values(project.assets).length === 0 && <p className="v2-hint">Import video, image, audio or HTML files, then {mobile ? "tap" : "drag or click"} ＋ to add them to the timeline.</p>}
      <ul className="v2-assets">
        {Object.values(project.assets).map((a) => (
          <li key={a.id} draggable onDragStart={(e) => e.dataTransfer.setData("application/x-dionysus-asset", a.id)} className={`v2-asset kind-${a.kind}`}>
            <AssetThumb asset={a} engineBlobs={storage.blobs} />
            <span className="v2-asset-name" title={a.name}>{a.name}</span>
            <small>{a.kind}{a.versions[0]?.media.durationTicks ? ` · ${formatTimecode(a.versions[0].media.durationTicks, project.settings.fps).slice(0, 5)}` : ""}</small>
            <button className="v2-btn" aria-label={`Add ${a.name} to timeline`} onClick={() => addToTimeline(a)}>＋</button>
            <button className="v2-icon" aria-label={`Remove ${a.name}`} onClick={() => engine.dispatch(cmd.removeAsset(a.id))}>✕</button>
          </li>
        ))}
      </ul>
      <input ref={fileRef} type="file" hidden multiple accept="video/*,image/*,audio/*,.html,.htm,text/html" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
      <input ref={srtRef} type="file" hidden accept=".srt,.vtt,text/plain" aria-label="Import SRT file" onChange={(e) => { void onSrt(e.target.files?.[0]); e.target.value = ""; }} />
    </section>
  );

  const transport = (
    <div className="v2-transport">
      <button className="v2-icon" aria-label="Undo" disabled={!canUndo} onClick={() => engine.undo()}>↶</button>
      <button className="v2-icon" aria-label="Redo" disabled={!canRedo} onClick={() => engine.redo()}>↷</button>
      <button className="v2-icon" aria-label="Go to start" onClick={() => seek(0)}>⏮</button>
      <button className="v2-play" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
      <span className="v2-time">{formatTimecode(time, project.settings.fps)} / {formatTimecode(duration, project.settings.fps)}</span>
    </div>
  );

  const rippleToggle = (
    <button key="ripple" className={`v2-tool ${ripple ? "is-active" : ""}`} aria-pressed={ripple} title="Ripple: delete and trim move later clips to close gaps (R)" onClick={() => setRipple(!ripple)}><b aria-hidden>⇤</b><span>Ripple {ripple ? "on" : "off"}</span></button>
  );

  const clipActions = [
    { icon: "⧉", label: "Duplicate", title: "Duplicate after the selection (⌘/Ctrl+D)", run: duplicate },
    { icon: "⎘", label: "Copy", title: "Copy (⌘/Ctrl+C) — paste at the playhead with ⌘/Ctrl+V", run: copy },
  ];
  const pasteAction = { icon: "📋", label: "Paste", title: hasClip ? "Paste at the playhead (⌘/Ctrl+V)" : "Copy a clip first", run: paste };
  const multiBar = sel.length > 1 ? (
    <>
      <span className="v2-sel-count" role="status">{sel.length} selected</span>
      <button className="v2-tool" title={ripple ? "Delete all and close gaps (Del)" : "Delete all (Del)"} onClick={() => delSel()}><b>🗑</b><span>{ripple ? "Ripple delete" : "Delete"}</span></button>
      {clipActions.map((a) => <button key={a.label} className="v2-tool" title={a.title} onClick={a.run}><b aria-hidden>{a.icon}</b><span>{a.label}</span></button>)}
      <button className="v2-tool" title="Clear selection (Esc)" onClick={() => selectClip(undefined)}><b>✓</b><span>Done</span></button>
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
  const speedSelect = sp && sp.clipType !== "image" && !sp.freeze ? (
    <label className="v2-tool" title="Playback speed — changes the clip's length"><b aria-hidden>⏩</b>
      <select aria-label="Speed" value={sp.speed ?? 1} onChange={(e) => engine.dispatch(cmd.setSpeed(sp.id, Number(e.target.value)))}>
        {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
    </label>
  ) : null;

  const trIn = sp?.transitionIn;
  const transitionTools = sp && trIn ? (
    <span className="v2-trans-tools" role="group" aria-label="Transition">
      <b aria-hidden>{transitions.TRANSITIONS[trIn.kind].icon}</b>
      {transitions.TRANSITION_LENGTHS.map((d) => (
        <button key={d} className={`v2-tool ${trIn.durationTicks === d ? "is-active" : ""}`} aria-pressed={trIn.durationTicks === d} title={`Crossfade length ${d / 120000}s`} onClick={() => engine.dispatch(cmd.setTransition(sp.id, { kind: trIn.kind, durationTicks: d }))}><span>{d / 120000}s</span></button>
      ))}
      <button className="v2-tool" title="Remove the transition into this clip" onClick={() => engine.dispatch(cmd.setTransition(sp.id, undefined))}><b aria-hidden>✕</b><span>No transition</span></button>
    </span>
  ) : null;

  const selectionActions = multiBar ?? (selected ? (
    <>
      {transitionTools}
      <button className="v2-tool" onClick={split}><b>✂</b><span>Split</span></button>
      <button className="v2-tool" title={ripple ? "Delete and close the gap (Del)" : "Delete (Del) · Shift+Del ripple delete"} onClick={() => del()}><b>🗑</b><span>{ripple ? "Ripple delete" : "Delete"}</span></button>
      {speedSelect}
      {[...clipActions, ...timeActions, ...linkedAudioActions].map((a) => <button key={a.label} className="v2-tool" title={a.title} onClick={a.run}><b aria-hidden>{a.icon}</b><span>{a.label}</span></button>)}
      {selected.placement.clipType !== "image" && selected.placement.clipType !== "html" && (
        <label className="v2-tool v2-volume"><b>🔊</b>
          <input type="range" min={0} max={1} step={0.05} value={selected.placement.volume ?? 1} aria-label="Volume" onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()} onChange={(e) => engine.dispatch(cmd.setPlacementVolume(selected.placement.id, Number(e.target.value)))} />
        </label>
      )}
      <button className="v2-tool" onClick={() => engine.dispatch(cmd.toggleTrackMute(selected.track.id))}><b>{selected.track.muted ? "🔈" : "🔇"}</b><span>{selected.track.muted ? "Unmute track" : "Mute track"}</span></button>
      {rippleToggle}
      <button className="v2-tool" onClick={() => setSelectedId(undefined)}><b>✓</b><span>Done</span></button>
    </>
  ) : (
    <>
      <button className="v2-tool" onClick={() => (mobile ? setSheet(true) : fileRef.current?.click())}><b>＋</b><span>Media</span></button>
      <button className="v2-tool" onClick={() => engine.dispatch(cmd.addTrack("video"))}><b>▭</b><span>Video track</span></button>
      <button className="v2-tool" onClick={() => engine.dispatch(cmd.addTrack("audio"))}><b>♫</b><span>Audio track</span></button>
      {textTools.map((a) => <button key={a.label} className="v2-tool" title={a.title} onClick={a.run}><b aria-hidden>{a.icon}</b><span>{a.label}</span></button>)}
      {rippleToggle}
      <button className="v2-tool" onClick={() => setPps((p) => Math.min(400, p * 1.5))}><b>＋</b><span>Zoom in</span></button>
      <button className="v2-tool" onClick={() => setPps((p) => Math.max(4, p / 1.5))}><b>－</b><span>Zoom out</span></button>
      <button className="v2-tool" title={pasteAction.title} disabled={!hasClip} onClick={paste}><b aria-hidden>📋</b><span>Paste</span></button>
    </>
  ));

  const preview = (
    <section className="v2-preview" aria-label="Preview">
      <div className="v2-canvas-wrap"><canvas ref={canvasRef} width={1280} height={720} onClick={togglePlay} />
        {visual && player.boxes.get(visual.id) && canvasRef.current && <TransformHandles engine={engine} placement={visual} time={time} box={player.boxes.get(visual.id)!} canvas={canvasRef.current} />}
      </div>
      {!mobile && transport}
    </section>
  );

  const firstVideoTrack = comp.tracks.find((t) => t.kind === "video");
  const firstClip = firstVideoTrack?.placements[0];
  const fullscreen = () => {
    const el = canvasRef.current?.parentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el?.requestFullscreen) void el.requestFullscreen().catch(() => setFs((f) => !f));
    else setFs((f) => !f);
  };
  const activeMenu: Menu = multiMode || sel.length > 1 ? "multi" : selected ? (menu === "speed" ? "speed" : "edit") : menu === "speed" ? "root" : cue ? "text" : menu;
  const back = () => { if (multiMode || sel.length > 1) selectClip(undefined); else if (selected && menu !== "speed") setSelectedId(undefined); else { setSubId(undefined); setMenu("root"); } };
  const tool = (icon: string, label: string, onClick: () => void, key = label, title?: string) => (
    <button key={key} className="v2-tool" title={title} onClick={onClick}><b aria-hidden>{icon}</b><span>{label}</span></button>
  );
  const mobileTools: Record<Menu, JSX.Element[]> = {
    root: [
      tool("✎", "Edit", () => setMenu("edit-hint")),
      tool("♫", "Audio", () => setMenu("audio")),
      tool("＋", "Media", () => setSheet(true)),
      tool("T", "Text", () => setMenu("text")),
      tool("▭", "Video track", () => engine.dispatch(cmd.addTrack("video"))),
      tool("⤢", "Zoom", () => setMenu("zoom")),
      ...(hasClip ? [tool(pasteAction.icon, pasteAction.label, paste, "paste", pasteAction.title)] : []),
      rippleToggle,
    ],
    "edit-hint": [<span key="h" className="v2-tool-hint">Tap a clip on the timeline to edit it</span>],
    edit: selected ? [
      ...(transitionTools ? [<span key="tr" className="v2-trans-wrap">{transitionTools}</span>] : []),
      tool("✂", "Split", split),
      tool("🗑", ripple ? "Ripple delete" : "Delete", () => del(), "delete", ripple ? "Delete and close the gap" : "Delete"),
      tool("⤧", "Adjust", () => setInspOpen(true), "adjust", "Transform, keyframes and fades"),
      ...(speedSelect ? [tool("⏩", `Speed ${sp!.speed ?? 1}×`, () => setMenu("speed"), "speed", "Playback speed")] : []),
      tool("☑", "Select", () => setMultiMode(true), "multi", "Select several clips"),
      ...[...clipActions, ...timeActions, ...linkedAudioActions].map((a) => tool(a.icon, a.label, a.run, a.label, a.title)),
      ...(selected.placement.clipType !== "image" && selected.placement.clipType !== "html" ? [
        <label key="vol" className="v2-tool v2-volume"><b aria-hidden>🔊</b>
          <input type="range" min={0} max={1} step={0.05} value={selected.placement.volume ?? 1} aria-label="Volume" onPointerDown={() => engine.beginGesture()} onPointerUp={() => engine.endGesture()} onBlur={() => engine.endGesture()} onChange={(e) => engine.dispatch(cmd.setPlacementVolume(selected.placement.id, Number(e.target.value)))} />
        </label>] : []),
      tool(selected.track.muted ? "🔈" : "🔇", selected.track.muted ? "Unmute track" : "Mute track", () => engine.dispatch(cmd.toggleTrackMute(selected.track.id))),
      rippleToggle,
    ] : [],
    multi: [
      <span key="n" className="v2-sel-count" role="status">{sel.length} selected · tap clips</span>,
      tool("🗑", "Delete", () => delSel(), "del"),
      ...clipActions.map((a) => tool(a.icon, a.label, a.run, a.label, a.title)),
    ],
    audio: [
      tool("♫", "Import audio", () => setSheet(true)),
      tool("▤", "Audio track", () => engine.dispatch(cmd.addTrack("audio"))),
    ],
    speed: sp ? SPEEDS.map((s) => (
      <button key={s} className={`v2-tool ${(sp.speed ?? 1) === s ? "is-active" : ""}`} aria-pressed={(sp.speed ?? 1) === s} onClick={() => engine.dispatch(cmd.setSpeed(sp.id, s))}><b>{s}×</b><span>{s === 1 ? "Normal" : s < 1 ? "Slow" : "Fast"}</span></button>
    )) : [],
    text: textTools.map((a) => tool(a.icon, a.label, a.run, a.label, a.title)),
    zoom: [
      tool("＋", "Zoom in", () => setPps((p) => Math.min(400, p * 1.5))),
      tool("－", "Zoom out", () => setPps((p) => Math.max(4, p / 1.5))),
    ],
  };

  return (
    <div className={`v2-app ${mobile ? "is-mobile" : "is-desktop"} ${fs ? "is-fs" : ""}`}>
      {mobile ? (
        <header className="v2-header v2-mheader">
          <a className="v2-icon v2-close" href={window.location.pathname} aria-label="Close (back to classic editor)">✕</a>
          <button className="v2-icon v2-projects-btn" aria-label="Projects" title="Projects: new, open, rename, delete" onClick={() => setProjects(true)}>☰</button>
          <span className="v2-spacer" />
          <select className="v2-res" aria-label="Export resolution" value={res} onChange={(e) => setRes(e.target.value as Resolution)}>
            {["720p", "1080p", "2K", "4K"].map((r) => <option key={r}>{r}</option>)}
          </select>
          <button className="v2-export" title="Export MP4 (⌘/Ctrl+E)" onClick={openExport}>Export</button>
        </header>
      ) : (
        <header className="v2-header">
          <a className="v2-back" href={window.location.pathname} title="Back to classic editor">‹ Classic</a>
          <button className="v2-btn v2-projects-btn" title="Projects: new, open, rename, delete" onClick={() => setProjects(true)}>☰ Projects</button>
          <input className="v2-title" value={project.name} aria-label="Project name" onFocus={() => engine.beginGesture()} onBlur={() => engine.endGesture()} onChange={(e) => engine.dispatch(cmd.renameProject(e.target.value))} />
          <span className="v2-badge">v2 preview</span>
          <button className="v2-btn primary v2-export-d" title="Export MP4 (⌘/Ctrl+E)" onClick={openExport}>Export</button>
        </header>
      )}
      {notice && <RecoveryNotice failure={notice} storage={storage} onDismiss={() => setNotice(undefined)} />}
      {projects && <ProjectsDialog storage={storage} current={project} onOpen={(id) => { setProjects(false); onSwitch(id); }} onRenameCurrent={(n) => engine.dispatch(cmd.renameProject(n))} onClose={() => setProjects(false)} />}
      {exporting && <ExportDialog project={project} blobs={storage.blobs} res={res} onRes={setRes} onClose={() => setExporting(false)} />}
      {toast && <div className="v2-toast" role="status" onClick={() => setToast(undefined)}>{toast}</div>}
      {mobile ? (
        <>
          {preview}
          <div className="v2-mcontrols">
            <button className="v2-icon" aria-label="Fullscreen" onClick={fullscreen}>⛶</button>
            <button className="v2-icon v2-mplay" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>{playing ? "❚❚" : "▶"}</button>
            <span className="v2-mundo">
              <button className="v2-icon" aria-label="Undo" disabled={!canUndo} onClick={() => engine.undo()}>↶</button>
              <button className="v2-icon" aria-label="Redo" disabled={!canRedo} onClick={() => engine.redo()}>↷</button>
            </span>
          </div>
          <Timeline engine={engine} project={project} time={time} playing={playing} onSeek={seek} selectedId={selectedId} selectedIds={sel} onToggleSelect={toggleClip} multiMode={multiMode} onSelect={selectClip} peaks={peaks} strips={strips} pps={pps} onZoom={(z) => setPps(clampPps(z))} centered topLane={topLane} ripple={ripple} onTransition={onTransition}
            thumbs={thumbs} onAddMedia={() => setSheet(true)}
            timeLabel={<><b>{formatTimecode(time, project.settings.fps).slice(0, 5)}</b> / {formatTimecode(duration, project.settings.fps).slice(0, 5)}</>}
            sideColumn={<>
              {firstVideoTrack && <button className="v2-side-btn" onClick={() => engine.dispatch(cmd.toggleTrackMute(firstVideoTrack.id))}><b aria-hidden>{firstVideoTrack.muted ? "🔇" : "🔊"}</b><span>{firstVideoTrack.muted ? "Unmute clip audio" : "Mute clip audio"}</span></button>}
              <button className="v2-side-btn v2-cover" onClick={() => seek(0)} style={firstClip && thumbs[firstClip.source.assetId] ? { backgroundImage: `url(${thumbs[firstClip.source.assetId]})` } : undefined}><span>Cover</span></button>
            </>} />
          <nav className="v2-toolbar" aria-label={selected ? "Clip actions" : "Timeline actions"}>
            {activeMenu !== "root" && <button className="v2-tool v2-tool-back" aria-label="Back" onClick={back}>‹</button>}
            {mobileTools[activeMenu]}
          </nav>
          {sheet && <div className="v2-sheet-backdrop" onClick={() => setSheet(false)}><div className="v2-sheet" onClick={(e) => e.stopPropagation()}>{browser}</div></div>}
          {!sheet && <div hidden>{browser}</div>}
          {cue && <div className="v2-msub"><SubtitleEditor engine={engine} sub={cue} onDelete={delCue} /></div>}
          {inspOpen && selected && <div className="v2-sheet-backdrop" onClick={() => setInspOpen(false)}><div className="v2-sheet v2-msheet-insp" onClick={(e) => e.stopPropagation()}><TransformInspector engine={engine} placement={selected.placement} time={time} /><button className="v2-btn" onClick={() => setInspOpen(false)}>Done</button></div></div>}
        </>
      ) : (
        <div className="v2-desktop-grid">
          <div className="v2-side">{selected && <TransformInspector engine={engine} placement={selected.placement} time={time} />}{cue && <SubtitleEditor engine={engine} sub={cue} onDelete={delCue} />}{browser}</div>
          {preview}
          <section className="v2-timeline-panel" aria-label="Timeline">
            <div className="v2-timeline-toolbar">{selectionActions}<span className="v2-hint">Space play · S split · F freeze · Del delete · Shift+Del ripple · R ripple · Shift-click multi-select · ⌘C/⌘V/⌘D · ⌘/Ctrl+Z undo</span></div>
            <Timeline engine={engine} project={project} time={time} playing={playing} onSeek={seek} selectedId={selectedId} selectedIds={sel} onToggleSelect={toggleClip} multiMode={multiMode} onSelect={selectClip} peaks={peaks} strips={strips} pps={pps} onZoom={(z) => setPps(clampPps(z))} centered={false} topLane={topLane} ripple={ripple} onTransition={onTransition} />
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
  if (asset.kind === "html") return <span className="v2-thumb" title="HTML clip (sandboxed)">{"</>"}</span>;
  if (asset.kind === "audio" || !url) return <span className="v2-thumb">{asset.kind === "audio" ? "♫" : "…"}</span>;
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


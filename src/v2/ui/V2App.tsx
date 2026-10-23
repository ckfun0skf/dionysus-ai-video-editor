import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorBoot, useEngineState, useIsMobile, type EditorContext } from "./useEditor";
import { Timeline } from "./Timeline";
import { Player } from "../render/player";
import * as cmd from "../engine/commands";
import { importFile } from "../persistence/media";
import { compositionDuration, findPlacement, type Asset } from "../domain/model";
import { formatTimecode, secondsToTicks } from "../domain/time";

export function V2App() {
  const ctx = useEditorBoot();
  if (!ctx) return <div className="v2-loading">Loading Dionysus v2…</div>;
  return <Editor {...ctx} />;
}

function Editor({ engine, storage }: EditorContext) {
  const { project, canUndo, canRedo } = useEngineState(engine);
  const mobile = useIsMobile();
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [pps, setPps] = useState(40);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(0);
  const playerRef = useRef<Player>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const comp = project.compositions[project.rootCompositionId];
  const selected = selectedId ? findPlacement(comp, selectedId) : undefined;
  const duration = compositionDuration(comp);

  if (!playerRef.current) playerRef.current = new Player(project, storage.blobs);
  const player = playerRef.current;
  useEffect(() => { player.onTime = (t, p) => { setTime(t); setPlaying(p); }; return () => player.dispose(); }, [player]);
  useEffect(() => { player.canvas = canvasRef.current ?? undefined; player.draw(); }, [player, mobile]);
  useEffect(() => { player.setProject(project); }, [player, project]);
  useEffect(() => { if (selectedId && !selected) setSelectedId(undefined); }, [selectedId, selected]);

  const seek = useCallback((t: number) => player.seek(t), [player]);
  const togglePlay = useCallback(() => (player.isPlaying ? player.pause() : player.play()), [player]);
  const split = useCallback(() => { if (selectedId) engine.dispatch(cmd.splitPlacement(selectedId, player.time)); }, [engine, player, selectedId]);
  const del = useCallback(() => { if (selectedId) { engine.dispatch(cmd.deletePlacement(selectedId)); setSelectedId(undefined); } }, [engine, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) engine.redo(); else engine.undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); engine.redo(); }
      else if (e.key === " ") { e.preventDefault(); togglePlay(); }
      else if (e.key.toLowerCase() === "s" && !mod) split();
      else if (e.key === "Delete" || e.key === "Backspace") del();
      else if (e.key === "ArrowLeft") seek(player.time - secondsToTicks(1 / project.settings.fps));
      else if (e.key === "ArrowRight") seek(player.time + secondsToTicks(1 / project.settings.fps));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, togglePlay, split, del, seek, player, project.settings.fps]);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy((b) => b + files.length);
    for (const f of Array.from(files)) {
      try {
        const asset = await importFile(f, storage.blobs);
        if (asset) engine.dispatch(cmd.importAsset(asset));
      } finally { setBusy((b) => b - 1); }
    }
  };
  const addToTimeline = (a: Asset) => { engine.dispatch(cmd.addAssetToTimeline(a.id, mobile ? player.time : duration)); if (mobile) setSheet(false); };

  const browser = (
    <section className="v2-browser" aria-label="Media">
      <div className="v2-panel-head">
        <strong>Media</strong>
        <button className="v2-btn primary" onClick={() => fileRef.current?.click()}>＋ Import</button>
        {mobile && <button className="v2-btn" onClick={() => setSheet(false)}>Done</button>}
      </div>
      {busy > 0 && <p className="v2-hint">Importing {busy}…</p>}
      {Object.values(project.assets).length === 0 && <p className="v2-hint">Import video, image or audio files, then {mobile ? "tap" : "drag or click"} ＋ to add them to the timeline.</p>}
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
      <input ref={fileRef} type="file" hidden multiple accept="video/*,image/*,audio/*" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
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

  const selectionActions = selected ? (
    <>
      <button className="v2-tool" onClick={split}><b>✂</b><span>Split</span></button>
      <button className="v2-tool" onClick={del}><b>🗑</b><span>Delete</span></button>
      {selected.placement.clipType !== "image" && (
        <label className="v2-tool v2-volume"><b>🔊</b>
          <input type="range" min={0} max={1} step={0.05} value={selected.placement.volume ?? 1} aria-label="Volume" onChange={(e) => engine.dispatch(cmd.setPlacementVolume(selected.placement.id, Number(e.target.value)))} />
        </label>
      )}
      <button className="v2-tool" onClick={() => engine.dispatch(cmd.toggleTrackMute(selected.track.id))}><b>{selected.track.muted ? "🔈" : "🔇"}</b><span>{selected.track.muted ? "Unmute track" : "Mute track"}</span></button>
      <button className="v2-tool" onClick={() => setSelectedId(undefined)}><b>✓</b><span>Done</span></button>
    </>
  ) : (
    <>
      <button className="v2-tool" onClick={() => (mobile ? setSheet(true) : fileRef.current?.click())}><b>＋</b><span>Media</span></button>
      <button className="v2-tool" onClick={() => engine.dispatch(cmd.addTrack("video"))}><b>▭</b><span>Video track</span></button>
      <button className="v2-tool" onClick={() => engine.dispatch(cmd.addTrack("audio"))}><b>♫</b><span>Audio track</span></button>
      <button className="v2-tool" onClick={() => setPps((p) => Math.min(400, p * 1.5))}><b>＋</b><span>Zoom in</span></button>
      <button className="v2-tool" onClick={() => setPps((p) => Math.max(4, p / 1.5))}><b>－</b><span>Zoom out</span></button>
    </>
  );

  const preview = (
    <section className="v2-preview" aria-label="Preview">
      <div className="v2-canvas-wrap"><canvas ref={canvasRef} width={1280} height={720} onClick={togglePlay} /></div>
      {!mobile && transport}
    </section>
  );

  return (
    <div className={`v2-app ${mobile ? "is-mobile" : "is-desktop"}`}>
      <header className="v2-header">
        <a className="v2-back" href={window.location.pathname} title="Back to classic editor">‹ Classic</a>
        <input className="v2-title" value={project.name} aria-label="Project name" onChange={(e) => engine.dispatch(cmd.renameProject(e.target.value))} />
        <span className="v2-badge">v2 preview</span>
      </header>
      {mobile ? (
        <>
          {preview}
          {transport}
          <Timeline engine={engine} project={project} time={time} playing={playing} onSeek={seek} selectedId={selectedId} onSelect={setSelectedId} pps={pps} centered />
          <nav className="v2-toolbar" aria-label={selected ? "Clip actions" : "Timeline actions"}>{selectionActions}</nav>
          {sheet && <div className="v2-sheet-backdrop" onClick={() => setSheet(false)}><div className="v2-sheet" onClick={(e) => e.stopPropagation()}>{browser}</div></div>}
          {!sheet && <div hidden>{browser}</div>}
        </>
      ) : (
        <div className="v2-desktop-grid">
          {browser}
          {preview}
          <section className="v2-timeline-panel" aria-label="Timeline">
            <div className="v2-timeline-toolbar">{selectionActions}<span className="v2-hint">Space play · S split · Del delete · ⌘/Ctrl+Z undo</span></div>
            <Timeline engine={engine} project={project} time={time} playing={playing} onSeek={seek} selectedId={selectedId} onSelect={setSelectedId} pps={pps} centered={false} />
          </section>
        </div>
      )}
    </div>
  );
}

function AssetThumb({ asset, engineBlobs }: { asset: Asset; engineBlobs: EditorContext["storage"]["blobs"] }) {
  const [url, setUrl] = useState<string>();
  const key = asset.versions[0]?.media.blobKey;
  useEffect(() => {
    if (asset.kind === "audio" || !key) return;
    let u: string | undefined;
    let alive = true;
    void engineBlobs.get(key).then((b) => { if (b && alive) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [key, asset.kind, engineBlobs]);
  if (asset.kind === "audio" || !url) return <span className="v2-thumb">{asset.kind === "audio" ? "♫" : "…"}</span>;
  return asset.kind === "image" ? <img className="v2-thumb" src={url} alt="" /> : <video className="v2-thumb" src={`${url}#t=0.1`} muted preload="metadata" />;
}

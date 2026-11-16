import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addSceneEvent, addSceneLight, addSceneModel, addSceneObject, callTweens, clipVersion, duplicateSceneEvent, isVec3, modelAnimations, modelNodes,
  objectIdProblem, parseScene, removeSceneEvent, removeSceneLight, removeSceneObject, renameSceneObject, roundSec, SCENE_CAMERA, SCENE_EASES,
  SCENE_LIGHTS, SCENE_LOOPS, SCENE_SHAPES, sceneCallArgs, sceneCalls, sceneCameraBase, sceneLights, sceneSpan, sceneTracks, setSceneEventArg,
  setSceneEventCall, sourceAt, ticksToSeconds, TICKS_PER_SECOND, updateSceneEvent, updateSceneLight, updateSceneObject, updateSceneWorld,
  validateScene, versionOfPlacement, type Placement, type Project, type SceneArgField, type SceneDoc, type SceneEase, type SceneEvent,
  type SceneIssue, type SceneLightType, type SceneObject, type SceneShape, type SceneTrack, type Vec3,
} from "../domain";
import { cmd, type Engine } from "../engine";
import type { BlobStore } from "../ports";
import { readAttachedFiles } from "./CodeEditor";
import { Ic } from "./Icon";
import { cachedSceneDoc, rememberSceneDoc, sceneVersion } from "./sceneAsset";

/** What the side panel edits: the scene (world, camera, lights), one object, or one event (by index). */
export type SceneSel = { kind: "scene" } | { kind: "object"; id: string } | { kind: "event"; index: number };

export interface SceneEditorProps {
  engine: Engine;
  project: Project;
  placement: Placement;
  blobs: BlobStore;
  mobile: boolean;
  /** Timeline time (ticks) and transport. */
  time: number;
  playing: boolean;
  onSeek: (ticks: number) => void;
  onTogglePlay: () => void;
  onClose: () => void;
  /** Hand a stored scene to the player so the preview shows it at once. */
  onPrime?: (blobKey: string, doc: SceneDoc) => void;
  /** Phone: the program preview canvas, mirrored at the top of the full-screen editor. */
  mirror?: () => HTMLCanvasElement | null | undefined;
  /** Start with this selection (tests, deep links). */
  initialSel?: SceneSel;
}

const LANE = 48;

/**
 * The scene editor (P76, Phase 2 step 2.3): a scene clip's own timeline, opened from the clip (a panel in place of
 * the timeline on desktop, a full-screen sheet on the phone). One track per object plus the scene/camera track on
 * top; events are blocks labelled with their call, stacked in rows where they overlap. Selecting a block (or a track
 * header) edits it in the side panel: event time, length, ease and arguments; object base properties; world, camera
 * and lights. Objects and events can be added and deleted.
 *
 * Every committed edit (a field on blur / Enter / change, a button) is one gesture: the edited scene is stored as a
 * scene version and dispatched as ONE undo step, so the preview shows it at once. Saving follows the version-save
 * rules: "New version" makes one new version on the first edit of this editing session and the later edits of the
 * session update that version; "Replace current" overwrites the version the clip shows. Dragging blocks to retime
 * them is step 2.4 (P77).
 */
export function SceneEditor(props: SceneEditorProps) {
  const { engine, project, placement, blobs, mobile, time, playing, onSeek, onTogglePlay, onClose, onPrime, mirror } = props;
  const version = versionOfPlacement(project, placement);
  const blobKey = version?.media.blobKey;
  const [loaded, setLoaded] = useState<{ key: string; doc?: SceneDoc; error?: string }>();
  const [sel, setSel] = useState<SceneSel>(props.initialSel ?? { kind: "scene" });
  const [mode, setMode] = useState<clipVersion.VersionSaveMode>(() => clipVersion.versionSaveModeOf(project));
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pps, setPps] = useState(mobile ? 64 : 96);
  const session = useRef<string | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const fileInput = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selKey = sel.kind === "event" ? `e${sel.index}` : sel.kind === "object" ? `o${sel.id}` : "s";
  useEffect(() => { if (panelRef.current) panelRef.current.scrollTop = 0; }, [selKey]);

  useEffect(() => {
    if (!blobKey || cachedSceneDoc(blobKey)) return;
    let live = true;
    void blobs.get(blobKey).then(async (b) => {
      const r = b ? parseScene(await blobText(b)) : undefined;
      if (r?.doc) rememberSceneDoc(blobKey, r.doc);
      if (live) setLoaded({ key: blobKey, doc: r?.doc, error: r ? (r.doc ? undefined : r.issues[0]?.message) : "The scene file is missing." });
    }, () => { if (live) setLoaded({ key: blobKey, error: "The scene file could not be loaded." }); });
    return () => { live = false; };
  }, [blobKey, blobs]);
  const doc = cachedSceneDoc(blobKey) ?? (loaded && loaded.key === blobKey ? loaded.doc : undefined);
  const issues = useMemo(() => (doc ? validateScene(doc) : []), [doc]);
  const tracks = useMemo(() => (doc ? sceneTracks(doc, 46 / pps) : []), [doc, pps]);

  // Scene-local time of the playhead and the clip's range on the scene's clock.
  const speed = placement.speed ?? 1;
  const inSec = ticksToSeconds(placement.sourceInTicks);
  const outSec = ticksToSeconds(placement.sourceInTicks + placement.durationTicks * speed);
  const inside = time >= placement.startTicks && time < placement.startTicks + placement.durationTicks;
  const localSec = inside ? ticksToSeconds(sourceAt(placement, time)) : ticksToSeconds(placement.sourceInTicks + (time - placement.startTicks) * speed);
  const atNow = roundSec(Math.max(0, localSec));
  const seekLocal = (s: number) => {
    const t = placement.startTicks + (s * TICKS_PER_SECOND - placement.sourceInTicks) / speed;
    onSeek(Math.round(Math.min(placement.startTicks + placement.durationTicks - 1, Math.max(placement.startTicks, t))));
  };

  /** One gesture: apply `fn` to the scene the clip shows now, store it, dispatch one undo step. */
  const edit = (label: string, fn: (d: SceneDoc) => { doc: SceneDoc; sel?: SceneSel; note?: string } | SceneDoc) => {
    queue.current = queue.current.then(async () => {
      const p = engine.getState().project;
      const pl = p.compositions[p.rootCompositionId] ? findClip(p, placement.id) : undefined;
      const v = pl ? versionOfPlacement(p, pl) : undefined;
      const asset = pl ? p.assets[pl.source.assetId] : undefined;
      const cur = cachedSceneDoc(v?.media.blobKey);
      if (!pl || !v || !asset || !cur) return;
      const out = fn(cur);
      const r = "format" in out ? { doc: out as SceneDoc } : out;
      if (r.doc === cur) { if (r.note) setNote(r.note); return; }
      setBusy(true);
      try {
        const next = await sceneVersion(blobs, asset, r.doc);
        onPrime?.(next.media.blobKey, r.doc);
        const own = mode === "new" && session.current === v.id;
        const m: clipVersion.VersionSaveMode = mode === "replace" || own ? "replace" : "new";
        if (engine.dispatch(cmd.addAssetVersion(asset.id, next, pl.id, { mode: m, label: `Scene: ${label}`, remember: !own }))) {
          if (m === "new") session.current = next.id;
          if (r.sel) setSel(r.sel);
          setNote(r.note);
        }
      } catch (e) { setNote(`Couldn't save the edit: ${e instanceof Error ? e.message : "failed"}`); }
      finally { setBusy(false); }
    });
    return queue.current;
  };

  const addModel = async (files: FileList | null) => {
    if (!files?.length) return;
    const { next, notes } = await readAttachedFiles(files, {}, ".glb");
    const [name, data] = Object.entries(next)[0] ?? [];
    if (fileInput.current) fileInput.current.value = "";
    if (!name || !data) { setNote(notes.join(" ") || "No model was added."); return; }
    await edit("add 3D model", (d) => { const r = addSceneModel(d, name, data); return { doc: r.doc, sel: { kind: "object", id: r.id }, note: [`Added “${r.id}” (${name}).`, ...notes].join(" ") }; });
  };

  const versions = project.assets[placement.source.assetId]?.versions ?? [];
  const vIndex = version ? versions.findIndex((x) => x.id === version.id) + 1 : 0;
  const errors = issues.filter((i) => i.level === "error").length;
  const header = (
    <header className="v2-sed-head">
      <button type="button" className="v2-icon v2-sed-close" aria-label={mobile ? "Close scene editor" : "Done"} title="Close the scene editor (Esc)" onClick={onClose}><Ic g={mobile ? "✕" : "✓"} size={20} /></button>
      <strong className="v2-sed-title"><Ic g="scene" size={16} /> {doc?.name || project.assets[placement.source.assetId]?.name || "3D scene"}</strong>
      <span className="v2-sed-ver" title="The scene version this clip shows">v{vIndex || "?"}{busy ? " · saving…" : ""}</span>
      <span className="v2-spacer" />
      <div className="v2-sed-mode" role="radiogroup" aria-label="How edits are saved">
        <button type="button" role="radio" aria-checked={mode === "new"} className={mode === "new" ? "is-on" : ""} title="Keep the current version: the first edit makes a new version, later edits in this editor update it" onClick={() => { setMode("new"); session.current = undefined; }}>New version</button>
        <button type="button" role="radio" aria-checked={mode === "replace"} className={mode === "replace" ? "is-on" : ""} title="Overwrite the version this clip shows (other clips using it update)" onClick={() => setMode("replace")}>Replace current</button>
      </div>
      <button type="button" className="v2-icon" aria-label="Undo" title="Undo" disabled={!engine.getState().canUndo} onClick={() => engine.undo()}><Ic g="↶" size={18} /></button>
      <button type="button" className="v2-icon" aria-label="Redo" title="Redo" disabled={!engine.getState().canRedo} onClick={() => engine.redo()}><Ic g="↷" size={18} /></button>
    </header>
  );

  if (!doc) {
    const err = loaded?.key === blobKey ? loaded?.error : undefined;
    return <div className={`v2-scene-editor ${mobile ? "is-phone" : "is-desk"}`} role="dialog" aria-label="Scene editor">{header}<p className="v2-abnote">{err ?? "Loading scene…"}</p></div>;
  }

  const span = sceneSpan(doc, outSec) + 1;
  const width = Math.ceil(span * pps);
  const ticks: number[] = [];
  const step = pps >= 80 ? 0.5 : pps >= 40 ? 1 : 2;
  for (let s = 0; s <= span + 1e-9; s += step) ticks.push(Math.round(s * 1000) / 1000);
  const selEvent = sel.kind === "event" ? doc.events?.[sel.index] : undefined;
  const selObj = sel.kind === "object" ? doc.objects.find((o) => o.id === sel.id) : undefined;
  const pickTrack = (t: SceneTrack) => setSel(t.kind === "camera" ? { kind: "scene" } : t.kind === "missing" ? { kind: "scene" } : { kind: "object", id: t.id });
  const addEventOn = (t: SceneTrack) => {
    const call = t.kind === "camera" ? "moveTo" : "moveTo";
    void edit(`add ${call}`, (d) => { const r = addSceneEvent(d, t.id, call, atNow, 1); return { doc: r.doc, sel: { kind: "event", index: r.index } }; });
  };

  const tracksEl = (
    <div className="v2-sed-tracks" role="group" aria-label="Scene tracks">
      <div className="v2-sed-grid" style={{ width: width + LABEL_W(mobile) }}>
        <div className="v2-sed-ruler">
          <div className="v2-sed-corner" style={{ width: LABEL_W(mobile) }}>
            <button type="button" className="v2-icon" aria-label="Zoom out" title="Zoom out" onClick={() => setPps((x) => Math.max(24, Math.round(x / 1.5)))}><Ic g="zoom-out" size={16} /></button>
            <button type="button" className="v2-icon" aria-label="Zoom in" title="Zoom in" onClick={() => setPps((x) => Math.min(400, Math.round(x * 1.5)))}><Ic g="zoom-in" size={16} /></button>
          </div>
          <div className="v2-sed-scale" style={{ width }} onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekLocal((e.clientX - r.left) / pps); }} title="Tap to move the playhead (scene time)">
            <span className="v2-sed-out" style={{ left: 0, width: Math.max(0, inSec * pps) }} />
            <span className="v2-sed-out" style={{ left: outSec * pps, width: Math.max(0, width - outSec * pps) }} />
            {ticks.map((s) => <span key={s} className={`v2-sed-tick ${Math.abs(s - Math.round(s)) < 1e-9 ? "is-major" : ""}`} style={{ left: s * pps }}>{Math.abs(s - Math.round(s)) < 1e-9 ? `${s}s` : ""}</span>)}
          </div>
        </div>
        {tracks.map((t) => {
          const on = (sel.kind === "object" && sel.id === t.id) || (sel.kind === "scene" && t.kind === "camera");
          return <div key={t.id || "missing"} className={`v2-sed-track kind-${t.kind} ${on ? "is-sel" : ""}`} style={{ height: t.rows * LANE + 4 }}>
            <div className="v2-sed-thead" style={{ width: LABEL_W(mobile) }}>
              <button type="button" className="v2-sed-tname" aria-pressed={on} title={`${t.label} · ${t.detail}`} onClick={() => pickTrack(t)}>
                <Ic g={t.kind === "camera" ? "camera" : t.kind === "missing" ? "⚠" : "scene"} size={16} /><span>{t.label}</span>
              </button>
              {t.kind !== "missing" && <button type="button" className="v2-icon v2-sed-tadd" aria-label={`Add event to ${t.label}`} title={`Add an event to ${t.label} at the playhead`} onClick={() => addEventOn(t)}><Ic g="＋" size={16} /></button>}
            </div>
            <div className="v2-sed-lane" style={{ width }}>
              <span className="v2-sed-out" style={{ left: 0, width: Math.max(0, inSec * pps) }} />
              <span className="v2-sed-out" style={{ left: outSec * pps, width: Math.max(0, width - outSec * pps) }} />
              {t.blocks.map((b) => {
                const isSel = sel.kind === "event" && sel.index === b.index;
                const bad = issues.some((i) => i.level === "error" && (i.path === `events[${b.index}]` || i.path.startsWith(`events[${b.index}].`)));
                return <button key={b.index} type="button" className={`v2-sed-block ${b.dur ? "has-dur" : "is-instant"} ${isSel ? "is-sel" : ""} ${bad ? "is-bad" : ""}`}
                  style={{ left: b.at * pps, width: Math.max(b.dur * pps, 44), top: b.row * LANE + 2 }}
                  aria-pressed={isSel} aria-label={`${t.label}.${b.call} at ${b.at}s${b.dur ? ` for ${b.dur}s` : ""}`} title={`${b.call} · ${b.at}s${b.dur ? ` → ${+(b.end).toFixed(3)}s` : ""}`}
                  onClick={() => setSel({ kind: "event", index: b.index })}>
                  <span>{b.call}</span>
                </button>;
              })}
            </div>
          </div>;
        })}
        <div className="v2-sed-playhead" style={{ left: LABEL_W(mobile) + localSec * pps }} aria-hidden />
      </div>
    </div>
  );

  const panel = (
    <div ref={panelRef} className="v2-sed-panel" aria-label="Edit selection">
      {sel.kind === "event" && selEvent ? <EventForm key={`e${sel.index}`} doc={doc} index={sel.index} ev={selEvent} issues={issues} edit={edit} onSeek={() => seekLocal(selEvent.at)} onDeleted={() => setSel(selEvent.obj === SCENE_CAMERA ? { kind: "scene" } : { kind: "object", id: selEvent.obj })} atNow={atNow} />
        : sel.kind === "object" && selObj ? <ObjectForm key={`o${selObj.id}`} doc={doc} obj={selObj} issues={issues} edit={edit} atNow={atNow} />
          : <SceneForm doc={doc} edit={edit} />}
      {note && <p className="v2-abnote" role="status">{note}</p>}
    </div>
  );

  const toolbar = (
    <div className="v2-sed-bar">
      <button type="button" className="v2-icon v2-sed-play" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} onClick={onTogglePlay}><Ic g={playing ? "❚❚" : "▶"} size={18} /></button>
      <span className="v2-sed-time" title="Scene time at the playhead">{localSec.toFixed(2)}s</span>
      <span className="v2-spacer" />
      {errors > 0 && <span className="v2-sed-errs" title="Problems in the scene (select an item to see its own)"><Ic g="⚠" size={14} /> {errors}</span>}
      <div className="v2-sed-addwrap">
        <button type="button" className="v2-btn v2-sed-addobj" aria-expanded={adding} onClick={() => setAdding((x) => !x)}><Ic g="＋" size={16} /> Add object</button>
        {adding && <div className="v2-sed-addmenu" role="menu" aria-label="Add object">
          {SCENE_SHAPES.map((s) => <button key={s} type="button" role="menuitem" onClick={() => { setAdding(false); void edit(`add ${s}`, (d) => { const r = addSceneObject(d, s); return { doc: r.doc, sel: { kind: "object", id: r.id } }; }); }}><Ic g="scene" size={16} /> {s[0].toUpperCase() + s.slice(1)}</button>)}
          <button type="button" role="menuitem" onClick={() => { setAdding(false); fileInput.current?.click(); }}><Ic g="⇪" size={16} /> GLB model…</button>
        </div>}
        <input ref={fileInput} type="file" accept=".glb,model/gltf-binary" hidden data-testid="scene-editor-model-input" onChange={(e) => void addModel(e.currentTarget.files)} />
      </div>
    </div>
  );

  return (
    <div className={`v2-scene-editor ${mobile ? "is-phone" : "is-desk"}`} role="dialog" aria-label="Scene editor" data-testid="scene-editor" onKeyDown={(e) => {
      // Inside the editor the app's shortcuts are off (it is a dialog); these few work here, never in a field.
      if ((e.target as HTMLElement).closest?.("input,select,textarea")) return;
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (mod && (k === "z" || k === "y")) { e.preventDefault(); if (k === "y" || e.shiftKey) engine.redo(); else engine.undo(); }
      else if (e.key === " " && !mod) { e.preventDefault(); onTogglePlay(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel.kind === "event") { e.preventDefault(); const i = sel.index; void edit("delete event", (d) => removeSceneEvent(d, i)); setSel({ kind: "scene" }); }
    }}>
      {header}
      {mobile && mirror && <Mirror source={mirror} />}
      {toolbar}
      <div className="v2-sed-body">{tracksEl}{panel}</div>
    </div>
  );
}

const LABEL_W = (mobile: boolean) => (mobile ? 128 : 150);

function findClip(p: Project, id: string): Placement | undefined {
  for (const c of Object.values(p.compositions)) for (const t of c.tracks) { const x = t.placements.find((pl) => pl.id === id); if (x) return x; }
  return undefined;
}

type Edit = (label: string, fn: (d: SceneDoc) => { doc: SceneDoc; sel?: SceneSel; note?: string } | SceneDoc) => Promise<void>;

/** Problems whose path is `prefix` or below it. */
const issuesAt = (issues: SceneIssue[], prefix: string) => issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`) || i.path.startsWith(`${prefix}[`));
function Problems({ list }: { list: SceneIssue[] }) {
  if (!list.length) return null;
  return <ul className="v2-scene-list v2-scene-issues" aria-label="Problems">{list.map((i, n) => <li key={n} className={`is-${i.level}`}>{i.path && <code>{i.path}</code>} {i.message}</li>)}</ul>;
}

// ---------------------------------------------------------------- forms

function SceneForm({ doc, edit }: { doc: SceneDoc; edit: Edit }) {
  const base = sceneCameraBase(doc);
  const { lights, defaults } = sceneLights(doc);
  return <div className="v2-sed-form" data-testid="scene-form">
    <h4><Ic g="camera" size={16} /> Scene</h4>
    <TextField label="Name" value={doc.name ?? ""} onCommit={(v) => edit("rename scene", (d) => ({ ...d, name: v || undefined }) as SceneDoc)} />
    <NumField label="Planned length (s)" value={doc.durationSec} min={0.1} step={0.5} optional onCommit={(v) => edit("planned length", (d) => (v === undefined ? (({ durationSec: _x, ...r }) => (void _x, r as SceneDoc))(d) : { ...d, durationSec: v }))} />
    <ColorField label="Background" value={base.background} onCommit={(v) => edit("background", (d) => updateSceneWorld(d, { background: v }))} />
    <h5>Camera at 0 s</h5>
    <NumField label="Field of view (°)" value={base.fov} min={2} max={178} step={1} onCommit={(v) => edit("camera fov", (d) => updateSceneWorld(d, { camera: { fov: v } }))} />
    <Vec3Field label="Position" value={base.position} onCommit={(v) => edit("camera position", (d) => updateSceneWorld(d, { camera: { position: v } }))} />
    <Vec3Field label="Looks at" value={base.lookAt} onCommit={(v) => edit("camera target", (d) => updateSceneWorld(d, { camera: { lookAt: v } }))} />
    <h5><Ic g="light" size={14} /> Lights {defaults && <small>(default lighting)</small>}</h5>
    {lights.map((l, i) => <fieldset key={i} className="v2-sed-light"><legend>Light {i + 1}</legend>
      <SelectField label="Type" value={l.type} options={[...SCENE_LIGHTS]} onCommit={(v) => edit("light type", (d) => updateSceneLight(d, i, { type: v as SceneLightType }))} />
      <ColorField label="Colour" value={l.color ?? "#ffffff"} onCommit={(v) => edit("light colour", (d) => updateSceneLight(d, i, { color: v }))} />
      <NumField label="Intensity" value={l.intensity ?? 1} min={0} step={0.1} onCommit={(v) => edit("light intensity", (d) => updateSceneLight(d, i, { intensity: v }))} />
      {(l.type === "directional" || l.type === "point") && <Vec3Field label="Position" value={l.position ?? [0, 3, 2]} onCommit={(v) => edit("light position", (d) => updateSceneLight(d, i, { position: v }))} />}
      <button type="button" className="v2-btn v2-sed-danger" onClick={() => void edit("delete light", (d) => removeSceneLight(d, i))}><Ic g="🗑" size={16} /> Delete light</button>
    </fieldset>)}
    <button type="button" className="v2-btn" onClick={() => void edit("add light", (d) => addSceneLight(d))}><Ic g="＋" size={16} /> Add light</button>
    <p className="v2-abnote">Tap a track name to edit an object, or a block to edit an event. Camera moves are events on this track (＋).</p>
  </div>;
}

function ObjectForm({ doc, obj, issues, edit, atNow }: { doc: SceneDoc; obj: SceneObject; issues: SceneIssue[]; edit: Edit; atNow: number }) {
  const k = doc.objects.indexOf(obj);
  const model = typeof obj.model === "string";
  const anims = model ? modelAnimations(doc, obj.model) : undefined;
  const nodes = model ? modelNodes(doc, obj.model) : undefined;
  const calls = sceneCalls(doc, obj.id);
  const [call, setCall] = useState(calls[0]?.call ?? "moveTo");
  const [idErr, setIdErr] = useState<string>();
  const set = (label: string, patch: Partial<SceneObject>) => edit(label, (d) => updateSceneObject(d, obj.id, patch));
  const anim = typeof obj.animation === "string" ? { clip: obj.animation } : obj.animation;
  const scale = obj.scale === undefined ? 1 : obj.scale;
  return <div className="v2-sed-form" data-testid="object-form">
    <h4><Ic g="scene" size={16} /> {obj.name || obj.id} <small>{model ? `model ${obj.model}` : obj.shape ?? "box"}</small></h4>
    <TextField label="Id" value={obj.id} error={idErr} onCommit={(v) => {
      const why = objectIdProblem(doc, obj.id, v); setIdErr(why);
      if (!why && v !== obj.id) void edit("rename object", (d) => { const r = renameSceneObject(d, obj.id, v); return { doc: r.doc, sel: { kind: "object", id: v } }; });
    }} />
    <TextField label="Name" value={obj.name ?? ""} onCommit={(v) => set("object name", { name: v || undefined })} />
    {!model && <SelectField label="Shape" value={obj.shape ?? "box"} options={[...SCENE_SHAPES]} onCommit={(v) => set("shape", { shape: v as SceneShape })} />}
    <ListField label={model ? "Fit size" : "Size"} value={obj.size} hint={model ? "largest side, units" : "one number or a list"} onCommit={(v) => set("size", { size: v })} />
    {!model && <ColorField label="Colour" value={obj.color ?? "#cccccc"} onCommit={(v) => set("colour", { color: v })} />}
    <Vec3Field label="Position" value={obj.position ?? [0, 0, 0]} onCommit={(v) => set("position", { position: v })} />
    <Vec3Field label="Rotation (°)" value={obj.rotation ?? [0, 0, 0]} onCommit={(v) => set("rotation", { rotation: v })} />
    <ListField label="Scale" value={scale} hint="one number or x, y, z" onCommit={(v) => set("scale", { scale: v === undefined ? undefined : Array.isArray(v) ? (v.length === 3 ? v as Vec3 : v[0]) : v })} />
    <CheckField label="Visible" value={obj.visible !== false} onCommit={(v) => set(v ? "show" : "hide", { visible: v ? undefined : false })} />
    <NumField label="Opacity" value={obj.opacity ?? 1} min={0} max={1} step={0.05} onCommit={(v) => set("opacity", { opacity: v === 1 ? undefined : v })} />
    {model && <>
      <h5>Animation from 0 s</h5>
      <SelectField label="Clip" value={anim?.clip ?? ""} options={["", ...(anims ?? (anim ? [anim.clip] : []))]} labels={{ "": "None (rest pose)" }} onCommit={(v) => set("animation", { animation: v ? (anim && typeof obj.animation === "object" ? { ...anim, clip: v } : v) : undefined })} />
      {anim && <>
        <NumField label="Speed" value={anim.speed ?? 1} min={0} step={0.1} onCommit={(v) => set("animation speed", { animation: { ...anim, speed: v } })} />
        <SelectField label="Loop" value={anim.loop ?? "repeat"} options={[...SCENE_LOOPS]} onCommit={(v) => set("animation loop", { animation: { ...anim, loop: v as never } })} />
      </>}
      {nodes && nodes.length > 0 && <NodesField label="Parts shown from 0 s" nodes={nodes} value={obj.nodes ?? {}} onCommit={(v) => set("parts", { nodes: Object.keys(v).length ? v : undefined })} />}
    </>}
    <Problems list={issuesAt(issues, `objects[${k}]`)} />
    <h5>Add event at {atNow}s</h5>
    <div className="v2-sed-row">
      <select aria-label="Call" value={call} onChange={(e) => setCall(e.target.value)}>{calls.map((c) => <option key={c.call} value={c.call} title={c.description}>{c.call}</option>)}</select>
      <button type="button" className="v2-btn" onClick={() => void edit(`add ${call}`, (d) => { const r = addSceneEvent(d, obj.id, call, atNow, callTweens(d, obj.id, call) ? 1 : undefined); return { doc: r.doc, sel: { kind: "event", index: r.index } }; })}><Ic g="＋" size={16} /> Add event</button>
    </div>
    <button type="button" className="v2-btn v2-sed-danger" onClick={() => void edit("delete object", (d) => { const r = removeSceneObject(d, obj.id); return { doc: r.doc, sel: { kind: "scene" }, note: `Deleted “${obj.id}”${r.removedEvents ? ` and ${r.removedEvents} event${r.removedEvents === 1 ? "" : "s"}` : ""}.` }; })}><Ic g="🗑" size={16} /> Delete object</button>
  </div>;
}

function EventForm({ doc, index, ev, issues, edit, onSeek, onDeleted, atNow }: { doc: SceneDoc; index: number; ev: SceneEvent; issues: SceneIssue[]; edit: Edit; onSeek: () => void; onDeleted: () => void; atNow: number }) {
  const calls = sceneCalls(doc, ev.obj);
  const known = calls.some((c) => c.call === ev.call);
  const fields = sceneCallArgs(doc, ev.obj, ev.call);
  const tweens = callTweens(doc, ev.obj, ev.call);
  const args = ev.args ?? {};
  const desc = calls.find((c) => c.call === ev.call)?.description;
  const objIds = doc.objects.map((o) => o.id).filter((id) => id !== ev.obj);
  return <div className="v2-sed-form" data-testid="event-form">
    <h4><code>{ev.obj}.{ev.call}</code> <small>event {index + 1}</small></h4>
    {desc && <p className="v2-abnote">{desc}</p>}
    <SelectField label="Call" value={ev.call} options={known ? calls.map((c) => c.call) : [ev.call, ...calls.map((c) => c.call)]} onCommit={(v) => edit(`call ${v}`, (d) => setSceneEventCall(d, index, v))} />
    <div className="v2-sed-row">
      <NumField label="At (s)" value={ev.at} min={0} step={0.1} onCommit={(v) => edit("event time", (d) => updateSceneEvent(d, index, { at: v ?? 0 }))} />
      <button type="button" className="v2-btn" title="Move this event to the playhead" onClick={() => void edit("event time", (d) => updateSceneEvent(d, index, { at: atNow }))}>At playhead</button>
    </div>
    {tweens && <NumField label="Duration (s)" value={ev.dur} min={0} step={0.1} optional onCommit={(v) => edit("event duration", (d) => updateSceneEvent(d, index, { dur: v }))} />}
    {tweens && (ev.dur ?? 0) > 0 && <SelectField label="Ease" value={ev.ease ?? "linear"} options={[...SCENE_EASES]} onCommit={(v) => edit("ease", (d) => updateSceneEvent(d, index, { ease: v === "linear" ? undefined : v as SceneEase }))} />}
    {fields.map((f) => <ArgField key={f.name} field={f} value={args[f.name] ?? (f.name === "position" ? args.value : undefined)} objIds={objIds} onCommit={(v) => edit(`${ev.call} ${f.label.toLowerCase()}`, (d) => setSceneEventArg(d, index, f.name, v))} />)}
    <Problems list={issuesAt(issues, `events[${index}]`)} />
    <div className="v2-sed-row">
      <button type="button" className="v2-btn" onClick={onSeek}><Ic g="⇤" size={16} /> Go to</button>
      <button type="button" className="v2-btn" onClick={() => void edit("duplicate event", (d) => { const r = duplicateSceneEvent(d, index); return { doc: r.doc, sel: { kind: "event", index: r.index } }; })}><Ic g="⧉" size={16} /> Duplicate</button>
      <button type="button" className="v2-btn v2-sed-danger" onClick={() => { void edit("delete event", (d) => removeSceneEvent(d, index)); onDeleted(); }}><Ic g="🗑" size={16} /> Delete</button>
    </div>
  </div>;
}

function ArgField({ field: f, value, objIds, onCommit }: { field: SceneArgField; value: unknown; objIds: string[]; onCommit: (v: unknown) => void }) {
  switch (f.kind) {
    case "vec3": return <Vec3Field label={f.label} value={isVec3(value) ? value : [0, 0, 0]} onCommit={onCommit} />;
    case "scale": return <ListField label={f.label} value={typeof value === "number" || Array.isArray(value) ? value as number | number[] : 1} hint="one number or x, y, z" onCommit={(v) => onCommit(Array.isArray(v) && v.length === 1 ? v[0] : v)} />;
    case "target": {
      const point = isVec3(value);
      return <>
        <SelectField label={f.label} value={point ? "" : String(value ?? "")} options={["", ...objIds]} labels={{ "": "A point [x, y, z]" }} onCommit={(v) => onCommit(v || [0, 0, 0])} />
        {point && <Vec3Field label="Point" value={value} onCommit={onCommit} />}
      </>;
    }
    case "number": return <NumField label={f.label} value={typeof value === "number" ? value : undefined} min={f.min} max={f.max} step={f.step} optional={f.optional} onCommit={onCommit} />;
    case "bool": return <CheckField label={f.label} value={value === true} onCommit={onCommit} />;
    case "color": return <ColorField label={f.label} value={typeof value === "string" ? value : "#ffffff"} onCommit={onCommit} />;
    case "select": {
      const v = typeof value === "string" ? value : "";
      const opts = f.optional ? ["", ...f.options] : f.options.includes(v) || !v ? f.options : [v, ...f.options];
      if (f.free && !f.options.length) return <TextField label={f.label} value={v} onCommit={(x) => onCommit(x)} />;
      return <SelectField label={f.label} value={v} options={opts} labels={{ "": f.optional ? "Default" : "—" }} onCommit={(x) => onCommit(x || undefined)} />;
    }
    case "nodes": return f.nodes?.length ? <NodesField label={f.label} nodes={f.nodes} value={value && typeof value === "object" ? value as Record<string, boolean> : {}} onCommit={onCommit} /> : <p className="v2-abnote">The model&apos;s parts are not known (the file can&apos;t be read).</p>;
    case "param": {
      const p = f.param;
      if (p.type === "number") return <NumField label={f.label} value={typeof value === "number" ? value : Number(p.default)} min={p.min} max={p.max} step={p.step} onCommit={onCommit} />;
      if (p.type === "boolean") return <CheckField label={f.label} value={typeof value === "boolean" ? value : !!p.default} onCommit={onCommit} />;
      if (p.type === "color") return <ColorField label={f.label} value={typeof value === "string" ? value : String(p.default)} onCommit={onCommit} />;
      if (p.type === "select") return <SelectField label={f.label} value={typeof value === "string" ? value : String(p.default)} options={p.options ?? []} onCommit={onCommit} />;
      return <TextField label={f.label} value={typeof value === "string" ? value : String(p.default)} onCommit={onCommit} />;
    }
  }
}

// ---------------------------------------------------------------- fields (each commit = one gesture)

function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return <label className="v2-sed-field"><span>{label}</span>{children}{error && <em className="v2-sed-ferr">{error}</em>}</label>;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** A number committed on blur or Enter (Escape puts the value back); empty = undefined when optional. */
function NumField({ label, value, onCommit, min, max, step, optional }: { label: string; value: number | undefined; onCommit: (v: number | undefined) => void; min?: number; max?: number; step?: number; optional?: boolean }) {
  const [text, setText] = useState(value === undefined ? "" : fmt(value));
  useEffect(() => setText(value === undefined ? "" : fmt(value)), [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) { if (optional && value !== undefined) onCommit(undefined); else setText(value === undefined ? "" : fmt(value)); return; }
    let n = Number(t);
    if (!Number.isFinite(n)) { setText(value === undefined ? "" : fmt(value)); return; }
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setText(fmt(n));
    if (n !== value) onCommit(n);
  };
  return <Field label={label}><input type="number" inputMode="decimal" value={text} step={step} min={min} max={max} placeholder={optional ? "—" : undefined} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(value === undefined ? "" : fmt(value)); e.stopPropagation(); } }} /></Field>;
}

function Vec3Field({ label, value, onCommit }: { label: string; value: Vec3; onCommit: (v: Vec3) => void }) {
  return <fieldset className="v2-sed-vec"><legend>{label}</legend>
    {(["x", "y", "z"] as const).map((ax, i) => <NumField key={ax} label={ax} value={value[i]} onCommit={(n) => { if (n === undefined) return; const v = [...value] as Vec3; v[i] = n; onCommit(v); }} />)}
  </fieldset>;
}

/** One number or a comma-separated list, committed on blur / Enter. */
function ListField({ label, value, hint, onCommit }: { label: string; value: number | number[] | undefined; hint?: string; onCommit: (v: number | number[] | undefined) => void }) {
  const show = (v: typeof value) => (v === undefined ? "" : Array.isArray(v) ? v.map(fmt).join(", ") : fmt(v));
  const [text, setText] = useState(show(value));
  const [err, setErr] = useState<string>();
  useEffect(() => setText(show(value)), [JSON.stringify(value)]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const t = text.trim();
    if (!t) { setErr(undefined); if (value !== undefined) onCommit(undefined); return; }
    const parts = t.split(/[\s,]+/).filter(Boolean).map(Number);
    if (!parts.length || parts.some((n) => !Number.isFinite(n) || n <= 0)) { setErr("Numbers above 0"); return; }
    setErr(undefined);
    const v = parts.length === 1 ? parts[0] : parts;
    if (JSON.stringify(v) !== JSON.stringify(value)) onCommit(v);
  };
  return <Field label={label} error={err}><input type="text" inputMode="decimal" value={text} placeholder={hint} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></Field>;
}

function TextField({ label, value, onCommit, error }: { label: string; value: string; onCommit: (v: string) => void; error?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <Field label={label} error={error}><input type="text" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (text.trim() !== value) onCommit(text.trim()); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /></Field>;
}

function SelectField({ label, value, options, labels, onCommit }: { label: string; value: string; options: string[]; labels?: Record<string, string>; onCommit: (v: string) => void }) {
  return <Field label={label}><select value={value} onChange={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}>{options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}</select></Field>;
}

function CheckField({ label, value, onCommit }: { label: string; value: boolean; onCommit: (v: boolean) => void }) {
  return <label className="v2-sed-field v2-sed-check"><input type="checkbox" checked={value} onChange={(e) => onCommit(e.target.checked)} /><span>{label}</span></label>;
}

/** A colour swatch committed on the native change event (when the picker closes), not on every input. */
function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const cb = useRef(onCommit); cb.current = onCommit;
  const cur = useRef(value); cur.current = value;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const on = () => { if (el.value.toLowerCase() !== cur.current.toLowerCase()) cb.current(el.value); };
    el.addEventListener("change", on);
    return () => el.removeEventListener("change", on);
  }, []);
  useEffect(() => { if (ref.current && ref.current.value !== value.toLowerCase()) ref.current.value = value.toLowerCase(); }, [value]);
  return <Field label={label}><input ref={ref} type="color" defaultValue={value.toLowerCase()} /></Field>;
}

function NodesField({ label, nodes, value, onCommit }: { label: string; nodes: string[]; value: Record<string, boolean>; onCommit: (v: Record<string, boolean>) => void }) {
  return <fieldset className="v2-sed-nodes"><legend>{label}</legend>
    {nodes.map((n) => <label key={n} className="v2-sed-field v2-sed-check"><input type="checkbox" checked={value[n] !== false} onChange={(e) => {
      const next = { ...value };
      if (e.target.checked) delete next[n]; else next[n] = false;
      if (e.target.checked && value[n] === false && Object.keys(next).length === 0) onCommit({ [n]: true });
      else onCommit(Object.keys(next).length ? next : { [n]: true });
    }} /><span>{n}</span></label>)}
  </fieldset>;
}

/** Phone: the program preview, copied from the player's canvas while the full-screen editor covers it. */
function Mirror({ source: get }: { source: () => HTMLCanvasElement | null | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const source = useRef(get); source.current = get;
  useEffect(() => {
    let raf = 0, last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      const src = source.current(), dst = ref.current;
      if (!src || !dst || !src.width) return;
      if (dst.width !== src.width || dst.height !== src.height) { dst.width = src.width; dst.height = src.height; }
      try { dst.getContext("2d")?.drawImage(src, 0, 0); } catch { /* not ready */ }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="v2-sed-mirror"><canvas ref={ref} aria-label="Preview" /></div>;
}

/** Blob text (FileReader where `Blob.text` is missing, as in jsdom). */
function blobText(b: Blob): Promise<string> {
  if (typeof b.text === "function") return b.text();
  return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsText(b); });
}

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  addSceneEvent, addSceneLight, moveEventProblem, moveSceneEventTo, retimeSceneEvent, sceneSnapTargets, addSceneModel, addSceneObject, callTweens, clipVersion, duplicateSceneEvent, isVec3, modelAnimations, modelNodes,
  applyGizmo, gizmoModeOfProp, gizmoPropOfCall, gizmoTargetLabel, gizmoViewTime, stateAt, type GizmoValue, type SceneState,
  GIZMO_CAMERA_TARGET, gizmoLightId, gizmoLightIndex, gizmoMovesOnly, lightHasPosition, lightIdProblem, sceneLightLabel, type SceneLight,
  objectIdProblem, parseScene, removeSceneEvent, removeSceneLight, removeSceneObject, renameSceneObject, roundSec, SCENE_CAMERA, SCENE_EASES,
  SCENE_LIGHTS, SCENE_LOOPS, SCENE_SHAPES, sceneCallArgs, sceneCalls, sceneCameraBase, sceneLights, sceneSpan, sceneTracks, setSceneEventArg,
  setSceneEventCall, sourceAt, ticksToSeconds, TICKS_PER_SECOND, updateSceneEvent, updateSceneLight, updateSceneObject, updateSceneWorld,
  validateScene, versionOfPlacement, type Placement, type Project, type SceneArgField, type SceneDoc, type SceneEase, type SceneEvent,
  type SceneIssue, type SceneLightType, type SceneObject, type SceneShape, type SceneTrack, type Vec3, type RetimeEdge, type RetimeOptions,
  addSceneScript, removeSceneScript, SCENE_SCRIPT_TEMPLATES, SCRIPT_PARAM_RE, sceneScriptCode, scriptProblems, setSceneScriptCode, setSceneScriptParams,
  type SceneScriptParams,
  fogBase, lookTargetOf, postBase, SCENE_AAS, SCENE_TONE_MAPPINGS, skyBase, updateSceneLook, type SceneMaterial, type SceneMaterialType,
  addSceneAnimation, addSceneCharacter, audioVisemeFrames, autoRig, BUILTIN_CLIP_NAMES, glbInfoOfDataUrl, removeSceneAnimation, sceneClipNames,
  visemesFromEnergy, type SceneCharacter,
  addSceneCamera, cameraKeyOf, removeSceneCamera, sceneCameraDefs, sceneShots, setSceneShots, updateSceneCamera, type SceneLens,
  applyScenePreset, blockAction, checkScene, SCENE_LOOK_PRESETS, SCENE_PALETTES, SCENE_POST_PRESETS, SCENE_RIG_PRESETS, setMood, TIMES_OF_DAY, type SceneCheck,
  type ScenePalette, type ScenePostPreset, type TimeOfDay,
} from "../domain";
import { cmd, type Engine } from "../engine";
import type { BlobStore } from "../ports";
import { readAttachedFiles } from "./CodeEditor";
import { Ic } from "./Icon";
import { cachedSceneDoc, rememberSceneDoc, sceneVersion } from "./sceneAsset";
import { sceneDraftKey, sceneDrafts, type SceneDraft, type SceneDraftStore } from "./sceneDrafts";
import { SceneEditView, type EditDragPhase, type EditViewApi, type EditViewOpts, type SceneScriptIssue } from "./SceneEditView";
import { Sheet } from "./Sheet";
import { ConfirmDialog } from "./Timeline";

/**
 * What the side panel edits: the scene (name, length, background, the list of lights), the camera (P81b), one light
 * (P81b, by index in the drawn list), one object, or one event (by index).
 */
export type SceneSel = { kind: "scene" } | { kind: "camera" } | { kind: "light"; index: number } | { kind: "object"; id: string } | { kind: "event"; index: number }
  /** Scene Phase 1 (#350): world.post / fog / sky. */
  | { kind: "look"; id: LookId }
  /** Scene Phase 3 (#352): another camera (world.cameras) by id. */
  | { kind: "cam"; id: string };
type LookId = "post" | "fog" | "sky";

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
  /** P77: draw this scene for `blobKey` while a block is dragged (`undefined` puts the stored one back). */
  onPreview?: (blobKey: string, doc: SceneDoc | undefined) => void;
  /** Phone: the program preview canvas, mirrored at the top of the full-screen editor. */
  mirror?: () => HTMLCanvasElement | null | undefined;
  /** Start with this selection (tests, deep links). */
  initialSel?: SceneSel;
  /** P80: where unsaved drafts are kept (default: this device's IndexedDB). */
  drafts?: SceneDraftStore;
  /** P81a (desktop): the program preview's box; the Edit view is drawn over it (else inside the editor). */
  viewHost?: () => HTMLElement | null | undefined;
}

const LANE = 48;
/** P77: a block narrower than this gets its resize handles outside its edges, so its middle stays draggable. */
const HANDLES_INSIDE = 44 * 3;

/** P77: a drag in progress (kept in a ref; the pure result is in `Draft` state). */
interface Drag { index: number; edge: RetimeEdge; x: number; y: number; pointerId: number; live: boolean; raf: number; label: string; apply?: (d: SceneDoc) => SceneDoc; stop: (commit: boolean) => void }
interface Draft { doc: SceneDoc; index: number; edge: RetimeEdge; at: number; dur: number; snappedTo?: number; target?: string; problem?: string }

/**
 * The scene editor (P76, Phase 2 step 2.3): a scene clip's own timeline, opened from the clip (a panel in place of
 * the timeline on desktop, a full-screen sheet on the phone). One track per object plus the scene/camera track on
 * top; events are blocks labelled with their call, stacked in rows where they overlap. Selecting a block (or a track
 * header) edits it in the side panel: event time, length, ease and arguments; object base properties; world, camera
 * and lights. Objects and events can be added and deleted.
 *
 * Every committed edit (a field on blur / Enter / change, a button, a drag) is one step of the editor's own undo; the
 * preview shows the unsaved scene at once and Save stores it (P80: Replace current or Save as new version, ONE
 * project undo step), with device drafts, Cancel and the phone context toolbar.
 *
 * P81b: the Scene track holds scene-wide settings only; the camera has its own Camera track (its moves) and, like the
 * lights (one track each, no events: lights are static), is selected from its track or in the Edit view, where it
 * shows its frustum and look-at point and a light shows a helper; their gizmos only move (position, look-at point).
 *
 * P81a: the preview has a Camera view (the clip as it renders) and an Edit view (SceneEditView: the same scene page in
 * editor mode with an orbit camera, a grid and move / rotate / scale gizmos). A gizmo drag writes the selected event's
 * end value, or with Auto-key a key ending at the playhead, or the object's start value (domain/sceneGizmo.ts), as ONE
 * step of the editor's undo.
 *
 * P77 (step 2.4): blocks are dragged to retime them (mouse, pen and touch; on touch the block is selected first, so a
 * swipe over the tracks still scrolls), and the selected block's edge handles change its start or length. A drag
 * works on the scene it started from: every move applies one pure retime (domain/sceneRetime.ts) to it, the tracks
 * draw the result and the preview shows it live (`onPreview`); the release stores it as ONE undo step through the same
 * version rules, Esc or a cancelled pointer puts everything back. Edges snap to the playhead, other events and whole
 * frames (the magnet toggle, or hold Alt to flip it for one drag); times stay inside the clip's range on the scene
 * clock. Dropping a block on another object's track gives the event to that object when it has the same call. The
 * ruler scrubs the playhead (the main player follows). Arrow keys nudge the focused block or handle by a frame.
 */
export function SceneEditor(props: SceneEditorProps) {
  const { engine, project, placement, blobs, mobile, time, playing, onSeek, onTogglePlay, onClose, onPrime, onPreview, mirror } = props;
  const drafts = props.drafts ?? sceneDrafts();
  const version = versionOfPlacement(project, placement);
  const blobKey = version?.media.blobKey;
  const asset = project.assets[placement.source.assetId];
  const [loaded, setLoaded] = useState<{ key: string; doc?: SceneDoc; error?: string }>();
  const [sel, setSel] = useState<SceneSel>(props.initialSel ?? { kind: "scene" });
  const [note, setNote] = useState<string>();
  /** P82: what the Edit view page reported about Script objects (errors, time limits), until it is rebuilt. */
  const [scriptIssues, setScriptIssues] = useState<SceneScriptIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pps, setPps] = useState(mobile ? 64 : 96);
  /** P80: which dialog is open: the Save choice, the discard confirmation, or the draft restore prompt. */
  const [dialog, setDialog] = useState<"save" | "discard" | { restore: SceneDraft }>();
  /** P80 (phone): the form section open in the bottom sheet. */
  const [part, setPart] = useState<Part>();
  /** P81a: the preview mode, the gizmo settings, and the values of a gizmo drag in progress. */
  const [view, setView] = useState<"camera" | "edit">("camera");
  const [gz, setGz] = useState<EditViewOpts & { autoKey: boolean }>({ mode: "translate", axis: "free", snap: false, autoKey: false });
  const gzOptsBase = useMemo<EditViewOpts>(() => ({ mode: gz.mode, axis: gz.axis, snap: gz.snap }), [gz.mode, gz.axis, gz.snap]);
  const [gzLive, setGzLive] = useState<{ id: string; value: GizmoValue }>();
  /** P81b: with the camera selected, whether the gizmo moves its position or its look-at point. */
  const [camPart, setCamPart] = useState<"position" | "target">("position");
  /** P81b: the dragged value when the drag started (rotations are unwrapped next to it). */
  const gzFrom = useRef<GizmoValue>();
  const viewApi = useRef<EditViewApi | null>(null);
  const gzOptsMoves = useMemo<EditViewOpts>(() => ({ mode: "translate", axis: gz.axis, snap: gz.snap }), [gz.axis, gz.snap]);
  const gzMoved = useRef(false);
  const viewState = useRef<{ doc: SceneDoc; at: number; s: SceneState }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const charInput = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selKey = sel.kind === "event" ? `e${sel.index}` : sel.kind === "object" ? `o${sel.id}` : sel.kind === "light" ? `l${sel.index}` : sel.kind === "look" ? `k${sel.id}` : sel.kind === "cam" ? `m${sel.id}` : sel.kind === "camera" ? "c" : "s";
  useEffect(() => { if (panelRef.current) panelRef.current.scrollTop = 0; }, [selKey]);
  // P80 (phone): a new selection keeps a matching sheet open (e.g. Add event → the new event's Timing), else closes it.
  useEffect(() => {
    setPart((x) => {
      if (!x) return x;
      const ok: Part[] = sel.kind === "event" ? ["timing", "args"] : sel.kind === "object" ? ["props", "model", "addEvent"] : sel.kind === "camera" ? ["camera", "addEvent"]
        : sel.kind === "light" ? ["light", "addEvent"] : sel.kind === "look" ? ["look", "addEvent"] : sel.kind === "cam" ? ["camera", "addEvent"] : ["scene", "lights", "add"];
      return ok.includes(x) ? x : sel.kind === "event" ? "timing" : sel.kind === "object" ? "props" : sel.kind === "light" ? "light" : sel.kind === "look" ? "look" : sel.kind === "camera" || sel.kind === "cam" ? "camera" : undefined;
    });
  }, [selKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
  /** The scene the clip shows now (stored). */
  const stored = cachedSceneDoc(blobKey) ?? (loaded && loaded.key === blobKey ? loaded.doc : undefined);

  // P80: the editor works on its own copy of the scene with its own undo / redo; nothing reaches the project until
  // Save (one undo step there). `saved` is the scene as last saved (or loaded), so `dirty` means unsaved changes.
  const [work, setWork] = useState<Work>();
  // `put` is the only writer, so the ref always holds the newest work even when React renders an older state first
  // (a save's project update renders synchronously before the editor's own update).
  const workRef = useRef(work);
  const put = (w: Work | undefined) => { workRef.current = w; setWork(w); };
  /** Blob keys this editor saved (so the clip moving to them is not a change from outside). */
  const ours = useRef(new Set<string>());
  const [draftChecked, setDraftChecked] = useState(false);
  const dkey = sceneDraftKey(project.id, placement.id);
  useEffect(() => {
    if (!stored || !blobKey || !version) return;
    const w = workRef.current;
    if (!w) {
      put({ doc: stored, saved: stored, past: [], future: [], baseKey: blobKey, baseVersionId: version.id });
      void drafts.get(dkey).then((d) => {
        if (d && JSON.stringify(d.doc) !== JSON.stringify(stored)) setDialog({ restore: d });
        else { if (d) void drafts.delete(dkey); setDraftChecked(true); }
      }, () => setDraftChecked(true));
      return;
    }
    if (w.baseKey === blobKey) return;
    if (ours.current.has(blobKey)) { put({ ...w, baseKey: blobKey, baseVersionId: version.id }); return; }
    // The clip shows another scene now (an AI agent, the version picker, a project undo): follow it when nothing is
    // unsaved, else keep the work and say so (Save can then only add a new version).
    if (w.doc === w.saved) put({ doc: stored, saved: stored, past: [], future: [], baseKey: blobKey, baseVersionId: version.id });
    else put({ ...w, outside: true });
  }, [stored, blobKey, version?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const doc = work?.doc;
  const dirty = !!work && work.doc !== work.saved;
  // P81a: selecting a move / rotate / scale event picks the matching gizmo.
  useEffect(() => {
    if (sel.kind !== "event") return;
    const e = workRef.current?.doc.events?.[sel.index];
    if (e?.obj === SCENE_CAMERA) { if (e.call !== "fov") setCamPart(e.call === "lookAt" ? "target" : "position"); return; }
    const p = e ? gizmoPropOfCall(e.call) : undefined;
    if (p) setGz((g) => (g.mode === gizmoModeOfProp[p] ? g : { ...g, mode: gizmoModeOfProp[p] }));
  }, [selKey, !!work]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Save can't overwrite: the draft was made from another version, or the scene changed outside the editor. */
  const newOnly = !!work && (work.outside || work.restoredFrom !== undefined);
  const issues = useMemo(() => (doc ? validateScene(doc) : []), [doc]);
  // P77: while a block is dragged the tracks draw the drag's result; the forms keep showing the editor's scene.
  const [snapOn, setSnapOn] = useState(true);
  const [draft, setDraft] = useState<Draft>();
  const drag = useRef<Drag | undefined>(undefined);
  const tracksRef = useRef<HTMLDivElement>(null);
  const preview = useRef(onPreview); preview.current = onPreview;
  useEffect(() => () => drag.current?.stop(false), []);
  const viewDoc = draft?.doc ?? doc;
  const tracks = useMemo(() => (viewDoc ? sceneTracks(viewDoc, 46 / pps) : []), [viewDoc, pps]);
  /** What the preview should show for the clip's scene: the unsaved work, or the stored scene (`undefined`). */
  const shownDoc = () => { const w = workRef.current; return w && w.doc !== w.saved ? w.doc : undefined; };
  useEffect(() => {
    if (!blobKey || !dirty) return;
    preview.current?.(blobKey, doc);
    return () => preview.current?.(blobKey, undefined);
  }, [blobKey, doc, dirty]);

  // P80: autosave unsaved work as a draft on this device (debounced, and at once when the page is hidden).
  const flush = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!draftChecked || !work || !version) return;
    if (!dirty) { void drafts.delete(dkey).catch(() => undefined); flush.current = () => undefined; return; }
    const rec: SceneDraft = { key: dkey, projectId: project.id, clipId: placement.id, assetId: placement.source.assetId,
      baseVersionId: work.restoredFrom?.versionId ?? work.baseVersionId, baseBlobKey: work.restoredFrom?.blobKey ?? work.baseKey, doc: work.doc, savedAt: new Date().toISOString() };
    let done = false;
    const save = () => { if (done) return; done = true; void drafts.put(rec).catch(() => setNote("Couldn't keep a draft on this device (storage full?). Save to keep your changes.")); };
    flush.current = save;
    const t = setTimeout(save, DRAFT_DELAY_MS);
    return () => clearTimeout(t);
  }, [work, draftChecked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const now = () => flush.current();
    const vis = () => { if (document.visibilityState === "hidden") now(); };
    window.addEventListener("pagehide", now);
    document.addEventListener("visibilitychange", vis);
    return () => { window.removeEventListener("pagehide", now); document.removeEventListener("visibilitychange", vis); now(); };
  }, []);

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

  /** One edit of the editor's scene: one step of the editor's undo (nothing is stored until Save). */
  const edit: Edit = (label, fn) => {
    const w = workRef.current;
    if (!w) return Promise.resolve();
    const out = fn(w.doc);
    const r = "format" in out ? { doc: out as SceneDoc } : out;
    if (r.doc === w.doc) { if (r.note) setNote(r.note); return Promise.resolve(); }
    put({ ...w, doc: r.doc, past: [...w.past, { doc: w.doc, label }].slice(-MAX_UNDO), future: [] });
    if (r.sel) setSel(r.sel);
    setNote(r.note);
    return Promise.resolve();
  };
  const undo = () => {
    const w = workRef.current, last = w?.past.at(-1);
    if (!w || !last) return;
    put({ ...w, doc: last.doc, past: w.past.slice(0, -1), future: [{ doc: w.doc, label: last.label }, ...w.future] });
    setNote(`Undid ${last.label}.`);
  };
  const redo = () => {
    const w = workRef.current, next = w?.future[0];
    if (!w || !next) return;
    put({ ...w, doc: next.doc, past: [...w.past, { doc: w.doc, label: next.label }], future: w.future.slice(1) });
    setNote(`Redid ${next.label}.`);
  };

  /** P80: Save: store the editor's scene and point the clip at it, ONE project undo step. */
  const save = async (mode: clipVersion.VersionSaveMode) => {
    const w = workRef.current;
    const p = engine.getState().project;
    const pl = findClip(p, placement.id);
    const a = pl ? p.assets[pl.source.assetId] : undefined;
    if (!w || !pl || !a) return;
    const m: clipVersion.VersionSaveMode = newOnly ? "new" : mode;
    setBusy(true);
    try {
      const next = await sceneVersion(blobs, a, w.doc);
      onPrime?.(next.media.blobKey, w.doc);
      ours.current.add(next.media.blobKey);
      if (!engine.dispatch(cmd.addAssetVersion(a.id, next, pl.id, { mode: m, label: m === "replace" ? "Scene: replace current version" : "Scene: save as new version", remember: true }))) { setNote("The scene could not be saved."); return; }
      const after = engine.getState().project, v = versionOfPlacement(after, findClip(after, placement.id)!);
      put({ ...w, saved: w.doc, baseKey: next.media.blobKey, baseVersionId: v?.id ?? next.id, outside: undefined, restoredFrom: undefined });
      void drafts.delete(dkey).catch(() => undefined);
      const n = after.assets[a.id]?.versions.findIndex((x) => x.id === v?.id) ?? -1;
      setNote(m === "replace" ? `Saved: replaced v${n + 1}.` : `Saved as v${n + 1}.`);
    } catch (e) { setNote(`Couldn't save: ${e instanceof Error ? e.message : "failed"}`); }
    finally { setBusy(false); }
  };
  /** Close (X, Cancel, Esc): asks first when there are unsaved changes. */
  const requestClose = () => { if (drag.current) return; if (dirty) setDialog("discard"); else onClose(); };
  const discard = () => { flush.current = () => undefined; void drafts.delete(dkey).catch(() => undefined); setDialog(undefined); onClose(); };
  const restore = (d: SceneDraft) => {
    const w = workRef.current;
    setDialog(undefined); setDraftChecked(true);
    if (!w) return;
    const same = d.baseBlobKey === w.baseKey;
    put({ ...w, doc: d.doc, past: [{ doc: w.doc, label: "restore draft" }], future: [], ...(same ? {} : { restoredFrom: { versionId: d.baseVersionId, blobKey: d.baseBlobKey } }) });
    setNote(same ? "Draft restored. Save to keep it." : "Draft restored. It was made from another version, so Save adds a new version.");
  };
  const dropDraft = () => { setDialog(undefined); setDraftChecked(true); void drafts.delete(dkey).catch(() => undefined); };

  const addModel = async (files: FileList | null, character = false) => {
    if (!files?.length) return;
    const { next, notes } = await readAttachedFiles(files, {}, character ? ".glb,.vrm" : ".glb");
    const [name, data] = Object.entries(next)[0] ?? [];
    if (fileInput.current) fileInput.current.value = "";
    if (charInput.current) charInput.current.value = "";
    if (!name || !data) { setNote(notes.join(" ") || "No model was added."); return; }
    await edit(character ? "add character" : "add 3D model", (d) => {
      const r = addSceneModel(d, name, data);
      // Scene Phase 2: a character model idles instead of playing the file's first clip.
      const doc2 = character ? updateSceneObject(r.doc, r.id, { animation: undefined, character: {} }) : r.doc;
      return { doc: doc2, sel: { kind: "object", id: r.id }, note: [`Added “${r.id}” (${name})${character ? " as a character" : ""}.`, ...notes].join(" ") };
    });
  };

  const versions = asset?.versions ?? [];
  const vIndex = version ? versions.findIndex((x) => x.id === version.id) + 1 : 0;
  const errors = issues.filter((i) => i.level === "error").length;
  const header = (
    <header className="v2-sed-head">
      <button type="button" className="v2-icon v2-sed-close" aria-label="Close scene editor" title={dirty ? "Close (asks before discarding unsaved changes) · Esc" : "Close the scene editor (Esc)"} onClick={requestClose}><Ic g="✕" size={20} /></button>
      <strong className="v2-sed-title"><Ic g="scene" size={16} /> {doc?.name || asset?.name || "3D scene"}</strong>
      <span className="v2-sed-ver" title="The scene version this clip shows">v{vIndex || "?"}{dirty ? " · edited" : ""}{busy ? " · saving…" : ""}</span>
      <span className="v2-spacer" />
      <button type="button" className="v2-icon" aria-label="Undo" title={work?.past.length ? `Undo ${work.past.at(-1)!.label}` : "Undo"} disabled={!work?.past.length} onClick={undo}><Ic g="↶" size={18} /></button>
      <button type="button" className="v2-icon" aria-label="Redo" title={work?.future.length ? `Redo ${work.future[0].label}` : "Redo"} disabled={!work?.future.length} onClick={redo}><Ic g="↷" size={18} /></button>
      {!mobile && <button type="button" className="v2-btn v2-sed-cancel" onClick={requestClose} title="Close without saving (asks first when something changed)">Cancel</button>}
      <button type="button" className="v2-btn primary v2-sed-save" disabled={!dirty || busy} onClick={() => setDialog("save")} title="Save the scene: replace the current version or add a new one"><Ic g="✓" size={16} /> Save</button>
    </header>
  );

  // The editor takes the focus when its scene is ready, so its keys (Esc, Ctrl+S, Ctrl+Z) work before anything is clicked.
  const rootRef = useRef<HTMLDivElement>(null);
  const ready = !!doc;
  useEffect(() => { if (ready && !rootRef.current?.contains(document.activeElement)) rootRef.current?.focus({ preventScroll: true }); }, [ready]);

  if (!doc) {
    const err = loaded?.key === blobKey ? loaded?.error : undefined;
    return <div className={`v2-scene-editor ${mobile ? "is-phone" : "is-desk"}`} role="dialog" aria-label="Scene editor">{header}<p className="v2-abnote">{err ?? "Loading scene…"}</p></div>;
  }

  const fps = project.settings.fps > 0 ? project.settings.fps : 30;
  const retimeOpts = (index: number, snapping: boolean, base: SceneDoc): RetimeOptions => ({
    min: 0, max: outSec, fps, ...(snapping ? { snap: sceneSnapTargets(base, index, [0, localSec, inSec, outSec]), tol: 8 / pps } : {}),
  });
  const trackAt = (y: number): string | undefined => {
    for (const el of tracksRef.current?.querySelectorAll<HTMLElement>("[data-track]") ?? []) {
      const r = el.getBoundingClientRect();
      if (el.dataset.track && r.height && y >= r.top && y < r.bottom) return el.dataset.track;
    }
    return undefined;
  };
  const edgeLabel = (edge: RetimeEdge) => (edge === "move" ? "move event" : edge === "start" ? "event start" : "event length");

  /** P77: start dragging block `index` (its body moves it, a handle moves one edge). */
  const startDrag = (e: ReactPointerEvent<HTMLElement>, index: number, edge: RetimeEdge) => {
    if (e.button !== 0 || !doc || !blobKey || drag.current) return;
    const touch = e.pointerType === "touch" || e.pointerType === "pen";
    if (touch && edge === "move" && !(sel.kind === "event" && sel.index === index)) return; // swipe scrolls; a tap selects
    if (edge !== "move") e.preventDefault();
    e.stopPropagation();
    const scroll0 = tracksRef.current?.scrollLeft ?? 0;
    const base = doc, key = blobKey, from = String(base.events?.[index]?.obj), snapDefault = snapOn, save = edit;
    let last: { x: number; y: number; alt: boolean } | undefined;
    const g: Drag = { index, edge, x: e.clientX, y: e.clientY, pointerId: e.pointerId, live: false, raf: 0, label: edgeLabel(edge), stop: () => undefined };
    const compute = (x: number, y: number, alt: boolean) => {
      last = { x, y, alt };
      const opts = retimeOpts(index, snapDefault !== alt, base);
      const dx = (x - g.x + (tracksRef.current?.scrollLeft ?? 0) - scroll0) / pps;
      const r = retimeSceneEvent(base, index, edge, dx, opts);
      let target: string | undefined, problem: string | undefined;
      if (edge === "move" && Math.abs(y - g.y) > LANE / 2) { const t = trackAt(y); if (t !== undefined && t !== from) { target = t; problem = moveEventProblem(r.doc, index, t); } }
      const to = target && !problem ? target : undefined;
      g.apply = (d) => { const x2 = retimeSceneEvent(d, index, edge, dx, opts).doc; return to ? moveSceneEventTo(x2, index, to).doc : x2; };
      g.label = to ? `move event to ${to}` : edgeLabel(edge);
      const shown = to ? moveSceneEventTo(r.doc, index, to).doc : r.doc;
      setDraft({ doc: r.doc, index, edge, at: r.at, dur: r.dur, snappedTo: r.snappedTo, target, problem });
      cancelAnimationFrame(g.raf);
      g.raf = requestAnimationFrame(() => preview.current?.(key, shown));
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return;
      if (!g.live) {
        if (Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 4) return;
        g.live = true;
        setSel({ kind: "event", index });
      }
      ev.preventDefault();
      // Near an edge of the tracks the view scrolls along (as far as the pointer moves), once the pointer has really
      // gone that way: a sideways drag along the bottom row must not scroll to (and drop on) another track.
      const box = tracksRef.current, r = box?.getBoundingClientRect();
      if (box && r && r.height) {
        const goneY = Math.abs(ev.clientY - g.y) > LANE / 2, goneX = Math.abs(ev.clientX - g.x) > LANE / 2;
        const edgeY = !goneY ? 0 : ev.clientY > r.bottom - 28 ? 1 : ev.clientY < r.top + 72 && box.scrollTop > 0 ? -1 : 0;
        const edgeX = !goneX ? 0 : ev.clientX > r.right - 28 ? 1 : ev.clientX < r.left + LABEL_W(mobile) + 16 && box.scrollLeft > 0 ? -1 : 0;
        if (edgeY) box.scrollTop += edgeY * 16;
        if (edgeX) box.scrollLeft += edgeX * 16;
      }
      compute(ev.clientX, ev.clientY, ev.altKey);
    };
    const up = (ev: PointerEvent) => { if (ev.pointerId === g.pointerId) g.stop(g.live); };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === g.pointerId) g.stop(false); };
    const keys = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); g.stop(false); }
      else if (ev.key === "Alt" && g.live && last) compute(last.x, last.y, ev.type === "keydown");
    };
    g.stop = (commit) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("keyup", keys, true);
      cancelAnimationFrame(g.raf);
      if (drag.current === g) drag.current = undefined;
      const apply = g.apply;
      const done = () => { preview.current?.(key, shownDoc()); setDraft(undefined); };
      if (commit && apply) void save(g.label, (d) => apply(d)).finally(done);
      else done();
    };
    drag.current = g;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", keys, true);
    window.addEventListener("keyup", keys, true);
  };

  /** P77: arrow keys on a block (move) or a handle (one edge): one frame, ten with Shift; one undo step each. */
  const nudge = (e: React.KeyboardEvent, index: number, edge: RetimeEdge) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault(); e.stopPropagation();
    const n = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1);
    setSel({ kind: "event", index });
    void edit(edgeLabel(edge), (d) => {
      const ev = d.events?.[index];
      if (!ev) return d;
      // To the n-th whole frame from the edge (an edge between frames first goes to the next one).
      const from = edge === "end" ? ev.at + (ev.dur ?? 0) : ev.at;
      const f = from * fps, to = (n > 0 ? Math.floor(f + 1e-6) + n : Math.ceil(f - 1e-6) + n) / fps;
      return retimeSceneEvent(d, index, edge, to - from, { min: 0, max: outSec, fps, snap: [] }).doc;
    });
  };

  /** Scrub the playhead along the ruler (scene time); the main player follows. */
  const scrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget, id = e.pointerId;
    const to = (x: number) => { const r = el.getBoundingClientRect(); seekLocal((x - r.left) / pps); };
    to(e.clientX);
    const mv = (ev: PointerEvent) => { if (ev.pointerId === id) to(ev.clientX); };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  };

  const span = sceneSpan(viewDoc ?? doc, outSec) + 1;
  const width = Math.ceil(span * pps);
  const ticks: number[] = [];
  const step = pps >= 80 ? 0.5 : pps >= 40 ? 1 : 2;
  for (let s = 0; s <= span + 1e-9; s += step) ticks.push(Math.round(s * 1000) / 1000);
  const selObj = sel.kind === "object" ? doc.objects.find((o) => o.id === sel.id) : undefined;
  const pickTrack = (t: SceneTrack) => setSel(t.kind === "camera" ? (t.camera ? { kind: "cam", id: t.camera } : { kind: "camera" }) : t.kind === "light" ? { kind: "light", index: t.light ?? 0 } : t.kind === "look" ? { kind: "look", id: t.id as LookId }
    : t.kind === "scene" || t.kind === "missing" ? { kind: "scene" } : { kind: "object", id: t.id });
  /** P81b: the camera and objects have events (the Scene track is settings); Scene Phase 1 (#350): so do lights with an id, post, fog and sky. */
  const animatable = (t: SceneTrack) => t.kind === "camera" || t.kind === "shape" || t.kind === "model" || t.kind === "script" || t.kind === "character" || t.kind === "look" || (t.kind === "light" && !!t.obj);
  const addEventOn = (t: SceneTrack) => {
    const target = t.obj ?? t.id;
    const call = t.obj ? sceneCalls(doc, target)[0]?.call ?? "moveTo" : t.kind === "character" ? "walkTo" : "moveTo";
    void edit(`add ${call}`, (d) => { const r = addSceneEvent(d, target, call, atNow, 1); return { doc: r.doc, sel: { kind: "event", index: r.index } }; });
  };
  const trackIcon = (t: SceneTrack) => (t.kind === "camera" ? "camera" : t.kind === "light" ? "light" : t.kind === "look" ? "effect" : t.kind === "character" ? "person" : t.kind === "scene" ? "settings" : t.kind === "missing" ? "⚠" : t.kind === "script" ? "</>" : "scene");

  const tracksEl = (
    <div ref={tracksRef} className={`v2-sed-tracks ${draft ? "is-dragging" : ""}`} role="group" aria-label="Scene tracks">
      <div className="v2-sed-grid" style={{ width: width + LABEL_W(mobile) }}>
        <div className="v2-sed-ruler">
          <div className="v2-sed-corner" style={{ width: LABEL_W(mobile) }}>
            <button type="button" className="v2-icon" aria-label="Zoom out" title="Zoom out" onClick={() => setPps((x) => Math.max(24, Math.round(x / 1.5)))}><Ic g="zoom-out" size={16} /></button>
            <button type="button" className="v2-icon" aria-label="Zoom in" title="Zoom in" onClick={() => setPps((x) => Math.min(400, Math.round(x * 1.5)))}><Ic g="zoom-in" size={16} /></button>
          </div>
          <div className="v2-sed-scale" data-testid="scene-ruler" style={{ width }} onPointerDown={scrub} title="Tap or drag to move the playhead (scene time)">
            <span className="v2-sed-out" style={{ left: 0, width: Math.max(0, inSec * pps) }} />
            <span className="v2-sed-out" style={{ left: outSec * pps, width: Math.max(0, width - outSec * pps) }} />
            {ticks.map((s) => <span key={s} className={`v2-sed-tick ${Math.abs(s - Math.round(s)) < 1e-9 ? "is-major" : ""}`} style={{ left: s * pps }}>{Math.abs(s - Math.round(s)) < 1e-9 ? `${s}s` : ""}</span>)}
            <span className="v2-sed-knob" style={{ left: localSec * pps }} aria-hidden />
          </div>
        </div>
        {/* Scene Phase 3 (#352): the shot strip — which camera is seen when (tap a shot to edit the cameras and shots). */}
        {sceneShots(doc).length > 0 && <div className="v2-sed-shotstrip" data-testid="scene-shot-strip" style={{ height: 22, display: "flex" }}>
          <div className="v2-sed-corner" style={{ width: LABEL_W(mobile) }}><small>Shots</small></div>
          <div style={{ position: "relative", width }}>
            {(() => { const list = sceneShots(doc), all = list[0].at > 0 ? [{ at: 0, camera: SCENE_CAMERA }, ...list] : list; return all.map((x, i) => {
              const end = i + 1 < all.length ? all[i + 1].at : span;
              return <button key={i} type="button" className="v2-sed-shot" title={`${x.camera} from ${x.at}s`} onClick={() => { setSel({ kind: "scene" }); setPart(mobile ? "scene" : undefined); }}
                style={{ position: "absolute", left: x.at * pps, width: Math.max(18, (end - x.at) * pps - 2), top: 2, height: 18, fontSize: 11, overflow: "hidden", whiteSpace: "nowrap", borderRadius: 4 }}><Ic g="camera" size={11} /> {x.camera}</button>;
            }); })()}
          </div>
        </div>}
        {tracks.map((t) => {
          const on = (sel.kind === "object" && sel.id === t.id) || (sel.kind === "scene" && t.kind === "scene") || (sel.kind === "camera" && t.kind === "camera" && !t.camera)
            || (sel.kind === "light" && t.kind === "light" && sel.index === t.light) || (sel.kind === "look" && t.kind === "look" && sel.id === t.id) || (sel.kind === "cam" && t.camera === sel.id);
          const tid = t.obj ?? t.id;
          const drop = draft?.target === tid && tid ? (draft.problem ? "is-nodrop" : "is-drop") : "";
          return <div key={t.id || "missing"} className={`v2-sed-track kind-${t.kind} ${on ? "is-sel" : ""} ${drop}`} style={{ height: t.rows * LANE + 4 }}>
            <div className="v2-sed-thead" style={{ width: LABEL_W(mobile) }}>
              <button type="button" className="v2-sed-tname" aria-pressed={on} title={`${t.label} · ${t.detail}`} onClick={() => pickTrack(t)}>
                <Ic g={trackIcon(t)} size={16} /><span>{t.label}</span>
              </button>
              {animatable(t) && <button type="button" className="v2-icon v2-sed-tadd" aria-label={`Add event to ${t.label}`} title={`Add an event to ${t.label} at the playhead`} onClick={() => addEventOn(t)}><Ic g="＋" size={16} /></button>}
            </div>
            <div className="v2-sed-lane" data-track={animatable(t) ? tid : undefined} style={{ width }}>
              {(t.kind === "scene" || (t.kind === "light" && !t.obj)) && <span className="v2-sed-lanehint">{t.kind === "scene" ? "Scene settings (no events)" : `${t.detail} · give it an id to animate it`}</span>}
              <span className="v2-sed-out" style={{ left: 0, width: Math.max(0, inSec * pps) }} />
              <span className="v2-sed-out" style={{ left: outSec * pps, width: Math.max(0, width - outSec * pps) }} />
              {t.blocks.map((b) => {
                const isSel = sel.kind === "event" && sel.index === b.index;
                const bad = issues.some((i) => i.level === "error" && (i.path === `events[${b.index}]` || i.path.startsWith(`events[${b.index}].`)));
                const w = Math.max(b.dur * pps, 44), top = b.row * LANE + 2;
                const inside = w >= HANDLES_INSIDE;
                const name = `${t.label}.${b.call}`;
                const handle = (edge: "start" | "end") => <span key={edge} role="slider" tabIndex={0} className={`v2-sed-handle is-${edge} ${inside ? "is-inside" : ""}`}
                  aria-label={`${edge === "start" ? "Start" : "End"} of ${name}`} aria-valuemin={0} aria-valuemax={+outSec.toFixed(3)} aria-valuenow={edge === "start" ? b.at : +b.end.toFixed(3)} aria-valuetext={`${edge === "start" ? b.at : +b.end.toFixed(3)}s`}
                  title={edge === "start" ? "Drag to change when it starts (the end stays)" : "Drag to change how long it lasts"}
                  style={{ left: edge === "start" ? b.at * pps - (inside ? 0 : 44) : b.at * pps + w - (inside ? 44 : 0), top }}
                  onPointerDown={(e) => startDrag(e, b.index, edge)} onKeyDown={(e) => nudge(e, b.index, edge)} />;
                return [<button key={b.index} type="button" className={`v2-sed-block ${b.dur ? "has-dur" : "is-instant"} ${isSel ? "is-sel" : ""} ${bad ? "is-bad" : ""} ${draft?.index === b.index ? "is-drag" : ""}`}
                  style={{ left: b.at * pps, width: w, top }}
                  aria-pressed={isSel} aria-label={`${name} at ${b.at}s${b.dur ? ` for ${b.dur}s` : ""}`} title={`${b.call} · ${b.at}s${b.dur ? ` → ${+(b.end).toFixed(3)}s` : ""} · drag to move${isSel ? "" : " (on touch: tap first)"}`}
                  onPointerDown={(e) => startDrag(e, b.index, "move")} onKeyDown={(e) => nudge(e, b.index, "move")}
                  onClick={() => setSel({ kind: "event", index: b.index })}>
                  <span>{b.call}</span>
                </button>, ...(isSel && b.dur > 0 ? [handle("start"), handle("end")] : [])];
              })}
            </div>
          </div>;
        })}
        <div className="v2-sed-playhead" style={{ left: LABEL_W(mobile) + localSec * pps }} aria-hidden />
        {draft?.snappedTo !== undefined && <div className="v2-sed-guide" data-testid="scene-snap-guide" style={{ left: LABEL_W(mobile) + draft.snappedTo * pps }} aria-hidden />}
      </div>
    </div>
  );

  const selEventNow = sel.kind === "event" ? doc.events?.[sel.index] : undefined;
  const selLight: SceneLight | undefined = sel.kind === "light" ? sceneLights(doc).lights[sel.index] : undefined;
  const form = (pt?: Part) => sel.kind === "event" && selEventNow
    ? <EventForm key={`e${sel.index}`} doc={doc} index={sel.index} ev={selEventNow} issues={issues} edit={edit} part={pt} onSeek={() => seekLocal(selEventNow.at)} onDeleted={() => setSel(ownerSel(doc, selEventNow.obj))} atNow={atNow} />
    : sel.kind === "object" && selObj ? <ObjectForm key={`o${selObj.id}`} doc={doc} obj={selObj} issues={issues} edit={edit} part={pt} atNow={atNow} runIssues={scriptIssues.filter((x) => x.id === selObj.id)} />
      : sel.kind === "camera" ? <CameraForm doc={doc} issues={issues} edit={edit} part={pt} atNow={atNow} />
        : sel.kind === "cam" ? <CameraForm key={`m${sel.id}`} id={sel.id} doc={doc} issues={issues} edit={edit} part={pt} atNow={atNow} onDeleted={() => setSel({ kind: "scene" })} />
        : sel.kind === "light" && selLight ? <LightForm key={`l${sel.index}`} doc={doc} index={sel.index} light={selLight} issues={issues} edit={edit} part={pt} atNow={atNow} onDeleted={() => setSel({ kind: "scene" })} />
          : sel.kind === "look" ? <LookForm key={`k${sel.id}`} doc={doc} id={sel.id} issues={issues} edit={edit} part={pt} atNow={atNow} onRemoved={() => setSel({ kind: "scene" })} />
            : <SceneForm doc={doc} edit={edit} part={pt} issues={issues} onPickLight={(i) => setSel({ kind: "light", index: i })} onPickCamera={() => setSel({ kind: "camera" })} onPickLook={(id) => setSel({ kind: "look", id })} atNow={atNow} onPickCam={(id) => setSel({ kind: "cam", id })} onSeek={seekLocal} />;
  const panel = (
    <div ref={panelRef} className="v2-sed-panel" aria-label="Edit selection">
      {form()}
      {note && <p className="v2-abnote" role="status">{note}</p>}
    </div>
  );

  const addMenu = (
    <div className="v2-sed-addmenu" role="menu" aria-label="Add object">
      {SCENE_SHAPES.map((s) => <button key={s} type="button" role="menuitem" onClick={() => { setAdding(false); setPart(undefined); void edit(`add ${s}`, (d) => { const r = addSceneObject(d, s); return { doc: r.doc, sel: { kind: "object", id: r.id } }; }); }}><Ic g="scene" size={16} /> {s[0].toUpperCase() + s.slice(1)}</button>)}
      <button type="button" role="menuitem" className="v2-sed-addglb" onClick={() => { setAdding(false); setPart(undefined); fileInput.current?.click(); }}><Ic g="⇪" size={16} /> GLB model…</button>
      {/* Scene Phase 2 (#351): characters — the built-in mannequin, or a VRoid .vrm / humanoid .glb. */}
      <p className="v2-sed-addhead" role="presentation"><Ic g="person" size={14} /> Character</p>
      <button type="button" role="menuitem" data-testid="scene-add-character" onClick={() => { setAdding(false); setPart(undefined); void edit("add character", (d) => { const r = addSceneCharacter(d); return { doc: r.doc, sel: { kind: "object", id: r.id } }; }); }}><Ic g="person" size={16} /> Mannequin</button>
      <button type="button" role="menuitem" onClick={() => { setAdding(false); setPart(undefined); charInput.current?.click(); }}><Ic g="⇪" size={16} /> VRM / humanoid GLB…</button>
      <p className="v2-sed-addhead" role="presentation"><Ic g="</>" size={14} /> Script (three.js code)</p>
      {SCENE_SCRIPT_TEMPLATES.map((t) => <button key={t.id} type="button" role="menuitem" title={t.description} data-template={t.id}
        onClick={() => { setAdding(false); setPart(undefined); void edit(`add ${t.label.toLowerCase()} script`, (d) => { const r = addSceneScript(d, t.id); return { doc: r.doc, sel: { kind: "object", id: r.id }, note: `Added “${r.id}”, a Script object (${t.label}). Its code and params are under Script.` }; }); }}>
        <Ic g={SCRIPT_ICON[t.id] ?? "</>"} size={16} /> {t.label}</button>)}
    </div>
  );
  const toolbar = (
    <div className="v2-sed-bar">
      <button type="button" className="v2-icon v2-sed-play" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} onClick={onTogglePlay}><Ic g={playing ? "❚❚" : "▶"} size={18} /></button>
      <span className="v2-sed-time" title="Scene time at the playhead">{localSec.toFixed(2)}s</span>
      <button type="button" className={`v2-icon v2-sed-snap ${snapOn ? "is-on" : ""}`} aria-pressed={snapOn} aria-label="Snap" title={`Snapping ${snapOn ? "on" : "off"}: edges land on the playhead, other events and whole frames (hold Alt while dragging to flip)`} onClick={() => setSnapOn((x) => !x)}><Ic g="🧲" size={18} /></button>
      {draft && <span className={`v2-sed-drag ${draft.problem ? "is-bad" : ""}`} role="status" data-testid="scene-drag-status">{draft.problem
        ?? `${draft.at}s${draft.dur ? ` → ${+(draft.at + draft.dur).toFixed(3)}s` : ""}${draft.snappedTo !== undefined ? " · snapped" : ""}${draft.target ? ` · to ${draft.target}` : ""}`}</span>}
      <div className="v2-sed-viewtoggle" role="group" aria-label="Preview">
        <button type="button" aria-pressed={view === "camera"} aria-label="Camera view" title="Camera view: the shot as the clip renders it" onClick={() => setView("camera")}><Ic g="camera" size={18} /><span>{mobile ? "Shot" : "Camera view"}</span></button>
        <button type="button" aria-pressed={view === "edit"} aria-label="Edit view" title="Edit view: orbit around the scene, pick objects and move, rotate or scale them" onClick={() => setView("edit")}><Ic g="move3d" size={18} /><span>{mobile ? "Edit" : "Edit view"}</span></button>
      </div>
      <span className="v2-spacer" />
      {errors > 0 && <span className="v2-sed-errs" title="Problems in the scene (select an item to see its own)"><Ic g="⚠" size={14} /> {errors}</span>}
      {!mobile && <div className="v2-sed-addwrap">
        <button type="button" className="v2-btn v2-sed-addobj" aria-expanded={adding} onClick={() => setAdding((x) => !x)}><Ic g="＋" size={16} /> Add object</button>
        {adding && addMenu}
      </div>}
      <input ref={fileInput} type="file" accept=".glb,model/gltf-binary" hidden data-testid="scene-editor-model-input" onChange={(e) => void addModel(e.currentTarget.files)} />
      <input ref={charInput} type="file" accept=".vrm,.glb" hidden data-testid="scene-editor-character-input" onChange={(e) => void addModel(e.currentTarget.files, true)} />
    </div>
  );

  // P81a: the Edit view with its floating chip bar (gizmo mode, axis, snap, Auto-key, reset view).
  // P81b: the camera (its position or look-at point, by camPart) and lights with a position are gizmo targets too.
  const camId = camPart === "target" ? GIZMO_CAMERA_TARGET : SCENE_CAMERA;
  const gzObjId = sel.kind === "object" ? sel.id : sel.kind === "camera" ? camId : sel.kind === "light" ? gizmoLightId(sel.index)
    : sel.kind === "event" ? (selEventNow?.obj === SCENE_CAMERA ? camId : selEventNow?.obj) : undefined;
  const gzSel = !gzObjId ? undefined : gzObjId === SCENE_CAMERA || gzObjId === GIZMO_CAMERA_TARGET ? gzObjId
    : gizmoLightIndex(gzObjId) !== undefined ? (selLight && lightHasPosition(selLight) ? gzObjId : undefined)
      : doc.objects.some((o) => o.id === gzObjId) ? gzObjId : undefined;
  const movesOnly = !!gzSel && gizmoMovesOnly(gzSel);
  const gzMode = movesOnly ? "translate" as const : gz.mode;
  const gzO = { selEvent: sel.kind === "event" ? sel.index : undefined, autoKey: gz.autoKey, at: atNow };
  const editDoc = draft?.doc ?? doc;
  const viewAt = gizmoViewTime(editDoc, gzSel, gzMode, gzO);
  const gzOpts = gzMode === gz.mode ? gzOptsBase : gzOptsMoves;
  if (!viewState.current || viewState.current.doc !== editDoc || viewState.current.at !== viewAt) viewState.current = { doc: editDoc, at: viewAt, s: stateAt(editDoc, viewAt) };
  const onGizmo = (phase: EditDragPhase, id: string, value: GizmoValue) => {
    if (phase === "start") gzFrom.current = value;
    if (phase === "start" || phase === "move") { gzMoved.current = phase === "move"; setGzLive({ id, value }); return; }
    setGzLive(undefined);
    if (phase === "cancel") { setNote("Drag cancelled."); return; }
    // A press on a handle that never moved (a tap on the gizmo) changes nothing: no undo step, no "edited".
    if (!gzMoved.current) return;
    gzMoved.current = false;
    const mode = gizmoMovesOnly(id) ? "translate" : gz.mode, o = { ...gzO, from: gzFrom.current };
    const what = id === GIZMO_CAMERA_TARGET ? "camera target" : gizmoLightIndex(id) !== undefined ? "light" : id;
    void edit(`${mode === "translate" ? "move" : mode} ${what}`, (d) => { const r = applyGizmo(d, id, mode, value, o); return { doc: r.doc, note: r.note }; });
  };
  const onPick = (id: string | null) => {
    if (!id) { setSel({ kind: "scene" }); return; }
    if (id === SCENE_CAMERA || id === GIZMO_CAMERA_TARGET) {
      const part = id === GIZMO_CAMERA_TARGET ? "target" : "position";
      setCamPart(part);
      // A selected camera event stays selected when it moves the part that was picked.
      const keep = sel.kind === "event" && selEventNow?.obj === SCENE_CAMERA && (selEventNow.call === "lookAt") === (part === "target");
      if (!keep) setSel({ kind: "camera" });
      return;
    }
    const li = gizmoLightIndex(id);
    if (li !== undefined) { setSel({ kind: "light", index: li }); return; }
    if (gzSel !== id || sel.kind !== "event") setSel({ kind: "object", id });
  };
  const gzChip = (label: string, icon: string, on: boolean, run: () => void, title = label, text = !mobile, disabled = false) =>
    <button type="button" className={`v2-sed-chip${on ? " is-on" : ""}`} aria-pressed={on} aria-label={label} title={title} disabled={disabled} onClick={run}><Ic g={icon} size={18} />{text && <span>{label}</span>}</button>;
  const editLights = sceneLights(editDoc).lights;
  const aspect = project.settings.width > 0 && project.settings.height > 0 ? project.settings.width / project.settings.height : 16 / 9;
  const fmtV = (v: Vec3) => v.map((x) => +x.toFixed(2)).join(", ");
  const gzInfo = gzLive
    ? `${gzLive.id === GIZMO_CAMERA_TARGET ? "Look-at point" : gzMode === "translate" ? "Position" : gzMode === "rotate" ? "Rotation°" : "Scale"} ${fmtV(gzMode === "rotate" && gzFrom.current
      ? gzLive.value.rotation.map((x, k) => x + 360 * Math.round((gzFrom.current!.rotation[k] - x) / 360)) as Vec3
      : gzLive.value[gzMode === "translate" ? "position" : gzMode === "rotate" ? "rotation" : "scale"])}`
    : gzSel ? `Drag writes ${gizmoTargetLabel(doc, gzSel, gzMode, gzO)}${viewAt !== atNow ? ` · showing ${viewAt}s` : ""}`
      : sel.kind === "light" ? `${selLight ? sceneLightLabel(selLight, sel.index) : "This light"} is ${selLight?.type ?? "a"} light: it lights from everywhere, so it has nothing to move`
      : mobile ? "Tap an object to select it · one finger orbits · two fingers pan and zoom" : "Click an object to select it · drag to orbit · right-drag to pan · wheel to zoom";
  // P82: on the phone the hint is a strip under the Edit view (over the 3D view it covered handles near the top).
  const gzInfoEl = <p className={`v2-sed-gzinfo${mobile ? " is-strip" : ""}`} role="status" data-testid="scene-gizmo-info" title={gzInfo}>{gzInfo}</p>;
  const editView = view === "edit" && (
    <div className="v2-sed-editview" data-testid="scene-edit-view">
      <SceneEditView doc={editDoc} state={viewState.current.s} sel={gzSel} opts={gzOpts} touch={mobile} onPick={onPick} onDrag={onGizmo} api={viewApi}
        lights={editLights} aspect={aspect} onScriptIssues={setScriptIssues} />
      {gzSel === SCENE_CAMERA || gzSel === GIZMO_CAMERA_TARGET ? <div className="v2-sed-chips is-modes" role="toolbar" aria-label="Camera gizmo">
        {gzChip("Move camera", "camera", camPart === "position", () => setCamPart("position"), "Move the camera (its position)", false)}
        {gzChip("Move look-at point", "track", camPart === "target", () => setCamPart("target"), "Move the point the camera looks at", false)}
      </div> : <div className="v2-sed-chips is-modes" role="toolbar" aria-label="Gizmo">
        {gzChip("Move", "move3d", gzMode === "translate", () => setGz((g) => ({ ...g, mode: "translate" })), "Move (W)", false)}
        {gzChip("Rotate", "rotate3d", gzMode === "rotate", () => setGz((g) => ({ ...g, mode: "rotate" })), movesOnly ? "Lights can only be moved" : "Rotate (E)", false, movesOnly)}
        {gzChip("Scale", "scale3d", gzMode === "scale", () => setGz((g) => ({ ...g, mode: "scale" })), movesOnly ? "Lights can only be moved" : "Scale (R)", false, movesOnly)}
      </div>}
      <div className="v2-sed-chips is-opts" role="toolbar" aria-label="Gizmo options">
        <div className="v2-sed-axes" role="group" aria-label="Axis">
          {(["x", "y", "z", "free"] as const).map((a) => <button key={a} type="button" className={`v2-sed-chip is-axis is-${a}${gz.axis === a ? " is-on" : ""}`} aria-pressed={gz.axis === a}
            aria-label={a === "free" ? "Free (all axes)" : `${a.toUpperCase()} axis only`} title={a === "free" ? "All axes" : `Only the ${a.toUpperCase()} axis`} onClick={() => setGz((g) => ({ ...g, axis: a }))}>{a === "free" ? "Free" : a.toUpperCase()}</button>)}
        </div>
        {gzChip("Snap", "🧲", gz.snap, () => setGz((g) => ({ ...g, snap: !g.snap })), "Snap: 0.25 units, 15°, 0.1 scale steps")}
        {gzChip("Auto-key", "key", gz.autoKey, () => setGz((g) => ({ ...g, autoKey: !g.autoKey })), "Auto-key: a drag adds or updates an event that ends at the playhead (else it changes the start value)")}
        {gzChip("Reset view", "focus", false, () => viewApi.current?.home(), "Back to the starting view: the scene camera and what it looks at")}
      </div>
      {!mobile && gzInfoEl}
    </div>
  );
  const viewHost = !mobile && editView ? props.viewHost?.() : undefined;

  // P80 (phone): context actions for the selection, like the main timeline's bottom toolbar; a section opens in a sheet.
  const ctxTool = (icon: string, label: string, run: () => void, opts: { on?: boolean; danger?: boolean; title?: string } = {}) =>
    <button key={label} type="button" className={`v2-tool${opts.on ? " is-on" : ""}${opts.danger ? " v2-sed-danger" : ""}`} aria-pressed={opts.on} title={opts.title ?? label} onClick={run}><b aria-hidden><Ic g={icon} /></b><span>{label}</span></button>;
  const open = (pt: Part) => setPart((x) => (x === pt ? undefined : pt));
  const ctxTools: JSX.Element[] = sel.kind === "event" && selEventNow ? [
    ctxTool("⇔", "Timing", () => open("timing"), { on: part === "timing", title: "Call, start, duration and ease" }),
    ...(sceneCallArgs(doc, selEventNow.obj, selEventNow.call).length ? [ctxTool("⤧", "Values", () => open("args"), { on: part === "args", title: "The call's arguments (where it moves to, its value…)" })] : []),
    ctxTool("⇤", "Go to", () => seekLocal(selEventNow.at), { title: "Move the playhead to this event" }),
    ctxTool("⧉", "Duplicate", () => void edit("duplicate event", (d) => { const r = duplicateSceneEvent(d, sel.index); return { doc: r.doc, sel: { kind: "event", index: r.index } }; })),
    ctxTool("🗑", "Delete", () => { const back: SceneSel = ownerSel(doc, selEventNow.obj); const i = sel.index; void edit("delete event", (d) => removeSceneEvent(d, i)); setSel(back); }, { danger: true, title: "Delete this event" }),
  ] : sel.kind === "object" && selObj ? [
    ctxTool("⤧", "Properties", () => open("props"), { on: part === "props", title: "Id, shape, size, colour, position, rotation, scale, visibility" }),
    ...(typeof selObj.model === "string" ? [ctxTool("anim-loop", "Animation", () => open("model"), { on: part === "model", title: "The model's animation and parts from 0 s" })] : []),
    ...(selObj.script ? [ctxTool("</>", "Script", () => open("script"), { on: part === "script", title: "The object's three.js code and params" })] : []),
    ctxTool("◆", "Add event", () => open("addEvent"), { on: part === "addEvent", title: `Add an event at the playhead (${atNow}s)` }),
    ctxTool("🗑", "Delete", () => { const id = selObj.id; void edit("delete object", (d) => { const r = removeSceneObject(d, id); return { doc: r.doc, sel: { kind: "scene" }, note: `Deleted “${id}”${r.removedEvents ? ` and ${r.removedEvents} event${r.removedEvents === 1 ? "" : "s"}` : ""}.` }; }); }, { danger: true, title: "Delete this object and its events" }),
  ] : sel.kind === "camera" ? [
    ctxTool("camera", "Start", () => open("camera"), { on: part === "camera", title: "The camera at 0 s: field of view, position, look-at point" }),
    ctxTool("◆", "Add event", () => open("addEvent"), { on: part === "addEvent", title: `Add a camera move at the playhead (${atNow}s)` }),
    ctxTool("move3d", "Move", () => { setCamPart("position"); setView("edit"); }, { on: view === "edit" && camPart === "position", title: "Move the camera in the Edit view" }),
    ctxTool("track", "Aim", () => { setCamPart("target"); setView("edit"); }, { on: view === "edit" && camPart === "target", title: "Move the point the camera looks at in the Edit view" }),
  ] : sel.kind === "light" && selLight ? [
    ctxTool("light", "Light", () => open("light"), { on: part === "light", title: "Id, type, colour, intensity, position" }),
    ...(lightHasPosition(selLight) ? [ctxTool("move3d", "Move", () => setView("edit"), { on: view === "edit", title: "Move it in the Edit view" })] : []),
    ...(selLight.id && sceneCalls(doc, selLight.id).length ? [ctxTool("◆", "Add event", () => open("addEvent"), { on: part === "addEvent", title: `Add a light change at the playhead (${atNow}s)` })] : []),
    ctxTool("🗑", "Delete", () => { const i = sel.index; void edit("delete light", (d) => removeSceneLight(d, i)); setSel({ kind: "scene" }); }, { danger: true, title: "Delete this light" }),
  ] : sel.kind === "cam" ? [
    ctxTool("camera", "Camera", () => open("camera"), { on: part === "camera", title: "This camera's start values and lens" }),
    ctxTool("◆", "Add event", () => open("addEvent"), { on: part === "addEvent", title: `Add a camera move at the playhead (${atNow}s)` }),
  ] : sel.kind === "look" ? [
    ctxTool("effect", LOOK_NAME[sel.id], () => open("look"), { on: part === "look", title: `world.${sel.id} at 0 s` }),
    ctxTool("◆", "Add event", () => open("addEvent"), { on: part === "addEvent", title: `Add a change at the playhead (${atNow}s)` }),
  ] : [
    ctxTool("＋", "Add object", () => open("add"), { on: part === "add", title: "Add a shape, a GLB model or a Script object" }),
    ctxTool("settings", "Scene", () => open("scene"), { on: part === "scene", title: "Name, planned length, background" }),
    ctxTool("camera", "Camera", () => setSel({ kind: "camera" }), { title: "Select the camera" }),
    ctxTool("light", "Lights", () => open("lights"), { on: part === "lights", title: "Lights" }),
    ctxTool("scene", "Direct", () => open("direct"), { on: part === "direct", title: "Look and rig presets, mood, blocking from text, check the scene" }),
  ];
  const ctxBar = (
    <nav className="v2-toolbar v2-sed-ctx" aria-label={sel.kind === "event" ? "Event actions" : sel.kind === "object" ? "Object actions" : sel.kind === "camera" ? "Camera actions" : sel.kind === "light" ? "Light actions" : "Scene actions"}>
      {sel.kind !== "scene" && <button type="button" className="v2-tool v2-tool-back" aria-label="Back to the scene" title="Back to the scene" onClick={() => { setSel({ kind: "scene" }); setPart(undefined); }}><b aria-hidden><Ic g="anim-in" /></b></button>}
      <div className="v2-toolbar-scroll">{ctxTools}</div>
    </nav>
  );
  const partSheet = mobile && part && (part === "add"
    ? <Sheet label="Add object" className="v2-msheet-insp v2-sed-sheet" snaps={[0.45, 0.7]} initial={0} onClose={() => setPart(undefined)}>{addMenu}</Sheet>
    : <Sheet label={PART_LABEL[part]} className="v2-msheet-insp v2-sed-sheet" snaps={[0.45, 0.7, 0.9]} initial={0} onClose={() => setPart(undefined)}>{form(part)}</Sheet>);

  const lastMode = clipVersion.versionSaveModeOf(engine.getState().project);
  const nextNo = versions.length + 1;
  const dialogs = <>
    {dialog === "save" && <ChoiceDialog title="Save scene" onCancel={() => setDialog(undefined)} note={newOnly ? (work?.outside ? "The clip shows a scene changed outside the editor, so your changes are saved as a new version." : "Your restored draft was made from another version, so it is saved as a new version.") : undefined}
      choices={[
        { id: "replace", title: "Replace current", text: `Overwrite v${vIndex}. Other clips using v${vIndex} update too.`, disabled: newOnly, focus: lastMode === "replace" && !newOnly, run: () => { setDialog(undefined); void save("replace"); } },
        { id: "new", title: "Save as new version", text: `Keep v${vIndex} and add v${nextNo}; this clip shows v${nextNo}.`, focus: lastMode !== "replace" || newOnly, run: () => { setDialog(undefined); void save("new"); } },
      ]} />}
    {dialog === "discard" && <ConfirmDialog title="Discard unsaved changes?" message="The edits you made to this scene since the last save will be lost." confirm="Discard" onCancel={() => setDialog(undefined)} onConfirm={discard} />}
    {dialog && typeof dialog === "object" && <ChoiceDialog title="Restore unsaved changes?" onCancel={dropDraft} cancelLabel="Discard draft"
      note={draftNote(dialog.restore, work, versions)}
      choices={[{ id: "restore", title: "Restore", text: `Continue the draft kept on this device (${new Date(dialog.restore.savedAt).toLocaleString()}).`, focus: true, run: () => restore(dialog.restore) }]} />}
  </>;
  const banner = work?.outside && <p className="v2-sed-banner" role="status" data-testid="scene-outside">
    <Ic g="alert" size={16} /> <span>This scene was changed outside the editor (for example by an AI agent). Your unsaved changes are kept; Save adds them as a new version.</span>
    <button type="button" className="v2-btn" onClick={() => { if (stored && blobKey && version) put({ doc: stored, saved: stored, past: [], future: [], baseKey: blobKey, baseVersionId: version.id }); setNote("Loaded the scene the clip shows now."); }}>Load the new scene</button>
  </p>;

  return (
    <div ref={rootRef} tabIndex={-1} className={`v2-scene-editor ${mobile ? "is-phone" : "is-desk"}`} role="dialog" aria-label="Scene editor" data-testid="scene-editor" onKeyDown={(e) => {
      // Inside the editor the app's shortcuts are off (it is a dialog); these few work here, never in a field.
      // Esc: a field with typed changes reverts them first (it stops the key); otherwise it closes the editor (asking
      // first when there are unsaved changes).
      if (dialog) return;
      if (e.key === "Escape" && gzLive) { e.preventDefault(); viewApi.current?.cancel(); return; }
      if (e.key === "Escape") { if (!drag.current) { e.preventDefault(); if (part) setPart(undefined); else requestClose(); } return; }
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === "s") { e.preventDefault(); if (dirty) setDialog("save"); return; }
      if ((e.target as HTMLElement).closest?.("input,select,textarea")) return;
      if (mod && (k === "z" || k === "y")) { e.preventDefault(); if (k === "y" || e.shiftKey) redo(); else undo(); }
      else if (e.key === " " && !mod) { e.preventDefault(); onTogglePlay(); }
      else if (view === "edit" && !mod && (k === "w" || k === "e" || k === "r")) { e.preventDefault(); const mode = k === "w" ? "translate" : k === "e" ? "rotate" : "scale"; setGz((g) => ({ ...g, mode })); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel.kind === "event") { e.preventDefault(); const i = sel.index; void edit("delete event", (d) => removeSceneEvent(d, i)); setSel({ kind: "scene" }); }
    }}>
      {header}
      {banner}
      {mobile && (editView || (mirror && <Mirror source={mirror} />))}
      {mobile && editView && gzInfoEl}
      {!mobile && editView && (viewHost ? createPortal(editView, viewHost) : editView)}
      {toolbar}
      {mobile ? <>
        <div className="v2-sed-body">{tracksEl}</div>
        {note && <p className="v2-abnote v2-sed-note" role="status">{note}</p>}
        {ctxBar}
        {partSheet}
      </> : <div className="v2-sed-body">{tracksEl}{panel}</div>}
      {dialogs}
    </div>
  );
}

/** P80: the editor's working copy: the scene, its own undo / redo, and the scene as last saved. */
interface Work {
  doc: SceneDoc;
  saved: SceneDoc;
  past: { doc: SceneDoc; label: string }[];
  future: { doc: SceneDoc; label: string }[];
  /** The stored scene the work started from (the clip's blob key and version when loaded or last saved). */
  baseKey: string;
  baseVersionId: string;
  /** The clip moved to a scene changed outside the editor while there were unsaved changes. */
  outside?: boolean;
  /** A restored draft made from another stored scene than the clip shows. */
  restoredFrom?: { versionId: string; blobKey: string };
}
const MAX_UNDO = 200;
/** P80: autosave delay after the last edit. */
export const DRAFT_DELAY_MS = 600;
/** P80 (phone): the form sections the context toolbar opens in a sheet. */
export type Part = "add" | "scene" | "camera" | "lights" | "light" | "look" | "props" | "model" | "script" | "addEvent" | "timing" | "args" | "direct";
const PART_LABEL: Record<Part, string> = { add: "Add object", scene: "Scene", camera: "Camera at 0 s", lights: "Lights", light: "Light", look: "Look", props: "Properties", model: "Animation", script: "Script", addEvent: "Add event", timing: "Timing", args: "Values", direct: "Direct" };

function draftNote(d: SceneDraft, work: Work | undefined, versions: { id: string }[]): string {
  if (!work || d.baseBlobKey === work.baseKey) return "You closed the editor without saving. Restore the draft to keep working on it, or discard it.";
  const n = versions.findIndex((v) => v.id === d.baseVersionId) + 1;
  const cur = versions.findIndex((v) => v.id === work.baseVersionId) + 1;
  const from = n ? (d.baseVersionId === work.baseVersionId ? `v${n}, which was replaced since` : `v${n}`) : "a version that no longer exists";
  return `This draft was made from ${from}; the clip shows v${cur || "?"} now. Restoring keeps the draft, and Save adds it as a new version.`;
}

/** P80: a small modal with large choices (Save: replace or new version; restore a draft). */
function ChoiceDialog({ title, choices, note, onCancel, cancelLabel = "Cancel" }: {
  title: string; note?: string; onCancel: () => void; cancelLabel?: string;
  choices: { id: string; title: string; text: string; disabled?: boolean; focus?: boolean; run: () => void }[];
}) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onCancel]);
  return (
    <div className="v2-menu-backdrop v2-confirm-backdrop" onPointerDown={onCancel}>
      <div className="v2-confirm v2-sed-choices" role="alertdialog" aria-modal="true" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
        <h4>{title}</h4>
        {note && <p>{note}</p>}
        {choices.map((c) => <button key={c.id} type="button" className="v2-sed-choice" data-choice={c.id} disabled={c.disabled} autoFocus={c.focus} onClick={c.run}><b>{c.title}</b><span>{c.text}</span></button>)}
        <div className="v2-confirm-actions"><button type="button" className="v2-btn" onClick={onCancel}>{cancelLabel}</button></div>
      </div>
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

/** Scene Phase 1 (#350): the names of world.post / fog / sky in the editor. */
const LOOK_NAME: Record<LookId, string> = { post: "Post", fog: "Fog", sky: "Sky" };
const LOOK_IDS: LookId[] = ["post", "fog", "sky"];
/** Where the editor goes when an event of `obj` is deleted: its camera, light, look or object. */
function ownerSel(doc: SceneDoc, obj: string): SceneSel {
  if (obj === SCENE_CAMERA) return { kind: "camera" };
  if (cameraKeyOf(doc, obj)) return { kind: "cam", id: obj };
  const look = lookTargetOf(doc, obj);
  if (look?.kind === "light") { const i = sceneLights(doc).lights.findIndex((l) => l.id === obj); return i >= 0 ? { kind: "light", index: i } : { kind: "scene" }; }
  if (look) return { kind: "look", id: look.kind as LookId };
  return { kind: "object", id: obj };
}
const worldOf = (doc: SceneDoc): Record<string, unknown> => (doc.world && typeof doc.world === "object" ? doc.world as Record<string, unknown> : {});
const objOrUndef = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : v === true ? {} : undefined);

/** Scene Phase 1: the look entries a new one starts with (visible at once, all editable). */
function newLook(doc: SceneDoc, id: LookId): Record<string, unknown> {
  if (id === "post") return { toneMapping: "aces", bloom: true, vignette: 0.2 };
  if (id === "fog") return { color: sceneCameraBase(doc).background, near: 8, far: 40 };
  const sun = sceneLights(doc).lights.find((l) => l.type === "directional" && l.id);
  return { elevation: 25, azimuth: 200, ...(sun ? { light: sun.id } : {}) };
}

/** Read a picked file as a data: URL. */
const fileDataUrl = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(f); });

function SceneForm({ doc, edit, part, issues, atNow, onPickLight, onPickCamera, onPickLook, onPickCam, onSeek }: { doc: SceneDoc; edit: Edit; part?: Part; issues: SceneIssue[]; atNow: number; onPickLight: (i: number) => void; onPickCamera: () => void; onPickLook: (id: LookId) => void; onPickCam: (id: string) => void; onSeek: (s: number) => void }) {
  const w = worldOf(doc);
  const env = objOrUndef(w.environment);
  const envInput = useRef<HTMLInputElement>(null);
  const ss = (objOrUndef(w.export)?.supersample as number | undefined) ?? 1;
  const base = sceneCameraBase(doc);
  const { lights, defaults } = sceneLights(doc);
  const all = !part;
  return <div className="v2-sed-form" data-testid="scene-form">
    {all && <h4><Ic g="settings" size={16} /> Scene</h4>}
    {(all || part === "scene") && <>
      <TextField label="Name" value={doc.name ?? ""} onCommit={(v) => edit("rename scene", (d) => ({ ...d, name: v || undefined }) as SceneDoc)} />
      <NumField label="Planned length (s)" value={doc.durationSec} min={0.1} step={0.5} optional onCommit={(v) => edit("planned length", (d) => (v === undefined ? (({ durationSec: _x, ...r }) => (void _x, r as SceneDoc))(d) : { ...d, durationSec: v }))} />
      <ColorField label="Background" value={base.background} onCommit={(v) => edit("background", (d) => updateSceneWorld(d, { background: v }))} />
      {/* Scene Phase 1 (#350): the look — post-processing, fog, sky, environment map, export supersampling. */}
      <h5><Ic g="effect" size={14} /> Look</h5>
      <div className="v2-sed-picklist" role="list" aria-label="Look">
        {LOOK_IDS.map((id) => (objOrUndef(w[id]) ? <button key={id} type="button" role="listitem" className="v2-btn v2-sed-pick" onClick={() => onPickLook(id)} title={`Edit world.${id}`}><Ic g="effect" size={16} /> <span>{LOOK_NAME[id]}</span></button>
          : <button key={id} type="button" role="listitem" className="v2-btn" onClick={() => void edit(`add ${id}`, (d) => ({ doc: updateSceneLook(d, id, newLook(d, id)), sel: { kind: "look", id } }))}><Ic g="＋" size={16} /> {LOOK_NAME[id]}</button>))}
      </div>
      <Field label="Environment map">
        <span className="v2-sed-row">
          <small>{env ? String(env.file) : "none"}</small>
          <button type="button" className="v2-btn" onClick={() => envInput.current?.click()}>{env ? "Replace…" : "Add .hdr / image…"}</button>
          {env && <button type="button" className="v2-btn" onClick={() => void edit("remove environment", (d) => updateSceneLook(d, "environment", undefined))}>Remove</button>}
        </span>
        <input ref={envInput} type="file" hidden accept=".hdr,.jpg,.jpeg,.png,.webp" onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          void fileDataUrl(f).then((url) => edit("environment map", (d) => {
            const name = f.name.replace(/[^A-Za-z0-9 _.()-]/g, "_").replace(/^[^A-Za-z0-9]+/, "") || "environment.hdr";
            return updateSceneLook({ ...d, files: { ...(d.files ?? {}), [name]: url } }, "environment", { file: name });
          }));
        }} />
      </Field>
      {env && <CheckField label="Show the environment as the background" value={env.background === true} onCommit={(v) => edit("environment background", (d) => updateSceneLook(d, "environment", { background: v || undefined }))} />}
      <SelectField label="Export supersampling" value={String(ss)} options={["1", "2", "3", "4"]} labels={{ 1: "Off", 2: "2× (smoother edges)", 3: "3×", 4: "4×" }}
        onCommit={(v) => edit("export supersampling", (d) => updateSceneLook(d, "export", v === "1" ? undefined : { supersample: Number(v) }))} />
      <Problems list={[...issuesAt(issues, "world.environment"), ...issuesAt(issues, "world.export")]} />
      <AnimationLibrary doc={doc} edit={edit} issues={issues} />
      <CamerasAndShots doc={doc} edit={edit} issues={issues} atNow={atNow} onPickCamera={onPickCamera} onPickCam={onPickCam} />
    </>}
    {(all || part === "direct") && <DirectSection doc={doc} edit={edit} atNow={atNow} onSeek={onSeek} all={all} />}
    {(all || part === "lights") && <>
      {all ? <h5><Ic g="light" size={14} /> Lights {defaults && <small>(default lighting)</small>}</h5> : defaults && <p className="v2-abnote">Default lighting: change or add a light to set your own.</p>}
      <div className="v2-sed-picklist" role="list" aria-label="Lights">
        {lights.map((l, i) => <button key={i} type="button" role="listitem" className="v2-btn v2-sed-pick" onClick={() => onPickLight(i)} title="Edit this light">
          <Ic g="light" size={16} /> <span>{sceneLightLabel(l, i)}</span> <small>{l.type}</small></button>)}
      </div>
      <button type="button" className="v2-btn" onClick={() => void edit("add light", (d) => { const n = sceneLights(d).lights.length; return { doc: addSceneLight(d), sel: { kind: "light", index: n } }; })}><Ic g="＋" size={16} /> Add light</button>
    </>}
    {all && <>
      <h5><Ic g="camera" size={14} /> Camera</h5>
      <button type="button" className="v2-btn v2-sed-pick" onClick={onPickCamera}><Ic g="camera" size={16} /> <span>Camera</span> <small>{base.fov}° · at {base.position.join(", ")}</small></button>
      <p className="v2-abnote">Tap a track name to edit the camera, a light or an object, or a block to edit an event. Camera moves are events on the Camera track (＋).</p>
    </>}
  </div>;
}


/**
 * Scene Phase 4 (#353): direct the scene — the same semantic operations the agent uses (domain/sceneStage.ts): a look
 * preset, the mood (time of day, palette, post), a camera rig preset, blocking from plain text at the playhead, and the
 * automatic checks with a Go to per problem. Each apply is one editor undo step.
 */
function DirectSection({ doc, edit, atNow, onSeek, all }: { doc: SceneDoc; edit: Edit; atNow: number; onSeek: (s: number) => void; all: boolean }) {
  const [look, setLook] = useState(SCENE_LOOK_PRESETS[0].id);
  const [tod, setTod] = useState<string>("");
  const [palette, setPalette] = useState<string>("");
  const [post, setPost] = useState<string>("");
  const [overTime, setOverTime] = useState(false);
  const [rig, setRig] = useState(SCENE_RIG_PRESETS[0].id);
  const chars = doc.objects.filter((o) => o.character).map((o) => o.id);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string>();
  const [checks, setChecks] = useState<SceneCheck[]>();
  const subj = subject || chars[0] || doc.objects.find((o) => o.shape !== "plane")?.id || "";
  const apply = (label: string, fn: (d: SceneDoc) => { doc: SceneDoc; notes: string[] } | { error: string }) => {
    let out: string | undefined;
    // Success shows as the editor's note; a refusal (nothing changes) shows here.
    void edit(label, (d) => { const r = fn(d); if ("error" in r) { out = r.error; return d; } return { doc: r.doc, note: r.notes.join(" ") }; }).then(() => setMsg(out));
  };
  return <>
    {all && <h5><Ic g="scene" size={14} /> Direct</h5>}
    <Field label="Look preset">
      <span className="v2-sed-row">
        <select aria-label="Look preset" value={look} onChange={(e) => setLook(e.target.value)}>{SCENE_LOOK_PRESETS.map((p) => <option key={p.id} value={p.id} title={p.description}>{p.label}</option>)}</select>
        <button type="button" className="v2-btn" data-testid="scene-apply-look" onClick={() => apply(`look: ${look}`, (d) => applyScenePreset(d, look))}>Apply</button>
      </span>
    </Field>
    <div className="v2-sed-row v2-sed-wrap">
      <SelectField label="Time of day" value={tod} options={["", ...TIMES_OF_DAY]} labels={{ "": "—" }} onCommit={setTod} />
      <SelectField label="Palette" value={palette} options={["", ...SCENE_PALETTES]} labels={{ "": "—" }} onCommit={setPalette} />
      <SelectField label="Post" value={post} options={["", ...SCENE_POST_PRESETS]} labels={{ "": "—" }} onCommit={setPost} />
    </div>
    {tod && <CheckField label={`Change to it over time from the playhead (${atNow}s)`} value={overTime} onCommit={setOverTime} />}
    <button type="button" className="v2-btn" data-testid="scene-apply-mood" disabled={!tod && !palette && !post} onClick={() => apply("mood", (d) => setMood(d, {
      ...(tod ? { timeOfDay: tod as TimeOfDay } : {}), ...(palette ? { palette: palette as ScenePalette } : {}), ...(post ? { post: post as ScenePostPreset } : {}), ...(tod && overTime ? { at: atNow, dur: 6 } : {}),
    }))}><Ic g="effect" size={16} /> Apply mood</button>
    <Field label={`Camera rig at ${atNow}s`}>
      <span className="v2-sed-row">
        <select aria-label="Camera rig" value={rig} onChange={(e) => setRig(e.target.value)}>{SCENE_RIG_PRESETS.map((p) => <option key={p.id} value={p.id} title={p.description}>{p.label}</option>)}</select>
        <select aria-label="Rig subject" value={subj} onChange={(e) => setSubject(e.target.value)}>{doc.objects.filter((o) => o.shape !== "plane").map((o) => <option key={o.id} value={o.id}>{o.name || o.id}</option>)}</select>
        <button type="button" className="v2-btn" onClick={() => apply(`rig: ${rig}`, (d) => applyScenePreset(d, rig, { at: atNow, subject: subj || undefined }))}>Add</button>
      </span>
    </Field>
    <Field label={`Blocking from ${atNow}s`}>
      <textarea className="v2-sed-blocking" aria-label="Blocking" rows={3} value={text} placeholder={chars.length ? `${chars[0]} walks to the door, turns to camera and waves. Camera pushes in.` : "Add a character first (Add > Character), then: Ana walks to the door, camera pushes in."} onChange={(e) => setText(e.target.value)} />
    </Field>
    <button type="button" className="v2-btn" data-testid="scene-block" disabled={!text.trim()} onClick={() => {
      let out: string | undefined;
      void edit("block action", (d) => {
        const r = blockAction(d, { text, at: atNow });
        if ("error" in r) { out = r.error; return d; }
        out = r.skipped.length ? `Skipped: ${r.skipped.map((x) => `“${x.text}” (${x.why})`).join(" ")}` : undefined;
        return { doc: r.doc, note: `${r.beats.length} beat${r.beats.length === 1 ? "" : "s"} until ${r.endSec}s.${r.notes.length ? ` ${r.notes.join(" ")}` : ""}` };
      }).then(() => { setMsg(out); });
    }}><Ic g="person" size={16} /> Block it</button>
    <button type="button" className="v2-btn" data-testid="scene-check" onClick={() => setChecks(checkScene(doc))}><Ic g="alert" size={16} /> Check scene</button>
    {msg && <p className="v2-abnote" role="status">{msg}</p>}
    {checks && (checks.length ? <ul className="v2-scene-list v2-scene-issues" aria-label="Scene check" data-testid="scene-checks">
      {checks.map((c, i) => <li key={i} className={`is-${c.level}`}><button type="button" className="v2-linkbtn" onClick={() => onSeek(c.at)}>{c.at}s</button> {c.message}{c.fix ? <small> {c.fix}</small> : null}</li>)}
    </ul> : <p className="v2-abnote" role="status" data-testid="scene-checks">No problems found: nothing intersects, the characters are in frame and in view, and no camera is inside an object.</p>)}
  </>;
}

/** P81b: the camera: its start values (world.camera) and adding a camera move. */
function CameraForm({ doc, issues, edit, part, atNow, id = SCENE_CAMERA, onDeleted }: { doc: SceneDoc; issues: SceneIssue[]; edit: Edit; part?: Part; atNow: number; id?: string; onDeleted?: () => void }) {
  const def = sceneCameraDefs(doc).find((c) => c.id === id) ?? sceneCameraDefs(doc)[0];
  const raw = id === SCENE_CAMERA ? (doc.world?.camera ?? {}) : (doc.world?.cameras ?? []).find((c) => c.id === id) ?? {};
  const lens: SceneLens = raw.lens ?? {};
  const all = !part;
  const calls = sceneCalls(doc, id);
  const [call, setCall] = useState("moveTo");
  const put = (label: string, patch: Record<string, unknown>) => edit(label, (d) => updateSceneCamera(d, id, patch));
  const putLens = (label: string, patch: Partial<SceneLens>) => { const next = Object.fromEntries(Object.entries({ ...lens, ...patch }).filter(([, v]) => v !== undefined)); return put(label, { lens: Object.keys(next).length ? next : undefined }); };
  const path = id === SCENE_CAMERA ? "world.camera" : `world.cameras[${(doc.world?.cameras ?? []).findIndex((c) => c.id === id)}]`;
  const ids = doc.objects.map((o) => o.id);
  return <div className="v2-sed-form" data-testid="camera-form">
    {all && <h4><Ic g="camera" size={16} /> {id === SCENE_CAMERA ? "Camera" : def.name || id}</h4>}
    {(all || part === "camera") && <>
      {all && <h5>At 0 s</h5>}
      {id !== SCENE_CAMERA && <TextField label="Name" value={def.name ?? ""} onCommit={(v) => put("camera name", { name: v || undefined })} />}
      {lens.focalLength === undefined && <NumField label="Field of view (°)" value={r1(def.fov)} min={2} max={178} step={1} onCommit={(v) => put("camera fov", { fov: v })} />}
      <NumField label="Focal length (mm)" value={lens.focalLength} min={4} max={1200} step={1} optional onCommit={(v) => putLens("focal length", { focalLength: v })} />
      {lens.focalLength !== undefined && <NumField label="Sensor width (mm)" value={lens.sensor ?? 36} min={4} max={100} step={0.5} onCommit={(v) => putLens("sensor", { sensor: v === 36 ? undefined : v })} />}
      <Vec3Field label="Position" value={def.position} onCommit={(v) => put("camera position", { position: v })} />
      <Vec3Field label="Looks at" value={def.target} onCommit={(v) => put("camera target", { lookAt: v })} />
      <SelectField label="Focus on" value={typeof lens.focus === "string" ? lens.focus : lens.focus !== undefined ? "#d" : ""} options={["", "#d", ...ids]} labels={{ "": "— (post settings)", "#d": "A distance" }}
        onCommit={(v) => putLens("focus", { focus: v === "" ? undefined : v === "#d" ? 5 : v })} />
      {typeof lens.focus === "number" && <NumField label="Focus distance" value={lens.focus} min={0.01} step={0.1} onCommit={(v) => putLens("focus distance", { focus: v ?? 5 })} />}
      <NumField label="f-stop" value={lens.fStop} min={0.7} max={64} step={0.1} optional onCommit={(v) => putLens("f-stop", { fStop: v })} />
      <Problems list={issuesAt(issues, path)} />
      <p className="v2-abnote">{id === SCENE_CAMERA ? "In the Edit view, drag the camera or its look-at point (the yellow dot). " : "Show this camera from a time on with a shot (Scene > Shots). "}Focus and f-stop drive the depth of field when the scene's post-processing has it.</p>
      {all && id !== SCENE_CAMERA && <button type="button" className="v2-btn v2-sed-danger" onClick={() => { void edit("delete camera", (d) => removeSceneCamera(d, id)); onDeleted?.(); }}><Ic g="🗑" size={16} /> Delete camera</button>}
    </>}
    {(all || part === "addEvent") && <>
      <h5>Add a camera move at {atNow}s</h5>
      <div className="v2-sed-row">
        <select aria-label="Call" value={call} onChange={(e) => setCall(e.target.value)}>{calls.map((c) => <option key={c.call} value={c.call} title={c.description}>{c.call}</option>)}</select>
        <button type="button" className="v2-btn" onClick={() => void edit(`add ${call}`, (d) => { const r = addSceneEvent(d, id, call, atNow, 1); return { doc: r.doc, sel: { kind: "event", index: r.index } }; })}><Ic g="＋" size={16} /> Add event</button>
      </div>
    </>}
  </div>;
}
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Scene Phase 3 (#352): the cameras and the shots (which camera is seen from when). */
function CamerasAndShots({ doc, edit, issues, atNow, onPickCamera, onPickCam }: { doc: SceneDoc; edit: Edit; issues: SceneIssue[]; atNow: number; onPickCamera: () => void; onPickCam: (id: string) => void }) {
  const cams = sceneCameraDefs(doc);
  const shots = doc.shots ?? [];
  const label = (id: string) => (id === SCENE_CAMERA ? "Camera" : cams.find((c) => c.id === id)?.name || id);
  return <>
    <h5><Ic g="camera" size={14} /> Cameras and shots</h5>
    <div className="v2-sed-picklist" role="list" aria-label="Cameras">
      {cams.map((c) => <button key={c.id} type="button" role="listitem" className="v2-btn v2-sed-pick" onClick={() => (c.id === SCENE_CAMERA ? onPickCamera() : onPickCam(c.id))}><Ic g="camera" size={16} /> <span>{label(c.id)}</span> <small>{r1(c.fov)}°</small></button>)}
    </div>
    <button type="button" className="v2-btn" data-testid="scene-add-camera" onClick={() => void edit("add camera", (d) => { const r = addSceneCamera(d, atNow); return { doc: r.doc, sel: { kind: "cam", id: r.id } }; })}><Ic g="＋" size={16} /> Add camera (from the view at {atNow}s)</button>
    <div role="list" aria-label="Shots" className="v2-sed-shots">
      {shots.map((x, i) => <span key={i} role="listitem" className="v2-sed-row">
        <NumField label={`Shot ${i + 1} at (s)`} value={x.at} min={0} step={0.1} onCommit={(v) => edit("shot time", (d) => setSceneShots(d, (d.shots ?? []).map((y, k) => (k === i ? { ...y, at: v ?? 0 } : y))))} />
        <SelectField label="Camera" value={x.camera} options={cams.map((c) => c.id)} labels={Object.fromEntries(cams.map((c) => [c.id, label(c.id)]))} onCommit={(v) => edit("shot camera", (d) => setSceneShots(d, (d.shots ?? []).map((y, k) => (k === i ? { ...y, camera: v } : y))))} />
        <button type="button" className="v2-icon" aria-label={`Remove shot ${i + 1}`} onClick={() => void edit("remove shot", (d) => setSceneShots(d, (d.shots ?? []).filter((_, k) => k !== i)))}><Ic g="✕" size={14} /></button>
      </span>)}
    </div>
    <button type="button" className="v2-btn" data-testid="scene-add-shot" onClick={() => void edit("add shot", (d) => {
      const list = sceneShots(d), cur = list.filter((x) => x.at <= atNow).pop()?.camera ?? SCENE_CAMERA;
      const ids = sceneCameraDefs(d).map((c) => c.id), next = ids[(ids.indexOf(cur) + 1) % ids.length];
      return setSceneShots(d, [...(d.shots ?? []), { at: atNow, camera: next }]);
    })}><Ic g="＋" size={16} /> Cut at {atNow}s</button>
    <p className="v2-abnote">A shot shows a camera from its time on: one scene becomes a sequence of camera angles.</p>
    <Problems list={issuesAt(issues, "shots")} />
  </>;
}

/** P81b: one light (by index in the drawn list): id, type, colour, intensity, position. Lights are static. */
function LightForm({ doc, index: i, light: l, issues, edit, part, atNow, onDeleted }: { doc: SceneDoc; index: number; light: SceneLight; issues: SceneIssue[]; edit: Edit; part?: Part; atNow: number; onDeleted: () => void }) {
  const all = !part;
  const { defaults } = sceneLights(doc);
  const [idErr, setIdErr] = useState<string>();
  const live = !defaults && !!l.id && lookTargetOf(doc, l.id)?.kind === "light";
  const calls = live ? sceneCalls(doc, l.id!) : [];
  const shadow = objOrUndef(l.shadow);
  const sunDriven = !!l.id && objOrUndef(worldOf(doc).sky)?.light === l.id;
  return <div className="v2-sed-form" data-testid="light-form">
    {(all || part === "light") && <>
    {all && <h4><Ic g="light" size={16} /> {sceneLightLabel(l, i)} <small>{l.type} light</small></h4>}
    {defaults && <p className="v2-abnote">Default lighting: a change here writes the default lights into the scene first.</p>}
    <TextField label="Id" value={l.id ?? ""} error={idErr} onCommit={(v) => {
      const why = lightIdProblem(doc, i, v); setIdErr(why);
      if (!why && v !== (l.id ?? "")) void edit("light id", (d) => updateSceneLight(d, i, { id: v || undefined }));
    }} />
    <SelectField label="Type" value={l.type} options={[...SCENE_LIGHTS]} onCommit={(v) => edit("light type", (d) => updateSceneLight(d, i, { type: v as SceneLightType }))} />
    <ColorField label="Colour" value={l.color ?? "#ffffff"} onCommit={(v) => edit("light colour", (d) => updateSceneLight(d, i, { color: v }))} />
    <NumField label="Intensity" value={l.intensity ?? 1} min={0} step={0.1} onCommit={(v) => edit("light intensity", (d) => updateSceneLight(d, i, { intensity: v }))} />
    {lightHasPosition(l) && <Vec3Field label="Position" value={l.position ?? [0, 3, 2]} onCommit={(v) => edit("light position", (d) => updateSceneLight(d, i, { position: v }))} />}
    {l.type === "directional" && <Vec3Field label="Aims at" value={l.lookAt ?? [0, 0, 0]} onCommit={(v) => edit("light aim", (d) => updateSceneLight(d, i, { lookAt: v[0] || v[1] || v[2] ? v : undefined }))} />}
    {l.type === "hemisphere" && <ColorField label="Ground colour" value={l.groundColor ?? "#303040"} onCommit={(v) => edit("light ground colour", (d) => updateSceneLight(d, i, { groundColor: v }))} />}
    {lightHasPosition(l) && <>
      <CheckField label="Casts shadows" value={!!l.shadow} onCommit={(v) => edit(v ? "light shadows" : "no light shadows", (d) => updateSceneLight(d, i, { shadow: v ? true : undefined }))} />
      {l.shadow && <>
        <SelectField label="Shadow detail" value={String(shadow?.mapSize ?? 2048)} options={["512", "1024", "2048", "4096"]} onCommit={(v) => edit("shadow detail", (d) => updateSceneLight(d, i, { shadow: { ...shadow, mapSize: Number(v) } }))} />
        <NumField label="Shadow softness" value={(shadow?.radius as number | undefined) ?? 2} min={0} max={25} step={0.5} onCommit={(v) => edit("shadow softness", (d) => updateSceneLight(d, i, { shadow: { ...shadow, radius: v } }))} />
        {l.type === "directional" && <NumField label="Shadow area (units)" value={(shadow?.area as number | undefined) ?? 10} min={0.5} max={500} step={1} onCommit={(v) => edit("shadow area", (d) => updateSceneLight(d, i, { shadow: { ...shadow, area: v } }))} />}
      </>}
    </>}
    <p className="v2-abnote">{lightHasPosition(l) ? "Drag it in the Edit view to move it. " : "An ambient or hemisphere light lights from everywhere, so it has no position. "}
      {sunDriven ? "The sky's sun places this light (world.sky.light). " : ""}
      {live ? "Its values here are from 0 s; change it over time with events on its track (＋)." : defaults ? "" : "Give it an id to change it over time with events."}</p>
    <Problems list={defaults ? [] : issuesAt(issues, `world.lights[${i}]`)} />
    {all && <button type="button" className="v2-btn v2-sed-danger" onClick={() => { void edit("delete light", (d) => removeSceneLight(d, i)); onDeleted(); }}><Ic g="🗑" size={16} /> Delete light</button>}
    </>}
    {live && (all || part === "addEvent") && <AddLookEvent doc={doc} obj={l.id!} calls={calls.map((c) => c.call)} atNow={atNow} edit={edit} />}
  </div>;
}

/** Scene Phase 2 (#351): a character's body (the mannequin), clips, blinking and, for a GLB, its bone map. */
function CharacterFields({ doc, obj, set }: { doc: SceneDoc; obj: SceneObject; set: (label: string, patch: Partial<SceneObject>) => unknown }) {
  const ch: SceneCharacter = obj.character ?? {};
  const put = (label: string, patch: Partial<SceneCharacter>) => set(label, { character: Object.fromEntries(Object.entries({ ...ch, ...patch }).filter(([, v]) => v !== undefined)) as SceneCharacter });
  const body = ch.body ?? {};
  const putBody = (label: string, patch: Record<string, unknown>) => put(label, { body: Object.fromEntries(Object.entries({ ...body, ...patch }).filter(([, v]) => v !== undefined)) });
  const clips = sceneClipNames(doc);
  const model = typeof obj.model === "string" ? obj.model : undefined;
  const glbRig = model && /\.glb$/i.test(model) && typeof doc.files?.[model] === "string" ? (() => { const names = glbInfoOfDataUrl(doc.files![model])?.nodeNames; return names ? autoRig(names) : undefined; })() : undefined;
  return <>
    <h5><Ic g="person" size={14} /> Character</h5>
    {!model && <>
      <NumField label="Height" value={body.height ?? 1.7} min={0.3} max={4} step={0.05} onCommit={(v) => putBody("height", { height: v })} />
      <ColorField label="Skin" value={body.skin ?? "#e8c4a0"} onCommit={(v) => putBody("skin", { skin: v })} />
      <ColorField label="Top" value={body.cloth ?? "#4a7bd0"} onCommit={(v) => putBody("top colour", { cloth: v })} />
      <ColorField label="Trousers" value={body.pants ?? "#2f3542"} onCommit={(v) => putBody("trousers colour", { pants: v })} />
      <ColorField label="Hair" value={body.hair ?? "#3b2a20"} onCommit={(v) => putBody("hair colour", { hair: v })} />
    </>}
    {model && /\.vrm$/i.test(model) && <p className="v2-abnote">A VRM character: its humanoid bones and expressions come from the file.</p>}
    {glbRig && <p className="v2-abnote">{glbRig.missing.length ? `Bones found automatically, except ${glbRig.missing.join(", ")} (those parts won't move; map them with "rig" in the JSON).` : "All the humanoid bones were found automatically."}</p>}
    <SelectField label="Idle clip" value={ch.idle ?? "idle"} options={clips} onCommit={(v) => put("idle clip", { idle: v === "idle" ? undefined : v })} />
    <SelectField label="Walk clip" value={ch.walk ?? "walk"} options={clips} onCommit={(v) => put("walk clip", { walk: v === "walk" ? undefined : v })} />
    <SelectField label="Run clip" value={ch.run ?? "run"} options={clips} onCommit={(v) => put("run clip", { run: v === "run" ? undefined : v })} />
    <CheckField label="Blinks" value={ch.blink !== false} onCommit={(v) => put(v ? "blinking" : "no blinking", { blink: v ? undefined : false })} />
    <p className="v2-abnote">Add events to make it walk (walkTo), turn, look at something or the camera, sit, gesture, change its expression, speak (lip sync) or pick something up.</p>
  </>;
}

/** Scene Phase 2: the animation library (clips from animation-only GLBs, e.g. Mixamo exports). */
function AnimationLibrary({ doc, edit, issues }: { doc: SceneDoc; edit: Edit; issues: SceneIssue[] }) {
  const input = useRef<HTMLInputElement>(null);
  const lib = doc.animations ?? {};
  return <>
    <h5><Ic g="anim-loop" size={14} /> Animations</h5>
    <p className="v2-abnote">Built-in: {BUILTIN_CLIP_NAMES.join(", ")}. Add an animation GLB (e.g. from Mixamo) to use its clip on any character.</p>
    <div className="v2-sed-picklist" role="list" aria-label="Animation library">
      {Object.entries(lib).map(([n, a]) => <span key={n} role="listitem" className="v2-sed-row"><Ic g="anim-loop" size={14} /> <span>{n}</span> <small>{a.file}</small>
        <button type="button" className="v2-icon" aria-label={`Remove ${n}`} onClick={() => void edit("remove animation", (d) => removeSceneAnimation(d, n))}><Ic g="🗑" size={14} /></button></span>)}
    </div>
    <button type="button" className="v2-btn" onClick={() => input.current?.click()}><Ic g="＋" size={16} /> Add animation GLB…</button>
    <input ref={input} type="file" accept=".glb" hidden data-testid="scene-animation-input" onChange={(e) => {
      const f = e.target.files?.[0]; e.target.value = "";
      if (!f) return;
      void fileDataUrl(f).then((url) => edit("add animation", (d) => { const r = addSceneAnimation(d, f.name, url); return { doc: r.doc, note: `Added the animation “${r.name}”.` }; }));
    }} />
    <Problems list={issuesAt(issues, "animations")} />
  </>;
}

/** Scene Phase 2: speak visemes — how many keys, and computing them from an audio file (decoded here, analysed purely). */
function VisemeField({ label, value, onCommit }: { label: string; value: unknown; onCommit: (v: unknown) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string>();
  const n = Array.isArray(value) ? value.length : 0;
  return <Field label={label}>
    <span className="v2-sed-row">
      <small>{n ? `${n} keys` : "none (the text is used)"}</small>
      <button type="button" className="v2-btn" onClick={() => input.current?.click()}>{busy ?? "From audio file…"}</button>
      {n > 0 && <button type="button" className="v2-btn" onClick={() => onCommit(undefined)}>Clear</button>}
    </span>
    <input ref={input} type="file" accept="audio/*" hidden onChange={(e) => {
      const f = e.target.files?.[0]; e.target.value = "";
      if (!f) return;
      setBusy("Analysing…");
      void f.arrayBuffer().then(async (buf) => {
        const ctx = new OfflineAudioContext(1, 1, 22050);
        const audio = await ctx.decodeAudioData(buf);
        const mono = new Float32Array(audio.length);
        for (let c = 0; c < audio.numberOfChannels; c++) { const d = audio.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / audio.numberOfChannels; }
        onCommit(visemesFromEnergy(audioVisemeFrames(mono, audio.sampleRate), 0.01));
      }).catch(() => setBusy("Couldn't read that audio")).finally(() => setTimeout(() => setBusy(undefined), 1500));
    }} />
  </Field>;
}

/** Scene Phase 1 (#350): an add-event row for a light, "post", "fog" or "sky". */
function AddLookEvent({ doc, obj, calls, atNow, edit }: { doc: SceneDoc; obj: string; calls: string[]; atNow: number; edit: Edit }) {
  const [call, setCall] = useState(calls[0] ?? "");
  const pick = calls.includes(call) ? call : calls[0] ?? "";
  return <>
    <h5>Add a change at {atNow}s</h5>
    <div className="v2-sed-row">
      <select aria-label="Call" value={pick} onChange={(e) => setCall(e.target.value)}>{sceneCalls(doc, obj).map((c) => <option key={c.call} value={c.call} title={c.description}>{c.call}</option>)}</select>
      <button type="button" className="v2-btn" disabled={!pick} onClick={() => void edit(`add ${pick}`, (d) => { const r = addSceneEvent(d, obj, pick, atNow, 1); return { doc: r.doc, sel: { kind: "event", index: r.index } }; })}><Ic g="＋" size={16} /> Add event</button>
    </div>
  </>;
}

/** Scene Phase 1: world.post / fog / sky at 0 s, adding a change over time, removing it. */
function LookForm({ doc, id, issues, edit, part, atNow, onRemoved }: { doc: SceneDoc; id: LookId; issues: SceneIssue[]; edit: Edit; part?: Part; atNow: number; onRemoved: () => void }) {
  const all = !part;
  const w = worldOf(doc);
  const raw = objOrUndef(w[id]);
  const live = !!raw && lookTargetOf(doc, id)?.kind === id;
  const put = (label: string, patch: Record<string, unknown>) => edit(label, (d) => updateSceneLook(d, id, patch));
  const sub = (key: string, label: string, patch: Record<string, unknown>) => put(label, { [key]: { ...(objOrUndef(raw?.[key]) ?? {}), ...patch } });
  const toggle = (key: string, label: string, on: boolean) => put(label, { [key]: on ? true : undefined });
  let body: ReactNode = null;
  if (raw && id === "post") {
    const p = postBase(w)!;
    body = <>
      <SelectField label="Tone mapping" value={p.toneMapping} options={[...SCENE_TONE_MAPPINGS]} onCommit={(v) => put("tone mapping", { toneMapping: v })} />
      <NumField label="Exposure" value={p.exposure} min={0} max={8} step={0.05} onCommit={(v) => put("exposure", { exposure: v })} />
      <NumField label="Contrast" value={p.contrast} min={0} max={3} step={0.05} onCommit={(v) => put("contrast", { contrast: v })} />
      <NumField label="Saturation" value={p.saturation} min={0} max={3} step={0.05} onCommit={(v) => put("saturation", { saturation: v })} />
      <Vec3Field label="Lift (shadows r, g, b)" value={p.lift} onCommit={(v) => put("lift", { lift: v })} />
      <Vec3Field label="Gamma (midtones r, g, b)" value={p.gamma} onCommit={(v) => put("gamma", { gamma: v })} />
      <Vec3Field label="Gain (highlights r, g, b)" value={p.gain} onCommit={(v) => put("gain", { gain: v })} />
      <NumField label="Vignette" value={p.vignette} min={0} max={1} step={0.05} onCommit={(v) => put("vignette", { vignette: v })} />
      <NumField label="Film grain" value={p.grain} min={0} max={1} step={0.05} onCommit={(v) => put("grain", { grain: v })} />
      <CheckField label="Bloom" value={!!p.bloom} onCommit={(v) => toggle("bloom", "bloom", v)} />
      {p.bloom && <>
        <NumField label="Bloom strength" value={p.bloom.strength} min={0} max={5} step={0.05} onCommit={(v) => sub("bloom", "bloom strength", { strength: v })} />
        <NumField label="Bloom radius" value={p.bloom.radius} min={0} max={1} step={0.05} onCommit={(v) => sub("bloom", "bloom radius", { radius: v })} />
        <NumField label="Bloom threshold" value={p.bloom.threshold} min={0} max={2} step={0.05} onCommit={(v) => sub("bloom", "bloom threshold", { threshold: v })} />
      </>}
      <CheckField label="Depth of field" value={!!p.dof} onCommit={(v) => toggle("dof", "depth of field", v)} />
      {p.dof && <>
        <NumField label="Focus distance" value={p.dof.focus} min={0.01} max={500} step={0.1} onCommit={(v) => sub("dof", "focus distance", { focus: v })} />
        <NumField label="Aperture" value={p.dof.aperture} min={0} max={0.2} step={0.001} onCommit={(v) => sub("dof", "aperture", { aperture: v })} />
        <NumField label="Max blur" value={p.dof.maxblur} min={0} max={0.05} step={0.001} onCommit={(v) => sub("dof", "max blur", { maxblur: v })} />
      </>}
      <CheckField label="Ambient occlusion (SSAO)" value={!!p.ssao} onCommit={(v) => toggle("ssao", "ambient occlusion", v)} />
      {p.ssao && <NumField label="AO radius" value={p.ssao.radius} min={0.01} max={64} step={0.05} onCommit={(v) => sub("ssao", "ao radius", { radius: v })} />}
      <SelectField label="Anti-aliasing" value={p.aa} options={[...SCENE_AAS]} labels={{ none: "None", fxaa: "FXAA", smaa: "SMAA" }} onCommit={(v) => put("anti-aliasing", { aa: v })} />
    </>;
  } else if (raw && id === "fog") {
    const f = fogBase(w, sceneCameraBase(doc).background)!;
    body = <>
      <SelectField label="Type" value={f.type} options={["linear", "exp2"]} labels={{ linear: "Linear (near → far)", exp2: "Exponential (density)" }} onCommit={(v) => put("fog type", { type: v === "linear" ? undefined : v })} />
      <ColorField label="Colour" value={f.color} onCommit={(v) => put("fog colour", { color: v })} />
      {f.type === "linear" ? <>
        <NumField label="Starts at" value={f.near} min={0} step={0.5} onCommit={(v) => put("fog near", { near: v })} />
        <NumField label="Full at" value={f.far} min={0.01} step={0.5} onCommit={(v) => put("fog far", { far: v })} />
      </> : <NumField label="Density" value={f.density} min={0} max={1} step={0.005} onCommit={(v) => put("fog density", { density: v })} />}
    </>;
  } else if (raw && id === "sky") {
    const k = skyBase(w)!;
    const suns = sceneLights(doc).lights.filter((l) => l.type === "directional" && l.id).map((l) => l.id!);
    body = <>
      <NumField label="Sun elevation (°)" value={k.elevation} min={-90} max={90} step={1} onCommit={(v) => put("sun elevation", { elevation: v })} />
      <NumField label="Sun azimuth (°)" value={k.azimuth} min={-360} max={360} step={1} onCommit={(v) => put("sun azimuth", { azimuth: v })} />
      <NumField label="Turbidity (haze)" value={k.turbidity} min={0} max={20} step={0.1} onCommit={(v) => put("turbidity", { turbidity: v })} />
      <NumField label="Rayleigh" value={k.rayleigh} min={0} max={4} step={0.05} onCommit={(v) => put("rayleigh", { rayleigh: v })} />
      <SelectField label="Sun drives light" value={k.light ?? ""} options={["", ...suns]} labels={{ "": "None" }} onCommit={(v) => put("sun light", { light: v || undefined })} />
      {!suns.length && <p className="v2-abnote">Give a directional light an id to let the sun place it.</p>}
    </>;
  }
  return <div className="v2-sed-form" data-testid="look-form">
    {all && <h4><Ic g="effect" size={16} /> {LOOK_NAME[id]}</h4>}
    {(all || part === "look") && <>
      {all && <h5>At 0 s</h5>}
      {body}
      <Problems list={issuesAt(issues, `world.${id}`)} />
      {raw && !live && <p className="v2-abnote">An object is called “{id}”, so events on “{id}” change that object; rename it to animate world.{id}.</p>}
      {all && <button type="button" className="v2-btn v2-sed-danger" onClick={() => { void edit(`remove ${id}`, (d) => updateSceneLook(d, id, undefined)); onRemoved(); }}><Ic g="🗑" size={16} /> Remove {LOOK_NAME[id].toLowerCase()}</button>}
    </>}
    {live && (all || part === "addEvent") && <AddLookEvent doc={doc} obj={id} calls={sceneCalls(doc, id).map((c) => c.call)} atNow={atNow} edit={edit} />}
  </div>;
}

/** Scene Phase 1: an object's material style (toon, unlit, glow, outline, rim). */
function MaterialFields({ obj, set }: { obj: SceneObject; set: (label: string, patch: Partial<SceneObject>) => unknown }) {
  const own = typeof obj.model === "string" || !!obj.script;
  const m: SceneMaterial = typeof obj.material === "string" ? { type: obj.material } : obj.material ?? {};
  const deflt: SceneMaterialType = own ? "keep" : "standard";
  const type = m.type ?? deflt;
  const put = (label: string, patch: Partial<SceneMaterial>) => {
    const next = Object.fromEntries(Object.entries({ ...m, ...patch }).filter(([, v]) => v !== undefined)) as SceneMaterial;
    const keys = Object.keys(next);
    set(label, { material: !keys.length ? undefined : keys.length === 1 && next.type ? next.type : next });
  };
  const outline = m.outline ? (m.outline === true ? {} : m.outline) : undefined;
  const rim = m.rim ? (m.rim === true ? {} : m.rim) : undefined;
  return <>
    <h5>Look</h5>
    <SelectField label="Material" value={type} options={own ? ["keep", "standard", "toon", "unlit"] : ["standard", "toon", "unlit"]}
      labels={{ keep: "Its own (from the file / script)", standard: "Standard", toon: "Toon", unlit: "Unlit" }} onCommit={(v) => put("material", { type: v === deflt ? undefined : v as SceneMaterialType })} />
    {type === "toon" && <NumField label="Toon bands" value={m.steps ?? 3} min={2} max={8} step={1} onCommit={(v) => put("toon bands", { steps: v === 3 ? undefined : v })} />}
    {type !== "unlit" && <ColorField label="Glow (emissive)" value={m.emissive ?? "#000000"} onCommit={(v) => put("glow", { emissive: v === "#000000" ? undefined : v })} />}
    {type !== "unlit" && m.emissive && <NumField label="Glow strength" value={m.emissiveIntensity ?? 1} min={0} max={100} step={0.1} onCommit={(v) => put("glow strength", { emissiveIntensity: v === 1 ? undefined : v })} />}
    <CheckField label="Outline" value={!!outline} onCommit={(v) => put(v ? "outline" : "no outline", { outline: v ? true : undefined })} />
    {outline && <>
      <ColorField label="Outline colour" value={outline.color ?? "#101014"} onCommit={(v) => put("outline colour", { outline: { ...outline, color: v } })} />
      <NumField label="Outline width" value={outline.width ?? 0.02} min={0} max={1} step={0.005} onCommit={(v) => put("outline width", { outline: { ...outline, width: v } })} />
    </>}
    {type !== "unlit" && <CheckField label="Rim light" value={!!rim} onCommit={(v) => put(v ? "rim light" : "no rim light", { rim: v ? true : undefined })} />}
    {type !== "unlit" && rim && <>
      <ColorField label="Rim colour" value={rim.color ?? "#ffffff"} onCommit={(v) => put("rim colour", { rim: { ...rim, color: v } })} />
      <NumField label="Rim strength" value={rim.strength ?? 0.6} min={0} max={10} step={0.05} onCommit={(v) => put("rim strength", { rim: { ...rim, strength: v } })} />
    </>}
  </>;
}

function ObjectForm({ doc, obj, issues, edit, atNow, part, runIssues = [] }: { doc: SceneDoc; obj: SceneObject; issues: SceneIssue[]; edit: Edit; atNow: number; part?: Part; runIssues?: SceneScriptIssue[] }) {
  const all = !part;
  const k = doc.objects.indexOf(obj);
  const model = typeof obj.model === "string";
  const script = !!obj.script;
  const anims = model ? modelAnimations(doc, obj.model) : undefined;
  const nodes = model ? modelNodes(doc, obj.model) : undefined;
  const calls = sceneCalls(doc, obj.id);
  const [call, setCall] = useState(calls[0]?.call ?? "moveTo");
  const [idErr, setIdErr] = useState<string>();
  const set = (label: string, patch: Partial<SceneObject>) => edit(label, (d) => updateSceneObject(d, obj.id, patch));
  const anim = typeof obj.animation === "string" ? { clip: obj.animation } : obj.animation;
  const scale = obj.scale === undefined ? 1 : obj.scale;
  return <div className="v2-sed-form" data-testid="object-form">
    {all && <h4><Ic g={script ? "</>" : "scene"} size={16} /> {obj.name || obj.id} <small>{model ? `model ${obj.model}` : script ? `script ${obj.script!.file}` : obj.shape ?? "box"}</small></h4>}
    {(all || part === "props") && <>
      <TextField label="Id" value={obj.id} error={idErr} onCommit={(v) => {
        const why = objectIdProblem(doc, obj.id, v); setIdErr(why);
        if (!why && v !== obj.id) void edit("rename object", (d) => { const r = renameSceneObject(d, obj.id, v); return { doc: r.doc, sel: { kind: "object", id: v } }; });
      }} />
      <TextField label="Name" value={obj.name ?? ""} onCommit={(v) => set("object name", { name: v || undefined })} />
      {!model && <SelectField label={script ? "Shape if the script fails" : "Shape"} value={obj.shape ?? "box"} options={[...SCENE_SHAPES]} onCommit={(v) => set("shape", { shape: v as SceneShape })} />}
      {!script && <ListField label={model ? "Fit size" : "Size"} value={obj.size} hint={model ? "largest side, units" : "one number or a list"} onCommit={(v) => set("size", { size: v })} />}
      {!model && !script && <ColorField label="Colour" value={obj.color ?? "#cccccc"} onCommit={(v) => set("colour", { color: v })} />}
      <Vec3Field label="Position" value={obj.position ?? [0, 0, 0]} onCommit={(v) => set("position", { position: v })} />
      <Vec3Field label="Rotation (°)" value={obj.rotation ?? [0, 0, 0]} onCommit={(v) => set("rotation", { rotation: v })} />
      <ListField label="Scale" value={scale} hint="one number or x, y, z" onCommit={(v) => set("scale", { scale: v === undefined ? undefined : Array.isArray(v) ? (v.length === 3 ? v as Vec3 : v[0]) : v })} />
      <CheckField label="Visible" value={obj.visible !== false} onCommit={(v) => set(v ? "show" : "hide", { visible: v ? undefined : false })} />
      <NumField label="Opacity" value={obj.opacity ?? 1} min={0} max={1} step={0.05} onCommit={(v) => set("opacity", { opacity: v === 1 ? undefined : v })} />
      <MaterialFields obj={obj} set={set} />
      {obj.character && <CharacterFields doc={doc} obj={obj} set={set} />}
    </>}
    {model && !obj.character && (all || part === "model") && <>
      {all && <h5>Animation from 0 s</h5>}
      <SelectField label="Clip" value={anim?.clip ?? ""} options={["", ...(anims ?? (anim ? [anim.clip] : []))]} labels={{ "": "None (rest pose)" }} onCommit={(v) => set("animation", { animation: v ? (anim && typeof obj.animation === "object" ? { ...anim, clip: v } : v) : undefined })} />
      {anim && <>
        <NumField label="Speed" value={anim.speed ?? 1} min={0} step={0.1} onCommit={(v) => set("animation speed", { animation: { ...anim, speed: v } })} />
        <SelectField label="Loop" value={anim.loop ?? "repeat"} options={[...SCENE_LOOPS]} onCommit={(v) => set("animation loop", { animation: { ...anim, loop: v as never } })} />
      </>}
      {nodes && nodes.length > 0 && <NodesField label="Parts shown from 0 s" nodes={nodes} value={obj.nodes ?? {}} onCommit={(v) => set("parts", { nodes: Object.keys(v).length ? v : undefined })} />}
    </>}
    {script && (all || part === "script") && <ScriptForm doc={doc} obj={obj} issues={issuesAt(issues, `objects[${k}].script`)} runIssues={runIssues} edit={edit} all={all} />}
    {(all || part === "props") && <Problems list={issuesAt(issues, `objects[${k}]`).filter((i) => !script || !i.path.startsWith(`objects[${k}].script`))} />}
    {(all || part === "addEvent") && <>
      <h5>Add event at {atNow}s</h5>
      <div className="v2-sed-row">
        <select aria-label="Call" value={call} onChange={(e) => setCall(e.target.value)}>{calls.map((c) => <option key={c.call} value={c.call} title={c.description}>{c.call}</option>)}</select>
        <button type="button" className="v2-btn" onClick={() => void edit(`add ${call}`, (d) => { const r = addSceneEvent(d, obj.id, call, atNow, callTweens(d, obj.id, call) ? 1 : undefined); return { doc: r.doc, sel: { kind: "event", index: r.index } }; })}><Ic g="＋" size={16} /> Add event</button>
      </div>
    </>}
    {all && <button type="button" className="v2-btn v2-sed-danger" onClick={() => void edit("delete object", (d) => { const r = removeSceneObject(d, obj.id); return { doc: r.doc, sel: { kind: "scene" }, note: `Deleted “${obj.id}”${r.removedEvents ? ` and ${r.removedEvents} event${r.removedEvents === 1 ? "" : "s"}` : ""}.` }; })}><Ic g="🗑" size={16} /> Delete object</button>}
  </div>;
}

/** P82: template icons in the Add menu (monochrome line icons). */
const SCRIPT_ICON: Record<string, string> = { particles: "effect", shape: "scene", text: "T", empty: "</>" };
type ParamKind = "number" | "text" | "switch";

/**
 * P82: a Script object's code and params. The code is edited here and applied with Apply (Ctrl / ⌘ + Enter) as ONE
 * undo step; static problems (syntax, imports, the build export, size) are shown as you type and block Apply; what the
 * Edit view page reports when it runs the script (errors, time limits) is listed below. Params are applied one by one.
 */
function ScriptForm({ doc, obj, issues, runIssues, edit, all }: { doc: SceneDoc; obj: SceneObject; issues: SceneIssue[]; runIssues: SceneScriptIssue[]; edit: Edit; all: boolean }) {
  const saved = sceneScriptCode(doc, obj.id) ?? "";
  const [code, setCode] = useState(saved);
  const [problems, setProblems] = useState<string[]>([]);
  const last = useRef(saved);
  // Undo, redo or an agent changed the stored code: show it (the text typed here was applied or is replaced).
  useEffect(() => { if (saved !== last.current) { last.current = saved; setCode(saved); } }, [saved]);
  const changed = code !== saved;
  useEffect(() => {
    if (!changed) { setProblems([]); return; }
    const t = setTimeout(() => setProblems(scriptProblems(code)), 250);
    return () => clearTimeout(t);
  }, [code, changed]);
  const params: SceneScriptParams = obj.script?.params ?? {};
  const setParams = (label: string, next: SceneScriptParams) => edit(label, (d) => setSceneScriptParams(d, obj.id, next));
  const [pName, setPName] = useState("");
  const [pKind, setPKind] = useState<ParamKind>("number");
  const nameErr = pName && !SCRIPT_PARAM_RE.test(pName) ? "Letters, digits and _ (not starting with a digit)" : pName in params ? "Already a param" : undefined;
  const [tpl, setTpl] = useState(SCENE_SCRIPT_TEMPLATES[0].id);
  const apply = () => {
    const why = scriptProblems(code);
    setProblems(why);
    if (why.length || !changed) return;
    void edit("script code", (d) => ({ doc: setSceneScriptCode(d, obj.id, code), note: "Script applied. The Edit view rebuilds the scene to run it." }));
  };
  const lines = Math.min(24, Math.max(10, code.split("\n").length + 1));
  return <div className="v2-sed-script" data-testid="script-form">
    {all && <h5><Ic g="</>" size={14} /> Script <small>{obj.script?.file}</small></h5>}
    <h6>Params</h6>
    {Object.keys(params).length === 0 && <p className="v2-abnote">No params. Add one to pass a value to build and update.</p>}
    <div className="v2-sed-params" role="list" aria-label="Params">
      {Object.entries(params).map(([name, v]) => <div key={name} className="v2-sed-param" role="listitem">
        {typeof v === "number" ? <NumField label={name} value={v} onCommit={(n) => { if (n !== undefined) void setParams(`param ${name}`, { ...params, [name]: n }); }} />
          : typeof v === "boolean" ? <CheckField label={name} value={v} onCommit={(b) => void setParams(`param ${name}`, { ...params, [name]: b })} />
            : /^#[0-9a-f]{6}$/i.test(v) ? <ColorField label={name} value={v} onCommit={(c) => void setParams(`param ${name}`, { ...params, [name]: c })} />
              : <TextField label={name} value={v} onCommit={(t) => void setParams(`param ${name}`, { ...params, [name]: t })} />}
        <button type="button" className="v2-icon" aria-label={`Remove param ${name}`} title={`Remove “${name}”`} onClick={() => { const { [name]: _x, ...rest } = params; void _x; void setParams(`remove param ${name}`, rest); }}><Ic g="🗑" size={16} /></button>
      </div>)}
    </div>
    <div className="v2-sed-addparam">
      <input type="text" aria-label="New param name" value={pName} placeholder="New param name" spellCheck={false} autoCapitalize="off" onChange={(e) => setPName(e.target.value.trim())}
        onKeyDown={(e) => { if (e.key === "Enter" && pName && !nameErr) (e.currentTarget.parentElement!.querySelector("button") as HTMLButtonElement).click(); }} />
      <select aria-label="Kind of value" value={pKind} onChange={(e) => setPKind(e.target.value as ParamKind)}><option value="number">Number</option><option value="text">Text</option><option value="switch">Switch</option></select>
      <button type="button" className="v2-btn" disabled={!pName || !!nameErr} onClick={() => { void setParams(`add param ${pName}`, { ...params, [pName]: pKind === "number" ? 0 : pKind === "switch" ? false : "" }); setPName(""); }}><Ic g="＋" size={16} /> Add</button>
    </div>
    {nameErr && <em className="v2-sed-ferr" role="alert">{nameErr}</em>}
    <h6>Code</h6>
    <textarea className="v2-sed-code" aria-label="Script code" spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" rows={lines} value={code}
      onChange={(e) => setCode(e.target.value)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); apply(); return; }
        // Esc leaves the code box (it never closes the editor from here, so typed code isn't lost by accident).
        if (e.key === "Escape") { e.stopPropagation(); e.currentTarget.blur(); return; }
        if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          const el = e.currentTarget, a = el.selectionStart, b = el.selectionEnd;
          const next = code.slice(0, a) + "  " + code.slice(b);
          setCode(next);
          requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; });
        }
      }} />
    {changed && problems.length > 0 && <ul className="v2-scene-list v2-scene-issues" aria-label="Code problems">{problems.map((m, n) => <li key={n} className="is-error">{m}</li>)}</ul>}
    <div className="v2-sed-row">
      <button type="button" className="v2-btn primary" disabled={!changed || problems.length > 0} onClick={apply} title="Apply the code (Ctrl / ⌘ + Enter)"><Ic g="✓" size={16} /> Apply code</button>
      <button type="button" className="v2-btn" disabled={!changed} onClick={() => setCode(saved)} title="Put back the applied code">Revert</button>
      {changed && <small className="v2-sed-unapplied" role="status">Not applied</small>}
    </div>
    <Problems list={issues} />
    {runIssues.length > 0 && <ul className="v2-scene-list v2-scene-issues" aria-label="Script problems when it ran">{runIssues.map((x, n) => <li key={n} className="is-error">{x.message}</li>)}</ul>}
    <p className="v2-abnote">build(THREE, params, ctx) returns a THREE.Object3D built around (0, 0, 0); update(obj, t, params, ctx) sets it from the scene time t alone. Use ctx.random() for random numbers so every frame renders the same in preview and export. Position, rotation, scale and opacity come from the object and its events.</p>
    <h6>Start again from a template</h6>
    <div className="v2-sed-row">
      <select aria-label="Template" value={tpl} onChange={(e) => setTpl(e.target.value)}>{SCENE_SCRIPT_TEMPLATES.map((t) => <option key={t.id} value={t.id} title={t.description}>{t.label}</option>)}</select>
      <button type="button" className="v2-btn" onClick={() => { const t = SCENE_SCRIPT_TEMPLATES.find((x) => x.id === tpl)!; void edit(`use ${t.label.toLowerCase()} template`, (d) => ({ doc: setSceneScriptParams(setSceneScriptCode(d, obj.id, t.code), obj.id, { ...t.params }), note: `Code and params replaced with the ${t.label} template (Undo puts them back).` })); }}>Use template</button>
    </div>
    <button type="button" className="v2-btn" onClick={() => void edit("turn into shape", (d) => ({ doc: removeSceneScript(d, obj.id), note: `“${obj.id}” is a plain ${obj.shape ?? "box"} now (Undo brings the script back).` }))}><Ic g="scene" size={16} /> Turn into a plain shape</button>
  </div>;
}

function EventForm({ doc, index, ev, issues, edit, onSeek, onDeleted, atNow, part }: { doc: SceneDoc; index: number; ev: SceneEvent; issues: SceneIssue[]; edit: Edit; onSeek: () => void; onDeleted: () => void; atNow: number; part?: Part }) {
  const all = !part;
  const calls = sceneCalls(doc, ev.obj);
  const known = calls.some((c) => c.call === ev.call);
  const fields = sceneCallArgs(doc, ev.obj, ev.call);
  const tweens = callTweens(doc, ev.obj, ev.call);
  const args = ev.args ?? {};
  const desc = calls.find((c) => c.call === ev.call)?.description;
  const objIds = doc.objects.map((o) => o.id).filter((id) => id !== ev.obj);
  return <div className="v2-sed-form" data-testid="event-form">
    {all && <h4><code>{ev.obj}.{ev.call}</code> <small>event {index + 1}</small></h4>}
    {(all || part === "timing") && <>
      {desc && <p className="v2-abnote">{desc}</p>}
      <SelectField label="Call" value={ev.call} options={known ? calls.map((c) => c.call) : [ev.call, ...calls.map((c) => c.call)]} onCommit={(v) => edit(`call ${v}`, (d) => setSceneEventCall(d, index, v))} />
      <div className="v2-sed-row">
        <NumField label="At (s)" value={ev.at} min={0} step={0.1} onCommit={(v) => edit("event time", (d) => updateSceneEvent(d, index, { at: v ?? 0 }))} />
        <button type="button" className="v2-btn" title="Move this event to the playhead" onClick={() => void edit("event time", (d) => updateSceneEvent(d, index, { at: atNow }))}>At playhead</button>
      </div>
      {tweens && <NumField label="Duration (s)" value={ev.dur} min={0} step={0.1} optional onCommit={(v) => edit("event duration", (d) => updateSceneEvent(d, index, { dur: v }))} />}
      {tweens && (ev.dur ?? 0) > 0 && <SelectField label="Ease" value={ev.ease ?? "linear"} options={[...SCENE_EASES]} onCommit={(v) => edit("ease", (d) => updateSceneEvent(d, index, { ease: v === "linear" ? undefined : v as SceneEase }))} />}
    </>}
    {(all || part === "args") && fields.map((f) => <ArgField key={f.name} field={f} value={args[f.name] ?? (f.name === "position" ? args.value : undefined)} objIds={objIds} onCommit={(v) => edit(`${ev.call} ${f.label.toLowerCase()}`, (d) => setSceneEventArg(d, index, f.name, v))} />)}
    <Problems list={issuesAt(issues, `events[${index}]`)} />
    {all && <div className="v2-sed-row">
      <button type="button" className="v2-btn" onClick={onSeek}><Ic g="⇤" size={16} /> Go to</button>
      <button type="button" className="v2-btn" onClick={() => void edit("duplicate event", (d) => { const r = duplicateSceneEvent(d, index); return { doc: r.doc, sel: { kind: "event", index: r.index } }; })}><Ic g="⧉" size={16} /> Duplicate</button>
      <button type="button" className="v2-btn v2-sed-danger" onClick={() => { void edit("delete event", (d) => removeSceneEvent(d, index)); onDeleted(); }}><Ic g="🗑" size={16} /> Delete</button>
    </div>}
  </div>;
}

function ArgField({ field: f, value, objIds, onCommit }: { field: SceneArgField; value: unknown; objIds: string[]; onCommit: (v: unknown) => void }) {
  switch (f.kind) {
    case "vec3": return <Vec3Field label={f.label} value={isVec3(value) ? value : [0, 0, 0]} onCommit={onCommit} />;
    case "scale": return <ListField label={f.label} value={typeof value === "number" || Array.isArray(value) ? value as number | number[] : 1} hint="one number or x, y, z" onCommit={(v) => onCommit(Array.isArray(v) && v.length === 1 ? v[0] : v)} />;
    case "target": {
      // Scene Phase 2: "camera" (look at it), an angle (turn to it), or nothing (optional).
      const point = isVec3(value), angle = typeof value === "number";
      const extra = [...(f.camera ? ["camera"] : []), ...(f.angle ? ["#angle"] : []), ...(f.optional ? ["#none"] : [])];
      const cur = point ? "" : angle ? "#angle" : value === undefined && f.optional ? "#none" : String(value ?? "");
      return <>
        <SelectField label={f.label} value={cur} options={["", ...extra, ...objIds]} labels={{ "": "A point [x, y, z]", "#angle": f.numberLabel ?? "An angle (°)", "#none": "—", camera: "The camera" }}
          onCommit={(v) => onCommit(v === "" ? [0, 0, 0] : v === "#angle" ? (f.numberLabel ? 5 : 0) : v === "#none" ? undefined : v)} />
        {point && <Vec3Field label="Point" value={value} onCommit={onCommit} />}
        {angle && <NumField label={f.numberLabel ? "Distance" : "Angle (°)"} value={value} min={f.numberLabel ? 0.01 : -360} max={f.numberLabel ? 500 : 360} step={f.numberLabel ? 0.1 : 5} onCommit={(v) => onCommit(v ?? 0)} />}
      </>;
    }
    case "points": {
      const pts: Vec3[] = isVec3(value) ? [value] : Array.isArray(value) ? (value as unknown[]).filter(isVec3) : [];
      return <Field label={f.label}>
        <span className="v2-sed-points">
          {pts.map((pt, i) => <span key={i} className="v2-sed-row">
            <Vec3Field label={`Point ${i + 1}`} value={pt} onCommit={(v) => onCommit(pts.map((x, k) => (k === i ? v : x)))} />
            {pts.length > 1 && <button type="button" className="v2-icon" aria-label={`Remove point ${i + 1}`} onClick={() => onCommit(pts.filter((_, k) => k !== i))}><Ic g="✕" size={14} /></button>}
          </span>)}
          <button type="button" className="v2-btn" onClick={() => { const last = pts[pts.length - 1] ?? [0, 0, 0]; onCommit([...pts, [last[0] + 1, last[1], last[2]] as Vec3]); }}><Ic g="＋" size={14} /> Point</button>
        </span>
      </Field>;
    }
    case "expressions": {
      const map = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, number> : {};
      return <>{(["happy", "angry", "sad", "surprised", "relaxed", "blink"] as const).map((k) => <NumField key={k} label={k[0].toUpperCase() + k.slice(1)} value={map[k]} min={0} max={1} step={0.1} optional
        onCommit={(v) => { const next = { ...map }; if (v === undefined) delete next[k]; else next[k] = v; onCommit(Object.keys(next).length ? next : { [k]: 0 }); }} />)}</>;
    }
    case "text": return <TextField label={f.label} value={typeof value === "string" ? value : ""} onCommit={(v) => onCommit(v || undefined)} />;
    case "visemes": return <VisemeField label={f.label} value={value} onCommit={onCommit} />;
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
  return <Field label={label}><input type="number" inputMode="decimal" value={text} step={step} min={min} max={max} placeholder={optional ? "—" : undefined} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape" && text !== (value === undefined ? "" : fmt(value))) { setText(value === undefined ? "" : fmt(value)); e.stopPropagation(); } }} /></Field>;
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
  return <Field label={label} error={err}><input type="text" inputMode="decimal" value={text} placeholder={hint} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape" && text !== show(value)) { setText(show(value)); setErr(undefined); e.stopPropagation(); } }} /></Field>;
}

function TextField({ label, value, onCommit, error }: { label: string; value: string; onCommit: (v: string) => void; error?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <Field label={label} error={error}><input type="text" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { if (text.trim() !== value) onCommit(text.trim()); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape" && text !== value) { setText(value); e.stopPropagation(); } }} /></Field>;
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

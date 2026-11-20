import { useEffect, useMemo, useRef, useState } from "react";
import { GIZMO_CAMERA_TARGET, gizmoLightId, isVec3, lightHasPosition, SCENE_CAMERA, type GizmoMode, type GizmoValue, type SceneDoc, type SceneLight, type SceneState } from "../domain";
import { HTML_SANDBOX, sceneEditPage, sceneEditPageKey, withRuntime } from "../render";

/** P81a: gizmo settings the chip bar changes. */
export interface EditViewOpts { mode: GizmoMode; axis: "x" | "y" | "z" | "free"; snap: boolean }
export type EditDragPhase = "start" | "move" | "end" | "cancel";
/** What the editor can ask the view to do. */
export interface EditViewApi { home(): void; cancel(): void }

export interface SceneEditViewProps {
  doc: SceneDoc;
  /** The evaluated scene at the shown time. */
  state: SceneState;
  /** Selected object id (gizmo on it), if any. */
  sel?: string;
  opts: EditViewOpts;
  touch: boolean;
  onPick(id: string | null): void;
  onDrag(phase: EditDragPhase, id: string, value: GizmoValue): void;
  api?: { current: EditViewApi | null };
  /** P81b: the lights as drawn (the page applies their colour, intensity and position; helpers show them). */
  lights?: SceneLight[];
  /** P81b: the clip's width / height (the camera frustum's shape). */
  aspect?: number;
  /**
   * P82: what the page reported about Script objects (failed, stopped or slow), each time the list grows; an empty list
   * when the page is rebuilt.
   */
  onScriptIssues?(issues: SceneScriptIssue[]): void;
}
/** P82: one problem the Edit view page had running a Script object. */
export interface SceneScriptIssue { id: string; message: string }

const PHASES: readonly EditDragPhase[] = ["start", "move", "end", "cancel"];

/**
 * The scene editor's Edit view (render/sceneEditPage.ts in a visible sandboxed iframe). The page is rebuilt only when
 * what it is built from changes (`sceneEditPageKey`: the light types, object shapes and models); otherwise each change
 * of the scene, the lights' values, the shown time, the selection or the gizmo settings is one `scene-edit:state`
 * message. Messages from the page are taken only from its own window, and only with known ids (objects, `camera`,
 * `camera:target`, `light:<i>` of a light with a position) and finite numbers.
 */
export function SceneEditView({ doc, state, sel, opts, touch, onPick, onDrag, api, lights = [], aspect = 16 / 9, onScriptIssues }: SceneEditViewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const key = sceneEditPageKey(doc);
  // The page for this key, built from the scene the key was first seen with.
  const docRef = useRef(doc); docRef.current = doc;
  const srcDoc = useMemo(() => withRuntime(sceneEditPage(docRef.current)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const cb = useRef({ onPick, onDrag, onScriptIssues }); cb.current = { onPick, onDrag, onScriptIssues };
  useEffect(() => { setReady(false); cb.current.onScriptIssues?.([]); }, [srcDoc]);
  const ids = useRef(new Set<string>());
  ids.current = new Set([...state.objects.map((o) => o.id), SCENE_CAMERA, GIZMO_CAMERA_TARGET, ...lights.flatMap((l, i) => (lightHasPosition(l) ? [gizmoLightId(i)] : []))]);
  const lightsKey = JSON.stringify(lights);
  const send = (m: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(m, "*");
  if (api) api.current = { home: () => send({ type: "scene-edit:home" }), cancel: () => send({ type: "scene-edit:cancel" }) };

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { type?: unknown; id?: unknown; phase?: unknown; value?: unknown } | null;
      if (!d || typeof d !== "object") return;
      if (d.type === "scene-edit:ready") { setReady(true); return; }
      if (d.type === "scene-edit:script-issues") {
        const list = (d as { issues?: unknown }).issues;
        if (!Array.isArray(list)) return;
        const out = list.slice(0, 50).filter((x): x is SceneScriptIssue => !!x && typeof x === "object" && typeof (x as SceneScriptIssue).id === "string" && typeof (x as SceneScriptIssue).message === "string" && ids.current.has((x as SceneScriptIssue).id))
          .map((x) => ({ id: x.id, message: x.message.slice(0, 400) }));
        cb.current.onScriptIssues?.(out);
        return;
      }
      if (d.type === "scene-edit:pick") {
        if (d.id === null) cb.current.onPick(null);
        else if (typeof d.id === "string" && ids.current.has(d.id)) cb.current.onPick(d.id);
        return;
      }
      if (d.type === "scene-edit:drag") {
        const v = d.value as Partial<GizmoValue> | null;
        if (typeof d.id !== "string" || !ids.current.has(d.id) || !PHASES.includes(d.phase as EditDragPhase)) return;
        if (!v || !isVec3(v.position) || !isVec3(v.rotation) || !isVec3(v.scale)) return;
        cb.current.onDrag(d.phase as EditDragPhase, d.id, { position: v.position, rotation: v.rotation, scale: v.scale });
      }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  useEffect(() => { if (ready) send({ type: "scene-edit:state", state, sel: sel ?? null, opts: { ...opts, touch, aspect }, lights: JSON.parse(lightsKey) }); }, [ready, state, sel, opts, touch, aspect, lightsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <iframe ref={frame} className="v2-sed-editframe" title="3D edit view: drag to orbit, tap an object to select it" sandbox={HTML_SANDBOX} srcDoc={srcDoc} data-testid="scene-edit-frame" />;
}

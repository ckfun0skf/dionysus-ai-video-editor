import type { SceneDoc } from "../domain/scene";
import { writeManifest } from "../domain/htmlClipPackage";
import { SCENE_BUILD_JS } from "./scenePage";

/**
 * P81a: the scene editor's Edit view page. A second instance of the scene clip's page (render/scenePage.ts: the same
 * world, objects and models, in the same sandboxed HTML clip host with its CSP and pinned three.js), in editor mode:
 * a free orbit camera, a ground grid, TransformControls on the selected object, tap / click to pick. It is visible and
 * interactive, so it renders on demand (on a state, a camera move or a gizmo move), not per timeline frame, and it is
 * never used for export.
 *
 * Messages (both ways checked by the window they come from; the editor also checks every value):
 *   page → editor  {type:"scene-edit:ready"}                                 (models loaded, listening)
 *   editor → page  {type:"scene-edit:state", state?, sel?, opts?}            (stateAt for the shown time; selected id or null;
 *                                                                              opts {mode, axis "x"|"y"|"z"|"free", snap, touch})
 *   editor → page  {type:"scene-edit:home"}                                  (back to the scene camera's view)
 *   editor → page  {type:"scene-edit:cancel"}                                (Esc in the editor: cancel the drag)
 *   page → editor  {type:"scene-edit:pick", id}                              (tapped object id, or null for empty space)
 *   page → editor  {type:"scene-edit:drag", phase, id, value}                (phase start | move | end | cancel; value
 *                                                                              {position, rotation (deg, XYZ), scale})
 */
export const SCENE_EDIT_JS = `import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const view = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
const orbit = new OrbitControls(view, canvas);
orbit.enableDamping = false; orbit.screenSpacePanning = true;
orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
const grid = new THREE.GridHelper(20, 20, 0x9a9aa6, 0x44444e);
grid.material.transparent = true; grid.material.opacity = 0.55; grid.material.depthWrite = false;
grid.position.y = 0.003; // just above a floor at y = 0 (no z-fighting)
scene.add(grid);
const tc = new TransformControls(view, canvas);
scene.add(tc);
const outline = new THREE.BoxHelper(undefined, 0x5ad1c8); outline.visible = false; scene.add(outline);
let st = null, sel = null, homed = false, dragging = false, cancelled = false, gestureDragged = false;
const opts = { mode: "translate", axis: "free", snap: false, touch: false };
const post = (m) => parent.postMessage(m, "*");
const r3 = (x) => Math.round(x * 1000) / 1000;
const valueOf = (n) => ({ position: n.position.toArray().map(r3), rotation: [n.rotation.x / D, n.rotation.y / D, n.rotation.z / D].map(r3), scale: n.scale.toArray().map(r3) });
function size() { const w = innerWidth || 1, h = innerHeight || 1; renderer.setSize(w, h, false); view.aspect = w / h; view.updateProjectionMatrix(); }
function draw() { if (outline.visible) outline.update(); renderer.render(scene, view); }
function home() {
  if (!st) return;
  const p = new THREE.Vector3().fromArray(st.camera.position), t = new THREE.Vector3().fromArray(st.camera.target);
  // A step back from the scene camera, so its frame and what is just outside it are in view.
  view.position.copy(t).add(p.sub(t).multiplyScalar(1.35));
  orbit.target.copy(t); view.updateProjectionMatrix(); orbit.update();
}
function apply(s) {
  scene.background = new THREE.Color(s.background);
  for (const o of s.objects) {
    const n = nodes.get(o.id); if (!n) continue;
    const m = n.node;
    if (dragging && m === tc.object) continue;
    m.position.set(o.position[0], o.position[1], o.position[2]);
    m.rotation.set(o.rotation[0] * D, o.rotation[1] * D, o.rotation[2] * D);
    m.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    m.visible = o.visible && o.opacity > 0;
    if (n.tint) n.mats[0].m.color.set(o.color);
    for (const x of n.mats) {
      const tr = x.transparent || o.opacity < 1;
      if (x.m.transparent !== tr) { x.m.transparent = tr; x.m.depthWrite = !tr; x.m.needsUpdate = true; }
      x.m.opacity = x.opacity * o.opacity;
    }
    pose(n, o.animation);
    if (n.parts) for (const [name, x] of n.parts) x.n.visible = o.nodes && name in o.nodes ? !!o.nodes[name] : x.visible;
  }
}
function setOpts() {
  tc.setMode(opts.mode);
  tc.setSpace(opts.mode === "translate" ? "world" : "local");
  tc.setSize(opts.touch ? 1.6 : 1);
  const a = opts.axis;
  tc.showX = a === "free" || a === "x"; tc.showY = a === "free" || a === "y"; tc.showZ = a === "free" || a === "z";
  tc.setTranslationSnap(opts.snap ? 0.25 : null); tc.setRotationSnap(opts.snap ? 15 * D : null); tc.setScaleSnap(opts.snap ? 0.1 : null);
}
function setSel(id) {
  if (dragging) return;
  const n = typeof id === "string" ? nodes.get(id) : undefined;
  sel = n ? id : null;
  if (n) { tc.attach(n.node); outline.setFromObject(n.node); outline.visible = true; } else { tc.detach(); outline.visible = false; }
}
function cancel() { if (!dragging) return; cancelled = true; tc.reset(); tc.pointerUp({ button: 0 }); }
orbit.addEventListener("change", draw);
tc.addEventListener("change", draw);
tc.addEventListener("dragging-changed", (e) => {
  orbit.enabled = !e.value;
  const n = tc.object; if (!n || !sel) return;
  if (e.value) { dragging = true; cancelled = false; gestureDragged = true; post({ type: "scene-edit:drag", phase: "start", id: sel, value: valueOf(n) }); }
  else { dragging = false; post({ type: "scene-edit:drag", phase: cancelled ? "cancel" : "end", id: sel, value: valueOf(n) }); cancelled = false; if (st) { apply(st); draw(); } }
});
tc.addEventListener("objectChange", () => { if (dragging && !cancelled && tc.object && sel) post({ type: "scene-edit:drag", phase: "move", id: sel, value: valueOf(tc.object) }); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && dragging) { e.preventDefault(); cancel(); } });
// Tap / click to pick: one pointer, under 6 px of movement, and no gizmo drag during the gesture.
const ray = new THREE.Raycaster(), active = new Set();
let tap = null;
canvas.addEventListener("pointerdown", (e) => { active.add(e.pointerId); if (active.size === 1) { tap = { x: e.clientX, y: e.clientY }; gestureDragged = false; } else tap = null; }, true);
const up = (e) => {
  if (!active.delete(e.pointerId)) return;
  const t = tap; tap = null;
  if (!t || gestureDragged || e.type === "pointercancel" || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 6) return;
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), view);
  const roots = [...nodes.values()].map((n) => n.node).filter((m) => m.visible);
  const hit = ray.intersectObjects(roots, true)[0];
  let id = null;
  for (let o = hit && hit.object; o; o = o.parent) if (o.userData.sceneId) { id = o.userData.sceneId; break; }
  post({ type: "scene-edit:pick", id });
};
addEventListener("pointerup", up, true); addEventListener("pointercancel", up, true);
addEventListener("resize", () => { size(); draw(); });
addEventListener("message", (e) => {
  const d = e.data; if (!d || e.source !== parent) return;
  if (d.type === "scene-edit:state") {
    if (d.opts) { Object.assign(opts, d.opts); setOpts(); }
    if (d.state) { st = d.state; apply(st); if (!homed) { home(); homed = true; } }
    if ("sel" in d) setSel(d.sel);
    draw();
  } else if (d.type === "scene-edit:home") { home(); draw(); }
  else if (d.type === "scene-edit:cancel") cancel();
});
try { await loadModels(dionysus.ctx); } catch (err) { console.error(err); }
for (const [id, n] of nodes) n.node.userData.sceneId = id;
setOpts(); size();
post({ type: "scene-edit:ready" });
`;

/** The Edit view page for one scene (the HTML clip host adds the CSP, import map and runtime). */
export function sceneEditPage(doc: SceneDoc | undefined): string {
  const { files, ...rest } = doc ?? { format: "dionysus.scene/1" as const, objects: [] };
  const json = JSON.stringify(rest).replace(/</g, "\\u003c");
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}</style></head>
<body><canvas id="c" tabindex="0"></canvas>
<script type="application/json" id="dionysus-scene">${json}</script>
<script type="module">
${SCENE_BUILD_JS}${SCENE_EDIT_JS}</script></body></html>
`;
  const models = (Array.isArray(rest.objects) ? rest.objects : []).some((o) => o && typeof o.model === "string" && o.model);
  const used = files && typeof files === "object" ? Object.fromEntries(Object.entries(files).filter(([, d]) => typeof d === "string")) : {};
  return writeManifest(page, { libs: ["three", "three-orbit", "three-transform", ...(models ? ["three-gltf"] : [])], files: models ? used : {} });
}

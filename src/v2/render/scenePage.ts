import type { SceneDoc } from "../domain/scene";
import { writeManifest } from "../domain/htmlClipPackage";

/**
 * The built-in runtime page of the `scene` clip type (P74, Phase 2 step 2.1; decision 1). It runs in the same
 * sandboxed HTML clip host as code clips (render/htmlClip.ts: opaque origin, the clip CSP, pinned three.js from
 * render/htmlLibs.ts, virtual time), so preview and export use one path.
 *
 * The page builds the world and the objects once from the embedded document. It never animates by itself: every frame
 * the editor sends the state for that time, computed by the pure `stateAt` (domain/scene.ts), as `ctx.inputs.scene`
 * (the P38 inputs field of `dionysus:frame`), and the page applies it and renders. So a frame depends only on the
 * document and `t`.
 */
export const SCENE_RUNTIME_JS = `import * as THREE from "three";
const doc = JSON.parse(document.getElementById("dionysus-scene").textContent);
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const world = doc.world || {};
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 500);
const lights = Array.isArray(world.lights) && world.lights.length ? world.lights : [{ type: "hemisphere", intensity: 1 }, { type: "directional", position: [3, 5, 2], intensity: 1.5 }];
for (const l of lights) {
  const c = new THREE.Color(l.color || "#ffffff"), k = typeof l.intensity === "number" ? l.intensity : 1;
  const L = l.type === "ambient" ? new THREE.AmbientLight(c, k) : l.type === "hemisphere" ? new THREE.HemisphereLight(c, 0x303040, k)
    : l.type === "point" ? new THREE.PointLight(c, k * 10, 0, 2) : new THREE.DirectionalLight(c, k);
  if (Array.isArray(l.position)) L.position.set(l.position[0], l.position[1], l.position[2]);
  scene.add(L);
}
const sizeOf = (o, n, d) => { const s = o.size; if (typeof s === "number") return Array(n).fill(s); if (Array.isArray(s)) return s.length === 1 ? Array(n).fill(s[0]) : s; return d; };
const geometry = (o) => {
  switch (o.shape) {
    case "sphere": return new THREE.SphereGeometry(sizeOf(o, 1, [0.5])[0], 48, 24);
    case "cylinder": { const [r, h] = sizeOf(o, 2, [0.5, 1]); return new THREE.CylinderGeometry(r, r, h, 48); }
    case "cone": { const [r, h] = sizeOf(o, 2, [0.5, 1]); return new THREE.ConeGeometry(r, h, 48); }
    case "torus": { const [r, t] = sizeOf(o, 2, [0.5, 0.15]); return new THREE.TorusGeometry(r, t, 24, 64); }
    case "plane": { const [w, h] = sizeOf(o, 2, [1, 1]); return new THREE.PlaneGeometry(w, h); }
    default: { const [w, h, d] = sizeOf(o, 3, [1, 1, 1]); return new THREE.BoxGeometry(w, h, d); }
  }
};
// Each object is one node: its shape's mesh, or (P75) a group holding its loaded GLB. "mats" are the materials its
// opacity applies to, with the material's own opacity and transparency; "tint" = the shape's colour applies.
const nodes = new Map();
const objects = (Array.isArray(doc.objects) ? doc.objects : []).filter((o) => o && typeof o.id === "string");
for (const o of objects) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.55, metalness: 0.1, side: o.shape === "plane" ? THREE.DoubleSide : THREE.FrontSide });
  const m = new THREE.Mesh(geometry(o), mat);
  m.rotation.order = "XYZ";
  scene.add(m); nodes.set(o.id, { node: m, tint: true, mats: [{ m: mat, opacity: 1, transparent: false }] });
}
const LOOP = { once: THREE.LoopOnce, pingpong: THREE.LoopPingPong };
// P75: load each model object's GLB (an attached file of the scene) before the first frame; a missing or broken file
// keeps the shape. One AnimationMixer per model; the clips by name.
async function loadModels(ctx) {
  const list = objects.filter((o) => typeof o.model === "string" && o.model);
  if (!list.length) return;
  // A variable specifier: only pages with models list the loader in their manifest (a quoted import would be detected).
  const GLTF = "three/addons/loaders/GLTFLoader.js";
  const { GLTFLoader } = await import(GLTF);
  const loader = new GLTFLoader();
  for (const o of list) {
    const url = ctx.asset(o.model);
    if (!url) continue;
    let gltf;
    try { gltf = await loader.loadAsync(url); } catch (e) { console.error(e); continue; }
    const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!root) continue;
    const group = new THREE.Group(); group.rotation.order = "XYZ";
    const inner = new THREE.Group(); inner.add(root); group.add(inner);
    if (typeof o.size === "number" && o.size > 0) {
      const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const k = o.size / Math.max(size.x, size.y, size.z, 1e-6);
      inner.scale.setScalar(k); inner.position.set(-c.x * k, -box.min.y * k, -c.z * k);
    }
    const mats = [];
    root.traverse((n) => {
      if (!n.isMesh) return;
      n.frustumCulled = false;
      const own = Array.isArray(n.material) ? n.material.map((x) => x.clone()) : n.material.clone();
      n.material = own;
      for (const x of Array.isArray(own) ? own : [own]) mats.push({ m: x, opacity: x.opacity, transparent: x.transparent });
    });
    const old = nodes.get(o.id);
    scene.remove(old.node); old.node.geometry.dispose(); old.node.material.dispose();
    scene.add(group);
    const clips = new Map((gltf.animations || []).map((a) => [a.name, a]));
    // Parts by node name with the file's own visibility, so a frame can put back what it doesn't set.
    const parts = new Map();
    root.traverse((n) => { if (n.name && !parts.has(n.name)) parts.set(n.name, { n, visible: n.visible }); });
    nodes.set(o.id, { node: group, tint: false, mats, mixer: new THREE.AnimationMixer(root), clips, parts });
  }
}
// The pose for this frame from the clips the evaluator sends: every action is reset and the mixer is set to 1 s with
// each action's time scale = its local time, so each clip lands on its own time; mixer.setTime, never update(delta).
// Stopping all actions first restores the rest pose, so a frame never depends on the one before.
function pose(n, anims) {
  if (!n.mixer) return;
  n.mixer.stopAllAction();
  for (const a of anims || []) {
    const clip = n.clips.get(a.clip);
    if (!clip || !(a.weight > 0)) continue;
    const act = n.mixer.clipAction(clip);
    act.reset();
    act.setLoop(LOOP[a.loop] || THREE.LoopRepeat, Infinity);
    act.clampWhenFinished = true;
    act.setEffectiveWeight(a.weight);
    act.setEffectiveTimeScale(Math.max(0, a.time));
    act.play();
  }
  n.mixer.setTime(1);
}
const D = Math.PI / 180;
dionysus.clip({
  init: loadModels,
  render(t, ctx) {
    const s = ctx.inputs && ctx.inputs.scene;
    if (!s) return;
    const w = ctx.width || innerWidth, h = ctx.height || innerHeight;
    if (canvas.width !== w || canvas.height !== h) renderer.setSize(w, h, false);
    scene.background = new THREE.Color(s.background);
    camera.aspect = w / h; camera.fov = s.camera.fov;
    camera.position.set(s.camera.position[0], s.camera.position[1], s.camera.position[2]);
    camera.lookAt(s.camera.target[0], s.camera.target[1], s.camera.target[2]);
    camera.updateProjectionMatrix();
    for (const o of s.objects) {
      const n = nodes.get(o.id); if (!n) continue;
      const m = n.node;
      m.position.set(o.position[0], o.position[1], o.position[2]);
      m.rotation.set(o.rotation[0] * D, o.rotation[1] * D, o.rotation[2] * D);
      m.scale.set(o.scale[0], o.scale[1], o.scale[2]);
      m.visible = o.visible && o.opacity > 0;
      if (n.tint) n.mats[0].m.color.set(o.color);
      for (const x of n.mats) {
        // Switching transparent changes the shader (OPAQUE define): recompile so a frame never depends on the previous one.
        const tr = x.transparent || o.opacity < 1;
        if (x.m.transparent !== tr) { x.m.transparent = tr; x.m.depthWrite = !tr; x.m.needsUpdate = true; }
        x.m.opacity = x.opacity * o.opacity;
      }
      pose(n, o.animation);
      if (n.parts) for (const [name, x] of n.parts) x.n.visible = o.nodes && name in o.nodes ? !!o.nodes[name] : x.visible;
    }
    renderer.render(scene, camera);
  },
});
`;

/**
 * The runtime page for one scene document (the HTML clip host adds the CSP, import map and time shim). P75: the
 * document's `files` (GLB models) go into the page's clip manifest instead of the embedded JSON, so the host's runtime
 * serves them as blob: URLs (`ctx.asset(name)`, as for code clips since P55), and GLTFLoader is added to the page's
 * libraries only when an object has a model.
 */
export function scenePage(doc: SceneDoc | undefined): string {
  const { files, ...rest } = doc ?? { format: "dionysus.scene/1" as const, objects: [] };
  const json = JSON.stringify(rest).replace(/</g, "\\u003c");
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100%;height:100%}</style></head>
<body><canvas id="c"></canvas>
<script type="application/json" id="dionysus-scene">${json}</script>
<script type="module">
${SCENE_RUNTIME_JS}</script></body></html>
`;
  const models = (Array.isArray(rest.objects) ? rest.objects : []).some((o) => o && typeof o.model === "string" && o.model);
  if (!models) return page;
  const used = files && typeof files === "object" ? Object.fromEntries(Object.entries(files).filter(([, d]) => typeof d === "string")) : {};
  return writeManifest(page, { libs: ["three", "three-gltf"], files: used });
}

/**
 * P76: what the page is built from. The page reads only the lights and each object's id, shape, size and model from
 * the embedded scene (everything else arrives per frame as state), plus the model files; two scenes with the same key
 * get the same page, so the player keeps a scene clip's page across edits of events and properties and just draws
 * the frame again (no reload). Files are keyed by name, length and a hash of their text.
 */
const pageKeys = new WeakMap<SceneDoc, string>();
export function scenePageKey(doc: SceneDoc | undefined): string {
  if (!doc) return "none";
  const hit = pageKeys.get(doc);
  if (hit !== undefined) return hit;
  const lights = doc.world && typeof doc.world === "object" ? doc.world.lights : undefined;
  const objects = (Array.isArray(doc.objects) ? doc.objects : []).map((o) => (o && typeof o === "object" ? [o.id, o.shape, o.size, o.model] : null));
  const files = doc.files && typeof doc.files === "object" ? Object.entries(doc.files).map(([n, d]) => [n, typeof d === "string" ? `${d.length}:${hashText(d)}` : null]) : [];
  const key = JSON.stringify([lights ?? null, objects, files]);
  pageKeys.set(doc, key);
  return key;
}
/** FNV-1a over the text (32-bit, hex). */
function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

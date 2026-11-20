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
/**
 * P82: the Script objects' context (`ctx` of build / update), shared by the page and the check worker: the object's id,
 * `random(seed?)` (a new seeded generator, the same numbers for one object and seed every time) and
 * `makeCanvas(w, h)` (an OffscreenCanvas, up to 4096 px a side).
 */
export const SCRIPT_CTX_JS = `function scriptHash(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function scriptCtx(id) {
  return Object.freeze({
    id,
    random(seed) {
      let a = (scriptHash(String(id)) ^ Math.imul(scriptHash(String(seed === undefined ? 0 : seed)), 0x9e3779b1)) >>> 0;
      return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    },
    makeCanvas(w, h) { return new OffscreenCanvas(Math.max(1, Math.min(4096, w | 0)), Math.max(1, Math.min(4096, h | 0))); },
  });
}
`;

/**
 * P82: the check worker. Before the page runs a script it runs it once in a worker (build, then update at a few
 * times) under a time limit, so a script that never ends is stopped (the worker is terminated) instead of freezing
 * the page; errors there are ignored (the page reports them when it runs the script, with the DOM it may need). It is
 * a classic worker from a blob: URL (a module worker can't start from the sandboxed page's opaque origin in Chrome)
 * that loads three.js and the script with dynamic import(). A script that can't be checked is not run.
 */
export const SCRIPT_WORKER_JS = `${SCRIPT_CTX_JS}
let THREE = null;
onmessage = async (e) => {
  const d = e.data;
  if (d.type === "three") {
    try { THREE = await import(d.url); postMessage({ type: "ready" }); } catch (err) { postMessage({ type: "ready", error: String((err && err.message) || err) }); }
    return;
  }
  try {
    const mod = await import(d.url);
    if (typeof mod.build === "function") {
      const ctx = scriptCtx(d.id), params = Object.freeze(Object.assign({}, d.params));
      const obj = await mod.build(THREE, params, ctx);
      if (typeof mod.update === "function") for (const t of d.times) mod.update(obj, t, params, ctx);
    }
  } catch (_) { /* reported by the page */ }
  postMessage({ type: "done", seq: d.seq });
};
`;

/** P81a: the part shared with the Edit view page: renderer, world, lights, objects, models and poses (no frame loop). */
export const SCENE_BUILD_JS = `import * as THREE from "three";
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
// P82: Script objects. Each script is first run in a worker under a time limit (an endless loop is stopped there), then
// built in the page; a script that fails keeps the object's shape and is reported (once per problem): to the player as
// an asset problem, and in the Edit view to the editor's Problems.
${SCRIPT_CTX_JS}const SCRIPT_LIMIT_MS = 3000, UPDATE_WARN_MS = 250;
const scriptIssues = [], scriptSeen = new Set();
let reportScript = (x) => { try { parent.postMessage({ type: "dionysus:asset-error", messages: ["Script object \\"" + x.id + "\\": " + x.message] }, "*"); } catch (_) {} };
function scriptNote(id, message, key) {
  const k = id + "\\n" + (key || message);
  if (scriptSeen.has(k)) return;
  scriptSeen.add(k); const x = { id, message }; scriptIssues.push(x); reportScript(x);
}
const errText = (e) => String((e && e.message) || e);
const realNow = () => { const m = performance.mark("dionysus-script"); performance.clearMarks("dionysus-script"); return m.startTime; };
const scriptWorkerUrl = URL.createObjectURL(new Blob([${JSON.stringify(SCRIPT_WORKER_JS)}], { type: "text/javascript" }));
function scriptChecker() {
  let w = null, ready = null, seq = 0;
  const start = () => {
    try { w = new Worker(scriptWorkerUrl); } catch (err) { console.error(err); ready = Promise.resolve(false); return; }
    ready = new Promise((ok) => {
      const to = setTimeout(() => ok(false), 15000);
      w.onmessage = (e) => { if (e.data && e.data.type === "ready") { clearTimeout(to); ok(!e.data.error); } };
      w.onerror = () => { clearTimeout(to); ok(false); };
    });
    w.postMessage({ type: "three", url: import.meta.resolve("three") });
  };
  return {
    async check(job) {
      if (!ready) start();
      if (!(await ready) || !w) return "unchecked";
      const n = ++seq;
      return new Promise((ok) => {
        const to = setTimeout(() => { w.terminate(); w = null; ready = null; ok("slow"); }, SCRIPT_LIMIT_MS);
        w.onmessage = (e) => { if (e.data && e.data.type === "done" && e.data.seq === n) { clearTimeout(to); ok("ok"); } };
        w.postMessage(Object.assign({ type: "job", seq: n }, job));
      });
    },
    stop() { if (w) w.terminate(); w = null; },
  };
}
async function loadScripts(ctx) {
  const list = objects.filter((o) => o.script && typeof o.script === "object" && typeof o.script.file === "string" && !(typeof o.model === "string" && o.model));
  if (!list.length) return;
  const dur = typeof doc.durationSec === "number" && doc.durationSec > 0 ? doc.durationSec : 5;
  const checker = scriptChecker();
  try {
    for (const o of list) {
      const shape = o.shape || "box", src = ctx.asset(o.script.file);
      if (!src) { scriptNote(o.id, "\\"" + o.script.file + "\\" is not in the scene's files; a " + shape + " is drawn instead."); continue; }
      let url;
      try { url = URL.createObjectURL(new Blob([await (await fetch(src)).text()], { type: "text/javascript" })); }
      catch (err) { scriptNote(o.id, "couldn't read \\"" + o.script.file + "\\"; a " + shape + " is drawn instead."); continue; }
      const params = Object.freeze(Object.assign({}, o.script.params && typeof o.script.params === "object" ? o.script.params : {}));
      const verdict = await checker.check({ id: o.id, url, params, times: [0, 0.5, dur / 2, dur] });
      // Without the check a script could freeze the page (and an export), so it isn't run.
      if (verdict === "unchecked") { scriptNote(o.id, "couldn't be checked (no worker in this browser), so it wasn't run; a " + shape + " is drawn instead."); continue; }
      if (verdict === "slow") { scriptNote(o.id, "build and update took longer than " + SCRIPT_LIMIT_MS / 1000 + " s (an endless loop?) and were stopped; a " + shape + " is drawn instead."); continue; }
      let mod, obj;
      const sctx = scriptCtx(o.id);
      try { mod = await import(url); } catch (err) { scriptNote(o.id, "couldn't load: " + errText(err) + "; a " + shape + " is drawn instead."); continue; }
      if (typeof mod.build !== "function") { scriptNote(o.id, "doesn't export build(THREE, params, ctx); a " + shape + " is drawn instead."); continue; }
      try { obj = await mod.build(THREE, params, sctx); } catch (err) { scriptNote(o.id, "build failed: " + errText(err) + "; a " + shape + " is drawn instead."); continue; }
      if (!obj || !obj.isObject3D) { scriptNote(o.id, "build must return a THREE.Object3D (a Mesh, Points, Group…); a " + shape + " is drawn instead."); continue; }
      const group = new THREE.Group(); group.rotation.order = "XYZ"; group.add(obj);
      const old = nodes.get(o.id);
      scene.remove(old.node); old.node.geometry.dispose(); old.node.material.dispose();
      scene.add(group);
      nodes.set(o.id, { node: group, tint: false, mats: [], script: { id: o.id, obj, update: typeof mod.update === "function" ? mod.update : null, params, ctx: sctx } });
    }
  } finally { checker.stop(); }
}
// update(obj, t, params, ctx) for this frame; an error or a slow frame is reported (the object keeps what it has).
function runScript(n, t) {
  const s = n.script; if (!s || !s.update) return;
  try {
    const a = realNow();
    s.update(s.obj, t, s.params, s.ctx);
    const ms = realNow() - a;
    if (ms > UPDATE_WARN_MS) scriptNote(s.id, "update took " + Math.round(ms) + " ms for one frame (keep it under " + UPDATE_WARN_MS + " ms: export waits for every frame).", "slow");
  } catch (err) { scriptNote(s.id, "update failed (first at " + +t.toFixed(3) + " s): " + errText(err), "update"); }
}
// The object's opacity on every material of a script's object: each material's own opacity (as the script left it)
// times the object's, so a script that sets opacity itself keeps working and nothing compounds between frames.
const fadeBase = new WeakMap();
function fadeTree(root, k) {
  root.traverse((node) => {
    if (!node.material) return;
    for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
      let b = fadeBase.get(m);
      if (!b || m.opacity !== b.applied || m.transparent !== b.appliedTr) b = { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite };
      const tr = b.transparent || k < 1;
      if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = tr && !b.transparent ? false : b.depthWrite; m.needsUpdate = true; }
      m.opacity = b.opacity * k;
      b.applied = m.opacity; b.appliedTr = m.transparent; fadeBase.set(m, b);
    }
  });
}
// One object's state at scene time t: transform, visibility, tint, opacity, model pose and parts, script update.
function applyObject(n, o, t) {
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
  if (n.script) { runScript(n, t); fadeTree(n.script.obj, o.opacity); }
}
`;
/** The frame part: draw the state the editor sends for each time, from the scene's camera. */
const SCENE_CLIP_JS = `dionysus.clip({
  init: async (ctx) => { await loadModels(ctx); await loadScripts(ctx); },
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
    for (const o of s.objects) { const n = nodes.get(o.id); if (n) applyObject(n, o, typeof s.t === "number" ? s.t : t); }
    renderer.render(scene, camera);
  },
});
`;
export const SCENE_RUNTIME_JS = SCENE_BUILD_JS + SCENE_CLIP_JS;

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
  const { models, scripts } = sceneFileUse(rest);
  if (!models && !scripts) return page;
  const used = files && typeof files === "object" ? Object.fromEntries(Object.entries(files).filter(([, d]) => typeof d === "string")) : {};
  return writeManifest(page, { libs: models ? ["three", "three-gltf"] : ["three"], files: used });
}

/** Whether a scene has model objects (GLTFLoader and the files) or Script objects (P82: the files). */
export function sceneFileUse(doc: Pick<SceneDoc, "objects">): { models: boolean; scripts: boolean } {
  const list = Array.isArray(doc.objects) ? doc.objects : [];
  return {
    models: list.some((o) => o && typeof o.model === "string" && o.model),
    scripts: list.some((o) => o && o.script && typeof o.script === "object" && typeof o.script.file === "string"),
  };
}

/**
 * P76: what the page is built from. The page reads only the lights and each object's id, shape, size and model from
 * the embedded scene (everything else arrives per frame as state), plus the model files (P82: and each object's
 * script: its file and params); two scenes with the same key
 * get the same page, so the player keeps a scene clip's page across edits of events and properties and just draws
 * the frame again (no reload). Files are keyed by name, length and a hash of their text.
 */
const pageKeys = new WeakMap<SceneDoc, string>();
export function scenePageKey(doc: SceneDoc | undefined): string {
  if (!doc) return "none";
  const hit = pageKeys.get(doc);
  if (hit !== undefined) return hit;
  const lights = doc.world && typeof doc.world === "object" ? doc.world.lights : undefined;
  const objects = (Array.isArray(doc.objects) ? doc.objects : []).map((o) => (o && typeof o === "object" ? [o.id, o.shape, o.size, o.model, o.script ?? null] : null));
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

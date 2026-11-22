import type { SceneDoc } from "../domain/scene";
import { lookStructure } from "../domain/sceneLook";
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
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// Scene Phase 1 (#350): shadows (any light with "shadow" turns the shadow map on; every object then casts and receives).
const shadows = lights.some((l) => l && l.shadow && (l.type === "directional" || l.type === "point"));
if (shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; }
const lightNodes = [];
for (const l of lights) {
  const c = new THREE.Color(l.color || "#ffffff"), k = typeof l.intensity === "number" ? l.intensity : 1;
  const L = l.type === "ambient" ? new THREE.AmbientLight(c, k) : l.type === "hemisphere" ? new THREE.HemisphereLight(c, l.groundColor || 0x303040, k)
    : l.type === "point" ? new THREE.PointLight(c, k * 10, 0, 2) : new THREE.DirectionalLight(c, k);
  if (Array.isArray(l.position)) L.position.set(l.position[0], l.position[1], l.position[2]);
  if (L.isDirectionalLight) { if (Array.isArray(l.lookAt)) L.target.position.set(l.lookAt[0], l.lookAt[1], l.lookAt[2]); scene.add(L.target); }
  if (l.shadow && (L.isDirectionalLight || L.isPointLight)) {
    const s = isObj(l.shadow) ? l.shadow : {};
    L.castShadow = true;
    const size = s.mapSize || 2048; L.shadow.mapSize.set(size, size);
    L.shadow.bias = typeof s.bias === "number" ? s.bias : -0.0005;
    L.shadow.normalBias = typeof s.normalBias === "number" ? s.normalBias : 0.02;
    L.shadow.radius = typeof s.radius === "number" ? s.radius : 2;
    if (L.isDirectionalLight) { const a = s.area || 10, sc = L.shadow.camera; sc.left = -a; sc.right = a; sc.top = a; sc.bottom = -a; sc.near = 0.1; sc.far = 200; sc.updateProjectionMatrix(); }
  }
  scene.add(L); lightNodes.push(L);
}
// The lights at this frame (state.lights, from the pure evaluator: events and the sky's sun already applied).
function applyLights(list) {
  if (!Array.isArray(list)) return;
  lightNodes.forEach((L, i) => {
    const l = list[i]; if (!l) return;
    L.color.set(l.color); L.intensity = L.isPointLight ? l.intensity * 10 : l.intensity;
    if (Array.isArray(l.position)) L.position.fromArray(l.position);
    if (L.isDirectionalLight && Array.isArray(l.target)) L.target.position.fromArray(l.target);
    if (L.isHemisphereLight && l.groundColor) L.groundColor.set(l.groundColor);
    L.updateMatrixWorld(); if (L.target) L.target.updateMatrixWorld();
  });
}
// Scene Phase 1: materials. "standard" is the old look; "toon" bands the light (a gradient map of "steps"); "unlit"
// ignores lights; "rim" adds a fresnel edge; "outline" adds an inverted hull (a back-face shell pushed out along the
// normals) that follows skinning and morphs.
const matSpec = (o) => (typeof o.material === "string" ? { type: o.material } : isObj(o.material) ? o.material : null);
const gradients = new Map();
function gradientMap(steps) {
  const n = Math.max(2, Math.min(8, steps | 0 || 3));
  if (gradients.has(n)) return gradients.get(n);
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.round((i / (n - 1)) * 255);
  const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  gradients.set(n, tex); return tex;
}
function addRim(m, rim) {
  if (!rim || m.isMeshBasicMaterial) return;
  const r = isObj(rim) ? rim : {};
  const color = new THREE.Color(r.color || "#ffffff"), strength = typeof r.strength === "number" ? r.strength : 0.6, power = typeof r.power === "number" ? r.power : 3;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = { value: color }; sh.uniforms.rimStrength = { value: strength }; sh.uniforms.rimPower = { value: power };
    sh.fragmentShader = "uniform vec3 rimColor; uniform float rimStrength; uniform float rimPower;\\n" + sh.fragmentShader.replace("#include <opaque_fragment>",
      "outgoingLight += rimColor * rimStrength * pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), rimPower);\\n#include <opaque_fragment>");
  };
  m.customProgramCacheKey = () => "rim";
}
// A material of a type from the look of an existing one (a model's or script's): colour, maps and alpha carry over.
function makeMaterial(type, from, spec) {
  const p = { color: from.color ? from.color.clone() : new THREE.Color(0xcccccc), map: from.map || null, side: from.side, transparent: !!from.transparent, opacity: from.opacity ?? 1, alphaTest: from.alphaTest || 0, vertexColors: !!from.vertexColors };
  let m;
  if (type === "unlit") m = new THREE.MeshBasicMaterial(p);
  else if (type === "toon") m = new THREE.MeshToonMaterial({ ...p, gradientMap: gradientMap(spec.steps), normalMap: from.normalMap || null, emissive: from.emissive ? from.emissive.clone() : new THREE.Color(0), emissiveMap: from.emissiveMap || null });
  else m = new THREE.MeshStandardMaterial({ ...p, roughness: from.roughness ?? 0.55, metalness: from.metalness ?? 0.1, normalMap: from.normalMap || null, emissive: from.emissive ? from.emissive.clone() : new THREE.Color(0), emissiveMap: from.emissiveMap || null });
  return m;
}
function styleMaterial(x, spec) {
  let m = spec.type && spec.type !== "keep" ? makeMaterial(spec.type, x, spec) : x;
  if (typeof spec.roughness === "number" && "roughness" in m) m.roughness = spec.roughness;
  if (typeof spec.metalness === "number" && "metalness" in m) m.metalness = spec.metalness;
  if (spec.emissive && m.emissive) { m.emissive.set(spec.emissive); m.emissiveIntensity = typeof spec.emissiveIntensity === "number" ? spec.emissiveIntensity : 1; }
  else if (typeof spec.emissiveIntensity === "number" && m.emissive) m.emissiveIntensity = spec.emissiveIntensity;
  addRim(m, spec.rim);
  return m;
}
const outlineMats = new Map();
function outlineMaterial(spec) {
  const o = isObj(spec) ? spec : {};
  const color = o.color || "#101014", width = typeof o.width === "number" ? o.width : 0.02, key = color + "|" + width;
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\\ntransformed += normalize(normal) * " + width.toFixed(5) + ";"); };
  m.customProgramCacheKey = () => "outline" + key;
  return m;
}
// Add an outline shell to a mesh (a child with the same geometry, skeleton and morphs); returns its material.
function addOutline(mesh, spec) {
  const mat = outlineMaterial(spec);
  const hull = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, mat) : new THREE.Mesh(mesh.geometry, mat);
  if (mesh.isSkinnedMesh) hull.bind(mesh.skeleton, mesh.bindMatrix);
  if (mesh.morphTargetInfluences) { hull.morphTargetInfluences = mesh.morphTargetInfluences; hull.morphTargetDictionary = mesh.morphTargetDictionary; }
  hull.castShadow = false; hull.receiveShadow = false; hull.frustumCulled = false; hull.userData.outline = true;
  mesh.add(hull);
  return mat;
}
// A model's or script's tree in the object's style: each mesh's materials converted / styled, an outline per mesh.
function styleTree(root, spec, mats) {
  const meshes = [];
  root.traverse((n) => { if (n.isMesh && !n.userData.outline) meshes.push(n); });
  for (const n of meshes) {
    if (shadows) { n.castShadow = true; n.receiveShadow = true; }
    if (!spec) continue;
    const list = Array.isArray(n.material) ? n.material : [n.material];
    const next = list.map((x) => styleMaterial(x, spec));
    n.material = Array.isArray(n.material) ? next : next[0];
    if (spec.outline) { const om = addOutline(n, spec.outline); if (mats) mats.push({ m: om, opacity: 1, transparent: false }); }
  }
}
// Scene Phase 1: fog (values per frame from state.fog).
if (isObj(world.fog)) scene.fog = world.fog.type === "exp2" ? new THREE.FogExp2(0x000000, 0.03) : new THREE.Fog(0x000000, 10, 60);
function applyFog(f) {
  if (!scene.fog || !f) return;
  scene.fog.color.set(f.color);
  if (scene.fog.isFogExp2) scene.fog.density = f.density; else { scene.fog.near = f.near; scene.fog.far = Math.max(f.far, f.near + 1e-3); }
}
// Scene Phase 1: the addons (post-processing, Sky, RGBELoader) from the vendored bundle, loaded only when used (a
// variable specifier, like GLTFLoader, so pages without them don't list it).
let lookLib = null;
const lookAddons = async () => { if (!lookLib) { const LOOK = "three/addons/dionysus-look.js"; lookLib = await import(LOOK); } return lookLib; };
let sky = null, envBackground = null;
async function loadLook(ctx) {
  if (isObj(world.sky)) {
    const { Sky } = await lookAddons();
    sky = new Sky(); sky.scale.setScalar(400); sky.frustumCulled = false; scene.add(sky);
  }
  const env = isObj(world.environment) && typeof world.environment.file === "string" ? world.environment : null;
  const url = env && ctx.asset(env.file);
  if (url) {
    try {
      let tex;
      if (/\\.hdr$/i.test(env.file)) { const { RGBELoader } = await lookAddons(); tex = await new RGBELoader().loadAsync(url); }
      else { tex = await new THREE.TextureLoader().loadAsync(url); tex.colorSpace = THREE.SRGBColorSpace; }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromEquirectangular(tex).texture; pm.dispose();
      if (env.background) envBackground = tex;
    } catch (err) { console.error(err); }
  }
}
const sunVec = new THREE.Vector3();
// Background, sky, fog and lights at this frame. "lights" false: the Edit view sets lights itself (while dragging).
function applyLook(s, withLights) {
  if (envBackground) scene.background = envBackground;
  else if (sky) scene.background = null;
  else scene.background = new THREE.Color(s.background);
  if (sky && s.sky) {
    const u = sky.material.uniforms;
    u.turbidity.value = s.sky.turbidity; u.rayleigh.value = s.sky.rayleigh; u.mieCoefficient.value = s.sky.mieCoefficient; u.mieDirectionalG.value = s.sky.mieDirectionalG;
    sunVec.setFromSphericalCoords(1, (90 - s.sky.elevation) * D, s.sky.azimuth * D); u.sunPosition.value.copy(sunVec);
  }
  applyFog(s.fog);
  if (withLights !== false) applyLights(s.lights);
}
// Tone mapping without the post stack: a scene with a sky (and no "post") gets ACES, as its sky is HDR.
const TONE = { none: THREE.NoToneMapping, linear: THREE.LinearToneMapping, reinhard: THREE.ReinhardToneMapping, cineon: THREE.CineonToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping };
if (isObj(world.post)) renderer.toneMapping = TONE[world.post.toneMapping] ?? (isObj(world.sky) ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping);
else if (isObj(world.sky)) renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
  const side = o.shape === "plane" ? THREE.DoubleSide : THREE.FrontSide;
  const spec = matSpec(o);
  const base = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.55, metalness: 0.1, side });
  // A shape's own material ("keep" = standard); without "material" exactly the old one.
  const mat = spec ? styleMaterial(base, { ...spec, type: spec.type === "keep" ? "standard" : spec.type || "standard" }) : base;
  if (mat !== base) base.dispose();
  const m = new THREE.Mesh(geometry(o), mat);
  m.rotation.order = "XYZ";
  if (shadows) { m.castShadow = true; m.receiveShadow = true; }
  const mats = [{ m: mat, opacity: 1, transparent: false }];
  if (spec && spec.outline) mats.push({ m: addOutline(m, spec.outline), opacity: 1, transparent: false });
  scene.add(m); nodes.set(o.id, { node: m, tint: true, mats });
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
    });
    // Scene Phase 1 (#350): the object's material style (and outline shells), then the materials its opacity drives.
    styleTree(root, matSpec(o), null);
    root.traverse((n) => { if (n.isMesh) for (const x of Array.isArray(n.material) ? n.material : [n.material]) mats.push({ m: x, opacity: x.opacity, transparent: x.transparent }); });
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
      // Scene Phase 1 (#350): a Script object opts in to a material style by having "material".
      try { styleTree(obj, matSpec(o), null); } catch (err) { scriptNote(o.id, "its material style couldn't be applied: " + errText(err)); }
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
/**
 * Scene Phase 1 (#350): the post-processing stack, built once when the scene has world.post: the scene (through SSAO
 * when on), bloom, depth of field, the output pass (tone mapping + sRGB), a grade pass (lift / gamma / gain, contrast,
 * saturation, vignette, film grain seeded by the frame's time) and FXAA or SMAA. Every value is set per frame from
 * state.post, and composer.render(0) never reads a clock, so a frame is a function of the document and t.
 */
export const SCENE_POST_JS = `const GRADE = {
  uniforms: { tDiffuse: { value: null }, contrast: { value: 1 }, saturation: { value: 1 }, lift: { value: new THREE.Vector3() }, gamma: { value: new THREE.Vector3(1, 1, 1) },
    gain: { value: new THREE.Vector3(1, 1, 1) }, vignette: { value: 0 }, grain: { value: 0 }, seed: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: [
    "uniform sampler2D tDiffuse; uniform float contrast, saturation, vignette, grain, seed; uniform vec3 lift, gamma, gain; uniform vec2 res; varying vec2 vUv;",
    "float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }",
    "void main() {",
    "  vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb;",
    "  col = gain * (col + lift * (1.0 - col));",
    "  col = pow(max(col, vec3(0.0)), 1.0 / max(gamma, vec3(0.01)));",
    "  col = (col - 0.5) * contrast + 0.5;",
    "  float l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = mix(vec3(l), col, saturation);",
    "  vec2 d = vUv - 0.5; d.x *= res.x / res.y;",
    "  col *= 1.0 - vignette * smoothstep(0.25, 0.95, length(d) * 1.1);",
    "  col += (hash(floor(vUv * res) + seed) - 0.5) * grain * 0.3;",
    "  gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);",
    "}",
  ].join("\\n"),
};
let post = null;
async function initPost() {
  const P = isObj(world.post) ? world.post : null;
  if (!P) return;
  const L = await lookAddons();
  const w = 16, h = 9; // resized on the first frame
  const composer = new L.EffectComposer(renderer);
  composer.renderToScreen = true;
  const on = (v) => v === true || isObj(v);
  const x = { composer };
  // SSAOPass draws its sample kernel from the clip runtime's seeded random numbers, and the page builds everything in
  // the same order for one document, so preview and export get the same kernel.
  // (In three 0.160 SSAOPass darkens the picture of the pass before it, so the scene is always rendered first.)
  composer.addPass(new L.RenderPass(scene, camera));
  if (on(P.ssao)) { x.ssao = new L.SSAOPass(scene, camera, w, h); composer.addPass(x.ssao); }
  if (on(P.bloom)) { x.bloom = new L.UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.4, 0.85); composer.addPass(x.bloom); }
  if (on(P.dof)) { x.dof = new L.BokehPass(scene, camera, { focus: 6, aperture: 0.01, maxblur: 0.01 }); composer.addPass(x.dof); }
  composer.addPass(new L.OutputPass());
  x.grade = new L.ShaderPass(GRADE); composer.addPass(x.grade);
  const aa = P.aa || "fxaa";
  if (aa === "fxaa") { x.fxaa = new L.ShaderPass(L.FXAAShader); composer.addPass(x.fxaa); }
  else if (aa === "smaa") {
    x.smaa = new L.SMAAPass(w, h); composer.addPass(x.smaa);
    // Its lookup textures are images (data: URLs): wait for them to load so the first frame is anti-aliased like the
    // rest. The load event, not decode(): decode() may never settle in a background page (an export must not hang).
    const loaded = (img) => new Promise((ok) => {
      if (!img || img.complete) { ok(); return; }
      img.addEventListener("load", ok, { once: true }); img.addEventListener("error", ok, { once: true });
    });
    await Promise.all([x.smaa.areaTexture, x.smaa.searchTexture].map((t) => loaded(t && t.image)));
    for (const t of [x.smaa.areaTexture, x.smaa.searchTexture]) if (t) t.needsUpdate = true;
  }
  post = x;
}
function renderPost(s, rw, rh, ss, t) {
  const x = post, p = s.post;
  if (x.w !== rw || x.h !== rh) {
    x.composer.setPixelRatio(1); x.composer.setSize(rw, rh); x.w = rw; x.h = rh;
    if (x.fxaa) x.fxaa.material.uniforms.resolution.value.set(1 / rw, 1 / rh);
  }
  if (p) {
    const tm = TONE[p.toneMapping] ?? THREE.NoToneMapping;
    // Exposure needs a tone mapping: "none" with exposure becomes linear (the same picture at exposure 1).
    renderer.toneMapping = tm === THREE.NoToneMapping && p.exposure !== 1 ? THREE.LinearToneMapping : tm;
    renderer.toneMappingExposure = p.exposure;
    if (x.bloom && p.bloom) { x.bloom.strength = p.bloom.strength; x.bloom.radius = p.bloom.radius; x.bloom.threshold = p.bloom.threshold; }
    if (x.dof && p.dof) { const u = x.dof.uniforms; u.focus.value = p.dof.focus; u.aperture.value = p.dof.aperture; u.maxblur.value = p.dof.maxblur; u.aspect.value = rw / rh; }
    if (x.ssao && p.ssao) {
      x.ssao.kernelRadius = p.ssao.radius; x.ssao.minDistance = p.ssao.minDistance; x.ssao.maxDistance = p.ssao.maxDistance;
      // SSAOPass copies the projection only on resize; the camera's field of view can change every frame.
      const u = x.ssao.ssaoMaterial.uniforms;
      u.cameraProjectionMatrix.value.copy(camera.projectionMatrix); u.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
      u.cameraNear.value = camera.near; u.cameraFar.value = camera.far;
    }
    const g = x.grade.uniforms;
    g.contrast.value = p.contrast; g.saturation.value = p.saturation; g.lift.value.fromArray(p.lift); g.gamma.value.fromArray(p.gamma); g.gain.value.fromArray(p.gain);
    g.vignette.value = p.vignette; g.grain.value = p.grain;
    // Grain: one pattern per frame time, the same size at any supersampling.
    g.seed.value = Math.floor(t * 1000) % 9973; g.res.value.set(rw / ss, rh / ss);
  }
  x.composer.render(0);
}
`;
const SCENE_CLIP_JS = `dionysus.clip({
  init: async (ctx) => { await loadModels(ctx); await loadScripts(ctx); await loadLook(ctx); await initPost(); },
  render(t, ctx) {
    const s = ctx.inputs && ctx.inputs.scene;
    if (!s) return;
    const w = ctx.width || innerWidth, h = ctx.height || innerHeight;
    // Scene Phase 1 (#350): export may ask for supersampling (render larger; the editor scales the frame down).
    const want = Math.max(1, Math.min(4, (ctx.inputs.supersample | 0) || 1));
    const ss = Math.max(1, Math.min(want, 8192 / Math.max(w, h)));
    const rw = Math.round(w * ss), rh = Math.round(h * ss);
    if (canvas.width !== rw || canvas.height !== rh) renderer.setSize(rw, rh, false);
    applyLook(s);
    camera.aspect = w / h; camera.fov = s.camera.fov;
    camera.position.set(s.camera.position[0], s.camera.position[1], s.camera.position[2]);
    camera.lookAt(s.camera.target[0], s.camera.target[1], s.camera.target[2]);
    camera.updateProjectionMatrix();
    const time = typeof s.t === "number" ? s.t : t;
    for (const o of s.objects) { const n = nodes.get(o.id); if (n) applyObject(n, o, time); }
    if (post) renderPost(s, rw, rh, ss, time);
    else renderer.render(scene, camera);
  },
});
`;
export const SCENE_RUNTIME_JS = SCENE_BUILD_JS + SCENE_POST_JS + SCENE_CLIP_JS;

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
  const { models, scripts, look, environment } = sceneFileUse(rest);
  if (!models && !scripts && !look && !environment) return page;
  const used = files && typeof files === "object" ? Object.fromEntries(Object.entries(files).filter(([, d]) => typeof d === "string")) : {};
  return writeManifest(page, { libs: ["three", ...(models ? ["three-gltf"] : []), ...(look ? ["three-look"] : [])], files: models || scripts || environment ? used : {} });
}

/**
 * Whether a scene has model objects (GLTFLoader and the files) or Script objects (P82: the files); Scene Phase 1
 * (#350): `look` = it needs the vendored look addons (post-processing, sky, or an .hdr environment), `environment` =
 * it has an environment map file.
 */
export function sceneFileUse(doc: Pick<SceneDoc, "objects"> & { world?: SceneDoc["world"] }): { models: boolean; scripts: boolean; look: boolean; environment: boolean } {
  const list = Array.isArray(doc.objects) ? doc.objects : [];
  const w = doc.world && typeof doc.world === "object" ? doc.world : {};
  const env = w.environment && typeof w.environment === "object" && typeof w.environment.file === "string" ? w.environment.file : "";
  const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  return {
    models: list.some((o) => o && typeof o.model === "string" && o.model),
    scripts: list.some((o) => o && o.script && typeof o.script === "object" && typeof o.script.file === "string"),
    look: isObj(w.post) || isObj(w.sky) || /\.hdr$/i.test(env),
    environment: !!env,
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
  // Scene Phase 1 (#350): which look parts the page builds (materials, post passes, fog type, sky, environment).
  const look = lookStructure(doc.world, doc.objects);
  const key = JSON.stringify([lights ?? null, objects, files, look]);
  pageKeys.set(doc, key);
  return key;
}
/** FNV-1a over the text (32-bit, hex). */
function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

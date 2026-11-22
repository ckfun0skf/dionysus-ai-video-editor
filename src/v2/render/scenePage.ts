import type { SceneDoc } from "../domain/scene";
import { lookStructure } from "../domain/sceneLook";
import { autoRig, BUILTIN_CLIPS, HUMAN_BONES, UPPER_BONES } from "../domain/sceneCharacter";
import { glbInfoOfDataUrl } from "../domain/glb";
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

/**
 * Scene Phase 2 (#351): characters in the page. Every frame a character's state (layers, look, expressions) from the
 * pure evaluator becomes a pose on the **normalized humanoid** (T-pose, facing +z, rest rotations identity): each layer
 * is sampled (built-in clips from their keys, library clips from their GLB's tracks converted to normalized), full
 * layers are blended by weight, upper-body layers override the bones they move, the head turns to the look target.
 * The pose is then mapped onto the rig — the mannequin directly, VRM through its normalized bones, a GLB through each
 * bone's rest rotation — and the face is set (VRM expressions, GLB morph targets or the mannequin's face). Nothing is
 * carried between frames. Held objects follow the hand bone (applyHolds, after every object is posed).
 */
export const SCENE_CHARACTER_JS = `const HB = CHAR.bones || [];
const UPPER = new Set(CHAR.upper || []);
const NPARENT = { spine: "hips", chest: "spine", upperChest: "chest", neck: "upperChest", head: "neck", leftEye: "head", rightEye: "head",
  leftShoulder: "upperChest", leftUpperArm: "leftShoulder", leftLowerArm: "leftUpperArm", leftHand: "leftLowerArm",
  rightShoulder: "upperChest", rightUpperArm: "rightShoulder", rightLowerArm: "rightUpperArm", rightHand: "rightLowerArm",
  leftUpperLeg: "hips", leftLowerLeg: "leftUpperLeg", leftFoot: "leftLowerLeg", leftToes: "leftFoot",
  rightUpperLeg: "hips", rightLowerLeg: "rightUpperLeg", rightFoot: "rightLowerLeg", rightToes: "rightFoot" };
const qE = new THREE.Euler(), qTmp = new THREE.Quaternion(), qTmp2 = new THREE.Quaternion(), vTmp = new THREE.Vector3();
const keyQuats = new WeakMap();
// A clip's local time: looped, ping-ponged or held (as the evaluator's unwrapped time asks).
function wrapTime(t, len, loop) {
  if (!(len > 0)) return 0;
  if (loop === "once") return Math.min(Math.max(0, t), len);
  if (loop === "pingpong") { const c = t % (2 * len); return c <= len ? c : 2 * len - c; }
  return ((t % len) + len) % len;
}
// One built-in clip at time t: { bone: Quaternion } (normalized locals) and the hips offset (metres for 1.7 m).
function sampleBuiltin(clip, t) {
  const time = wrapTime(t, clip.length, clip.loop), out = { q: {}, hips: null, keyed: clip.keyed };
  for (const b in clip.bones) {
    const keys = clip.bones[b];
    let qs = keyQuats.get(keys);
    if (!qs) { qs = keys.map((k) => new THREE.Quaternion().setFromEuler(qE.set(k[1] * D, k[2] * D, k[3] * D, "XYZ"))); keyQuats.set(keys, qs); }
    let i = 0; while (i + 1 < keys.length && keys[i + 1][0] <= time) i++;
    const a = keys[i], z = keys[Math.min(i + 1, keys.length - 1)];
    const f = z[0] > a[0] ? (time - a[0]) / (z[0] - a[0]) : 0;
    out.q[b] = qs[i].clone().slerp(qs[Math.min(i + 1, keys.length - 1)], Math.min(1, Math.max(0, f)));
  }
  if (clip.hips) {
    const keys = clip.hips; let i = 0; while (i + 1 < keys.length && keys[i + 1][0] <= time) i++;
    const a = keys[i], z = keys[Math.min(i + 1, keys.length - 1)];
    const f = z[0] > a[0] ? Math.min(1, Math.max(0, (time - a[0]) / (z[0] - a[0]))) : 0;
    out.hips = new THREE.Vector3(a[1] + (z[1] - a[1]) * f, a[2] + (z[2] - a[2]) * f, a[3] + (z[3] - a[3]) * f);
  }
  return out;
}
for (const name in CHAR.clips || {}) { const c = CHAR.clips[name]; c.keyed = new Set(Object.keys(c.bones)); }
// Library clips (animation-only GLBs): each is sampled from its tracks and converted to normalized locals.
const library = new Map();
async function loadAnimations(ctx) {
  const lib = doc.animations && typeof doc.animations === "object" ? doc.animations : {};
  const names = Object.keys(lib);
  if (!names.length) return;
  const GLTF = "three/addons/loaders/GLTFLoader.js";
  const { GLTFLoader } = await import(GLTF);
  const loader = new GLTFLoader();
  const files = new Map();
  for (const name of names) {
    const a = lib[name]; if (!a || typeof a.file !== "string") continue;
    const url = ctx.asset(a.file); if (!url) continue;
    let gltf = files.get(a.file);
    if (!gltf) { try { gltf = await loader.loadAsync(url); files.set(a.file, gltf); } catch (err) { console.error(err); continue; } }
    const clip = (gltf.animations || []).find((c) => !a.clip || c.name === a.clip);
    const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!clip || !root) continue;
    const rig = (CHAR.libraryRigs || {})[name] || {};
    library.set(name, makeLibrarySampler(clip, root, rig, a));
  }
}
const sanitize = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
function makeLibrarySampler(clip, root, rig, entry) {
  root.updateMatrixWorld(true);
  const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const bones = {};
  for (const b of HB) {
    const name = rig[b]; if (!name) continue;
    const node = root.getObjectByName(sanitize(name)); if (!node) continue;
    // The chain of nodes from the root to this bone, each with its rest local rotation and its rotation track.
    const chain = [];
    for (let x = node; x && x !== root; x = x.parent) chain.unshift(x);
    bones[b] = { node, chain, rest: rootInv.clone().multiply(node.getWorldQuaternion(new THREE.Quaternion())) };
  }
  const tracks = new Map();
  for (const tr of clip.tracks) { const m = /^(.*)\\.(quaternion|position)$/.exec(tr.name); if (m) tracks.set(m[1] + "." + m[2], tr.createInterpolant()); }
  const hips = bones.hips;
  const hipsPos = hips && tracks.get(hips.node.name + ".position");
  const hipsRest = hips ? hips.node.position.clone() : null;
  const hipsH = hips ? Math.max(1e-3, hips.node.getWorldPosition(new THREE.Vector3()).y - root.getWorldPosition(new THREE.Vector3()).y) : 1;
  const length = entry.length > 0 ? entry.length : clip.duration || 1;
  return {
    length, loop: entry.loop || "repeat", upper: entry.mask === "upper",
    sample(t) {
      const time = wrapTime(t, length, this.loop);
      const world = {}, q = {};
      const localAt = (x) => { const it = tracks.get(x.name + ".quaternion"); return it ? qTmp.fromArray(it.evaluate(time)) : x.quaternion; };
      for (const b of HB) {
        const x = bones[b]; if (!x) continue;
        const w = new THREE.Quaternion();
        for (const n of x.chain) w.multiply(localAt(n));
        world[b] = w.multiply(x.rest.clone().invert()); // normalized world rotation (w and rest are both relative to the root)
      }
      // Normalized locals along the humanoid hierarchy (a missing bone takes its parent's world rotation).
      const nw = {};
      for (const b of HB) {
        const p = NPARENT[b], pw = p ? nw[p] || new THREE.Quaternion() : new THREE.Quaternion();
        nw[b] = world[b] || pw.clone();
        q[b] = pw.clone().invert().multiply(nw[b]);
      }
      let off = null;
      if (hipsPos && hipsRest) {
        const p = new THREE.Vector3().fromArray(hipsPos.evaluate(time)).sub(hipsRest);
        p.applyQuaternion(rootInvMul(rootInv, hips.node.parent.getWorldQuaternion(new THREE.Quaternion())));
        const s = hips.node.parent.getWorldScale(new THREE.Vector3());
        off = new THREE.Vector3(0, (p.y * s.y) / hipsH * 0.92, 0); // in place: root motion is the walk's job
      }
      return { q, hips: off, keyed: this.upper ? UPPER : null };
    },
  };
}
const rootInvMul = (inv, q) => inv.clone().multiply(q);
// The normalized pose for a character's layers: full layers blended by weight, then upper-body layers on top.
function blendLayers(layers) {
  const q = {}, hips = new THREE.Vector3();
  let sum = 0;
  const sampleOf = (l) => {
    const lib = library.get(l.clip);
    if (lib) return lib.sample(l.time);
    const b = (CHAR.clips || {})[l.clip];
    return b ? sampleBuiltin(b, l.time) : null;
  };
  for (const l of layers) {
    if (l.mask !== "full") continue;
    const s = sampleOf(l); if (!s) continue;
    sum += l.weight;
    const k = l.weight / sum;
    for (const b of HB) {
      const v = s.q[b] || qTmp2.identity();
      q[b] = q[b] ? q[b].slerp(v, k) : v.clone();
    }
    if (s.hips) hips.lerp(s.hips, k); else hips.multiplyScalar(1 - k);
  }
  for (const l of layers) {
    if (l.mask !== "upper") continue;
    const s = sampleOf(l); if (!s) continue;
    for (const b of HB) {
      if (!UPPER.has(b) || !s.q[b] || (s.keyed && !s.keyed.has(b))) continue;
      q[b] = (q[b] || new THREE.Quaternion()).slerp(s.q[b], l.weight);
    }
  }
  return { q, hips };
}
// Head and neck turn towards the look target (yaw ±75°, pitch ±35°), 35 % neck and 65 % head, by the weight.
function applyHeadLook(n, pose, look) {
  if (!look || !(look.weight > 0)) return;
  const root = n.node;
  root.updateMatrixWorld(true);
  const local = root.worldToLocal(vTmp.set(look.target[0], look.target[1], look.target[2]));
  const sy = root.scale.y || 1;
  const head = n.char.height * 0.92 / sy;
  const dx = local.x, dy = local.y - head, dz = local.z;
  const yaw = Math.max(-75, Math.min(75, Math.atan2(dx, dz) / D)) * look.weight;
  const pitch = Math.max(-35, Math.min(35, Math.atan2(dy, Math.hypot(dx, dz)) / D)) * look.weight;
  for (const [b, k] of [["neck", 0.35], ["head", 0.65]]) {
    const add = new THREE.Quaternion().setFromEuler(qE.set(-pitch * k * D, yaw * k * D, 0, "YXZ"));
    pose.q[b] = (pose.q[b] || new THREE.Quaternion()).premultiply(add);
  }
}
// Put the normalized pose on the rig.
function applyPose(n, pose) {
  const c = n.char;
  if (c.kind === "mannequin" || c.kind === "vrm") {
    for (const b of HB) { const node = c.bone(b); if (node) node.quaternion.copy(pose.q[b] || qTmp.identity()); }
    const hips = c.bone("hips");
    if (hips) hips.position.copy(c.hipsRest).addScaledVector(pose.hips, c.hipsScale);
    if (c.kind === "vrm") c.vrm.humanoid.update();
    return;
  }
  // A GLB rig: each bone's world rotation = normalized world × its rest world rotation (relative to the model root).
  const nw = {};
  const root = c.root;
  root.updateMatrixWorld(true);
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
  for (const b of HB) {
    const p = NPARENT[b], pw = p ? nw[p] : null;
    nw[b] = (pw ? pw.clone() : new THREE.Quaternion()).multiply(pose.q[b] || qTmp.identity());
    const x = c.bones[b]; if (!x) continue;
    const target = rootQ.clone().multiply(nw[b]).multiply(x.rest);
    const parentQ = x.node.parent.getWorldQuaternion(new THREE.Quaternion());
    x.node.quaternion.copy(parentQ.invert().multiply(target));
    x.node.updateMatrixWorld(true);
  }
  const hips = c.bones.hips;
  if (hips && pose.hips) {
    const v = pose.hips.clone().multiplyScalar(c.hipsScale);
    const pm = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(hips.node.parent.matrixWorld).invert();
    v.applyMatrix3(new THREE.Matrix3().setFromMatrix4(pm));
    hips.node.position.copy(hips.pos).add(v);
  }
}
// Expressions: VRM presets, GLB morph targets (by name, with common aliases), or the mannequin's face.
const EXPR_ALIASES = { happy: ["happy", "joy", "smile", "fun"], angry: ["angry", "anger"], sad: ["sad", "sorrow"], surprised: ["surprised", "surprise"],
  relaxed: ["relaxed", "relax"], blink: ["blink", "eyesclosed", "eyeclose", "eye_close"], aa: ["aa", "a", "viseme_aa", "mouth_a"], ih: ["ih", "i", "viseme_i", "mouth_i"],
  ou: ["ou", "u", "viseme_u", "mouth_u"], ee: ["ee", "e", "viseme_e", "mouth_e"], oh: ["oh", "o", "viseme_o", "mouth_o"] };
function applyFace(n, ex) {
  const c = n.char;
  if (c.kind === "vrm") {
    const em = c.vrm.expressionManager; if (!em) return;
    for (const k in EXPR_ALIASES) { try { em.setValue(k, ex[k] || 0); } catch (_) {} }
    em.update();
    return;
  }
  if (c.kind === "mannequin") {
    const f = c.face, blink = ex.blink || 0, sur = ex.surprised || 0;
    for (const e of f.eyes) { e.scale.set(1 + sur * 0.3, Math.max(0.08, (1 - blink * 0.92) * (1 + sur * 0.35)), 1); }
    const open = Math.min(1, (ex.aa || 0) + (ex.oh || 0) * 0.8 + (ex.ou || 0) * 0.55 + (ex.ih || 0) * 0.45 + (ex.ee || 0) * 0.35 + sur * 0.6);
    const smile = (ex.happy || 0) + (ex.relaxed || 0) * 0.5 - (ex.sad || 0) - (ex.angry || 0) * 0.6;
    f.mouth.scale.set(1 + (ex.happy || 0) * 0.35 + (ex.ee || 0) * 0.25 - (ex.ou || 0) * 0.35, Math.max(0.15, 0.35 + open * 1.6), 1);
    f.smile.visible = open < 0.25; f.smile.scale.set(1, Math.max(0.05, Math.abs(smile)), 1); f.smile.rotation.z = smile >= 0 ? Math.PI : 0;
    f.mouth.visible = !f.smile.visible || open >= 0.25;
    for (const [i, b] of f.brows.entries()) b.rotation.z = (i ? 1 : -1) * ((ex.angry || 0) * 0.45 - (ex.sad || 0) * 0.35);
    return;
  }
  for (const m of c.morphs) {
    const dict = m.morphTargetDictionary, inf = m.morphTargetInfluences;
    for (const k in EXPR_ALIASES) { const i = c.morphIndex.get(m) && c.morphIndex.get(m)[k]; if (i !== undefined) inf[i] = ex[k] || 0; }
    void dict;
  }
}
function poseCharacter(n, cs) {
  const pose = blendLayers(cs.layers || []);
  applyHeadLook(n, pose, cs.look);
  applyPose(n, pose);
  applyFace(n, cs.expressions || {});
}
// Held objects follow the hand bone: its world transform, a little out along the hand.
function applyHolds(list) {
  for (const o of list) {
    if (!o.held) continue;
    const by = nodes.get(o.held.by), n = nodes.get(o.id);
    if (!by || !by.char || !n) continue;
    const hand = by.char.bone(o.held.hand === "left" ? "leftHand" : "rightHand");
    if (!hand) continue;
    by.node.updateMatrixWorld(true);
    hand.getWorldPosition(n.node.position);
    const out = new THREE.Vector3(o.held.hand === "left" ? 0.08 : -0.08, -0.04, 0.04).multiplyScalar(by.char.height / 1.7);
    n.node.position.add(out.applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion())));
    n.node.quaternion.copy(by.node.quaternion);
  }
}
// The rig of a model character: VRM normalized bones, or a GLB's bones by the bone map (each with its rest rotation).
function setupModelRig(o, root, vrm) {
  root.updateMatrixWorld(true);
  const height = (typeof o.size === "number" && o.size > 0) ? o.size : 1.7;
  if (vrm && vrm.humanoid) {
    const bone = (b) => vrm.humanoid.getNormalizedBoneNode(b);
    const hips = bone("hips");
    const hipsY = hips ? hips.getWorldPosition(new THREE.Vector3()).y - root.getWorldPosition(new THREE.Vector3()).y : 0.92;
    return { kind: "vrm", vrm, bone, height, hipsRest: hips ? hips.position.clone() : new THREE.Vector3(), hipsScale: Math.max(1e-3, hipsY / Math.max(1e-3, root.getWorldScale(vTmp).y)) / 0.92 };
  }
  const map = (CHAR.rigs || {})[o.id] || {};
  const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const bones = {};
  for (const b of HB) {
    const name = map[b]; if (!name) continue;
    const node = root.getObjectByName(sanitize(name)); if (!node) continue;
    bones[b] = { node, rest: rootInv.clone().multiply(node.getWorldQuaternion(new THREE.Quaternion())), pos: node.position.clone() };
  }
  const hipsNode = bones.hips && bones.hips.node;
  const hipsY = hipsNode ? (hipsNode.getWorldPosition(new THREE.Vector3()).y - root.getWorldPosition(new THREE.Vector3()).y) / Math.max(1e-6, root.getWorldScale(vTmp).y) : 0.92;
  const morphs = [], morphIndex = new Map();
  root.traverse((m) => {
    if (!m.isMesh || !m.morphTargetDictionary) return;
    const idx = {};
    for (const k in EXPR_ALIASES) for (const alias of EXPR_ALIASES[k]) {
      const hit = Object.keys(m.morphTargetDictionary).find((x) => x.toLowerCase().replace(/^(fcl_all_|fcl_mth_|fcl_eye_|blendshape\\d*\\.)/, "") === alias);
      if (hit !== undefined) { idx[k] = m.morphTargetDictionary[hit]; break; }
    }
    if (Object.keys(idx).length) { morphs.push(m); morphIndex.set(m, idx); }
  });
  return { kind: "glb", root, bones, height, hipsScale: hipsY / 0.92, morphs, morphIndex, bone: (b) => (bones[b] ? bones[b].node : null) };
}
// The built-in mannequin: a stylized wooden-doll body of capsules on a normalized rig (T-pose, facing +z), with a face.
function buildMannequin(o) {
  const body = (o.character && o.character.body) || {};
  const h = typeof body.height === "number" && body.height > 0 ? body.height : 1.7, s = h / 1.7;
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.02 });
  const skin = mat(body.skin || "#e8c4a0"), cloth = mat(body.cloth || "#4a7bd0"), pants = mat(body.pants || "#2f3542"), hair = mat(body.hair || "#3b2a20"), shoes = mat(body.shoes || "#1e1e24"), dark = new THREE.MeshBasicMaterial({ color: 0x1a1414 });
  const root = new THREE.Group(); root.rotation.order = "XYZ";
  const bones = {};
  const bone = (name, parent, x, y, z) => { const b = new THREE.Group(); b.name = name; b.position.set(x * s, y * s, z * s); (parent ? bones[parent] : root).add(b); bones[name] = b; return b; };
  // A capsule from a bone towards its child (along dir), radius r.
  const limb = (b, len, r, dir, m) => {
    const g = new THREE.CapsuleGeometry(r * s, Math.max(0.001, len * s - 2 * r * s), 6, 14);
    const mesh = new THREE.Mesh(g, m);
    if (dir === "x") { mesh.rotation.z = Math.PI / 2; mesh.position.x = (len * s) / 2; }
    else if (dir === "-x") { mesh.rotation.z = Math.PI / 2; mesh.position.x = -(len * s) / 2; }
    else if (dir === "-y") mesh.position.y = -(len * s) / 2;
    else mesh.position.y = (len * s) / 2;
    b.add(mesh); return mesh;
  };
  bone("hips", null, 0, 0.92, 0);
  bone("spine", "hips", 0, 0.1, 0); bone("chest", "spine", 0, 0.16, 0); bone("neck", "chest", 0, 0.2, 0); bone("head", "neck", 0, 0.09, 0);
  for (const [side, sx] of [["left", 1], ["right", -1]]) {
    bone(side + "UpperArm", "chest", 0.17 * sx, 0.14, 0); bone(side + "LowerArm", side + "UpperArm", 0.27 * sx, 0, 0); bone(side + "Hand", side + "LowerArm", 0.25 * sx, 0, 0);
    bone(side + "UpperLeg", "hips", 0.095 * sx, -0.06, 0); bone(side + "LowerLeg", side + "UpperLeg", 0, -0.41, 0); bone(side + "Foot", side + "LowerLeg", 0, -0.41, 0);
    const d = sx > 0 ? "x" : "-x";
    limb(bones[side + "UpperArm"], 0.27, 0.05, d, cloth); limb(bones[side + "LowerArm"], 0.25, 0.042, d, skin);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 12, 10), skin); hand.position.x = 0.04 * sx * s; hand.scale.set(1.2, 0.8, 1); bones[side + "Hand"].add(hand);
    limb(bones[side + "UpperLeg"], 0.41, 0.07, "-y", pants); limb(bones[side + "LowerLeg"], 0.41, 0.055, "-y", pants);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.07 * s, 0.24 * s), shoes); foot.position.set(0, -0.035 * s, 0.05 * s); bones[side + "Foot"].add(foot);
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.058 * s, 12, 10), cloth); bones[side + "UpperArm"].add(joint);
  }
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.13 * s, 0.06 * s, 6, 14), pants); pelvis.rotation.z = Math.PI / 2; pelvis.scale.set(1, 1, 0.75); bones.hips.add(pelvis);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15 * s, 0.22 * s, 6, 16), cloth); torso.position.y = 0.12 * s; torso.scale.set(1.05, 1, 0.68); bones.spine.add(torso);
  limb(bones.neck, 0.1, 0.045, "y", skin);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115 * s, 28, 20), skin); head.position.y = 0.1 * s; head.scale.set(0.92, 1.05, 0.98); bones.head.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.122 * s, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hair); cap.position.set(0, 0.11 * s, -0.012 * s); cap.rotation.x = -0.62; cap.scale.set(0.96, 1.05, 1.04); bones.head.add(cap);
  // The face (+z): eyes, brows, a mouth (open) and a smile line.
  const eyes = [-1, 1].map((sx) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.016 * s, 10, 8), dark); e.position.set(0.04 * sx * s, 0.115 * s, 0.103 * s); e.scale.z = 0.5; bones.head.add(e); return e; });
  const brows = [-1, 1].map((sx) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.035 * s, 0.006 * s, 0.006 * s), dark); b.position.set(0.042 * sx * s, 0.145 * s, 0.1 * s); bones.head.add(b); return b; });
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.022 * s, 14, 10), dark); mouth.position.set(0, 0.058 * s, 0.104 * s); mouth.scale.z = 0.3; bones.head.add(mouth);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.024 * s, 0.0045 * s, 6, 16, Math.PI), dark); smile.position.set(0, 0.066 * s, 0.106 * s); bones.head.add(smile);
  for (const b of Object.values(bones)) b.userData.bone = true;
  const mats = [];
  const spec = matSpec(o);
  styleTree(root, spec, null);
  root.traverse((m) => { if (m.isMesh) for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.push({ m: x, opacity: x.opacity, transparent: x.transparent }); });
  if (shadows) root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const char = { kind: "mannequin", height: h, bone: (b) => bones[b] || null, hipsRest: bones.hips.position.clone(), hipsScale: s, face: { eyes, brows, mouth, smile } };
  return { node: root, tint: false, mats, char };
}
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
// Scene Phase 2 (#351): characters — the built-in clips, the humanoid rig and each model's bone map (from the editor).
const CHAR = JSON.parse((document.getElementById("dionysus-character") || {}).textContent || "{}");
let vrmUtils = null;
for (const o of objects) {
  if (o.character && !(typeof o.model === "string" && o.model)) {
    // The built-in mannequin (a character with no model).
    const mq = buildMannequin(o);
    scene.add(mq.node);
    nodes.set(o.id, mq);
    continue;
  }
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
  // Scene Phase 2 (#351): VRM characters load through the vendored three-vrm plugin (only pages with one list it).
  if (list.some((o) => o.character && /\\.vrm$/i.test(o.model))) {
    try { const VRMSPEC = "three/addons/dionysus-vrm.js"; const m = await import(VRMSPEC); loader.register((p) => new m.VRMLoaderPlugin(p)); vrmUtils = m.VRMUtils; }
    catch (err) { console.error(err); }
  }
  for (const o of list) {
    const url = ctx.asset(o.model);
    if (!url) continue;
    let gltf;
    try { gltf = await loader.loadAsync(url); } catch (e) { console.error(e); continue; }
    const vrm = gltf.userData && gltf.userData.vrm;
    if (vrm && vrmUtils) vrmUtils.rotateVRM0(vrm); // VRM 0.x faces -z; turn it to +z like VRM 1.0 and the mannequin
    const root = vrm ? vrm.scene : gltf.scene || (gltf.scenes && gltf.scenes[0]);
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
    const entry = { node: group, tint: false, mats, mixer: new THREE.AnimationMixer(root), clips, parts };
    if (o.character) { entry.char = setupModelRig(o, root, vrm); entry.mixer = null; }
    nodes.set(o.id, entry);
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
  if (n.char && o.character) poseCharacter(n, o.character);
}
${SCENE_CHARACTER_JS}
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
  init: async (ctx) => { await loadModels(ctx); await loadScripts(ctx); await loadAnimations(ctx); await loadLook(ctx); await initPost(); },
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
    applyHolds(s.objects);
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
${characterDataTag(doc)}<script type="module">
${SCENE_RUNTIME_JS}</script></body></html>
`;
  const { models, scripts, look, environment, animations, vrm } = sceneFileUse(rest);
  if (!models && !scripts && !look && !environment && !animations) return page;
  const used = files && typeof files === "object" ? Object.fromEntries(Object.entries(files).filter(([, d]) => typeof d === "string")) : {};
  return writeManifest(page, { libs: ["three", ...(models || animations ? ["three-gltf"] : []), ...(vrm ? ["three-vrm"] : []), ...(look ? ["three-look"] : [])], files: models || scripts || environment || animations ? used : {} });
}

/**
 * Whether a scene has model objects (GLTFLoader and the files) or Script objects (P82: the files); Scene Phase 1
 * (#350): `look` = it needs the vendored look addons (post-processing, sky, or an .hdr environment), `environment` =
 * it has an environment map file.
 */
export function sceneFileUse(doc: Pick<SceneDoc, "objects"> & { world?: SceneDoc["world"]; animations?: SceneDoc["animations"] }): { models: boolean; scripts: boolean; look: boolean; environment: boolean; animations: boolean; vrm: boolean } {
  const list = Array.isArray(doc.objects) ? doc.objects : [];
  const w = doc.world && typeof doc.world === "object" ? doc.world : {};
  const env = w.environment && typeof w.environment === "object" && typeof w.environment.file === "string" ? w.environment.file : "";
  const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  return {
    models: list.some((o) => o && typeof o.model === "string" && o.model),
    scripts: list.some((o) => o && o.script && typeof o.script === "object" && typeof o.script.file === "string"),
    look: isObj(w.post) || isObj(w.sky) || /\.hdr$/i.test(env),
    environment: !!env,
    // Scene Phase 2 (#351): library clips (GLTFLoader and their files) and VRM characters (three-vrm).
    animations: isObj(doc.animations) && Object.keys(doc.animations as object).length > 0,
    vrm: list.some((o) => o && isObj(o.character) && typeof o.model === "string" && /\.vrm$/i.test(o.model)),
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
  const objects = (Array.isArray(doc.objects) ? doc.objects : []).map((o) => (o && typeof o === "object" ? [o.id, o.shape, o.size, o.model, o.script ?? null, o.character ? [o.character.rig ?? null, o.character.body ?? null] : null] : null));
  const files = doc.files && typeof doc.files === "object" ? Object.entries(doc.files).map(([n, d]) => [n, typeof d === "string" ? `${d.length}:${hashText(d)}` : null]) : [];
  // Scene Phase 1 (#350): which look parts the page builds (materials, post passes, fog type, sky, environment).
  const look = lookStructure(doc.world, doc.objects);
  const anims = doc.animations && typeof doc.animations === "object" ? doc.animations : null;
  const key = JSON.stringify([lights ?? null, objects, files, look, anims]);
  pageKeys.set(doc, key);
  return key;
}
/**
 * Scene Phase 2 (#351): the character data the page reads: the built-in clips, the humanoid bones (in hierarchy order),
 * the upper-body bones, and each GLB character's and library clip's bone map (its `rig`, else auto-detected from the
 * file's node names). Only scenes with characters or library clips get it.
 */
export function characterDataTag(doc: SceneDoc | undefined): string {
  const objects = doc && Array.isArray(doc.objects) ? doc.objects : [];
  const lib = doc && doc.animations && typeof doc.animations === "object" ? doc.animations : {};
  if (!objects.some((o) => o && o.character && typeof o.character === "object") && !Object.keys(lib).length) return "";
  const files = doc && doc.files && typeof doc.files === "object" ? doc.files : {};
  const rigOf = (rig: unknown, file: string | undefined) => {
    if (rig && typeof rig === "object") return rig;
    const url = file ? files[file] : undefined;
    const names = typeof url === "string" ? glbInfoOfDataUrl(url)?.nodeNames : undefined;
    return names ? autoRig(names).rig : {};
  };
  const rigs = Object.fromEntries(objects.filter((o) => o && o.character && typeof o.model === "string" && /\.glb$/i.test(o.model)).map((o) => [o.id, rigOf(o.character!.rig, o.model)]));
  const libraryRigs = Object.fromEntries(Object.entries(lib).filter(([, a]) => a && typeof a.file === "string").map(([n, a]) => [n, rigOf(a.rig, a.file)]));
  const data = { clips: BUILTIN_CLIPS, bones: HUMAN_BONES, upper: UPPER_BONES, rigs, libraryRigs };
  return `<script type="application/json" id="dionysus-character">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>\n`;
}
/** FNV-1a over the text (32-bit, hex). */
function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

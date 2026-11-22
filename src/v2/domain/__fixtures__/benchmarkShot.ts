/**
 * The Stylized-AAA benchmark shot (epic #349), re-rendered at the end of every scene phase so progress is comparable:
 *   A stylized village street at dusk. A character walks from left to right past a lantern-lit house, stops, turns to
 *   camera and waves. The camera starts wide, orbits slowly, then cuts to a medium close-up with a focus pull.
 *   Fireflies appear as the light fades.
 * Phase 1 (#350) version: primitives and Script-object stand-ins with the Phase 1 look (toon + outlines, rim light,
 * bloom on the lantern / windows / sky, warm-to-dusk light change via light and sky events, fog depth, a DOF focus
 * pull). Later phases swap in real characters and library assets. The same document is published as
 * public/samples/scenes/benchmark-shot.scene.json (kept in sync by sceneLook.test.ts).
 */
import type { SceneDoc } from "../scene";
import { scriptDataUrl } from "../sceneScriptCode";

/** The stand-in character: body, head with eyes, arms on shoulder pivots, legs; walk cycle and wave from t alone. */
const HERO = `// Stand-in character: a walk cycle while walking and a wave, both from scene time t alone.
export function build(THREE, params) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const skin = mat(params.skin), cloth = mat(params.cloth), dark = mat("#22202a");
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 6, 16), cloth); body.position.y = 1.0; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), skin); head.position.y = 1.55; g.add(head);
  for (const x of [-0.07, 0.07]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), dark); e.position.set(x, 1.58, 0.18); g.add(e); }
  const limb = (len, r, m) => { const p = new THREE.Group(); const l = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m); l.position.y = -len / 2 - r; p.add(l); return p; };
  const armL = limb(0.45, 0.07, cloth), armR = limb(0.45, 0.07, cloth);
  armL.position.set(-0.32, 1.32, 0); armR.position.set(0.32, 1.32, 0); g.add(armL, armR);
  const legL = limb(0.42, 0.085, dark), legR = limb(0.42, 0.085, dark);
  legL.position.set(-0.12, 0.62, 0); legR.position.set(0.12, 0.62, 0); g.add(legL, legR);
  g.userData.parts = { body, head, armL, armR, legL, legR };
  return g;
}

export function update(g, t, params) {
  const p = g.userData.parts;
  const walking = t >= params.walkFrom && t <= params.walkTo;
  const s = walking ? Math.sin((t - params.walkFrom) * params.stride) : 0;
  p.legL.rotation.x = s * 0.6; p.legR.rotation.x = -s * 0.6;
  p.armL.rotation.x = -s * 0.5; p.armR.rotation.x = s * 0.5;
  p.body.position.y = 1.0 + (walking ? Math.abs(s) * 0.04 : 0);
  p.armR.rotation.z = 0;
  // Wave: raise the right arm over 0.4 s, wave it, lower it over 0.4 s.
  const w0 = params.waveFrom, w1 = params.waveTo;
  if (t > w0 && t < w1) {
    const up = Math.min(1, (t - w0) / 0.4, (w1 - t) / 0.4);
    p.armR.rotation.x = 0;
    p.armR.rotation.z = up * (2.5 + Math.sin((t - w0) * 9) * 0.35);
  }
  p.head.rotation.y = 0;
}
`;

/** Fireflies: seeded points drifting around the house, fading in as the light fades. */
const FIREFLIES = `// Fireflies: points that drift and blink from scene time t alone, fading in from fadeFrom.
export function build(THREE, params, ctx) {
  const n = Math.max(1, Math.min(500, Math.round(params.count)));
  const rnd = ctx.random(7);
  const seeds = new Float32Array(n * 5);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const color = new THREE.Color(params.color).multiplyScalar(params.glow);
  const material = new THREE.PointsMaterial({ color, size: params.size, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.userData.seeds = seeds;
  return points;
}

export function update(points, t, params) {
  const s = points.userData.seeds, pos = points.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = i * 5, a = t * (0.3 + s[k + 3] * 0.4) + s[k + 4] * 6.283;
    pos.setXYZ(i, (s[k] - 0.5) * params.width + Math.sin(a) * 0.4, 0.4 + s[k + 1] * params.height + Math.sin(a * 1.7) * 0.25, (s[k + 2] - 0.5) * params.depth + Math.cos(a) * 0.4);
  }
  pos.needsUpdate = true;
  points.material.opacity = Math.max(0, Math.min(1, (t - params.fadeFrom) / params.fadeFor));
}
`;

const toonOutline = { type: "toon" as const, steps: 3, outline: { width: 0.03 } };

export const BENCHMARK_SHOT: SceneDoc = {
  format: "dionysus.scene/1",
  name: "Benchmark shot: village street at dusk",
  durationSec: 15,
  world: {
    background: "#6f6a86",
    camera: { fov: 40, position: [-1, 3.2, 12], lookAt: [0, 1.2, 0] },
    lights: [
      { id: "skyfill", type: "hemisphere", color: "#a8b8ff", groundColor: "#3a2a30", intensity: 0.9 },
      { id: "sun", type: "directional", color: "#ffc890", intensity: 2.4, position: [-8, 6, 6], lookAt: [0, 0, 0], shadow: { mapSize: 2048, area: 12, radius: 3 } },
      { id: "lantern", type: "point", color: "#ffb060", intensity: 0, position: [2.8, 2.0, -1.2] },
    ],
    sky: { elevation: 10, azimuth: 250, turbidity: 6, rayleigh: 2.5, light: "sun" },
    fog: { type: "linear", color: "#7a6c8c", near: 22, far: 75 },
    post: {
      toneMapping: "aces", exposure: 0.55, contrast: 1.1, saturation: 1.1, lift: [0.02, 0, 0.04], gain: [1.04, 1, 0.96],
      vignette: 0.28, grain: 0.05, bloom: { strength: 0.35, radius: 0.35, threshold: 1.1 },
      dof: { focus: 11, aperture: 0.002, maxblur: 0.008 }, ssao: { radius: 0.35 }, aa: "smaa",
    },
    export: { supersample: 2 },
  },
  objects: [
    { id: "ground", shape: "plane", size: [60, 60], color: "#5f7a4a", rotation: [-90, 0, 0], material: { type: "toon", steps: 3 } },
    { id: "street", shape: "box", size: [60, 0.04, 3], color: "#8b7d6b", position: [0, 0.02, 0.6], material: { type: "toon", steps: 3 } },
    { id: "house", shape: "box", size: [3, 2.4, 2.5], color: "#e8d8b8", position: [1, 1.2, -3], material: toonOutline },
    { id: "roof", shape: "cone", size: [2.3, 1.4], color: "#b4553f", position: [1, 3.1, -3], rotation: [0, 45, 0], material: toonOutline },
    { id: "door", shape: "box", size: [0.7, 1.3, 0.06], color: "#6b4a32", position: [1.5, 0.65, -1.72], material: toonOutline },
    { id: "glass", shape: "box", size: [0.7, 0.6, 0.06], color: "#ffd890", position: [0.2, 1.5, -1.72], material: { ...toonOutline, emissive: "#ffb050", emissiveIntensity: 1.4 } },
    { id: "house2", shape: "box", size: [2.6, 2.2, 2.2], color: "#c9d6e0", position: [-4.5, 1.1, -3.5], material: toonOutline },
    { id: "roof2", shape: "cone", size: [2, 1.2], color: "#50607a", position: [-4.5, 2.8, -3.5], rotation: [0, 45, 0], material: toonOutline },
    { id: "glass2", shape: "box", size: [0.6, 0.6, 0.06], color: "#ffd890", position: [-4.1, 1.3, -2.37], material: { ...toonOutline, emissive: "#ffa040", emissiveIntensity: 1.2 } },
    { id: "lampPost", shape: "cylinder", size: [0.05, 2.1], color: "#2c2a30", position: [2.8, 1.05, -1.5], material: toonOutline },
    { id: "lamp", shape: "sphere", size: 0.16, color: "#ffe0a0", position: [2.8, 2.15, -1.5], material: { type: "toon", emissive: "#ffb060", emissiveIntensity: 0.3, outline: { width: 0.02 } } },
    { id: "trunk", shape: "cylinder", size: [0.15, 1.2], color: "#6b4a32", position: [5, 0.6, -2.5], material: toonOutline },
    { id: "crown", shape: "cone", size: [1, 2.4], color: "#3f6b3a", position: [5, 2.4, -2.5], material: toonOutline },
    { id: "trunk2", shape: "cylinder", size: [0.15, 1.2], color: "#6b4a32", position: [-7.5, 0.6, -1.8], material: toonOutline },
    { id: "crown2", shape: "cone", size: [1.2, 2.8], color: "#46733c", position: [-7.5, 2.6, -1.8], material: toonOutline },
    {
      id: "hero", name: "Character (stand-in)", shape: "cylinder", size: [0.25, 1.6], position: [-5, 0, 0.6], rotation: [0, 90, 0],
      script: { file: "hero.js", params: { skin: "#f2c9a0", cloth: "#3d6fb6", walkFrom: 0.5, walkTo: 6.5, stride: 7, waveFrom: 8, waveTo: 10.6 } },
      material: { type: "toon", steps: 3, outline: { width: 0.012 }, rim: { color: "#ffd0a0", strength: 0.25, power: 4 } },
    },
    {
      id: "fireflies", position: [0.5, 0, -0.5],
      script: { file: "fireflies.js", params: { count: 60, color: "#ffe88a", glow: 3, size: 0.07, width: 12, height: 2.4, depth: 6, fadeFrom: 9, fadeFor: 2.5 } },
    },
  ],
  events: [
    // The character walks left to right past the house, stops, turns to camera and waves (the wave is in its script).
    { at: 0.5, obj: "hero", call: "moveTo", args: { position: [1.6, 0, 0.6] }, dur: 6, ease: "linear" },
    { at: 7, obj: "hero", call: "rotation", args: { value: [0, 24, 0] }, dur: 0.8, ease: "inOutSine" },
    // Warm to dusk: the sun sets (it places the "sun" light), its light reddens and fades; fog and sky darken.
    { at: 2, obj: "sky", call: "sunElevation", args: { value: -1.5 }, dur: 12, ease: "inOutSine" },
    { at: 2, obj: "sky", call: "rayleigh", args: { value: 3.2 }, dur: 12, ease: "linear" },
    { at: 4, obj: "sun", call: "color", args: { value: "#ff7a4a" }, dur: 9, ease: "inOutSine" },
    { at: 4, obj: "sun", call: "intensity", args: { value: 0.5 }, dur: 10, ease: "inOutSine" },
    { at: 5, obj: "skyfill", call: "intensity", args: { value: 0.35 }, dur: 9, ease: "inOutSine" },
    { at: 5, obj: "skyfill", call: "color", args: { value: "#6a70c8" }, dur: 9, ease: "linear" },
    { at: 4, obj: "fog", call: "color", args: { value: "#3a3550" }, dur: 10, ease: "linear" },
    { at: 4, obj: "fog", call: "far", args: { value: 50 }, dur: 10, ease: "linear" },
    // The lantern comes on as the light fades.
    { at: 5, obj: "lantern", call: "intensity", args: { value: 0.9 }, dur: 3, ease: "outCubic" },
    { at: 5, obj: "post", call: "exposure", args: { value: 0.75 }, dur: 9, ease: "linear" },
    // Camera: wide, a slow orbit, then a cut to a medium close-up with a focus pull from the lantern to the character.
    { at: 0.5, obj: "camera", call: "moveTo", args: { position: [3, 3, 11] }, dur: 4.5, ease: "inOutSine" },
    { at: 5, obj: "camera", call: "moveTo", args: { position: [6, 2.6, 8.5] }, dur: 4.9, ease: "inOutSine" },
    { at: 10, obj: "camera", call: "moveTo", args: { position: [3.4, 1.65, 3.6] } },
    { at: 10, obj: "camera", call: "lookAt", args: { target: [1.6, 1.45, 0.4] } },
    { at: 10, obj: "camera", call: "fov", args: { value: 34 } },
    { at: 10, obj: "post", call: "dofFocus", args: { value: 6.2 } },
    { at: 10, obj: "post", call: "dofAperture", args: { value: 0.012 } },
    { at: 10.6, obj: "post", call: "dofFocus", args: { value: 3.3 }, dur: 1.4, ease: "inOutCubic" },
  ],
  files: { "hero.js": scriptDataUrl(HERO), "fireflies.js": scriptDataUrl(FIREFLIES) },
};

/**
 * The Stylized-AAA benchmark shot (epic #349), re-rendered at the end of every scene phase so progress is comparable:
 *   A stylized village street at dusk. A character walks from left to right past a lantern-lit house, stops, turns to
 *   camera and waves. The camera starts wide, orbits slowly, then cuts to a medium close-up with a focus pull.
 *   Fireflies appear as the light fades.
 * Phase 1 (#350) added the look (toon + outlines, rim light, bloom on the lantern / windows / sky, warm-to-dusk light
 * via light and sky events, fog depth, a DOF focus pull). Phase 2 (#351) swaps the stand-in for a character (the
 * built-in mannequin): it walks along the street (speed-matched, no foot sliding), stops, looks at the camera, smiles,
 * waves and says a line (lip sync), while a second character sits on a bench. Phase 3 (#352) cuts it into four camera
 * angles inside the one scene: a wide establishing shot, a handheld follow, an orbit, and a close-up with a focus pull. The same document is published as
 * public/samples/scenes/benchmark-shot.scene.json (kept in sync by sceneLook.test.ts).
 */
import type { SceneDoc } from "../scene";
import { scriptDataUrl } from "../sceneScriptCode";

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
    cameras: [
      { id: "follow", name: "Handheld follow", position: [-6.2, 1.5, 3.5], lookAt: [-5, 1, 0.6], lens: { focalLength: 28, focus: "hero", fStop: 8 } },
      { id: "orbit", name: "Orbit", position: [1.6, 1.6, 4], lookAt: [1.6, 1, 0.6], lens: { focalLength: 35, focus: "hero", fStop: 4 } },
      { id: "close", name: "Close-up", position: [2.2, 1.5, 2], lookAt: [1.6, 1.5, 0.6], lens: { focalLength: 50, focus: "lamp", fStop: 1.8 } },
    ],
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
      id: "hero", name: "Hero", position: [-5, 0, 0.6], rotation: [0, 90, 0],
      character: { body: { height: 1.7, skin: "#f2c9a0", cloth: "#3d6fb6", pants: "#2c3140", hair: "#4a2e1e" } },
      material: { type: "toon", steps: 3, outline: { width: 0.008 }, rim: { color: "#ffd0a0", strength: 0.25, power: 4 } },
    },
    { id: "bench", name: "Bench", shape: "box", size: [1.4, 0.45, 0.45], color: "#7a5236", position: [-2.4, 0.225, -1.5], material: toonOutline },
    {
      id: "elder", name: "Elder", position: [-2.4, 0, -1.2], rotation: [0, 0, 0],
      character: { body: { height: 1.6, skin: "#e3b896", cloth: "#7d4e8c", pants: "#3a3340", hair: "#d8d8d8" }, idle: "idle" },
      material: { type: "toon", steps: 3, outline: { width: 0.008 } },
    },
    {
      id: "fireflies", position: [0.5, 0, -0.5],
      script: { file: "fireflies.js", params: { count: 60, color: "#ffe88a", glow: 3, size: 0.07, width: 12, height: 2.4, depth: 6, fadeFrom: 9, fadeFor: 2.5 } },
    },
  ],
  events: [
    // The character walks left to right past the house, stops, turns to camera and waves (the wave is in its script).
    { at: 0, obj: "elder", call: "sit", args: { seat: "bench", facing: 0 } },
    { at: 0.5, obj: "hero", call: "walkTo", args: { path: [[-1, 0, 0.7], [1.6, 0, 0.6]], speed: 1.25 } },
    { at: 3, obj: "elder", call: "lookAt", args: { target: "hero" }, dur: 0.8 },
    { at: 6.6, obj: "hero", call: "turnTo", args: { target: 28 }, dur: 0.7 },
    { at: 7, obj: "hero", call: "lookAt", args: { target: "camera" }, dur: 0.6 },
    { at: 7.4, obj: "hero", call: "expression", args: { value: { happy: 1 } }, dur: 0.5 },
    { at: 8, obj: "hero", call: "gesture", args: { clip: "wave" } },
    { at: 8.2, obj: "hero", call: "speak", args: { text: "Good evening!" }, dur: 1.1 },
    { at: 9, obj: "elder", call: "gesture", args: { clip: "nod" } },
    { at: 10.5, obj: "hero", call: "gesture", args: { clip: "talk" }, dur: 3 },
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
    // Cameras (Phase 3): a wide establishing shot, a handheld follow, an orbit, a close-up with a focus pull (the shots cut).
    { at: 0.3, obj: "camera", call: "moveTo", args: { position: [1, 3, 11] }, dur: 3.5, ease: "inOutSine" },
    { at: 3.5, obj: "follow", call: "follow", args: { target: "hero", offset: [-1.1, 1.45, 2.9], damping: 0.5 } },
    { at: 3.5, obj: "follow", call: "handheld", args: { amplitude: 0.035, frequency: 1.1 } },
    { at: 6.5, obj: "orbit", call: "orbit", args: { target: "hero", from: 75, to: 15, radius: 3.4, height: 0.5 }, dur: 3.5, ease: "inOutSine" },
    { at: 10, obj: "close", call: "frame", args: { subject: "hero", shot: "closeup", angle: "front", height: "eye" } },
    { at: 10.6, obj: "close", call: "rackFocus", args: { to: "hero" }, dur: 1.4, ease: "inOutCubic" },
  ],
  shots: [{ at: 0, camera: "camera", name: "Wide" }, { at: 3.5, camera: "follow", name: "Follow" }, { at: 6.5, camera: "orbit", name: "Orbit" }, { at: 10, camera: "close", name: "Close-up" }],
  files: { "fireflies.js": scriptDataUrl(FIREFLIES) },
};

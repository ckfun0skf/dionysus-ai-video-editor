import type { SceneDoc } from "../domain/scene";

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
const meshes = new Map();
for (const o of Array.isArray(doc.objects) ? doc.objects : []) {
  if (!o || typeof o.id !== "string") continue;
  const m = new THREE.Mesh(geometry(o), new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.55, metalness: 0.1, side: o.shape === "plane" ? THREE.DoubleSide : THREE.FrontSide }));
  m.rotation.order = "XYZ";
  scene.add(m); meshes.set(o.id, m);
}
const D = Math.PI / 180;
dionysus.clip({
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
      const m = meshes.get(o.id); if (!m) continue;
      m.position.set(o.position[0], o.position[1], o.position[2]);
      m.rotation.set(o.rotation[0] * D, o.rotation[1] * D, o.rotation[2] * D);
      m.scale.set(o.scale[0], o.scale[1], o.scale[2]);
      m.visible = o.visible && o.opacity > 0;
      m.material.color.set(o.color);
      // Switching transparent changes the shader (OPAQUE define): recompile so a frame never depends on the previous one.
      const tr = o.opacity < 1;
      if (m.material.transparent !== tr) { m.material.transparent = tr; m.material.depthWrite = !tr; m.material.needsUpdate = true; }
      m.material.opacity = o.opacity;
    }
    renderer.render(scene, camera);
  },
});
`;

/** The runtime page for one scene document (the HTML clip host adds the CSP, import map and time shim). */
export function scenePage(doc: SceneDoc | undefined): string {
  const json = JSON.stringify(doc ?? { format: "dionysus.scene/1", objects: [] }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100%;height:100%}</style></head>
<body><canvas id="c"></canvas>
<script type="application/json" id="dionysus-scene">${json}</script>
<script type="module">
${SCENE_RUNTIME_JS}</script></body></html>
`;
}

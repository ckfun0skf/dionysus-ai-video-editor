/**
 * P82: Script objects in the scene editor and for agents: the starting-point templates (particles, a procedural shape,
 * text, an empty script) and pure edits (add a script object, change its code or params). The code format and its
 * static checks are in domain/sceneScriptCode.ts. Every function returns a new scene.
 */
import type { SceneDoc, SceneObject, Vec3 } from "./scene";
import { freeObjectId } from "./sceneEdit";
import { scriptCodeOf, scriptDataUrl, type SceneScriptParams } from "./sceneScriptCode";

export interface SceneScriptTemplate { id: string; label: string; description: string; code: string; params: SceneScriptParams; position: Vec3 }

const PARTICLES = `// Particles: a swirl of points rising through a cylinder, set from time alone.
export function build(THREE, params, ctx) {
  const n = Math.max(1, Math.min(20000, Math.round(params.count)));
  const rnd = ctx.random(); // seeded: the same numbers every time
  const seeds = new Float32Array(n * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const material = new THREE.PointsMaterial({ color: params.color, size: params.size, transparent: true, depthWrite: false });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.userData.seeds = seeds;
  return points;
}

// Called every frame with scene time t: positions come from the seeds and t only.
export function update(points, t, params) {
  const s = points.userData.seeds, pos = points.geometry.attributes.position, h = params.height;
  for (let i = 0; i < pos.count; i++) {
    const a = s[i * 4] * Math.PI * 2 + t * params.swirl * (0.5 + s[i * 4 + 1]);
    const r = params.radius * Math.sqrt(s[i * 4 + 2]);
    const y = (((s[i * 4 + 3] * h + t * params.rise) % h) + h) % h;
    pos.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r);
  }
  pos.needsUpdate = true;
}
`;

const SHAPE = `// A procedural shape: a sphere whose surface wobbles over time.
export function build(THREE, params) {
  const geometry = new THREE.IcosahedronGeometry(params.radius, Math.round(params.detail));
  geometry.userData.base = geometry.attributes.position.array.slice();
  const material = new THREE.MeshStandardMaterial({ color: params.color, roughness: 0.35, metalness: 0.1, flatShading: params.faceted });
  return new THREE.Mesh(geometry, material);
}

export function update(mesh, t, params) {
  const base = mesh.geometry.userData.base, pos = mesh.geometry.attributes.position, w = t * params.speed;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
    const k = 1 + params.wobble * Math.sin(x * 3 + w) * Math.sin(y * 3 + w * 1.3) * Math.sin(z * 3 + w * 0.7);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}
`;

const TEXT = `// Text on a plane (drawn on a canvas), typed on at typeSpeed characters a second (0 = all at once).
export function build(THREE, params, ctx) {
  const canvas = ctx.makeCanvas(1024, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(params.width, params.width / 4), material);
  mesh.userData.canvas = canvas;
  return mesh;
}

export function update(mesh, t, params) {
  const text = String(params.text);
  const n = params.typeSpeed > 0 ? Math.min(text.length, Math.floor(t * params.typeSpeed)) : text.length;
  const shown = text.slice(0, n);
  if (mesh.userData.shown === shown) return; // drawing it again would give the same picture
  mesh.userData.shown = shown;
  const c = mesh.userData.canvas, g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  g.font = "bold " + params.size + "px system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = params.color;
  g.fillText(shown, c.width / 2, c.height / 2);
  mesh.material.map.needsUpdate = true;
}
`;

const EMPTY = `// build(THREE, params, ctx) runs once and returns a THREE.Object3D. ctx.random() gives seeded random numbers,
// ctx.makeCanvas(w, h) a canvas for textures. The object's position, rotation, scale, visibility and opacity come
// from the scene (its properties and events), so build it around (0, 0, 0).
export function build(THREE, params, ctx) {
  const geometry = new THREE.TorusKnotGeometry(0.4, 0.13, 160, 24);
  const material = new THREE.MeshStandardMaterial({ color: params.color, roughness: 0.4 });
  return new THREE.Mesh(geometry, material);
}

// Optional: called every frame with scene time t (seconds). Set the object from t alone (never from the frame
// before), so every frame looks the same in preview, export and any seek order.
export function update(obj, t, params) {
  obj.rotation.y = t * params.spin;
}
`;

export const SCENE_SCRIPT_TEMPLATES: readonly SceneScriptTemplate[] = [
  { id: "particles", label: "Particles", description: "A swirl of rising points (count, colour, size, radius, height, speed).", code: PARTICLES,
    params: { count: 600, color: "#ffd36b", size: 0.05, radius: 1.2, height: 2.5, rise: 0.4, swirl: 0.6 }, position: [0, 0, 0] },
  { id: "shape", label: "Procedural shape", description: "A sphere whose surface wobbles over time.", code: SHAPE,
    params: { radius: 0.7, detail: 8, color: "#7ad7f0", wobble: 0.18, speed: 1.5, faceted: false }, position: [0, 0.9, 0] },
  { id: "text", label: "Text", description: "Words on a plane, typed on over time.", code: TEXT,
    params: { text: "Hello", color: "#ffffff", size: 150, width: 3, typeSpeed: 0 }, position: [0, 1.6, 0] },
  { id: "empty", label: "Empty script", description: "A short commented script to write your own three.js code.", code: EMPTY,
    params: { color: "#5ad1c8", spin: 0.8 }, position: [0, 0.8, 0] },
];

/** A free file name in `files` from a stem ("sparkles.js", "sparkles-2.js", …). */
export function freeScriptFile(doc: SceneDoc, stem: string): string {
  const files = doc.files && typeof doc.files === "object" ? doc.files : {};
  const base = stem.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 80) || "script";
  let name = `${base}.js`;
  for (let n = 2; files[name] !== undefined; n++) name = `${base}-${n}.js`;
  return name;
}

/**
 * Add a Script object: from a template (by id) or from code and params. Its code goes into `files` under a free
 * name from the object's id. Returns the new scene and the object's id.
 */
export function addSceneScript(doc: SceneDoc, from: string | { code: string; params?: SceneScriptParams; stem?: string }): { doc: SceneDoc; id: string } {
  const tpl = typeof from === "string" ? SCENE_SCRIPT_TEMPLATES.find((t) => t.id === from) ?? SCENE_SCRIPT_TEMPLATES[0] : undefined;
  const code = tpl ? tpl.code : (from as { code: string }).code;
  const params = tpl ? { ...tpl.params } : (from as { params?: SceneScriptParams }).params;
  const stem = tpl ? tpl.id : (from as { stem?: string }).stem ?? "script";
  const id = freeObjectId(doc, stem);
  const file = freeScriptFile(doc, id);
  const objects = Array.isArray(doc.objects) ? doc.objects : [];
  // Spread across the floor like new shapes (domain/sceneEdit.ts addSceneObject), so new objects don't overlap.
  const x = [0, -1.5, 1.5, -3, 3][objects.length % 5];
  const at: Vec3 = tpl ? [tpl.position[0] + x, tpl.position[1], tpl.position[2]] : [x, 0.5, 0];
  const obj: SceneObject = { id, script: { file, ...(params && Object.keys(params).length ? { params } : {}) }, position: at };
  return { doc: { ...doc, files: { ...(doc.files && typeof doc.files === "object" ? doc.files : {}), [file]: scriptDataUrl(code) }, objects: [...objects, obj] }, id };
}

/** The code of a Script object's file (undefined when it has no script or the file is missing or unreadable). */
export function sceneScriptCode(doc: SceneDoc, id: string): string | undefined {
  const o = (Array.isArray(doc.objects) ? doc.objects : []).find((x) => x && x.id === id);
  const file = o?.script && typeof o.script.file === "string" ? o.script.file : undefined;
  return file && doc.files && typeof doc.files === "object" ? scriptCodeOf(doc.files[file]) : undefined;
}

/**
 * Set a Script object's code. Its file is rewritten (or, when the object has no file yet, one is added); other
 * objects that share the file get the new code too. An object without a script becomes a Script object.
 */
export function setSceneScriptCode(doc: SceneDoc, id: string, code: string): SceneDoc {
  const objects = Array.isArray(doc.objects) ? doc.objects : [];
  const o = objects.find((x) => x && x.id === id);
  if (!o) return doc;
  const files = doc.files && typeof doc.files === "object" ? doc.files : {};
  const file = o.script && typeof o.script.file === "string" && o.script.file ? o.script.file : freeScriptFile(doc, id);
  const data = scriptDataUrl(code);
  const sameObj = o.script?.file === file && !o.model;
  if (sameObj && files[file] === data) return doc;
  const next: SceneObject = sameObj ? o : (({ model: _m, animation: _a, nodes: _n, ...rest }) => (void _m, void _a, void _n, { ...rest, script: { file, ...(o.script?.params ? { params: o.script.params } : {}) } }))(o);
  return { ...doc, files: { ...files, [file]: data }, objects: objects.map((x) => (x === o ? next : x)) };
}

/** Replace a Script object's params (an empty object removes them). */
export function setSceneScriptParams(doc: SceneDoc, id: string, params: SceneScriptParams): SceneDoc {
  const objects = Array.isArray(doc.objects) ? doc.objects : [];
  const o = objects.find((x) => x && x.id === id);
  if (!o?.script) return doc;
  const { params: _old, ...rest } = o.script; void _old;
  const script = Object.keys(params).length ? { ...rest, params } : rest;
  if (JSON.stringify(script) === JSON.stringify(o.script)) return doc;
  return { ...doc, objects: objects.map((x) => (x === o ? { ...o, script } : x)) };
}

/** Turn a Script object back into a plain shape (its file goes when no other object uses it). */
export function removeSceneScript(doc: SceneDoc, id: string): SceneDoc {
  const objects = Array.isArray(doc.objects) ? doc.objects : [];
  const o = objects.find((x) => x && x.id === id);
  if (!o?.script) return doc;
  const { script, ...rest } = o;
  const keep = objects.map((x) => (x === o ? rest : x));
  let out: SceneDoc = { ...doc, objects: keep };
  out = dropUnusedFile(out, script.file);
  return out;
}

/** Remove `file` from `files` when no object uses it as its model or script. */
export function dropUnusedFile(doc: SceneDoc, file: unknown): SceneDoc {
  if (typeof file !== "string" || !doc.files || typeof doc.files !== "object" || !(file in doc.files)) return doc;
  const objects = Array.isArray(doc.objects) ? doc.objects : [];
  if (objects.some((x) => x && (x.model === file || x.script?.file === file))) return doc;
  const { [file]: _drop, ...files } = doc.files; void _drop;
  if (Object.keys(files).length) return { ...doc, files };
  const { files: _f, ...rest } = doc; void _f;
  return rest as SceneDoc;
}

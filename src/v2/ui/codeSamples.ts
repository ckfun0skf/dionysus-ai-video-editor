import { HTML_CLIP_FORMAT, type HtmlClipManifest } from "../domain";
import { generateClip, type CodeClipModel } from "./codeClip";

/**
 * Starting points for code clips (V2-ADD-MEDIA-TABS, V2-CODE-EDITOR): the new-clip template that Add Media → Code →
 * Create opens, and the Code Editor's "Load sample" list. Each is a JS-first model: a manifest (with params) and a
 * `dionysus.clip({ init, render })` module that draws on the page's canvas.
 */
export const NEW_CODE_SCRIPT = `// The canvas is ready: draw each frame from t (seconds) and ctx.params.
let g;
dionysus.clip({
  init(ctx) {
    ctx.canvas.width = ctx.width;
    ctx.canvas.height = ctx.height;
    g = ctx.canvas.getContext("2d");
  },
  render(t, ctx) {
    const { width: w, height: h, params: p } = ctx;
    g.clearRect(0, 0, w, h);
    const r = Math.min(w, h) * p.size;
    const x = w / 2 + Math.cos(t * p.speed) * w * 0.25;
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(x, h * 0.45, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = \`600 \${Math.round(h * 0.08)}px system-ui, sans-serif\`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(p.title, w / 2, h * 0.85);
  },
});
`;

export const NEW_CODE_MANIFEST: HtmlClipManifest = {
  format: HTML_CLIP_FORMAT, name: "Code clip", durationSec: 5, width: 1920, height: 1080, aspect: "16:9", background: "transparent", libs: [],
  params: {
    title: { type: "text", default: "Hello", label: "Title" },
    color: { type: "color", default: "#20d5ec", label: "Colour" },
    size: { type: "number", default: 0.18, min: 0.05, max: 0.5, step: 0.01, label: "Size" },
    speed: { type: "number", default: 2, min: 0, max: 8, step: 0.5, label: "Speed" },
  },
};

export const newCodeModel = (): CodeClipModel => ({ manifest: structuredClone(NEW_CODE_MANIFEST), script: NEW_CODE_SCRIPT, css: "", markup: "" });

/** A complete package: the manifest, the standard canvas page and the script. */
export const newCodeClipHtml = (): string => generateClip(newCodeModel());

const CANVAS_SCRIPT = `// Canvas animation: bars that rise in a wave, with a title. Every frame is a pure function of t and ctx.params.
let g;

// Seeded random (never Math.random) so the same t always gives the same picture.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

dionysus.clip({
  init(ctx) {
    ctx.canvas.width = ctx.width;
    ctx.canvas.height = ctx.height;
    g = ctx.canvas.getContext("2d");
  },
  render(t, ctx) {
    const { width: w, height: h, params: p, duration } = ctx;
    g.clearRect(0, 0, w, h);
    if (p.background) { g.fillStyle = "#101018"; g.fillRect(0, 0, w, h); }

    // Bars: each rises after a small seeded delay, then follows a wave.
    const n = Math.round(p.bars), rand = rng(7);
    const gap = w * 0.004, bw = (w * 0.8 - gap * (n - 1)) / n, x0 = w * 0.1;
    for (let i = 0; i < n; i++) {
      const grow = ease((t - rand() * 0.6) / 0.8);
      const wave = 0.5 + 0.5 * Math.sin(t * p.speed + i * 0.45);
      const bh = h * 0.45 * grow * (0.25 + 0.75 * wave);
      const hue = i / Math.max(1, n - 1);
      g.fillStyle = mix(p.from, p.to, hue);
      g.fillRect(x0 + i * (bw + gap), h * 0.7 - bh, bw, bh);
    }

    // Title: fades in, then out over the last half second.
    const a = Math.min(ease(t / 0.6), Math.max(0, (duration - t) / 0.5));
    g.globalAlpha = a;
    g.fillStyle = "#ffffff";
    g.font = \`700 \${Math.round(h * 0.09)}px system-ui, sans-serif\`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(p.title, w / 2, h * 0.84 + (1 - a) * h * 0.03);
    g.globalAlpha = 1;
  },
});

// Blend two #rrggbb colours.
function mix(a, b, k) {
  const c = (s, i) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  const v = [0, 1, 2].map((i) => Math.round(c(a, i) + (c(b, i) - c(a, i)) * k));
  return \`rgb(\${v.join(",")})\`;
}
`;

const CANVAS_MANIFEST: HtmlClipManifest = {
  format: HTML_CLIP_FORMAT, name: "Canvas animation", description: "Rising bars in a wave with a title; colours, bar count and speed are editable per use.",
  durationSec: 5, width: 1920, height: 1080, aspect: "16:9", background: "transparent", libs: [],
  params: {
    title: { type: "text", default: "Canvas animation", label: "Title" },
    from: { type: "color", default: "#20d5ec", label: "From colour" },
    to: { type: "color", default: "#ff4d8d", label: "To colour" },
    bars: { type: "number", default: 24, min: 4, max: 64, step: 1, label: "Bars" },
    speed: { type: "number", default: 3, min: 0, max: 10, step: 0.5, label: "Wave speed" },
    background: { type: "boolean", default: false, label: "Dark background" },
  },
};

const THREE_SCRIPT = `import * as THREE from "three";

let renderer, scene, camera, centre, orbitGroup;
let builtKey = ""; // which params the current meshes were built for

// Seeded random (never Math.random) so every frame is reproducible.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function geometry(shape, size) {
  switch (shape) {
    case "cube": return new THREE.BoxGeometry(size, size, size);
    case "sphere": return new THREE.SphereGeometry(size * 0.6, 48, 32);
    case "icosahedron": return new THREE.IcosahedronGeometry(size * 0.65, 0);
    default: return new THREE.TorusKnotGeometry(size * 0.45, size * 0.15, 160, 24);
  }
}

function disposeGroup(obj) {
  obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}

// Rebuild meshes only when a param that changes geometry or materials changes.
// Params can change between frames while the user edits, so check every frame.
function build(p) {
  const key = [p.shape, p.color, p.accent, p.count, p.wireframe].join("|");
  if (key === builtKey) return;
  builtKey = key;
  if (centre) { scene.remove(centre); disposeGroup(centre); }
  if (orbitGroup) { scene.remove(orbitGroup); disposeGroup(orbitGroup); }

  centre = new THREE.Mesh(
    geometry(p.shape, 1.6),
    new THREE.MeshStandardMaterial({ color: p.color, metalness: 0.3, roughness: 0.35, wireframe: p.wireframe })
  );
  scene.add(centre);

  orbitGroup = new THREE.Group();
  const rand = rng(42);
  const n = Math.round(p.count);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(
      geometry(p.shape, 0.35 + rand() * 0.25),
      new THREE.MeshStandardMaterial({ color: p.accent, metalness: 0.2, roughness: 0.5, wireframe: p.wireframe })
    );
    const a = (i / n) * Math.PI * 2;
    m.position.set(Math.cos(a) * 3.2, (rand() - 0.5) * 1.2, Math.sin(a) * 3.2);
    m.rotation.set(rand() * Math.PI, rand() * Math.PI, 0);
    orbitGroup.add(m);
  }
  scene.add(orbitGroup);
}

dionysus.clip({
  async init(ctx) {
    ctx.canvas.width = ctx.width; ctx.canvas.height = ctx.height;
    renderer = new THREE.WebGLRenderer({ canvas: ctx.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.setClearColor(0x000000, 0); // transparent background

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(40, ctx.width / ctx.height, 0.1, 100);
    camera.position.set(0, 2.2, 9);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(4, 6, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x8899ff, 0.8); rim.position.set(-5, 2, -4); scene.add(rim);
  },

  // Everything below depends only on t and ctx.params: no clocks, no accumulated state.
  render(t, ctx) {
    const p = ctx.params;
    if (renderer.domElement.width !== ctx.width || renderer.domElement.height !== ctx.height) {
      renderer.setSize(ctx.width, ctx.height, false);
      camera.aspect = ctx.width / ctx.height; camera.updateProjectionMatrix();
    }
    build(p);

    const spin = ctx.progress * p.turns * Math.PI * 2;
    centre.rotation.set(spin * 0.5, spin, 0);
    orbitGroup.rotation.y = -spin;
    orbitGroup.children.forEach((m, i) => { m.rotation.x = spin * 2 + i; });

    // Ease in over the first 0.6 s and out over the last 0.6 s.
    const fade = Math.min(1, t / 0.6, Math.max(0, (ctx.duration - t) / 0.6));
    const s = 0.6 + 0.4 * fade;
    centre.scale.setScalar(s); orbitGroup.scale.setScalar(s);

    renderer.render(scene, camera);
  },
});
`;

const THREE_MANIFEST: HtmlClipManifest = {
  "format": "dionysus.htmlclip/1",
  "name": "Three.js orbit",
  "description": "A ring of 3D shapes orbiting a centre piece; shape, colours, count and spin are editable per use.",
  "durationSec": 6,
  "width": 1920,
  "height": 1080,
  "aspect": "16:9",
  "background": "transparent",
  "libs": [
    "three"
  ],
  "params": {
    "shape": {
      "type": "select",
      "options": [
        "cube",
        "sphere",
        "torus-knot",
        "icosahedron"
      ],
      "default": "torus-knot",
      "label": "Shape"
    },
    "color": {
      "type": "color",
      "default": "#5ad1c8",
      "label": "Main colour"
    },
    "accent": {
      "type": "color",
      "default": "#ffb347",
      "label": "Orbit colour"
    },
    "count": {
      "type": "number",
      "default": 8,
      "min": 0,
      "max": 24,
      "step": 1,
      "label": "Orbiters"
    },
    "turns": {
      "type": "number",
      "default": 1,
      "min": 0,
      "max": 4,
      "step": 0.25,
      "label": "Turns per clip"
    },
    "wireframe": {
      "type": "boolean",
      "default": false,
      "label": "Wireframe"
    }
  }
};

export interface CodeSample { id: string; name: string; description: string; model: () => CodeClipModel }

/** The Code Editor's "Load sample" list. */
export const CODE_SAMPLES: readonly CodeSample[] = [
  { id: "canvas", name: "Canvas animation", description: "2D canvas: rising bars and a title, driven by params", model: () => ({ manifest: structuredClone(CANVAS_MANIFEST), script: CANVAS_SCRIPT, css: "", markup: "" }) },
  { id: "three", name: "Three.js", description: "3D scene with three.js: shapes orbiting a centre piece", model: () => ({ manifest: structuredClone(THREE_MANIFEST), script: THREE_SCRIPT, css: "", markup: "" }) },
];

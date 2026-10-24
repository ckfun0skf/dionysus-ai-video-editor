#!/usr/bin/env node
/**
 * Scaffold a preset module (V2-FX-MOD): `npm run new:preset -- <kind> <id>`.
 * Writes src/v2/presets/<kind>/<id>.ts from a per-kind template. The loader picks it up automatically; nothing else
 * needs to change. See docs/v2/ADDING_EFFECTS.md.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [kind, id] = process.argv.slice(2);
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const title = (s) => s.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

const P = `{ key: "strength", label: "Strength", type: "number", min: 0, max: 1, step: 0.05, default: 0.5, description: "TODO: what it does, 0 (none) to 1 (full)." }`;
const T = {
  videoEffect: ["defineVideoEffect", `  params: [\n    ${P},\n  ],\n  // Either reshape the frame (pure, fast)…\n  // frame: (f, p, k) => ({ ...f, vignette: n(k.strength, 0.5) }),\n  // …or paint on the finished picture (draw runs after the built-in look).\n  draw: ({ ctx, w, h, p, params, scratch }) => {\n    const k = n(params.strength, 0.5);\n    if (k <= 0) return;\n    void scratch; void p; // scratch(w, h, slot) gives an offscreen context for multi-pass looks\n    ctx.globalAlpha = k;\n    ctx.globalCompositeOperation = "soft-light";\n    ctx.fillStyle = "#ffffff";\n    ctx.fillRect(0, 0, w, h);\n  },`, `import { n } from "../_lib/math";`],
  transition: ["defineTransition", `  params: [\n    ${P},\n  ],\n  // p runs 0 → 1 across the cut. tOut / tIn describe the outgoing / incoming clip; mixOut / mixIn their opacity.\n  frame: (f, p, k) => ({ ...f, mixOut: 1 - p, mixIn: p, tOut: { scale: 1 + n(k.strength, 0.5) * p }, tIn: { scale: 1 + n(k.strength, 0.5) * (1 - p) } }),`, `import { n } from "../_lib/math";`],
  textAnimIn: ["defineTextAnimIn", `  params: [\n    { key: "distance", label: "Distance", type: "number", min: 0, max: 1, step: 0.05, default: 0.2, description: "Start offset as a fraction of the frame height." },\n  ],\n  // p runs 0 → 1 over the in duration (1 = fully shown).\n  frame: (f, p, k) => { const e = ease(p); return { ...f, alpha: f.alpha * e, dy: f.dy + (1 - e) * n(k.distance, 0.2) }; },`, `import { ease, n } from "../_lib/math";`],
  textAnimOut: ["defineTextAnimOut", `  params: [\n    { key: "distance", label: "Distance", type: "number", min: 0, max: 1, step: 0.05, default: 0.2, description: "End offset as a fraction of the frame height." },\n  ],\n  // p runs 1 → 0 over the out duration (1 = fully shown).\n  frame: (f, p, k) => { const e = ease(p); return { ...f, alpha: f.alpha * e, dy: f.dy - (1 - e) * n(k.distance, 0.2) }; },`, `import { ease, n } from "../_lib/math";`],
  textAnimLoop: ["defineTextAnimLoop", `  params: [\n    { key: "period", label: "Period", type: "number", min: 0.2, max: 5, step: 0.1, default: 1, description: "Length of one cycle in seconds." },\n    { key: "amount", label: "Amount", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.05, description: "Swing as a fraction of the frame height." },\n  ],\n  // p is the phase 0..1 within one period.\n  frame: (f, p, k) => ({ ...f, dy: f.dy + wave(p) * n(k.amount, 0.05) }),`, `import { n, wave } from "../_lib/math";`],
  effect: ["defineTextEffect", `  params: [\n    { key: "color", label: "Colour", type: "color", default: "#20d5ec", description: "Effect colour (#rrggbb)." },\n  ],\n  frame: (f, _p, k) => ({ ...f, fx: { ...f.fx, color: s(k.color, "#20d5ec"), glowBlur: 0.3 } }),`, `import { s } from "../_lib/math";`],
  sticker: ["defineSticker", `  svg: svg(\`<circle cx="100" cy="100" r="80" fill="\${YEL}"/>\`),`, `import { svg, YEL } from "../_lib/sticker";`],
  textStyle: ["defineTextStyle", `  // size is a fraction of the frame height; font is a font id (see src/v2/presets/font).
  data: { font: "sans", bold: true, color: "#ffffff", size: 0.08, effect: "none" },`, ``],
};
if (!T[kind] || !id || !ID_RE.test(id)) {
  console.error(`usage: npm run new:preset -- <kind> <id>\n  kind: ${Object.keys(T).join(" | ")}\n  id:   lower-case letters, digits and dashes`);
  process.exit(1);
}
const file = join(root, "src/v2/presets", kind, `${id}.ts`);
if (existsSync(file) || existsSync(join(root, "src/v2/presets", kind, id, "index.ts"))) { console.error(`${relative(root, file)} already exists`); process.exit(1); }
const [fn, body, imports] = T[kind];
const src = `import { ${fn} } from "../define";\n${imports ? `${imports}\n` : ""}
export default ${fn}({
  id: "${id}",
  name: "${title(id)}",
  category: "TODO",
  description: "TODO: one sentence on the look and when to use it.",
${body}
  // Optional: preview: { text: "ABC" }, ai: { use: "…", avoid: "…", example: { … } }, version: 1
});
`;
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, src);
console.log(`created ${relative(root, file)} — fill in the TODOs, then npm test && npm run gen:ai`);

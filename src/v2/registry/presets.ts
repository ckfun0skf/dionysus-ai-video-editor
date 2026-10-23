/**
 * Built-in preset descriptors: plain JSON-serializable data. To add a preset, append a descriptor here (or load
 * one at runtime with `registerPresets`) whose `type` names a function in renderers.ts. See docs/v2/MODULE_DESIGN.md.
 */
import type { PresetDescriptor } from "./types";

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="400" height="400">${body}</svg>`;
const RED = "#ff3b30", YEL = "#ffd60a";
const P = (d: Omit<PresetDescriptor, "params" | "preview"> & Partial<Pick<PresetDescriptor, "params" | "preview">>): PresetDescriptor => ({ params: [], preview: {}, ...d });
const sticker = (id: string, name: string, body: string) => P({ id, kind: "sticker", category: "Shapes", name, type: "sticker", params: [{ key: "svg", label: "SVG", type: "string", default: svg(body) }] });

export const BUILTIN_PRESETS: PresetDescriptor[] = [
  // Text in
  P({ id: "fade", kind: "textAnimIn", category: "Basic", name: "Fade", type: "fade" }),
  P({ id: "slide-up", kind: "textAnimIn", category: "Basic", name: "Slide up", type: "slide", params: [{ key: "distance", label: "Distance", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.08 }, { key: "dirX", label: "X", type: "number", min: -1, max: 1, default: 0 }, { key: "dirY", label: "Y", type: "number", min: -1, max: 1, default: 1 }] }),
  P({ id: "slide-left", kind: "textAnimIn", category: "Basic", name: "Slide left", type: "slide", params: [{ key: "distance", label: "Distance", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.15 }, { key: "dirX", label: "X", type: "number", min: -1, max: 1, default: 1 }, { key: "dirY", label: "Y", type: "number", min: -1, max: 1, default: 0 }] }),
  P({ id: "pop", kind: "textAnimIn", category: "Bounce", name: "Pop", type: "pop", params: [{ key: "overshoot", label: "Overshoot", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.12 }] }),
  P({ id: "zoom-in", kind: "textAnimIn", category: "Basic", name: "Zoom", type: "zoom" }),
  P({ id: "typewriter", kind: "textAnimIn", category: "Type", name: "Typewriter", type: "typewriter" }),
  P({ id: "wipe", kind: "textAnimIn", category: "Reveal", name: "Wipe", type: "wipe" }),
  P({ id: "blur-in", kind: "textAnimIn", category: "Reveal", name: "Blur", type: "blurIn", params: [{ key: "blur", label: "Blur", type: "number", min: 0, max: 30, default: 8 }] }),
  // Text out (rendered with reversed progress: 1 = fully visible)
  P({ id: "fade", kind: "textAnimOut", category: "Basic", name: "Fade", type: "fade" }),
  P({ id: "slide-down", kind: "textAnimOut", category: "Basic", name: "Slide down", type: "slide", params: [{ key: "distance", label: "Distance", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.08 }, { key: "dirX", label: "X", type: "number", min: -1, max: 1, default: 0 }, { key: "dirY", label: "Y", type: "number", min: -1, max: 1, default: 1 }] }),
  P({ id: "shrink", kind: "textAnimOut", category: "Basic", name: "Shrink", type: "zoom" }),
  P({ id: "blur-out", kind: "textAnimOut", category: "Reveal", name: "Blur", type: "blurIn", params: [{ key: "blur", label: "Blur", type: "number", min: 0, max: 30, default: 8 }] }),
  P({ id: "wipe-out", kind: "textAnimOut", category: "Reveal", name: "Wipe", type: "wipe" }),
  // Text loop (progress = phase in a cycle of `period` seconds)
  P({ id: "pulse", kind: "textAnimLoop", category: "Basic", name: "Pulse", type: "pulse", params: [{ key: "period", label: "Period", type: "number", min: 0.2, max: 4, default: 1 }, { key: "amount", label: "Amount", type: "number", min: 0, max: 0.3, step: 0.01, default: 0.06 }] }),
  P({ id: "wiggle", kind: "textAnimLoop", category: "Basic", name: "Wiggle", type: "wiggle", params: [{ key: "period", label: "Period", type: "number", min: 0.2, max: 4, default: 1 }, { key: "degrees", label: "Degrees", type: "number", min: 0, max: 30, default: 4 }] }),
  P({ id: "float", kind: "textAnimLoop", category: "Basic", name: "Float", type: "float", params: [{ key: "period", label: "Period", type: "number", min: 0.2, max: 4, default: 1 }, { key: "amount", label: "Amount", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.015 }] }),
  P({ id: "blink", kind: "textAnimLoop", category: "Basic", name: "Blink", type: "blink", params: [{ key: "period", label: "Period", type: "number", min: 0.2, max: 4, default: 1 }] }),
  // Text effects
  P({ id: "glow", kind: "effect", category: "Light", name: "Glow", type: "glow", params: [{ key: "blur", label: "Blur", type: "number", min: 0, max: 1, step: 0.01, default: 0.35 }] }),
  P({ id: "neon", kind: "effect", category: "Light", name: "Neon", type: "neon", params: [{ key: "blur", label: "Blur", type: "number", min: 0, max: 1, step: 0.01, default: 0.6 }] }),
  P({ id: "hollow", kind: "effect", category: "Style", name: "Hollow", type: "hollow" }),
  P({ id: "echo", kind: "effect", category: "Style", name: "Echo", type: "echo", params: [{ key: "offset", label: "Offset", type: "number", min: 0, max: 0.3, step: 0.01, default: 0.06 }] }),
  // Transitions
  P({ id: "crossfade", kind: "transition", category: "Basic", name: "Crossfade", type: "crossfade", preview: { icon: "⧓" } }),
  P({ id: "dip", kind: "transition", category: "Basic", name: "Dip to black", type: "dip", preview: { icon: "◐" } }),
  // Stickers
  sticker("arrow-right", "Arrow →", `<path d="M20 100h130" stroke="${RED}" stroke-width="18" stroke-linecap="round"/><path d="M110 55l50 45-50 45" fill="none" stroke="${RED}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`),
  sticker("arrow-down", "Arrow ↓", `<path d="M100 20v130" stroke="${YEL}" stroke-width="18" stroke-linecap="round"/><path d="M55 110l45 50 45-50" fill="none" stroke="${YEL}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`),
  sticker("arrow-curve", "Curved arrow", `<path d="M30 160C40 70 110 40 160 60" fill="none" stroke="${RED}" stroke-width="16" stroke-linecap="round"/><path d="M125 35l40 25-28 38" fill="none" stroke="${RED}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`),
  sticker("circle", "Circle", `<circle cx="100" cy="100" r="78" fill="none" stroke="${RED}" stroke-width="14"/>`),
  sticker("circle-hand", "Hand-drawn circle", `<path d="M150 45C110 15 35 35 28 100s70 85 120 62 40-95-15-112" fill="none" stroke="${YEL}" stroke-width="12" stroke-linecap="round"/>`),
  sticker("burst", "Highlight", `<g stroke="${YEL}" stroke-width="12" stroke-linecap="round"><path d="M100 20v35M100 145v35M20 100h35M145 100h35M43 43l25 25M132 132l25 25M157 43l-25 25M68 132l-25 25"/></g>`),
];

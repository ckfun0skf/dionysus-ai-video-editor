/**
 * Built-in preset descriptors: plain JSON-serializable data. To add a preset, append a descriptor here (or load
 * one at runtime with `registerPresets`) whose `type` names a function in renderers.ts. See docs/v2/MODULE_DESIGN.md.
 */
import type { PresetDescriptor } from "./types";

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="400" height="400">${body}</svg>`;
const RED = "#ff3b30", YEL = "#ffd60a";
const P = (d: Omit<PresetDescriptor, "params" | "preview" | "version"> & Partial<Pick<PresetDescriptor, "params" | "preview" | "version">>): PresetDescriptor => ({ version: 1, params: [], preview: {}, ...d });
const sticker = (id: string, name: string, description: string, body: string) => P({ id, kind: "sticker", category: "Shapes", name, description, type: "sticker", params: [{ key: "svg", label: "SVG", type: "string", default: svg(body) }] });

export const BUILTIN_PRESETS: PresetDescriptor[] = [
  // Text in
  P({ id: "fade", kind: "textAnimIn", description: "Fades the text in from transparent.", category: "Basic", name: "Fade", type: "fade" }),
  P({ id: "slide-up", kind: "textAnimIn", description: "Fades in while sliding up into place from slightly below.", category: "Basic", name: "Slide up", type: "slide", params: [{ key: "distance", label: "Distance", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.08 }, { key: "dirX", label: "X", type: "number", min: -1, max: 1, default: 0 }, { key: "dirY", label: "Y", type: "number", min: -1, max: 1, default: 1 }] }),
  P({ id: "slide-left", kind: "textAnimIn", description: "Fades in while sliding left into place from the right.", category: "Basic", name: "Slide left", type: "slide", params: [{ key: "distance", label: "Distance", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.15 }, { key: "dirX", label: "X", type: "number", min: -1, max: 1, default: 1 }, { key: "dirY", label: "Y", type: "number", min: -1, max: 1, default: 0 }] }),
  P({ id: "pop", kind: "textAnimIn", description: "Scales up from small with a springy overshoot; lively titles and labels.", category: "Bounce", name: "Pop", type: "pop", params: [{ key: "overshoot", label: "Overshoot", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.12 }] }),
  P({ id: "zoom-in", kind: "textAnimIn", description: "Grows from nothing to full size.", category: "Basic", name: "Zoom", type: "zoom" }),
  P({ id: "typewriter", kind: "textAnimIn", description: "Reveals the text one character at a time.", category: "Type", name: "Typewriter", type: "typewriter" }),
  P({ id: "wipe", kind: "textAnimIn", description: "Reveals the text left to right behind a moving edge.", category: "Reveal", name: "Wipe", type: "wipe" }),
  P({ id: "blur-in", kind: "textAnimIn", description: "Fades in from a soft blur to sharp; gentle, cinematic.", category: "Reveal", name: "Blur", type: "blurIn", params: [{ key: "blur", label: "Blur", type: "number", min: 0, max: 30, default: 8 }] }),
  // Text out (rendered with reversed progress: 1 = fully visible)
  P({ id: "fade", kind: "textAnimOut", description: "Fades the text out to transparent.", category: "Basic", name: "Fade", type: "fade" }),
  P({ id: "slide-down", kind: "textAnimOut", description: "Fades out while sliding down.", category: "Basic", name: "Slide down", type: "slide", params: [{ key: "distance", label: "Distance", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.08 }, { key: "dirX", label: "X", type: "number", min: -1, max: 1, default: 0 }, { key: "dirY", label: "Y", type: "number", min: -1, max: 1, default: 1 }] }),
  P({ id: "shrink", kind: "textAnimOut", description: "Shrinks to nothing.", category: "Basic", name: "Shrink", type: "zoom" }),
  P({ id: "blur-out", kind: "textAnimOut", description: "Blurs and fades away.", category: "Reveal", name: "Blur", type: "blurIn", params: [{ key: "blur", label: "Blur", type: "number", min: 0, max: 30, default: 8 }] }),
  P({ id: "wipe-out", kind: "textAnimOut", description: "Hides the text right to left behind a moving edge.", category: "Reveal", name: "Wipe", type: "wipe" }),
  // Text loop (progress = phase in a cycle of `period` seconds)
  P({ id: "pulse", kind: "textAnimLoop", description: "Gently grows and shrinks in a loop.", category: "Basic", name: "Pulse", type: "pulse", params: [{ key: "period", label: "Period", type: "number", min: 0.2, max: 4, default: 1 }, { key: "amount", label: "Amount", type: "number", min: 0, max: 0.3, step: 0.01, default: 0.06 }] }),
  P({ id: "wiggle", kind: "textAnimLoop", description: "Rocks side to side in a loop; playful.", category: "Basic", name: "Wiggle", type: "wiggle", params: [{ key: "period", label: "Period", type: "number", min: 0.2, max: 4, default: 1 }, { key: "degrees", label: "Degrees", type: "number", min: 0, max: 30, default: 4 }] }),
  P({ id: "float", kind: "textAnimLoop", description: "Bobs softly up and down in a loop.", category: "Basic", name: "Float", type: "float", params: [{ key: "period", label: "Period", type: "number", min: 0.2, max: 4, default: 1 }, { key: "amount", label: "Amount", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.015 }] }),
  P({ id: "blink", kind: "textAnimLoop", description: "Blinks on and off in a loop.", category: "Basic", name: "Blink", type: "blink", params: [{ key: "period", label: "Period", type: "number", min: 0.2, max: 4, default: 1 }] }),
  // Text effects
  P({ id: "glow", kind: "effect", description: "Soft coloured glow around the letters.", category: "Light", name: "Glow", type: "glow", params: [{ key: "blur", label: "Blur", type: "number", min: 0, max: 1, step: 0.01, default: 0.35 }] }),
  P({ id: "neon", kind: "effect", description: "Bright neon tube look with a strong coloured glow.", category: "Light", name: "Neon", type: "neon", params: [{ key: "blur", label: "Blur", type: "number", min: 0, max: 1, step: 0.01, default: 0.6 }] }),
  P({ id: "hollow", kind: "effect", description: "Outline-only letters with a transparent fill.", category: "Style", name: "Hollow", type: "hollow" }),
  P({ id: "echo", kind: "effect", description: "Repeated offset copies behind the text.", category: "Style", name: "Echo", type: "echo", params: [{ key: "offset", label: "Offset", type: "number", min: 0, max: 0.3, step: 0.01, default: 0.06 }] }),
  // Video effects (effect layers, V2-101): p = progress through the effect clip
  P({ id: "fade-in", kind: "videoEffect", description: "Fades the picture in from black at the start of the range.", category: "Basic", name: "Fade in", type: "vFadeIn", params: [{ key: "length", label: "Length", type: "number", min: 0.05, max: 1, step: 0.05, default: 0.5 }] }),
  P({ id: "fade-out", kind: "videoEffect", description: "Fades the picture out to black at the end of the range.", category: "Basic", name: "Fade out", type: "vFadeOut", params: [{ key: "length", label: "Length", type: "number", min: 0.05, max: 1, step: 0.05, default: 0.5 }] }),
  P({ id: "blur", kind: "videoEffect", description: "Blurs the whole picture.", category: "Lens", name: "Blur", type: "vBlur", params: [{ key: "amount", label: "Amount", type: "number", min: 0, max: 1, step: 0.05, default: 0.5 }] }),
  P({ id: "ken-burns", kind: "videoEffect", description: "Slow zoom and pan across the picture (push-in); brings stills to life.", category: "Motion", name: "Zoom", type: "vZoom", params: [{ key: "zoom", label: "Zoom", type: "number", min: 0, max: 1, step: 0.05, default: 0.25 }, { key: "pan", label: "Pan", type: "number", min: -0.3, max: 0.3, step: 0.01, default: 0.05 }] }),
  P({ id: "shake", kind: "videoEffect", description: "Handheld camera shake.", category: "Motion", name: "Shake", type: "vShake", params: [{ key: "amount", label: "Amount", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.02 }, { key: "speed", label: "Speed", type: "number", min: 2, max: 40, step: 1, default: 16 }] }),
  P({ id: "vignette", kind: "videoEffect", description: "Darkens the frame edges to focus the centre.", category: "Lens", name: "Vignette", type: "vVignette", params: [{ key: "amount", label: "Amount", type: "number", min: 0, max: 1, step: 0.05, default: 0.6 }] }),
  P({ id: "bw", kind: "videoEffect", description: "Black-and-white (desaturated) picture.", category: "Color", name: "B&W", type: "vGray", params: [{ key: "amount", label: "Amount", type: "number", min: 0, max: 1, step: 0.05, default: 1 }] }),
  // Transitions
  P({ id: "crossfade", kind: "transition", description: "The outgoing clip dissolves into the incoming clip.", category: "Basic", name: "Crossfade", type: "crossfade", preview: { icon: "⧓" } }),
  P({ id: "dip", kind: "transition", description: "Fades the outgoing clip to black, then up into the incoming clip.", category: "Basic", name: "Dip to black", type: "dip", preview: { icon: "◐" } }),
  // Stickers
  sticker("arrow-right", "Arrow →", "Red arrow pointing right.", `<path d="M20 100h130" stroke="${RED}" stroke-width="18" stroke-linecap="round"/><path d="M110 55l50 45-50 45" fill="none" stroke="${RED}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`),
  sticker("arrow-down", "Arrow ↓", "Yellow arrow pointing down.", `<path d="M100 20v130" stroke="${YEL}" stroke-width="18" stroke-linecap="round"/><path d="M55 110l45 50 45-50" fill="none" stroke="${YEL}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`),
  sticker("arrow-curve", "Curved arrow", "Red curved arrow for call-outs.", `<path d="M30 160C40 70 110 40 160 60" fill="none" stroke="${RED}" stroke-width="16" stroke-linecap="round"/><path d="M125 35l40 25-28 38" fill="none" stroke="${RED}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`),
  sticker("circle", "Circle", "Red circle to ring a detail.", `<circle cx="100" cy="100" r="78" fill="none" stroke="${RED}" stroke-width="14"/>`),
  sticker("circle-hand", "Hand-drawn circle", "Yellow hand-drawn circle.", `<path d="M150 45C110 15 35 35 28 100s70 85 120 62 40-95-15-112" fill="none" stroke="${YEL}" stroke-width="12" stroke-linecap="round"/>`),
  sticker("burst", "Highlight", "Yellow highlight rays around a point.", `<g stroke="${YEL}" stroke-width="12" stroke-linecap="round"><path d="M100 20v35M100 145v35M20 100h35M145 100h35M43 43l25 25M132 132l25 25M157 43l-25 25M68 132l-25 25"/></g>`),
  // Text styles (one-tap looks, formerly TEXT_TEMPLATES). `data` holds text clip fields; `font` is a font id (fonts.ts).
  P({ id: "plain", kind: "textStyle", description: "Bold white sans-serif with no decoration; the default.", category: "Basic", name: "Plain", type: "none", data: { font: "sans", bold: true, color: "#ffffff", strokeWidth: 0, shadow: null, background: null, effect: "none" } }),
  P({ id: "caption", kind: "textStyle", description: "Smaller bold white text on a translucent black box; subtitles and lower thirds.", category: "Basic", name: "Caption", type: "none", data: { font: "sans", bold: true, color: "#ffffff", background: { color: "#000000", opacity: 0.6 }, effect: "none", size: 0.06 } }),
  P({ id: "outline", kind: "textStyle", description: "Yellow Impact letters with a thick black outline; meme or punchy look.", category: "Bold", name: "Outline", type: "none", data: { font: "impact", color: "#ffe14d", strokeWidth: 0.08, strokeColor: "#000000", effect: "none" } }),
  P({ id: "neon", kind: "textStyle", description: "White rounded letters with a pink neon glow and a gentle pulse.", category: "Light", name: "Neon", type: "none", data: { font: "rounded", color: "#ffffff", effect: "neon", effectColor: "#ff3df2", loop: "pulse" } }),
  P({ id: "pop", kind: "textStyle", description: "Large white Impact title with a hard drop shadow that pops in and shrinks out.", category: "Bold", name: "Pop title", type: "none", data: { font: "impact", color: "#ffffff", shadow: { color: "#000000", blur: 0, x: 0.05, y: 0.05 }, animIn: "pop", animOut: "shrink", size: 0.14 } }),
  P({ id: "typewriter", kind: "textStyle", description: "Light grey monospace that types itself on.", category: "Basic", name: "Typewriter", type: "none", data: { font: "mono", bold: false, color: "#e8e8e8", animIn: "typewriter", effect: "none" } }),
  P({ id: "glow", kind: "textStyle", description: "Italic white serif with a cyan glow that floats softly.", category: "Light", name: "Glow", type: "none", data: { font: "serif", italic: true, color: "#ffffff", effect: "glow", effectColor: "#20d5ec", loop: "float" } }),
  P({ id: "echo", kind: "textStyle", description: "White Impact letters with pink echo copies that slide up in.", category: "Bold", name: "Echo", type: "none", data: { font: "impact", color: "#ffffff", effect: "echo", effectColor: "#ff4d6d", animIn: "slide-up" } }),
];

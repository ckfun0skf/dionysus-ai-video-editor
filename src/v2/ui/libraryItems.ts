import { THREE_TEMPLATE } from "../render";

export const CANVAS_SAMPLE = `<!doctype html>
<html><head><style>html,body{margin:0;height:100%;background:#111}canvas{width:100%;height:100%;display:block}</style></head>
<body><canvas id="c"></canvas>
<script>
const c = document.getElementById("c"), g = c.getContext("2d");
function frame(t) {
  c.width = innerWidth; c.height = innerHeight;
  g.fillStyle = "#111"; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 12; i++) {
    const a = t / 1000 + i * Math.PI / 6, r = Math.min(c.width, c.height) / 3;
    g.fillStyle = \`hsl(\${i * 30} 80% 60%)\`;
    g.beginPath(); g.arc(c.width / 2 + Math.cos(a) * r, c.height / 2 + Math.sin(a) * r, 18, 0, 7); g.fill();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script></body></html>`;

export const BLANK_HTML = `<!doctype html>
<html><head><style>html,body{margin:0;height:100%;background:#000;color:#fff;font:48px system-ui;display:grid;place-items:center}</style></head>
<body><div>Edit me</div></body></html>`;

export type LibraryItem = { id: string; name: string; hint: string; icon: string; html?: string; file?: string };
export const LIBRARY_ITEMS: LibraryItem[] = [
  { id: "three", name: "three.js scene", hint: "3D HTML clip using the three.js library", icon: "◆", html: THREE_TEMPLATE, file: "three-scene.html" },
  { id: "canvas", name: "Canvas animation", hint: "Plain canvas + requestAnimationFrame, no libraries", icon: "◎", html: CANVAS_SAMPLE, file: "canvas-animation.html" },
  { id: "blank", name: "Blank HTML", hint: "Empty HTML clip to write from scratch", icon: "</>", html: BLANK_HTML, file: "blank.html" },
  { id: "text", name: "Text", hint: "Editable text clip", icon: "T" },
];
export const libraryFile = (it: LibraryItem) => (it.html ? new File([it.html], it.file ?? `${it.id}.html`, { type: "text/html" }) : undefined);

/** Built-in stickers (SVG, rasterised to PNG on add so they render like any image clip). */
export type Sticker = { id: string; name: string; svg: string };
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="400" height="400">${body}</svg>`;
const RED = "#ff3b30", YEL = "#ffd60a";
export const STICKERS: Sticker[] = [
  { id: "arrow-right", name: "Arrow →", svg: svg(`<path d="M20 100h130" stroke="${RED}" stroke-width="18" stroke-linecap="round"/><path d="M110 55l50 45-50 45" fill="none" stroke="${RED}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: "arrow-down", name: "Arrow ↓", svg: svg(`<path d="M100 20v130" stroke="${YEL}" stroke-width="18" stroke-linecap="round"/><path d="M55 110l45 50 45-50" fill="none" stroke="${YEL}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: "arrow-curve", name: "Curved arrow", svg: svg(`<path d="M30 160C40 70 110 40 160 60" fill="none" stroke="${RED}" stroke-width="16" stroke-linecap="round"/><path d="M125 35l40 25-28 38" fill="none" stroke="${RED}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { id: "circle", name: "Circle", svg: svg(`<circle cx="100" cy="100" r="78" fill="none" stroke="${RED}" stroke-width="14"/>`) },
  { id: "circle-hand", name: "Hand-drawn circle", svg: svg(`<path d="M150 45C110 15 35 35 28 100s70 85 120 62 40-95-15-112" fill="none" stroke="${YEL}" stroke-width="12" stroke-linecap="round"/>`) },
  { id: "burst", name: "Highlight", svg: svg(`<g stroke="${YEL}" stroke-width="12" stroke-linecap="round"><path d="M100 20v35M100 145v35M20 100h35M145 100h35M43 43l25 25M132 132l25 25M157 43l-25 25M68 132l-25 25"/></g>`) },
];
export const stickerUrl = (s: Sticker) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`;
export async function stickerFile(s: Sticker): Promise<File> {
  const img = new Image();
  img.src = stickerUrl(s);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = 400;
  c.getContext("2d")!.drawImage(img, 0, 0, 400, 400);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("sticker render failed"))), "image/png"));
  return new File([blob], `sticker-${s.id}.png`, { type: "image/png" });
}

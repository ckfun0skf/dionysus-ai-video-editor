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

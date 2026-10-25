import { HTML_CLIP_FORMAT, writeManifest, type HtmlClipManifest } from "../domain";

/**
 * The starting point for a new code clip (V2-ADD-MEDIA-TABS, Add Media → Code → Create): a `dionysus.htmlclip/1`
 * package whose page is just the captured canvas, and a minimal 2D `dionysus.clip` script that reads its params.
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

export const BASE_CSS = "html,body{margin:0;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}";

/** A complete package: the manifest, the standard canvas page and the script. */
export function newCodeClipHtml(): string {
  const page = `<!doctype html>\n<html><head>\n<meta charset="utf-8">\n<style>${BASE_CSS}</style>\n</head>\n<body><canvas id="c"></canvas>\n<script type="module">\n${NEW_CODE_SCRIPT}</script></body></html>\n`;
  return writeManifest(page, NEW_CODE_MANIFEST);
}

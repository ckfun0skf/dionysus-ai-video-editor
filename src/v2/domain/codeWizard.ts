// P4B: Code "AI mode" — the wizard's answers and the prompt it builds for an external AI. The prompt reuses
// htmlClipPackagePrompt (the same source as HTML_CLIP_PACKAGE.md), plus the role guidance and the reference-media rules
// below, which the spec publishes as a generated block (§6.1).
import {
  HTML_CLIP_ASPECTS, HTML_CLIP_FORMAT, HTML_CLIP_PACKAGE_REPLY, MAX_CLIP_SEC, htmlClipPackagePrompt, validateParamDecls,
  type ClipLibrary, type HtmlClipIssue, type HtmlClipParam, type PackagePromptInput, type ParamType,
} from "./htmlClipPackage";

export const CODE_ROLES = ["scene", "overlay", "title", "dataviz"] as const;
export type CodeRole = (typeof CODE_ROLES)[number];
export const CODE_ROLE_LABEL: Record<CodeRole, string> = { scene: "Full-frame scene", overlay: "Overlay on a video", title: "Title or text", dataviz: "Data viz" };
/** Role guidance, inlined in the prompt and published in the spec. */
export const CODE_ROLE_GUIDE: Record<CodeRole, string> = {
  scene: "Full-frame scene: the clip is the whole picture on the main track. Paint every pixel every frame (an opaque background) and give it depth and motion over the whole duration.",
  overlay: "Overlay on a video: the clip sits on an overlay track above video. Keep the background transparent (clear the canvas every frame) and draw only the graphics; leave the video visible.",
  title: "Title or text: a title, lower third or text card. Keep text inside the safe area (5% inset), animate it in and out within the duration, size it from ctx.width/ctx.height, and make the text a param when it can change.",
  dataviz: "Data viz: an animated chart or diagram. Embed the data in the package (a param for small values, or a JSON file / JS constant), animate it from ctx.progress, and label axes and values legibly at the frame size.",
};

/** How an overlay lines up with an attached video, and how analysis results travel (no network or ML runtime). */
export const CODE_VIDEO_GUIDE = `REFERENCE VIDEO (timing and analysis)
- Timing: in Dionysus the clip is placed on an overlay track at the same start as the video clip, so the overlay's t = 0 is the video's first frame and t runs in seconds of video time. A number param "videoOffset" (seconds, default 0) is the video time at t = 0: look up your data at videoTime = t + ctx.params.videoOffset. Data outside the video's length draws nothing.
- Analysis: the clip runs with no network and no ML runtime, so do any analysis yourself now (for example run an object detector over the attached video, frame by frame) and embed the RESULTS as data in the package: a file such as "detections.json" (in the ZIP, or as a data: URL in the manifest's "files") loaded in init(), or a JS constant. Use { "fps": <fps you sampled at>, "width": <video width>, "height": <video height>, "frames": [ { "t": seconds, "items": [ { "label": "person", "score": 0-1, "box": [x, y, w, h] } ] } ] }, with boxes normalised to 0–1 of the video frame.
- Drawing: map normalised boxes to ctx.width × ctx.height, interpolate between the two nearest samples so playback at any frame rate is smooth, and draw only from the data, never from the live video pixels.
- If you can't open or analyse the video, say so, and still deliver the clip with a small, clearly marked sample data set in the same format so the user can replace it.`;

export interface WizardParam { key: string; type: ParamType; label?: string; default?: string; options?: string }
export interface WizardRef { name: string; kind: "video" | "image"; durationSec?: number; width?: number; height?: number }
export interface CodeWizardAnswers {
  description: string;
  role: CodeRole;
  params: WizardParam[];
  aspect: string;
  durationSec: number;
  three: boolean;
  refs: WizardRef[];
}

export const newWizardAnswers = (role: CodeRole = "scene"): CodeWizardAnswers => ({ description: "", role, params: [], aspect: "16:9", durationSec: 5, three: false, refs: [] });

/** The nearest supported aspect for a reference's pixel size. */
export function nearestAspect(width: number, height: number): string {
  const r = width / height;
  return [...HTML_CLIP_ASPECTS].sort((a, b) => Math.abs(ratio(a) - r) - Math.abs(ratio(b) - r))[0];
}
const ratio = (a: string) => { const [w, h] = a.split(":").map(Number); return w / h; };

/** A wizard param row → a manifest param declaration. */
export function wizardParam(p: WizardParam): HtmlClipParam {
  const label = p.label?.trim() || undefined;
  const d = (p.default ?? "").trim();
  switch (p.type) {
    case "number": { const n = Number(d); return { type: "number", default: d && Number.isFinite(n) ? n : 1, ...(label ? { label } : {}) }; }
    case "color": return { type: "color", default: /^#[0-9a-f]{6}$/i.test(d) ? d.toLowerCase() : "#ffffff", ...(label ? { label } : {}) };
    case "boolean": return { type: "boolean", default: d === "true" || d === "on" || d === "yes", ...(label ? { label } : {}) };
    case "select": {
      const options = (p.options ?? "").split(",").map((o) => o.trim()).filter(Boolean);
      const opts = options.length ? options : ["a", "b"];
      return { type: "select", default: opts.includes(d) ? d : opts[0], options: opts, ...(label ? { label } : {}) };
    }
    default: return { type: "text", default: d, ...(label ? { label } : {}) };
  }
}

export function wizardParams(a: CodeWizardAnswers): Record<string, HtmlClipParam> {
  const out: Record<string, HtmlClipParam> = {};
  for (const p of a.params) if (p.key.trim()) out[p.key.trim()] = wizardParam(p);
  if (a.refs.some((r) => r.kind === "video") && !out.videoOffset) out.videoOffset = { type: "number", default: 0, min: -600, max: 600, step: 0.01, label: "Video offset (s)", description: "Video time at the overlay's start" };
  return out;
}

/** Problems that block building the prompt, per step. */
export function wizardIssues(a: CodeWizardAnswers): { step: "describe" | "params" | "size"; message: string }[] {
  const out: { step: "describe" | "params" | "size"; message: string }[] = [];
  if (!a.description.trim()) out.push({ step: "describe", message: "Describe what to make." });
  const seen = new Set<string>();
  for (const p of a.params) {
    const k = p.key.trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(k)) out.push({ step: "params", message: `"${k || "(empty)"}" is not a valid param name (letters, digits, _; not starting with a digit).` });
    else if (seen.has(k)) out.push({ step: "params", message: `"${k}" is listed twice.` });
    seen.add(k);
  }
  const decl: HtmlClipIssue[] = validateParamDecls(wizardParams(a));
  if (!out.some((i) => i.step === "params")) for (const i of decl) if (i.level === "error") out.push({ step: "params", message: i.message });
  if (!(a.durationSec > 0 && a.durationSec <= MAX_CLIP_SEC)) out.push({ step: "size", message: `Duration must be between 0 and ${MAX_CLIP_SEC} s.` });
  if (!(HTML_CLIP_ASPECTS as readonly string[]).includes(a.aspect)) out.push({ step: "size", message: "Pick a frame size." });
  return out;
}

const fmtRef = (r: WizardRef) => `- "${r.name}" (${r.kind}${r.width && r.height ? `, ${r.width}×${r.height}` : ""}${r.durationSec ? `, ${Math.round(r.durationSec * 100) / 100} s` : ""})`;

export function wizardPackageInput(a: CodeWizardAnswers): PackagePromptInput {
  const transparent = a.role === "overlay" || a.role === "title";
  const refs = a.refs.length
    ? `REFERENCE MEDIA (the user attaches these files to this chat; they are for you to look at or analyse, not loaded by the clip)\n${a.refs.map(fmtRef).join("\n")}`
    : "";
  const context = [`ROLE\n${CODE_ROLE_GUIDE[a.role]}`, a.three ? "Use three.js (WebGL) for this clip: import * as THREE from \"three\", list \"three\" in \"libs\", render to ctx.canvas with preserveDrawingBuffer: true, and set the camera and every animated value from t (no clock or mixer state)." : "Use the 2D canvas API; no libraries.", refs, a.refs.some((r) => r.kind === "video") ? CODE_VIDEO_GUIDE : ""].filter(Boolean).join("\n\n");
  return {
    brief: a.description,
    name: a.description.trim().split(/[.\n]/)[0].slice(0, 48) || "Code clip",
    durationSec: a.durationSec,
    aspect: a.aspect,
    background: transparent ? "transparent" : "#000000",
    params: wizardParams(a),
    context,
  };
}

/** The AI-mode prompt: the package prompt (full contract and template inlined, plus the spec link) asking for a .zip or .html. */
export function codeWizardPrompt(a: CodeWizardAnswers, opts: { libs: readonly ClipLibrary[]; specUrl: string }): string {
  const libs = a.three ? opts.libs.filter((l) => l.id === "three") : [];
  const p = htmlClipPackagePrompt(wizardPackageInput(a), { libs, specUrl: opts.specUrl, full: true, reply: "package" });
  return p.replace(`PACKAGE (${HTML_CLIP_FORMAT})`, `PACKAGE (${HTML_CLIP_FORMAT})\n- Spec: ${opts.specUrl}`);
}

/** The spec's generated §6.1 block (docs/v2/HTML_CLIP_PACKAGE.md, `npm run gen:ai`). */
export const CODE_WIZARD_DOC = `Roles:\n\n${CODE_ROLES.map((r) => `- **${CODE_ROLE_LABEL[r]}** — ${CODE_ROLE_GUIDE[r]}`).join("\n")}\n\n\`\`\`text\n${CODE_VIDEO_GUIDE}\n\`\`\`\n\n\`\`\`text\n${HTML_CLIP_PACKAGE_REPLY}\n\`\`\``;

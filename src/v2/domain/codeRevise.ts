// P44: Code Editor → Revise with AI. The prompt reuses the HTML clip package contract (HTML_CLIP_CONTRACT,
// HTML_CLIP_PACKAGE_REPLY — the same source as HTML_CLIP_PACKAGE.md and codeWizardPrompt). Dionysus does not call an AI.
import {
  HTML_CLIP_CONTRACT, HTML_CLIP_FORMAT, HTML_CLIP_PACKAGE_REPLY, readManifest, refType,
  type ClipLibrary, type HtmlClipManifest,
} from "./htmlClipPackage";
import { CODE_ROLE_GUIDE } from "./codeWizard";

/** Packages longer than this embed poorly (data: images and fonts). At or under it, Embed is the default. */
export const REVISE_EMBED_MAX_CHARS = 32 * 1024;

export type ReviseDelivery = "embed" | "attach";

/** Embed a small package in the prompt; attach a large one as a file. The user can override. */
export function defaultReviseDelivery(html: string): ReviseDelivery {
  return html.length > REVISE_EMBED_MAX_CHARS ? "attach" : "embed";
}

export function reviseIssues(brief: string): { step: "describe"; message: string }[] {
  return brief.trim() ? [] : [{ step: "describe", message: "Describe what should change." }];
}

export interface CodeReviseRequest {
  html: string;
  brief: string;
  delivery: ReviseDelivery;
  /** Download name the attach prompt tells the AI to read, e.g. "Code-clip.html". */
  fileName: string;
}

/**
 * Revise-only instructions, inlined in the prompt and published in HTML_CLIP_PACKAGE.md §6.2
 * (`npm run gen:ai`). The runtime contract and the reply format stay HTML_CLIP_CONTRACT / HTML_CLIP_PACKAGE_REPLY.
 */
export const CODE_REVISE_GUIDE = `REVISE
- Keep what already works. Change only what the change request asks for.
- Keep every param key, type and default unless the change request adds, removes or changes one. The timeline stores values by those keys.
- Keep bindings and inputs unless the change request changes them. Input types are graphic, audio and tracker; the legacy names scene, beat and track mean graphic, audio and tracker.
- Reply with a complete ${HTML_CLIP_FORMAT} package, not a diff, patch or snippet.
- The user imports the .zip or .html (or pastes the reply) in Dionysus (Code Editor → Revise with AI → Import), which checks it against the package standard and opens it in the Code Editor. Saving there makes a new version.`;

/** The spec's generated §6.2 block (docs/v2/HTML_CLIP_PACKAGE.md, `npm run gen:ai`). */
export const CODE_REVISE_DOC = `\`\`\`text\n${CODE_REVISE_GUIDE}\n\`\`\``;

const libLabel = (id: string, libs: readonly ClipLibrary[]) => {
  const l = libs.find((x) => x.id === id);
  return l ? `"${l.id}" (${l.name} ${l.version}, import from "${l.specifier}")` : `"${id}"`;
};

function libraryFact(ids: string[] | undefined, libs: readonly ClipLibrary[]): string {
  if (!ids?.length) return "none";
  return ids.map((id) => libLabel(id, libs)).join(", ");
}

function paramFact(params: HtmlClipManifest["params"]): string {
  const ps = Object.entries(params ?? {});
  if (!ps.length) return "- Params: none";
  const list = ps.map(([k, p]) => {
    const range = p.type === "number" && (p.min !== undefined || p.max !== undefined) ? ` ${p.min ?? "…"}–${p.max ?? "…"}` : "";
    const options = p.type === "select" ? `: ${(p.options ?? []).map((o) => JSON.stringify(o)).join(" | ")}` : "";
    return `  - "${k}" (${p.type}${range}${options}, default ${JSON.stringify(p.default)})${p.label ? ` ${p.label}` : ""}${p.description ? ` — ${p.description}` : ""}`;
  }).join("\n");
  return `- Params (keep these keys, types and defaults unless the change request adds, removes or changes one):\n${list}`;
}

function inputFact(inputs: HtmlClipManifest["inputs"]): string {
  const es = Object.entries(inputs ?? {});
  if (!es.length) return "- Inputs: none";
  const list = es.map(([k, inp]) => {
    const canonical = refType(inp.type);
    const alias = inp.type !== canonical ? `, legacy alias of ${canonical}` : "";
    return `  - "${k}" (${inp.type}${alias})${inp.label ? ` ${inp.label}` : ""}${inp.description ? ` — ${inp.description}` : ""}`;
  }).join("\n");
  return `- Inputs (ctx.inputs; graphic, audio or tracker — legacy names scene, beat and track still mean graphic, audio and tracker):\n${list}`;
}

function bindingFact(bindings: HtmlClipManifest["bindings"]): string {
  const es = Object.entries(bindings ?? {});
  if (!es.length) return "- Bindings: none";
  const list = es.map(([k, b]) => `  - "${k}" (${b.type})${b.label ? ` ${b.label}` : ""}${b.asset ? ` asset ${JSON.stringify(b.asset)}` : ""}${b.description ? ` — ${b.description}` : ""}. Read ctx.bindings[${JSON.stringify(k)}].`).join("\n");
  return `- Bindings (media from other assets; keep them unless the change request changes them):\n${list}`;
}

function roleFact(m: HtmlClipManifest): string {
  if (m.role === "effect" || m.role === "transition") return `- Role: ${m.role}\n${CODE_ROLE_GUIDE[m.role]}`;
  return `- Role: clip\nA timeline clip. It is not an effect or a transition; leave "role" unset unless the change request says otherwise.`;
}

/**
 * The revise prompt: the change request, facts from the current manifest, the shared package contract and reply
 * format, then either the current HTML (embed) or the attached file name (attach).
 */
export function codeRevisePrompt(req: CodeReviseRequest, opts: { libs: readonly ClipLibrary[]; specUrl: string }): string {
  const m = readManifest(req.html);
  const allowed = opts.libs.length ? opts.libs.map((l) => libLabel(l.id, opts.libs)).join(", ") : "none";
  const frame = `${m.width && m.height ? `${m.width}×${m.height}` : "unspecified"}${m.aspect ? ` (${m.aspect})` : ""}`;
  const embedded = req.html.endsWith("\n") ? req.html : `${req.html}\n`;
  const delivery = req.delivery === "embed"
    ? `CURRENT HTML\nThe current ${HTML_CLIP_FORMAT} package is embedded below. Revise this file.\n\n\`\`\`html\n${embedded}\`\`\``
    : `CURRENT HTML\nThe current clip is attached to this chat as ${req.fileName} (${HTML_CLIP_FORMAT}). Read that file and revise it. Do not ask for the HTML to be pasted.`;
  return `Revise an existing HTML clip for the Dionysus video editor (${HTML_CLIP_FORMAT}). Dionysus does not call an AI.

CHANGE REQUEST
${req.brief.trim() || "(no change requested)"}

CURRENT CLIP
- Name: ${m.name?.trim() || "(unnamed)"}
${roleFact(m)}
- Duration: ${m.durationSec ? `${m.durationSec} s` : "the timeline sets it"}
- Frame: ${frame}
- Background: ${m.background ?? "(unspecified)"}
- Libraries: ${libraryFact(m.libs, opts.libs)}
${paramFact(m.params)}
${inputFact(m.inputs)}
${bindingFact(m.bindings)}

${CODE_REVISE_GUIDE}

PACKAGE (${HTML_CLIP_FORMAT})
- Spec: ${opts.specUrl}
- Allowed libraries: ${allowed}. List the ones you use in "libs". Nothing else can be loaded.
- Keep the manifest values above (name, role, duration, frame, background, libraries, params, inputs, bindings) unless the change request changes them.

RUNTIME CONTRACT
${HTML_CLIP_CONTRACT}

${HTML_CLIP_PACKAGE_REPLY}

${delivery}`;
}

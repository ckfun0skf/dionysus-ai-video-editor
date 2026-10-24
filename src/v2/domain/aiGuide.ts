/**
 * Published planner files (V2-SB-114), generated from the preset registry and the prompt sections in storyPrompt.ts:
 * public/ai/storyboard-guide.md, public/ai/storyboard-guide.html, public/ai/presets.json and public/llms.txt.
 * Regenerate with `npm run gen:ai`; aiGuide.test.ts fails while the committed files are stale.
 *
 * Links (V2-OPS-LINKS): AIs fetch these files out of context, so every link an AI follows is absolute, built from a
 * site URL. The committed files use DEFAULT_SITE_URL; `vite build` rewrites them for the build's DIONYSUS_SITE_URL and
 * base (vite.config.ts → aiFilesPlugin), so a deployment elsewhere never ships GitHub Pages links. Links a browser
 * resolves itself (the HTML page's `rel=alternate`) are relative.
 */
import { FONTS, listPresets } from "../registry";
import { FORMAT_REVISION, GUIDE_KINDS, guideSections } from "./storyPrompt";
import { aiLinks, DEFAULT_SITE_URL } from "./siteUrl";
import { DEFAULT_TRANSITION_SEC, STORYBOARD_FORMAT } from "./storyJson";

const GUIDE_TITLE = `Dionysus storyboard guide (${STORYBOARD_FORMAT}, v${FORMAT_REVISION})`;

export function storyboardGuideMarkdown(site = DEFAULT_SITE_URL): string {
  const l = aiLinks(site);
  return `# ${GUIDE_TITLE}

This guide is for AI assistants that plan a video storyboard for the Dionysus video editor (${l.app}). It is generated from the app's preset registry, so the preset ids below are exactly the ones the importer accepts. Machine-readable presets: ${l.presets}. Full format reference: ${l.formatDoc}.

How to use it: the user has agreed a story with you. Turn it into a production storyboard and reply with ONLY one JSON code block in the format below — no commentary before or after. The user pastes your reply into Dionysus (Storyboard → Import JSON), which checks it, then generates or uploads every asset and clip from your prompts.

${guideSections((t) => `## ${t}`)}
`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function storyboardGuideHtml(site = DEFAULT_SITE_URL): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(GUIDE_TITLE)}</title>
<link rel="alternate" type="text/markdown" href="storyboard-guide.md">
<style>body{margin:0;background:#111;color:#eee;font:15px/1.5 system-ui,sans-serif}pre{margin:0 auto;max-width:980px;padding:16px;white-space:pre-wrap;word-wrap:break-word;font:13px/1.5 ui-monospace,Menlo,monospace}</style>
</head>
<body>
<pre>${esc(storyboardGuideMarkdown(site))}</pre>
</body>
</html>
`;
}

export function presetsJson(site = DEFAULT_SITE_URL): string {
  const doc = {
    format: STORYBOARD_FORMAT,
    revision: FORMAT_REVISION,
    guide: aiLinks(site).guide,
    kinds: Object.fromEntries(GUIDE_KINDS.map(({ kind, usedIn }) => [kind, {
      usedIn,
      presets: listPresets(kind).map((d) => ({ id: d.id, version: d.version, name: d.name, description: d.description, params: d.params.map((p) => ({ ...p })), ...(d.kind === "textStyle" && d.data ? { data: d.data } : {}) })),
    }])),
    transitionDefaultSec: DEFAULT_TRANSITION_SEC,
    fonts: FONTS.map((f) => ({ id: f.id, description: f.description })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function llmsTxt(site = DEFAULT_SITE_URL): string {
  const l = aiLinks(site);
  return `# Dionysus AI Video Editor

> A browser video editor (works on phones, including iOS Safari) that turns a storyboard JSON planned by your own AI into a production to-do list and a timeline. Dionysus makes no AI calls itself: the user's AI writes the storyboard, and the user generates and uploads the clips.

To plan a storyboard for Dionysus, read the storyboard guide first and reply with one JSON code block in its format.

## Storyboard planning

- [Storyboard guide](${l.guide}): the ${STORYBOARD_FORMAT} (v${FORMAT_REVISION}) JSON format, the preset ids you may use, the rules and an example
- [Storyboard guide as a web page](${l.guideHtml}): the same guide as HTML
- [Presets](${l.presets}): machine-readable preset ids, descriptions and params with defaults

## Optional

- [Format reference](${l.formatDoc}): the full specification, including importer warnings and errors
- [Open the app](${l.app})
`;
}

/** Source of the format reference that is published as ai/STORYBOARD_FORMAT.md (the guide links there). */
export const FORMAT_DOC_SOURCE = "docs/v2/STORYBOARD_FORMAT.md";

/**
 * Repo-relative path → generated content for a site URL (default: DEFAULT_SITE_URL, as committed). Pass the text of
 * FORMAT_DOC_SOURCE to include its published copy (this module does no file I/O; it also runs in the browser).
 */
export function aiGuideFiles(site = DEFAULT_SITE_URL, formatDoc?: string): Record<string, string> {
  return {
    ...(formatDoc === undefined ? {} : { "public/ai/STORYBOARD_FORMAT.md": formatDoc }),
    "public/ai/storyboard-guide.md": storyboardGuideMarkdown(site),
    "public/ai/storyboard-guide.html": storyboardGuideHtml(site),
    "public/ai/presets.json": presetsJson(site),
    "public/llms.txt": llmsTxt(site),
  };
}

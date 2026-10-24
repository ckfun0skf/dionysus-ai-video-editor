/**
 * Published planner files (V2-SB-114), generated from the preset registry and the prompt sections in storyPrompt.ts:
 * public/ai/storyboard-guide.md, public/ai/storyboard-guide.html, public/ai/presets.json and public/llms.txt.
 * Regenerate with `npm run gen:ai`; aiGuide.test.ts fails while the committed files are stale.
 */
import { FONTS, listPresets } from "../registry";
import { FORMAT_DOC_URL, FORMAT_REVISION, GUIDE_HTML_URL, GUIDE_KINDS, GUIDE_URL, guideSections, PRESETS_URL, PUBLIC_SITE_URL } from "./storyPrompt";
import { DEFAULT_TRANSITION_SEC, STORYBOARD_FORMAT } from "./storyJson";

const GUIDE_TITLE = `Dionysus storyboard guide (${STORYBOARD_FORMAT}, v${FORMAT_REVISION})`;

export function storyboardGuideMarkdown(): string {
  return `# ${GUIDE_TITLE}

This guide is for AI assistants that plan a video storyboard for the Dionysus video editor (${PUBLIC_SITE_URL}?v2). It is generated from the app's preset registry, so the preset ids below are exactly the ones the importer accepts. Machine-readable presets: ${PRESETS_URL}. Full format reference: ${FORMAT_DOC_URL}.

How to use it: the user has agreed a story with you. Turn it into a production storyboard and reply with ONLY one JSON code block in the format below — no commentary before or after. The user pastes your reply into Dionysus (Storyboard → Import JSON), which checks it, then generates or uploads every asset and clip from your prompts.

${guideSections((t) => `## ${t}`)}
`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function storyboardGuideHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(GUIDE_TITLE)}</title>
<link rel="alternate" type="text/markdown" href="${GUIDE_URL}">
<style>body{margin:0;background:#111;color:#eee;font:15px/1.5 system-ui,sans-serif}pre{margin:0 auto;max-width:980px;padding:16px;white-space:pre-wrap;word-wrap:break-word;font:13px/1.5 ui-monospace,Menlo,monospace}</style>
</head>
<body>
<pre>${esc(storyboardGuideMarkdown())}</pre>
</body>
</html>
`;
}

export function presetsJson(): string {
  const doc = {
    format: STORYBOARD_FORMAT,
    revision: FORMAT_REVISION,
    guide: GUIDE_URL,
    kinds: Object.fromEntries(GUIDE_KINDS.map(({ kind, usedIn }) => [kind, {
      usedIn,
      presets: listPresets(kind).map((d) => ({ id: d.id, version: d.version, name: d.name, description: d.description, params: d.params.map((p) => ({ ...p })), ...(d.kind === "textStyle" && d.data ? { data: d.data } : {}) })),
    }])),
    transitionDefaultSec: DEFAULT_TRANSITION_SEC,
    fonts: FONTS.map((f) => ({ id: f.id, description: f.description })),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function llmsTxt(): string {
  return `# Dionysus AI Video Editor

> A browser video editor (works on phones, including iOS Safari) that turns a storyboard JSON planned by your own AI into a production to-do list and a timeline. Dionysus makes no AI calls itself: the user's AI writes the storyboard, and the user generates and uploads the clips.

To plan a storyboard for Dionysus, read the storyboard guide first and reply with one JSON code block in its format.

## Storyboard planning

- [Storyboard guide](${GUIDE_URL}): the ${STORYBOARD_FORMAT} (v${FORMAT_REVISION}) JSON format, the preset ids you may use, the rules and an example
- [Storyboard guide as a web page](${GUIDE_HTML_URL}): the same guide as HTML
- [Presets](${PRESETS_URL}): machine-readable preset ids, descriptions and params with defaults

## Optional

- [Format reference](${FORMAT_DOC_URL}): the full specification, including importer warnings and errors
- [Open the app](${PUBLIC_SITE_URL}?v2)
`;
}

/** Repo-relative path → generated content. */
export function aiGuideFiles(): Record<string, string> {
  return {
    "public/ai/storyboard-guide.md": storyboardGuideMarkdown(),
    "public/ai/storyboard-guide.html": storyboardGuideHtml(),
    "public/ai/presets.json": presetsJson(),
    "public/llms.txt": llmsTxt(),
  };
}

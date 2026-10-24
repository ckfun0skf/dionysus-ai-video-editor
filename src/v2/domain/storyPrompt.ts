/**
 * Planner prompts for the user's own AI (V2-CUT-06, v1.1 V2-SB-114). No AI calls are made by the app.
 * - `storyboardShortPrompt()` points the AI at the published guide (public/ai/storyboard-guide.md).
 * - `storyboardSystemPrompt()` is the full prompt: the same guide inlined, for AIs that can't open links.
 * The FORMAT, PRESETS, RULES and EXAMPLE sections are built here from the preset registry, so the guide, the prompts
 * and presets.json can't drift apart (aiGuide.test.ts fails when the published files are stale).
 */
import { FONTS, listPresets, type ParamSpec, type PresetDescriptor, type PresetKind } from "../registry";
import { CONNECTION_KINDS, DEFAULT_TRANSITION_SEC, SHOT_RENDERS, STORY_ASSET_TYPES, STORYBOARD_FORMAT, type StoryDoc } from "./storyJson";

/** Public site the guide files are deployed to (GitHub Pages). The short prompt always links here, also in dev. */
export const PUBLIC_SITE_URL = "https://ckfun0skf.github.io/dionysus-ai-video-editor/";
export const GUIDE_URL = `${PUBLIC_SITE_URL}ai/storyboard-guide.md`;
export const GUIDE_HTML_URL = `${PUBLIC_SITE_URL}ai/storyboard-guide.html`;
export const PRESETS_URL = `${PUBLIC_SITE_URL}ai/presets.json`;
export const FORMAT_DOC_URL = "https://github.com/ckfun0skf/dionysus-ai-video-editor/blob/main/docs/v2/STORYBOARD_FORMAT.md";
/** Spec version the guide describes (the format string stays `dionysus.storyboard/1`). */
export const FORMAT_REVISION = "1.1";

export const EXAMPLE_STORYBOARD: StoryDoc = {
  format: STORYBOARD_FORMAT,
  meta: {
    title: "The Lantern Keeper", logline: "An old keeper lights the last lantern before the storm.", aspect: "16:9", style: "Painterly realism, warm lantern light against cold blue dusk, 35mm film grain", language: "en",
    textStyles: { "keeper-title": { font: "serif", size: 0.1, color: "#fff4d6", bold: false } },
  },
  assets: [
    { id: "keeper", name: "The keeper", type: "character", aspect: "1:1", prompt: "Character sheet of an elderly lighthouse keeper, weathered face, grey beard, yellow oilskin coat, front and 3/4 views, neutral background, painterly realism", references: [], source: { type: "generate" }, qa: ["Same face and beard in every view", "Yellow oilskin coat, no logos", "No extra fingers or limbs"] },
    { id: "cliff", name: "Cliff and lighthouse", type: "location", aspect: "16:9", prompt: "Wide establishing shot of a lonely white lighthouse on a black basalt cliff at blue dusk, storm clouds rolling in, painterly realism", references: [], source: { type: "generate" }, qa: ["Lighthouse is white with a red cap", "Storm clouds on the left, calm sky on the right"] },
    { id: "lantern", name: "Brass lantern", type: "prop", aspect: "1:1", prompt: "Antique brass storm lantern with glass chimney, product shot on dark background", references: [], source: { type: "upload" }, qa: ["Glass chimney intact"] },
    { id: "s1-end", name: "Last frame of shot 1", type: "frame", aspect: "16:9", prompt: "", references: [], source: { type: "lastFrame", shot: "s1" }, qa: ["Keeper is at the door, lantern in his right hand"] },
  ],
  shots: [
    { id: "s1", title: "Climbing the cliff path", description: "The keeper walks up the cliff path toward the lighthouse door.", durationSec: 5, prompt: "The elderly keeper in a yellow oilskin coat walks up a cliff path toward a white lighthouse at dusk, carrying a brass lantern, wind in his coat, slow tracking shot from behind, ends with him reaching the door", assets: ["keeper", "cliff", "lantern"], qa: ["Keeper matches the character sheet", "Lantern stays in his right hand", "Ends at the lighthouse door"], camera: "Slow tracking shot from behind" },
    { id: "s2", title: "Lighting the lamp", description: "Inside the lamp room he lights the great lamp.", durationSec: 6, prompt: "Continuing from the first frame: the keeper steps inside, climbs to the lamp room and lights the great lamp with his brass lantern, warm light floods the room, medium shot", assets: ["s1-end", "keeper", "lantern"], qa: ["First frame matches the end of shot 1", "Lamp ignites with a warm glow", "No text or watermarks"], camera: "Medium shot, handheld", dialogue: "One more night.", captions: true },
    {
      id: "s3", title: "Beam across the storm", description: "The beam sweeps across the storm from outside; the title appears.", durationSec: 4,
      prompt: "Exterior wide shot, static camera: the lighthouse beam sweeps across dark storm clouds and crashing waves, rain starts, dramatic, calm dark sky in the upper half, no text or letters of any kind",
      assets: ["cliff"], qa: ["Beam is clearly visible", "Same lighthouse as the establishing shot", "No text or letters in the picture"], camera: "Static wide shot",
      layers: [{ id: "s3-title", type: "text", text: "THE LANTERN KEEPER", startSec: 1, endSec: 4, position: { x: 0.5, y: 0.3 }, textStyle: "keeper-title", anim: { in: "fade", out: "fade", durationSec: 0.8 } }],
      effects: [{ preset: "ken-burns", params: { zoom: 0.15 } }],
    },
  ],
  connections: [
    { from: "s1", to: "s2", kind: "continuity", note: "Shot 2 starts from the last frame of shot 1" },
    { from: "s2", to: "s3", kind: "cut", transition: { preset: "crossfade", params: { durationSec: 0.8 } } },
  ],
};

/** Preset kinds a storyboard can name, in guide order, with where each id goes. Text `effect`s and stickers are not storyboard fields. */
export const GUIDE_KINDS: { kind: PresetKind; title: string; usedIn: string }[] = [
  { kind: "textStyle", title: "Text styles", usedIn: `shots[].layers[].textStyle (default "plain")` },
  { kind: "textAnimIn", title: "Text animations in", usedIn: "shots[].layers[].anim.in" },
  { kind: "textAnimOut", title: "Text animations out", usedIn: "shots[].layers[].anim.out" },
  { kind: "textAnimLoop", title: "Text loops", usedIn: "shots[].layers[].anim.loop" },
  { kind: "videoEffect", title: "Video effects", usedIn: "shots[].effects[].preset" },
  { kind: "transition", title: "Transitions", usedIn: `connections[].transition.preset (params.durationSec, default ${DEFAULT_TRANSITION_SEC})` },
];

const num = (n: number) => String(Math.round(n * 1000) / 1000);
export function paramText(p: ParamSpec): string {
  const base = p.type === "number" ? `${p.key} ${num(p.min)}–${num(p.max)}, default ${num(p.default)}` : `${p.key} (${p.type}), default ${JSON.stringify(p.default)}`;
  return p.description ? `${base} (${p.description.replace(/\.$/, "")})` : base;
}
/** The look of a textStyle preset in a few words (font, colour, size), from its `data`. */
function styleLook(d: PresetDescriptor): string {
  const data = d.data ?? {};
  const bits = [typeof data.font === "string" ? `font ${data.font}` : "", typeof data.color === "string" ? `colour ${data.color}` : "", typeof data.size === "number" ? `size ${num(data.size)}` : ""].filter(Boolean);
  return bits.length ? ` Look: ${bits.join(", ")}.` : "";
}
export function presetLine(d: PresetDescriptor): string {
  const params = d.params.length ? ` Params: ${d.params.map(paramText).join("; ")}.` : "";
  return `- ${d.id}: ${d.description}${d.kind === "textStyle" ? styleLook(d) : ""}${params}`;
}

const FORMAT_SECTION = () => `{
  "format": "${STORYBOARD_FORMAT}",
  "meta": {
    "title": string, "logline"?: string, "synopsis"?: string, "style"?: string, "language"?: string,
    "aspect": "16:9" | "9:16" | "1:1" | "4:5" | "21:9",
    "textStyles"?: { "<style id>": TextStyle }   // one-off text looks for this storyboard; ids must not clash with preset ids
  },
  "assets": [ {
      "id": string,              // short unique id: letters, digits, "_", "-", "."
      "name": string,
      "type": ${STORY_ASSET_TYPES.map((t) => `"${t}"`).join(" | ")},
      "aspect"?: string,         // defaults to meta.aspect; character sheets often "1:1"
      "prompt": string,          // full, self-contained image/video generation prompt (required when source is "generate");
                                 // for "html": describes the animated component the user's AI will build as one .html file
      "references"?: string[],   // ids of other assets to feed as references when generating this one
      "source": "generate" | "upload" | { "type": "lastFrame", "shot": "<shot id>" },   // "html" can't use lastFrame
      "qa": string[]             // 2-5 concrete yes/no checks to verify the asset by looking
  } ],
  "shots": [ {                   // in playback order
      "id": string,
      "title": string,
      "description"?: string,
      "durationSec": number,     // 0.5–120; match what the video model can generate (usually 4–10)
      "prompt": string,          // full clip generation prompt; required for render "ai", keep one for "html"/"still" too
      "assets": string[],        // ids of the assets this clip uses (include "clip" when set)
      "camera"?: string,
      "dialogue"?: string,
      "qa": string[],            // 2-5 concrete yes/no checks for the clip
      "render"?: ${SHOT_RENDERS.map((r) => `"${r}"`).join(" | ")},   // default "ai" (generated clip); "html" = uploaded HTML animation; "still" = an image held on screen
      "clip"?: "<asset id>",     // required for "html" (an html asset) and "still" (an image asset)
      "captions"?: boolean,      // true = show "dialogue" as subtitles over the shot
      "layers"?: Layer[],        // drawn in list order (later = on top)
      "effects"?: [ { "preset": "<video effect id>", "params"?: { ... }, "startSec"?: number, "endSec"?: number } ]   // default: whole shot
  } ],
  "connections"?: [ {
      "from": "<shot id>", "to": "<shot id>",     // adjacent shots only
      "kind": ${CONNECTION_KINDS.map((k) => `"${k}"`).join(" | ")},
      "note"?: string,
      "transition"?: { "preset": "<transition id>", "params"?: { "durationSec"?: number } }   // omitted = cut; default ${DEFAULT_TRANSITION_SEC} s
  } ]
}

Layer (times in seconds from the shot start, 0 <= startSec < endSec <= durationSec; coordinates are 0-1 fractions of the frame from the top-left):
  Text:  { "id": string, "type": "text", "text": string, "startSec": number, "endSec": number,
           "position": { "x", "y" }            // text centre (preferred), OR
           "box": { "x", "y", "width", "height" },   // top-left + size; give exactly one of position / box
           "textStyle"?: "<text style id or meta.textStyles key>",
           "style"?: TextStyle,                // overrides the text style
           "anim"?: { "in"?: "<id>", "out"?: "<id>", "loop"?: "<id>", "durationSec"?: number } }
  Media: { "id": string, "type": "html" | "image" | "video", "asset": "<asset id>", "startSec": number, "endSec": number,
           "box": { "x", "y", "width", "height" } }
TextStyle: { "font"?: "<font id>", "size"?: number (fraction of frame height, 0-1), "color"?: "#rrggbb", "align"?: "left" | "center" | "right", "bold"?: boolean }
Text is one line per "\\n" and is never wrapped: keep lines short. Without "size", text uses the style's size (else 0.1), or fits the box height.`;

export function presetsSection(): string {
  const blocks = GUIDE_KINDS.map(({ kind, title, usedIn }) => `${title} — ${usedIn}:\n${listPresets(kind).map(presetLine).join("\n")}`);
  blocks.push(`Fonts — TextStyle "font":\n${FONTS.map((f) => `- ${f.id}: ${f.description}`).join("\n")}`);
  return `Only these ids may be used. Omitted params take their defaults.\n\n${blocks.join("\n\n")}`;
}

export const RULES = [
  "Every recurring character, location, prop and the overall style gets ONE reusable asset with a detailed prompt; shots reference these ids instead of repeating descriptions.",
  "Write prompts that work on their own (a generator only sees that prompt plus the reference images). Repeat key visual details (clothes, colours, lighting, style) in every prompt.",
  `When a shot must continue seamlessly from the previous one, add an asset with "type": "frame" and "source": { "type": "lastFrame", "shot": "<previous shot id>" }, use it in the next shot's "assets", and mark the connection "continuity". Never make a shot depend on its own last frame or create loops.`,
  `Use "source": "upload" for things the user already has (logos, real photos, products).`,
  "Every asset and shot gets 2–5 QA checks that a person can verify by looking: identity consistency, key props, framing, artefacts (extra fingers, warped text, watermarks).",
  `Keep ids short and stable (e.g. "hero", "kitchen", "s1", "s1-end"). Shots are listed in order; "connections" may be omitted for simple hard cuts.`,
  "Output valid JSON only: double quotes, no comments, no trailing commas.",
  "Every piece of on-screen text (titles, cards, labels, captions) goes into a text layer, never into a generation prompt. Prompts ask for clean, empty surfaces where the text will sit.",
  `Use "html" assets and "render": "html" only for animated, 3D or three.js graphics. Plain text is a text layer.`,
  `Transitions go on connections. Post camera moves (push-in etc.) and looks go in the shot's "effects", and the generation prompt then says "static camera".`,
  "Only use preset ids listed in the PRESETS section.",
  `Preset params use the units noted in brackets in the PRESETS section; "fade-in"/"fade-out" "length" is a fraction (0.05–1) of the effect's time range, not seconds.`,
  `"durationSec" should match what the video model can generate.`,
];
export const rulesSection = () => RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");

/** FORMAT, PRESETS, RULES and EXAMPLE; `heading` formats each section title (plain caps in the prompt, `##` in markdown). */
export function guideSections(heading: (title: string) => string): string {
  return [
    `${heading(`FORMAT ("${STORYBOARD_FORMAT}", v${FORMAT_REVISION})`)}\n\`\`\`\n${FORMAT_SECTION()}\n\`\`\``,
    `${heading("PRESETS")}\n${presetsSection()}`,
    `${heading("RULES")}\n${rulesSection()}`,
    `${heading("EXAMPLE")}\n\`\`\`json\n${JSON.stringify(EXAMPLE_STORYBOARD, null, 2)}\n\`\`\``,
  ].join("\n\n");
}

const ROLE = "You are a storyboard planner for AI video production. We have agreed a story together. Turn it into a production storyboard for the Dionysus video editor";

/** Full prompt: the whole guide inlined. Works with any AI, including ones that can't open links. */
export function storyboardSystemPrompt(): string {
  return `${ROLE} and reply with ONLY one JSON code block in the exact format below — no commentary before or after.

${guideSections((t) => t)}

Now write the storyboard JSON for our story.`;
}

/** Short prompt: links to the published guide; the AI asks for the full prompt when it can't open links. */
export function storyboardShortPrompt(): string {
  return `${ROLE}.

1. First read the storyboard guide: ${GUIDE_URL}
   It defines the JSON format ("${STORYBOARD_FORMAT}", v${FORMAT_REVISION}), the preset ids you may use, the rules and an example. Follow it exactly. (Same guide as a web page: ${GUIDE_HTML_URL} · presets as JSON: ${PRESETS_URL})
2. If you can't open links, don't guess the format. Reply only: "I can't open the guide — please paste the full Dionysus prompt." The user will then paste it (Dionysus → Storyboard → AI prompt → Full prompt).
3. Otherwise reply with ONLY one JSON code block containing the storyboard for our story — no commentary before or after.`;
}

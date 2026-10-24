/**
 * Planner prompts for the user's own AI (V2-CUT-06, v1.1 V2-SB-114). No AI calls are made by the app.
 * - `storyboardShortPrompt()` points the AI at the published guide (public/ai/storyboard-guide.md). Its links are built
 *   at runtime from the deployment the app is served from (siteUrl.ts), never from a hard-coded host.
 * - `storyboardSystemPrompt()` is the full prompt: the same guide inlined, for AIs that can't open links.
 * The FORMAT, PRESETS, RULES and EXAMPLE sections are built here from the preset registry, so the guide, the prompts
 * and presets.json can't drift apart (aiGuide.test.ts fails when the published files are stale).
 */
import { FONTS, listPresets, type ParamSpec, type PresetDescriptor, type PresetKind } from "../registry";
import { CONNECTION_KINDS, DEFAULT_TRANSITION_SEC, REFERENCE_ROLES, SHOT_RENDERS, STORY_ASSET_TYPES, STORYBOARD_FORMAT, type StoryDoc } from "./storyJson";
import { runtimeAiLinks, type AiLinks } from "./siteUrl";

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
    { id: "s1", title: "Climbing the cliff path", description: "The keeper walks up the cliff path toward the lighthouse door.", durationSec: 5, prompt: "References:\nImage 1 (The keeper): reference only, not a frame: keep his face, beard and yellow oilskin coat.\nImage 2 (Cliff and lighthouse): reference only, not a frame: the lighthouse, cliff and dusk colours only; do not copy its wide framing.\nImage 3 (Brass lantern): reference only: the lantern's brass and glass only.\nNo image is the start frame. Framing: starts as a medium-wide tracking shot from behind on the path, ends close behind him at the lighthouse door.\n\nThe elderly keeper in a yellow oilskin coat walks up a cliff path toward a white lighthouse at dusk, carrying a brass lantern, wind in his coat, slow tracking shot from behind, ends with him reaching the door", assets: ["keeper", "cliff", "lantern"], qa: ["Keeper matches the character sheet", "Lantern stays in his right hand", "Ends at the lighthouse door"], camera: "Slow tracking shot from behind" },
    { id: "s2", title: "Lighting the lamp", description: "Inside the lamp room he lights the great lamp.", durationSec: 6, prompt: "References:\nImage 1 (Last frame of shot 1): START FRAME: the clip opens on exactly this image.\nImage 2 (The keeper): reference only, not a frame: keep his face, beard and coat.\nImage 3 (Brass lantern): reference only: the lantern's brass and glass only.\nFraming: opens on the start frame at the door, ends on a medium shot of the keeper beside the lit lamp.\n\nContinuing from the first frame: the keeper steps inside, climbs to the lamp room and lights the great lamp with his brass lantern, warm light floods the room, medium shot", assets: ["s1-end", "keeper", "lantern"], references: [{ asset: "s1-end", role: "start-frame" }, { asset: "keeper", role: "identity" }, { asset: "lantern", role: "detail", note: "brass and glass only" }], qa: ["First frame matches the end of shot 1", "Lamp ignites with a warm glow", "No text or watermarks"], camera: "Medium shot, handheld", dialogue: "One more night.", captions: true },
    {
      id: "s3", title: "Beam across the storm", description: "The beam sweeps across the storm from outside; the title appears.", durationSec: 4, genDurationSec: 6,
      prompt: "References:\nImage 1 (Cliff and lighthouse): reference only, not a frame: the same lighthouse and cliff; match its look.\nNo image is the start frame. Framing: one static exterior wide shot from first frame to last.\n\nExterior wide shot, static camera: the lighthouse beam sweeps across dark storm clouds and crashing waves, rain starts, dramatic, calm dark sky in the upper half, no text or letters of any kind",
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
/** The descriptor's optional planner hints (V2-FX-MOD `ai`): when to use it, when not to, example params. */
function aiHints(d: PresetDescriptor): string {
  const a = d.ai;
  if (!a) return "";
  const dot = (t: string) => t.replace(/\.?$/, ".");
  return [a.use ? ` Use for: ${dot(a.use)}` : "", a.avoid ? ` Avoid: ${dot(a.avoid)}` : "", a.example && Object.keys(a.example).length ? ` Example params: ${JSON.stringify(a.example)}.` : ""].join("");
}
export function presetLine(d: PresetDescriptor): string {
  const params = d.params.length ? ` Params: ${d.params.map(paramText).join("; ")}.` : "";
  return `- ${d.id}: ${d.description}${d.kind === "textStyle" ? styleLook(d) : ""}${params}${aiHints(d)}`;
}

const REFERENCE_ROLES_TXT = REFERENCE_ROLES.map((r) => `"${r}"`).join(" | ");
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
      "references"?: (string | { "asset": "<asset id>", "role"?: "start-frame" | "identity" | "look" | "detail", "note"?: string })[],
                                 // other assets to attach when generating this one, IN THIS ORDER (Image 1, Image 2 …); a plain id
                                 // = role from its type; for an image "start-frame" means the base image to edit (no end-frame)
      "source": "generate" | "upload" | { "type": "lastFrame", "shot": "<shot id>" },   // "html" can't use lastFrame
      "qa": string[]             // 2-5 concrete yes/no checks to verify the asset by looking
  } ],
  "shots": [ {                   // in playback order
      "id": string,
      "title": string,
      "description"?: string,
      "durationSec": number,     // 0.5–120; how long the shot stays on screen in the final edit, set by the story's pacing (NOT by the video model's limits)
      "genDurationSec"?: number, // only when the video model must render longer (minimum or fixed lengths, e.g. 6/10/15 s): the length to generate; > durationSec; the upload is trimmed to durationSec
      "prompt": string,          // full clip generation prompt; required for render "ai", keep one for "html"/"still" too
      "assets": string[],        // ids of the assets this clip uses (include "clip" when set)
      "references"?: [ { "asset": "<asset id>", "role": ${REFERENCE_ROLES_TXT}, "note"?: string } ],
                                 // the images to attach to the clip generation IN THIS ORDER (Image 1, Image 2 …) and how to use each;
                                 // omitted = "assets" order with roles from the type (frame → start-frame, character → identity,
                                 // style → look, others → detail); at most one "start-frame" and one "end-frame"
      "keyframe"?: { "prompt": string, "references"?: [ "<asset id>" | { "asset", "role"?, "note"? } ], "qa"?: string[] },
                                 // render "ai" only: the opening still to generate FIRST; the clip animates from it (Image 1, start frame)
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
  `"durationSec" is how long the shot stays on screen in the final edit (its planned edit length). Decide it from the story's pacing, NOT from what the video model can generate, and never put the planned length only in "description" or notes. If the video model can't render that length (it has a minimum or fixed lengths, e.g. 6, 10 or 15 s), keep "durationSec" at the planned length and set "genDurationSec" to the length to ask the model for; it must be greater than "durationSec" (omit it when they are equal). When the clip is uploaded the app trims it to "durationSec" and the user picks which part to keep. Example: a 4 s beat with a model that renders 6 s minimum: "durationSec": 4, "genDurationSec": 6.`,
  `Every clip prompt starts with a "References:" block that numbers the images attached to the clip in the order of the shot's "references" (else its "assets"): "Image 1 (<asset name>): …", one line each, saying explicitly whether the image is the START FRAME (or END FRAME) or only a reference, and what to take from it (identity, overall look, or materials and colours only, not its framing or wide view). Then state the framing from the first frame to the last. Set "references" with roles whenever the order or use is not obvious from the asset types.`,
  `A transition in "connections" overlaps the two shots, centred on the cut: it adds no time and eats half its length from the end of the "from" shot and half from the start of the "to" shot. It is clamped to half the shorter of the two shots. For example, a 0.8 s transition out of a 2.5 s shot blends the last 0.4 s of that shot with the first 0.4 s of the next, and the total length stays the same; keep transitions short on short shots so their key action isn't covered.`,
  `For an "identity" reference prefer a single clean portrait or character image (one view, plain background) over a multi-view character sheet: the sheet's layout (several poses, panels, labels) can leak into the generated frames.`,
  `An asset made from other assets lists them in its "references" in attach order, as objects with a "role" when the use is not obvious from the type. Its prompt then starts with the same numbered "References:" block as a clip prompt; for an image, "start-frame" means the base image to edit (there is no end frame). Example: a close-up of the keeper's lantern on a table: "references": [{ "asset": "lantern", "role": "detail", "note": "brass and glass only" }, "keeper"], prompt "References:\\nImage 1 (Brass lantern): reference only: materials, colours and objects only; brass and glass only.\\nImage 2 (The keeper): reference only: keep this identity (face, body, clothes).\\n\\nClose-up of …".`,
  `Keyframe then animate: when the opening composition matters (a character's pose, a precise layout, a hero product shot), give the "ai" shot a "keyframe": { "prompt", "references", "qa" }. The app turns it into an image asset "<shot id>.keyframe" that is made first, then attached to the clip as Image 1, the START FRAME (do not also give the shot a "start-frame" reference). The keyframe prompt describes one still image (with its own "References:" block, as for an asset); the clip prompt then describes only the motion from that frame. Example: "keyframe": { "prompt": "References:\\nImage 1 (The keeper): reference only: keep this identity (face, body, clothes).\\n\\nThe keeper stands by the lantern, lit from below …", "references": ["keeper", "lighthouse"], "qa": ["The keeper's face matches the reference"] }, clip prompt "References:\\nImage 1 (Keyframe · …): START FRAME …\\n\\nShe slowly turns from the lantern …".`,
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
export function storyboardShortPrompt(links: AiLinks = runtimeAiLinks()): string {
  return `${ROLE}.

1. First read the storyboard guide: ${links.guide}
   It defines the JSON format ("${STORYBOARD_FORMAT}", v${FORMAT_REVISION}), the preset ids you may use, the rules and an example. Follow it exactly. (Same guide as a web page: ${links.guideHtml} · presets as JSON: ${links.presets})
2. If you can't open links, don't guess the format. Reply only: "I can't open the guide — please paste the full Dionysus prompt." The user will then paste it (Dionysus → Storyboard → AI prompt → Full prompt).
3. "durationSec" is the planned on-screen length of the shot in the edit, not what the video model can render. If the model must render longer (e.g. 6 s minimum), keep "durationSec" at the planned length and put the length to generate in "genDurationSec" (e.g. "durationSec": 4, "genDurationSec": 6).
4. Otherwise reply with ONLY one JSON code block containing the storyboard for our story — no commentary before or after.`;
}

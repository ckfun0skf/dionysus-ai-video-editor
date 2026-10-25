/**
 * Planner prompts for the user's own AI (V2-CUT-06, v1.1 V2-SB-114). No AI calls are made by the app.
 * - `storyboardShortPrompt()` points the AI at the published guide (public/ai/storyboard-guide.md). Its links are built
 *   at runtime from the deployment the app is served from (siteUrl.ts), never from a hard-coded host.
 * - `storyboardSystemPrompt()` is the full prompt: the same guide inlined, for AIs that can't open links.
 * The FORMAT, PRESETS, RULES and EXAMPLE sections are built here from the preset registry, so the guide, the prompts
 * and presets.json can't drift apart (aiGuide.test.ts fails when the published files are stale).
 */
import { FONTS, listPresets, type ParamSpec, type PresetDescriptor, type PresetKind } from "../registry";
import { CONNECTION_KINDS, DEFAULT_TRANSITION_SEC, REFERENCE_ROLES, SHOT_RENDERS, STORY_ASSET_TYPES, STORYBOARD_FORMAT, storyDocJson, type StoryDoc } from "./storyJson";
import { runtimeAiLinks, type AiLinks } from "./siteUrl";

/** Spec version the guide describes (the format string stays `dionysus.storyboard/1`). */
export const FORMAT_REVISION = "1.1";

/**
 * The guide's worked example (V2-SB-GUIDE-GENERIC): short and story-neutral, but it uses every part of the format a
 * planner usually needs: reusable assets, reference roles, last-frame continuity, genDurationSec, a text layer with a
 * style and animation, video effects and a transition. It must import with no warnings (aiGuide.test.ts).
 */
export const EXAMPLE_STORYBOARD: StoryDoc = {
  format: STORYBOARD_FORMAT,
  meta: {
    title: "First Light", logline: "A cyclist reaches the hilltop just as the sun rises.", aspect: "16:9", style: "Natural cinematic realism, soft golden-hour light, shallow depth of field", language: "en",
    textStyles: { "title-card": { font: "serif", size: 0.09, color: "#fff6e0" } },
  },
  assets: [
    { id: "rider", name: "The rider", type: "character", aspect: "1:1", prompt: "Portrait of a young woman cyclist, short dark hair, red cycling jacket, grey helmet, plain light background, natural cinematic realism", references: [], source: { type: "generate" }, qa: ["Red jacket and grey helmet", "Face clearly visible", "No logos or text"] },
    { id: "hill", name: "Hill road", type: "location", aspect: "16:9", prompt: "Empty winding road up a grassy hill before sunrise, mist in the valley, soft blue-gold sky, natural cinematic realism", references: [], source: { type: "generate" }, qa: ["Road winds up to the hilltop", "No people or vehicles"] },
    {
      id: "text-card", name: "Text card", type: "html", aspect: "16:9", prompt: "Elegant animated text card: the words fade up letter by letter in a warm serif over a deep blue-to-black gradient (or over nothing when \"background\" is \"none\"), hold, then fade out over the last 0.5 s. Text centred, or small in the lower left when \"place\" is \"lower-left\". Calm, cinematic, no other graphics.", references: [], source: { type: "generate" }, qa: ["The text is the clip's \"text\" param, fully readable", "Nothing but the text on a transparent background when \"background\" is \"none\""],
      params: {
        text: { type: "text", default: "Title", label: "Text" },
        color: { type: "color", default: "#fff6e0", label: "Text colour" },
        background: { type: "select", options: ["dark", "none"], default: "dark", label: "Background", description: "dark = full-frame card; none = transparent, for a layer over a shot" },
        place: { type: "select", options: ["center", "lower-left"], default: "center", label: "Placement" },
      },
    },
    { id: "s1-end", name: "Last frame of shot 1", type: "frame", aspect: "16:9", prompt: "", references: [], source: { type: "lastFrame", shot: "s1" }, qa: ["Rider is near the hilltop"] },
  ],
  shots: [
    { id: "s1", title: "The climb", description: "She climbs the last stretch of the hill road.", durationSec: 4, prompt: "References:\nImage 1 (The rider): reference only, not a frame: keep her face, red jacket and grey helmet.\nImage 2 (Hill road): reference only, not a frame: the road, hill and sky colours; do not copy its framing.\nNo image is the start frame. Framing: side tracking shot, she rides into frame and ends near the hilltop.\n\nThe cyclist in a red jacket pedals hard up a winding hill road before sunrise, mist below, side tracking shot", assets: ["rider", "hill"], qa: ["Rider matches the portrait", "Ends near the hilltop"], camera: "Side tracking shot",
      layers: [{ id: "s1-time", type: "html", asset: "text-card", startSec: 0.5, endSec: 3, box: { x: 0, y: 0, width: 1, height: 1 }, params: { text: "5:58 AM", background: "none", place: "lower-left" } }],
    },
    { id: "s2", title: "The top", description: "She reaches the top and stops.", durationSec: 3, genDurationSec: 5, prompt: "References:\nImage 1 (Last frame of shot 1): START FRAME: the clip opens on exactly this image.\nImage 2 (The rider): reference only, not a frame: keep her face, jacket and helmet.\nFraming: opens on the start frame, ends on a medium shot of her stopping at the top.\n\nContinuing from the first frame: the cyclist reaches the hilltop, stops and looks toward the horizon, breathing hard", assets: ["s1-end", "rider"], references: [{ asset: "s1-end", role: "start-frame" }, { asset: "rider", role: "identity" }], qa: ["First frame matches the end of shot 1", "Same jacket and helmet"] },
    {
      id: "s3", title: "Sunrise", description: "The sun rises over the valley; title card.", durationSec: 4, prompt: "References:\nImage 1 (Hill road): reference only, not a frame: the same hill and valley.\nNo image is the start frame. Framing: one static wide shot.\n\nStatic wide shot from behind the cyclist on the hilltop as the sun rises over the misty valley, clear empty sky in the upper third, no text", assets: ["hill"], qa: ["Sun is rising", "Empty sky in the upper third for the title"], camera: "Static wide shot",
      layers: [{ id: "s3-title", type: "text", text: "FIRST LIGHT", startSec: 1, endSec: 4, position: { x: 0.5, y: 0.25 }, textStyle: "title-card", anim: { in: "fade", out: "fade", durationSec: 0.6 } }],
      effects: [{ preset: "ken-burns", params: { zoom: 0.1 } }, { preset: "glow", params: { strength: 0.4 } }],
    },
    { id: "s4", title: "End card", description: "Text-only card: the same text card asset with its own words.", durationSec: 2, prompt: "References:\nNo images: this shot is the \"text-card\" HTML clip.\n\nEnd card reading THE END", assets: ["text-card"], qa: ["Reads THE END", "Same look as the time caption in shot 1"], render: "html", clip: "text-card", params: { text: "THE END" } },
  ],
  connections: [
    { from: "s1", to: "s2", kind: "continuity", note: "Shot 2 starts from the last frame of shot 1" },
    { from: "s2", to: "s3", kind: "cut", transition: { preset: "crossfade", params: { durationSec: 0.6 } } },
    { from: "s3", to: "s4", kind: "cut" },
  ],
};

/** The example as published (guide, full prompt, "Copy example JSON"): sources in the documented form ("generate"). */
export const exampleStoryboardJson = () => storyDocJson(EXAMPLE_STORYBOARD);

/** Preset kinds a storyboard can name, in guide order, with where each id goes. Stickers are not storyboard fields. */
export const GUIDE_KINDS: { kind: PresetKind; title: string; usedIn: string }[] = [
  { kind: "textStyle", title: "Text styles", usedIn: `shots[].layers[].textStyle (default "plain")` },
  { kind: "effect", title: "Text effects", usedIn: `shots[].layers[].style.effect and meta.textStyles[].effect, coloured by "effectColor" (default "none")` },
  { kind: "textAnimIn", title: "Text animations in", usedIn: "shots[].layers[].anim.in" },
  { kind: "textAnimOut", title: "Text animations out", usedIn: "shots[].layers[].anim.out" },
  { kind: "textAnimLoop", title: "Text loops", usedIn: "shots[].layers[].anim.loop" },
  { kind: "videoEffect", title: "Video effects", usedIn: "shots[].effects[].preset" },
  { kind: "blend", title: "Blend modes", usedIn: `shots[].layers[].blend (default "normal"), with "opacity" 0-1 (default 1)` },
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
                                 // for "html": a design brief for the AI that writes the clip as one .html file (see RULES)
      "references"?: (string | { "asset": "<asset id>", "role"?: "start-frame" | "identity" | "look" | "detail", "note"?: string })[],
                                 // other assets to attach when generating this one, IN THIS ORDER (Image 1, Image 2 …); a plain id
                                 // = role from its type; for an image "start-frame" means the base image to edit (no end-frame)
      "source": "generate" | "upload" | { "type": "lastFrame", "shot": "<shot id>" },
                                 // plain strings "generate" / "upload" (default "generate"); an object only for lastFrame; "html" and "audio" can't use lastFrame
      "qa": string[],            // 2-5 concrete yes/no checks to verify the asset by looking
      "params"?: { "<key>": Param }   // "html" only: values the clip exposes, set per use by shots and layers (see RULES)
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
                                 // render "ai" only: the opening still to generate FIRST; the clip animates from it. The clip's images are then
                                 // Image 1 = the keyframe (start frame), Image 2 … = the shot's "references", then its other "assets" (RULES)
      "camera"?: string,
      "dialogue"?: string,
      "qa": string[],            // 2-5 concrete yes/no checks for the clip
      "render"?: ${SHOT_RENDERS.map((r) => `"${r}"`).join(" | ")},   // default "ai" (generated clip); "html" = uploaded HTML animation; "still" = an image held on screen
      "clip"?: "<asset id>",     // required for "html" (an html asset) and "still" (an image asset)
      "params"?: { "<key>": value },   // render "html" only: this shot's values for the clip asset's "params"
      "captions"?: boolean,      // true = show "dialogue" as subtitles over the shot
      "layers"?: Layer[],        // drawn in list order (later = on top)
      "effects"?: [ { "preset": "<video effect id>", "params"?: { ... }, "startSec"?: number, "endSec"?: number } ]   // default: whole shot
  } ],
  "connections"?: [ {
      "from": "<shot id>", "to": "<shot id>",     // adjacent shots only
      "kind": ${CONNECTION_KINDS.map((k) => `"${k}"`).join(" | ")},
      "note"?: string,
      "transition"?: { "preset": "<transition id>", "params"?: { "durationSec"?: number } }   // omitted = cut; default ${DEFAULT_TRANSITION_SEC} s
  } ],
  "audio"?: [ {                  // voiceover, music beds and sound effects, placed by shot (assets of type "audio")
      "id"?: string, "asset": "<audio asset id>", "kind": "voiceover" | "music" | "sfx",
      "from": "<shot id>",       // the shot it starts in
      "atSec"?: number,          // seconds into "from" (default 0)
      "to"?: "<shot id>",        // plays to the end of this shot (same as or after "from"); omitted = the audio's own length
      "durationSec"?: number,    // stop after this many seconds (with "to": whichever comes first); audio is never looped
      "volume"?: number,         // 0-1; default music 0.35, voiceover and sfx 1
      "fadeInSec"?: number, "fadeOutSec"?: number   // default music 1 s each, others 0
  } ]
}

Layer (times in seconds from the shot start, 0 <= startSec < endSec <= durationSec; coordinates are 0-1 fractions of the frame from the top-left):
  Text:  { "id": string, "type": "text", "text": string, "startSec": number, "endSec": number,
           "position": { "x", "y" }            // text centre (preferred), OR
           "box": { "x", "y", "width", "height" },   // top-left + size; give exactly one of position / box
           "textStyle"?: "<text style id or meta.textStyles key>",
           "style"?: TextStyle,                // overrides the text style
           "anim"?: { "in"?: "<id>", "out"?: "<id>", "loop"?: "<id>", "durationSec"?: number },
           "blend"?: "<blend id>", "opacity"?: number (0-1, default 1),
           "follow"?: "frame" | "shot" }      // default "frame" (fixed); "shot" = moves with the shot's zoom/pan effects
  Media: { "id": string, "type": "html" | "image" | "video", "asset": "<asset id>", "startSec": number, "endSec": number,
           "box": { "x", "y", "width", "height" }, "blend"?: "<blend id>", "opacity"?: number (0-1), "follow"?: "frame" | "shot",
           "params"?: { "<key>": value } }   // "html" layers only: this layer's values for the asset's "params"
Param (an html asset's exposed value; "default" is required and must be valid):
  { "type": "text", "default": string } | { "type": "number", "default": number, "min"?: number, "max"?: number, "step"?: number }
  | { "type": "color", "default": "#rrggbb" } | { "type": "boolean", "default": boolean } | { "type": "select", "options": string[], "default": string }
  each may add "label"?: string (shown in the editor) and "description"?: string
TextStyle: { "font"?: "<font id>", "size"?: number (fraction of frame height, 0-1), "color"?: "#rrggbb", "align"?: "left" | "center" | "right", "bold"?: boolean,
             "italic"?: boolean, "letterSpacing"?: number (em, -0.2-1), "lineHeight"?: number (0.8-3),
             "strokeWidth"?: number (outline, fraction of font size, 0-0.3), "strokeColor"?: "#rrggbb",
             "shadow"?: { "color", "blur", "x", "y" } | null (fractions of font size), "background"?: { "color", "opacity" } | null,
             "effect"?: "<text effect id>" | "none", "effectColor"?: "#rrggbb" }
Text is one line per "\\n" and is never wrapped: keep lines short. Without "size", text uses the style's size (else 0.1), or fits the box height.`;

/** Categories of `kind` in registry order (first appearance), each with its presets. */
export function presetsByCategory(kind: PresetKind): { category: string; presets: PresetDescriptor[] }[] {
  const groups = new Map<string, PresetDescriptor[]>();
  for (const d of listPresets(kind)) {
    const c = d.category?.trim() || "Other";
    groups.set(c, [...(groups.get(c) ?? []), d]);
  }
  return [...groups].map(([category, presets]) => ({ category, presets }));
}

/** The preset catalogue (V2-SB-GUIDE-GENERIC): generated from the descriptors, grouped by kind, then by category. */
export function presetsSection(): string {
  const blocks = GUIDE_KINDS.map(({ kind, title, usedIn }) => {
    const groups = presetsByCategory(kind).map(({ category, presets }) => `[${category}]\n${presets.map(presetLine).join("\n")}`);
    return `${title} — ${usedIn}:\n${groups.join("\n")}`;
  });
  blocks.push(`Fonts — TextStyle "font":\n${FONTS.map((f) => `- ${f.id}: ${f.description}`).join("\n")}`);
  return `Only these ids may be used. Omitted params take their defaults. Within each kind, presets are grouped by [category].\n\n${blocks.join("\n\n")}`;
}

/** How a storyboard becomes a video, for planners that have never seen Dionysus. Story-neutral; names no preset ids. */
export const HOW_IT_WORKS = `A storyboard is one JSON object with three lists:
- "assets": everything that must exist before the clips can be made: characters, locations, props, a style frame, uploads, and "frame" assets taken from the last frame of a shot for continuity. Each asset has its own self-contained generation prompt, the other assets it is made from ("references") and QA checks.
- "shots": the clips of the final edit in playback order. Each has a clip generation prompt, the assets it uses (attached to the generator as numbered images), its on-screen length ("durationSec") and, optionally, text layers and video effects that the editor draws on top.
- "connections": what happens between two adjacent shots: a plain cut, continuity from the previous shot's last frame, or a transition preset.
The user imports the JSON into Dionysus, which checks it and lists every problem with its path. The app then walks the user through generating (with their own AI tools and your prompts) or uploading each asset and clip, in dependency order. Finally the editor assembles the timeline: shots in order, trimmed to "durationSec", with your text layers, effects and transitions applied.
So split the work: generation prompts describe only the picture and its motion; on-screen text, post camera moves, looks and transitions are done by the editor with presets and stay out of the prompts.`;

/** Generic guidance for picking presets; the per-preset "Use for" / "Avoid" hints in the catalogue come from the descriptors. */
export const CHOOSING_PRESETS = `Presets are the editor's built-in tools: video effects on a shot, transitions on connections, text styles and text animations on text layers. Each one in the PRESETS section has an id, a one-line description, its params (range, default and unit) and sometimes "Use for" / "Avoid" hints.
- Choose by purpose: match the description and hints to what the moment needs (mood, energy, what the viewer should notice), not the name alone.
- Less is more: most cuts need no transition (omit it). Use one or two transition styles for the whole video and save the energetic ones for beats that call for them. Use at most one or two effects per shot.
- Effects are post-production: use them for camera moves the clip doesn't have, colour or light looks, and fades. When an effect adds the camera move, the generation prompt says "static camera".
- Stay consistent: give recurring text one look (a text style preset or a "meta.textStyles" entry) and the same in/out animation throughout; keep loops for short emphasis.
- Params: omit them to use the defaults and set only what you need, within the listed range and unit. Unknown ids, unknown params and out-of-range values are reported on import.`;

/**
 * Planner rules (V2-SB-GUIDE-GENERIC). Their numbers are public: STORYBOARD_FORMAT.md, users and other AIs cite them
 * ("RULE 13"), so the list is append-only: add new rules at the end, never reorder or delete; to retire a rule,
 * rewrite its text. aiGuide.test.ts pins the key order. Rules stay story-neutral (no names from an example story).
 */
export const RULE_LIST: readonly { key: string; text: string }[] = [
  { key: "reusable-assets", text: "Every recurring character, location, prop and the overall style gets ONE reusable asset with a detailed prompt; shots reference these ids instead of repeating descriptions." },
  { key: "standalone-prompts", text: "Write prompts that work on their own (a generator only sees that prompt plus the reference images). Repeat key visual details (clothes, colours, lighting, style) in every prompt." },
  { key: "last-frame-continuity", text: `When a shot must continue seamlessly from the previous one, add an asset with "type": "frame" and "source": { "type": "lastFrame", "shot": "<previous shot id>" }, use it in the next shot's "assets", and mark the connection "continuity". Never make a shot depend on its own last frame or create loops.` },
  { key: "uploads", text: `Use "source": "upload" for things the user already has (logos, real photos, products).` },
  { key: "qa-checks", text: "Every asset and shot gets 2–5 QA checks that a person can verify by looking: identity consistency, key props, framing, artefacts (extra fingers, warped text, watermarks)." },
  { key: "ids", text: `Keep ids short and stable (e.g. "hero", "kitchen", "s1", "s1-end"). Shots are listed in order; "connections" may be omitted for simple hard cuts.` },
  { key: "valid-json", text: "Output valid JSON only: double quotes, no comments, no trailing commas." },
  { key: "text-in-layers", text: "Every piece of on-screen text (titles, cards, labels, captions) goes into a text layer (or the params of a reusable html text card, RULE 24), never into a generation prompt. Prompts ask for clean, empty surfaces where the text will sit." },
  { key: "html-only-for-graphics", text: `Use "html" assets and "render": "html" only for animated, 3D or three.js graphics. Plain text over a shot is a text layer; a designed title or text-only card is one reusable "html" asset with params (RULE 24).` },
  { key: "transitions-and-effects", text: `Transitions go on connections. Post camera moves (push-in etc.) and looks go in the shot's "effects", and the generation prompt then says "static camera".` },
  { key: "known-presets", text: "Only use preset ids listed in the PRESETS section." },
  { key: "param-units", text: `Preset params use the units noted in brackets in the PRESETS section; "fade-in"/"fade-out" "length" is a fraction (0.05–1) of the effect's time range, not seconds.` },
  { key: "duration", text: `"durationSec" is how long the shot stays on screen in the final edit (its planned edit length). Decide it from the story's pacing, NOT from what the video model can generate, and never put the planned length only in "description" or notes. If the video model can't render that length (it has a minimum or fixed lengths, e.g. 6, 10 or 15 s), keep "durationSec" at the planned length and set "genDurationSec" to the length to ask the model for; it must be greater than "durationSec" (omit it when they are equal). When the clip is uploaded the app trims it to "durationSec" and the user picks which part to keep. Example: a 4 s beat with a model that renders 6 s minimum: "durationSec": 4, "genDurationSec": 6. Montage (a quick run of glimpses, e.g. three 2 s moments of a journey) needs no special field: write it as consecutive short shots (about 1-3 s each, e.g. three shots with "durationSec": 2), each with its own prompt, assets and QA checks, joined by plain cuts (omit their connections, or keep any transition very short, RULE 15). Use "genDurationSec" when the model can't render that short, keep the style and references the same across the run, and tie it together with one audio cue (a music bed or voiceover "from" the first montage shot "to" the last) rather than a longer shot.` },
  { key: "references-block", text: `Every clip prompt starts with a "References:" block that numbers the images attached to the clip in the order of the shot's "references" (else its "assets"): "Image 1 (<asset name>): …", one line each, saying explicitly whether the image is the START FRAME (or END FRAME) or only a reference, and what to take from it (identity, overall look, or materials and colours only, not its framing or wide view). Then state the framing from the first frame to the last. Set "references" with roles whenever the order or use is not obvious from the asset types.` },
  { key: "transition-overlap", text: `A transition in "connections" overlaps the two shots, centred on the cut: it adds no time and eats half its length from the end of the "from" shot and half from the start of the "to" shot. It is clamped to half the shorter of the two shots. For example, a 0.8 s transition out of a 2.5 s shot blends the last 0.4 s of that shot with the first 0.4 s of the next, and the total length stays the same; keep transitions short on short shots so their key action isn't covered.` },
  { key: "identity-portrait", text: `For an "identity" reference prefer a single clean portrait or character image (one view, plain background) over a multi-view character sheet: the sheet's layout (several poses, panels, labels) can leak into the generated frames.` },
  { key: "asset-references", text: `An asset made from other assets lists them in its "references" in attach order, as objects with a "role" when the use is not obvious from the type. Its prompt then starts with the same numbered "References:" block as a clip prompt; for an image, "start-frame" means the base image to edit (there is no end frame). Example: a close-up of the hero holding a mug: "references": [{ "asset": "mug", "role": "detail", "note": "glaze and colour only" }, "hero"], prompt "References:\\nImage 1 (Blue mug): reference only: materials, colours and objects only; glaze and colour only.\\nImage 2 (Hero): reference only: keep this identity (face, body, clothes).\\n\\nClose-up of …".` },
  { key: "keyframe", text: `Keyframe then animate: when the opening composition matters (a character's pose, a precise layout, a hero product shot), give the "ai" shot a "keyframe": { "prompt", "references", "qa" }. The app turns it into an image asset "<shot id>.keyframe" named "Keyframe · <shot title>" that is made first. Numbering of the clip's images when a shot has a keyframe: Image 1 is always the keyframe, the START FRAME; Image 2, 3 … are the shot's "references" in their order, then the shot's other "assets" in "assets" order (the numbering without a keyframe, shifted by one). Do not also give the shot a "start-frame": one in "references", or an inferred one (a "frame" or last-frame asset), is attached as details only. The keyframe's own "references" are numbered separately, from Image 1, in the keyframe prompt; they are attached to the clip only if they are also in the shot's "assets" or "references". The keyframe prompt describes one still image (with its own "References:" block, as for an asset); the clip prompt starts with a "References:" block in the clip numbering above and then describes only the motion from that frame. Example: "keyframe": { "prompt": "References:\\nImage 1 (Hero): reference only: keep this identity (face, body, clothes).\\nImage 2 (Café): reference only: materials, colours and objects only.\\n\\nThe hero sits at a café table, both hands around a blue mug …", "references": ["hero", "cafe"], "qa": ["The hero's face matches the reference"] } with the shot's "assets": ["hero", "cafe"], clip prompt "References:\\nImage 1 (Keyframe · Morning coffee): START FRAME: the clip opens on exactly this image.\\nImage 2 (Hero): reference only, not a frame: keep this identity.\\nImage 3 (Café): reference only, not a frame: materials and colours only.\\n\\nShe slowly lifts the mug …".` },
  { key: "audio", text: `Audio: put each voiceover, music bed or sound effect in "audio" as a cue on an asset of type "audio" (source "generate" with a prompt for the user's voice/music/sound tool, e.g. the exact voiceover script and voice, or "upload"). "from" is the shot it starts in, "atSec" the offset into that shot, "to" the last shot it plays under. A music bed usually runs "from" the first shot "to" the last with "volume" 0.2-0.4 under speech; a voiceover spans the shots it describes; a sound effect sits at the moment in one shot ("atSec") with no "to". Example: { "asset": "score", "kind": "music", "from": "s1", "to": "s6", "volume": 0.3, "fadeOutSec": 2 }, { "asset": "door-slam", "kind": "sfx", "from": "s4", "atSec": 1.2 }. Do not put spoken lines that the video model renders (shot "dialogue") into a voiceover too.` },
  { key: "layer-follow", text: `Layers stay fixed to the frame by default: a shot's video effects (e.g. "ken-burns" zoom and pan) move only the picture, so titles, labels and logos stay put and readable. Give a layer "follow": "shot" only when it belongs to the scene and must move with the picture, e.g. a name tag pinned to a sign or a label on an object while the shot slowly zooms: { "id": "tag", "type": "text", "text": "ROOM 12", "startSec": 0, "endSec": 4, "position": { "x": 0.62, "y": 0.4 }, "follow": "shot" }. It only has an effect when an effect moves or zooms the shot while the layer is on screen.` },
  { key: "text-style-extras", text: `Keep text readable on any picture: give light text an outline ("strokeWidth" about 0.04-0.08 with a dark "strokeColor"), a soft "shadow", or a "background" box (captions, lower thirds). Use "letterSpacing" (in em) for airy titles, "lineHeight" for multi-line cards, "italic" for emphasis, and a text "effect" with "effectColor" only for stylised titles. Sizes and offsets are fractions of the font size; null removes a style's shadow or background. Example: "style": { "color": "#ffffff", "strokeWidth": 0.06, "strokeColor": "#000000", "shadow": { "color": "#000000", "blur": 0.3, "x": 0, "y": 0.04 } }. Put a look used on several layers into "meta.textStyles" once.` },
  { key: "blend-overlays", text: `For overlays (light leaks, flares, dust, film grain, paper or ink textures) use an image or video layer with a "blend" mode and, if needed, an "opacity" below 1: "screen" or "add" for elements on black (the black disappears), "multiply" for elements on white (the white disappears), "overlay" or "soft-light" for textures on mid grey. Example: { "id": "leak", "type": "video", "asset": "light-leak", "startSec": 0, "endSec": 3, "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "blend": "screen", "opacity": 0.7 }. Ask for the overlay asset full-frame on a plain black, white or grey background. Leave "blend" out ("normal") for titles, logos and pictures that should simply cover the shot.` },
  { key: "html-clip-package", text: `An "html" asset's "prompt" is a design brief for the AI that will write the clip, not code: what it shows, how it moves over its length, colours, type and layout. List the media it uses (logos, photos, footage, music) in its "references"; the app copies the brief together with the HTML clip package instructions (format "dionysus.htmlclip/1", spec HTML_CLIP_PACKAGE.md next to this guide), filled in with the asset's size, length, bound assets and allowed libraries, and the user pastes the AI's single .html file back as a version.` },
  { key: "html-params", text: `Reuse one "html" asset with "params" instead of duplicating it: when shots or layers show the same design with different words, numbers or colours (title cards, text-only cards, chapter and end cards, lower thirds, counters), make ONE html asset, declare what varies in its "params" ({ "<key>": { "type": "text" | "number" | "color" | "boolean" | "select", "default": …, "label"?, "description"? } }, numbers may add "min", "max", "step", a select lists its "options"), and give each use its own values: a text-only shot is { "render": "html", "clip": "<asset id>", "params": { "text": "THE END" } }, a layer over a shot is { "type": "html", "asset": "<asset id>", "box": { "x": 0, "y": 0, "width": 1, "height": 1 }, "params": { "text": "5:58 AM" } }. Omitted keys use the default; a value must match its type (numbers within min–max, a select one of its "options", colours "#rrggbb"). The brief describes the design for any value (long and short text) and names the params; the app tells the clip's AI to expose exactly these params and read them at render time. Keep plain captions over a shot as text layers.` },
];
export const RULES: readonly string[] = RULE_LIST.map((r) => r.text);
/** 1-based public number of a rule, by key. */
export function ruleNumber(key: string): number {
  const i = RULE_LIST.findIndex((r) => r.key === key);
  if (i < 0) throw new Error(`Unknown rule "${key}"`);
  return i + 1;
}
export const rulesSection = () => RULES.map((r, i) => `${i + 1}. ${r}`).join("\n");

/** HOW IT WORKS, FORMAT, CHOOSING PRESETS, PRESETS, RULES and EXAMPLE; `heading` formats each section title (plain caps in the prompt, `##` in markdown). */
export function guideSections(heading: (title: string) => string): string {
  return [
    `${heading("HOW IT WORKS")}\n${HOW_IT_WORKS}`,
    `${heading(`FORMAT ("${STORYBOARD_FORMAT}", v${FORMAT_REVISION})`)}\n\`\`\`\n${FORMAT_SECTION()}\n\`\`\``,
    `${heading("CHOOSING PRESETS")}\n${CHOOSING_PRESETS}`,
    `${heading("PRESETS")}\n${presetsSection()}`,
    `${heading("RULES")}\n${rulesSection()}`,
    `${heading("EXAMPLE")}\n\`\`\`json\n${exampleStoryboardJson()}\n\`\`\``,
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
   It explains how the format works and defines the JSON ("${STORYBOARD_FORMAT}", v${FORMAT_REVISION}), how to choose presets, the preset ids you may use, the numbered rules and an example. Follow it exactly. (Same guide as a web page: ${links.guideHtml} · presets as JSON: ${links.presets})
2. If you can't open links, don't guess the format. Reply only: "I can't open the guide — please paste the full Dionysus prompt." The user will then paste it (Dionysus → Storyboard → AI prompt → Full prompt).
3. "durationSec" is the planned on-screen length of the shot in the edit, not what the video model can render. If the model must render longer (e.g. 6 s minimum), keep "durationSec" at the planned length and put the length to generate in "genDurationSec" (e.g. "durationSec": 4, "genDurationSec": 6).
4. Otherwise reply with ONLY one JSON code block containing the storyboard for our story — no commentary before or after.`;
}

/** Copyable system prompt that makes the user's own AI output a `dionysus.storyboard/1` JSON (V2-CUT-06). No AI calls are made by the app. */
import { CONNECTION_KINDS, STORY_ASSET_TYPES, STORYBOARD_FORMAT, type StoryDoc } from "./storyJson";

export const EXAMPLE_STORYBOARD: StoryDoc = {
  format: STORYBOARD_FORMAT,
  meta: { title: "The Lantern Keeper", logline: "An old keeper lights the last lantern before the storm.", aspect: "16:9", style: "Painterly realism, warm lantern light against cold blue dusk, 35mm film grain", language: "en" },
  assets: [
    { id: "keeper", name: "The keeper", type: "character", aspect: "1:1", prompt: "Character sheet of an elderly lighthouse keeper, weathered face, grey beard, yellow oilskin coat, front and 3/4 views, neutral background, painterly realism", references: [], source: { type: "generate" }, qa: ["Same face and beard in every view", "Yellow oilskin coat, no logos", "No extra fingers or limbs"] },
    { id: "cliff", name: "Cliff and lighthouse", type: "location", aspect: "16:9", prompt: "Wide establishing shot of a lonely white lighthouse on a black basalt cliff at blue dusk, storm clouds rolling in, painterly realism", references: [], source: { type: "generate" }, qa: ["Lighthouse is white with a red cap", "Storm clouds on the left, calm sky on the right"] },
    { id: "lantern", name: "Brass lantern", type: "prop", aspect: "1:1", prompt: "Antique brass storm lantern with glass chimney, product shot on dark background", references: [], source: { type: "upload" }, qa: ["Glass chimney intact"] },
    { id: "s1-end", name: "Last frame of shot 1", type: "frame", aspect: "16:9", prompt: "", references: [], source: { type: "lastFrame", shot: "s1" }, qa: ["Keeper is at the door, lantern in his right hand"] },
  ],
  shots: [
    { id: "s1", title: "Climbing the cliff path", description: "The keeper walks up the cliff path toward the lighthouse door.", durationSec: 5, prompt: "The elderly keeper in a yellow oilskin coat walks up a cliff path toward a white lighthouse at dusk, carrying a brass lantern, wind in his coat, slow tracking shot from behind, ends with him reaching the door", assets: ["keeper", "cliff", "lantern"], qa: ["Keeper matches the character sheet", "Lantern stays in his right hand", "Ends at the lighthouse door"], camera: "Slow tracking shot from behind" },
    { id: "s2", title: "Lighting the lamp", description: "Inside the lamp room he lights the great lamp.", durationSec: 6, prompt: "Continuing from the first frame: the keeper steps inside, climbs to the lamp room and lights the great lamp with his brass lantern, warm light floods the room, medium shot", assets: ["s1-end", "keeper", "lantern"], qa: ["First frame matches the end of shot 1", "Lamp ignites with a warm glow", "No text or watermarks"], camera: "Medium shot, handheld" },
    { id: "s3", title: "Beam across the storm", description: "The beam sweeps across the storm from outside.", durationSec: 4, prompt: "Exterior wide shot: the lighthouse beam sweeps across dark storm clouds and crashing waves, rain starts, dramatic", assets: ["cliff"], qa: ["Beam is clearly visible", "Same lighthouse as the establishing shot"] },
  ],
  connections: [
    { from: "s1", to: "s2", kind: "continuity", note: "Shot 2 starts from the last frame of shot 1" },
    { from: "s2", to: "s3", kind: "cut" },
  ],
};

export function storyboardSystemPrompt(): string {
  return `You are a storyboard planner for AI video production. We have agreed a story together. Turn it into a production storyboard and reply with ONLY one JSON code block in the exact format below — no commentary before or after.

FORMAT ("${STORYBOARD_FORMAT}")
{
  "format": "${STORYBOARD_FORMAT}",
  "meta": { "title": string, "logline"?: string, "synopsis"?: string, "aspect": "16:9" | "9:16" | "1:1" | "4:5" | "21:9", "style"?: string, "language"?: string },
  "assets": [ {
      "id": string,              // short unique id: letters, digits, "_", "-", "."
      "name": string,
      "type": ${STORY_ASSET_TYPES.map((t) => `"${t}"`).join(" | ")},
      "aspect"?: string,         // defaults to meta.aspect; character sheets often "1:1"
      "prompt": string,          // full, self-contained image/video generation prompt (required when source is "generate")
      "references"?: string[],   // ids of other assets to feed as references when generating this one
      "source": "generate" | "upload" | { "type": "lastFrame", "shot": "<shot id>" },
      "qa": string[]             // concrete yes/no checks to verify the generated asset
  } ],
  "shots": [ {                   // in playback order
      "id": string,
      "title": string,
      "description"?: string,
      "durationSec": number,     // 0.5–120; match what the video model can generate (usually 4–10)
      "prompt": string,          // full clip generation prompt (image-to-video / reference-to-video)
      "assets": string[],        // ids of the reference assets this clip is generated from
      "camera"?: string,
      "dialogue"?: string,
      "qa": string[]             // concrete yes/no checks for the generated clip
  } ],
  "connections"?: [ { "from": "<shot id>", "to": "<shot id>", "kind": ${CONNECTION_KINDS.map((k) => `"${k}"`).join(" | ")}, "note"?: string } ]
}

RULES
1. Every recurring character, location, prop and the overall style gets ONE reusable asset with a detailed prompt; shots reference these ids instead of repeating descriptions.
2. Write prompts that work on their own (a generator only sees that prompt plus the reference images). Repeat key visual details (clothes, colours, lighting, style) in every prompt.
3. When a shot must continue seamlessly from the previous one, add an asset with "type": "frame" and "source": { "type": "lastFrame", "shot": "<previous shot id>" }, use it in the next shot's "assets", and mark the connection "continuity". Never make a shot depend on its own last frame or create loops.
4. Use "source": "upload" for things the user already has (logos, real photos, products).
5. Every asset and shot gets 2–5 QA checks that a person can verify by looking: identity consistency, key props, framing, artefacts (extra fingers, warped text, watermarks).
6. Keep ids short and stable (e.g. "hero", "kitchen", "s1", "s1-end"). Shots are listed in order; "connections" may be omitted for simple hard cuts.
7. Output valid JSON only: double quotes, no comments, no trailing commas.

EXAMPLE
\`\`\`json
${JSON.stringify(EXAMPLE_STORYBOARD, null, 2)}
\`\`\`

Now write the storyboard JSON for our story.`;
}

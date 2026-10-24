/**
 * "The Lantern Keeper": the storyboard the AI guide used as its example before V2-SB-GUIDE-GENERIC. Kept as a stable
 * test fixture (3 shots, 15 s, 4 assets incl. an upload and a last-frame asset), so storyboard tests don't change
 * whenever the guide's example is edited.
 */
import { STORYBOARD_FORMAT, type StoryDoc } from "../storyJson";

export const LANTERN_KEEPER: StoryDoc = {
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

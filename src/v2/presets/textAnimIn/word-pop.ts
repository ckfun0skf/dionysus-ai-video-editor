import { defineTextAnimIn } from "../define";

const ENTRANCE = ["pop", "fade", "slide-up"] as const;

export default defineTextAnimIn({
  id: "word-pop",
  name: "Word pop",
  category: "Captions",
  description: "Splits the caption into one short clip per word (word SRT) so each word pops (or fades / slides) in at its time. Needs word timings; Even split creates them. After apply, each word clip uses the chosen entrance animation.",
  params: [
    { key: "entrance", label: "Entrance", description: "Animation each word clip uses: pop (default), fade, or slide-up.", type: "select", options: [...ENTRANCE], default: "pop" },
  ],
  type: "word-pop",
  // Marker preset: picking it in the editor expands the cue into word clips. Frame is a soft pop for tile preview.
  frame: (f, p) => ({ ...f, scale: f.scale * (0.5 + 0.5 * p), alpha: f.alpha * Math.min(1, p * 3), chars: 1 }),
  order: 71,
  ai: {
    use: "Captions where each word appears on its own (CapCut-style word SRT / popup).",
    avoid: "When the whole sentence must stay visible while words change colour — use word-highlight.",
  },
  preview: { text: "Word" },
});

import { defineClipType } from "../define";

export default defineClipType({
  id: "text",
  description: "A title or caption drawn from its own text and style (no media); word timings for captions.",
  trackKind: "text",
  caps: { sourceTime: false, still: true, sound: false, visual: true, keyable: false, thumb: false, asset: "none" },
  agent: { props: ["text"], clipTools: ["even_split_words", "set_caption_words", "word_align_prompt"] },
});

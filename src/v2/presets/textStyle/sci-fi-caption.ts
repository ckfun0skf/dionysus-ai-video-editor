import { defineTextStyle } from "../define";

/**
 * P7-CAPTION: bottom-right location/date caption ("Seattle / Year 2027") with a sci-fi look: bundled Share Tech Mono,
 * soft cyan glow, typed on with a digit scramble (decode) cursor that fades out when the text is complete.
 */
export default defineTextStyle({
  id: "sci-fi-caption",
  name: "Sci-fi caption",
  category: "Film",
  description: "Bottom-right location/date stamp (\"Seattle / Year 2027\"): cyan-white Share Tech Mono with a soft glow, decoded from scrambling digits.",
  data: {
    font: "share-tech-mono", bold: false, color: "#e6fbff", size: 0.045, align: "right", letterSpacing: 0.12,
    effect: "glow", effectColor: "#20d5ec",
    animIn: "typewriter", animInParams: { cursor: "0123456789", blink: 2, after: "fade", scramble: 0.25 }, animTicks: 180000,
    position: { x: 0.62, y: 0.9 },
  },
  order: 90,
});

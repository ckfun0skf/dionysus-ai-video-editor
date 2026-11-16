import { defineClipType } from "../define";

export default defineClipType({
  id: "effect",
  description: "An adjustment clip on an effect track: a videoEffect preset applied to the tracks below while it runs.",
  trackKind: "effect",
  caps: { sourceTime: false, still: true, sound: false, visual: false, keyable: false, thumb: false, asset: "none" },
  agent: { props: ["effect"] },
});

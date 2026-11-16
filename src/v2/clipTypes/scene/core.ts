import { defineClipType } from "../define";
import { SCENE_AGENT_RULES, SCENE_AGENT_TOOLS } from "./agentDefs";

/**
 * P74 (Phase 2 step 2.1): a deterministic three.js scene. Its asset version holds a `dionysus.scene/1` JSON document
 * (domain/scene.ts, decision 2); it renders in the sandboxed HTML clip host from `t` only (decision 1), so it has a free
 * length like a code clip, no sound, no source time and no thumbnail yet. No storyboard mapping before step 2.6 (renumbered in P76).
 * P78 (step 2.5): the first type that contributes WebMCP tools and an AI guide rule (./agentDefs.ts); they run in
 * ./agent.ts, loaded on first use because it uses the domain at runtime (the domain reads this registry).
 */
export default defineClipType({
  id: "scene",
  description: "A 3D scene (dionysus.scene/1): objects, camera and lights as JSON with timed events; rendered with three.js in a sandboxed iframe from time alone.",
  trackKind: "video",
  caps: { sourceTime: false, still: false, sound: false, visual: true, keyable: true, thumb: false, asset: "media" },
  agent: {
    tools: SCENE_AGENT_TOOLS,
    rules: SCENE_AGENT_RULES,
    run: (name, input, api) => import("./agent").then((m) => m.runSceneTool(name, input, api)),
  },
});

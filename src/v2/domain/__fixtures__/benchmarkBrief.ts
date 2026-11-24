/**
 * Scene Phase 4 (#353) acceptance: the benchmark shot (epic #349) made the Phase 4 way — from a one-paragraph brief
 * through the semantic tools, reviewed and corrected. These are the calls an agent makes (stage_scene, set_mood,
 * block_action, review_scene, then a fix); the test runs them on the pure functions the tools use.
 */
import type { SceneDoc } from "../scene";
import { blockAction, checkScene, emptyScene, setMood, stageScene, WINDOW_KIND, type SceneCheck, type StageBrief } from "../sceneStage";

/** The brief, as a user would write it. */
export const BENCHMARK_BRIEF =
  "A stylized village street at dusk. A character walks from left to right past a lantern-lit house, stops, turns to " +
  "camera and waves. The camera starts wide, orbits slowly, then cuts to a medium close-up with a focus pull. " +
  "Fireflies appear as the light fades.";

/** What an agent reads out of it for stage_scene (one call). */
export const BENCHMARK_STAGE: StageBrief = {
  name: "Benchmark shot (Phase 4: from the brief)", durationSec: 14,
  stage: { width: 14, depth: 8 },
  mood: { preset: "dusk-village", post: "cinematic" },
  set: [
    { id: "street", kind: "street", at: { x: 0, z: 0.6 } },
    { id: "house", kind: "house", at: { x: 1, z: -3 } },
    { id: "door", kind: "door", at: { near: "house", side: "front" } },
    { id: "glass", kind: WINDOW_KIND, at: { x: 0.2, z: -1.72 } },
    { id: "house2", kind: "house", at: { x: -4.5, z: -3.5 }, size: 0.9, color: "#c9d6e0" },
    { id: "lantern", kind: "lamp", at: { x: 2.8, z: -1.5 } },
    { id: "tree", kind: "tree", at: { x: 5, z: -2.5 } },
    { id: "tree2", kind: "tree", at: { x: -7.5, z: -1.8 } },
    { id: "bench", kind: "bench", at: { x: -2.4, z: -1.5 } },
  ],
  characters: [
    { id: "hero", name: "Hero", at: { x: -5, z: 0.6 }, facing: "right", body: { skin: "#f2c9a0", cloth: "#3d6fb6", pants: "#2c3140", hair: "#4a2e1e" } },
    { id: "elder", name: "Elder", at: { near: "bench", side: "front" }, height: 1.6, body: { cloth: "#7d4e8c", hair: "#d8d8d8" } },
  ],
  cameras: [
    { id: "camera", name: "Wide", subject: "house", shot: "wide", at: 0 },
    { id: "orbit", name: "Orbit", subject: "hero", shot: "full", angle: "three-quarter-left", at: 6.5 },
    { id: "close", name: "Close-up", subject: "hero", shot: "closeup", focalLength: 50, at: 10.5 },
  ],
};

/** What it reads out of it for block_action (one call). */
export const BENCHMARK_BLOCKING =
  "Hero walks to the lantern. Hero turns to camera, looks at camera, smiles and waves. " +
  "As Hero waves, Orbit orbits Hero. Hero says \"Good evening!\"";

export interface BenchmarkRun { draft: SceneDoc; firstReview: SceneCheck[]; reviews: SceneCheck[][]; corrections: string[]; fixed: SceneDoc; secondReview: SceneCheck[] }

/** Camera angles an agent tries, in order, when its subject is hidden behind something. */
const ANGLES = ["three-quarter-left", "front", "three-quarter-right", "right", "left"] as const;

/**
 * The whole loop: stage, mood (night falling), block, then review → correct → review until the checks are clean
 * (at most four rounds). What the reviews find, in order:
 * 1. The orbit and close-up cameras were framed where the hero stood at 0 s, but by their cuts the hero has walked to
 *    the lantern: "hero is outside the frame (behind the camera)". Fix: frame each on the hero at its cut.
 * 2. Framed from three-quarter-left, the orbit camera sees the hero through the house corner: "hero is hidden behind
 *    house". Fix: the next angle.
 * The rendered review (review_scene) also finds the night frames too dark (a histogram check this pure fixture can't
 * run); the run in Chrome fixed that with set_mood timeOfDay "dusk", which this fixture applies too. Looking at the
 * sheet, the hero ends its walk pressed against the house wall, so the walk ends in the street instead; and the elder
 * sits on the bench and watches the hero.
 */
export function buildBenchmarkFromBrief(): BenchmarkRun {
  const staged = stageScene(emptyScene(14), BENCHMARK_STAGE);
  if ("error" in staged) throw new Error(staged.error);
  const night = setMood(staged.doc, { timeOfDay: "night", at: 3, dur: 10 });
  if ("error" in night) throw new Error(night.error);
  const blocked = blockAction(night.doc, { text: BENCHMARK_BLOCKING, at: 0.5 });
  if ("error" in blocked) throw new Error(blocked.error);
  const draft = blocked.doc;
  const corrections: string[] = [];
  const reviews: SceneCheck[][] = [];
  const angleOf: Record<string, number> = {};
  let fixed = draft;
  const frame = (camera: string, angle: string) => {
    const cut = (fixed.shots ?? []).find((s) => s.camera === camera)?.at ?? 0;
    const r = blockAction(fixed, { beats: [{ who: camera, do: "frame", target: "hero", shot: camera === "close" ? "closeup" : "full", angle: angle as (typeof ANGLES)[number], at: cut }] });
    if ("error" in r) throw new Error(r.error);
    fixed = r.doc; corrections.push(`frame ${camera} ${angle}`);
  };
  for (let round = 0; round < 4; round++) {
    const review = checkScene(fixed);
    reviews.push(review);
    const warn = review.filter((c) => c.level === "warning" && c.camera && c.objects?.includes("hero"));
    if (!warn.length) break;
    const done = new Set<string>();
    for (const c of warn) {
      if (done.has(c.camera!)) continue;
      done.add(c.camera!);
      if (c.kind === "out-of-frame") { angleOf[c.camera!] = c.camera === "close" ? 1 : 0; frame(c.camera!, ANGLES[angleOf[c.camera!]]); }
      else if (c.kind === "occluded") { angleOf[c.camera!] = (angleOf[c.camera!] ?? 0) + 1; frame(c.camera!, ANGLES[angleOf[c.camera!] % ANGLES.length]); }
    }
  }
  // Looking at the sheet (not a check): the hero stopped 25 cm from the house wall, so the lamp post and the wall crowd
  // the orbit; the agent moves the walk's end out into the street in front of the lantern (update_scene_event).
  fixed = { ...fixed, events: (fixed.events ?? []).map((e) => (e.obj === "hero" && e.call === "walkTo" ? { ...e, args: { ...e.args, path: [[1.6, 0, 0.6]] } } : e)) };
  corrections.push("walk to the street");
  const dusk = setMood(fixed, { timeOfDay: "dusk", at: 3, dur: 10 });
  if (!("error" in dusk)) { fixed = dusk.doc; corrections.push("mood dusk"); }
  const sit = blockAction(fixed, { text: "Elder sits on the bench, looks at Hero", at: 0 });
  if (!("error" in sit)) { fixed = sit.doc; corrections.push("elder sits"); }
  return { draft, firstReview: reviews[0], reviews, corrections, fixed, secondReview: checkScene(fixed) };
}

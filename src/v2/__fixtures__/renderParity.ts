/**
 * P67 render parity fixture: one small project that exercises every clip renderer and the host features around them
 * (blank, placeholder, image, video, html, text with animations, word-highlight and word-pop caption tracks, masks,
 * transforms and keyframes, blend, fades, chroma key, a hidden layer, main / overlay / all effects, transitions and a
 * burned-in subtitle). Used by `render/renderParity.test.ts` (draw-call log in jsdom) and by the out-of-repo Chrome
 * pixel comparison described in the P67 PR. Media blobs are referenced by key (`img1`, `vid1`, `html1`); the jsdom
 * test leaves them out, the browser harness stores real files under those keys.
 */
import { createProject, TICKS_PER_SECOND, type Asset, type Placement, type Project } from "../domain";
import { defaultMask as defaultMaskFor } from "../domain/mask";
import { cmd, Engine } from "../engine";

const S = TICKS_PER_SECOND;
export const RENDER_PARITY_SIZE = { width: 320, height: 180 };
/** Frame times (seconds) that cover every clip, transition and effect window. */
// Main track after ripple: red 0–2, green 2–4 (crossfade in), placeholder 4–5, image 5–8, video 8–12 (push-left in), html 12–15.
export const RENDER_PARITY_TIMES = [0, 0.4, 1.25, 1.8, 1.9, 2.0, 2.1, 2.6, 3.3, 4.5, 5.2, 6.5, 7.5, 7.9, 8.0, 8.1, 9.0, 10.5, 12.25, 13.5, 14.75];

const asset = (id: string, kind: Asset["kind"], blobKey: string, mime: string, extra: Partial<Asset["versions"][number]["media"]> = {}): Asset => ({
  id, kind, name: id, selectedVersionId: "v1",
  versions: [{ id: "v1", createdAt: "2026-01-01T00:00:00.000Z", media: { blobKey, mime, ...extra }, provenance: { source: "import", inputs: [] } }],
});

export function renderParityProject(): Project {
  const e = new Engine(createProject("render parity", "2026-01-01T00:00:00.000Z"));
  const run = (c: ReturnType<typeof cmd.addBlankClip>) => e.dispatch(c);
  run(cmd.setProjectSettings({ width: RENDER_PARITY_SIZE.width, height: RENDER_PARITY_SIZE.height, fps: 30, background: "#101820" }));
  // Main track: blank → blank (crossfade) → placeholder → image → video (push-left) → html (default lengths, rippled).
  run(cmd.addBlankClip(0, "#d03030", "main", 2 * S, "m-red"));
  run(cmd.addBlankClip(2 * S, "#30c060", "main", 2 * S, "m-green"));
  run(cmd.setTransition("m-green", { kind: "crossfade", durationTicks: S / 2 }));
  run(cmd.addBlankClip(4 * S, "#000000", "main", S, "m-ph"));
  run(cmd.importAsset(asset("a-img", "image", "img1", "image/png", { width: 64, height: 36 })));
  run(cmd.importAsset(asset("a-vid", "video", "vid1", "video/webm", { width: 64, height: 36, durationTicks: 4 * S })));
  run(cmd.importAsset(asset("a-html", "html", "html1", "text/html")));
  const comp0 = e.getState().project.compositions[e.getState().project.rootCompositionId];
  const mainId = comp0.tracks.find((t) => t.placements.some((p) => p.id === "m-red"))!.id;
  run(cmd.addAssetToTimeline("a-img", 5 * S, mainId, "m-img"));
  run(cmd.addAssetToTimeline("a-vid", 6 * S, mainId, "m-vid"));
  run(cmd.addAssetToTimeline("a-html", 8 * S, mainId, "m-html"));
  run(cmd.setTransition("m-vid", { kind: "push-left", durationTicks: S / 2 }));
  // Overlay: a scaled, keyed, masked, multiplied blank with a fade; an image overlay with a chroma key and rect mask.
  run(cmd.addBlankClip(0, "#3050e0", "overlay", 3 * S, "o-blue"));
  run(cmd.setTransform("o-blue", { scale: 0.5 }));
  run(cmd.setKeyframe("o-blue", "x", 0, -0.15));
  run(cmd.setKeyframe("o-blue", "x", 3 * S - 1, 0.15));
  run(cmd.setClipMask("o-blue", { ...defaultMaskFor("ellipse"), feather: 0.1 }));
  run(cmd.setBlend("o-blue", "multiply"));
  run(cmd.setFades("o-blue", { in: S / 2 }));
  run(cmd.addBlankClip(5 * S, "#ffffff", "overlay", 2 * S, "o-white"));
  run(cmd.setClipMask("o-white", { ...defaultMaskFor("rect"), w: 0.5, h: 0.5, invert: true }));
  run(cmd.setChromaKey("o-white", { color: "#ffffff", range: 0.3, spill: 0.5 }));
  // A hidden overlay layer: nothing of it may be drawn.
  run(cmd.addBlankClip(0, "#ff00ff", "overlay", 9 * S, "o-hidden"));
  const hiddenTrack = e.getState().project.compositions[e.getState().project.rootCompositionId].tracks.find((t) => t.placements.some((p) => p.id === "o-hidden"))!;
  run(cmd.toggleTrackHidden(hiddenTrack.id));
  // Text clips with entrance animations.
  run(cmd.addTextClip(0, { text: "Hello", animIn: "pop" }, "t-hello"));
  run(cmd.addTextClip(3 * S, { text: "Typewriter line", animIn: "typewriter" }, "t-type"));
  // Caption tracks: word-highlight and word-pop.
  run(cmd.importSrtLayer([{ id: "s1", startTicks: 0, durationTicks: 2 * S, text: "Every word lights up" }, { id: "s2", startTicks: 5 * S, durationTicks: 2 * S, text: "Second caption cue" }], "cap-hl"));
  run(cmd.setTrackCaptionStyle("cap-hl", { mode: "word-highlight" }));
  run(cmd.importSrtLayer([{ id: "s3", startTicks: 2 * S, durationTicks: 2 * S, text: "Pop one word" }], "cap-pop"));
  run(cmd.setTrackCaptionStyle("cap-pop", { mode: "word-pop" }));
  // Effects: main-scope blur, overlay-scope vignette, all-scope black and white.
  run(cmd.addEffectClip(S, "blur", undefined, "e-blur"));
  run(cmd.addEffectClip(0, "vignette", undefined, "e-vig"));
  run(cmd.setEffectScope("e-vig", "overlay"));
  run(cmd.addEffectClip(6 * S, "bw", undefined, "e-bw"));
  run(cmd.setEffectScope("e-bw", "all"));
  // Burned-in subtitle.
  run(cmd.setSubtitles([{ id: "sub1", startTicks: 0, durationTicks: 2 * S, text: "Burned-in subtitle" }]));
  // Turn m-ph into a P35 placeholder (as Send to Timeline makes it: an image clip with TEXT_SOURCE and a label).
  const p = structuredClone(e.getState().project);
  for (const t of p.compositions[p.rootCompositionId].tracks) {
    t.placements = t.placements.map((pl): Placement => {
      if (pl.id !== "m-ph") return pl;
      const { blank: _b, ...rest } = pl; void _b;
      return { ...rest, placeholder: { label: "Shot 3 · not generated" } };
    });
  }
  return p;
}

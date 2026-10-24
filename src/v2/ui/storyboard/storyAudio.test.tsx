// @vitest-environment jsdom
/** Audio cues in the board (V2-SB-125): listed in the shot and asset details, sent onto audio layers. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, story, type MediaRef } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; });
const doc = (() => {
  const r = story.validateStoryboard({
    format: "dionysus.storyboard/1",
    meta: { title: "T", aspect: "16:9" },
    assets: [
      { id: "score", name: "Score", type: "audio", prompt: "Warm piano bed" },
      { id: "door", name: "Door", type: "audio", source: "upload" },
    ],
    shots: ["s1", "s2", "s3"].map((id) => ({ id, title: id, durationSec: 4, prompt: "p", assets: [], qa: [] })),
    audio: [
      { id: "bed", asset: "score", kind: "music", from: "s1", to: "s3", volume: 0.3, fadeOutSec: 2 },
      { id: "hit", asset: "door", kind: "sfx", from: "s2", atSec: 1.5 },
    ],
  });
  if (!r.ok) throw new Error("bad");
  return r.doc;
})();
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 480_000 };
const aud: MediaRef = { blobKey: "a", mime: "audio/mpeg", durationTicks: 240_000 };

describe("audio cues in the board (V2-SB-125)", () => {
  it("lists the cues under a shot and an audio asset, opens the asset, and sends them to audio layers", async () => {
    const el = document.createElement("div"); document.body.appendChild(el);
    const engine = new Engine(createProject("t"));
    engine.dispatch(cmd.createStoryboard(doc));
    const storage = createMemoryStorage();
    await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={storage.blobs} onClose={() => {}} />));
    const shots = [...el.querySelectorAll(".v2-sb-shot-main")] as HTMLButtonElement[];
    await act(async () => shots[1].click());
    const list = el.querySelector('[data-testid="audio-cues"]')!;
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(list.textContent).toContain("shots 1–3 · volume 30% · fade 1 s in, 2 s out");
    expect(list.textContent).toContain("shot 2 from 1.5 s · volume 100%");
    await act(async () => shots[0].click());
    expect(el.querySelectorAll('[data-testid="audio-cues"] li')).toHaveLength(1);
    const open = [...el.querySelectorAll('[data-testid="audio-cues"] button')].find((b) => b.textContent === "Score") as HTMLButtonElement;
    await act(async () => open.click());
    const slotList = el.querySelector('[data-testid="audio-cues"]')!;
    expect(slotList.textContent).toContain("Score");
    expect(slotList.querySelector("button")).toBeNull();
    expect(el.textContent).toContain("Upload the audio file above.");
    await act(async () => {
      for (const s of ["s1", "s2", "s3"]) engine.dispatch(cmd.addStoryVersion({ shot: s }, vid));
      engine.dispatch(cmd.addStoryVersion({ slot: "score" }, aud));
      engine.dispatch(cmd.addStoryVersion({ slot: "door" }, aud));
    });
    const send = [...el.querySelectorAll("button")].find((b) => /Send to timeline/.test(b.textContent ?? "")) as HTMLButtonElement;
    await act(async () => send.click());
    expect(el.textContent).toContain("2 audio cues");
    const p = engine.getState().project;
    const names = p.compositions[p.rootCompositionId].tracks.filter((t) => t.kind === "audio" && t.placements.length).map((t) => t.name);
    expect(names.sort()).toEqual(["Music", "Sound effects"]);
  });
});

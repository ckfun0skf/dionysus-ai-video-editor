// @vitest-environment jsdom
/** Fixed vs following layers in the board (V2-SB-126): the shot details say which layers move with the shot. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, story } from "../../domain";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

let root: Root | undefined;
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

describe("layers that follow the shot in the board (V2-SB-126)", () => {
  it("marks following layers and explains that the rest stay fixed", async () => {
    const r = story.validateStoryboard({
      format: "dionysus.storyboard/1",
      meta: { title: "T", aspect: "16:9" },
      assets: [],
      shots: [{ id: "s1", title: "s1", durationSec: 4, prompt: "p", assets: [], qa: [], effects: [{ preset: "ken-burns" }], layers: [
        { id: "tag", type: "text", text: "ROOM 12", startSec: 0, endSec: 4, position: { x: 0.6, y: 0.4 }, follow: "shot" },
        { id: "title", type: "text", text: "TITLE", startSec: 0, endSec: 4, position: { x: 0.5, y: 0.8 } },
      ] }],
    });
    if (!r.ok) throw new Error("bad");
    const engine = new Engine(createProject("t"));
    engine.dispatch(cmd.createStoryboard(r.doc));
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => { root = createRoot(el); root.render(<StoryboardView engine={engine} blobs={createMemoryStorage().blobs} onClose={() => {}} />); });
    await act(async () => (el.querySelector(".v2-sb-shot-main") as HTMLButtonElement).click());
    const items = [...el.querySelectorAll(".v2-sb-layers li")].map((li) => li.textContent);
    expect(items[0]).toContain("ROOM 12");
    expect(items[0]).toContain("· moves with the shot");
    expect(items[1]).not.toContain("moves with the shot");
    expect(el.textContent).toContain("layers stay fixed to the frame unless marked “moves with the shot”");
  });
});

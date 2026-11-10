// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, findPlacement, ops, type Project } from "../domain";
import { cmd, Engine } from "../engine";
import { validateStoryboard, type StoryDoc } from "../domain/storyJson";
import { secondsToTicks as s } from "../domain/time";
import { useEngineState } from "./useEditor";
import { ClipVersionPicker } from "./ClipVersionPicker";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; });

const rootOf = (p: Project) => p.compositions[p.rootCompositionId];
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function storyEngine() {
  const r = validateStoryboard({ format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" }, assets: [], shots: [{ id: "s1", title: "One", durationSec: 3, prompt: "p", assets: [], qa: [] }], connections: [] });
  if (!r.ok) throw new Error("bad doc");
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(r.doc as StoryDoc));
  e.dispatch(cmd.addStoryVersion({ shot: "s1" }, { blobKey: "k1", mime: "video/mp4", durationTicks: s(3) }, { versionId: "o1" }));
  e.dispatch(cmd.sendStoryToTimeline());
  return e;
}

async function mount(e: Engine, clipId: string) {
  const toasts: (string | undefined)[] = [];
  const el = document.createElement("div"); document.body.appendChild(el);
  const r = createRoot(el); roots.push(r);
  function App() {
    const { project } = useEngineState(e);
    return <ClipVersionPicker engine={e} project={project} clipId={clipId} onToast={(m) => toasts.push(m)} />;
  }
  await act(async () => r.render(<App />));
  await act(() => wait());
  return { el, toasts };
}

describe("P58 ClipVersionPicker", () => {
  it("shows Follow storyboard and pins one clip independently", async () => {
    const e = await storyEngine();
    const id = ops.mainTrack(rootOf(e.getState().project))!.placements[0].id;
    e.dispatch(cmd.splitPlacement(id, s(1.5), "B"));
    e.dispatch(cmd.addStoryVersionFromClip(id, { blobKey: "k2", mime: "video/mp4", durationTicks: s(3) }, { versionId: "o2", fit: "trim" }));
    const { el } = await mount(e, id);
    expect(el.querySelector('[data-testid="clip-version-picker"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="clip-version-follow"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(el.querySelector('[data-testid="clip-version-o2"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(el.querySelector('[data-testid="clip-version-o2"]')?.textContent).toMatch(/this clip/);
    expect(findPlacement(rootOf(e.getState().project), "B")!.placement.source.versionId).toBe("o1");
    await act(async () => (el.querySelector('[data-testid="clip-version-follow"]') as HTMLButtonElement).click());
    expect(findPlacement(rootOf(e.getState().project), id)!.placement.versionId).toBeUndefined();
    e.undo();
    expect(findPlacement(rootOf(e.getState().project), id)!.placement.versionId).toBe("o2");
  });

  it("disables delete on the last version and confirms when clips use one", async () => {
    const e = await storyEngine();
    const id = ops.mainTrack(rootOf(e.getState().project))!.placements[0].id;
    const first = await mount(e, id);
    expect((first.el.querySelector('[data-testid="clip-version-delete-o1"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => { roots.splice(0).forEach((r) => r.unmount()); });
    e.dispatch(cmd.splitPlacement(id, s(1.5), "B"));
    e.dispatch(cmd.addStoryVersionFromClip(id, { blobKey: "k2", mime: "video/mp4", durationTicks: s(3) }, { versionId: "o2", fit: "trim" }));
    const { el } = await mount(e, id);
    const del = el.querySelector('[data-testid="clip-version-delete-o1"]') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    await act(async () => del.click());
    const box = el.querySelector('[data-testid="delete-version-confirm"]')!;
    expect(box.textContent).toMatch(/Version 1/);
    expect(el.querySelector('[data-testid="delete-version-affected"]')!.textContent).toMatch(/B|pinned|Version 2/);
    await act(async () => (el.querySelector('[data-testid="delete-version-yes"]') as HTMLButtonElement).click());
    const assetId = e.getState().project.storyboard!.shots.s1.assetId!;
    expect(e.getState().project.assets[assetId].versions.map((v) => v.id)).toEqual(["o2"]);
    expect(findPlacement(rootOf(e.getState().project), "B")!.placement.source.versionId).toBe("o2");
    e.undo();
    expect(e.getState().project.assets[assetId].versions.map((v) => v.id)).toEqual(["o1", "o2"]);
  });
});

// @vitest-environment jsdom
/** P38 (item 5): Params → Inputs: the Reference list binds by track id and renames layers in place. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { createProject, findPlacement, type Asset, type Project } from "../domain";
import { cmd, Engine } from "../engine";
import { HtmlParamsPanel } from "./HtmlParamsPanel";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const html = `<script type="application/json" id="dionysus-clip">${JSON.stringify({ format: "dionysus.htmlclip/1", inputs: { music: { type: "beat", label: "Music" } } })}</script><canvas></canvas>`;
const blob = { text: async () => html } as unknown as Blob;
const blobs = { get: async () => blob } as never;
const asset = (id: string, kind: Asset["kind"]): Asset => ({ id, kind, name: `${id}.x`, selectedVersionId: "v", versions: [{ id: "v", createdAt: "", media: { blobKey: id, mime: "x", durationTicks: 480000 }, provenance: { source: "import", inputs: [] } }] });
const root = (p: Project) => p.compositions[p.rootCompositionId];
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("clip inputs panel (P38)", () => {
  it("picks a track as the source (stored by id) and renames it from the list", async () => {
    const e = new Engine(createProject("p"));
    e.dispatch([cmd.importAsset(asset("h", "html")), cmd.importAsset(asset("song", "audio"))]);
    e.dispatch([cmd.addAssetToTimeline("h", 0, undefined, "hc"), cmd.addAssetToTimeline("song", 0, undefined, "sc")]);
    const audio = root(e.getState().project).tracks.find((t) => t.kind === "audio")!;
    const el = document.createElement("div"); document.body.appendChild(el);
    const r = createRoot(el);
    const render = () => { const p = e.getState().project; r.render(<HtmlParamsPanel engine={e} project={p} placement={findPlacement(root(p), "hc")!.placement} blobs={blobs} />); };
    act(render); await flush();
    const src = el.querySelector(".v2-input-src") as HTMLButtonElement;
    expect(src.textContent).toContain("Mix");
    act(() => src.click());
    const opt = [...el.querySelectorAll('[role="radio"]')].find((b) => b.textContent?.trim() === audio.name) as HTMLButtonElement;
    act(() => opt.click()); act(render);
    expect(findPlacement(root(e.getState().project), "hc")!.placement.htmlInputs).toEqual({ music: `track:${audio.id}` });
    act(() => (el.querySelector(".v2-input-src") as HTMLButtonElement).click());
    act(() => (el.querySelector(`[aria-label="Rename ${audio.name}"]`) as HTMLButtonElement).click());
    const input = el.querySelector('input[aria-label="Layer name"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Score"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => (el.querySelector('[aria-label="Save name"]') as HTMLButtonElement).click()); act(render);
    expect(root(e.getState().project).tracks.find((t) => t.id === audio.id)!.name).toBe("Score");
    expect(el.querySelector(".v2-input-src")!.textContent).toContain("Score");
    expect(findPlacement(root(e.getState().project), "hc")!.placement.htmlInputs).toEqual({ music: `track:${audio.id}` });
  });
});

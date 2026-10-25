// @vitest-environment jsdom
/** V2-HTML-PARAMS: the inspector's Params panel edits this clip's values, one undo per edit. */
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Engine, cmd } from "../engine";
import { createProject, type Project } from "../domain/model";
import { HTML_CLIP_FORMAT } from "../domain";
import { validateStoryboard } from "../domain/storyJson";
import type { BlobStore } from "../ports";
import { HtmlParamsPanel } from "./HtmlParamsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const manifest = { format: HTML_CLIP_FORMAT, name: "Card", durationSec: 2, width: 1920, height: 1080, params: {
  text: { type: "text", default: "Title", label: "Text" },
  shadow: { type: "boolean", default: true, label: "Shadow" },
} };
const page = (m: unknown) => `<!doctype html><html><head><script type="application/json" id="dionysus-clip">${JSON.stringify(m)}</script></head><body><canvas></canvas></body></html>`;
const store = (html: string): BlobStore => ({ get: async () => ({ text: async () => html }) as Blob } as unknown as BlobStore);

function setup() {
  const r = validateStoryboard({ format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
    assets: [{ id: "card", name: "Card", type: "html", prompt: "card", qa: [] }],
    shots: [{ id: "s1", title: "End", durationSec: 2, render: "html", clip: "card", assets: [], qa: [], params: { text: "THE END" } }], connections: [] });
  if (!r.ok) throw new Error("bad");
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(r.doc));
  e.dispatch(cmd.addStoryVersion({ slot: "card" }, { blobKey: "page", mime: "text/html", width: 1920, height: 1080 }, { versionId: "c1" }));
  e.dispatch(cmd.sendStoryToTimeline());
  const pl = () => { const p: Project = e.getState().project; return p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements).find((x) => x.clipType === "html")!; };
  return { e, pl };
}

async function mount(e: Engine, pl: () => ReturnType<ReturnType<typeof setup>["pl"]>, blobs: BlobStore) {
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  const render = () => act(async () => { root.render(<HtmlParamsPanel engine={e} project={e.getState().project} placement={pl()} blobs={blobs} />); });
  await render(); await render();
  return { el, render };
}

const type = (input: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("HtmlParamsPanel", () => {
  it("shows the clip's values, edits them per clip with one undo per edit, and resets", async () => {
    const { e, pl } = setup();
    const { el, render } = await mount(e, pl, store(page(manifest)));
    const text = el.querySelector<HTMLInputElement>('input[aria-label="Clip Text"]')!;
    expect(text.value).toBe("THE END");
    await act(async () => { text.dispatchEvent(new FocusEvent("focus")); text.focus(); });
    await act(async () => { type(text, "THE EN"); });
    await render();
    await act(async () => { type(el.querySelector<HTMLInputElement>('input[aria-label="Clip Text"]')!, "FIN"); });
    await act(async () => { el.querySelector<HTMLInputElement>('input[aria-label="Clip Text"]')!.blur(); });
    expect(pl().htmlParams).toEqual({ text: "FIN" });
    const sw = el.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Clip Shadow"]')!;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await act(async () => { sw.click(); });
    expect(pl().htmlParams).toEqual({ text: "FIN", shadow: false });
    e.undo();
    expect(pl().htmlParams).toEqual({ text: "FIN" });
    e.undo();
    expect(pl().htmlParams).toEqual({ text: "THE END" });
    await render();
    const reset = Array.from(el.querySelectorAll("button")).find((b) => b.textContent?.includes("Reset to defaults"))!;
    expect(reset.disabled).toBe(false);
    await act(async () => { reset.click(); });
    expect(pl().htmlParams).toBeUndefined();
  });

  it("explains how to expose params when the clip declares none", async () => {
    const { e, pl } = setup();
    const { el } = await mount(e, pl, store(page({ ...manifest, params: undefined })));
    expect(el.textContent).toContain("exposes no params");
  });
});

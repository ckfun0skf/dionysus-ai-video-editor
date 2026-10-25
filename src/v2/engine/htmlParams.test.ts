/** V2-HTML-PARAMS: Send to timeline carries per-use param values; setHtmlParams edits, coalesces and resets them. */
import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import * as cmd from "./commands";
import { createProject, type MediaRef, type Project } from "../domain/model";
import { validateStoryboard, type StoryDoc } from "../domain/storyJson";
import { secondsToTicks as s } from "../domain/time";

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const raw = (): J => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "card", name: "Card", type: "html", prompt: "Text card", qa: [], params: { text: { type: "text", default: "Title" }, place: { type: "select", options: ["center", "lower-left"], default: "center" } } },
    { id: "bg", name: "BG", type: "image", prompt: "plain", qa: [] },
  ],
  shots: [
    { id: "s1", title: "One", durationSec: 3, render: "still", clip: "bg", assets: [], qa: [],
      layers: [{ id: "l1", type: "html", asset: "card", startSec: 0, endSec: 2, box: { x: 0, y: 0, width: 1, height: 1 }, params: { text: "5:58 AM", place: "lower-left" } }] },
    { id: "s2", title: "End", durationSec: 2, render: "html", clip: "card", assets: [], qa: [], params: { text: "THE END" } },
    { id: "s3", title: "Plain", durationSec: 2, render: "html", clip: "card", assets: [], qa: [] },
  ],
  connections: [{ from: "s1", to: "s2", kind: "cut" }, { from: "s2", to: "s3", kind: "cut" }],
});
const doc = (): StoryDoc => { const r = validateStoryboard(raw()); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const image: MediaRef = { blobKey: "img", mime: "image/png", width: 1920, height: 1080 };
const html: MediaRef = { blobKey: "page", mime: "text/html", width: 1920, height: 1080 };
const all = (p: Project) => p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements);

function sent() {
  const e = new Engine(createProject("t"));
  e.dispatch(cmd.createStoryboard(doc()));
  e.dispatch(cmd.addStoryVersion({ slot: "bg" }, image, { versionId: "bg1" }));
  e.dispatch(cmd.addStoryVersion({ slot: "card" }, html, { versionId: "c1" }));
  e.dispatch(cmd.sendStoryToTimeline());
  return e;
}

describe("V2-HTML-PARAMS send and edit", () => {
  it("one html asset, three uses, each with its own values", () => {
    const e = sent();
    const htmls = all(e.getState().project).filter((p) => p.clipType === "html");
    expect(htmls).toHaveLength(3);
    expect(htmls.every((p) => p.source.versionId === "c1")).toBe(true);
    const byLen = htmls.map((p) => [p.durationTicks, p.htmlParams]);
    expect(byLen).toEqual(expect.arrayContaining([[s(2), { text: "5:58 AM", place: "lower-left" }], [s(2), { text: "THE END" }], [s(2), undefined]]));
  });

  it("setHtmlParams: a typing session is one undo step; null drops a key; undefined resets", () => {
    const e = sent();
    const id = all(e.getState().project).find((p) => p.htmlParams?.text === "THE END")!.id;
    const get = () => all(e.getState().project).find((p) => p.id === id)!;
    e.beginGesture();
    for (const t of ["F", "FI", "FIN"]) e.dispatch(cmd.setHtmlParams(id, { text: t }));
    e.endGesture();
    expect(get().htmlParams).toEqual({ text: "FIN" });
    e.undo();
    expect(get().htmlParams).toEqual({ text: "THE END" });
    e.dispatch(cmd.setHtmlParams(id, { place: "lower-left" }));
    expect(get().htmlParams).toEqual({ text: "THE END", place: "lower-left" });
    e.dispatch(cmd.setHtmlParams(id, { text: null }));
    expect(get().htmlParams).toEqual({ place: "lower-left" });
    e.dispatch(cmd.setHtmlParams(id, undefined));
    expect(get().htmlParams).toBeUndefined();
    e.undo();
    expect(get().htmlParams).toEqual({ place: "lower-left" });
  });

  it("ignores non-html clips", () => {
    const e = sent();
    const still = all(e.getState().project).find((p) => p.clipType === "image")!;
    e.dispatch(cmd.setHtmlParams(still.id, { text: "x" }));
    expect(all(e.getState().project).find((p) => p.id === still.id)!.htmlParams).toBeUndefined();
  });
});

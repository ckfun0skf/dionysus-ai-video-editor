// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { board, createProject, type MediaRef } from "../../domain";
import { validateStoryboard } from "../../domain/storyJson";
import { Engine } from "../../engine";
import type { BlobStore } from "../../ports/storage";
import { runTimelineTool, type FrameSource } from "./timelineTools";

const DESC = "Medium close-up: the man at the computer looks down at the objects on the desk; middle of shot 1's push-in.";
const doc = () => {
  const v = validateStoryboard({
    format: "dionysus.storyboard/1", meta: { title: "Desk", aspect: "16:9" }, assets: [], connections: [],
    shots: [
      { id: "s1", title: "Desk", description: "", durationSec: 5, prompt: "A man at the computer notices objects on the desk.", assets: [], qa: [] },
      { id: "s2", title: "Objects", description: "", durationSec: 4, prompt: "He picks up the objects.", assets: [], qa: [], references: [{ frameOf: "s1", atSec: 2, role: "start", frameDesc: DESC }] },
    ],
  });
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return v.doc;
};
const memBlobs = (): BlobStore & { m: Map<string, Blob> } => {
  const m = new Map<string, Blob>();
  return { m, async put(k, b) { m.set(k, b); }, async get(k) { return m.get(k); }, async delete(k) { m.delete(k); }, async keys() { return [...m.keys()]; } };
};
const vid: MediaRef = { blobKey: "clip1", mime: "video/mp4", durationTicks: 600_000 };
const source = (seen: number[]): FrameSource => ({
  async frames() { return []; }, async audio() { return undefined; },
  async videoFrame(_v, sec) { seen.push(sec); return { blob: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), width: 16, height: 9, atSec: sec }; },
});

describe("P15 capture_shot_frame", () => {
  it("fails with 'generate first' when the source shot has no clip", async () => {
    const e = new Engine(board.setStoryboard(createProject("p"), board.storyboardFromDoc(doc())));
    const r = await runTimelineTool(e, source([]), "capture_shot_frame", { shotId: "s2" }, undefined, memBlobs());
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/Generate shot 1/);
  });
  it("captures at the reference's atSec and stores a frame version linked to the source version", async () => {
    let p = board.setStoryboard(createProject("p"), board.storyboardFromDoc(doc()));
    p = board.addStoryVersion(p, { shot: "s1" }, vid, { versionId: "s1v1" });
    const e = new Engine(p), blobs = memBlobs(), seen: number[] = [];
    await blobs.put("clip1", new Blob(["x"], { type: "video/mp4" }));
    expect(board.frameRefState(e.getState().project, "s2.frameof.s1").state).toBe("pick");
    const r = await runTimelineTool(e, source(seen), "capture_shot_frame", { shotId: "s2" }, undefined, blobs);
    expect(r.ok).toBe(true);
    expect(seen).toEqual([2]);
    expect(JSON.parse(r.text)).toMatchObject({ slotId: "s2.frameof.s1", frameOf: "s1", atSec: 2, sourceVersionId: "s1v1", state: "ok" });
    expect(r.image?.mimeType).toBe("image/png");
    const r2 = await runTimelineTool(e, source(seen), "capture_shot_frame", { slotId: "s2.frameof.s1", atSec: 3.5 }, undefined, blobs);
    expect(JSON.parse(r2.text).atSec).toBe(3.5);
  });
});

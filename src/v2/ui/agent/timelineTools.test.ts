// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, findPlacement, secondsToTicks as s, timelineReview, type Asset, type Project } from "../../domain";
import { cmd, Engine } from "../../engine";
import { agentStore, ALL_AGENT_TOOLS, callTimelineAgentTool, registerAgentTools } from "./webMcp";
import { audioIssues, runTimelineTool, type FrameSource } from "./timelineTools";

function asset(id: string, kind: Asset["kind"], seconds?: number): Asset {
  return { id, kind, name: id, selectedVersionId: `${id}_v1`, versions: [{ id: `${id}_v1`, createdAt: "", media: { blobKey: id, mime: "x", durationTicks: seconds ? s(seconds) : undefined }, provenance: { source: "import", inputs: [] } }] };
}
const root = (p: Project) => p.compositions[p.rootCompositionId];
function setup() {
  const e = new Engine(createProject("t"));
  e.dispatch([cmd.importAsset(asset("v", "video", 10)), cmd.importAsset(asset("w", "video", 4)), cmd.importAsset(asset("a", "audio", 20))]);
  e.dispatch(cmd.addAssetToTimeline("v", 0, undefined, "c1"));
  return e;
}
const json = (t: string) => JSON.parse(t);
const fakeCanvas = (w: number, h: number) => ({ width: w, height: h, toDataURL: () => "data:image/jpeg;base64,QUJD", getContext: () => null }) as unknown as HTMLCanvasElement;
const source = (luma = 128): FrameSource & { calls: number[][] } => {
  const calls: number[][] = [];
  return { calls, async frames(p, ts, w) { calls.push(ts); return ts.map(() => { return fakeCanvas(w, Math.round((w * p.settings.height) / p.settings.width)); }); }, async audio() { return undefined; }, luma: () => luma };
};

beforeEach(() => { localStorage.clear(); agentStore.reset(); agentStore.setEnabled(true); });
afterEach(() => agentStore.reset());

describe("P12 timeline tools", () => {
  it("get_timeline lists tracks, clips (seconds) and assets", async () => {
    const e = setup();
    const r = await runTimelineTool(e, undefined, "get_timeline", {});
    const t = json(r.text);
    expect(t.duration).toBe(10);
    const main = t.tracks.find((x: { main?: boolean }) => x.main);
    expect(main.clips[0]).toMatchObject({ id: "c1", start: 0, duration: 10, asset: "v", type: "video" });
    expect(t.assets.map((a: { id: string }) => a.id)).toEqual(["v", "w", "a"]);
  });

  it("each edit is one undo step labelled with the tool and returns the clip", async () => {
    const e = setup();
    let r = await runTimelineTool(e, undefined, "split_clip", { id: "c1", atSec: 4 });
    expect(r.ok && r.changed).toBe(true);
    const halves = json(r.text);
    expect(halves.map((c: { duration: number }) => c.duration)).toEqual([4, 6]);
    e.undo();
    expect(root(e.getState().project).tracks.flatMap((t) => t.placements)).toHaveLength(1);
    r = await runTimelineTool(e, undefined, "trim_clip", { id: "c1", edge: "right", atSec: 7 });
    expect(json(r.text)).toMatchObject({ id: "c1", duration: 7 });
    const before = findPlacement(root(e.getState().project), "c1")!.placement;
    r = await runTimelineTool(e, undefined, "set_clip_props", { id: "c1", volume: 0.5, transform: { scale: 0.8 }, fades: { inSec: 1 } });
    expect(json(r.text)).toMatchObject({ volume: 0.5, transform: { scale: 0.8 }, fades: { inSec: 1 } });
    e.undo(); // the three property changes go back together
    const pl = findPlacement(root(e.getState().project), "c1")!.placement;
    expect([pl.volume, pl.transform, pl.fadeInTicks]).toEqual([before.volume, before.transform, before.fadeInTicks]);
    expect(pl.durationTicks).toBe(s(7));
  });

  it("add_clip, move_clip and delete_clip", async () => {
    const e = setup();
    const r = await runTimelineTool(e, undefined, "add_clip", { assetId: "a", startSec: 2 });
    const c = json(r.text);
    expect(c).toMatchObject({ asset: "a", start: 2, type: "audio" });
    const m = await runTimelineTool(e, undefined, "move_clip", { id: c.id, startSec: 5 });
    expect(json(m.text).start).toBe(5);
    const bad = await runTimelineTool(e, undefined, "move_clip", { id: c.id, startSec: 1, trackId: json((await runTimelineTool(e, undefined, "get_timeline", {})).text).tracks.find((x: { main?: boolean }) => x.main).id });
    expect(bad.ok).toBe(false);
    const d = await runTimelineTool(e, undefined, "delete_clip", { ids: [c.id] });
    expect(d.changed).toBe(true);
    expect((await runTimelineTool(e, undefined, "delete_clip", { ids: ["nope"] })).ok).toBe(false);
    expect((await runTimelineTool(e, undefined, "add_clip", { assetId: "zz", startSec: 0 })).text).toContain("No media asset");
  });

  it("capture_frame and contact_sheet return MCP images", async () => {
    const e = setup(), src = source();
    const r = await callTimelineAgentTool(e, "capture_frame", { timeSec: 2.5, maxWidth: 320 }, { source: src });
    expect(r.content[0]).toMatchObject({ type: "text" });
    expect(r.content[1]).toEqual({ type: "image", data: "QUJD", mimeType: "image/jpeg" });
    expect(src.calls[0]).toEqual([s(2.5)]);
    const sheet = await callTimelineAgentTool(e, "contact_sheet", { count: 5 }, { source: src });
    expect(sheet.content[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    expect(src.calls[1]).toHaveLength(5);
    expect((sheet.content[0] as { text: string }).text).toContain("5 frames");
  });

  it("review_lint finds gaps, short clips, unlinked layers, missing media and needsPrompt-free projects", async () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("w", s(12), root(e.getState().project).tracks.find((t) => t.placements.some((p) => p.id === "c1"))!.id, "c2"));
    e.dispatch(cmd.trimPlacement("c2", "right", s(12.2)));
    e.dispatch(cmd.addTextClip(s(1), { text: "Hi" }, "t1"));
    e.dispatch(cmd.setTransform("t1", { x: 0.9 }));
    e.dispatch(cmd.setClipLink("t1", false));
    const kinds = timelineReview.reviewLint(e.getState().project, { hasBlob: (k) => k !== "w" }).map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["gap", "short-clip", "missing-asset", "text-off-frame", "unlinked-layer"]));
    const r = await runTimelineTool(e, source(2), "review_lint", {});
    expect(r.text).toContain("black-frame");
  });

  it("audioIssues reports clipping and silence", () => {
    const sr = 1000, a = new Float32Array(sr * 5);
    for (let i = 0; i < sr; i++) a[i] = i % 2 ? 1 : -1;
    const issues = audioIssues({ channels: [a], sampleRate: sr });
    expect(issues.map((i) => i.kind)).toEqual(expect.arrayContaining(["audio-clipping", "audio-silence"]));
  });

  it("registers story and timeline tools and unregisters them by name", () => {
    const e = setup(), names = new Set<string>(), gone: string[] = [];
    const off = registerAgentTools(e, { registerTool: (t) => { if (t.name === "get_guide") throw new Error("boom"); names.add(t.name); return undefined; }, unregisterTool: (n) => gone.push(n) });
    expect(names.has("capture_frame") && names.has("review_lint") && names.has("add_shot")).toBe(true);
    off();
    expect(gone).toEqual(ALL_AGENT_TOOLS.map((t) => t.name).filter((n) => n !== "get_guide"));
  });
});

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

  it("P13: set_clip_props rejects unknown presets, fields and out-of-range values with the reason, changing nothing", async () => {
    const e = setup();
    e.dispatch(cmd.addTextClip(s(1), { text: "Hi" }, "t1"));
    const before = e.getState().project;
    const bad = async (args: Record<string, unknown>, msg: RegExp) => { const r = await runTimelineTool(e, undefined, "set_clip_props", args); expect(r.ok).toBe(false); expect(r.text).toMatch(msg); expect(e.getState().project).toBe(before); };
    await bad({ id: "c1", volume: 3 }, /"volume" must be a number from 0 to 2/);
    await bad({ id: "c1", speed: 0.1 }, /"speed"/);
    await bad({ id: "c1", transform: { x: 0.1, zoom: 2 } }, /Unknown transform field "zoom"/);
    await bad({ id: "c1", effect: { preset: "blur" } }, /only applies to effect clips/);
    await bad({ id: "c1", blend: "nope" }, /Unknown blend "nope"/);
    await bad({ id: "c1", colour: 1 }, /Unknown property "colour"/);
    await bad({ id: "c1", text: { text: "x" } }, /only applies to text clips/);
    await bad({ id: "t1", text: { size: 5 } }, /"text.size"/);
    await bad({ id: "c1", volume: 1.5, transform: { opacity: 2 } }, /"transform.opacity"/);
  });

  it("P13: effect presets and params are checked against the registry (blur exists)", async () => {
    const { clipPropsErrors } = await import("./timelineTools");
    const { getPreset } = await import("../../registry");
    const blur = getPreset("videoEffect", "blur")!;
    expect(blur).toBeTruthy();
    const fx = { id: "f", clipType: "effect", effect: { preset: "blur" } } as never;
    expect(clipPropsErrors({ id: "f", effect: { preset: "blur" } }, fx)).toEqual([]);
    expect(clipPropsErrors({ id: "f", effect: { preset: "blurr" } }, fx).join()).toMatch(/Unknown effect preset "blurr". Use one of: .*blur/);
    expect(clipPropsErrors({ id: "f", effect: { preset: "blur", params: { nope: 1 } } }, fx).join()).toMatch(/has no param "nope"/);
    const num = blur.params.find((p) => p.type === "number") as { key: string; max: number } | undefined;
    if (num) expect(clipPropsErrors({ id: "f", effect: { preset: "blur", params: { [num.key]: num.max + 1 } } }, fx).join()).toMatch(new RegExp(`effect.params.${num.key}`));
  });

  it("P13: text-off-frame uses the text's full bounds, not just its centre", () => {
    const e = setup();
    e.dispatch(cmd.addTextClip(s(1), { text: "A very long headline that runs wide", size: 0.12 }, "t1"));
    e.dispatch(cmd.setTransform("t1", { x: 0.3 }));
    e.dispatch(cmd.addTextClip(s(1), { text: "ok", size: 0.05 }, "t2"));
    e.dispatch(cmd.setTransform("t2", { x: 0.3, y: 0.3 }));
    const off = timelineReview.reviewLint(e.getState().project).filter((i) => i.kind === "text-off-frame");
    expect(off.map((i) => i.clip)).toEqual(["t1"]);
    expect(off[0].message).toMatch(/right edge/);
    const b = timelineReview.textBounds(findPlacement(root(e.getState().project), "t2")!.placement, 16 / 9);
    expect(b.right).toBeLessThan(1);
  });
});

describe("P14 spatial set_clip_props", () => {
  it("sets position, keys (seconds) and output; rejects bad values and non-sound clips", async () => {
    const e = setup();
    e.dispatch(cmd.addAssetToTimeline("a", 0, undefined, "au"));
    let r = await runTimelineTool(e, undefined, "set_clip_props", { id: "au", position: { azimuth: -90, distance: 0.2, width: 1 }, positionKeys: [{ t: 1, azimuth: 90, distance: 0.5 }], audioOutput: { mode: "binaural" } });
    expect(r.ok).toBe(true);
    const pl = findPlacement(root(e.getState().project), "au")!.placement;
    expect(pl.position).toMatchObject({ azimuth: -90, distance: 0.2 });
    expect(pl.positionKeys![0].t).toBe(s(1));
    expect(e.getState().project.settings.audioOutput?.mode).toBe("binaural");
    const clip = json((await runTimelineTool(e, undefined, "get_timeline", {})).text).tracks.flatMap((t: { clips: { id: string }[] }) => t.clips).find((c: { id: string }) => c.id === "au");
    expect(clip.positionKeys[0].t).toBe(1);
    const before = e.getState().project;
    r = await runTimelineTool(e, undefined, "set_clip_props", { id: "au", position: { azimuth: 500, distance: 0 } });
    expect(r.ok).toBe(false); expect(e.getState().project).toBe(before);
    r = await runTimelineTool(e, undefined, "set_clip_props", { id: "au", pan: 3 });
    expect(r.ok).toBe(false);
    r = await runTimelineTool(e, undefined, "set_clip_props", { id: "au", pan: -1 });
    expect(r.ok).toBe(true);
    expect(findPlacement(root(e.getState().project), "au")!.placement.position).toMatchObject({ azimuth: -90, distance: 0 });
    r = await runTimelineTool(e, undefined, "set_clip_props", { id: "au", position: null, positionKeys: null });
    expect(findPlacement(root(e.getState().project), "au")!.placement.position).toBeUndefined();
  });

  it("P20 promote_overlay: replace splits the main clip; insert inside a clip asks for a position; one undo step", async () => {
    const e = setup();
    e.dispatch(cmd.addTrack("video"));
    const main = (p: Project) => root(p).tracks.filter((t) => t.kind === "video").at(-1)!;
    const ov = root(e.getState().project).tracks.find((t) => t.kind === "video" && t.id !== main(e.getState().project).id)!;
    e.dispatch(cmd.addAssetToTimeline("w", s(4), ov.id, "o1"));
    let r = await runTimelineTool(e, undefined, "promote_overlay", { clipId: "c1" });
    expect(r.ok).toBe(false);
    r = await runTimelineTool(e, undefined, "promote_overlay", { clipId: "o1", mode: "insert" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain('position "before" or "after"');
    r = await runTimelineTool(e, undefined, "promote_overlay", { clipId: "o1" });
    expect(r.ok && r.changed).toBe(true);
    expect(json(r.text).mainTrack.map((c: { start: number; duration: number }) => [c.start, c.duration])).toEqual([[0, 4], [4, 4], [8, 2]]);
    e.undo();
    r = await runTimelineTool(e, undefined, "promote_overlay", { clipId: "o1", mode: "insert", position: "after" });
    expect(json(r.text).mainTrack.map((c: { id: string; start: number }) => [c.id, c.start])).toEqual([["c1", 0], ["o1", 10]]);
    expect(ALL_AGENT_TOOLS.some((t) => t.name === "promote_overlay")).toBe(true);
  });
});

describe("P26 slip_clip / replace_clip_asset", () => {
  const pl = (e: Engine) => findPlacement(root(e.getState().project), "c1")!.placement;
  it("slip_clip moves the source window, keeps place and length, one undo step", async () => {
    const e = setup();
    e.dispatch(cmd.trimPlacement("c1", "right", s(3)));
    const r = await runTimelineTool(e, undefined, "slip_clip", { clipId: "c1", inSec: 4 });
    expect(r.ok && r.changed).toBe(true);
    expect(pl(e)).toMatchObject({ startTicks: 0, durationTicks: s(3), sourceInTicks: s(4) });
    await runTimelineTool(e, undefined, "slip_clip", { clipId: "c1", inSec: 99 });
    expect(pl(e).sourceInTicks).toBe(s(7));
    e.undo(); e.undo(); expect(pl(e).sourceInTicks).toBe(0);
    expect((await runTimelineTool(e, undefined, "slip_clip", { clipId: "c1" })).ok).toBe(false);
  });
  it("replace_clip_asset asks for onShort when the source is too short", async () => {
    const e = setup();
    let r = await runTimelineTool(e, undefined, "replace_clip_asset", { clipId: "c1", assetId: "w" });
    expect(r.ok).toBe(false); expect(r.text).toContain("onShort");
    expect((await runTimelineTool(e, undefined, "replace_clip_asset", { clipId: "c1", assetId: "a" })).ok).toBe(false);
    r = await runTimelineTool(e, undefined, "replace_clip_asset", { clipId: "c1", assetId: "w", onShort: "shorten" });
    expect(r.ok).toBe(true);
    expect(pl(e)).toMatchObject({ durationTicks: s(4), source: { assetId: "w" } });
    e.undo();
    await runTimelineTool(e, undefined, "replace_clip_asset", { clipId: "c1", assetId: "w", onShort: "hold" });
    expect(pl(e)).toMatchObject({ durationTicks: s(10), source: { assetId: "w" } });
    expect(pl(e).holdEndTicks).toBeDefined();
  });
});

/** P43: three reference types (graphic / audio / tracker), storyboard trackers[] + references, needs-tracking. */
import { describe, expect, it } from "vitest";
import { createProject, inputSourceOf, missingTrackers, refType, resolveSource, sourceChoices, sourceLabel, validateManifest, type MediaRef, type Project } from ".";
import * as board from "./storyboard";
import { storyDocJson, validateStoryboard } from "./storyJson";
import { sendStory } from "./storySend";
import { reviewLint } from "./timelineReview";
import { TICKS_PER_SECOND as S } from "./time";

function proj(): Project {
  const p = createProject("i");
  const c = p.compositions[p.rootCompositionId];
  const tr = { id: "mt1", name: "Subject", inS: 0, outS: 10, srcW: 640, srcH: 360, samples: [{ s: 0, x: 0.5, y: 0.5, w: 0.1, h: 0.1, scale: 1, conf: 0.9 }] };
  c.tracks = [
    { id: "ov", kind: "video", name: "Overlay 1", placements: [{ id: "h1", startTicks: 0, durationTicks: 10, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "h", versionId: "hv" }, clipType: "html" }] },
    { id: "mn", kind: "video", name: "Main", placements: [{ id: "v1", startTicks: 0, durationTicks: 10, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "v", versionId: "vv" }, clipType: "video", motionTracks: [tr] }] },
    { id: "au", kind: "audio", name: "Music", placements: [{ id: "a1", startTicks: 0, durationTicks: 10, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "av" }, clipType: "audio" }] },
  ] as Project["compositions"][string]["tracks"];
  p.assets = { a: { id: "a", kind: "audio", name: "song.mp3", versions: [] }, v: { id: "v", kind: "video", name: "drone.mp4", versions: [] }, h: { id: "h", kind: "html", name: "hud.html", versions: [] } } as unknown as Project["assets"];
  return p;
}

describe("P43 reference types", () => {
  it("maps the older names and validates the new ones", () => {
    expect([refType("scene"), refType("beat"), refType("track"), refType("graphic"), refType("audio"), refType("tracker")]).toEqual(["graphic", "audio", "tracker", "graphic", "audio", "tracker"]);
    const codes = (inputs: unknown) => validateManifest({ format: "dionysus.htmlclip/1", inputs }, []).map((i) => i.code);
    expect(codes({ pic: { type: "graphic" }, snd: { type: "audio" }, target: { type: "tracker" } })).toEqual([]);
    expect(codes({ x: { type: "image" } })).toContain("input-type");
  });
  it("each picker lists only valid targets", () => {
    const p = proj();
    expect(sourceChoices(p, "graphic", "h1").map((c) => c.label)).toEqual(["Program", "Overlay 1", "Main", "drone"]);
    expect(sourceChoices(p, "audio", "h1").map((c) => c.label)).toEqual(["Mix", "Overlay 1", "Main", "drone", "Music", "song"]);
    expect(sourceChoices(p, "tracker", "h1").map((c) => [c.label, c.source])).toEqual([["None", "none"], ["drone · Subject", "clip:v1#mt1"]]);
    expect(resolveSource(p, "Music", "graphic")).toHaveProperty("error");
    expect(resolveSource(p, "program", "audio")).toEqual({ error: '"program" is for graphic references.' });
    expect(resolveSource(p, "v1#Subject", "tracker")).toEqual({ source: "clip:v1#mt1" });
  });
  it("a tracker named by the storyboard binds by name once it exists; until then found:false + needs-tracking", () => {
    const p = proj();
    const h = p.compositions[p.rootCompositionId].tracks[0].placements[0];
    h.htmlInputs = { target: "clip:v1#@Drone" };
    expect(inputSourceOf(p, h, "target", "tracker")).toBe("none");
    expect(sourceLabel(p, "clip:v1#@Drone")).toBe("drone · Drone (not set yet)");
    expect(missingTrackers(p)).toEqual([{ clipId: "h1", input: "target", targetId: "v1", name: "Drone" }]);
    const lint = reviewLint(p).filter((i) => i.kind === "needs-tracking");
    expect(lint).toHaveLength(1);
    expect(lint[0].severity).toBe("warning");
    expect(lint[0].message).toContain('name the tracker "Drone"');
    p.compositions[p.rootCompositionId].tracks[1].placements[0].motionTracks![0].name = "drone";
    expect(inputSourceOf(p, h, "target", "tracker")).toBe("clip:v1#mt1");
    expect(missingTrackers(p)).toEqual([]);
  });
});

const doc = () => ({
  format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
  assets: [{ id: "hud", name: "HUD", type: "html", prompt: "hud", qa: [] }],
  shots: [{
    id: "s1", title: "Drone", durationSec: 3, prompt: "a drone", assets: [], qa: [],
    trackers: [{ name: "Drone", clip: "main", target: "the drone's body" }],
    layers: [{ id: "l1", type: "html", asset: "hud", startSec: 0, endSec: 3, box: { x: 0, y: 0, width: 1, height: 1 },
      params: { label: "TARGET", target: { type: "tracker", clip: "main", track: "Drone" }, pic: { type: "graphic", clip: "main" }, snd: { type: "audio" }, bad: { type: "tracker", clip: "main", track: "Ghost" } } }],
  }],
});

describe("P43 storyboard trackers and references", () => {
  it("imports trackers as needs-tracking warnings (not errors) and references out of params", () => {
    const r = validateStoryboard(doc());
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.warnings.some((w) => /Needs tracking/.test(w.message) && /draw a box around the drone's body/.test(w.message) && /"Drone"/.test(w.message))).toBe(true);
    expect(r.warnings.some((w) => /Tracker "Ghost" on "main" isn't planned/.test(w.message))).toBe(true);
    const l = r.doc.shots[0].layers![0] as { params?: Record<string, unknown>; refs?: Record<string, unknown> };
    expect(l.params).toEqual({ label: "TARGET" });
    expect(l.refs).toEqual({ target: { type: "tracker", clip: "main", track: "Drone" }, pic: { type: "graphic", clip: "main" }, snd: { type: "audio" }, bad: { type: "tracker", clip: "main", track: "Ghost" } });
    expect(r.doc.shots[0].trackers).toEqual([{ name: "Drone", clip: "main", target: "the drone's body" }]);
    // round trip keeps them
    const again = validateStoryboard(JSON.parse(storyDocJson(r.doc)));
    expect(again.ok && again.doc.shots[0].trackers).toEqual(r.doc.shots[0].trackers);
    expect(again.ok && (again.doc.shots[0].layers![0] as { refs?: unknown }).refs).toEqual(l.refs);
  });
  it("send binds references on the code clip (tracker by name), and the shot keeps its trackers", () => {
    const r = validateStoryboard(doc());
    if (!r.ok) throw new Error("invalid");
    let p = board.setStoryboard(createProject("s"), board.storyboardFromDoc(r.doc));
    expect(p.storyboard!.shots.s1.trackers).toEqual([{ name: "Drone", clip: "main", target: "the drone's body" }]);
    const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 5 * S };
    p = board.addStoryVersion(p, { shot: "s1" }, vid, { versionId: "v1", now: "2026-11-05T00:00:00Z" });
    p = board.addStoryVersion(p, { slot: "hud" }, { blobKey: "h", mime: "text/html" }, { versionId: "h1", now: "2026-11-05T00:00:00Z" });
    const { project } = sendStory(p);
    const all = project.compositions[project.rootCompositionId].tracks.flatMap((t) => t.placements);
    const main = all.find((x) => x.storyShot === "s1")!, hud = all.find((x) => x.clipType === "html")!;
    expect(hud.htmlInputs).toEqual({ target: `clip:${main.id}#@Drone`, pic: `clip:${main.id}`, bad: `clip:${main.id}#@Ghost` });
    expect(missingTrackers(project).map((m) => m.name)).toEqual(["Drone", "Ghost"]);
  });
});

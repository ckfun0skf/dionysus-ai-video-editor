import { describe, expect, it } from "vitest";
import { Engine, cmd } from "../engine";
import { createProject, type Placement, type Project } from "./model";
import * as ops from "./ops";
import { linkedTo } from "./links";

const S = 120000;
const vid = (id: string, start: number, dur: number): Placement => ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 0, clipType: "video", source: { kind: "assetVersion", assetId: id, versionId: id } } as Placement);
const txt = (id: string, start: number, dur: number, parent?: string): Placement => ({ id, startTicks: start, durationTicks: dur, sourceInTicks: 0, clipType: "text", text: { text: id }, source: { kind: "assetVersion", assetId: "", versionId: "" }, ...(parent ? { link: { parent } } : {}) } as Placement);
const root = (p: Project) => p.compositions[p.rootCompositionId];
function setup(children: Placement[] = [txt("t1", 2 * S, S, "b")]) {
  const p = createProject("t");
  let c = p.compositions[p.rootCompositionId];
  c = ops.addTrack(c, "text", "ov");
  const m = ops.mainTrack(c)!;
  c = { ...c, tracks: c.tracks.map((t) => t.id === m.id ? { ...t, placements: [vid("a", 0, 2 * S), { ...vid("b", 2 * S, 4 * S), sourceInTicks: 5 * S }, vid("c", 6 * S, 2 * S)] } : t.id === "ov" ? { ...t, placements: children } : t) };
  const asset = (id: string) => ({ id, kind: "video", name: id, versions: [{ id, createdAt: "", media: { blobKey: id, mime: "video/mp4", durationTicks: 60 * S }, provenance: { source: "import", inputs: [] } }] });
  const e = new Engine({ ...p, assets: Object.fromEntries(["a", "b", "c"].map((id) => [id, asset(id)])) as Project["assets"], compositions: { [c.id]: c } });
  const get = (id: string) => root(e.getState().project).tracks.flatMap((t) => t.placements).find((x) => x.id === id);
  return { e, get };
}

describe("Link to main (P9-LINK)", () => {
  it("ripple-deleting an earlier main clip shifts linked clips with their parent (one undo step)", () => {
    const { e, get } = setup();
    expect(e.dispatch(cmd.deleteClips(["a"], true))).toBe(true);
    expect(get("t1")!.startTicks).toBe(0);
    e.undo();
    expect(get("t1")!.startTicks).toBe(2 * S);
  });
  it("reordering keeps the offset; unlinked clips stay put", () => {
    const { e, get } = setup([txt("t1", 3 * S, S, "b"), txt("u", 7 * S, S)]);
    e.dispatch(cmd.reorderMain("b", 0));
    expect(get("t1")!.startTicks).toBe(S);
    expect(get("u")!.startTicks).toBe(7 * S);
  });
  it("deleting the parent deletes its linked clips; undo restores both", () => {
    const { e, get } = setup();
    e.dispatch(cmd.deleteClips(["b"]));
    expect(get("t1")).toBeUndefined();
    e.undo();
    expect(get("t1")!.link).toEqual({ parent: "b" });
  });
  it("trimming the parent shorter cuts the linked clip to fit, or removes it", () => {
    const { e, get } = setup([txt("t1", 4 * S, 2 * S, "b"), txt("t2", 5.5 * S, S / 2, "b")]);
    e.dispatch(cmd.trimPlacement("b", "right", 5 * S));
    expect(get("t1")).toMatchObject({ startTicks: 4 * S, durationTicks: S });
    expect(get("t2")).toBeUndefined();
  });
  it("left-trim keeps a clip anchored to the content", () => {
    const { e, get } = setup([txt("t1", 4 * S, S, "b")]);
    e.dispatch(cmd.trimPlacement("b", "left", 3 * S));
    expect(get("t1")!.startTicks).toBe(4 * S);
  });
  it("split: the linked clip goes to the half holding its start", () => {
    const { e, get } = setup([txt("t1", 2 * S, S, "b"), txt("t2", 5 * S, S, "b")]);
    e.dispatch(cmd.splitPlacement("b", 4 * S, "b2"));
    expect(get("t1")!.link).toEqual({ parent: "b" });
    expect(get("t2")).toMatchObject({ startTicks: 5 * S, link: { parent: "b2" } });
  });
  it("dragging a linked clip re-links to the main clip under its new start", () => {
    const { e, get } = setup();
    e.dispatch(cmd.movePlacement("t1", "ov", 7 * S));
    expect(get("t1")!.link).toEqual({ parent: "c" });
  });
  it("new clips auto-link; the project setting turns it off; toggle links/unlinks", () => {
    const { e, get } = setup([]);
    e.dispatch(cmd.addTextClip(S, {}, "n1"));
    expect(get("n1")!.link).toEqual({ parent: "a" });
    e.dispatch(cmd.setClipLink("n1", false));
    expect(get("n1")!.link).toBeUndefined();
    e.dispatch(cmd.setClipLink("n1", true));
    expect(get("n1")!.link).toEqual({ parent: "a" });
    e.dispatch(cmd.setProjectSettings({ autoLink: false }));
    e.dispatch(cmd.addTextClip(3 * S, {}, "n2"));
    expect(get("n2")!.link).toBeUndefined();
    expect(linkedTo(root(e.getState().project), "a").map((p) => p.id)).toEqual(["n1"]);
  });
  it("old projects without links are unchanged by edits", () => {
    const { e, get } = setup([txt("u", 3 * S, S)]);
    e.dispatch(cmd.deleteClips(["b"], true));
    expect(get("u")).toMatchObject({ startTicks: 3 * S });
    expect(get("u")!.link).toBeUndefined();
  });
});

/** P38 (item 12): code packages as effects and transitions. */
import { describe, expect, it } from "vitest";
import { codePresetId, codeRoleIssue, createProject, lintHtmlClip, TICKS_PER_SECOND, transitions, writeManifest, type Asset, type Project } from "../domain";
import { mainTrack } from "../domain/ops";
import { codeEffectsAt, effectFrameAt } from "../render/effects";
import { cmd, Engine } from ".";

const S = TICKS_PER_SECOND;
const root = (p: Project) => p.compositions[p.rootCompositionId];
const asset = (id: string, kind: Asset["kind"], role?: "effect" | "transition"): Asset => ({ id, kind, name: id, selectedVersionId: `${id}v`, versions: [{ id: `${id}v`, createdAt: "", media: { blobKey: id, mime: "x", durationTicks: 4 * S, ...(role ? { role } : {}) }, provenance: { source: "import", inputs: [] } }] });
function setup() {
  const e = new Engine(createProject("c"));
  e.dispatch([cmd.importAsset(asset("v1", "video")), cmd.importAsset(asset("v2", "video")), cmd.importAsset(asset("clip", "html")), cmd.importAsset(asset("fx", "html", "effect")), cmd.importAsset(asset("tr", "html", "transition"))]);
  e.dispatch(cmd.addAssetsInSequence(["v1", "v2"], 0));
  return e;
}

describe("code package roles (P38)", () => {
  it("lint: role must be known and match where the package is used; effects/transitions are warned when they ignore their pictures", () => {
    const page = (m: object, body = "") => writeManifest(`<canvas></canvas><script type="module">dionysus.clip({ render(t, ctx) { ${body} } })</script>`, { format: "dionysus.htmlclip/1", ...m });
    const codes = (h: string, expectRole?: "clip" | "effect" | "transition") => lintHtmlClip(h, { libs: [], expectRole }).issues.map((i) => `${i.level}:${i.code}`);
    expect(codes(page({ role: "filter" }))).toContain("error:role");
    expect(codes(page({ role: "effect" }), "clip")).toContain("error:role-mismatch");
    expect(codes(page({}), "effect")).toContain("error:role-mismatch");
    expect(codes(page({ role: "effect" }, "g.drawImage(ctx.source, 0, 0)"), "effect")).not.toContain("error:role-mismatch");
    expect(codes(page({ role: "effect" }))).toContain("warning:effect-source");
    expect(codes(page({ role: "transition" }, "ctx.from; ctx.to"))).not.toContain("warning:transition-sides");
    expect(codes(page({ role: "transition" }))).toContain("warning:transition-sides");
  });

  it("an effect or transition package can't go on a track, and a clip package can't be an effect or transition", () => {
    const e = setup(), p = () => e.getState().project;
    expect(codeRoleIssue(p(), "fx", "clip")).toMatch(/is an effect/);
    expect(codeRoleIssue(p(), "clip", "effect")).toMatch(/is a clip/);
    expect(codeRoleIssue(p(), "v1", "transition")).toMatch(/not a code package/);
    expect(e.dispatch(cmd.addAssetToTimeline("fx", 0))).toBe(false);
    expect(e.dispatch(cmd.addAssetsInSequence(["tr"], 0))).toBe(false);
    expect(e.dispatch(cmd.addEffectClip(0, codePresetId("clip")))).toBe(false);
    expect(e.dispatch(cmd.setTransition(mainTrack(root(p()))!.placements[1].id, { kind: codePresetId("fx"), durationTicks: S / 2 }))).toBe(false);
  });

  it("a code effect clip is listed by codeEffectsAt (not the preset path) and a code transition carries its asset", () => {
    const e = setup();
    expect(e.dispatch(cmd.addEffectClip(0, codePresetId("fx"), undefined, "e1"))).toBe(true);
    const comp = root(e.getState().project);
    expect(effectFrameAt(comp, S, "main")).toBeUndefined();
    expect(codeEffectsAt(comp, S, "main").map((x) => x.assetId)).toEqual(["fx"]);
    expect(codeEffectsAt(comp, S, "all")).toEqual([]);
    e.dispatch(cmd.setEffectScope("e1", "all"));
    expect(codeEffectsAt(root(e.getState().project), S, "all")).toHaveLength(1);
    const next = mainTrack(root(e.getState().project))!.placements[1];
    expect(e.dispatch(cmd.setTransition(next.id, { kind: codePresetId("tr"), durationTicks: S / 2 }))).toBe(true);
    const at = transitions.trackTransitions(mainTrack(root(e.getState().project))!);
    expect(at[0]).toMatchObject({ code: "tr", kind: { label: "Custom (code)", category: "Custom (code)" } });
    expect(at[0].kind.mix(0.3)).toEqual({ out: 1, in: 1 });
  });
});

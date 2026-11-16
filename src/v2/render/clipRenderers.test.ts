import { describe, expect, it } from "vitest";
import { CLIP_RENDERER_PATHS, CLIP_RENDERER_PROBLEMS, CLIP_RENDERERS, checkClipRenderer, clipRendererFor, loadClipRenderers, type ClipRenderer } from "./clipRenderers";
import { TEXT_SOURCE, type Placement } from "../domain/model";
import { PLACEHOLDER_RENDERER } from "./placeholderSlate";

const pl = (over: Partial<Placement>): Placement => ({ id: "p", startTicks: 0, durationTicks: 1, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "image", ...over });

describe("P67/P68 clip renderer table", () => {
  it("discovers the moved renderers with no problems", () => {
    expect(CLIP_RENDERER_PROBLEMS).toEqual([]);
    // P73: the placeholder slate is shared host code (render/placeholderSlate.ts), no longer a clip type renderer.
    const ids = ["audio", "blank", "html", "image", "text", "unknown", "video"];
    expect([...CLIP_RENDERERS.keys()].sort()).toEqual(ids);
    expect(CLIP_RENDERER_PATHS.sort()).toEqual(ids.map((id) => `../clipTypes/${id}/render.ts`));
  });
  it("stateless types draw, media and code types run per frame", () => {
    for (const id of ["blank", "text", "unknown"]) expect([typeof CLIP_RENDERERS.get(id)!.draw, typeof CLIP_RENDERERS.get(id)!.frame]).toEqual(["function", "undefined"]);
    for (const id of ["audio", "html", "image", "video"]) expect([typeof CLIP_RENDERERS.get(id)!.draw, typeof CLIP_RENDERERS.get(id)!.frame]).toEqual(["undefined", "function"]);
  });
  it("picks the renderer by variant, unknown for unregistered types, none for effects", () => {
    expect(clipRendererFor(pl({ clipType: "text" }))?.id).toBe("text");
    expect(clipRendererFor(pl({ placeholder: { label: "x" } }))?.id).toBe("placeholder");
    // P73: a placeholder of any type gets the host slate before any plugin lookup.
    for (const t of ["image", "video", "audio", "html", "text", "effect", "scene3d"] as const) expect(clipRendererFor(pl({ clipType: t as Placement["clipType"], placeholder: { label: "x" } }))).toBe(PLACEHOLDER_RENDERER);
    expect(clipRendererFor(pl({ blank: { color: "#000000" } }))?.id).toBe("blank");
    for (const t of ["image", "video", "audio", "html"] as const) expect(clipRendererFor(pl({ clipType: t }))?.id).toBe(t);
    expect(clipRendererFor(pl({ clipType: "scene3d" as Placement["clipType"] }))?.id).toBe("unknown");
    expect(clipRendererFor(pl({ clipType: "effect" }))).toBeUndefined();
  });
  it("reports invalid renderer modules", () => {
    const draw = () => undefined;
    expect(checkClipRenderer({ id: "text", draw }, "text")).toEqual([]);
    expect(checkClipRenderer(undefined, "text")[0]).toMatch(/no default export/);
    expect(checkClipRenderer({ id: "txt", draw }, "text").join()).toMatch(/must equal its folder name/);
    expect(checkClipRenderer({ id: "text" }, "text").join()).toMatch(/exactly one of draw \/ frame/);
    expect(checkClipRenderer({ id: "text", draw, frame: draw }, "text").join()).toMatch(/exactly one of draw \/ frame/);
    expect(checkClipRenderer({ id: "video", frame: draw }, "video")).toEqual([]);
    expect(checkClipRenderer({ id: "scene", draw }, "scene").join()).toMatch(/no clip type "scene"/);
    const { renderers, problems } = loadClipRenderers({ "../clipTypes/text/render.ts": { default: { id: "text", draw } as ClipRenderer }, "../clipTypes/x/render.ts": {} });
    expect([...renderers.keys()]).toEqual(["text"]);
    expect(problems).toHaveLength(1);
  });
});

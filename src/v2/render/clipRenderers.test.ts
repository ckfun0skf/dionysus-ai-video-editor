import { describe, expect, it } from "vitest";
import { CLIP_RENDERER_PATHS, CLIP_RENDERER_PROBLEMS, CLIP_RENDERERS, checkClipRenderer, clipRendererFor, loadClipRenderers, type ClipRenderer } from "./clipRenderers";
import { TEXT_SOURCE, type Placement } from "../domain/model";

const pl = (over: Partial<Placement>): Placement => ({ id: "p", startTicks: 0, durationTicks: 1, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "image", ...over });

describe("P67 clip renderer table", () => {
  it("discovers the moved renderers with no problems", () => {
    expect(CLIP_RENDERER_PROBLEMS).toEqual([]);
    expect([...CLIP_RENDERERS.keys()].sort()).toEqual(["blank", "placeholder", "text"]);
    expect(CLIP_RENDERER_PATHS.sort()).toEqual(["../clipTypes/blank/render.ts", "../clipTypes/placeholder/render.ts", "../clipTypes/text/render.ts"]);
  });
  it("picks the renderer by variant, and none for types still drawn inline", () => {
    expect(clipRendererFor(pl({ clipType: "text" }))?.id).toBe("text");
    expect(clipRendererFor(pl({ placeholder: { label: "x" } }))?.id).toBe("placeholder");
    expect(clipRendererFor(pl({ blank: { color: "#000000" } }))?.id).toBe("blank");
    for (const t of ["image", "video", "audio", "html", "effect"] as const) expect(clipRendererFor(pl({ clipType: t }))).toBeUndefined();
  });
  it("reports invalid renderer modules", () => {
    const draw = () => undefined;
    expect(checkClipRenderer({ id: "text", draw }, "text")).toEqual([]);
    expect(checkClipRenderer(undefined, "text")[0]).toMatch(/no default export/);
    expect(checkClipRenderer({ id: "txt", draw }, "text").join()).toMatch(/must equal its folder name/);
    expect(checkClipRenderer({ id: "text" }, "text").join()).toMatch(/draw must be a function/);
    expect(checkClipRenderer({ id: "scene", draw }, "scene").join()).toMatch(/no clip type "scene"/);
    const { renderers, problems } = loadClipRenderers({ "../clipTypes/text/render.ts": { default: { id: "text", draw } as ClipRenderer }, "../clipTypes/x/render.ts": {} });
    expect([...renderers.keys()]).toEqual(["text"]);
    expect(problems).toHaveLength(1);
  });
});

// @vitest-environment jsdom
/** P38 (item 12): Effects / Transitions → Custom (code); effect/transition packages stay out of the add-media lists. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, readManifest, type Asset } from "../domain";
import { cmd, Engine } from "../engine";
import { htmlRoleOf } from "../persistence";
import { EffectPicker } from "./EffectPicker";
import { projectMediaList } from "./projectMedia";
import { newCodeClipHtml } from "./codeSamples";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const code = (id: string, role?: "effect" | "transition"): Asset => ({ id, kind: "html", name: `${id}.html`, selectedVersionId: "v", versions: [{ id: "v", createdAt: "", media: { blobKey: id, mime: "text/html", ...(role ? { role } : {}) }, provenance: { source: "import", inputs: [] } }] });

describe("code effects and transitions UI (P38)", () => {
  it("starters carry their role, which import reads", () => {
    expect(readManifest(newCodeClipHtml("effect")).role).toBe("effect");
    expect(htmlRoleOf(newCodeClipHtml("transition"))).toBe("transition");
    expect(htmlRoleOf(newCodeClipHtml())).toBeUndefined();
    expect(newCodeClipHtml("effect")).toContain("ctx.source");
    expect(newCodeClipHtml("transition")).toContain("ctx.from");
  });

  it("effect and transition packages are not offered as media", () => {
    const p = createProject("m");
    p.assets = { a: code("a"), fx: code("fx", "effect"), tr: code("tr", "transition") };
    expect(projectMediaList(p).map((m) => m.id)).toEqual(["a"]);
  });

  it("Custom (code) tab lists effect packages, applies one, and offers New code effect", () => {
    const e = new Engine(createProject("x"));
    e.dispatch([cmd.importAsset(code("fx", "effect")), cmd.importAsset(code("plain"))]);
    const onNewCode = vi.fn(), onAdded = vi.fn();
    const el = document.createElement("div"); document.body.appendChild(el);
    act(() => { createRoot(el).render(<EffectPicker engine={e} at={0} onAdded={onAdded} onNewCode={onNewCode} />); });
    const tab = [...el.querySelectorAll('[role="tab"]')].find((b) => b.textContent === "Custom (code)") as HTMLButtonElement;
    act(() => tab.click());
    const tiles = [...el.querySelectorAll(".v2-codetile")].map((b) => b.getAttribute("aria-label"));
    expect(tiles).toEqual(["fx.html", "New code effect"]);
    act(() => (el.querySelector('[aria-label="fx.html"]') as HTMLButtonElement).click());
    const fx = e.getState().project.compositions[e.getState().project.rootCompositionId].tracks.flatMap((t) => t.placements).find((p) => p.clipType === "effect");
    expect(fx?.effect?.preset).toBe("code:fx");
    act(() => (el.querySelector('[aria-label="New code effect"]') as HTMLButtonElement).click());
    expect(onNewCode).toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { Engine } from "../engine";
import { createProject, findPlacement, transformOf, type Placement } from "../domain";
import { TransformInspector } from "./Transform";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

function setup() {
  const p = createProject();
  const comp = p.compositions[p.rootCompositionId];
  const clip: Placement = { id: "v", startTicks: 0, durationTicks: 120000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "1" }, clipType: "image" };
  comp.tracks[0].placements.push(clip);
  const engine = new Engine(p);
  const el = document.createElement("div");
  const root = createRoot(el);
  const render = () => { const s = engine.getState().project; root.render(<TransformInspector engine={engine} placement={findPlacement(s.compositions[s.rootCompositionId], "v")!.placement} />); };
  engine.subscribe(render);
  return { engine, el, render, current: () => { const s = engine.getState().project; return findPlacement(s.compositions[s.rootCompositionId], "v")!.placement; } };
}

describe("TransformInspector", () => {
  it("edits as one undoable gesture and resets", async () => {
    const { engine, el, render, current } = setup();
    await act(async () => render());
    const scale = el.querySelector('input[aria-label="Scale"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      scale.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      for (const v of ["0.8", "0.6", "0.5"]) { setter.call(scale, v); scale.dispatchEvent(new Event("input", { bubbles: true })); }
      scale.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    expect(transformOf(current()).scale).toBe(0.5);
    expect(el.textContent).toContain("50%");
    await act(async () => { engine.undo(); });
    expect(current().transform).toBeUndefined();
    await act(async () => { engine.redo(); });
    await act(async () => { (Array.from(el.querySelectorAll("button")).find((b) => b.textContent === "Reset") as HTMLButtonElement).click(); });
    expect(current().transform).toBeUndefined();
  });
});

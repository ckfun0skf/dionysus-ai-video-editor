// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Engine, cmd } from "../engine";
import { createProject, findPlacement } from "../domain/model";
import { TextPanel } from "./TextPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TextPanel", () => {
  it("applies templates and effects as undoable steps", async () => {
    const e = new Engine(createProject("t"));
    e.dispatch(cmd.addTextClip(0, { text: "Hello" }, "a"));
    const get = () => { const p = e.getState().project; return findPlacement(p.compositions[p.rootCompositionId], "a")!.placement; };
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el);
    const render = () => act(async () => { root.render(<TextPanel engine={e} placement={get()} />); });
    await render();
    const btn = (t: string) => Array.from(el.querySelectorAll("button")).find((b) => b.textContent === t)!;
    await act(async () => { btn("Neon").click(); });
    expect(get().text!.effect).toBe("neon");
    expect(get().text!.text).toBe("Hello");
    await act(async () => { btn("Animation").click(); });
    await render();
    await act(async () => { btn("typewriter").click(); });
    expect(get().text!.animIn).toBe("typewriter");
    e.undo(); e.undo();
    expect(get().text!.effect ?? "none").toBe("none");
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { Timeline, buildRows } from "./Timeline";
import { Engine, cmd } from "../engine";
import { createProject, ops } from "../domain";

describe("[+] add track in a track-type mode (P1-ADD-TRACK)", () => {
  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  });

  it("adds a row at the bottom of the focused group only", () => {
    const p = createProject("t");
    const c = p.compositions[p.rootCompositionId];
    expect(buildRows(c, true).some((r) => r.type === "add")).toBe(false);
    expect(buildRows(c, true, undefined, "audio").at(-1)).toMatchObject({ type: "add", group: "audio" });
    expect(buildRows(c, false, undefined, "overlay").map((r) => r.type)).toContain("add");
    expect(buildRows(c, false, undefined, "main").some((r) => r.type === "add")).toBe(false);
  });

  it("each group adds the right kind of track", () => {
    for (const [g, kind] of [["audio", "audio"], ["overlay", "video"], ["text", "text"], ["effect", "effect"]] as const) {
      const p = createProject("t");
      const before = p.compositions[p.rootCompositionId].tracks.length;
      const next = cmd.addGroupTrack(g).apply(p);
      const comp = next.compositions[next.rootCompositionId];
      expect(comp.tracks.length).toBe(before + 1);
      expect(ops.tracksInGroup(comp, g).some((t) => t.kind === kind)).toBe(true);
    }
  });

  for (const centered of [true, false]) it(`tapping [+] adds an audio track (${centered ? "phone" : "desktop"})`, () => {
    const p = createProject("t");
    const engine = new Engine(p);
    const el = document.createElement("div");
    document.body.appendChild(el);
    act(() => { createRoot(el).render(<Timeline engine={engine} project={p} time={0} playing={false} onSeek={() => {}} onSelect={() => {}} pps={40} onZoom={() => {}} centered={centered} focus="audio" />); });
    const btn = el.querySelector<HTMLButtonElement>('button.v2-add-track[data-group="audio"]')!;
    expect(btn.getAttribute("aria-label")).toBe("Add Audio track");
    act(() => btn.click());
    const s = engine.getState().project;
    expect(s.compositions[s.rootCompositionId].tracks.filter((t) => t.kind === "audio")).toHaveLength(p.compositions[p.rootCompositionId].tracks.filter((t) => t.kind === "audio").length + 1);
  });
});

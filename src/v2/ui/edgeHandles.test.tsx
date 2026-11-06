// @vitest-environment jsdom
/** P36: on the main track a middle clip's edges are grabbable — the cut button there steps aside while the clip is selected. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Timeline } from "./Timeline";
import { Engine } from "../engine";
import { createProject } from "../domain";

describe("main-track edge handles vs cut buttons (P36)", () => {
  beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  });
  const mount = (selectedId?: string) => {
    const p = createProject();
    const mk = (id: string, start: number) => ({ id, startTicks: start, durationTicks: 240000, sourceInTicks: 0, source: { kind: "assetVersion" as const, assetId: "a", versionId: "1" }, clipType: "video" as const });
    p.compositions[p.rootCompositionId].tracks[0].placements.push(mk("c1", 0), mk("c2", 240000), mk("c3", 480000));
    const el = document.createElement("div"); document.body.appendChild(el);
    act(() => { createRoot(el).render(<Timeline engine={new Engine(p)} project={p} time={0} playing={false} onSeek={() => {}} selectedId={selectedId} onSelect={() => {}} pps={40} onZoom={() => {}} onTransition={() => {}} centered />); });
    return el;
  };
  const under = (el: HTMLElement) => [...el.querySelectorAll(".v2-trans")].map((b) => b.classList.contains("is-under-handle"));

  it("no selection: every cut button is live", () => {
    expect(under(mount())).toEqual([false, false]);
  });
  it("middle clip selected: both its edges give way to the trim handles", () => {
    const el = mount("c2");
    expect(under(el)).toEqual([true, true]);
    expect(el.querySelector('[data-placement-id="c2"] .v2-handle.left')).toBeTruthy();
    expect(el.querySelector('[data-placement-id="c2"] .v2-handle.right')).toBeTruthy();
  });
  it("first clip selected: only its end cut gives way", () => {
    expect(under(mount("c1"))).toEqual([true, false]);
  });
  it("CSS: handles sit above the cut button with a 44px grab area; a stepped-aside button takes no hits", () => {
    const css = readFileSync("src/v2/ui/v2.css", "utf8");
    expect(css).toMatch(/\.v2-clip \.v2-handle \{ z-index: 5; \}/);
    expect(css).toMatch(/\.v2-handle::before \{[^}]*left: -16px; right: -16px;/);
    expect(css).toMatch(/\.v2-trans\.is-under-handle \{ pointer-events: none;/);
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { board, createProject, series as S, type MediaRef } from "../../domain";
import { validateStoryboard } from "../../domain/storyJson";
import { Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { LANTERN_KEEPER } from "../../domain/__fixtures__/lanternKeeper";
import { agentStore, callAgentTool } from "../agent/webMcp";
import { SERIES_KEY, seriesStore, setProjectSeries } from "./seriesStore";
import { SeriesLibrary } from "./SeriesLibrary";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { document.body.innerHTML = ""; localStorage.clear(); seriesStore.reset(); });
const now = "2026-10-29T00:00:00Z";
/** A fresh episode with the same board (its own, unlinked "keeper"). */
function ep(name: string) {
  const r = validateStoryboard(JSON.parse(JSON.stringify(LANTERN_KEEPER)));
  if (!r.ok) throw new Error("fixture");
  return board.setStoryboard(createProject(name), board.storyboardFromDoc(r.doc));
}
function seeded() {
  const r = validateStoryboard(JSON.parse(JSON.stringify(LANTERN_KEEPER)));
  if (!r.ok) throw new Error("fixture");
  let p = board.setStoryboard(createProject("Ep1"), board.storyboardFromDoc(r.doc));
  p = board.addStoryVersion(p, { slot: "keeper" }, { blobKey: "k1", mime: "image/png" } as MediaRef, { versionId: "kv1", now });
  const s = S.promoteToSeries(S.createSeries("Lantern", now, "ser1"), p, "keeper", now)!.series;
  seriesStore.put(s);
  return s;
}

describe("Series store and library (P5)", () => {
  it("persists Series in local storage and joins a project to one", () => {
    seeded();
    expect(JSON.parse(localStorage.getItem(SERIES_KEY)!).ser1.name).toBe("Lantern");
    seriesStore.reset();
    expect(seriesStore.get("ser1")?.assets.keeper).toBeTruthy();
    expect(seriesStore.mediaKeys()).toContain("k1");
    const e = new Engine(createProject("Ep2"));
    setProjectSeries(e, "ser1");
    expect(e.getState().project.seriesId).toBe("ser1");
    setProjectSeries(e, undefined);
    expect(e.getState().project.seriesId).toBeUndefined();
  });

  it("library lists Series assets and Use in episode adds a linked asset", async () => {
    seeded();
    const e = new Engine(ep("Ep2")!);
    setProjectSeries(e, "ser1");
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const render = () => root.render(<SeriesLibrary engine={e} project={e.getState().project} storage={createMemoryStorage()} onClose={() => undefined} />);
    await act(async () => render());
    const tile = host.querySelector('[data-testid="series-asset-keeper"]')!;
    expect(tile.textContent).toContain("keeper · character");
    const use = [...tile.querySelectorAll("button")].find((b) => b.textContent === "Use in episode")!;
    await act(async () => use.click());
    expect(e.getState().project.storyboard!.slots.keeper.seriesRef).toBe("keeper");
    await act(async () => render());
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "In episode")).toBe(true);
    act(() => root.unmount());
  });

  it("WebMCP lists Series assets and uses one", () => {
    seeded();
    const e = new Engine(ep("Ep3")!);
    setProjectSeries(e, "ser1");
    agentStore.setEnabled(true);
    expect(callAgentTool(e, "list_series_assets", {}).content[0].text).toContain("keeper (character)");
    callAgentTool(e, "use_series_asset", { id: "keeper" });
    expect(e.getState().project.storyboard?.slots.keeper.seriesRef).toBe("keeper");
  });
});

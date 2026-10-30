// @vitest-environment jsdom
/** P3B UI: chroma key panel, audio FX panel, volume curve undo. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createProject, findPlacement, ops, type Asset, type Project } from "../domain";
import { cmd, Engine } from "../engine";
import { secondsToTicks as s } from "../domain/time";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
  if (!Blob.prototype.text) Blob.prototype.text = function (this: Blob) { return new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this); }); };
});
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; localStorage.clear(); });

import { ChromaKeyPanel, AudioFxPanel, VolumeCurve } from "./SoundAndKey";

const root = (p: Project) => p.compositions[p.rootCompositionId];
const pl = (e: Engine, id: string) => findPlacement(root(e.getState().project), id)!.placement;
const asset = (id: string, kind: "video" | "audio"): Asset => ({ id, kind, name: id, selectedVersionId: `${id}_v1`, versions: [{ id: `${id}_v1`, createdAt: "", media: { blobKey: id, mime: kind === "video" ? "video/mp4" : "audio/mpeg", durationTicks: s(8) }, provenance: { source: "import", inputs: [] } }] });
function mount(node: React.ReactNode) { const el = document.createElement("div"); document.body.append(el); const r = createRoot(el); roots.push(r); act(() => r.render(node)); return el; }
function setup(kind: "video" | "audio") {
  const e = new Engine(createProject("t"));
  e.dispatch([cmd.importAsset(asset("a", kind))]);
  const main = ops.mainTrack(root(e.getState().project))!.id;
  e.dispatch(cmd.addAssetToTimeline("a", 0, main, "A"));
  return e;
}
const btn = (el: ParentNode, t: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === t || b.getAttribute("aria-label") === t) as HTMLButtonElement;

describe("P3B panels", () => {
  it("chroma key switch, hex and undo", () => {
    const e = setup("video"); let picking = false;
    const el = mount(<ChromaKeyPanel engine={e} placement={pl(e, "A")} picking={false} onPick={(v) => { picking = v; }} />);
    act(() => btn(el, "Chroma key on").click());
    expect(pl(e, "A").chromaKey).toBeTruthy();
    e.undo();
    expect(pl(e, "A").chromaKey).toBeFalsy();
    act(() => [...el.querySelectorAll("button")].find((b) => /Pick colour/.test(b.textContent ?? ""))!.click());
    expect(picking).toBe(true);
  });
  it("audio fx radio sets preset and None clears", () => {
    const e = setup("audio");
    const el = mount(<AudioFxPanel engine={e} placement={pl(e, "A")} />);
    const radios = [...el.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
    expect(radios.length).toBe(8);
    act(() => radios[2].click());
    expect(pl(e, "A").audioFx?.preset).toBeTruthy();
  });
  it("volume curve adds a point at the playhead", () => {
    const e = setup("audio");
    const el = mount(<VolumeCurve engine={e} placement={pl(e, "A")} time={s(2)} />);
    act(() => btn(el, "＋ Point at playhead").click());
    expect(pl(e, "A").keyframes?.volume?.length).toBeGreaterThan(0);
  });
});

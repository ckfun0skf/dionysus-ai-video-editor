// @vitest-environment jsdom
/**
 * P81a: the scene editor's Edit view. The page itself (three.js, TransformControls) runs only in a browser; here the
 * iframe's messages are played by hand: ready → the editor sends the state; a pick selects; a drag shows live values
 * and its end is ONE step of the editor's undo, written where domain/sceneGizmo.ts says.
 */
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createProject, SAMPLE_SCENE, versionOfPlacement, type GizmoValue, type Project, type SceneDoc } from "../domain";
import { Engine, cmd } from "../engine";
import { SceneEditor, type SceneSel } from "./SceneEditor";
import { cachedSceneDoc, sceneAsset } from "./sceneAsset";
import { memorySceneDrafts } from "./sceneDrafts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const S = 120_000;
const readText = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(b); });
const memBlobs = () => {
  const m = new Map<string, Blob & { text(): Promise<string> }>();
  return { m, put: async (k: string, b: Blob) => { const t = await readText(b); m.set(k, Object.assign(b, { text: async () => t })); }, get: async (k: string) => m.get(k), delete: async () => undefined, keys: async () => [...m.keys()] };
};
const clip = (p: Project) => p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements)[0];
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const shownDoc = (p: Project) => cachedSceneDoc(versionOfPlacement(p, clip(p))?.media.blobKey)!;

async function open(opts: { mobile?: boolean; initialSel?: SceneSel; time?: number; host?: HTMLElement } = {}) {
  const blobs = memBlobs();
  const asset = await sceneAsset(blobs, SAMPLE_SCENE);
  const e = new Engine(createProject("scene"));
  e.dispatch([cmd.importAsset(asset), cmd.addSceneClip(asset.id, 0, 5 * S, "sc")]);
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  const previews: [string, SceneDoc | undefined][] = [];
  const mirror = document.createElement("canvas");
  const draw = () => { const p = e.getState().project; root.render(<SceneEditor engine={e} project={p} placement={clip(p)} blobs={blobs as never} mobile={!!opts.mobile} time={opts.time ?? 0} playing={false} onSeek={() => undefined} onTogglePlay={() => undefined} onClose={() => undefined} onPreview={(k, d) => previews.push([k, d])} initialSel={opts.initialSel} drafts={memorySceneDrafts()} mirror={() => mirror} viewHost={opts.host ? () => opts.host : undefined} />); };
  const unsub = e.subscribe(draw);
  await act(async () => draw()); await settle();
  const button = (re: RegExp, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find((b) => re.test(b.getAttribute("aria-label") ?? "") || re.test((b.textContent ?? "").trim()))!;
  const click = async (b: Element) => { await act(async () => { (b as HTMLElement).click(); }); await settle(); };
  const frame = () => document.querySelector<HTMLIFrameElement>('[data-testid="scene-edit-frame"]')!;
  const sent: Record<string, unknown>[] = [];
  /** Turn on the Edit view and play the page's "ready"; the editor's messages to the page are collected in `sent`. */
  const editView = async () => {
    await click(button(/^Edit view$/));
    vi.spyOn(frame().contentWindow!, "postMessage").mockImplementation((m: unknown) => { sent.push(m as Record<string, unknown>); });
    await fromPage({ type: "scene-edit:ready" });
  };
  const fromPage = async (data: unknown, source: Window | null = frame().contentWindow) => {
    await act(async () => { window.dispatchEvent(new MessageEvent("message", { data, source })); }); await settle();
  };
  const drag = async (id: string, value: GizmoValue, end: "end" | "cancel" = "end") => {
    await fromPage({ type: "scene-edit:drag", phase: "start", id, value });
    await fromPage({ type: "scene-edit:drag", phase: "move", id, value });
    await fromPage({ type: "scene-edit:drag", phase: end, id, value });
  };
  const info = () => document.querySelector('[data-testid="scene-gizmo-info"]')!.textContent;
  const work = () => previews.at(-1)?.[1] ?? shownDoc(e.getState().project);
  const lastState = () => sent.filter((m) => m.type === "scene-edit:state").at(-1) as { state: { objects: { id: string; position: number[] }[] }; sel: string | null; opts: Record<string, unknown> };
  const key = async (k: string) => { await act(async () => { el.querySelector('[data-testid="scene-editor"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); }); await settle(); };
  const done = () => { unsub(); act(() => root.unmount()); el.remove(); };
  return { e, el, button, click, frame, editView, fromPage, drag, info, work, lastState, sent, key, done };
}
const val = (position: [number, number, number], rotation: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): GizmoValue => ({ position, rotation, scale });

describe("P81a scene editor: Edit view", () => {
  it("Camera view by default; Edit view is a sandboxed editor page of the scene that gets the state once ready", async () => {
    const t = await open();
    expect(t.button(/^Camera view$/).getAttribute("aria-pressed")).toBe("true");
    expect(t.frame()).toBeNull();
    await t.editView();
    const f = t.frame();
    expect(f.getAttribute("sandbox")).toBe("allow-scripts");
    expect(f.srcdoc).toContain("TransformControls");
    expect(f.srcdoc).toContain("Content-Security-Policy");
    const s = t.lastState();
    expect(s.sel).toBeNull();
    expect(s.opts).toEqual({ mode: "translate", axis: "free", snap: false, touch: false, aspect: 16 / 9 });
    expect(s.state.objects.map((o) => o.id)).toEqual(["floor", "ball", "cube", "sign"]);
    expect(t.info()).toMatch(/Click an object to select it/);
    // Back to the Camera view: the page goes away.
    await t.click(t.button(/^Camera view$/));
    expect(t.frame()).toBeNull();
    t.done();
  });

  it("a pick selects the object (empty space: the scene); messages from other windows or with unknown ids are ignored", async () => {
    const t = await open();
    await t.editView();
    await t.fromPage({ type: "scene-edit:pick", id: "cube" });
    expect(t.el.querySelector('[data-testid="object-form"]')!.textContent).toMatch(/cube/);
    expect(t.lastState().sel).toBe("cube");
    expect(t.info()).toBe("Drag writes cube's start position");
    await t.fromPage({ type: "scene-edit:pick", id: "ghost" });
    await t.fromPage({ type: "scene-edit:pick", id: "ball" }, window); // not from the page
    expect(t.lastState().sel).toBe("cube");
    await t.fromPage({ type: "scene-edit:pick", id: null });
    expect(t.el.querySelector('[data-testid="scene-form"]')).toBeTruthy();
    expect(t.lastState().sel).toBeNull();
    t.done();
  });

  it("a drag shows its values live and its end is one step of the editor's undo (the object's start value)", async () => {
    const t = await open({ initialSel: { kind: "object", id: "cube" } });
    await t.editView();
    const n = t.sent.length;
    await t.fromPage({ type: "scene-edit:drag", phase: "start", id: "cube", value: val([1.4, 0.4, -0.5]) });
    await t.fromPage({ type: "scene-edit:drag", phase: "move", id: "cube", value: val([2.123, 0.4, -0.5]) });
    expect(t.info()).toBe("Position 2.12, 0.4, -0.5");
    expect(t.work()).toEqual(SAMPLE_SCENE); // nothing written while dragging
    expect(t.sent.length).toBe(n); // and nothing sent back to the page
    await t.fromPage({ type: "scene-edit:drag", phase: "end", id: "cube", value: val([2.123, 0.4, -0.5]) });
    expect(t.work().objects[2].position).toEqual([2.123, 0.4, -0.5]);
    expect(t.lastState().state.objects[2].position).toEqual([2.123, 0.4, -0.5]);
    expect(t.el.querySelector(".v2-sed-ver")!.textContent).toBe("v1 · edited");
    expect(t.button(/^Undo$/).getAttribute("title")).toBe("Undo move cube");
    await t.click(t.button(/^Undo$/));
    expect(t.work()).toEqual(SAMPLE_SCENE);
    // A malformed value is ignored; a cancelled drag changes nothing.
    await t.fromPage({ type: "scene-edit:drag", phase: "end", id: "cube", value: { position: [1, "x", 0], rotation: [0, 0, 0], scale: [1, 1, 1] } });
    await t.drag("cube", val([3, 0.4, -0.5]), "cancel");
    expect(t.work()).toEqual(SAMPLE_SCENE);
    expect(t.el.querySelector(".v2-abnote")!.textContent).toBe("Drag cancelled.");
    // A press on a handle that never moved (a tap on the gizmo) is not an edit.
    await t.fromPage({ type: "scene-edit:drag", phase: "start", id: "cube", value: val([1.4, 0.4, -0.5]) });
    await t.fromPage({ type: "scene-edit:drag", phase: "end", id: "cube", value: val([1.4, 0.4, -0.5]) });
    expect(t.el.querySelector(".v2-sed-ver")!.textContent).toBe("v1");
    expect(t.button(/^Undo$/).getAttribute("title")).not.toBe("Undo move cube");
    t.done();
  });

  it("with a move event selected the view shows its end and the drag writes its end value; rotate / scale events pick their gizmo", async () => {
    const t = await open({ initialSel: { kind: "event", index: 1 }, time: 0 });
    await t.editView();
    expect(t.lastState().sel).toBe("ball");
    expect(t.lastState().state.objects[1].position).toEqual([0.2, 0.5, 0.8]); // ball.moveTo's end (2 s), not the playhead
    expect(t.info()).toBe("Drag writes ball.moveTo at 0.5s (its end) · showing 2s");
    await t.drag("ball", val([1, 0.5, 0]));
    expect(t.work().events![1].args).toEqual({ position: [1, 0.5, 0] });
    expect(t.work().objects[1].position).toEqual([-1.6, 0.5, 0]);
    // Picking the event's own object keeps the event selected.
    await t.fromPage({ type: "scene-edit:pick", id: "ball" });
    expect(t.el.querySelector('[data-testid="event-form"]')).toBeTruthy();
    // Selecting the cube's rotation event switches to Rotate.
    await t.click(t.button(/^cube\.rotation at 0s/));
    expect(t.button(/^Rotate$/).getAttribute("aria-pressed")).toBe("true");
    expect(t.lastState().opts.mode).toBe("rotate");
    await t.drag("cube", val([1.4, 0.4, -0.5], [0, 180, 0]));
    expect(t.work().events![0].args).toEqual({ value: [0, 180, 0] });
    t.done();
  });

  it("Auto-key adds an event ending at the playhead; chips set axis, snap and mode; W / E / R too; Esc cancels a drag", async () => {
    const t = await open({ initialSel: { kind: "object", id: "sign" }, time: 1.5 * S });
    await t.editView();
    await t.click(t.button(/^Auto-key$/));
    expect(t.info()).toBe("Drag writes new sign.moveTo ending at 1.5s");
    await t.drag("sign", val([0, 2.5, -1.5]));
    expect(t.work().events!.at(-1)).toEqual({ at: 0, obj: "sign", call: "moveTo", args: { position: [0, 2.5, -1.5] }, dur: 1.5 });
    expect(t.work().objects[3].position).toEqual([0, 1.9, -1.5]);
    // A second drag at the same playhead updates that key.
    await t.drag("sign", val([0, 3, -1.5]));
    expect(t.work().events).toHaveLength(7);
    expect(t.work().events!.at(-1)!.args).toEqual({ position: [0, 3, -1.5] });
    await t.click(t.button(/^Y axis only$/));
    await t.click(t.button(/^Snap$/));
    expect(t.lastState().opts).toEqual({ mode: "translate", axis: "y", snap: true, touch: false, aspect: 16 / 9 });
    await t.key("e"); expect(t.lastState().opts.mode).toBe("rotate");
    await t.key("r"); expect(t.lastState().opts.mode).toBe("scale");
    await t.key("w"); expect(t.lastState().opts.mode).toBe("translate");
    await t.click(t.button(/^Reset view$/));
    expect(t.sent.at(-1)).toEqual({ type: "scene-edit:home" });
    await t.fromPage({ type: "scene-edit:drag", phase: "start", id: "sign", value: val([0, 3, -1.5]) });
    await t.key("Escape");
    expect(t.sent.at(-1)).toEqual({ type: "scene-edit:cancel" });
    expect(t.el.querySelector('[data-testid="scene-editor"]')).toBeTruthy(); // Esc cancelled the drag, not the editor
    t.done();
  });

  it("desktop: drawn over the program preview's box; phone: in place of the mirrored preview, with touch gizmos", async () => {
    const host = document.createElement("div"); document.body.appendChild(host);
    let t = await open({ host });
    await t.click(t.button(/^Edit view$/));
    expect(host.querySelector('[data-testid="scene-edit-view"]')).toBeTruthy();
    expect(t.el.querySelector('[data-testid="scene-edit-view"]')).toBeNull();
    t.done();
    expect(host.querySelector('[data-testid="scene-edit-view"]')).toBeNull(); // closing the editor removes it
    host.remove();
    t = await open({ mobile: true });
    expect(t.el.querySelector(".v2-sed-mirror")).toBeTruthy();
    await t.editView();
    expect(t.el.querySelector(".v2-sed-mirror")).toBeNull();
    expect(t.el.querySelector('[data-testid="scene-edit-view"]')).toBeTruthy();
    expect(t.lastState().opts.touch).toBe(true);
    expect(t.info()).toMatch(/one finger orbits · two fingers pan and zoom/);
    t.done();
  });
});

describe("P81b Edit view: the camera, its look-at point and lights", () => {
  it("the camera is picked and moved: its start position, its look-at point, or the selected camera move (Auto-key too)", async () => {
    const t = await open({ time: 1 * S });
    await t.editView();
    await t.fromPage({ type: "scene-edit:pick", id: "camera" });
    expect(t.el.querySelector('[data-testid="camera-form"]')).toBeTruthy();
    expect(t.lastState().sel).toBe("camera");
    expect(t.info()).toBe("Drag writes the camera's start position");
    expect(t.button(/^Move camera$/).getAttribute("aria-pressed")).toBe("true");
    expect(t.button(/^Rotate$/)).toBeUndefined(); // the camera's chips: its position or its look-at point
    await t.drag("camera", val([0.5, 2, 7]));
    expect(t.work().world!.camera).toEqual({ fov: 40, position: [0.5, 2, 7], lookAt: [0, 0.8, 0] });
    expect(t.button(/^Undo$/).getAttribute("title")).toBe("Undo move camera");
    await t.click(t.button(/^Move look-at point$/));
    expect(t.lastState().sel).toBe("camera:target");
    expect(t.lastState().opts.mode).toBe("translate");
    await t.drag("camera:target", val([0, 1, -1]));
    expect(t.work().world!.camera!.lookAt).toEqual([0, 1, -1]);
    // Picking the body again moves the position; with a camera move selected the drag writes its end.
    await t.click(t.button(/^Camera\.moveTo at 2\.5s/));
    expect(t.lastState().sel).toBe("camera");
    expect(t.info()).toBe("Drag writes camera.moveTo at 2.5s (its end) · showing 4.5s");
    await t.drag("camera", val([2, 2, 4]));
    expect(t.work().events![3].args).toEqual({ position: [2, 2, 4] });
    // Auto-key with the camera selected: a camera move ending at the playhead.
    await t.click(t.button(/^Camera$/)); // the Camera track (picking the body would keep the camera move selected)
    expect(t.el.querySelector('[data-testid="camera-form"]')).toBeTruthy();
    await t.click(t.button(/^Auto-key$/));
    expect(t.info()).toBe("Drag writes new camera.moveTo ending at 1s");
    await t.drag("camera", val([1, 1, 5]));
    expect(t.work().events!.at(-1)).toMatchObject({ at: 0, dur: 1, obj: "camera", call: "moveTo", args: { position: [1, 1, 5] } });
    t.done();
  });

  it("lights: the page gets their values; one with a position is picked and moved (never keyed); rotate / scale are off", async () => {
    const t = await open();
    await t.editView();
    const lights = () => (t.sent.filter((m) => m.type === "scene-edit:state").at(-1) as { lights: unknown[] }).lights;
    expect(lights()).toEqual(SAMPLE_SCENE.world!.lights);
    await t.fromPage({ type: "scene-edit:pick", id: "light:0" }); // a hemisphere light has no handle: ignored
    expect(t.el.querySelector('[data-testid="light-form"]')).toBeNull();
    await t.fromPage({ type: "scene-edit:pick", id: "light:1" });
    expect(t.el.querySelector('[data-testid="light-form"]')).toBeTruthy();
    expect(t.lastState().sel).toBe("light:1");
    expect((t.button(/^Rotate$/) as HTMLButtonElement).disabled).toBe(true);
    await t.click(t.button(/^Auto-key$/));
    expect(t.info()).toBe("Drag writes Light 2's position (lights don't animate)");
    const frameSrc = t.frame().srcdoc;
    await t.drag("light:1", val([1, 4, 2]));
    expect(t.work().world!.lights![1]).toEqual({ type: "directional", position: [1, 4, 2], intensity: 1.6 });
    expect(t.work().events).toHaveLength(SAMPLE_SCENE.events!.length);
    expect((lights()[1] as { position: number[] }).position).toEqual([1, 4, 2]);
    expect(t.frame().srcdoc).toBe(frameSrc); // the page is not rebuilt for a light's new position
    // The hemisphere light, chosen from its track: nothing to move.
    await t.click([...t.el.querySelectorAll<HTMLElement>(".v2-sed-tname")].find((b) => b.textContent === "Light 1")!);
    expect(t.lastState().sel).toBeNull();
    expect(t.info()).toMatch(/Light 1 is hemisphere light: it lights from everywhere/);
    t.done();
  });

  it("a rotate drag keeps whole turns: from 360° a 15° turn is 375°, not 15°", async () => {
    const t = await open({ initialSel: { kind: "event", index: 0 } }); // cube.rotation to [0, 360, 0]
    await t.editView();
    await t.fromPage({ type: "scene-edit:drag", phase: "start", id: "cube", value: val([1.4, 0.4, -0.5], [0, 360, 0]) });
    await t.fromPage({ type: "scene-edit:drag", phase: "move", id: "cube", value: val([1.4, 0.4, -0.5], [0, 15, 0]) });
    expect(t.info()).toBe("Rotation° 0, 375, 0");
    await t.fromPage({ type: "scene-edit:drag", phase: "end", id: "cube", value: val([1.4, 0.4, -0.5], [0, 15, 0]) });
    expect(t.work().events![0].args).toEqual({ value: [0, 375, 0] });
    t.done();
  });
});

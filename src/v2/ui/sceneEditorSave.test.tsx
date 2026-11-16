// @vitest-environment jsdom
/**
 * P80: the scene editor saves like a document. Edits stay in the editor until Save asks "Replace current" or "Save as
 * new version"; closing with unsaved changes asks first; unsaved work is kept as a draft on the device and offered
 * back next time; a change from outside (an AI agent) while editing shows a banner; on a phone the selection's
 * actions sit in a bottom toolbar whose buttons open the form sections in sheets.
 */
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createProject, SAMPLE_SCENE, versionOfPlacement, type Project, type SceneDoc } from "../domain";
import { Engine, cmd } from "../engine";
import { SceneEditor, type SceneSel } from "./SceneEditor";
import { cachedSceneDoc, sceneAsset, sceneVersion } from "./sceneAsset";
import { memorySceneDrafts, sceneDraftKey } from "./sceneDrafts";

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

async function setup() {
  const blobs = memBlobs();
  const asset = await sceneAsset(blobs, SAMPLE_SCENE);
  const e = new Engine(createProject("scene"));
  e.dispatch([cmd.importAsset(asset), cmd.addSceneClip(asset.id, 0, 5 * S, "sc")]);
  return { blobs, asset, e, drafts: memorySceneDrafts() };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function mount(s: Setup, opts: { mobile?: boolean; initialSel?: SceneSel; syncHost?: boolean } = {}) {
  const { e, blobs, drafts } = s;
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  const previews: [string, SceneDoc | undefined][] = [];
  let closed = 0;
  const draw = () => { const p = e.getState().project; root.render(<SceneEditor engine={e} project={p} placement={clip(p)} blobs={blobs as never} mobile={!!opts.mobile} time={0} playing={false} onSeek={() => undefined} onTogglePlay={() => undefined} onClose={() => { closed++; }} onPreview={(k, d) => previews.push([k, d])} initialSel={opts.initialSel} drafts={drafts} />); };
  // syncHost: the host re-renders synchronously on a project change (as the app's store subscription does).
  const unsub = e.subscribe(opts.syncHost ? () => flushSync(draw) : draw);
  await act(async () => draw()); await settle();
  const all = () => [...el.querySelectorAll("button")];
  const button = (re: RegExp) => all().find((b) => re.test(b.getAttribute("aria-label") ?? "") || re.test((b.textContent ?? "").trim()))!;
  const field = (label: string) => [...el.querySelectorAll<HTMLLabelElement>(".v2-sed-field")].find((l) => l.querySelector("span")?.textContent === label)!.querySelector<HTMLInputElement & HTMLSelectElement>("input,select")!;
  const typeIn = async (input: HTMLInputElement, v: string) => {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { input.focus(); input.blur(); });
    await settle();
  };
  const click = async (b: Element) => { await act(async () => { (b as HTMLElement).click(); }); await settle(); };
  /** A key pressed where the focus is (in the editor), else on the editor. */
  const key = async (k: string, init: KeyboardEventInit = {}) => { const at = el.contains(document.activeElement) ? document.activeElement! : el.querySelector('[data-testid="scene-editor"]')!; await act(async () => { at.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init })); }); await settle(); };
  const dialog = (label: string) => el.querySelector<HTMLElement>(`[aria-label="${label}"]:is([role=dialog],[role=alertdialog])`);
  const work = () => previews.at(-1)?.[1] ?? shownDoc(e.getState().project);
  const versions = () => e.getState().project.assets[s.asset.id].versions.length;
  /** Move the ball event to 1.2 s (one edit). */
  const editOnce = async (at = "1.2") => { await click(button(/^ball\.moveTo at /)); await typeIn(field("At (s)"), at); };
  const unmount = () => { unsub(); act(() => root.unmount()); el.remove(); };
  return { el, button, field, typeIn, click, key, dialog, work, versions, editOnce, previews, closed: () => closed, unmount };
}

describe("P80 scene editor: Save / Cancel", () => {
  it("Save is off until there are changes; Ctrl+S opens the choice; Esc / Cancel in the choice keeps editing", async () => {
    const s = await setup(); const t = await mount(s);
    expect(t.button(/^Save$/).hasAttribute("disabled")).toBe(true);
    expect(t.button(/^Cancel$/)).toBeTruthy(); // desktop
    expect(t.el.textContent).not.toMatch(/New version|Replace current/); // no mode toggle in the header any more
    await t.editOnce();
    expect(t.button(/^Save$/).hasAttribute("disabled")).toBe(false);
    await t.key("s", { ctrlKey: true });
    const box = t.dialog("Save scene")!;
    expect(box).toBeTruthy();
    // The last mode used is the default (none yet: Save as new version).
    expect(document.activeElement?.getAttribute("data-choice")).toBe("new");
    await t.key("Escape");
    expect(t.dialog("Save scene")).toBeNull();
    expect(t.closed()).toBe(0); // Esc closed the dialog, not the editor
    expect(t.versions()).toBe(1);
    t.unmount();
  });

  it("closing with unsaved changes asks first (X, Cancel and Esc); Discard throws them away; a clean editor closes at once", async () => {
    const s = await setup(); const t = await mount(s);
    await t.click(t.button(/^Close scene editor$/));
    expect(t.closed()).toBe(1); // clean: no question
    await t.editOnce();
    for (const how of ["x", "cancel", "esc"] as const) {
      if (how === "x") await t.click(t.button(/^Close scene editor$/));
      else if (how === "cancel") await t.click(t.button(/^Cancel$/));
      else { (document.activeElement as HTMLElement | null)?.blur(); await t.key("Escape"); }
      const box = t.dialog("Discard unsaved changes?")!;
      expect(box, how).toBeTruthy();
      await t.click([...box.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!);
      expect(t.dialog("Discard unsaved changes?")).toBeNull();
    }
    expect(t.closed()).toBe(1);
    await t.click(t.button(/^Cancel$/));
    await t.click([...t.dialog("Discard unsaved changes?")!.querySelectorAll("button")].find((b) => b.textContent === "Discard")!);
    expect(t.closed()).toBe(2);
    expect(t.versions()).toBe(1);
    expect(s.drafts.map.size).toBe(0);
    expect(shownDoc(s.e.getState().project)).toEqual(SAMPLE_SCENE);
    t.unmount();
  });
});

describe("P80 scene editor: drafts", () => {
  it("unsaved work is kept as a draft when the page is hidden and offered back next time; Restore brings it, Save replaces", async () => {
    const s = await setup();
    let t = await mount(s);
    await t.editOnce("2");
    await act(async () => { window.dispatchEvent(new Event("pagehide")); }); await settle();
    const k = sceneDraftKey(s.e.getState().project.id, clip(s.e.getState().project).id);
    expect(s.drafts.map.get(k)).toMatchObject({ baseVersionId: s.asset.versions[0].id, doc: { events: expect.arrayContaining([expect.objectContaining({ obj: "ball", call: "moveTo", at: 2 })]) } });
    t.unmount(); // the browser closed without saving
    t = await mount(s);
    const box = t.dialog("Restore unsaved changes?")!;
    expect(box.textContent).toMatch(/closed the editor without saving/);
    await t.click(box.querySelector('[data-choice="restore"]')!);
    expect(t.work().events![1]).toMatchObject({ at: 2 });
    expect(t.el.querySelector(".v2-sed-ver")!.textContent).toBe("v1 · edited");
    await t.click(t.button(/^Save$/));
    expect(t.dialog("Save scene")!.querySelector<HTMLButtonElement>('[data-choice="replace"]')!.disabled).toBe(false); // same version: may overwrite
    await t.click(t.dialog("Save scene")!.querySelector('[data-choice="replace"]')!);
    expect(t.versions()).toBe(1);
    expect(shownDoc(s.e.getState().project).events![1]).toMatchObject({ at: 2 });
    expect(s.drafts.map.size).toBe(0); // saved: the draft is gone
    t.unmount();
  });

  it("Discard draft deletes it; a draft made from another version can only be saved as a new version", async () => {
    const s = await setup();
    let t = await mount(s);
    await t.editOnce("2");
    t.unmount(); // unmount keeps the draft too
    expect(s.drafts.map.size).toBe(1);
    t = await mount(s);
    await t.click([...t.dialog("Restore unsaved changes?")!.querySelectorAll("button")].find((b) => b.textContent === "Discard draft")!);
    expect(s.drafts.map.size).toBe(0);
    expect(t.work()).toEqual(SAMPLE_SCENE);
    await t.editOnce("2");
    t.unmount();
    // Meanwhile the clip moved to another version (an agent saved one).
    const p = s.e.getState().project;
    const v2 = await sceneVersion(s.blobs as never, p.assets[s.asset.id], { ...SAMPLE_SCENE, name: "Agent's" });
    s.e.dispatch(cmd.addAssetVersion(s.asset.id, v2, clip(p).id, { mode: "new", label: "agent" }));
    t = await mount(s);
    const box = t.dialog("Restore unsaved changes?")!;
    expect(box.textContent).toMatch(/made from v1; the clip shows v2 now.*new version/);
    await t.click(box.querySelector('[data-choice="restore"]')!);
    await t.click(t.button(/^Save$/));
    const save = t.dialog("Save scene")!;
    expect(save.querySelector<HTMLButtonElement>('[data-choice="replace"]')!.disabled).toBe(true);
    expect(save.textContent).toMatch(/another version/);
    await t.click(save.querySelector('[data-choice="new"]')!);
    expect(t.versions()).toBe(3);
    expect(s.e.getState().project.assets[s.asset.id].versions[1].media.blobKey).toBe(v2.media.blobKey); // the agent's v2 is kept
    t.unmount();
  });
});

describe("P80 scene editor: changes from outside", () => {
  it("follows the clip when nothing is unsaved; with unsaved changes it shows a banner and Save only adds a version", async () => {
    const s = await setup(); const t = await mount(s);
    const agentSave = async (name: string) => {
      const p = s.e.getState().project;
      const v = await sceneVersion(s.blobs as never, p.assets[s.asset.id], { ...SAMPLE_SCENE, name });
      await act(async () => { s.e.dispatch(cmd.addAssetVersion(s.asset.id, v, clip(p).id, { mode: "new", label: "agent" })); }); await settle();
    };
    await agentSave("First");
    expect(t.work().name).toBe("First");
    expect(t.el.querySelector('[data-testid="scene-outside"]')).toBeNull();
    await t.editOnce();
    await agentSave("Second");
    const banner = t.el.querySelector('[data-testid="scene-outside"]')!;
    expect(banner.textContent).toMatch(/changed outside the editor/);
    expect(t.work()).toMatchObject({ name: "First" }); // our unsaved work is kept
    await t.click(t.button(/^Save$/));
    expect(t.dialog("Save scene")!.querySelector<HTMLButtonElement>('[data-choice="replace"]')!.disabled).toBe(true);
    await t.key("Escape");
    // Or take the new scene instead.
    await t.click(t.button(/^Load the new scene$/));
    expect(t.work().name).toBe("Second");
    expect(t.el.querySelector('[data-testid="scene-outside"]')).toBeNull();
    expect(t.button(/^Save$/).hasAttribute("disabled")).toBe(true);
    t.unmount();
  });

  // The app re-renders synchronously on a project change, which once rendered the old work after a save and left the
  // editor "edited" (seen in Chrome; act() batches it here, so this guards the outcome, not that exact order).
  it("its own saves are not taken for outside changes; the editor is clean after a save", async () => {
    const s = await setup(); const t = await mount(s, { syncHost: true });
    await t.editOnce();
    await t.click(t.button(/^Save$/));
    await t.click(t.dialog("Save scene")!.querySelector('[data-choice="new"]')!);
    expect(t.el.querySelector(".v2-sed-ver")!.textContent).toBe("v2"); // clean after the save
    expect(t.button(/^Save$/).hasAttribute("disabled")).toBe(true);
    await t.editOnce("1.5");
    expect(t.el.querySelector('[data-testid="scene-outside"]')).toBeNull();
    await t.click(t.button(/^Save$/));
    expect(t.dialog("Save scene")!.querySelector<HTMLButtonElement>('[data-choice="replace"]')!.disabled).toBe(false);
    t.unmount();
  });
});

describe("P80 scene editor: phone layout", () => {
  it("the selection's actions sit in a bottom toolbar; each opens its form section in a sheet; Back returns to the scene", async () => {
    const s = await setup(); const t = await mount(s, { mobile: true });
    const bar = () => t.el.querySelector<HTMLElement>("nav.v2-sed-ctx")!;
    const tools = () => [...bar().querySelectorAll(".v2-toolbar-scroll .v2-tool span")].map((x) => x.textContent);
    expect(t.el.querySelector(".v2-sed-panel")).toBeNull(); // no side panel on a phone
    expect(t.button(/^Cancel$/)).toBeUndefined(); // the X is Cancel on a phone
    expect(tools()).toEqual(["Add object", "Scene", "Camera", "Lights"]);
    // The body is above the toolbar, which comes after the tracks.
    expect(t.el.querySelector(".v2-sed-body")!.compareDocumentPosition(bar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // P81b: Camera selects the camera (its own actions); Start opens its start values.
    await t.click(bar().querySelector<HTMLElement>(".v2-toolbar-scroll .v2-tool[title='Select the camera']")!);
    expect(tools()).toEqual(["Start", "Add event", "Move", "Aim"]);
    await t.click(t.button(/^Start$/));
    let sheet = t.dialog("Camera at 0 s")!;
    expect(sheet.classList).toContain("v2-sheet");
    expect(sheet.textContent).toMatch(/Position/);
    expect(sheet.textContent).not.toMatch(/Background/); // only the camera section
    await t.click(t.button(/^Start$/)); // tap again: closes
    expect(t.dialog("Camera at 0 s")).toBeNull();
    await t.click(t.button(/^Back to the scene$/));
    await t.click(t.button(/^Add object$/));
    await t.click([...t.dialog("Add object")!.querySelectorAll('[role="menuitem"]')].find((b) => /torus/i.test(b.textContent ?? ""))!);
    expect(t.dialog("Add object")).toBeNull();
    expect(tools()).toEqual(["Properties", "Add event", "Delete"]);
    await t.click(t.button(/^Back to the scene$/));
    expect(tools()).toEqual(["Add object", "Scene", "Camera", "Lights"]);
    await t.click(t.button(/^ball\.moveTo at 0\.5s/));
    expect(tools()).toEqual(["Timing", "Values", "Go to", "Duplicate", "Delete"]);
    await t.click(t.button(/^Timing$/));
    sheet = t.dialog("Timing")!;
    expect(sheet.textContent).toMatch(/At \(s\)/);
    await t.typeIn(t.field("At (s)"), "1");
    expect(t.work().events![1]).toMatchObject({ at: 1 });
    // Selecting another block keeps the same kind of section open for it.
    await t.click(t.button(/^ball\.setMood/));
    expect(t.dialog("Timing")).toBeTruthy();
    await t.key("Escape"); // Esc closes the sheet first
    expect(t.dialog("Timing")).toBeNull();
    expect(t.closed()).toBe(0);
    // The header Save works the same on a phone.
    await t.click(t.button(/^Save$/));
    await t.click(t.dialog("Save scene")!.querySelector('[data-choice="new"]')!);
    expect(t.versions()).toBe(2);
    t.unmount();
  });
});

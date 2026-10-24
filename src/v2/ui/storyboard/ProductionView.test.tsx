// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { board, createProject, story } from "../../domain";
import { LANTERN_KEEPER } from "../../domain/__fixtures__/lanternKeeper";
import { cmd, Engine } from "../../engine";
import { createMemoryStorage } from "../../persistence";
import { StoryboardView } from "./StoryboardView";

vi.mock("../../persistence", async (orig) => {
  const m = await orig<typeof import("../../persistence")>();
  return { ...m, importFile: vi.fn(async (f: File, blobs: { put: (k: string, b: Blob) => Promise<void> }) => {
    const kind = f.type.split("/")[0]; const key = `ast_${f.name}/ver_1`; await blobs.put(key, f);
    return { id: `ast_${f.name}`, kind, name: f.name, selectedVersionId: "ver_1", versions: [{ id: "ver_1", createdAt: "", media: { blobKey: key, mime: f.type }, provenance: { source: "import", inputs: [] } }] };
  }) };
});
vi.mock("./lastFrame", () => ({ extractLastFrame: vi.fn(async () => ({ blob: new Blob(["png"], { type: "image/png" }), width: 1280, height: 720 })) }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; });
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const btn = (el: Element, t: string | RegExp) => [...el.querySelectorAll("button")].find((b) => { const s = b.getAttribute("aria-label") ?? b.textContent?.trim() ?? ""; return typeof t === "string" ? s === t || b.textContent?.trim() === t : t.test(s) || t.test(b.textContent ?? ""); }) as HTMLButtonElement;
const doc = (() => { const r = story.validateStoryboard(LANTERN_KEEPER); if (!r.ok) throw new Error("bad"); return r.doc; })();

async function mount() {
  const el = document.createElement("div"); document.body.appendChild(el);
  const engine = new Engine(createProject("t"));
  engine.dispatch(cmd.createStoryboard(doc));
  const storage = createMemoryStorage();
  await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={storage.blobs} onClose={() => {}} />));
  const p = () => engine.getState().project;
  return { el, engine, storage, p };
}
const pick = async (input: HTMLInputElement, f: File) => {
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true }))); await wait();
};

describe("production to-do list", () => {
  it("walks the steps: upload with model, pass checks, skip, next to do, undo", async () => {
    const { el, engine, p } = await mount();
    await act(async () => btn(el, "Production steps").click());
    const steps = () => [...el.querySelectorAll(".v2-prod-step")] as HTMLButtonElement[];
    const total = board.productionSteps(p()).length;
    expect(steps()).toHaveLength(total);
    expect(el.querySelector(".v2-prod-progress")!.textContent).toContain(`0 of ${total} done`);
    const first = board.productionSteps(p())[0];
    expect(steps()[0].getAttribute("aria-current")).toBe("step");
    const sec = () => el.querySelector(".v2-sb-inline")!;
    expect(sec().textContent).toContain(`Step 1 of ${total}`);
    expect(sec().textContent).toContain("Copy prompt");
    // Upload with the model recorded.
    const model = sec().querySelector(".v2-sb-model") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(model, "Imagen 4"); model.dispatchEvent(new Event("input", { bubbles: true })); });
    await pick(sec().querySelector('input[type="file"]') as HTMLInputElement, new File(["a"], "keeper.png", { type: "image/png" }));
    const owner = "slot" in first.target ? p().storyboard!.slots[first.target.slot] : p().storyboard!.shots[first.target.shot];
    const v = board.selectedOf(p(), owner)!;
    expect(p().storyboard!.versions[v].model).toBe("Imagen 4");
    expect(sec().textContent).toContain("Imagen 4");
    expect(steps()[0].textContent).toContain("Check it");
    // Pass every check → done; toggling again clears it.
    const passes = () => [...sec().querySelectorAll(".v2-sb-qa-btn:not(.fail)")] as HTMLButtonElement[];
    for (const b of passes()) await act(async () => b.click());
    expect(passes().every((b) => b.getAttribute("aria-pressed") === "true")).toBe(true);
    expect(steps()[0].textContent).toContain("Done");
    expect(el.querySelector(".v2-prod-progress")!.textContent).toContain(`1 of ${total} done`);
    // Next to do → step 2; skip it.
    await act(async () => btn(el, /Next to do/).click());
    expect(steps()[1].getAttribute("aria-current")).toBe("step");
    await act(async () => btn(sec(), /Skip this/).click());
    expect(steps()[1].textContent).toContain("Skipped");
    expect(el.querySelector(".v2-prod-progress")!.textContent).toContain(`2 of ${total} done`);
    await act(async () => engine.undo());
    expect(steps()[1].textContent).not.toContain("Skipped");
    // A blocked step points at the shot it needs.
    const lf = board.productionSteps(p()).findIndex((s) => s.state === "blocked");
    expect(steps()[lf].textContent).toMatch(/After shot 1 has a clip/);
  });
});

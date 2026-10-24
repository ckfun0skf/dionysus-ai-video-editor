// @vitest-environment jsdom
/** V2-HTML-PKG: paste/import with validation, and the storyboard's package prompts and "Add as new version". */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProject, HTML_CLIP_FORMAT, htmlClipTemplate, runtimeAiLinks, story } from "../domain";
import { cmd, Engine } from "../engine";
import { createMemoryStorage } from "../persistence";
import { HtmlImport } from "./HtmlImport";
import { exportHtmlZip } from "./htmlPackage";
import { StoryboardView } from "./storyboard/StoryboardView";

vi.mock("../persistence", async (orig) => {
  const m = await orig<typeof import("../persistence")>();
  return { ...m, importFile: vi.fn(async (f: File, blobs: { put: (k: string, b: Blob) => Promise<void> }) => {
    const key = `ast_${f.name}/ver_${f.size}`; await blobs.put(key, f);
    return { id: `ast_${f.name}`, kind: "html", name: f.name, selectedVersionId: "ver_1", versions: [{ id: "ver_1", createdAt: "", media: { blobKey: key, mime: "text/html", width: 1920, height: 1080 }, provenance: { source: "import", inputs: [] } }] };
  }) };
});

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
afterEach(() => { document.body.innerHTML = ""; });
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const typeIn = async (ta: HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, v);
  await act(async () => ta.dispatchEvent(new Event("input", { bubbles: true })));
};
const pick = async (input: HTMLInputElement, f: File) => {
  Object.defineProperty(input, "files", { value: [f], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true }))); await wait();
};
const reply = (html: string) => `Sure! Here is your clip:\n\n\`\`\`html\n${html}\`\`\`\n\nLet me know if you want changes.`;

describe("HtmlImport (V2-HTML-PKG)", () => {
  async function mount(onAdd = vi.fn()) {
    const el = document.createElement("div"); document.body.appendChild(el);
    await act(async () => createRoot(el).render(<HtmlImport onAdd={onAdd} expectBindings={{ logo: "image" }} />));
    return { el, onAdd, add: () => el.querySelector('[data-testid="v2-html-import-add"]') as HTMLButtonElement };
  }

  it("picks the ```html block out of a pasted AI reply, validates it and adds it", async () => {
    const { el, onAdd, add } = await mount();
    expect(add().disabled).toBe(true);
    await typeIn(el.querySelector("textarea")!, reply(htmlClipTemplate()));
    expect(el.querySelector('[data-testid="v2-clip-issues"]')!.textContent).toContain("binding-missing"); // a warning only
    expect(add().disabled).toBe(false);
    await act(async () => add().click());
    expect(onAdd.mock.calls[0][0].trim()).toBe(htmlClipTemplate().trim());
    expect(onAdd.mock.calls[0][1]).toBe("Template");
    expect(el.querySelector("textarea")!.value).toBe("");
  });

  it("shows clear errors and blocks adding a clip that would break", async () => {
    const { el, add } = await mount();
    await typeIn(el.querySelector("textarea")!, "I can't open the spec — please paste the full Dionysus HTML clip prompt.");
    expect(el.querySelector('[role="alert"]')!.textContent).toMatch(/No HTML found/);
    expect(add().disabled).toBe(true);
    await typeIn(el.querySelector("textarea")!, reply(htmlClipTemplate().replace("<style>", '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"><style>')));
    const issues = el.querySelector('[data-testid="v2-clip-issues"]')!;
    expect(issues.textContent).toMatch(/^1 error/);
    expect(issues.querySelector("li.is-error")!.textContent).toMatch(/Network access is blocked/);
    expect(issues.querySelector("li")!.classList.contains("is-error")).toBe(true); // errors first
    expect(add().disabled).toBe(true);
  });

  it("imports a .dionysus-html.zip with the file picker", async () => {
    const { el, onAdd, add } = await mount();
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain(".zip");
    await pick(input, new File([await exportHtmlZip(htmlClipTemplate())], "title.dionysus-html.zip", { type: "application/zip" }));
    expect(el.textContent).toContain("Loaded title.dionysus-html.zip");
    await act(async () => add().click());
    expect(onAdd.mock.calls[0][1]).toBe("title");
    expect(onAdd.mock.calls[0][0]).toContain(`"format": "${HTML_CLIP_FORMAT}"`);
  });

  it("reports a file that isn't a clip", async () => {
    const { el } = await mount();
    await pick(el.querySelector('input[type="file"]') as HTMLInputElement, new File(["%PDF"], "brief.pdf", { type: "application/pdf" }));
    expect(el.querySelector('[role="alert"]')!.textContent).toMatch(/brief\.pdf is not an HTML clip/);
  });
});

describe("storyboard html asset: package prompts and paste-back (V2-HTML-PKG)", () => {
  const doc = (() => {
    const r = story.validateStoryboard({
      format: "dionysus.storyboard/1",
      meta: { title: "First Light", aspect: "16:9" },
      assets: [
        { id: "logo", name: "Logo", type: "image", prompt: "", source: "upload", qa: [] },
        { id: "title", name: "Sunrise title", type: "html", prompt: "The title rises with a warm glow; the logo fades in at the end.", references: ["logo"], qa: [] },
      ],
      shots: [{ id: "s1", title: "Title", durationSec: 5, render: "html", clip: "title", assets: [], qa: [] }],
      connections: [],
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.doc;
  })();

  it("copies the brief combined with the package block, and adds the pasted reply as a version", async () => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { copied = t; } } });
    const el = document.createElement("div"); document.body.appendChild(el);
    const engine = new Engine(createProject("t"));
    engine.dispatch(cmd.createStoryboard(doc));
    const storage = createMemoryStorage();
    await act(async () => createRoot(el).render(<StoryboardView engine={engine} blobs={storage.blobs} onClose={() => {}} />));
    await act(async () => (el.querySelector(".v2-sb-shot-main") as HTMLButtonElement).click());

    await act(async () => (el.querySelector('[data-testid="copy-html-prompt"]') as HTMLButtonElement).click()); await wait();
    expect(copied).toContain("DESIGN BRIEF\nThe title rises with a warm glow");
    expect(copied).toContain(`- Spec: ${runtimeAiLinks().htmlClipSpec}`); // from the runtime origin, never a hard-coded host
    expect(runtimeAiLinks().htmlClipSpec).toMatch(/\/ai\/HTML_CLIP_PACKAGE\.md$/);
    expect(copied).toContain('"durationSec":5');
    expect(copied).toContain('"bindings":{"logo":{"type":"image","asset":"logo","label":"Logo"}}');
    await act(async () => (el.querySelector('[data-testid="copy-html-prompt-full"]') as HTMLButtonElement).click()); await wait();
    expect(copied).toContain("RUNTIME CONTRACT\n- Register the clip once");

    const box = el.querySelector(".v2-sb-htmlimport") as HTMLDetailsElement;
    expect(box.open).toBe(true); // no versions yet
    await typeIn(box.querySelector("textarea")!, reply(htmlClipTemplate()));
    await act(async () => (box.querySelector('[data-testid="v2-html-import-add"]') as HTMLButtonElement).click()); await wait();
    const b = engine.getState().project.storyboard!;
    expect(b.slots.title.assetId).toBeTruthy();
    expect(el.querySelector(".v2-sb-err")).toBeNull();
  });
});

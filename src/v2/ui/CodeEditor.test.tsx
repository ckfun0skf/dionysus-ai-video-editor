// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readManifest } from "../domain";
import { CodeEditor, previewDoc, scriptLineOf } from "./CodeEditor";
import { generateClip, parseClip } from "./codeClip";
import { newCodeClipHtml, newCodeModel } from "./codeSamples";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  URL.createObjectURL = (() => "blob:x") as never;
});
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; });

function mount(source: string, props: { create?: boolean; mobile?: boolean } = {}) {
  const el = document.createElement("div"); document.body.appendChild(el);
  const onSave = vi.fn<(h: string) => void>(), onClose = vi.fn();
  const root = createRoot(el); roots.push(root);
  act(() => { root.render(<CodeEditor source={source} mobile={!!props.mobile} create={props.create} onSave={onSave} onClose={onClose} />); });
  const q = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
  const btn = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const click = (b: Element | null | undefined) => act(() => { (b as HTMLElement).click(); });
  const tab = (name: string) => click([...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith(name)));
  const type = (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => act(() => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  const field = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("label")].find((l) => l.querySelector(":scope > span")?.textContent === label)?.querySelector("input, select, textarea") as HTMLInputElement;
  return { el, onSave, onClose, q, btn, click, tab, type, field };
}
const saved = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0] as string;

describe("V2-CODE-EDITOR Code Editor", () => {
  it("opens JS-first: Script / Params / Files / Settings / Advanced, a live preview with play and scrub, no edits → Save disabled", () => {
    const { q, btn } = mount(newCodeClipHtml());
    expect(q('[role="dialog"][aria-label="Code editor"]')).toBeTruthy();
    expect([...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.replace(/\d+$/, ""))).toEqual(["Script", "Params", "Files", "Settings", "Advanced"]);
    expect(q('[role="tab"][aria-selected="true"]')!.textContent).toBe("Script");
    expect((q<HTMLTextAreaElement>('textarea[aria-label="Script"]'))!.value).toBe(newCodeModel().script);
    expect(q('iframe[title="Live preview"]')!.getAttribute("sandbox")).toBe("allow-scripts");
    expect(btn("Pause preview")).toBeTruthy();
    expect(q('input[type="range"][aria-label="Preview time"]')).toBeTruthy();
    expect(btn("Save")!.disabled).toBe(true);
    expect(q('[data-testid="v2-code-issues"]')!.textContent).toContain("No problems");
  });

  it("editing the script enables Save, which writes a parseable package", () => {
    const { q, btn, click, type, onSave } = mount(newCodeClipHtml());
    type(q<HTMLTextAreaElement>('textarea[aria-label="Script"]')!, "// changed\ndionysus.clip({ render() {} });\n");
    expect(btn("Save")!.disabled).toBe(false);
    click(btn("Save"));
    const p = parseClip(saved(onSave));
    expect(p.kind === "model" && p.model.script).toBe("// changed\ndionysus.clip({ render() {} });\n");
  });

  it("create mode: Add to timeline saves the template unchanged", () => {
    const { btn, click, onSave } = mount(newCodeClipHtml(), { create: true });
    click(btn("Add to timeline"));
    expect(saved(onSave)).toBe(newCodeClipHtml());
  });

  it("Params tab: add, edit, reorder and remove params; they save into the manifest; bad keys block Save", () => {
    const { btn, click, tab, type, field, onSave, q } = mount(newCodeClipHtml());
    tab("Params");
    const panel = q('[data-testid="v2-ce-params"]')!;
    expect(panel.textContent).toContain("ctx.params.<key>");
    click(btn("Colour", q('[aria-label="Add param"]')!));
    // The new row opens for editing with its snippet.
    expect(panel.textContent).toContain("ctx.params.color2");
    type(field("Key"), "glow");
    type(field("Label"), "Glow colour");
    expect(panel.textContent).toContain("ctx.params.glow");
    click(btn("Move glow up"));
    click(btn("Remove size"));
    click(btn("Save"));
    const params = readManifest(saved(onSave)).params!;
    expect(Object.keys(params)).toEqual(["title", "color", "glow", "speed"]);
    expect(params.glow).toEqual({ type: "color", default: "#20d5ec", label: "Glow colour" });
    // An invalid key shows inline and disables Save.
    type(field("Key"), "9bad");
    expect(panel.querySelector('[role="alert"]')!.textContent).toMatch(/must start with a letter/);
    expect(btn("Save")!.disabled).toBe(true);
    expect(q('[role="tab"] .v2-ce-dot')).toBeTruthy();
  });

  it("P43 Params tab: + Graphic / + Audio / + Tracker add typed references to the manifest inputs; rename and remove", () => {
    const { btn, click, tab, onSave, q } = mount(newCodeClipHtml());
    tab("Params");
    const group = q('[aria-label="Add reference"]')!;
    expect([...group.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(["Graphic", "Audio", "Tracker"]);
    click(btn("Graphic", group)); click(btn("Audio", group)); click(btn("Tracker", group)); click(btn("Tracker", group));
    const refs = q('[aria-label="References"]')!;
    expect(refs.textContent).toContain("ctx.inputs.target");
    const name = refs.querySelector('input[aria-label="Name of Tracker reference target2"]') as HTMLInputElement;
    act(() => { name.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "drone"); name.blur(); });
    click(btn("Remove sound"));
    click(btn("Save"));
    expect(readManifest(saved(onSave)).inputs).toEqual({ picture: { type: "graphic" }, target: { type: "tracker" }, drone: { type: "tracker" } });
  });
  it("Params tab: changing a type and editing Choice options keeps the default valid", () => {
    const { btn, click, tab, type, field, onSave } = mount(newCodeClipHtml());
    tab("Params");
    click(btn("title — Text, edit"));
    type(field("Type"), "select");
    type(field("Options (one per line)"), "Hello\nWorld");
    click(btn("Save"));
    expect(readManifest(saved(onSave)).params!.title).toEqual({ type: "select", default: "Hello", options: ["Hello", "World"], label: "Title" });
  });

  it("Settings tab: name, duration, aspect and transparent background save into the manifest", () => {
    const { btn, click, tab, type, field, onSave, q } = mount(newCodeClipHtml());
    tab("Settings");
    type(field("Name"), "Intro");
    type(field("Duration (s)"), "8");
    click(btn("9:16"));
    click(q<HTMLInputElement>('.v2-ce-switch input')!);
    click(btn("Save"));
    const m = readManifest(saved(onSave));
    expect(m).toMatchObject({ name: "Intro", durationSec: 8, aspect: "9:16", width: 1080, height: 1920, background: "#000000" });
  });

  it("Load sample asks before replacing edits, then loads the Three.js sample", () => {
    const { btn, click, type, q, onSave } = mount(newCodeClipHtml());
    type(q<HTMLTextAreaElement>('textarea[aria-label="Script"]')!, "// mine\n");
    click(btn("Samples"));
    click([...document.querySelectorAll(".v2-ce-sample")].find((b) => b.textContent?.startsWith("Three.js")));
    const dlg = q('[role="alertdialog"]')!;
    expect(dlg.textContent).toContain('Load "Three.js"?');
    click(btn("Cancel", dlg));
    expect(q<HTMLTextAreaElement>('textarea[aria-label="Script"]')!.value).toBe("// mine\n");
    click(btn("Samples"));
    click([...document.querySelectorAll(".v2-ce-sample")].find((b) => b.textContent?.startsWith("Three.js")));
    click(btn("Replace"));
    expect(q<HTMLTextAreaElement>('textarea[aria-label="Script"]')!.value).toMatch(/import \* as THREE from "three"/);
    click(btn("Save"));
    expect(readManifest(saved(onSave))).toMatchObject({ name: "Three.js orbit", libs: ["three"] });
  });

  it("Load sample without edits replaces at once (Canvas animation)", () => {
    const { btn, click, q } = mount(newCodeClipHtml());
    click(btn("Samples"));
    click([...document.querySelectorAll(".v2-ce-sample")].find((b) => b.textContent?.startsWith("Canvas animation")));
    expect(q('[role="alertdialog"]')).toBeNull();
    expect(q(".v2-ce-title b")!.textContent).toBe("Canvas animation");
  });

  it("Cancel with edits asks first; without edits closes", () => {
    const a = mount(newCodeClipHtml());
    a.click(a.btn("Cancel"));
    expect(a.onClose).toHaveBeenCalledTimes(1);
    act(() => { roots.splice(0).forEach((r) => r.unmount()); });
    const b = mount(newCodeClipHtml());
    b.type(b.q<HTMLTextAreaElement>('textarea[aria-label="Script"]')!, "x");
    b.click(b.btn("Cancel"));
    expect(b.onClose).not.toHaveBeenCalled();
    b.click(b.btn("Discard"));
    expect(b.onClose).toHaveBeenCalledTimes(1);
  });

  it("legacy clips open in Advanced as raw HTML with a note; saving keeps their page and writes the manifest", () => {
    const legacy = '<!doctype html><html><head><style>h1{color:red}</style></head><body><h1>Hi</h1><script>dionysus.onFrame(()=>{})</script></body></html>';
    const { q, tab, type, field, btn, click, onSave } = mount(legacy);
    expect(q('[role="tab"][aria-selected="true"]')!.textContent).toBe("Advanced");
    expect(q('[role="note"]')!.textContent).toMatch(/raw HTML/);
    expect(q<HTMLTextAreaElement>('textarea[aria-label="HTML"]')!.value).toBe(legacy);
    tab("Settings");
    type(field("Name"), "Old title");
    click(btn("Save"));
    const out = saved(onSave);
    expect(out).toContain("<h1>Hi</h1>");
    expect(readManifest(out).name).toBe("Old title");
    tab("Script");
    expect(q('[role="note"]')!.textContent).toContain("edited as HTML");
  });

  it("shows syntax errors inline (debounced) with the error marked", async () => {
    vi.useFakeTimers();
    try {
      const { q, type } = mount(newCodeClipHtml());
      type(q<HTMLTextAreaElement>('textarea[aria-label="Script"]')!, "dionysus.clip({ render(t) { if (t { } });\n");
      await act(async () => { vi.advanceTimersByTime(500); });
      expect(q('[data-testid="v2-code-issues"]')!.textContent).toMatch(/1 error.*Syntax/);
      expect(q('[role="tab"] .v2-ce-dot')).toBeNull(); // no line number outside Firefox, so no gutter mark
    } finally { vi.useRealTimers(); }
  });

  it("the Tab key indents the selected lines and Shift+Tab outdents them", () => {
    const { q } = mount(newCodeClipHtml());
    const t = q<HTMLTextAreaElement>('textarea[aria-label="Script"]')!;
    act(() => { t.setSelectionRange(0, 0); t.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(t.value.startsWith("  // The canvas")).toBe(true);
    act(() => { t.setSelectionRange(0, 30); t.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })); });
    expect(t.value).toBe(newCodeModel().script);
  });

  it("mobile: preview on top with a hide toggle, symbol key row, Samples in a sheet", () => {
    const { q, btn, click } = mount(newCodeClipHtml(), { mobile: true });
    const main = q(".v2-ce-main")!;
    expect(main.firstElementChild!.classList.contains("v2-ce-side")).toBe(true);
    expect(q('[role="toolbar"][aria-label="Code keys"]')).toBeTruthy();
    click(btn("Hide preview"));
    expect(q<HTMLElement>(".v2-ce-stage")!.hidden).toBe(true);
    click(btn("Samples"));
    expect(q('.v2-sheet[aria-label="Load sample"], [role="dialog"][aria-label="Load sample"]')).toBeTruthy();
  });
});

describe("V2-CODE-EDITOR preview errors", () => {
  it("maps an error's about:srcdoc line back to the script line", () => {
    const html = generateClip({ ...newCodeModel(), script: "line1\nline2\nthrow new Error('x');\n" });
    const { doc, scriptLine } = previewDoc(html);
    const docLine = doc.split("\n").findIndex((l) => l.includes("throw new Error")) + 1;
    expect(scriptLineOf(`Error: x\n    at about:srcdoc:${docLine}:7`, scriptLine)).toBe(3);
    expect(scriptLineOf("no stack", scriptLine)).toBeUndefined();
    expect(doc).toContain('type:"dionysus:error"');
  });
});

describe("P53 Code Editor file drop", () => {
  const fire = (el: Element, type: string, files: File[] = []) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(ev, { dataTransfer: { types: ["Files"], files, dropEffect: "none" } });
    el.dispatchEvent(ev);
    return ev;
  };
  const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  it("dropping a supported file on the editor attaches it on the Files tab", async () => {
    const { q, tab, onSave, btn, click } = mount(newCodeClipHtml());
    tab("Files");
    expect(q('[data-testid="v2-ce-dropzone"]')!.textContent).toMatch(/Drop files here/);
    expect(q('button.v2-ce-addfile')!.textContent).toContain("Add files");
    const dialog = q('[role="dialog"][aria-label="Code editor"]')!;
    const file = new File([new Uint8Array([1, 2, 3, 4])], "logo.png", { type: "image/png" });
    await act(async () => { fire(dialog, "drop", [file]); });
    await wait();
    expect(q('[data-testid="v2-ce-files"]')!.textContent).toContain("logo.png");
    click(btn("Save"));
    expect(readManifest(saved(onSave)).files!["logo.png"]).toMatch(/^data:image\/png;base64,/);
  });

  it("rejects an unsupported type and keeps the picker", async () => {
    const { q } = mount(newCodeClipHtml());
    const dialog = q('[role="dialog"][aria-label="Code editor"]')!;
    const pdf = new File(["%PDF"], "brief.pdf", { type: "application/pdf" });
    await act(async () => { fire(dialog, "drop", [pdf]); });
    await wait();
    expect(q('[data-testid="v2-ce-files"]')).toBeTruthy();
    expect(q('[role="alert"]')!.textContent).toMatch(/brief\.pdf isn't a supported type and wasn't added/);
    expect(q(".v2-ce-file")).toBeNull();
    expect(q('input[aria-label="Add files"]')!.getAttribute("accept")).toBeTruthy();
  });

  it("shows a drag highlight that survives entering a child and clears on leave", () => {
    const { q } = mount(newCodeClipHtml());
    const dialog = q('[role="dialog"][aria-label="Code editor"]')!;
    act(() => { fire(dialog, "dragenter"); });
    expect(dialog.classList.contains("is-drag")).toBe(true);
    expect(q('[data-testid="v2-ce-dropveil"]')).toBeTruthy();
    act(() => { fire(dialog.querySelector(".v2-ce-bar")!, "dragenter"); });
    expect(dialog.classList.contains("is-drag")).toBe(true);
    act(() => { fire(dialog.querySelector(".v2-ce-bar")!, "dragleave"); });
    expect(dialog.classList.contains("is-drag")).toBe(true);
    act(() => { fire(dialog, "dragleave"); });
    expect(dialog.classList.contains("is-drag")).toBe(false);
    expect(q('[data-testid="v2-ce-dropveil"]')).toBeNull();
  });

  it("mobile keeps the file picker and hides the drop hint", () => {
    const { q, tab } = mount(newCodeClipHtml(), { mobile: true });
    tab("Files");
    expect(q('[data-testid="v2-ce-dropzone"]')).toBeTruthy();
    expect(q('button.v2-ce-addfile')).toBeTruthy();
    expect(q('input[aria-label="Add files"]')).toBeTruthy();
    expect(q('.v2-ce.is-mobile')).toBeTruthy();
  });
});


// @vitest-environment jsdom
/** P4B: Create code → AI mode wizard. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CODE_VIDEO_GUIDE, HTML_CLIP_PACKAGE_REPLY, htmlClipTemplate, promptManifest, runtimeAiLinks, wizardPackageInput, newWizardAnswers } from "../domain";
import { CodeAiWizard } from "./CodeAiWizard";
import { CodeEditor } from "./CodeEditor";
import { newCodeClipHtml } from "./codeSamples";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
let root: Root | undefined; let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; });
const mount = (props: Partial<Parameters<typeof CodeAiWizard>[0]> = {}) => {
  const onImport = vi.fn(); const onClose = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root!.render(<CodeAiWizard mobile={false} onImport={onImport} onClose={onClose} {...props} />));
  return { onImport, onClose };
};
const btn = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === name || b.textContent?.trim() === name)!;
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); };
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => act(() => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true }));
});
const step = () => document.querySelector(".v2-ce-title .v2-muted")!.textContent;

describe("Code AI mode wizard (P4B)", () => {
  it("walks the steps, builds the prompt with the reference video, and imports a package into the Code Editor", async () => {
    const { onImport } = mount({ initialRole: "overlay" });
    expect(step()).toBe("Step 1 of 8 · Describe");
    expect(btn("Next").disabled).toBe(true);
    type(document.querySelector<HTMLTextAreaElement>('[aria-label="Describe the clip"]')!, "Boxes people in drone footage");
    await click(btn("Next"));
    expect(document.querySelector('[role=radio][aria-checked=true]')!.textContent).toContain("Overlay on a video");
    await click(btn("Next"));
    await click(btn("Add parameter"));
    type(document.querySelector<HTMLInputElement>('[aria-label="Parameter name"]')!, "1bad");
    expect(document.querySelector('[role=alert]')!.textContent).toContain("not a valid param name");
    expect(btn("Next").disabled).toBe(true);
    type(document.querySelector<HTMLInputElement>('[aria-label="Parameter name"]')!, "boxColor");
    await click(btn("Next"));
    expect(step()).toBe("Step 4 of 8 · Size & duration");
    await click(btn("Next"));
    await click(btn("Next"));
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = undefined;
    const input = document.querySelector<HTMLInputElement>('[aria-label="Add reference media"]')!;
    const file = new File(["x"], "drone.mp4", { type: "video/mp4" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.querySelector(".v2-cw-ref")!.textContent).toContain("drone.mp4");
    await click(btn("Build prompt"));
    const prompt = document.querySelector(".v2-cw-prompt")!.textContent!;
    expect(prompt).toContain(runtimeAiLinks().htmlClipSpec);
    expect(prompt).toContain(CODE_VIDEO_GUIDE);
    expect(prompt).toContain('"boxColor"');
    expect(prompt).toContain('"videoOffset"');
    expect(prompt).toContain(HTML_CLIP_PACKAGE_REPLY);
    await click(btn("I have the reply"));
    const a = { ...newWizardAnswers("overlay"), description: "Boxes people in drone footage" };
    const html = htmlClipTemplate(promptManifest(wizardPackageInput(a), []));
    type(document.querySelector<HTMLTextAreaElement>('[aria-label="Paste the AI\'s reply or the HTML"]')!, "```html\n" + html + "```");
    expect(btn("Open in Code Editor").disabled).toBe(false);
    await click(btn("Open in Code Editor"));
    expect(onImport).toHaveBeenCalledWith(html);
  });
  it("shows package problems and blocks the import", async () => {
    mount();
    type(document.querySelector<HTMLTextAreaElement>('[aria-label="Describe the clip"]')!, "x");
    for (const s of ["Step 7 of 8 · Prompt", "Step 8 of 8 · Import"]) { await click([...document.querySelectorAll<HTMLButtonElement>(".v2-cw-navbtn")].find((b) => s.endsWith(b.textContent!.replace(/^\d/, "")))!); expect(step()).toBe(s); }
    type(document.querySelector<HTMLTextAreaElement>('[aria-label="Paste the AI\'s reply or the HTML"]')!, '<!doctype html><html><head></head><body><script src="https://cdn.example.com/x.js"></script></body></html>');
    expect(btn("Open in Code Editor").disabled).toBe(true);
    expect(document.querySelector('[data-testid="v2-clip-issues"]')).not.toBeNull();
  });
  it("closes back to the Code Editor", async () => {
    const { onClose } = mount();
    await click(btn("Back to the Code Editor"));
    expect(onClose).toHaveBeenCalled();
  });
  it("Create code shows an AI mode button; editing an existing clip does not", async () => {
    const onAiMode = vi.fn();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root!.render(<CodeEditor source={newCodeClipHtml()} mobile={false} create onSave={() => {}} onClose={() => {}} onAiMode={onAiMode} />));
    await click(btn("AI mode")); expect(onAiMode).toHaveBeenCalled();
    act(() => root!.render(<CodeEditor source={newCodeClipHtml()} mobile={false} onSave={() => {}} onClose={() => {}} />));
    expect(document.querySelector(".v2-ce-aibtn")).toBeNull();
  });
});

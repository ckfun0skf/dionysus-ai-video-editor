// @vitest-environment jsdom
/** P44: Code Editor → Revise with AI. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HTML_CLIP_CONTRACT, HTML_CLIP_PACKAGE_REPLY, REVISE_EMBED_MAX_CHARS, htmlClipTemplate, runtimeAiLinks } from "../domain";
import { CodeEditor } from "./CodeEditor";
import { CodeReviseWizard } from "./CodeReviseWizard";
import { packageBaseName } from "./htmlPackage";
import { newCodeClipHtml } from "./codeSamples";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  URL.createObjectURL = (() => "blob:x") as never;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});
let root: Root | undefined; let host: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = undefined; });

const btn = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === name || b.textContent?.trim() === name)!;
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); };
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => act(() => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true }));
});
const step = () => document.querySelector(".v2-ce-title .v2-muted")!.textContent;
const radio = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.includes(name))!;

const mountWizard = (html: string, mobile = false) => {
  const onImport = vi.fn(); const onClose = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root!.render(<CodeReviseWizard mobile={mobile} html={html} onImport={onImport} onClose={onClose} />));
  return { onImport, onClose };
};

describe("Revise with AI wizard (P44)", () => {
  it("walks describe → mode → prompt → import on the AI-mode shell, and embeds a small package", async () => {
    const html = newCodeClipHtml();
    mountWizard(html);
    expect(document.querySelector('[aria-label="Revise with AI"]')).not.toBeNull();
    expect([...document.querySelectorAll(".v2-cw-navbtn")].map((b) => b.textContent!.replace(/^\d/, ""))).toEqual(["Describe", "Mode", "Prompt", "Import"]);
    expect(step()).toBe("Step 1 of 4 · Describe");
    expect(btn("Next").disabled).toBe(true);
    type(document.querySelector<HTMLTextAreaElement>('[aria-label="What should change?"]')!, "Fade the title out");
    await click(btn("Next"));
    expect(step()).toBe("Step 2 of 4 · Mode");
    expect(radio("Embed HTML in prompt").getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("Embed starts selected");
    await click(btn("Build prompt"));
    const prompt = document.querySelector(".v2-cw-prompt")!.textContent!;
    expect(prompt).toContain("Fade the title out");
    expect(prompt).toContain(runtimeAiLinks().htmlClipSpec);
    expect(prompt).toContain(HTML_CLIP_CONTRACT);
    expect(prompt).toContain(HTML_CLIP_PACKAGE_REPLY);
    expect(prompt).toContain("g.fillText");
    expect(prompt).toContain('"title"');
    expect(document.querySelector('[data-testid="copy-code-revise-prompt"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Export .html");
    await click(btn("I have the reply"));
    expect(step()).toBe("Step 4 of 4 · Import");
    const reply = htmlClipTemplate();
    type(document.querySelector<HTMLTextAreaElement>('[aria-label="Paste the AI\'s reply or the HTML"]')!, "```html\n" + reply + "```");
    expect(document.querySelector('[data-testid="v2-clip-issues"]')!.textContent).toContain('Param "title" (text) is declared on the current clip');
    expect(document.querySelector('[data-testid="v2-clip-issues"]')!.textContent).not.toContain("storyboard");
    expect(btn("Open in Code Editor").disabled).toBe(false);
  });

  it("attach mode names the download file and omits the HTML; the user can switch back to embed", async () => {
    const marker = "REVISE_MARKER_attach";
    const html = `${newCodeClipHtml()}\n<!-- ${marker}${"x".repeat(REVISE_EMBED_MAX_CHARS)} -->`;
    const { onClose } = mountWizard(html);
    type(document.querySelector<HTMLTextAreaElement>('[aria-label="What should change?"]')!, "Quieter colours");
    await click(btn("Next"));
    expect(radio("Attach HTML to AI").getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("Attach starts selected");
    await click(btn("Build prompt"));
    const fileName = `${packageBaseName(html, "clip")}.html`;
    let prompt = document.querySelector(".v2-cw-prompt")!.textContent!;
    expect(prompt).toContain(fileName);
    expect(prompt).toContain(`attached to this chat as ${fileName}`);
    expect(prompt).not.toContain(marker);
    expect(btn("Export .html")).toBeTruthy();
    expect(btn("Copy HTML")).toBeTruthy();
    await click(btn("Back"));
    await click(radio("Embed HTML in prompt"));
    await click(btn("Build prompt"));
    prompt = document.querySelector(".v2-cw-prompt")!.textContent!;
    expect(prompt).toContain(marker);
    expect(document.body.textContent).not.toContain("Export .html");
    await click(btn("Back to the Code Editor"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the step progress on a phone", () => {
    mountWizard(newCodeClipHtml(), true);
    expect(document.querySelector(".v2-cw-nav")).toBeNull();
    expect(document.querySelector('[role="progressbar"]')!.getAttribute("aria-valuemax")).toBe("4");
    expect(document.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("1");
  });
});

describe("Code Editor entry (P44)", () => {
  const mountEditor = (props: { create?: boolean; onAiMode?: () => void } = {}) => {
    const onSave = vi.fn(); const onClose = vi.fn();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root!.render(<CodeEditor source={newCodeClipHtml()} mobile={false} create={props.create} onAiMode={props.onAiMode} onSave={onSave} onClose={onClose} />));
    return { onSave, onClose };
  };

  it("offers Revise with AI on an existing clip, and not while creating one", async () => {
    const onAiMode = vi.fn();
    mountEditor({ create: true, onAiMode });
    expect(document.querySelector(".v2-ce-revisebtn")).toBeNull();
    await click(btn("AI mode"));
    expect(onAiMode).toHaveBeenCalled();
    act(() => root!.render(<CodeEditor source={newCodeClipHtml()} mobile={false} onSave={() => {}} onClose={() => {}} />));
    expect(document.querySelector(".v2-ce-aibtn")).toBeNull();
    expect(btn("Revise with AI")).toBeTruthy();
  });

  it("keeps unsaved edits when the wizard closes, and uses them in the prompt", async () => {
    mountEditor();
    const area = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Script"]')!;
    type(area, `${area.value}\n// keep-me-7a\n`);
    await click(btn("Revise with AI"));
    type(document.querySelector<HTMLTextAreaElement>('[aria-label="What should change?"]')!, "Move the circle");
    await click(btn("Next"));
    await click(btn("Build prompt"));
    expect(document.querySelector(".v2-cw-prompt")!.textContent).toContain("// keep-me-7a");
    await click(btn("Back to the Code Editor"));
    expect(document.querySelector('[aria-label="Code editor"]')).not.toBeNull();
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Script"]')!.value).toContain("// keep-me-7a");
  });

  it("imports a reply into the Code Editor so Save can make a new version", async () => {
    const { onSave } = mountEditor();
    await click(btn("Revise with AI"));
    type(document.querySelector<HTMLTextAreaElement>('[aria-label="What should change?"]')!, "Use the template colours");
    await click(btn("Next"));
    await click(btn("Build prompt"));
    await click(btn("I have the reply"));
    const reply = htmlClipTemplate();
    type(document.querySelector<HTMLTextAreaElement>('[aria-label="Paste the AI\'s reply or the HTML"]')!, reply);
    await click(btn("Open in Code Editor"));
    expect(document.querySelector('[aria-label="Code editor"]')).not.toBeNull();
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Script"]')!.value).toContain("#5ad1c8");
    expect(btn("Save").disabled).toBe(false);
    await click(btn("Save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toContain("#5ad1c8");
    expect(onSave.mock.calls[0][0]).toContain("dionysus.htmlclip/1");
  });
});

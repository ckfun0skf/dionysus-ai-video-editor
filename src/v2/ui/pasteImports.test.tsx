// @vitest-environment jsdom
/** P36: paste instead of upload — a storyboard code version (Paste HTML) and subtitles (SRT/VTT text). */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createProject } from "../domain";
import { Engine } from "../engine";
import { StoryAssetPicker } from "./storyboard/StoryAssetPicker";
import { importSrtText, SubtitleImport } from "./Subtitles";

beforeAll(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
const mount = (node: React.ReactNode) => { const el = document.createElement("div"); document.body.appendChild(el); act(() => { createRoot(el).render(node); }); return el; };
const btn = (el: HTMLElement, re: RegExp) => [...el.querySelectorAll("button")].find((b) => re.test(b.textContent ?? "") || re.test(b.getAttribute("aria-label") ?? "")) as HTMLButtonElement | undefined;
const SRT = "1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:05,500\nWorld\n";

describe("storyboard Add version: Paste HTML (P36)", () => {
  const blobs = { get: async () => undefined } as never;
  it("code clips offer Paste HTML next to Upload new; it opens the paste box", () => {
    const el = mount(<StoryAssetPicker project={createProject()} kind="html" title="Add a version" thumbs={{}} blobs={blobs} uploadLabel="HTML" onUpload={() => {}} onPick={() => {}} onClose={() => {}} onPasteHtml={vi.fn()} />);
    const paste = btn(el, /Paste HTML/)!;
    expect(paste).toBeTruthy();
    act(() => paste.click());
    expect(el.querySelector('textarea[aria-label="Paste the AI\'s reply or the HTML"]')).toBeTruthy();
  });
  it("other kinds have no Paste HTML", () => {
    const el = mount(<StoryAssetPicker project={createProject()} kind="video" title="Add a version" thumbs={{}} blobs={blobs} uploadLabel="Video" onUpload={() => {}} onPick={() => {}} onClose={() => {}} onPasteHtml={vi.fn()} />);
    expect(btn(el, /Paste HTML/)).toBeUndefined();
  });
});

describe("subtitle paste import (P36)", () => {
  it("importSrtText adds one text layer with every cue, one undo step", () => {
    const e = new Engine(createProject());
    const tracks = () => e.getState().project.compositions[e.getState().project.rootCompositionId].tracks.length;
    const t0 = tracks();
    expect(importSrtText(e, SRT)).toBe(2);
    expect(tracks()).toBe(t0 + 1);
    e.undo();
    expect(tracks()).toBe(t0);
    expect(importSrtText(e, "no cues here")).toBe(0);
  });
  it("the dialog counts cues live and only enables ✓ when some were found", () => {
    const onPaste = vi.fn();
    const el = mount(<SubtitleImport onPasteImport={onPaste} onChooseFile={() => {}} onClose={() => {}} />);
    const ok = btn(el, /Import pasted subtitles/)!;
    expect(ok.disabled).toBe(true);
    const ta = el.querySelector("textarea")!;
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { set.call(ta, SRT); ta.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(el.textContent).toContain("2 subtitles found");
    expect(ok.disabled).toBe(false);
    act(() => ok.click());
    expect(onPaste).toHaveBeenCalledWith(SRT);
    expect(btn(el, /Choose file/)).toBeTruthy();
  });
});

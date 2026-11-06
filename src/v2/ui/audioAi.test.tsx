// @vitest-environment jsdom
/** P36: Audio → Create with AI (describe → copy prompt → paste JSON → add). */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AudioAiSheet } from "./AudioAiSheet";

let clip = "";
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => { clip = t; } }, configurable: true });
});
const btn = (el: HTMLElement, re: RegExp) => [...el.querySelectorAll("button")].find((b) => re.test(b.textContent ?? "") || re.test(b.getAttribute("aria-label") ?? "")) as HTMLButtonElement;
const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };

describe("AudioAiSheet", () => {
  it("needs a description, copies a prompt with it, then takes the pasted clip", async () => {
    const onAdd = vi.fn();
    const el = document.createElement("div"); document.body.appendChild(el);
    act(() => { createRoot(el).render(<AudioAiSheet onAdd={onAdd} onClose={() => {}} />); });
    expect(btn(el, /Copy prompt/).disabled).toBe(true);
    act(() => type(el.querySelector("textarea")!, "Gentle rain on a tin roof"));
    await act(async () => btn(el, /Copy prompt/).click());
    expect(clip).toContain("Gentle rain on a tin roof");
    expect(clip).toContain("dionysus.audioclip/1");
    act(() => btn(el, /Paste answer/).click());
    expect(el.querySelector('textarea[aria-label="Paste the AI\'s reply or the audio clip JSON"]')).toBeTruthy();
  });
});

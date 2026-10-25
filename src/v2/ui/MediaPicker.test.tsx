// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fileKind, MediaPicker, type Picked, type ProjectMedia } from "./MediaPicker";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  URL.createObjectURL = (() => "blob:x") as never;
  URL.revokeObjectURL = (() => undefined) as never;
});
const roots: Root[] = [];
afterEach(() => { act(() => { roots.splice(0).forEach((r) => r.unmount()); }); document.body.innerHTML = ""; });

const MEDIA: ProjectMedia[] = [
  { id: "v1", name: "beach.mp4", kind: "video", thumb: "data:v1", durationTicks: 120_000 * 65, createdAt: "2026-01-02" },
  { id: "i1", name: "logo.png", kind: "image", thumb: "data:i1", createdAt: "2026-01-03" },
  { id: "h1", name: "Title card.html", kind: "html", thumb: "data:h1", durationTicks: 120_000 * 5, createdAt: "2026-01-04" },
  { id: "a1", name: "song.mp3", kind: "audio", durationTicks: 120_000 * 30, createdAt: "2026-01-05" },
];
function mount(props: Partial<Parameters<typeof MediaPicker>[0]> = {}) {
  const el = document.createElement("div"); document.body.appendChild(el);
  const onAdd = vi.fn<(p: Picked) => void>(), onCreateCode = vi.fn(), onClose = vi.fn();
  const root = createRoot(el); roots.push(root);
  act(() => { root.render(<MediaPicker title="Add media" media={MEDIA} onAdd={onAdd} onClose={onClose} onCreateCode={onCreateCode} {...props} />); });
  const tabs = () => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
  const tab = (name: string) => act(() => { ([...el.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name) as HTMLElement).click(); });
  const btn = (label: string) => [...el.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim().startsWith(label)) as HTMLButtonElement | undefined;
  const panel = () => el.querySelector('[role="tabpanel"]') as HTMLElement;
  return { el, onAdd, onCreateCode, onClose, tabs, tab, btn, panel };
}

describe("V2-ADD-MEDIA-TABS Add Media picker", () => {
  it("has Video / Photo / Code / Sticker tabs (no Library, no Text) and opens on Video", () => {
    const { tabs, panel } = mount();
    expect(tabs()).toEqual(["Video", "Photo", "Code", "Sticker"]);
    expect(panel().dataset.tab).toBe("video");
    expect(panel().textContent).not.toMatch(/three\.js scene|Blank HTML|Canvas animation/);
  });

  it("each media tab has Upload plus only the project's media of that kind, with thumbnails and durations", () => {
    const { tab, panel, el } = mount();
    const names = () => [...panel().querySelectorAll('[data-testid="project-media"] .v2-pick-name')].map((n) => n.textContent);
    expect(panel().textContent).toContain("Upload");
    expect(names()).toEqual(["beach.mp4"]);
    expect(panel().querySelector(".v2-pick-dur")!.textContent).toBe("1:05");
    expect(panel().querySelector("img")!.getAttribute("src")).toBe("data:v1");
    tab("Photo");
    expect(names()).toEqual(["logo.png"]);
    expect(panel().querySelector('input[type="file"]')!.getAttribute("accept")).toBe("image/*");
    tab("Code");
    expect(names()).toEqual(["Title card.html"]);
    expect(panel().querySelector("img")!.getAttribute("src")).toBe("data:h1");
    expect(panel().querySelector('input[type="file"]')!.getAttribute("accept")).toContain(".zip");
    expect(el.textContent).not.toContain("song.mp3");
  });

  it("Code → Create calls onCreateCode; Create only shows on the Code tab", () => {
    const { tab, btn, onCreateCode } = mount();
    expect(btn("Create")).toBeUndefined();
    tab("Code");
    act(() => { btn("Create")!.click(); });
    expect(onCreateCode).toHaveBeenCalledTimes(1);
  });

  it("picks across tabs in order and adds project media, uploads and stickers", () => {
    const { tab, btn, panel, onAdd } = mount();
    act(() => { btn("beach.mp4")!.click(); });
    tab("Code");
    act(() => { btn("Title card.html")!.click(); });
    const input = panel().querySelector('input[type="file"]') as HTMLInputElement;
    const f = new File(["<html></html>"], "clip.html", { type: "text/html" });
    Object.defineProperty(input, "files", { value: [f], configurable: true });
    act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(panel().querySelector('[data-testid="device-media"]')!.textContent).toContain("clip.html");
    tab("Sticker");
    const sticker = panel().querySelector(".v2-pick-tile.is-sticker") as HTMLButtonElement;
    act(() => { sticker.click(); });
    act(() => { btn("Add (4)")!.click(); });
    const p = onAdd.mock.calls[0][0];
    expect(p.assets).toEqual(["v1", "h1"]);
    expect(p.files.map((x) => x.name)).toEqual(["clip.html"]);
    expect(p.stickers.length).toBe(1);
  });

  it("audio mode shows only audio, without tabs or Create", () => {
    const { tabs, panel, btn } = mount({ only: "audio", title: "Add audio" });
    expect(tabs()).toEqual([]);
    expect(panel().textContent).toContain("song.mp3");
    expect(panel().textContent).not.toContain("beach.mp4");
    expect(btn("Create")).toBeUndefined();
  });

  it("sorts device files into tabs by type", () => {
    expect(fileKind(new File([], "a.mp4", { type: "video/mp4" }))).toBe("video");
    expect(fileKind(new File([], "a.png", { type: "image/png" }))).toBe("image");
    expect(fileKind(new File([], "a.dionysus-html.zip", { type: "application/zip" }))).toBe("html");
    expect(fileKind(new File([], "a.htm", { type: "" }))).toBe("html");
  });
});

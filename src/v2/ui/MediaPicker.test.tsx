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

describe("P18 Add audio → From Video", () => {
  const vids: ProjectMedia[] = [
    { id: "v1", name: "beach.mp4", kind: "video", thumb: "data:v1", durationTicks: 120_000 * 10, createdAt: "2026-01-02" },
    { id: "v2", name: "silent.mp4", kind: "video", thumb: "data:v2", durationTicks: 120_000 * 5, createdAt: "2026-01-03" },
    { id: "a1", name: "song.mp3", kind: "audio", durationTicks: 120_000 * 30, createdAt: "2026-01-05" },
  ];
  const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); };
  it("shows Audio and From Video tabs; no-audio videos are disabled; Add returns the trimmed span and mute choice", async () => {
    const onAddFromVideo = vi.fn();
    const blobs: Record<string, Blob> = { v1: new Blob(["1"]), v2: new Blob(["2"]) };
    const m = mount({ only: "audio", media: vids, onAddFromVideo, onTimeline: (id) => id === "v1",
      loadMedia: async (id) => blobs[id], probeAudio: async (b) => b === blobs.v1 });
    expect(m.tabs()).toEqual(["Audio", "From Video"]);
    expect(m.panel().dataset.tab).toBe("audio");
    m.tab("From Video");
    await flush();
    const grid = m.el.querySelector('[data-testid="video-sources"]')!;
    expect([...grid.querySelectorAll(".v2-pick-name")].map((x) => x.textContent).sort()).toEqual(["beach.mp4", "silent.mp4"]);
    const silent = m.btn("silent.mp4, no audio")!;
    expect(silent.disabled).toBe(true);
    expect(silent.textContent).toContain("No audio");
    expect(m.btn("Add audio")!.disabled).toBe(true);
    act(() => { m.btn("beach.mp4")!.click(); });
    const inp = m.el.querySelector('input[aria-label="In (seconds)"]') as HTMLInputElement;
    expect(inp).toBeTruthy();
    act(() => { m.btn("In later")!.click(); });
    const mute = [...m.el.querySelectorAll("label")].find((l) => l.textContent?.includes("Mute original video clip"))!.querySelector("input")!;
    act(() => { mute.click(); });
    act(() => { m.btn("Add audio")!.click(); });
    expect(onAddFromVideo).toHaveBeenCalledTimes(1);
    const p = onAddFromVideo.mock.calls[0][0];
    expect(p).toMatchObject({ assetId: "v1", outSec: 10, muteOriginal: true });
    expect(p.inSec).toBeGreaterThan(0);
  });
  it("opens on From Video when asked, and has no From Video tab without the handler", () => {
    expect(mount({ only: "audio", media: vids, onAddFromVideo: vi.fn(), initialTab: "fromVideo" }).panel().dataset.tab).toBe("fromVideo");
    expect(mount({ only: "audio", media: vids }).tabs()).not.toContain("From Video");
  });
});

describe("P19 From Video → Upload video", () => {
  const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
  const vid = (id: string): ProjectMedia => ({ id, name: `${id}.mp4`, kind: "video", durationTicks: 120_000 * 4, createdAt: "2026-01-02" });
  const upload = async (el: HTMLElement, name = "new.mp4") => {
    const input = el.querySelector('input[aria-label="Upload video"]') as HTMLInputElement;
    expect(input.accept).toContain("video/*");
    Object.defineProperty(input, "files", { value: [new File(["x"], name, { type: "video/mp4" })], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  };
  function harness(result: (keep: boolean) => { assetId: string; audio: boolean | undefined } | { error: string }) {
    const el = document.createElement("div"); document.body.appendChild(el);
    const root = createRoot(el); roots.push(root);
    const onAddFromVideo = vi.fn(), onDiscardVideo = vi.fn(), onClose = vi.fn();
    let media: ProjectMedia[] = [];
    const render = () => root.render(<MediaPicker title="Add audio" only="audio" initialTab="fromVideo" media={media} onAdd={vi.fn()} onClose={onClose}
      onAddFromVideo={onAddFromVideo} onDiscardVideo={onDiscardVideo}
      onUploadVideo={async (_f, keep, progress) => { progress(0.5); const r = result(keep); if (!("error" in r)) { media = [vid(r.assetId)]; render(); } return r; }} />);
    act(render);
    return { el, onAddFromVideo, onDiscardVideo, onClose };
  }
  it("has an Upload video action (keep on by default) that auto-selects the upload for trim/preview/Add audio", async () => {
    const h = harness(() => ({ assetId: "up1", audio: true }));
    const btn = [...h.el.querySelectorAll("button")].find((b) => b.textContent?.includes("Upload video"))!;
    expect(btn.className).toContain("v2-pick-action");
    const keep = [...h.el.querySelectorAll("label")].find((l) => l.textContent?.includes("Keep video in library"))!.querySelector("input")!;
    expect(keep.checked).toBe(true);
    await upload(h.el); await flush();
    expect(h.el.querySelector('input[aria-label="In (seconds)"]')).toBeTruthy();
    act(() => { ([...h.el.querySelectorAll("button")].find((b) => b.textContent === "Add audio") as HTMLButtonElement).click(); });
    expect(h.onAddFromVideo.mock.calls[0][0]).toMatchObject({ assetId: "up1", inSec: 0, outSec: 4 });
    expect(h.onAddFromVideo.mock.calls[0][0].discardVideo).toBeUndefined();
    expect(h.onDiscardVideo).not.toHaveBeenCalled();
  });
  it("audio-only marks the pick discardVideo; closing without adding removes the upload", async () => {
    const h = harness((keep) => { expect(keep).toBe(false); return { assetId: "up2", audio: true }; });
    act(() => { ([...h.el.querySelectorAll("label")].find((l) => l.textContent?.includes("Keep video in library"))!.querySelector("input") as HTMLInputElement).click(); });
    expect(h.el.textContent).toContain("Audio only: the video is removed");
    await upload(h.el); await flush();
    expect(h.el.textContent).toContain("Audio only");
    act(() => { (h.el.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click(); });
    expect(h.onDiscardVideo).toHaveBeenCalledWith("up2");
    expect(h.onClose).toHaveBeenCalled();
  });
  it("audio-only Add passes discardVideo", async () => {
    const h = harness(() => ({ assetId: "up3", audio: undefined }));
    act(() => { ([...h.el.querySelectorAll("label")].find((l) => l.textContent?.includes("Keep video in library"))!.querySelector("input") as HTMLInputElement).click(); });
    await upload(h.el); await flush();
    act(() => { ([...h.el.querySelectorAll("button")].find((b) => b.textContent === "Add audio") as HTMLButtonElement).click(); });
    expect(h.onAddFromVideo.mock.calls[0][0]).toMatchObject({ assetId: "up3", discardVideo: true });
    expect(h.onDiscardVideo).not.toHaveBeenCalled();
  });
  it("says 'This video has no audio' and does not select it; errors are shown", async () => {
    const h = harness(() => ({ assetId: "up4", audio: false }));
    await upload(h.el); await flush();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toBe("This video has no audio");
    expect(h.el.querySelector('input[aria-label="In (seconds)"]')).toBeNull();
    const e = harness(() => ({ error: "Unsupported video file" }));
    await upload(e.el, "bad.mp4"); await flush();
    expect(e.el.querySelector('[role="alert"]')?.textContent).toBe("bad.mp4: Unsupported video file");
  });
});

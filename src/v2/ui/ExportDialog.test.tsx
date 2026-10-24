// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createProject } from "../domain";
import { createMemoryStorage } from "../persistence";
import { avcCandidates, formatLabel, formatNote, pickAudio, webmFormat, type ExportFormat } from "../render/export/encode";
import { ExportDialog } from "./ExportDialog";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  URL.createObjectURL = () => "blob:x"; URL.revokeObjectURL = () => undefined;
});
const btn = (el: HTMLElement, t: string) => [...el.querySelectorAll("button,a")].find((b) => b.textContent === t) as HTMLElement;

function mount(run: Parameters<typeof ExportDialog>[0]["run"], probe?: Parameters<typeof ExportDialog>[0]["probe"]) {
  const el = document.createElement("div"); const root = createRoot(el); const onClose = vi.fn();
  act(() => root.render(<ExportDialog project={createProject("My cut")} blobs={createMemoryStorage().blobs} res="720p" onRes={() => undefined} onClose={onClose} run={run} probe={probe} />));
  return { el, onClose };
}

describe("ExportDialog", () => {
  it("shows progress, then a download", async () => {
    let finish!: () => void;
    const run = vi.fn(async (_p, _b, o) => { o.onProgress?.({ stage: "video", done: 3, total: 4 }); await new Promise<void>((r) => (finish = r)); return { blob: new Blob(["abc"]), ext: "mp4" as const }; });
    const { el } = mount(run);
    await act(async () => btn(el, "Start export").click());
    expect(run.mock.calls[0][2].res).toBe("720p");
    expect(el.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("75");
    expect(el.textContent).toContain("Rendering frames 3 / 4");
    await act(async () => finish());
    const a = btn(el, "Download") as HTMLAnchorElement;
    expect(a.download).toBe("My-cut.mp4");
    expect(el.textContent).toContain("MP4");
  });
  it("cancels back to the start screen", async () => {
    const run = vi.fn((_p, _b, o) => new Promise<never>((_, rej) => o.signal!.addEventListener("abort", () => rej(new Error("x")))));
    const { el } = mount(run);
    await act(async () => btn(el, "Start export").click());
    await act(async () => btn(el, "Cancel export").click());
    expect(btn(el, "Start export")).toBeTruthy();
  });
  it("warns when HTML clip frames timed out, but still offers the file", async () => {
    const { el } = mount(vi.fn(async () => ({ blob: new Blob(["a"]), ext: "mp4" as const, warnings: ["scene.html: 3 frames timed out (4 s), first at 1.00 s."] })));
    await act(async () => btn(el, "Start export").click());
    expect(el.querySelector('[role="alert"]')!.textContent).toContain("scene.html: 3 frames timed out");
    expect(btn(el, "Download")).toBeTruthy();
  });
  it("reports errors with retry", async () => {
    const { el } = mount(vi.fn(async () => { throw new Error("The timeline is empty"); }));
    await act(async () => btn(el, "Start export").click());
    expect(el.querySelector('[role="alert"]')!.textContent).toContain("timeline is empty");
    expect(btn(el, "Try again")).toBeTruthy();
  });
  it("names the real format before and after export (V2-SB-129)", async () => {
    const f: ExportFormat = { ext: "mp4", video: "H.264", audio: "Opus" };
    const { el } = mount(vi.fn(async () => ({ blob: new Blob(["a"]), ext: "mp4" as const, format: f, note: formatNote(f) })), async () => f);
    await act(async () => undefined);
    expect(el.querySelector('[data-testid="export-format"]')!.textContent).toBe("This browser will export MP4 (H.264 + Opus).");
    expect(el.textContent).toContain("audio is Opus");
    await act(async () => btn(el, "Start export").click());
    expect(el.querySelector('[role="status"]')!.textContent).toContain("Done — MP4 (H.264 + Opus)");
  });
  it("labels formats honestly", () => {
    expect(formatLabel({ ext: "mp4", video: "H.264", audio: "AAC" })).toBe("MP4 (H.264 + AAC)");
    expect(formatLabel({ ext: "mp4", video: "H.264" })).toBe("MP4 (H.264)");
    expect(formatLabel({ ext: "mp4", video: "H.264", audio: "none" })).toBe("MP4 (H.264, silent)");
    expect(formatLabel(webmFormat("video/webm;codecs=vp8,opus", true))).toBe("WebM (VP8 + Opus)");
    expect(formatLabel(webmFormat('video/webm; codecs="vp9"', false))).toBe("WebM (VP9)");
    expect(formatNote({ ext: "mp4", video: "H.264", audio: "AAC" })).toBeUndefined();
    expect(formatNote({ ext: "mp4", video: "H.264", audio: "none" })).toContain("silent");
  });
  it("picks AAC when supported, else Opus, else nothing", async () => {
    const g = globalThis as unknown as { AudioEncoder?: unknown };
    const with_ = (ok: (c: AudioEncoderConfig) => boolean) => { g.AudioEncoder = { isConfigSupported: async (c: AudioEncoderConfig) => ({ supported: ok(c) }) }; };
    try {
      with_(() => true); expect((await pickAudio())?.codec).toBe("mp4a.40.2");
      with_((c) => c.codec === "mp4a.40.2" && !c.bitrate); expect(await pickAudio()).toMatchObject({ codec: "mp4a.40.2" });
      with_((c) => c.codec === "opus"); expect((await pickAudio())?.codec).toBe("opus");
      with_(() => false); expect(await pickAudio()).toBeUndefined();
    } finally { delete g.AudioEncoder; }
  });
  it("prefers H.264 High, with 4K levels for big frames", () => {
    expect(avcCandidates(1920, 1080)[0]).toBe("avc1.640028");
    expect(avcCandidates(3840, 2160)[0]).toBe("avc1.640033");
  });
});

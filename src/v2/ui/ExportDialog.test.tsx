// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createProject } from "../domain";
import { createMemoryStorage } from "../persistence";
import { avcCandidates } from "../render/export/encode";
import { ExportDialog } from "./ExportDialog";

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  URL.createObjectURL = () => "blob:x"; URL.revokeObjectURL = () => undefined;
});
const btn = (el: HTMLElement, t: string) => [...el.querySelectorAll("button,a")].find((b) => b.textContent === t) as HTMLElement;

function mount(run: Parameters<typeof ExportDialog>[0]["run"]) {
  const el = document.createElement("div"); const root = createRoot(el); const onClose = vi.fn();
  act(() => root.render(<ExportDialog project={createProject("My cut")} blobs={createMemoryStorage().blobs} res="720p" onRes={() => undefined} onClose={onClose} run={run} />));
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
  it("reports errors with retry", async () => {
    const { el } = mount(vi.fn(async () => { throw new Error("The timeline is empty"); }));
    await act(async () => btn(el, "Start export").click());
    expect(el.querySelector('[role="alert"]')!.textContent).toContain("timeline is empty");
    expect(btn(el, "Try again")).toBeTruthy();
  });
  it("prefers H.264 High, with 4K levels for big frames", () => {
    expect(avcCandidates(1920, 1080)[0]).toBe("avc1.640028");
    expect(avcCandidates(3840, 2160)[0]).toBe("avc1.640033");
  });
});

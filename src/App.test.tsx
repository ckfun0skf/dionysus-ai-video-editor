// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { sampleProject } from "./sampleProject";

let container: HTMLDivElement;
let root: Root;
let createObjectURLMock: ReturnType<typeof vi.fn>;
let revokeObjectURLMock: ReturnType<typeof vi.fn>;
let originalCreateObjectURL: PropertyDescriptor | undefined;
let originalRevokeObjectURL: PropertyDescriptor | undefined;
let anchorClickSpy: ReturnType<typeof vi.spyOn>;

function click(button: HTMLButtonElement) {
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
    button => button.getAttribute("aria-label") === name
  );
}

function timelineRows(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".editor-linked-timeline .editor-timeline-footer")).slice(1);
}

function persistedProject(): typeof sampleProject {
  const raw = localStorage.getItem("dionysus.project.v1");
  if (!raw) throw new Error("Expected project to be persisted");
  return JSON.parse(raw) as typeof sampleProject;
}

async function flushEffects() {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  createObjectURLMock = vi.fn(() => "blob:mock-project-export");
  revokeObjectURLMock = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createObjectURLMock });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revokeObjectURLMock });
  anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));
});

afterEach(() => {
  anchorClickSpy.mockRestore();
  if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL); else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL); else Reflect.deleteProperty(URL, "revokeObjectURL");
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

describe("App history integration", () => {
  it("handles rapid timeline edits atomically and keeps linked audio in persisted state", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Video with linked audio"));
    expect(add).toBeTruthy();
    click(add as HTMLButtonElement);
    await flushEffects();

    let videoRow = timelineRows().find(row => row.textContent?.includes("Video clip 1"));
    expect(videoRow).toBeTruthy();
    click(Array.from(videoRow!.querySelectorAll("button")).find(button => button.textContent?.includes("+0.5s")) as HTMLButtonElement);
    videoRow = timelineRows().find(row => row.textContent?.includes("Video clip 1"));
    click(Array.from(videoRow!.querySelectorAll("button")).find(button => button.textContent?.includes("Trim")) as HTMLButtonElement);
    await flushEffects();

    const clips = persistedProject().timelineClips ?? [];
    const video = clips.find(clip => clip.kind === "video");
    const audio = clips.find(clip => clip.kind === "audio");
    expect(video).toBeTruthy();
    expect(audio).toMatchObject({ start: video!.start, duration: video!.duration, linkedVideoClipId: video!.id });
    expect(video).toMatchObject({ start: 0.5, duration: expect.any(Number) });
  });

  it("supports Undo/Redo buttons and Ctrl/Cmd+Z keyboard shortcuts", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Video with linked audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();
    expect(persistedProject().timelineClips).toHaveLength(2);

    const undoButtons = buttonsNamed("Undo");
    expect(undoButtons.length).toBeGreaterThan(0);
    click(undoButtons[0]);
    await flushEffects();
    expect(persistedProject().timelineClips ?? []).toHaveLength(0);

    const redoButtons = buttonsNamed("Redo");
    expect(redoButtons.some(button => !button.disabled)).toBe(true);
    click(redoButtons.find(button => !button.disabled)!);
    await flushEffects();
    expect(persistedProject().timelineClips).toHaveLength(2);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    await flushEffects();
    expect(persistedProject().timelineClips ?? []).toHaveLength(0);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true, bubbles: true }));
    await flushEffects();
    expect(persistedProject().timelineClips).toHaveLength(2);
  });

  it("clears Undo/Redo history after importing a valid project", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Video with linked audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();
    expect(buttonsNamed("Undo")[0].disabled).toBe(false);

    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="application/json"]');
    expect(input).toBeTruthy();
    const file = { text: async () => JSON.stringify(sampleProject) } as File;
    await act(async () => {
      Object.defineProperty(input!, "files", { configurable: true, value: [file] });
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await flushEffects();

    expect(buttonsNamed("Undo").every(button => button.disabled)).toBe(true);
    expect(buttonsNamed("Redo").every(button => button.disabled)).toBe(true);
    expect(persistedProject().id).toBe(sampleProject.id);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    await flushEffects();
    expect(persistedProject().id).toBe(sampleProject.id);
    expect(persistedProject().timelineClips ?? []).toEqual(sampleProject.timelineClips ?? []);
  });

  it("clears redo when a new timeline operation follows Undo", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Video with linked audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();
    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(buttonsNamed("Redo").every(button => button.disabled)).toBe(false);

    const addAgain = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Video with linked audio")) as HTMLButtonElement;
    click(addAgain);
    await flushEffects();
    expect(buttonsNamed("Redo").every(button => button.disabled)).toBe(true);
    expect(persistedProject().timelineClips).toHaveLength(2);
  });

  it("restores linked timeline state after an App unmount/remount from localStorage", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Video with linked audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();
    const beforeReload = persistedProject();
    expect(beforeReload.timelineClips).toHaveLength(2);

    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();

    const afterReload = persistedProject();
    expect(afterReload.timelineClips).toEqual(beforeReload.timelineClips);
    const video = afterReload.timelineClips?.find(clip => clip.kind === "video");
    const audio = afterReload.timelineClips?.find(clip => clip.kind === "audio");
    expect(audio).toMatchObject({ start: video!.start, duration: video!.duration, linkedVideoClipId: video!.id });
    expect(buttonsNamed("Undo").every(button => button.disabled)).toBe(true);
    expect(buttonsNamed("Redo").every(button => button.disabled)).toBe(true);
  });

  it("round-trips persisted linked timeline JSON through the import path", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Video with linked audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();
    const exportedJson = JSON.stringify(persistedProject());
    const expected = JSON.parse(exportedJson);

    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="application/json"]');
    expect(input).toBeTruthy();
    const file = { text: async () => exportedJson } as File;
    await act(async () => {
      Object.defineProperty(input!, "files", { configurable: true, value: [file] });
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await flushEffects();

    const imported = persistedProject();
    expect(imported.timelineClips).toEqual(expected.timelineClips);
    const video = imported.timelineClips?.find(clip => clip.kind === "video");
    const audio = imported.timelineClips?.find(clip => clip.kind === "audio");
    expect(audio).toMatchObject({ start: video!.start, duration: video!.duration, linkedVideoClipId: video!.id });
    expect(buttonsNamed("Undo").every(button => button.disabled)).toBe(true);
    expect(buttonsNamed("Redo").every(button => button.disabled)).toBe(true);
  });


  it("exports the current project as JSON including linked timeline metadata", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Video with linked audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();

    const exportButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.textContent?.includes("Export Project"));
    expect(exportButton).toBeTruthy();
    click(exportButton!);

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    const blob = createObjectURLMock.mock.calls[0][0] as Blob;
    const exported = JSON.parse(await blob.text()) as typeof sampleProject;
    const video = exported.timelineClips?.find(clip => clip.kind === "video");
    const audio = exported.timelineClips?.find(clip => clip.kind === "audio");
    expect(video).toBeTruthy();
    expect(audio).toMatchObject({ start: video!.start, duration: video!.duration, linkedVideoClipId: video!.id });
  });

  it("does not overwrite the current project when import JSON is invalid", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Video with linked audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();
    const before = persistedProject();

    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*="application/json"]');
    expect(input).toBeTruthy();
    const file = { text: async () => "{ invalid json" } as File;
    await act(async () => {
      Object.defineProperty(input!, "files", { configurable: true, value: [file] });
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await flushEffects();

    expect(persistedProject().timelineClips).toEqual(before.timelineClips);
    expect(persistedProject().id).toBe(before.id);
    expect(input!.value).toBe("");
  });

});

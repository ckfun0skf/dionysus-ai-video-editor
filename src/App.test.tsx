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
  return Array.from(container.querySelectorAll<HTMLElement>(".visual-media-clip"));
}


function selectClip(name: string): HTMLButtonElement {
  const clip = timelineRows().find(row => row.textContent?.includes(name) && (name.includes(" audio") || !row.textContent?.includes(" audio")));
  if (!clip) throw new Error("Could not find timeline clip: " + name);
  click(clip as HTMLButtonElement);
  return clip as HTMLButtonElement;
}
function actionNamed(name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-clip-actions button"))
    .find(candidate => candidate.textContent?.includes(name));
  if (!button) throw new Error("Could not find clip action: " + name);
  return button;
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
  it("coalesces rapid edits to the same shot title into one Undo step", async () => {
    const titleInput = container.querySelector<HTMLInputElement>(".inspector .inspector-content input.text-field");
    expect(titleInput).toBeTruthy();
    const originalTitle = persistedProject().shots[0].title;
    const setInputValue = (value: string) => {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(titleInput!, value);
        titleInput!.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    setInputValue("Intermediate title");
    await flushEffects();
    expect(persistedProject().shots[0].title).toBe("Intermediate title");

    setInputValue("Final coalesced title");
    await flushEffects();
    expect(persistedProject().shots[0].title).toBe("Final coalesced title");

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(persistedProject().shots[0].title).toBe(originalTitle);

    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(persistedProject().shots[0].title).toBe("Final coalesced title");
  });

  it("handles rapid timeline edits atomically and keeps linked audio in persisted state", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio"));
    expect(add).toBeTruthy();
    click(add as HTMLButtonElement);
    await flushEffects();

    let videoRow = timelineRows().find(row => row.textContent?.includes("Video clip 1"));
    expect(videoRow).toBeTruthy();
    selectClip("Video clip 1");
    click(actionNamed("+0.5s"));
    videoRow = timelineRows().find(row => row.textContent?.includes("Video clip 1"));
    click(actionNamed("Trim"));
    await flushEffects();

    const clips = persistedProject().timelineClips ?? [];
    const video = clips.find(clip => clip.kind === "video");
    const audio = clips.find(clip => clip.kind === "audio");
    expect(video).toBeTruthy();
    expect(audio).toMatchObject({ start: video!.start, duration: video!.duration, linkedVideoClipId: video!.id });
    expect(video).toMatchObject({ start: 0.5, duration: expect.any(Number) });
  });

  it("supports Undo/Redo buttons and Ctrl/Cmd+Z keyboard shortcuts", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
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
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
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
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();
    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(buttonsNamed("Redo").every(button => button.disabled)).toBe(false);

    const addAgain = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
    click(addAgain);
    await flushEffects();
    expect(buttonsNamed("Redo").every(button => button.disabled)).toBe(true);
    expect(persistedProject().timelineClips).toHaveLength(2);
  });

  it("restores linked timeline state after an App unmount/remount from localStorage", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
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

  it("round-trips linked timeline metadata through actual project export and import", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();
    click(Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement);
    await flushEffects();

    const secondAudioRow = timelineRows().find(row => row.textContent?.includes("Video clip 2 audio"));
    expect(secondAudioRow).toBeTruthy();
    selectClip("Video clip 2 audio");
    click(actionNamed("Unlink audio"));
    await flushEffects();

    const exportButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.textContent?.toLowerCase().includes("export project"));
    expect(exportButton).toBeTruthy();
    click(exportButton!);

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    const blob = createObjectURLMock.mock.calls[0][0] as Blob;
    const exportedJson = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const expected = JSON.parse(exportedJson) as typeof sampleProject;
    expect(expected.timelineClips).toHaveLength(4);
    expect(expected.timelineClips?.filter(clip => clip.kind === "audio" && clip.linkedVideoClipId)).toHaveLength(1);
    expect(expected.timelineClips?.filter(clip => clip.kind === "audio" && !clip.linkedVideoClipId)).toHaveLength(1);

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
    expect(imported.id).toBe(expected.id);
    expect(imported.timelineClips).toEqual(expected.timelineClips);
    const videos = imported.timelineClips?.filter(clip => clip.kind === "video") ?? [];
    const audios = imported.timelineClips?.filter(clip => clip.kind === "audio") ?? [];
    expect(videos).toHaveLength(2);
    expect(audios).toHaveLength(2);
    const linkedAudio = audios.find(clip => clip.linkedVideoClipId);
    const unlinkedAudio = audios.find(clip => !clip.linkedVideoClipId);
    expect(linkedAudio).toBeTruthy();
    expect(unlinkedAudio).toBeTruthy();
    expect(linkedAudio).toMatchObject({
      start: videos.find(clip => clip.id === linkedAudio!.linkedVideoClipId)!.start,
      duration: videos.find(clip => clip.id === linkedAudio!.linkedVideoClipId)!.duration,
    });
    expect(unlinkedAudio).not.toHaveProperty("linkedVideoClipId");
    expect(buttonsNamed("Undo").every(button => button.disabled)).toBe(true);
    expect(buttonsNamed("Redo").every(button => button.disabled)).toBe(true);
  });

  it("exports the current project as JSON including linked timeline metadata", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();

    const exportButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.textContent?.toLowerCase().includes("export project"));
    expect(exportButton).toBeTruthy();
    click(exportButton!);

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    const blob = createObjectURLMock.mock.calls[0][0] as Blob;
    const blobText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const exported = JSON.parse(blobText) as typeof sampleProject;
    const video = exported.timelineClips?.find(clip => clip.kind === "video");
    const audio = exported.timelineClips?.find(clip => clip.kind === "audio");
    expect(video).toBeTruthy();
    expect(audio).toMatchObject({ start: video!.start, duration: video!.duration, linkedVideoClipId: video!.id });
  });

  it("does not overwrite the current project when import JSON is invalid", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
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


  it("unlinks audio in the App, edits it independently, and restores the link through Undo/Redo", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();

    const clips = () => persistedProject().timelineClips ?? [];
    const video = () => clips().find(clip => clip.kind === "video")!;
    const audio = () => clips().find(clip => clip.kind === "audio")!;

    selectClip("Video clip 1 audio");
    click(actionNamed("Unlink audio"));
    await flushEffects();
    expect(audio()).not.toHaveProperty("linkedVideoClipId");

    selectClip("Video clip 1 audio");
    click(actionNamed("+0.5s"));
    await flushEffects();
    expect(video()).toMatchObject({ start: 0, duration: 5 });
    expect(audio()).toMatchObject({ start: 0.5, duration: 5 });
    expect(audio()).not.toHaveProperty("linkedVideoClipId");

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(audio()).toMatchObject({ start: 0, duration: 5 });
    expect(audio()).not.toHaveProperty("linkedVideoClipId");

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(audio()).toMatchObject({ start: 0, duration: 5, linkedVideoClipId: video().id });

    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(audio()).not.toHaveProperty("linkedVideoClipId");

    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(video()).toMatchObject({ start: 0, duration: 5 });
    expect(audio()).toMatchObject({ start: 0.5, duration: 5 });
    expect(audio()).not.toHaveProperty("linkedVideoClipId");
  });

  it("deletes linked video and audio together and restores both through Undo/Redo", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();

    const clips = () => persistedProject().timelineClips ?? [];
    const initial = clips();
    const video = initial.find(clip => clip.kind === "video")!;
    const audio = initial.find(clip => clip.kind === "audio")!;
    expect(audio.linkedVideoClipId).toBe(video.id);

    selectClip("Video clip 1");
    click(actionNamed("Delete clip"));
    await flushEffects();
    expect(clips()).toEqual([]);

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(clips()).toEqual(initial);
    expect(clips().find(clip => clip.kind === "audio")?.linkedVideoClipId).toBe(video.id);

    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(clips()).toEqual([]);
  });

  it("deletes only a linked audio clip from the App and restores it through Undo/Redo", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();

    const clips = () => persistedProject().timelineClips ?? [];
    const initial = clips();
    const video = initial.find(clip => clip.kind === "video")!;
    const audio = initial.find(clip => clip.kind === "audio")!;
    expect(audio.linkedVideoClipId).toBe(video.id);

    selectClip("Video clip 1 audio");
    click(actionNamed("Delete clip"));
    await flushEffects();
    expect(clips()).toHaveLength(1);
    expect(clips()[0]).toMatchObject({ id: video.id, kind: "video" });

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(clips()).toEqual(initial);
    expect(clips().find(clip => clip.id === audio.id)?.linkedVideoClipId).toBe(video.id);

    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(clips()).toHaveLength(1);
    expect(clips()[0]).toMatchObject({ id: video.id, kind: "video" });
  });

  it("moves and trims linked audio through the App and restores both clips with Undo/Redo", async () => {
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();

    const clips = () => persistedProject().timelineClips ?? [];
    const video = () => clips().find(clip => clip.kind === "video")!;
    const audio = () => clips().find(clip => clip.kind === "audio")!;

    expect(video()).toMatchObject({ start: 0, duration: 5 });
    expect(audio()).toMatchObject({ start: 0, duration: 5, linkedVideoClipId: video().id });

    selectClip("Video clip 1 audio");
    click(actionNamed("+0.5s"));
    await flushEffects();
    expect(video()).toMatchObject({ start: 0.5, duration: 5 });
    expect(audio()).toMatchObject({ start: 0.5, duration: 5, linkedVideoClipId: video().id });

    click(actionNamed("Trim −0.5s"));
    await flushEffects();
    expect(video()).toMatchObject({ start: 0.5, duration: 4.5 });
    expect(audio()).toMatchObject({ start: 0.5, duration: 4.5, linkedVideoClipId: video().id });

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(video()).toMatchObject({ start: 0.5, duration: 5 });
    expect(audio()).toMatchObject({ start: 0.5, duration: 5, linkedVideoClipId: video().id });

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(video()).toMatchObject({ start: 0, duration: 5 });
    expect(audio()).toMatchObject({ start: 0, duration: 5, linkedVideoClipId: video().id });

    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(video()).toMatchObject({ start: 0.5, duration: 5 });
    expect(audio()).toMatchObject({ start: 0.5, duration: 5, linkedVideoClipId: video().id });

    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(video()).toMatchObject({ start: 0.5, duration: 4.5 });
    expect(audio()).toMatchObject({ start: 0.5, duration: 4.5, linkedVideoClipId: video().id });
  });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { sampleProject } from "./sampleProject";
import { getMasterTimelineDuration } from "./masterTimeline";

let container: HTMLDivElement;
let root: Root;
let createObjectURLMock: ReturnType<typeof vi.fn>;
let revokeObjectURLMock: ReturnType<typeof vi.fn>;
let originalCreateObjectURL: PropertyDescriptor | undefined;
let originalRevokeObjectURL: PropertyDescriptor | undefined;
let anchorClickSpy: ReturnType<typeof vi.spyOn>;

function click(button: HTMLElement) {
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function setInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

async function openTimelineView() {
  const nav = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(button => button.textContent?.includes("Timeline"));
  if (!nav) throw new Error("Timeline navigation is missing");
  if (!nav.classList.contains("active")) click(nav);
  await flushEffects();
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
    await openTimelineView();
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

  it("persists Audio Layer volume, fade-in, and fade-out controls", async () => {
    await openTimelineView();
    const add = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.textContent?.includes("Add linked video/audio"));
    expect(add).toBeTruthy();
    click(add!);
    await flushEffects();

    selectClip("Video clip 1 audio");
    await flushEffects();
    const volume = container.querySelector<HTMLInputElement>('input[aria-label="Timeline audio volume"]');
    const fadeIn = container.querySelector<HTMLInputElement>('input[aria-label="Timeline audio fade in"]');
    const fadeOut = container.querySelector<HTMLInputElement>('input[aria-label="Timeline audio fade out"]');
    expect(volume).toBeTruthy();
    expect(fadeIn).toBeTruthy();
    expect(fadeOut).toBeTruthy();

    setInputValue(volume!, "0.4");
    await flushEffects();
    setInputValue(fadeIn!, "0.75");
    await flushEffects();
    setInputValue(fadeOut!, "1.25");
    await flushEffects();

    const audio = persistedProject().timelineClips?.find(clip => clip.kind === "audio");
    expect(audio).toMatchObject({ volume: 0.4, fadeIn: 0.75, fadeOut: 1.25 });
    expect(persistedProject().timelineClips?.find(clip => clip.kind === "video")?.duration).toBe(audio?.duration);
  });

  it("supports Undo/Redo buttons and Ctrl/Cmd+Z keyboard shortcuts", async () => {
    await openTimelineView();
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
    await openTimelineView();
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
    await openTimelineView();
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
    await openTimelineView();
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
    await openTimelineView();
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
    await openTimelineView();
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
    await openTimelineView();
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
    await openTimelineView();
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
    await openTimelineView();
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
    await openTimelineView();
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
    await openTimelineView();
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
  it("expands storyboard shot versions and opens the selected version in the timeline", async () => {
    const toggle = container.querySelector<HTMLButtonElement>(".shot-version-toggle");
    expect(toggle).toBeTruthy();
    click(toggle!);
    expect(container.querySelector(".shot-version-dropdown")?.textContent).toContain("Opening image");
    const option = Array.from(container.querySelectorAll<HTMLButtonElement>(".shot-version-option")).find(button => button.textContent?.includes("Opening image"));
    expect(option).toBeTruthy();
    click(option!);
    await flushEffects();
    expect(container.querySelector<HTMLInputElement>('.version-panel input[aria-label="Clip slot name"]')?.value).toBe("Opening image");
  });

  it("edits Master Shot placement independently from Version and Slot internal duration", async () => {
    await openTimelineView();
    const firstShotBlock = container.querySelector<HTMLButtonElement>(".master-shot-clip");
    expect(firstShotBlock).toBeTruthy();
    click(firstShotBlock!);
    await flushEffects();

    const initial = persistedProject();
    const firstVersionDuration = initial.shots[0].slots[0].versions[0].duration;
    const secondStartBefore = initial.shots[0].duration;
    const startInput = container.querySelector<HTMLInputElement>('input[aria-label="Master Shot start time"]');
    expect(startInput).toBeTruthy();
    setInputValue(startInput!, "16.25");
    await flushEffects();

    const moved = persistedProject();
    expect(moved.shots[0].masterStart).toBe(16.25);
    expect(moved.shots[1].masterStart).toBe(secondStartBefore);
    expect(moved.shots[0].slots[0].versions[0].duration).toBe(firstVersionDuration);
    expect(container.querySelector(".master-shot-overlap-warning")).toBeTruthy();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Master Shot start time"]')?.value).toBe("16.25");

    click(buttonsNamed("Undo").find(button => !button.disabled)!);
    await flushEffects();
    expect(persistedProject().shots[0].masterStart).toBeUndefined();
    expect(persistedProject().shots[1].masterStart).toBeUndefined();
    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(persistedProject().shots[0].masterStart).toBe(16.25);
    expect(persistedProject().shots[1].masterStart).toBe(secondStartBefore);

    const slotDurationInput = Array.from(container.querySelectorAll<HTMLInputElement>(".version-panel input[type=number]"))
      .find(input => input.parentElement?.parentElement?.textContent?.includes("Slot duration"));
    expect(slotDurationInput).toBeTruthy();
    setInputValue(slotDurationInput!, "8");
    await flushEffects();
    const resizedSlot = persistedProject().shots[0].slots[0];
    expect(resizedSlot.duration).toBe(8);
    expect(resizedSlot.versions[0].duration).toBe(firstVersionDuration);
    expect(persistedProject().shots[1].masterStart).toBe(secondStartBefore);

    const dragProject = persistedProject();
    const shotBlock = container.querySelector<HTMLButtonElement>(".master-shot-clip");
    const lane = shotBlock?.closest(".visual-track-lane") as HTMLDivElement | null;
    expect(shotBlock?.draggable).toBe(true);
    expect(lane).toBeTruthy();
    Object.defineProperty(lane!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 60, width: 100, height: 60, x: 0, y: 0, toJSON: () => ({}) })
    });
    const values = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
      effectAllowed: "move"
    };
    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
    act(() => shotBlock!.dispatchEvent(dragStart));
    const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 75 });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    act(() => lane!.dispatchEvent(drop));
    await flushEffects();
    const afterDrop = persistedProject();
    const masterDuration = Math.max(10, getMasterTimelineDuration(dragProject.shots), ...(dragProject.timelineClips ?? []).map(clip => clip.start + clip.duration));
    const rawStart = Math.max(0, Math.min(masterDuration - dragProject.shots[0].duration, 0.75 * masterDuration - dragProject.shots[0].duration / 2));
    const expectedStart = Math.round(rawStart * dragProject.frameRate) / dragProject.frameRate;
    expect(afterDrop.shots[0].masterStart).toBeCloseTo(expectedStart, 7);
    expect(afterDrop.shots[0].slots[0].versions[0].duration).toBe(firstVersionDuration);

    const beforeRipple = persistedProject();
    const versionDurationsBeforeRipple = beforeRipple.shots.map(shot => shot.slots.map(slot => slot.versions.map(version => version.duration)));
    const rippleToggle = container.querySelector<HTMLButtonElement>(".ripple-reorder-toggle");
    expect(rippleToggle).toBeTruthy();
    click(rippleToggle!);
    await flushEffects();
    expect(container.querySelector<HTMLButtonElement>(".ripple-reorder-toggle")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".ripple-mode-note")).toBeTruthy();

    const rippleBlock = container.querySelector<HTMLButtonElement>(".master-shot-clip.selected");
    const rippleLane = rippleBlock?.closest(".visual-track-lane") as HTMLDivElement | null;
    expect(rippleBlock?.draggable).toBe(true);
    expect(rippleLane).toBeTruthy();
    Object.defineProperty(rippleLane!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 60, width: 100, height: 60, x: 0, y: 0, toJSON: () => ({}) })
    });
    const rippleValues = new Map<string, string>();
    const rippleDataTransfer = {
      setData: (type: string, value: string) => rippleValues.set(type, value),
      getData: (type: string) => rippleValues.get(type) ?? "",
      effectAllowed: "move"
    };
    const rippleDragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(rippleDragStart, "dataTransfer", { value: rippleDataTransfer });
    act(() => rippleBlock!.dispatchEvent(rippleDragStart));
    const rippleDrop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 95 });
    Object.defineProperty(rippleDrop, "dataTransfer", { value: rippleDataTransfer });
    act(() => rippleLane!.dispatchEvent(rippleDrop));
    await flushEffects();

    const afterRipple = persistedProject();
    const chronological = [...afterRipple.shots].sort((a, b) => (a.masterStart ?? 0) - (b.masterStart ?? 0));
    expect(chronological.every(shot => typeof shot.masterStart === "number")).toBe(true);
    chronological.slice(1).forEach((shot, index) => {
      expect(shot.masterStart).toBeCloseTo((chronological[index].masterStart ?? 0) + chronological[index].duration, 7);
    });
    expect(afterRipple.shots.map(shot => shot.slots.map(slot => slot.versions.map(version => version.duration)))).toEqual(versionDurationsBeforeRipple);
    expect(container.querySelector(".master-shot-overlap-warning")).toBeNull();

    click(buttonsNamed("Undo").find(button => !button.disabled)!);
    await flushEffects();
    expect(persistedProject().shots.map(shot => shot.masterStart)).toEqual(beforeRipple.shots.map(shot => shot.masterStart));
    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(persistedProject().shots.map(shot => shot.masterStart)).toEqual(afterRipple.shots.map(shot => shot.masterStart));
  });

  it("splits the selected Master video clip and keeps linked audio aligned in the Inspector workflow", async () => {
    await openTimelineView();
    const addLinked = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add linked video/audio"));
    expect(addLinked).toBeTruthy();
    click(addLinked!);
    await flushEffects();
    const before = persistedProject();
    const video = before.timelineClips?.find(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"));
    const audio = before.timelineClips?.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === video?.id);
    expect(video).toBeTruthy();
    expect(audio).toBeTruthy();

    const split = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-clip-actions button")).find(button => button.textContent?.includes("Split at midpoint"));
    expect(split).toBeTruthy();
    expect(split!.disabled).toBe(false);
    click(split!);
    await flushEffects();

    const after = persistedProject();
    const videoParts = after.timelineClips?.filter(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-")) ?? [];
    expect(videoParts).toHaveLength(2);
    const left = videoParts.find(clip => clip.id === video!.id)!;
    const right = videoParts.find(clip => clip.id !== video!.id)!;
    expect(left.start).toBe(video!.start);
    expect(left.duration).toBeCloseTo(video!.duration / 2, 6);
    expect(right.start).toBeCloseTo(left.start + left.duration, 6);
    expect(right.duration).toBeCloseTo(video!.duration - left.duration, 6);

    const linkedAfter = after.timelineClips?.filter(clip => clip.kind === "audio" && (clip.linkedVideoClipId === left.id || clip.linkedVideoClipId === right.id)) ?? [];
    expect(linkedAfter).toHaveLength(2);
    expect(linkedAfter.find(clip => clip.linkedVideoClipId === left.id)).toMatchObject({ start: left.start, duration: left.duration });
    expect(linkedAfter.find(clip => clip.linkedVideoClipId === right.id)).toMatchObject({ start: right.start, duration: right.duration });
    expect(container.querySelector(".visual-clip-inspector")?.textContent).toContain(right.name);
  });

  it("splits a selected Master clip at the current playhead and preserves linked source ranges", async () => {
    await openTimelineView();
    const addLinked = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add linked video/audio"));
    expect(addLinked).toBeTruthy();
    click(addLinked!);
    await flushEffects();

    const before = persistedProject();
    const video = before.timelineClips?.find(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"))!;
    const audio = before.timelineClips?.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === video.id)!;
    selectClip(video.name);
    await flushEffects();
    const playhead = container.querySelector<HTMLInputElement>('input[aria-label="Timeline playhead time"]');
    expect(playhead).toBeTruthy();
    setInputValue(playhead!, "2.5");
    await flushEffects();

    const split = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-clip-actions button")).find(button => button.textContent?.trim() === "Split at playhead");
    expect(split).toBeTruthy();
    expect(split!.disabled).toBe(false);
    click(split!);
    await flushEffects();

    const after = persistedProject();
    const videoParts = (after.timelineClips ?? []).filter(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-")).sort((a, b) => a.start - b.start);
    expect(videoParts).toHaveLength(2);
    expect(videoParts[0]).toMatchObject({ id: video.id, start: 0, duration: 2.5, sourceIn: 0, sourceOut: 2.5 });
    expect(videoParts[1]).toMatchObject({ start: 2.5, duration: 2.5, sourceIn: 2.5, sourceOut: 5 });

    const audioParts = (after.timelineClips ?? []).filter(clip => clip.kind === "audio" && (clip.linkedVideoClipId === video.id || videoParts.some(part => part.id !== video.id && part.id === clip.linkedVideoClipId))).sort((a, b) => a.start - b.start);
    expect(audioParts).toHaveLength(2);
    expect(audioParts[0]).toMatchObject({ id: audio.id, start: 0, duration: 2.5, sourceIn: 0, sourceOut: 2.5, linkedVideoClipId: videoParts[0].id });
    expect(audioParts[1]).toMatchObject({ start: 2.5, duration: 2.5, sourceIn: 2.5, sourceOut: 5, linkedVideoClipId: videoParts[1].id });
  });

  it("duplicates a Master video clip with a new linked-audio pair and preserves mix metadata", async () => {
    await openTimelineView();
    const addLinked = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add linked video/audio"));
    expect(addLinked).toBeTruthy();
    click(addLinked!);
    await flushEffects();

    let clips = persistedProject().timelineClips ?? [];
    const originalVideo = clips.find(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"))!;
    const originalAudio = clips.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === originalVideo.id)!;
    selectClip(originalAudio.name);
    await flushEffects();
    setInputValue(container.querySelector<HTMLInputElement>('input[aria-label="Timeline audio volume"]')!, "0.4");
    await flushEffects();
    setInputValue(container.querySelector<HTMLInputElement>('input[aria-label="Timeline audio fade in"]')!, "0.5");
    await flushEffects();
    setInputValue(container.querySelector<HTMLInputElement>('input[aria-label="Timeline audio fade out"]')!, "1");
    await flushEffects();

    selectClip(originalVideo.name);
    await flushEffects();
    const duplicate = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-clip-actions button"))
      .find(button => button.textContent?.trim() === "Duplicate clip");
    expect(duplicate).toBeTruthy();
    click(duplicate!);
    await flushEffects();

    clips = persistedProject().timelineClips ?? [];
    const videos = clips.filter(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"));
    expect(videos).toHaveLength(2);
    const copyVideo = videos.find(clip => clip.id !== originalVideo.id)!;
    expect(copyVideo.start).toBe(originalVideo.start + originalVideo.duration);
    const copiedAudio = clips.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === copyVideo.id);
    expect(copiedAudio).toMatchObject({
      start: copyVideo.start,
      duration: copyVideo.duration,
      volume: 0.4,
      fadeIn: 0.5,
      fadeOut: 1
    });
    expect(clips.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === originalVideo.id)).toMatchObject({
      volume: 0.4, fadeIn: 0.5, fadeOut: 1
    });
    expect(container.querySelector(".visual-clip-inspector")?.textContent).toContain(copyVideo.name);

    click(buttonsNamed("Undo").find(button => !button.disabled)!);
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).filter(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"))).toHaveLength(1);
    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).filter(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"))).toHaveLength(2);
  });

  it("frame-snaps ordinary Master Timeline clip drag moves and keeps linked audio in sync", async () => {
    await openTimelineView();
    const addLinked = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add linked video/audio"));
    expect(addLinked).toBeTruthy();
    click(addLinked!);
    await flushEffects();

    const before = persistedProject();
    const video = before.timelineClips?.find(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"))!;
    const audio = before.timelineClips?.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === video.id)!;
    const videoBlock = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-media-clip"))
      .find(button => button.textContent?.includes(video.name) && !button.textContent?.includes(" audio"));
    expect(videoBlock).toBeTruthy();
    expect(videoBlock!.draggable).toBe(true);
    const lane = videoBlock!.closest(".visual-track-lane") as HTMLDivElement | null;
    expect(lane).toBeTruthy();
    Object.defineProperty(lane!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 64, width: 100, height: 64, x: 0, y: 0, toJSON: () => ({}) })
    });
    const transferValues = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => transferValues.set(type, value),
      getData: (type: string) => transferValues.get(type) ?? "",
      effectAllowed: "move"
    };
    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
    act(() => videoBlock!.dispatchEvent(dragStart));
    const clientX = 54;
    const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    act(() => lane!.dispatchEvent(drop));
    await flushEffects();

    const after = persistedProject();
    const moved = after.timelineClips?.find(clip => clip.id === video.id)!;
    const movedAudio = after.timelineClips?.find(clip => clip.id === audio.id)!;
    const timelineDuration = Math.max(10, getMasterTimelineDuration(before.shots), ...(before.timelineClips ?? []).map(clip => clip.start + clip.duration));
    const fps = before.frameRate;
    const rawStart = Math.max(0, (clientX / 100) * timelineDuration - video.duration / 2);
    const snapped = Math.round(rawStart * fps) / fps;
    const maxStart = Math.max(0, Math.floor((timelineDuration - video.duration) * fps) / fps);
    const expected = Math.min(maxStart, snapped);
    expect(moved.start).toBeCloseTo(expected, 7);
    expect(moved.start * fps).toBeCloseTo(Math.round(moved.start * fps), 7);
    expect(movedAudio).toMatchObject({ start: moved.start, duration: moved.duration, linkedVideoClipId: moved.id });
  });

  it("opens nested Version tabs, adds a procedural layer, and keeps linked-audio mute/unlink independent", async () => {
    await openTimelineView();
    expect(container.querySelector(".master-shot-clip")).toBeTruthy();

    const addText = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Text block"));
    expect(addText).toBeTruthy();
    click(addText!);
    await flushEffects();
    expect(persistedProject().timelineClips?.some(clip => clip.kind === "text" && clip.name === "Subtitle Block")).toBe(true);
    expect(container.querySelector('input[aria-label="Text block content"]')).toBeTruthy();

    const addProcedural = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Three.js module"));
    expect(addProcedural).toBeTruthy();
    click(addProcedural!);
    await flushEffects();
    const proceduralClip = persistedProject().timelineClips?.find(clip => clip.kind === "procedural");
    expect(proceduralClip?.scriptVersionId).toBeUndefined();
    expect(container.querySelector('input[aria-label="Three.js script version ID"]')).toBeTruthy();
    expect(persistedProject().tracks.some(track => track.kind === "procedural" && track.id === proceduralClip?.trackId)).toBe(true);

    const add = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add linked video/audio"));
    expect(add).toBeTruthy();
    click(add!);
    await flushEffects();

    const initial = persistedProject();
    const video = initial.timelineClips?.find(clip => clip.kind === "video");
    const audio = initial.timelineClips?.find(clip => clip.kind === "audio");
    expect(video?.slotId).toBe(initial.shots[0].slots[0].id);
    expect(audio?.linkedVideoClipId).toBe(video?.id);
    expect(container.querySelector(".linked-audio-child")).toBeTruthy();

    const mute = container.querySelector<HTMLButtonElement>(".linked-audio-child .timeline-clip-mute");
    expect(mute).toBeTruthy();
    click(mute!);
    await flushEffects();
    expect(persistedProject().timelineClips?.find(clip => clip.id === audio?.id)?.muted).toBe(true);

    const trackMute = container.querySelector<HTMLButtonElement>('button[aria-label="Mute Soundtrack layer"]');
    expect(trackMute).toBeTruthy();
    click(trackMute!);
    await flushEffects();
    expect(persistedProject().tracks.find(track => track.id === "track-audio-1")?.muted).toBe(true);
    expect(persistedProject().timelineClips?.find(clip => clip.id === audio?.id)?.muted).toBe(true);
    const unmuteTrack = container.querySelector<HTMLButtonElement>('button[aria-label="Unmute Soundtrack layer"]');
    expect(unmuteTrack).toBeTruthy();
    click(unmuteTrack!);
    await flushEffects();
    expect(persistedProject().tracks.find(track => track.id === "track-audio-1")?.muted).toBe(false);

    const unlink = container.querySelector<HTMLButtonElement>(".linked-audio-child .timeline-clip-unlink");
    expect(unlink).toBeTruthy();
    click(unlink!);
    await flushEffects();
    expect(persistedProject().timelineClips?.find(clip => clip.id === audio?.id)).not.toHaveProperty("linkedVideoClipId");
    expect(persistedProject().timelineClips?.find(clip => clip.id === video?.id)?.start).toBe(video?.start);

    const menu = container.querySelector<HTMLDetailsElement>(".timeline-version-menu");
    expect(menu).toBeTruthy();
    click(menu!.querySelector("summary") as HTMLElement);
    const slotBefore = persistedProject().shots[0].slots[0];
    const countBefore = slotBefore.versions.length;
    const addVersion = Array.from(menu!.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add Version"));
    expect(addVersion).toBeTruthy();
    click(addVersion!);
    await flushEffects();
    const updatedSlot = persistedProject().shots[0].slots[0];
    expect(updatedSlot.versions).toHaveLength(countBefore + 1);
    const addedVersionId = updatedSlot.selectedVersionId;
    const editButtons = Array.from(menu!.querySelectorAll<HTMLButtonElement>(".timeline-version-edit"));
    expect(editButtons.length).toBeGreaterThan(0);
    click(editButtons[editButtons.length - 1]);
    await flushEffects();
    expect(container.querySelector(".nested-timeline-tab")?.textContent).toContain("Version");
    expect(container.querySelector(".timeline-workspace-tabs")?.textContent).toContain("Master Timeline");

    const addThree = Array.from(container.querySelectorAll<HTMLButtonElement>(".nested-timeline-tab button")).find(button => button.textContent?.includes("Code (Three.js)"));
    expect(addThree).toBeTruthy();
    click(addThree!);
    await flushEffects();
    const editedVersion = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId);
    expect(editedVersion?.layers.some(layer => layer.kind === "procedural")).toBe(true);
    const proceduralLayerId = editedVersion!.layers.find(layer => layer.kind === "procedural")!.id;
    const masterShotDurationBefore = persistedProject().shots[0].duration;
    const slotDurationBefore = persistedProject().shots[0].slots[0].duration;
    const versionDurationInput = container.querySelector<HTMLInputElement>('input[aria-label="Version duration"]');
    expect(versionDurationInput).toBeTruthy();
    setInputValue(versionDurationInput!, String(editedVersion!.duration + 3));
    await flushEffects();
    expect(persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)?.duration).toBe(editedVersion!.duration + 3);
    expect(persistedProject().shots[0].duration).toBe(masterShotDurationBefore);
    expect(persistedProject().shots[0].slots[0].duration).toBe(slotDurationBefore);

    const layerStartInput = container.querySelector<HTMLInputElement>('input[aria-label="Version layer ' + proceduralLayerId + ' start"]');
    const layerDurationInput = container.querySelector<HTMLInputElement>('input[aria-label="Version layer ' + proceduralLayerId + ' duration"]');
    expect(layerStartInput).toBeTruthy();
    expect(layerDurationInput).toBeTruthy();
    setInputValue(layerStartInput!, "1.5");
    await flushEffects();
    setInputValue(layerDurationInput!, "2.25");
    await flushEffects();
    let timedLayer = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!.layers.find(layer => layer.id === proceduralLayerId)!;
    expect(timedLayer).toMatchObject({ start: 1.5, duration: 2.25 });
    expect(persistedProject().shots[0].duration).toBe(masterShotDurationBefore);
    expect(persistedProject().shots[0].slots[0].duration).toBe(slotDurationBefore);

    const nestedClip = container.querySelector<HTMLButtonElement>(".nested-timeline-clip.kind-procedural");
    const nestedLane = nestedClip?.parentElement as HTMLDivElement | null;
    expect(nestedClip?.draggable).toBe(true);
    expect(nestedLane).toBeTruthy();
    Object.defineProperty(nestedLane!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 54, width: 100, height: 54, x: 0, y: 0, toJSON: () => ({}) })
    });
    const nestedDragEnd = new MouseEvent("dragend", { bubbles: true, cancelable: true, clientX: 70 });
    act(() => nestedClip!.dispatchEvent(nestedDragEnd));
    await flushEffects();
    timedLayer = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!.layers.find(layer => layer.id === proceduralLayerId)!;
    const versionDurationAfter = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!.duration;
    const expectedLayerStart = Math.round(Math.max(0, Math.min(versionDurationAfter - timedLayer.duration, 0.7 * versionDurationAfter - timedLayer.duration / 2)) * persistedProject().frameRate) / persistedProject().frameRate;
    expect(timedLayer.start).toBeCloseTo(expectedLayerStart, 7);

    const addVersionText = Array.from(container.querySelectorAll<HTMLButtonElement>(".nested-timeline-tab .inline-actions button")).find(button => button.textContent?.trim() === "Text");
    expect(addVersionText).toBeTruthy();
    click(addVersionText!);
    await flushEffects();
    const textLayer = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!.layers.find(layer => layer.kind === "text")!;
    const moveTextEarlier = container.querySelector<HTMLButtonElement>('button[aria-label="Move Text layer earlier"]');
    expect(moveTextEarlier).toBeTruthy();
    expect(moveTextEarlier!.disabled).toBe(false);
    click(moveTextEarlier!);
    await flushEffects();
    const reorderedLayers = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!.layers;
    expect(reorderedLayers[0].id).toBe(textLayer.id);
    expect(reorderedLayers[1].id).toBe(proceduralLayerId);
    click(buttonsNamed("Undo").find(button => !button.disabled)!);
    await flushEffects();
    let historyLayers = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!.layers;
    expect(historyLayers[0].id).toBe(proceduralLayerId);
    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    historyLayers = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!.layers;
    expect(historyLayers[0].id).toBe(textLayer.id);

    const addNestedVideo = Array.from(container.querySelectorAll<HTMLButtonElement>(".nested-timeline-tab .inline-actions button")).find(button => button.textContent?.trim() === "Video");
    expect(addNestedVideo).toBeTruthy();
    click(addNestedVideo!);
    await flushEffects();
    let sourceVersion = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!;
    const videoLayer = sourceVersion.layers.find(layer => layer.kind === "video")!;
    const sourceInInput = container.querySelector<HTMLInputElement>('input[aria-label="Version layer ' + videoLayer.id + ' source in"]');
    const sourceOutInput = container.querySelector<HTMLInputElement>('input[aria-label="Version layer ' + videoLayer.id + ' source out"]');
    expect(sourceInInput).toBeTruthy();
    expect(sourceOutInput).toBeTruthy();
    const versionDurationBeforeSourceTrim = sourceVersion.duration;
    setInputValue(sourceInInput!, "1.25");
    await flushEffects();
    sourceVersion = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!;
    const sourceInAdjusted = sourceVersion.layers.find(layer => layer.id === videoLayer.id)!;
    expect(sourceInAdjusted.sourceIn).toBe(1.25);
    expect(sourceInAdjusted.duration).toBe(videoLayer.duration);
    expect(sourceInAdjusted.sourceOut).toBeCloseTo(1.25 + videoLayer.duration, 7);

    setInputValue(sourceOutInput!, "3");
    await flushEffects();
    sourceVersion = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!;
    const sourceTrimmed = sourceVersion.layers.find(layer => layer.id === videoLayer.id)!;
    expect(sourceTrimmed).toMatchObject({ sourceIn: 1.25, sourceOut: 3, duration: 1.75 });
    expect(sourceVersion.duration).toBe(versionDurationBeforeSourceTrim);
    expect(persistedProject().shots[0].duration).toBe(masterShotDurationBefore);
    expect(persistedProject().shots[0].slots[0].duration).toBe(slotDurationBefore);

    const addNestedAudio = Array.from(container.querySelectorAll<HTMLButtonElement>(".nested-timeline-tab .inline-actions button")).find(button => button.textContent?.trim() === "Audio");
    expect(addNestedAudio).toBeTruthy();
    click(addNestedAudio!);
    await flushEffects();
    let audioVersion = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!;
    const audioLayer = audioVersion.layers.find(layer => layer.kind === "audio")!;
    const audioVolumeInput = container.querySelector<HTMLInputElement>('input[aria-label="Version layer ' + audioLayer.id + ' volume"]');
    const audioFadeInInput = container.querySelector<HTMLInputElement>('input[aria-label="Version layer ' + audioLayer.id + ' fade in"]');
    const audioFadeOutInput = container.querySelector<HTMLInputElement>('input[aria-label="Version layer ' + audioLayer.id + ' fade out"]');
    expect(audioVolumeInput).toBeTruthy();
    expect(audioFadeInInput).toBeTruthy();
    expect(audioFadeOutInput).toBeTruthy();
    setInputValue(audioVolumeInput!, "0.45");
    await flushEffects();
    setInputValue(audioFadeInInput!, "0.5");
    await flushEffects();
    setInputValue(audioFadeOutInput!, "0.75");
    await flushEffects();
    audioVersion = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!;
    expect(audioVersion.layers.find(layer => layer.id === audioLayer.id)).toMatchObject({ volume: 0.45, fadeIn: 0.5, fadeOut: 0.75 });
    const nestedAudioSourceOut = container.querySelector<HTMLInputElement>('input[aria-label="Version layer ' + audioLayer.id + ' source out"]');
    expect(nestedAudioSourceOut).toBeTruthy();
    setInputValue(nestedAudioSourceOut!, "0.4");
    await flushEffects();
    audioVersion = persistedProject().shots[0].slots[0].versions.find(version => version.id === addedVersionId)!;
    expect(audioVersion.layers.find(layer => layer.id === audioLayer.id)).toMatchObject({ duration: 0.4, sourceOut: 0.4, fadeIn: 0.4, fadeOut: 0.4 });
    expect(audioVersion.duration).toBe(versionDurationBeforeSourceTrim);
    expect(persistedProject().shots[0].duration).toBe(masterShotDurationBefore);
    expect(persistedProject().shots[0].slots[0].duration).toBe(slotDurationBefore);

    click(Array.from(container.querySelectorAll<HTMLButtonElement>(".timeline-workspace-tabs button")).find(button => button.textContent?.includes("Master Timeline"))!);
    await flushEffects();
    expect(container.querySelector(".nested-timeline-tab")).toBeNull();
    expect(container.querySelector(".master-timeline-content")).toBeTruthy();
  });

  it("generates timeline clips from storyboard slots without deleting manual clips", async () => {
    await openTimelineView();
    const add = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Add linked video/audio")) as HTMLButtonElement;
    click(add);
    await flushEffects();
    const storyboardNav = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(button => button.textContent?.includes("Storyboard"));
    expect(storyboardNav).toBeTruthy();
    click(storyboardNav!);
    await flushEffects();
    const sync = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Generate / update timeline"));
    expect(sync).toBeTruthy();
    click(sync!);
    await flushEffects();
    const clips = persistedProject().timelineClips ?? [];
    expect(clips.filter(clip => clip.id.startsWith("storyboard-"))).toHaveLength(3);
    expect(clips.some(clip => clip.name === "Video clip 1")).toBe(true);
  });

  it("creates a storyboard draft from a reference profile and stores its reference provenance", async () => {
    const nav = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(button => button.textContent?.includes("References"));
    expect(nav).toBeTruthy();
    click(nav!);
    const newProfile = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("New profile"));
    expect(newProfile).toBeTruthy();
    click(newProfile!);
    const nameInput = container.querySelector<HTMLInputElement>('form.editor-form input');
    expect(nameInput).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(nameInput!, "Hero reference");
      nameInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flushEffects();
    const createProfile = Array.from(container.querySelectorAll<HTMLButtonElement>("form.editor-form button[type=submit]"))[0];
    expect(createProfile).toBeTruthy();
    click(createProfile);
    await flushEffects();
    const createDraft = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Create storyboard draft from references"));
    expect(createDraft).toBeTruthy();
    click(createDraft!);
    await flushEffects();
    const project = persistedProject();
    const shot = project.shots.find(item => item.title.includes("Hero reference reference shot"));
    expect(shot).toBeTruthy();
    expect(shot!.referenceProfileIds).toHaveLength(1);
    expect(shot!.slots[0].versions[0].generationRecords[0].modelVersion).toBe("metadata-only");
    expect(shot!.slots[0].versions[0].layers[0].prompt).toContain("Hero reference");
  });

});


describe("Timeline preview", () => {
  it("tracks the current playhead time in the preview", async () => {
    await openTimelineView();
    const canvas = container.querySelector<HTMLCanvasElement>(".integrated-preview-frame canvas");
    const playhead = container.querySelector<HTMLInputElement>('input[aria-label="Timeline playhead time"]');
    expect(canvas?.getAttribute("aria-label")).toBe("Master preview at 00:00.00");
    expect(playhead).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(playhead!, "0.5");
      playhead!.dispatchEvent(new Event("input", { bubbles: true }));
      playhead!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(canvas?.getAttribute("aria-label")).toBe("Master preview at 00:00.50");
  });

  it("keeps a separate preview and playhead position for each Timeline tab", async () => {
    await openTimelineView();

    const masterPreview = container.querySelector(".master-timeline-content .integrated-preview-panel");
    expect(masterPreview).toBeTruthy();
    const masterPlayhead = container.querySelector<HTMLInputElement>(".master-timeline-content input[aria-label=\"Timeline playhead time\"]");
    expect(masterPlayhead).toBeTruthy();
    setInputValue(masterPlayhead!, "0.5");
    await flushEffects();

    const versionMenu = container.querySelector<HTMLDetailsElement>(".master-shot-version-menu");
    expect(versionMenu).toBeTruthy();
    click(versionMenu!.querySelector("summary") as HTMLElement);
    const editButton = versionMenu!.querySelector<HTMLButtonElement>(".timeline-version-edit");
    expect(editButton).toBeTruthy();
    click(editButton!);
    await flushEffects();

    expect(container.querySelector(".nested-timeline-tab .integrated-preview-panel")).toBeTruthy();
    const versionDetails = container.querySelector<HTMLDetailsElement>(".nested-version-inspector-disclosure");
    expect(versionDetails).toBeTruthy();
    expect(versionDetails!.open).toBe(false);
    const versionPreview = container.querySelector<HTMLInputElement>(".nested-timeline-tab input[aria-label=\"Timeline playhead time\"]");
    expect(versionPreview).toBeTruthy();
    expect(versionPreview!.value).toBe("0");

    setInputValue(versionPreview!, "1.25");
    await flushEffects();
    const masterTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".timeline-workspace-tabs [role=\"tab\"]")).find(button => button.textContent?.includes("Master Timeline"));
    expect(masterTab).toBeTruthy();
    click(masterTab!);
    await flushEffects();
    expect(masterPlayhead!.value).toBe("0.5");

    const versionTab = container.querySelector<HTMLButtonElement>(".timeline-workspace-tab [role=\"tab\"]");
    expect(versionTab).toBeTruthy();
    click(versionTab!);
    await flushEffects();
    const restoredVersionPlayhead = container.querySelector<HTMLInputElement>(".nested-timeline-tab input[aria-label=\"Timeline playhead time\"]");
    expect(restoredVersionPlayhead?.value).toBe("1.25");
  });
});


describe("Timeline layer and Shot settings UX", () => {
  it("opens Shot Settings from a right-click context menu", async () => {
    await openTimelineView();
    const shot = container.querySelector<HTMLButtonElement>(".master-shot-clip");
    expect(shot).toBeTruthy();
    act(() => shot!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 })));
    expect(container.querySelector('[role="menu"]')).toBeTruthy();
    const settings = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent?.includes("Settings"));
    expect(settings).toBeTruthy();
    click(settings!);
    const dialog = container.querySelector('[role="dialog"][aria-labelledby="shot-settings-title"]');
    expect(dialog).toBeTruthy();
    const title = dialog!.querySelector<HTMLInputElement>('input[aria-label="Shot title"]');
    expect(title).toBeTruthy();
    setInputValue(title!, "Edited from Shot Settings");
    await flushEffects();
    expect(persistedProject().shots[0].title).toBe("Edited from Shot Settings");
  });

  it("edits video layer background transparency and opacity from the layer settings dialog", async () => {
    await openTimelineView();
    const settings = container.querySelector<HTMLButtonElement>(".visual-track-label .track-settings-button");
    expect(settings).toBeTruthy();
    click(settings!);
    const dialog = container.querySelector('[role="dialog"][aria-labelledby="video-layer-settings-title"]');
    expect(dialog).toBeTruthy();
    const transparent = dialog!.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(transparent).toBeTruthy();
    click(transparent!);
    const opacity = dialog!.querySelector<HTMLInputElement>('input[aria-label="Video layer opacity"]');
    expect(opacity).toBeTruthy();
    setInputValue(opacity!, "0.5");
    await flushEffects();
    const track = persistedProject().tracks.find(item => item.kind === "video");
    expect(track?.backgroundTransparent).toBe(true);
    expect(track?.opacity).toBe(0.5);
  });

  it("shows a thumbnail for every version and uses a code glyph for procedural-only versions", async () => {
    await openTimelineView();
    expect(container.querySelector(".master-shot-clip .version-thumbnail-preview")).toBeTruthy();
    const menu = container.querySelector<HTMLDetailsElement>(".master-shot-version-menu");
    expect(menu).toBeTruthy();
    click(menu!.querySelector("summary") as HTMLElement);
    expect(menu!.querySelectorAll(".timeline-version-menu-thumb .version-thumbnail-preview").length).toBeGreaterThan(0);
  });
});

describe("Integrated timeline editor", () => {
  it("shows preview in the timeline workspace and provides playback controls", async () => {
    const timelineNav = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(button => button.textContent?.includes("Timeline"));
    expect(timelineNav).toBeTruthy();
    click(timelineNav!);
    await flushEffects();
    expect(container.querySelector(".integrated-preview-panel")).toBeTruthy();
    expect(container.querySelector(".integrated-preview-frame canvas")).toBeTruthy();
    expect(buttonsNamed("Play preview").length).toBeGreaterThan(0);
  });
});

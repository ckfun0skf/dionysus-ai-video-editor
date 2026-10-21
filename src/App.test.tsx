// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { sampleProject } from "./sampleProject";
import { getMasterTimelineDuration } from "./masterTimeline";
import { applyProjectTimelineClipResize, calculateProjectTimelineClipResizePreview, calculateProjectTimelineDropPosition, getProjectTimelinePlacementItems } from "./projectTimelinePlacement";

let container: HTMLDivElement;
let root: Root;
let createObjectURLMock: ReturnType<typeof vi.fn>;
let revokeObjectURLMock: ReturnType<typeof vi.fn>;
let originalCreateObjectURL: PropertyDescriptor | undefined;
let originalRevokeObjectURL: PropertyDescriptor | undefined;
let anchorClickSpy: ReturnType<typeof vi.spyOn>;
let originalConfirm: typeof window.confirm;

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


async function selectClip(name: string): Promise<HTMLButtonElement> {
  const clip = timelineRows().find(row => row.textContent?.includes(name));
  if (!clip) throw new Error("Could not find timeline clip: " + name);
  act(() => clip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })));
  await flushEffects();
  return clip as HTMLButtonElement;
}
function actionNamed(name: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-clip-inspector button"))
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

/** Seed valid linked source-audio pairs for tests of editing behavior; the Add Layer menu intentionally creates tracks only. */
async function seedLinkedVideoAudioPairs(count = 1) {
  const project = persistedProject();
  const videoTrack = project.tracks.find(track => track.kind === "video");
  const audioTrack = project.tracks.find(track => track.kind === "audio");
  if (!videoTrack || !audioTrack) throw new Error("Sample project needs Video and Audio tracks");
  const clips = [...(project.timelineClips ?? [])];
  for (let index = 0; index < count; index += 1) {
    const number = index + 1;
    const videoId = "test-video-" + number;
    const start = index * 5;
    const duration = 5;
    clips.push({ id: videoId, name: "Video clip " + number, kind: "video", trackId: videoTrack.id, start, duration });
    clips.push({ id: "test-audio-" + number, name: "Video clip " + number + " audio", kind: "audio", trackId: audioTrack.id, start, duration, linkedVideoClipId: videoId });
  }
  project.timelineClips = clips;
  localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
  act(() => root.unmount());
  root = createRoot(container);
  act(() => root.render(<App />));
  await flushEffects();
  await openTimelineView();
}

beforeEach(() => {
  originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  createObjectURLMock = vi.fn(() => "blob:mock-project-export");
  revokeObjectURLMock = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createObjectURLMock });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: revokeObjectURLMock });
  anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  originalConfirm = window.confirm;
  window.confirm = () => true;
  localStorage.clear();
  // App integration tests use the populated fixture; production first-run state is intentionally empty.
  localStorage.setItem("dionysus.project.v1", JSON.stringify({ ...sampleProject, id: "test-project", name: "Test Project" }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));
});

afterEach(() => {
  anchorClickSpy.mockRestore();
  window.confirm = originalConfirm;
  if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL); else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL); else Reflect.deleteProperty(URL, "revokeObjectURL");
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

describe("App history integration", () => {
  it("keeps Asset management inside the editor shell and returns to Timeline", async () => {
    expect(container.querySelector(".app-shell-editor")).toBeTruthy();
    expect(container.querySelector(".timeline-workspace-bar")).toBeTruthy();
    const manage = Array.from(container.querySelectorAll<HTMLButtonElement>(".timeline-source-heading button"))
      .find(button => button.textContent?.trim() === "Manage");
    expect(manage).toBeTruthy();
    click(manage!);
    await flushEffects();
    expect(container.querySelector(".app-shell-editor")).toBeTruthy();
    expect(container.querySelector(".editor-project-field span")?.textContent).toBe("DIONYSUS / ASSET LIBRARY");
    expect(container.querySelector(".asset-grid") || container.querySelector(".timeline-source-empty") || container.querySelector(".section-toolbar")).toBeTruthy();
    const backToTimeline = Array.from(container.querySelectorAll<HTMLButtonElement>(".editor-native-actions button"))
      .find(button => button.textContent?.includes("Timeline"));
    expect(backToTimeline).toBeTruthy();
    click(backToTimeline!);
    await flushEffects();
    expect(container.querySelector(".timeline-workspace-bar")).toBeTruthy();
  });

  it("clears persisted demo seed shots and tracks from the existing demo project", async () => {
    localStorage.setItem("dionysus.project.v1", JSON.stringify(sampleProject));
    localStorage.removeItem("dionysus.composition.v2");
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    const project = persistedProject();
    expect(project.name).toBe("Untitled Project");
    expect(project.shots).toEqual([]);
    expect(project.storyboardConnections).toEqual([]);
    expect(project.timelineClips).toEqual([]);
    expect(project.tracks).toEqual([{ id: "track-video-1", name: "Video 1", kind: "video" }]);
  });

  it("starts with an empty project instead of demo seed shots", async () => {
    localStorage.clear();
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    const project = persistedProject();
    expect(project.name).toBe("Untitled Project");
    expect(project.shots).toEqual([]);
    expect(project.timelineClips).toEqual([]);
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0]).toMatchObject({ name: "Video 1", kind: "video" });
  });

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
    await seedLinkedVideoAudioPairs();

    let videoRow = timelineRows().find(row => row.textContent?.includes("Video clip 1"));
    expect(videoRow).toBeTruthy();
    await selectClip("Video clip 1");
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
    await seedLinkedVideoAudioPairs();

    await selectClip("Video clip 1 audio");
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

  it("supports Undo/Redo for adding actual timeline Layers", async () => {
    await openTimelineView();
    const baseCount = persistedProject().tracks.length;
    const addLayer = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add layer"));
    expect(addLayer).toBeTruthy();
    click(addLayer!);
    const videoOption = Array.from(container.querySelectorAll<HTMLButtonElement>(".layer-add-menu button")).find(button => button.textContent?.trim() === "Video layer");
    expect(videoOption).toBeTruthy();
    click(videoOption!);
    await flushEffects();
    expect(persistedProject().tracks).toHaveLength(baseCount + 1);

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(persistedProject().tracks).toHaveLength(baseCount);
    expect(buttonsNamed("Redo").some(button => !button.disabled)).toBe(true);

    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(persistedProject().tracks).toHaveLength(baseCount + 1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    await flushEffects();
    expect(persistedProject().tracks).toHaveLength(baseCount);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true, bubbles: true }));
    await flushEffects();
    expect(persistedProject().tracks).toHaveLength(baseCount + 1);
  });

  

  it("clears Undo/Redo history after importing a valid project", async () => {
    await openTimelineView();
    const addLayer = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add layer"));
    click(addLayer!);
    const videoOption = Array.from(container.querySelectorAll<HTMLButtonElement>(".layer-add-menu button")).find(button => button.textContent?.trim() === "Video layer");
    click(videoOption!);
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

  

  it("clears redo when a new timeline Layer follows Undo", async () => {
    await openTimelineView();
    const baseCount = persistedProject().tracks.length;
    const addLayer = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add layer"));
    click(addLayer()!);
    click(Array.from(container.querySelectorAll<HTMLButtonElement>(".layer-add-menu button")).find(button => button.textContent?.trim() === "Video layer")!);
    await flushEffects();
    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(buttonsNamed("Redo").every(button => button.disabled)).toBe(false);

    click(addLayer()!);
    click(Array.from(container.querySelectorAll<HTMLButtonElement>(".layer-add-menu button")).find(button => button.textContent?.trim() === "Audio layer")!);
    await flushEffects();
    expect(buttonsNamed("Redo").every(button => button.disabled)).toBe(true);
    expect(persistedProject().tracks).toHaveLength(baseCount + 1);
    expect(persistedProject().tracks.at(-1)?.kind).toBe("audio");
  });

  

  it("restores linked timeline state after an App unmount/remount from localStorage", async () => {
    await openTimelineView();
    await seedLinkedVideoAudioPairs();
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
    await seedLinkedVideoAudioPairs(2);

    const secondAudioRow = timelineRows().find(row => row.textContent?.includes("Video clip 2 audio"));
    expect(secondAudioRow).toBeTruthy();
    await selectClip("Video clip 2 audio");
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
    const document = JSON.parse(exportedJson) as { format: string; documentVersion: string; project: typeof sampleProject; compositionModel: { schemaVersion: string } };
    expect(document).toMatchObject({ format: "dionysus-project-document", documentVersion: "2.0", compositionModel: { schemaVersion: "2.0" } });
    const expected = document.project;
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
    await seedLinkedVideoAudioPairs();

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
    const exported = (JSON.parse(blobText) as { project: typeof sampleProject }).project;
    const video = exported.timelineClips?.find(clip => clip.kind === "video");
    const audio = exported.timelineClips?.find(clip => clip.kind === "audio");
    expect(video).toBeTruthy();
    expect(audio).toMatchObject({ start: video!.start, duration: video!.duration, linkedVideoClipId: video!.id });
  });

  it("does not overwrite the current project when import JSON is invalid", async () => {
    await openTimelineView();
    await seedLinkedVideoAudioPairs();
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
    await seedLinkedVideoAudioPairs();

    const clips = () => persistedProject().timelineClips ?? [];
    const video = () => clips().find(clip => clip.kind === "video")!;
    const audio = () => clips().find(clip => clip.kind === "audio")!;

    await selectClip("Video clip 1 audio");
    click(actionNamed("Unlink audio"));
    await flushEffects();
    expect(audio()).not.toHaveProperty("linkedVideoClipId");

    await selectClip("Video clip 1 audio");
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
    await seedLinkedVideoAudioPairs();

    const clips = () => persistedProject().timelineClips ?? [];
    const initial = clips();
    const video = initial.find(clip => clip.kind === "video")!;
    const audio = initial.find(clip => clip.kind === "audio")!;
    expect(audio.linkedVideoClipId).toBe(video.id);

    await selectClip("Video clip 1");
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
    await seedLinkedVideoAudioPairs();

    const clips = () => persistedProject().timelineClips ?? [];
    const initial = clips();
    const video = initial.find(clip => clip.kind === "video")!;
    const audio = initial.find(clip => clip.kind === "audio")!;
    expect(audio.linkedVideoClipId).toBe(video.id);

    await selectClip("Video clip 1 audio");
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
    await seedLinkedVideoAudioPairs();

    const clips = () => persistedProject().timelineClips ?? [];
    const video = () => clips().find(clip => clip.kind === "video")!;
    const audio = () => clips().find(clip => clip.kind === "audio")!;

    expect(video()).toMatchObject({ start: 0, duration: 5 });
    expect(audio()).toMatchObject({ start: 0, duration: 5, linkedVideoClipId: video().id });

    await selectClip("Video clip 1 audio");
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
    const storyboardNav = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(button => button.textContent?.includes("Storyboard"));
    if (!storyboardNav) throw new Error("Storyboard navigation is missing");
    click(storyboardNav);
    await flushEffects();
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
    const targetTrack = dragProject.tracks.find(track => track.kind === "video" && track.id !== dragProject.tracks.find(item => item.kind === "video")?.id)!;
    const targetGroup = Array.from(container.querySelectorAll<HTMLElement>(".visual-track-group")).find(group => group.querySelector(".visual-track-label strong")?.textContent === targetTrack.name);
    const lane = targetGroup?.querySelector<HTMLElement>(".visual-track-lane") as HTMLDivElement | null;
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
    expect(afterDrop.shots[0].masterTrackId).toBe(targetTrack.id);
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
    await seedLinkedVideoAudioPairs();
    const before = persistedProject();
    const video = before.timelineClips?.find(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"));
    const audio = before.timelineClips?.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === video?.id);
    expect(video).toBeTruthy();
    expect(audio).toBeTruthy();

    await selectClip(video!.name);
    await flushEffects();
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
    await seedLinkedVideoAudioPairs();

    // Linked audio can originate from a separate source file with its own non-zero in-point.
    const seeded = persistedProject();
    const seededVideo = seeded.timelineClips?.find(clip => clip.kind === "video" && clip.id.startsWith("test-video-"))!;
    const seededAudio = seeded.timelineClips?.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === seededVideo.id)!;
    const distinctSourceProject = {
      ...seeded,
      timelineClips: (seeded.timelineClips ?? []).map(clip =>
        clip.id === seededAudio.id ? { ...clip, sourceIn: 7, sourceOut: 12 } : clip
      ),
    };
    localStorage.setItem("dionysus.project.v1", JSON.stringify(distinctSourceProject));
    localStorage.removeItem("dionysus.composition.v2");
    act(() => root.unmount()); root = createRoot(container); act(() => root.render(<App />));
    await flushEffects(); await openTimelineView();

    const before = persistedProject();
    const video = before.timelineClips?.find(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"))!;
    const audio = before.timelineClips?.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === video.id)!;
    expect(audio).toMatchObject({ sourceIn: 7, sourceOut: 12 });
    await selectClip(video.name);
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
    expect(audioParts[0]).toMatchObject({ id: audio.id, start: 0, duration: 2.5, sourceIn: 7, sourceOut: 9.5, linkedVideoClipId: videoParts[0].id });
    expect(audioParts[1]).toMatchObject({ start: 2.5, duration: 2.5, sourceIn: 9.5, sourceOut: 12, linkedVideoClipId: videoParts[1].id });
  });

  it("duplicates a Master video clip with a new linked-audio pair and preserves mix metadata", async () => {
    await openTimelineView();
    await seedLinkedVideoAudioPairs();

    let clips = persistedProject().timelineClips ?? [];
    const originalVideo = clips.find(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"))!;
    const originalAudio = clips.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === originalVideo.id)!;
    await selectClip(originalAudio.name);
    await flushEffects();
    setInputValue(container.querySelector<HTMLInputElement>('input[aria-label="Timeline audio volume"]')!, "0.4");
    await flushEffects();
    setInputValue(container.querySelector<HTMLInputElement>('input[aria-label="Timeline audio fade in"]')!, "0.5");
    await flushEffects();
    setInputValue(container.querySelector<HTMLInputElement>('input[aria-label="Timeline audio fade out"]')!, "1");
    await flushEffects();

    await selectClip(originalVideo.name);
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
    await seedLinkedVideoAudioPairs();

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
    const fps = before.frameRate;
    expect(moved.start * fps).toBeCloseTo(Math.round(moved.start * fps), 7);
    const sameTrackOverlaps = (after.timelineClips ?? []).filter(clip => clip.trackId === moved.trackId && clip.id !== moved.id && moved.start < clip.start + clip.duration - 1e-7 && moved.start + moved.duration > clip.start + 1e-7);
    expect(sameTrackOverlaps).toHaveLength(0);
    expect(movedAudio).toMatchObject({ start: moved.start, duration: moved.duration, linkedVideoClipId: moved.id });
  });

  it("offers only Video, Audio and Text track types in Add layer while keeping linked audio independent", async () => {
    await openTimelineView();
    const addLayer = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add layer"));
    expect(addLayer).toBeTruthy();
    click(addLayer!);
    const masterLayersHeading = Array.from(container.querySelectorAll<HTMLElement>(".editor-linked-heading")).find(heading => heading.textContent?.includes("Timeline layers"));
    const layerOptions = Array.from(masterLayersHeading?.querySelectorAll<HTMLButtonElement>(".layer-add-menu button") ?? []).map(button => (button.textContent ?? "").trim());
    expect(layerOptions.sort()).toEqual(["Audio layer", "Text layer", "Video layer"]);
    expect(layerOptions.some(label => label.includes("Add linked video/audio"))).toBe(false);
    click(addLayer!);
    await flushEffects();

    const visibleTrackKinds = Array.from(container.querySelectorAll<HTMLElement>(".visual-track-group")).map(group =>
      group.querySelector(".visual-track-label")?.textContent ?? ""
    );
    expect(visibleTrackKinds.some(label => label.includes("Code"))).toBe(false);
    expect(visibleTrackKinds.some(label => label.includes("Effects"))).toBe(false);

    await seedLinkedVideoAudioPairs();
    const video = persistedProject().timelineClips?.find(clip => clip.kind === "video" && !clip.id.startsWith("storyboard-"));
    const audio = persistedProject().timelineClips?.find(clip => clip.kind === "audio" && clip.linkedVideoClipId === video?.id);
    expect(video).toBeTruthy();
    expect(audio).toBeTruthy();
    const mute = container.querySelector<HTMLButtonElement>(".track-layer-mute");
    expect(mute).toBeTruthy();
    click(mute!);
    await flushEffects();
    expect(persistedProject().tracks.some(track => track.kind === "audio" && track.muted)).toBe(true);
    const unlink = buttonsNamed("Unlink " + audio!.name)[0];
    expect(unlink).toBeTruthy();
    click(unlink!);
    await flushEffects();
    expect(persistedProject().timelineClips?.find(clip => clip.id === audio!.id)?.linkedVideoClipId).toBeUndefined();
  });

  

  it("generates timeline clips from storyboard slots without deleting manual clips", async () => {
    await openTimelineView();
    await seedLinkedVideoAudioPairs();
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

  it("persists selected Video-layer preview transforms back to the timeline layer", async () => {
    await flushEffects();
    const seeded = persistedProject();
    const targetTrack = seeded.tracks.find(track => track.kind === "video")!;
    targetTrack.x = 10;
    targetTrack.y = 15;
    targetTrack.width = 40;
    targetTrack.height = 30;
    localStorage.setItem("dionysus.project.v1", JSON.stringify(seeded));
    localStorage.removeItem("dionysus.composition.v2");

    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    await openTimelineView();

    const label = Array.from(container.querySelectorAll<HTMLElement>(".visual-track-label"))
      .find(element => element.querySelector("strong")?.textContent === targetTrack.name);
    expect(label).toBeTruthy();
    click(label!);
    const frame = container.querySelector<HTMLElement>(".selected-layer-frame");
    expect(frame).toBeTruthy();
    expect(frame!.style.left).toBe("10%");
    expect(frame!.style.top).toBe("15%");

    const previewFrame = frame!.closest(".integrated-preview-frame") as HTMLElement;
    Object.defineProperty(previewFrame, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) })
    });
    const pointer = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
      Object.defineProperty(event, "pointerId", { configurable: true, value: 42 });
      act(() => frame!.dispatchEvent(event));
    };
    pointer("pointerdown", 20, 20);
    pointer("pointermove", 40, 30);
    expect(frame!.style.left).toBe("20%");
    expect(frame!.style.top).toBe("25%");
    pointer("pointerup", 40, 30);
    await flushEffects();

    expect(persistedProject().tracks.find(track => track.id === targetTrack.id))
      .toMatchObject({ x: 20, y: 25, width: 40, height: 30 });
    const transformEnvelope = JSON.parse(localStorage.getItem("dionysus.composition.v2") ?? "null") as { compositionModel?: { rootComposition?: { tracks?: Array<{ id: string; legacyData?: Record<string, unknown> }> } } };
    expect(transformEnvelope.compositionModel?.rootComposition?.tracks?.find(track => track.id === targetTrack.id)?.legacyData).toMatchObject({ x: 20, y: 25, width: 40, height: 30 });
  });

});


describe("Timeline layer and Shot settings UX", () => {
  it("opens Shot Settings from a right-click context menu", async () => {
    await openTimelineView();
    const shot = container.querySelector<HTMLButtonElement>(".master-shot-clip");
    expect(shot).toBeTruthy();
    act(() => shot!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 90 })));
    expect(container.querySelector('.shot-context-menu[role="menu"]')).toBeTruthy();
    const settings = Array.from(container.querySelectorAll<HTMLButtonElement>('.shot-context-menu [role="menuitem"]')).find(button => button.textContent?.includes("Settings"));
    expect(settings).toBeTruthy();
    click(settings!);
    await flushEffects();
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
    const settingsEnvelope = JSON.parse(localStorage.getItem("dionysus.composition.v2") ?? "null") as { compositionModel?: { rootComposition?: { tracks?: Array<{ id: string; backgroundTransparent?: boolean; opacity?: number }> } } };
    expect(settingsEnvelope.compositionModel?.rootComposition?.tracks?.find(item => item.id === track?.id)).toMatchObject({ backgroundTransparent: true, opacity: 0.5 });
  });

  it("stores editable Three.js source on a Code clip and shows its code thumbnail", async () => {
    await openTimelineView();
    const menu = container.querySelector<HTMLDetailsElement>(".master-shot-version-menu");
    expect(menu).toBeTruthy();
    click(menu!.querySelector("summary") as HTMLElement);
    const edit = menu!.querySelector<HTMLButtonElement>(".timeline-version-edit");
    expect(edit).toBeTruthy();
    click(edit!);
    await flushEffects();

    const addCode = Array.from(container.querySelectorAll<HTMLButtonElement>(".nested-timeline-tab button")).find(button => button.textContent?.includes("Code"));
    expect(addCode).toBeTruthy();
    click(addCode!);
    await flushEffects();
    const codeClip = container.querySelector<HTMLButtonElement>(".nested-timeline-clip.kind-procedural");
    expect(codeClip).toBeTruthy();
    act(() => codeClip!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
    const settings = Array.from(container.querySelectorAll<HTMLButtonElement>(".shot-context-menu button")).find(button => button.textContent?.includes("Settings"));
    expect(settings).toBeTruthy();
    click(settings!);
    await flushEffects();
    const source = container.querySelector<HTMLTextAreaElement>(".clip-settings-dialog textarea");
    expect(source).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(source!, "scene.background = null;");
      source!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flushEffects();
    const codeLayer = persistedProject().shots.flatMap(shot => shot.slots.flatMap(slot => slot.versions.flatMap(version => version.layers))).find(layer => layer.kind === "procedural");
    expect(codeLayer?.code).toBe("scene.background = null;");
    const masterTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".timeline-workspace-tabs [role=\"tab\"]")).find(button => button.textContent?.includes("Master Timeline"));
    expect(masterTab).toBeTruthy();
    click(masterTab!);
    await flushEffects();
    expect(container.querySelector(".master-shot-clip .version-thumbnail-code")).toBeTruthy();
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

describe("shared project timeline placement engine", () => {
  it("uses Master Shots as occupancy when dropping an ordinary clip", () => {
    const project = structuredClone(sampleProject);
    const videoTracks = project.tracks.filter(track => track.kind === "video");
    const shot = { ...project.shots[0], masterStart: 4, masterTrackId: videoTracks[1].id, duration: 4 };
    project.shots = [shot];
    const moving = { id: "ordinary", name: "Ordinary", kind: "video" as const, trackId: videoTracks[0].id, start: 12, duration: 2 };
    project.timelineClips = [moving];
    const position = calculateProjectTimelineDropPosition(project, moving, videoTracks[1].id, 4, 14);
    expect(position).toBeTruthy();
    expect(position!.start + moving.duration <= 4 + 1e-7 || position!.start >= 8 - 1e-7).toBe(true);
  });

  it("uses the moving materialized Storyboard clip instead of counting its Shot twice", () => {
    const project = structuredClone(sampleProject);
    const shot = project.shots[0];
    const materialized = { id: "storyboard-" + shot.id + "-slot-a", name: "Generated", kind: "video" as const, trackId: "track-video-1", start: 0, duration: 2, shotId: shot.id };
    project.timelineClips = [materialized];
    const items = getProjectTimelinePlacementItems(project, materialized);
    expect(items.filter(item => item.id === shot.id)).toHaveLength(0);
    expect(items.filter(item => item.id === materialized.id)).toHaveLength(1);
  });

  it("resizes an ordinary clip and trims an adjacent Master Shot atomically", () => {
    const project = structuredClone(sampleProject);
    const track = project.tracks.find(item => item.kind === "video")!;
    project.shots = [{ ...project.shots[0], masterStart: 3, masterTrackId: track.id, duration: 6 }];
    const clip = { id: "before-shot", name: "Before Shot", kind: "video" as const, trackId: track.id, start: 0, duration: 3 };
    project.timelineClips = [clip];
    const preview = calculateProjectTimelineClipResizePreview(project, clip, "right", 5, 10);
    expect(preview?.trims).toEqual(expect.arrayContaining([expect.objectContaining({ id: project.shots[0].id })]));
    const updated = applyProjectTimelineClipResize(project, preview!);
    expect(updated.timelineClips![0].duration).toBeGreaterThan(3);
    expect(updated.shots[0].masterStart).toBeGreaterThan(3);
    expect(updated.shots[0].duration).toBeLessThan(6);
  });

  it("resizes a Master Shot and trims an adjacent ordinary clip in the same operation", () => {
    const project = structuredClone(sampleProject);
    const track = project.tracks.find(item => item.kind === "video")!;
    project.shots = [{ ...project.shots[0], masterStart: 0, masterTrackId: track.id, duration: 6 }];
    const clip = { id: "after-shot", name: "After Shot", kind: "video" as const, trackId: track.id, start: 6, duration: 5 };
    project.timelineClips = [clip];
    const movingShot = { id: project.shots[0].id, name: project.shots[0].title, kind: "video" as const, trackId: track.id, start: 0, duration: 6 };
    const preview = calculateProjectTimelineClipResizePreview(project, movingShot, "right", 2, 15);
    expect(preview?.trims).toEqual(expect.arrayContaining([expect.objectContaining({ id: clip.id })]));
    const updated = applyProjectTimelineClipResize(project, preview!);
    expect(updated.shots[0].duration).toBeGreaterThan(6);
    expect(updated.timelineClips![0].start).toBeGreaterThanOrEqual(updated.shots[0].duration);
    expect(updated.timelineClips![0].duration).toBeLessThan(5);
  });
});

describe("Integrated timeline editor", () => {
  it("keeps nested Add layer track types aligned and exposes content choices separately", async () => {
    await openTimelineView();
    const versionMenu = container.querySelector<HTMLDetailsElement>(".master-shot-version-menu");
    expect(versionMenu).toBeTruthy();
    click(versionMenu!.querySelector("summary") as HTMLElement);
    const edit = versionMenu!.querySelector<HTMLButtonElement>(".timeline-version-edit");
    expect(edit).toBeTruthy();
    click(edit!); await flushEffects();
    const nestedHeading = container.querySelector<HTMLElement>(".nested-timeline-tab .editor-linked-heading");
    expect(nestedHeading).toBeTruthy();
    const wraps = nestedHeading!.querySelectorAll<HTMLElement>(".layer-add-menu-wrap");
    const trackOptions = Array.from(wraps[0].querySelectorAll<HTMLButtonElement>(".layer-add-menu button")).map(button => (button.textContent ?? "").trim()).sort();
    expect(trackOptions).toEqual(["Audio track", "Text track", "Video track"]);
    const contentOptions = Array.from(wraps[1].querySelectorAll<HTMLButtonElement>(".layer-add-menu button")).map(button => (button.textContent ?? "").trim()).sort();
    expect(contentOptions).toEqual(["Clip layer", "Code source", "Image source"]);
  });


  it("shows a destination preview and prevents ordinary clips from overlapping Master Shots", async () => {
    await openTimelineView();
    const project = persistedProject();
    const videoTrack = project.tracks.find(track => track.kind === "video")!;
    const targetTrack = project.tracks.find(track => track.kind === "video" && track.id !== videoTrack.id)!;
    project.shots = [{ ...project.shots[0], masterStart: 4, masterTrackId: targetTrack.id, duration: 4 }];
    project.storyboardConnections = [];
    project.timelineClips = [{ id: "mixed-source", name: "Movable clip", kind: "video", trackId: videoTrack.id, start: 12, duration: 2 }];
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    act(() => root.unmount()); root = createRoot(container); act(() => root.render(<App />)); await flushEffects(); await openTimelineView();
    const source = timelineRows().find(row => row.textContent?.includes("Movable clip")) as HTMLButtonElement;
    const targetGroup = Array.from(container.querySelectorAll<HTMLElement>(".visual-track-group")).find(group => group.querySelector(".visual-track-label strong")?.textContent === targetTrack.name);
    const lane = targetGroup?.querySelector<HTMLElement>(".visual-track-lane");
    expect(source).toBeTruthy(); expect(lane).toBeTruthy();
    vi.spyOn(lane!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 76));
    const values = new Map<string, string>();
    const dataTransfer = { setData: (key: string, value: string) => values.set(key, value), getData: (key: string) => values.get(key) ?? "", effectAllowed: "", dropEffect: "" };
    const start = new Event("dragstart", { bubbles: true, cancelable: true }); Object.defineProperty(start, "dataTransfer", { value: dataTransfer }); act(() => source.dispatchEvent(start));
    const over = new Event("dragover", { bubbles: true, cancelable: true }); Object.defineProperties(over, { dataTransfer: { value: dataTransfer }, clientX: { value: 1200 * 5 / 14 } }); act(() => lane!.dispatchEvent(over)); await flushEffects();
    expect(container.querySelector(".clip-drop-preview")).toBeTruthy();
    const drop = new Event("drop", { bubbles: true, cancelable: true }); Object.defineProperties(drop, { dataTransfer: { value: dataTransfer }, clientX: { value: 1200 * 5 / 14 } }); act(() => lane!.dispatchEvent(drop)); await flushEffects();
    const after = persistedProject(), moved = after.timelineClips!.find(clip => clip.id === "mixed-source")!, shot = after.shots[0];
    const shotStart = shot.masterStart ?? 0;
    expect(moved.trackId).toBe(targetTrack.id);
    expect(moved.start + moved.duration <= shotStart + 1e-7 || moved.start >= shotStart + shot.duration - 1e-7).toBe(true);
  });

  it("trims an adjacent Master Shot when an ordinary clip is resized and restores both with one Undo", async () => {
    await openTimelineView();
    const project = persistedProject(), videoTrack = project.tracks.find(track => track.kind === "video")!;
    project.shots = [{ ...project.shots[0], masterStart: 3, masterTrackId: videoTrack.id, duration: 6 }];
    project.storyboardConnections = [];
    project.timelineClips = [{ id: "clip-before-shot", name: "Clip before Shot", kind: "video", trackId: videoTrack.id, start: 0, duration: 3 }];
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    act(() => root.unmount()); root = createRoot(container); act(() => root.render(<App />)); await flushEffects(); await openTimelineView();
    const clip = timelineRows().find(row => row.textContent?.includes("Clip before Shot")) as HTMLButtonElement;
    const right = clip.querySelector<HTMLElement>(".clip-resize-right"), lane = clip.closest(".visual-track-lane") as HTMLElement;
    expect(right).toBeTruthy(); expect(lane).toBeTruthy();
    vi.spyOn(lane, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 76));
    const fire = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
      Object.defineProperties(event, { pointerId: { configurable: true, value: 73 }, buttons: { configurable: true, value: type === "pointerup" ? 0 : 1 } });
      act(() => type === "pointermove" || type === "pointerup" ? window.dispatchEvent(event) : right!.dispatchEvent(event));
    };
    fire("pointerdown", 300); fire("pointermove", 900); await flushEffects();
    expect(container.querySelector(".clip-overlap-preview")).toBeTruthy();
    fire("pointerup", 900); await flushEffects();
    let after = persistedProject();
    expect(after.timelineClips!.find(item => item.id === "clip-before-shot")!.duration).toBeGreaterThan(3);
    expect(after.shots[0].masterStart).toBeGreaterThan(3);
    expect(after.shots[0].duration).toBeLessThan(6);
    click(buttonsNamed("Undo").find(button => !button.disabled)!); await flushEffects();
    after = persistedProject();
    expect(after.timelineClips!.find(item => item.id === "clip-before-shot")!.duration).toBe(3);
    expect(after.shots[0].masterStart).toBe(3);
    expect(after.shots[0].duration).toBe(6);
  });


  it("shows snap guidance and moves a Master Shot to another video layer without overlap", async () => {
    await openTimelineView();
    const project = persistedProject(), sourceShot = project.shots[0];
    const targetTrack = project.tracks.find(track => track.kind === "video" && track.id !== project.tracks.find(item => item.kind === "video")?.id)!;
    project.timelineClips = [...(project.timelineClips ?? []), { id: "manual-drop-anchor", name: "Drop anchor", kind: "video", trackId: targetTrack.id, start: 4, duration: 2 }];
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    act(() => root.unmount()); root = createRoot(container); act(() => root.render(<App />)); await flushEffects(); await openTimelineView();
    const shotBlock = container.querySelector<HTMLButtonElement>(".master-shot-clip");
    const targetGroup = Array.from(container.querySelectorAll<HTMLElement>(".visual-track-group")).find(group => group.querySelector(".visual-track-label strong")?.textContent === targetTrack.name);
    const lane = targetGroup?.querySelector<HTMLElement>(".visual-track-lane");
    expect(shotBlock).toBeTruthy(); expect(lane).toBeTruthy();
    vi.spyOn(lane!, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1200, 76));
    const dataTransfer = { setData: (_key: string, _value: string) => {}, getData: (_key: string) => "", effectAllowed: "", dropEffect: "" };
    const start = new Event("dragstart", { bubbles: true, cancelable: true }); Object.defineProperty(start, "dataTransfer", { value: dataTransfer }); act(() => shotBlock!.dispatchEvent(start));
    const over = new Event("dragover", { bubbles: true, cancelable: true }); Object.defineProperties(over, { dataTransfer: { value: dataTransfer }, clientX: { value: 1200 * 9 / 18 } }); act(() => lane!.dispatchEvent(over)); await flushEffects();
    expect(container.querySelector(".clip-drop-preview")).toBeTruthy(); expect(container.querySelector(".timeline-snap-guide")).toBeTruthy();
    const drop = new Event("drop", { bubbles: true, cancelable: true }); Object.defineProperties(drop, { dataTransfer: { value: dataTransfer }, clientX: { value: 1200 * 9 / 18 } }); act(() => lane!.dispatchEvent(drop)); await flushEffects();
    const moved = persistedProject().shots.find(shot => shot.id === sourceShot.id)!;
    expect(moved.masterTrackId).toBe(targetTrack.id); expect(moved.masterStart).toBe(6);
  });

  it("previews Master Shot overlap and trims the adjacent Shot on release", async () => {
    await openTimelineView();
    const first = container.querySelector<HTMLButtonElement>(".master-shot-clip"); expect(first).toBeTruthy();
    const right = first!.querySelector<HTMLElement>(".master-shot-resize-handle.right"); expect(right).toBeTruthy();
    const lane = first!.closest(".visual-track-lane") as HTMLElement;
    vi.spyOn(lane, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 64));
    Object.defineProperty(right!, "setPointerCapture", { configurable: true, value: vi.fn() });
    const fire = (type: string, clientX: number) => { const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX }); Object.defineProperties(event, { pointerId: { configurable: true, value: 27 }, buttons: { configurable: true, value: type === "pointerup" ? 0 : 1 } }); act(() => right!.dispatchEvent(event)); };
    fire("pointerdown", 0); fire("pointermove", 100 * 2 / 18); await flushEffects();
    expect(container.querySelector(".clip-overlap-preview")).toBeTruthy();
    fire("pointerup", 100 * 2 / 18); await flushEffects();
    let shots = persistedProject().shots;
    expect(shots[0].duration).toBe(8); expect(shots[1].masterStart).toBe(8); expect(shots[1].duration).toBe(3);
    click(buttonsNamed("Undo").find(button => !button.disabled)!); await flushEffects();
    shots = persistedProject().shots;
    expect(shots[0].duration).toBe(6); expect(shots[1].duration).toBe(5); expect(shots[1].masterStart).toBeUndefined();
  });

  it("places a selected source, previews it, trims and moves it, and preserves edits across Undo/Redo and reopen", async () => {
    await openTimelineView();

    const project = persistedProject();
    const source = {
      id: "integration-source-image",
      name: "Integration Source Frame",
      kind: "image" as const,
      path: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'%3E%3Crect width='16' height='9' fill='%2300aacc'/%3E%3C/svg%3E",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z"
    };
    const earlierSources = Array.from({ length: 8 }, (_, index) => ({
      id: "earlier-source-" + index,
      name: "Earlier source " + index,
      kind: "image" as const,
      path: source.path,
      createdAt: "2026-10-19T00:00:00.000Z",
      updatedAt: "2026-10-19T00:00:00.000Z"
    }));
    // Give the resize regression room beyond the default 3-second image placement.
    if (project.shots[0]) project.shots[0].duration = Math.max(project.shots[0].duration, 30);
    project.assets = [...project.assets, ...earlierSources, source];
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    await openTimelineView();

    // Select the overlay Video layer first; Project Media should place directly without a picker.
    const targetTrackId = "track-video-2";
    const targetLabel = container.querySelector<HTMLElement>(`.visual-track-label:has(+ .visual-track-lane[data-track-id="${targetTrackId}"])`);
    const lane = container.querySelector<HTMLElement>(`.visual-track-lane[data-track-id="${targetTrackId}"]`);
    expect(lane).toBeTruthy();
    if (targetLabel) click(targetLabel);
    const sourceButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".timeline-source-item"))
      .find(button => button.textContent?.includes(source.name));
    expect(sourceButton).toBeTruthy();
    click(sourceButton!);
    await flushEffects();

    let edited = persistedProject();
    let placed = edited.timelineClips?.find(clip => clip.assetId === source.id);
    expect(placed).toMatchObject({ assetId: source.id, trackId: targetTrackId, kind: "video", duration: 3 });
    expect(container.querySelector('[role="dialog"][aria-labelledby="asset-picker-title"]')).toBeNull();
    expect(container.querySelector(".timeline-placement-banner")).toBeNull();
    expect(container.querySelector(".integrated-preview-panel")).toBeTruthy();
    expect(container.querySelector(".integrated-preview-frame canvas")).toBeTruthy();
    expect(container.querySelector(`.visual-media-clip.selected[title^="${source.name}"]`)).toBeTruthy();
    const initialStart = placed!.start;

    const clipButton = () => Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-media-clip"))
      .find(button => button.textContent?.includes(source.name));
    const clipLane = clipButton()?.closest(".visual-track-lane") as HTMLDivElement | null;
    expect(clipButton()).toBeTruthy();
    expect(clipLane).toBe(lane);

    // Move the selected source clip by dragging it to a later point on the same layer.
    const transferValues = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => transferValues.set(type, value),
      getData: (type: string) => transferValues.get(type) ?? "",
      effectAllowed: "move"
    };
    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
    act(() => clipButton()!.dispatchEvent(dragStart));
    const dragOver = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientX: 600 });
    Object.defineProperty(dragOver, "dataTransfer", { value: dataTransfer });
    act(() => lane!.dispatchEvent(dragOver));
    const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 600 });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    act(() => lane!.dispatchEvent(drop));
    await flushEffects();

    edited = persistedProject();
    placed = edited.timelineClips?.find(clip => clip.assetId === source.id);
    expect(placed).toBeTruthy();
    expect(placed!.start).toBeGreaterThan(initialStart);

    // Trim the right edge and verify one-step Undo/Redo restores the complete timing state.
    const resizeRight = container.querySelector<HTMLElement>('.clip-resize-right[aria-label="Resize end of ' + source.name + '"]');
    expect(resizeRight).toBeTruthy();
    const resizeStart = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperties(resizeStart, { pointerId: { configurable: true, value: 42 }, clientX: { configurable: true, value: 100 }, button: { configurable: true, value: 0 } });
    act(() => resizeRight!.dispatchEvent(resizeStart));
    const moveResize = new Event("pointermove", { bubbles: true, cancelable: true });
    Object.defineProperties(moveResize, { pointerId: { configurable: true, value: 42 }, clientX: { configurable: true, value: 150 } });
    act(() => window.dispatchEvent(moveResize));
    const endResize = new Event("pointerup", { bubbles: true, cancelable: true });
    Object.defineProperties(endResize, { pointerId: { configurable: true, value: 42 }, clientX: { configurable: true, value: 150 } });
    act(() => window.dispatchEvent(endResize));
    await flushEffects();

    const trimmed = persistedProject().timelineClips?.find(clip => clip.assetId === source.id)!;
    expect(trimmed.duration).toBeGreaterThan(3);
    expect(trimmed.start).toBe(placed!.start);

    click(buttonsNamed("Undo").find(button => !button.disabled)!);
    await flushEffects();
    expect(persistedProject().timelineClips?.find(clip => clip.assetId === source.id)).toMatchObject({
      start: placed!.start,
      duration: placed!.duration
    });
    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(persistedProject().timelineClips?.find(clip => clip.assetId === source.id)).toMatchObject({
      start: trimmed.start,
      duration: trimmed.duration
    });

    const beforeReopen = persistedProject().timelineClips?.find(clip => clip.assetId === source.id);
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    const afterReopen = persistedProject().timelineClips?.find(clip => clip.assetId === source.id);
    expect(afterReopen).toMatchObject({
      id: beforeReopen!.id,
      assetId: source.id,
      trackId: targetTrackId,
      start: beforeReopen!.start,
      duration: beforeReopen!.duration
    });
    expect(container.querySelector(".integrated-preview-panel")).toBeTruthy();
  });

  it("shows preview in the timeline workspace and provides playback controls", async () => {
    const timelineNav = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(button => button.textContent?.includes("Timeline"));
    expect(timelineNav).toBeTruthy();
    click(timelineNav!);
    await flushEffects();
    expect(container.querySelector(".integrated-preview-panel")).toBeTruthy();
    expect(container.querySelector(".integrated-preview-frame canvas")).toBeTruthy();
    expect(buttonsNamed("Play preview").length).toBeGreaterThan(0);
  });
  it("updates project aspect ratio, resolution and frame rate from Project Settings", async () => {
    await openTimelineView();
    const settingsButton = buttonsNamed("Project canvas settings")[0];
    expect(settingsButton).toBeTruthy();
    click(settingsButton);
    expect(container.querySelector('[aria-label="Project aspect ratio"]')).toBeTruthy();

    const setSelect = (select: HTMLSelectElement, value: string) => {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
        setter?.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    setSelect(container.querySelector<HTMLSelectElement>('[aria-label="Project aspect ratio"]')!, "9:16");
    setSelect(container.querySelector<HTMLSelectElement>('[aria-label="Project resolution preset"]')!, "1080x1920");
    setSelect(container.querySelector<HTMLSelectElement>('[aria-label="Project frame rate"]')!, "24");
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === "Save settings");
    expect(save).toBeTruthy();
    click(save!);
    await flushEffects();

    expect(persistedProject().width).toBe(1080);
    expect(persistedProject().height).toBe(1920);
    expect(persistedProject().frameRate).toBe(24);
  });


  it("shows a snapped destination preview and moves a clip between compatible video layers", async () => {
    await openTimelineView();await seedLinkedVideoAudioPairs();
    let project=persistedProject();const video=project.timelineClips!.find(clip=>clip.kind==="video"&&clip.id==="test-video-1")!;
    const targetTrack=project.tracks.find(track=>track.kind==="video"&&track.id!==video.trackId)!;
    project.timelineClips!.push({id:"test-anchor",name:"Drop alignment anchor",kind:"video",trackId:targetTrack.id,start:5,duration:2});
    localStorage.setItem("dionysus.project.v1",JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");act(()=>root.unmount());root=createRoot(container);act(()=>root.render(<App/>));await flushEffects();await openTimelineView();
    const source=timelineRows().find(row=>row.textContent?.includes("Video clip 1")) as HTMLButtonElement;
    const group=Array.from(container.querySelectorAll<HTMLElement>(".visual-track-group")).find(g=>g.querySelector(".visual-track-label strong")?.textContent===targetTrack.name);
    const lane=group?.querySelector<HTMLElement>(".visual-track-lane");expect(lane).toBeTruthy();vi.spyOn(lane!,"getBoundingClientRect").mockReturnValue(new DOMRect(0,0,1200,76));
    const store=new Map<string,string>(),dt={setData:(k:string,v:string)=>store.set(k,v),getData:(k:string)=>store.get(k)??"",effectAllowed:"",dropEffect:""};
    const start=new Event("dragstart",{bubbles:true,cancelable:true});Object.defineProperty(start,"dataTransfer",{value:dt});act(()=>source.dispatchEvent(start));
    const over=new Event("dragover",{bubbles:true,cancelable:true});Object.defineProperties(over,{dataTransfer:{value:dt},clientX:{value:1200*2.5/15}});act(()=>lane!.dispatchEvent(over));await flushEffects();
    expect(container.querySelector(".clip-drop-preview")).toBeTruthy();expect(container.querySelector(".timeline-snap-guide")).toBeTruthy();
    const drop=new Event("drop",{bubbles:true,cancelable:true});Object.defineProperties(drop,{dataTransfer:{value:dt},clientX:{value:1200*2.5/15}});act(()=>lane!.dispatchEvent(drop));await flushEffects();
    const current=persistedProject(),moved=current.timelineClips!.find(clip=>clip.id===video.id)!;expect(moved.trackId).toBe(targetTrack.id);expect(moved.start*current.frameRate).toBeCloseTo(Math.round(moved.start*current.frameRate),7);
    const overlaps=current.timelineClips!.filter(clip=>clip.id!==moved.id&&clip.trackId===moved.trackId&&moved.start<clip.start+clip.duration-1e-7&&moved.start+moved.duration>clip.start+1e-7);expect(overlaps).toHaveLength(0);
    const audio=current.timelineClips!.find(clip=>clip.linkedVideoClipId===moved.id)!;expect(audio.start).toBe(moved.start);expect(audio.duration).toBe(moved.duration);
  });
  it("previews resize overlap, trims the adjacent clip on release, and restores both with one Undo", async () => {
    await openTimelineView();await seedLinkedVideoAudioPairs(2);
    const videos=()=> (persistedProject().timelineClips??[]).filter(clip=>clip.kind==="video"&&clip.id.startsWith("test-video-")).sort((a,b)=>a.start-b.start);
    const original=videos().map(clip=>({id:clip.id,start:clip.start,duration:clip.duration}));
    const first=timelineRows().find(row=>row.textContent?.includes("Video clip 1")) as HTMLButtonElement,right=first.querySelector<HTMLElement>(".clip-resize-right");expect(right).toBeTruthy();
    const lane=first.closest(".visual-track-lane") as HTMLElement;vi.spyOn(lane,"getBoundingClientRect").mockReturnValue(new DOMRect(0,0,1200,76));
    const down=new Event("pointerdown",{bubbles:true,cancelable:true});Object.defineProperties(down,{pointerId:{value:7},clientX:{value:500}});act(()=>right!.dispatchEvent(down));
    const move=new Event("pointermove",{bubbles:true,cancelable:true});Object.defineProperties(move,{pointerId:{value:7},clientX:{value:740},buttons:{value:1}});act(()=>window.dispatchEvent(move));await flushEffects();
    const overlap=container.querySelector<HTMLElement>(".clip-overlap-preview");expect(overlap).toBeTruthy();expect(Number.parseFloat(overlap!.style.width)).toBeGreaterThan(0);
    const up=new Event("pointerup",{bubbles:true,cancelable:true});Object.defineProperties(up,{pointerId:{value:7},clientX:{value:740},buttons:{value:0}});act(()=>window.dispatchEvent(up));await flushEffects();
    const after=videos();expect(after[0].duration).toBeGreaterThan(original[0].duration);expect(after[1].start).toBeCloseTo(after[0].start+after[0].duration,6);expect(after[1].duration).toBeLessThan(original[1].duration);
    expect((persistedProject().timelineClips??[]).find(clip=>clip.linkedVideoClipId===after[1].id)).toMatchObject({start:after[1].start,duration:after[1].duration});
    click(buttonsNamed("Undo").find(button=>!button.disabled)!);await flushEffects();expect(videos().map(clip=>({id:clip.id,start:clip.start,duration:clip.duration}))).toEqual(original);
    click(buttonsNamed("Redo").find(button=>!button.disabled)!);await flushEffects();expect(videos()[0].duration).toBeGreaterThan(original[0].duration);expect(videos()[1].duration).toBeLessThan(original[1].duration);
    const afterRedo = videos();
    const saved = JSON.parse(localStorage.getItem("dionysus.composition.v2") ?? "null") as {
      compositionModel?: { rootComposition?: { placements?: Array<{ id: string; start: number; duration: number; linkedToPlacementId?: string }> } };
    };
    const savedPlacements = saved.compositionModel?.rootComposition?.placements ?? [];
    expect(savedPlacements.find(item => item.id === afterRedo[0].id)).toMatchObject({ start: afterRedo[0].start, duration: afterRedo[0].duration });
    expect(savedPlacements.find(item => item.id === afterRedo[1].id)).toMatchObject({ start: afterRedo[1].start, duration: afterRedo[1].duration });
    const afterRedoAudio = (persistedProject().timelineClips ?? []).find(clip => clip.linkedVideoClipId === afterRedo[1].id)!;
    expect(savedPlacements.find(item => item.id === afterRedoAudio.id)).toMatchObject({
      start: afterRedoAudio.start, duration: afterRedoAudio.duration, linkedToPlacementId: afterRedo[1].id,
    });

    act(() => root.unmount()); root = createRoot(container); act(() => root.render(<App />)); await flushEffects();
    const reopened = persistedProject();
    const reopenedVideos = (reopened.timelineClips ?? []).filter(clip => clip.kind === "video" && clip.id.startsWith("test-video-")).sort((a, b) => a.start - b.start);
    expect(reopenedVideos.map(clip => ({ id: clip.id, start: clip.start, duration: clip.duration }))).toEqual(
      afterRedo.map(clip => ({ id: clip.id, start: clip.start, duration: clip.duration })),
    );
    const reopenedEnvelope = JSON.parse(localStorage.getItem("dionysus.composition.v2") ?? "null") as typeof saved;
    expect(reopenedEnvelope.compositionModel?.rootComposition?.placements?.find(item => item.id === afterRedo[1].id))
      .toMatchObject({ start: afterRedo[1].start, duration: afterRedo[1].duration });
  });

  it("creates an empty Clip Asset from the single Asset menu and opens its Timeline", async () => {
    const nav = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(button => button.textContent?.includes("Assets"));
    click(nav!);
    await flushEffects();
    const create = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Create asset"));
    expect(create).toBeTruthy();
    click(create!);
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).map(button => button.textContent?.trim());
    expect(options).toEqual(["Clip", "Code", "Audio · Upload file", "Image · Upload file"]);
    click(Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(button => button.textContent?.trim() === "Clip")!);
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip title"]')!, "Empty Test Clip");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip canvas width"]')!, "1920");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip canvas height"]')!, "1080");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip duration"]')!, "4");
    click(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Create empty Clip"))!);
    await flushEffects();

    const clip = persistedProject().assets.find(asset => asset.name === "Empty Test Clip" && asset.kind === "clip");
    expect(clip).toBeTruthy();
    expect(clip?.canvasWidth).toBe(1920);
    expect(clip?.canvasHeight).toBe(1080);
    expect(clip?.clipVersions?.[0].layers).toEqual([]);
    const edit = Array.from(container.querySelectorAll<HTMLButtonElement>(".asset-card button")).find(button => button.textContent?.includes("Edit Timeline"));
    expect(edit).toBeTruthy();
    click(edit!);
    await flushEffects();
    expect(Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).some(tab => tab.textContent?.includes("Empty Test Clip"))) .toBe(true);
    expect(container.querySelector(".nested-timeline-empty")?.textContent).toContain("This timeline is empty");
    expect(container.querySelector(".nested-timeline-tab.editor-linked-timeline.visual-timeline")).toBeTruthy();
    expect(container.querySelector(".nested-visual-timeline-ruler .visual-ruler-caption")?.textContent).toBe("TIME");
    expect(container.querySelector(".nested-visual-timeline-ruler .visual-timeline-ruler-lane")).toBeTruthy();
    const addVideo=Array.from(container.querySelectorAll<HTMLButtonElement>(".nested-timeline-tab .inline-actions button")).find(button=>button.textContent?.includes("Video"));
    expect(addVideo).toBeTruthy();click(addVideo!);await flushEffects();
    const addContent = container.querySelector<HTMLButtonElement>(".nested-timeline-tab .nested-timeline-row-label .track-add-clip");
    expect(addContent).toBeTruthy(); click(addContent!); await flushEffects();
    const nestedClip=container.querySelector<HTMLButtonElement>(".nested-timeline-tab .nested-timeline-clip.visual-media-clip");
    expect(nestedClip).toBeTruthy();expect(nestedClip!.querySelector(".visual-clip-icon")).toBeTruthy();
    expect(nestedClip!.querySelector(".visual-clip-copy strong")?.textContent).toContain("Video");
    expect(nestedClip!.querySelector(".visual-clip-copy small")?.textContent).toContain("s");
    expect(nestedClip!.querySelector('[aria-label^="Trim start of "]')).toBeTruthy();
    expect(nestedClip!.querySelector('[aria-label^="Trim end of "]')).toBeTruthy();
    const lane = nestedClip!.closest(".nested-timeline-row-track") as HTMLElement;
    Object.defineProperty(lane, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 76, width: 100, height: 76, x: 0, y: 0, toJSON: () => ({}) })
    });
    let draggedLayerId = "";
    const dataTransfer = {
      setData: (_type: string, value: string) => { draggedLayerId = value; },
      getData: (_type: string) => draggedLayerId,
      effectAllowed: "move",
      dropEffect: "move",
      types: ["text/dionysus-version-layer"],
    };
    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, "dataTransfer", { configurable: true, value: dataTransfer });
    act(() => nestedClip!.dispatchEvent(dragStart));
    const dragOver = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientX: 50 });
    Object.defineProperty(dragOver, "dataTransfer", { configurable: true, value: dataTransfer });
    act(() => lane.dispatchEvent(dragOver));
    await flushEffects();
    expect(lane.querySelector(".clip-drop-preview strong")?.textContent).toContain("Video");
    act(() => nestedClip!.dispatchEvent(new Event("dragend", { bubbles: true })));
    await flushEffects();

  });



  it("creates a blank Clip Asset version without mutating the current version", async () => {
    const nav = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(button => button.textContent?.includes("Assets"));
    click(nav!); await flushEffects();
    click(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Create asset"))!);
    click(Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(button => button.textContent?.trim() === "Clip")!);
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip title"]')!, "Versioned Blank Clip");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip canvas width"]')!, "1920");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip canvas height"]')!, "1080");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip duration"]')!, "6");
    click(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Create empty Clip"))!);
    await flushEffects();

    click(Array.from(container.querySelectorAll<HTMLButtonElement>(".asset-card button")).find(button => button.textContent?.includes("Edit Timeline"))!);
    await flushEffects();
    const nested = container.querySelector<HTMLElement>(".nested-timeline-tab.visual-timeline");
    expect(nested).toBeTruthy();
    const addVideo = Array.from(nested!.querySelectorAll<HTMLButtonElement>(".inline-actions button")).find(button => button.textContent?.includes("Video"));
    expect(addVideo).toBeTruthy();
    click(addVideo!);
    await flushEffects();
    click(nested!.querySelector<HTMLButtonElement>(".nested-timeline-row-label .track-add-clip")!);
    await flushEffects();

    const before = persistedProject();
    const assetBefore = before.assets.find(asset => asset.name === "Versioned Blank Clip" && asset.kind === "clip")!;
    const originalVersion = assetBefore.clipVersions![0];
    expect(originalVersion.layers).toHaveLength(1);
    const originalLayerIds = originalVersion.layers.map(layer => layer.id);

    const createBlank = Array.from(container.querySelectorAll<HTMLButtonElement>(".nested-timeline-tab .inline-actions button"))
      .find(button => button.textContent?.includes("New Blank Version"));
    expect(createBlank).toBeTruthy();
    click(createBlank!);
    await flushEffects();

    const after = persistedProject();
    const assetAfter = after.assets.find(asset => asset.id === assetBefore.id && asset.kind === "clip")!;
    expect(assetAfter.clipVersions).toHaveLength(2);
    expect(assetAfter.selectedClipVersionId).toBe(assetAfter.clipVersions![1].id);
    expect(assetAfter.clipVersions![0].layers.map(layer => layer.id)).toEqual(originalLayerIds);
    expect(assetAfter.clipVersions![0].layers).toHaveLength(1);
    expect(assetAfter.clipVersions![1]).toMatchObject({ duration: 6, layers: [], name: "Version 2" });
    expect(assetAfter.clipVersions![1].tracks?.map(track => track.id)).not.toContain(assetAfter.clipVersions![0].tracks?.[0]?.id);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Version 2");
    expect(container.querySelector(".nested-timeline-empty")).toBeTruthy();
  });


  it("keeps Clip Asset timeline ruler and track columns aligned", async () => {
    const nav = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(button => button.textContent?.includes("Assets"));
    click(nav!); await flushEffects();
    click(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Create asset"))!);
    click(Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(button => button.textContent?.trim() === "Clip")!);
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip title"]')!, "Shared Geometry Clip");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip canvas width"]')!, "1920");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip canvas height"]')!, "1080");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip duration"]')!, "8");
    click(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Create empty Clip"))!);
    await flushEffects();
    click(Array.from(container.querySelectorAll<HTMLButtonElement>(".asset-card button")).find(button => button.textContent?.includes("Edit Timeline"))!);
    await flushEffects();
    const nested = container.querySelector<HTMLElement>(".nested-timeline-tab.visual-timeline");
    expect(nested).toBeTruthy();
    // An empty Clip starts with no layers; add one so the test checks actual ruler-to-lane alignment.
    click(Array.from(nested!.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add layer"))!);
    click(Array.from(nested!.querySelectorAll<HTMLButtonElement>(".layer-add-menu button")).find(button => button.textContent?.trim() === "Video track")!);
    await flushEffects();
    expect(nested!.querySelector(".nested-visual-timeline-ruler .visual-ruler-caption")?.textContent).toBe("TIME");
    expect(nested!.querySelector(".nested-timeline-row.visual-track-row .nested-timeline-row-track.visual-track-lane")).toBeTruthy();
    expect(container.querySelector(".timeline-horizontal-scroll .visual-timeline-ruler")).toBeTruthy();
    expect(container.querySelector(".timeline-horizontal-scroll .visual-track-list")).toBeTruthy();
    const mobileScrollSurface = nested!.querySelector<HTMLElement>(".nested-timeline-scroll");
    expect(mobileScrollSurface).toBeTruthy();
    expect(mobileScrollSurface!.querySelector(".nested-visual-timeline-ruler")).toBeTruthy();
    expect(mobileScrollSurface!.querySelector(".nested-timeline-lanes")).toBeTruthy();
  });

  it("resizes a Master Timeline clip into its neighbor with preview and one-step Undo/Redo", async () => {
    await openTimelineView();
    await seedLinkedVideoAudioPairs(2);
    const before = persistedProject();
    const clips = before.timelineClips ?? [];
    const left = clips.find(clip => clip.id === "test-video-1")!;
    const right = clips.find(clip => clip.id === "test-video-2")!;
    const leftAudio = clips.find(clip => clip.linkedVideoClipId === left.id)!;
    const rightAudio = clips.find(clip => clip.linkedVideoClipId === right.id)!;
    const duration = Math.max(10, getMasterTimelineDuration(before.shots), ...clips.map(clip => clip.start + clip.duration));
    const resize = container.querySelector<HTMLElement>('[aria-label="Resize end of Video clip 1"]');
    expect(resize).toBeTruthy();
    const lane = resize!.closest(".visual-track-lane") as HTMLElement;
    Object.defineProperty(lane, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 64, width: 100, height: 64, x: 0, y: 0, toJSON: () => ({}) })
    });
    Object.defineProperty(resize!, "setPointerCapture", { configurable: true, value: vi.fn() });
    const startX = 20;
    const endX = startX + 100 * 3 / duration;
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
      Object.defineProperty(event, "pointerId", { configurable: true, value: 17 });
      act(() => resize!.dispatchEvent(event));
    };
    pointer("pointerdown", startX);
    pointer("pointermove", endX);
    expect(container.querySelector(".clip-overlap-preview")).toBeTruthy();
    pointer("pointerup", endX);
    await flushEffects();

    const resized = persistedProject().timelineClips ?? [];
    expect(resized.find(clip => clip.id === left.id)).toMatchObject({ start: 0, duration: 8 });
    expect(resized.find(clip => clip.id === right.id)).toMatchObject({ start: 8, duration: 2 });
    expect(resized.find(clip => clip.id === leftAudio.id)).toMatchObject({ start: 0, duration: 8, linkedVideoClipId: left.id });
    expect(resized.find(clip => clip.id === rightAudio.id)).toMatchObject({ start: 8, duration: 2, linkedVideoClipId: right.id });

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    const undone = persistedProject().timelineClips ?? [];
    expect(undone.find(clip => clip.id === left.id)).toMatchObject({ start: 0, duration: 5 });
    expect(undone.find(clip => clip.id === right.id)).toMatchObject({ start: 5, duration: 5 });
    expect(undone.find(clip => clip.id === leftAudio.id)).toMatchObject({ start: 0, duration: 5, linkedVideoClipId: left.id });
    expect(undone.find(clip => clip.id === rightAudio.id)).toMatchObject({ start: 5, duration: 5, linkedVideoClipId: right.id });

    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).find(clip => clip.id === right.id)).toMatchObject({ start: 8, duration: 2 });
  });

  it("snaps clips to edges on adjacent layers and permits cross-layer drag/drop", async () => {
    await openTimelineView();
    const addLayer = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Add layer"));
    expect(addLayer).toBeTruthy();
    click(addLayer!);
    const videoOption = Array.from(container.querySelectorAll<HTMLButtonElement>(".layer-add-menu button")).find(button => button.textContent?.trim() === "Video layer");
    expect(videoOption).toBeTruthy();
    click(videoOption!);
    await flushEffects();
    await seedLinkedVideoAudioPairs(2);

    const before = persistedProject();
    const source = (before.timelineClips ?? []).find(clip => clip.id === "test-video-1")!;
    const sourceAudio = (before.timelineClips ?? []).find(clip => clip.linkedVideoClipId === source.id)!;
    const targetTrack = before.tracks.filter(track => track.kind === "video")[1];
    expect(targetTrack).toBeTruthy();
    const sourceBlock = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-media-clip"))
      .find(button => button.textContent?.includes("Video clip 1") && !button.textContent?.includes(" audio"));
    expect(sourceBlock).toBeTruthy();

    const targetGroup = Array.from(container.querySelectorAll<HTMLElement>(".visual-track-group"))
      .find(group => group.querySelector(".visual-track-label strong")?.textContent === targetTrack.name);
    const targetLane = targetGroup?.querySelector<HTMLElement>(".visual-track-lane");
    expect(targetLane).toBeTruthy();
    Object.defineProperty(targetLane!, "getBoundingClientRect", {
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
    act(() => sourceBlock!.dispatchEvent(dragStart));
    const duration = Math.max(10, getMasterTimelineDuration(before.shots), ...(before.timelineClips ?? []).map(clip => clip.start + clip.duration));
    const clientX = 7.5 / duration * 100;
    const dragOver = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientX });
    Object.defineProperty(dragOver, "dataTransfer", { value: dataTransfer });
    act(() => targetLane!.dispatchEvent(dragOver));
    expect(container.querySelector(".timeline-snap-guide")).toBeTruthy();

    const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    act(() => targetLane!.dispatchEvent(drop));
    await flushEffects();

    const after = persistedProject().timelineClips ?? [];
    expect(after.find(clip => clip.id === source.id)).toMatchObject({ trackId: targetTrack.id, start: 5, duration: 5 });
    expect(after.find(clip => clip.id === sourceAudio.id)).toMatchObject({ start: 5, duration: 5, linkedVideoClipId: source.id });
    expect(after.filter(clip => clip.trackId === targetTrack.id)).toHaveLength(1);
  });

  it("rejects same-layer overlap during drag and keeps clips in non-overlapping positions", async () => {
    await openTimelineView();
    await seedLinkedVideoAudioPairs(2);
    const clipOnlyProject = persistedProject();
    clipOnlyProject.shots = [];
    clipOnlyProject.storyboardConnections = [];
    localStorage.setItem("dionysus.project.v1", JSON.stringify(clipOnlyProject));
    localStorage.removeItem("dionysus.composition.v2");
    act(() => root.unmount()); root = createRoot(container); act(() => root.render(<App />)); await flushEffects(); await openTimelineView();
    const before = persistedProject();
    const left = before.timelineClips?.find(clip => clip.id === "test-video-1")!;
    const right = before.timelineClips?.find(clip => clip.id === "test-video-2")!;
    const leftBlock = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-media-clip"))
      .find(button => button.textContent?.includes("Video clip 1") && !button.textContent?.includes(" audio"))!;
    const lane = leftBlock.closest(".visual-track-lane") as HTMLElement;
    Object.defineProperty(lane, "getBoundingClientRect", {
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
    act(() => leftBlock.dispatchEvent(dragStart));
    const duration = Math.max(10, getMasterTimelineDuration(before.shots), ...(before.timelineClips ?? []).map(clip => clip.start + clip.duration));
    const clientX = 7.5 / duration * 100;
    const dragOver = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientX });
    Object.defineProperty(dragOver, "dataTransfer", { value: dataTransfer });
    act(() => lane.dispatchEvent(dragOver));
    const preview = container.querySelector<HTMLElement>(".clip-drop-preview");
    expect(preview).toBeTruthy();
    const previewStart = Number.parseFloat(preview!.style.left) / 100 * duration;
    expect(previewStart + left.duration <= right.start + 1e-4 || previewStart >= right.start + right.duration - 1e-4).toBe(true);

    const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    act(() => lane.dispatchEvent(drop));
    await flushEffects();
    const after = (persistedProject().timelineClips ?? []).filter(clip => clip.trackId === left.trackId && clip.id.startsWith("test-video-"));
    expect(after).toHaveLength(2);
    for (const clip of after) {
      for (const other of after.filter(candidate => candidate.id !== clip.id)) {
        expect(clip.start + clip.duration <= other.start + 1e-4 || clip.start >= other.start + other.duration - 1e-4).toBe(true);
      }
    }
  });

  it("restores nested Version module edits through Undo/Redo and project JSON export", async () => {
    await openTimelineView();
    const versionMenu = container.querySelector<HTMLDetailsElement>(".master-shot-version-menu");
    expect(versionMenu).toBeTruthy();
    click(versionMenu!.querySelector("summary") as HTMLElement);
    const edit = versionMenu!.querySelector<HTMLButtonElement>(".timeline-version-edit");
    expect(edit).toBeTruthy();
    click(edit!);
    await flushEffects();

    const addCode = Array.from(container.querySelectorAll<HTMLButtonElement>(".nested-timeline-tab button")).find(button => button.textContent?.includes("Code"));
    expect(addCode).toBeTruthy();
    click(addCode!);
    await flushEffects();
    const getProceduralLayers = (project: typeof sampleProject) => project.shots.flatMap(shot => shot.slots.flatMap(slot => slot.versions.flatMap(version => version.layers.filter(layer => layer.kind === "procedural"))));
    const afterEdit = persistedProject();
    const added = getProceduralLayers(afterEdit).at(-1);
    expect(added).toBeTruthy();

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(getProceduralLayers(persistedProject()).some(layer => layer.id === added!.id)).toBe(false);
    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(getProceduralLayers(persistedProject()).find(layer => layer.id === added!.id)).toMatchObject({ id: added!.id, kind: "procedural" });

    const exportButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.toLowerCase().includes("export project"));
    expect(exportButton).toBeTruthy();
    click(exportButton!);
    const blob = createObjectURLMock.mock.calls.at(-1)?.[0] as Blob;
    expect(blob).toBeTruthy();
    const exportedJson = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    const exported = (JSON.parse(exportedJson) as { project: typeof sampleProject }).project;
    expect(getProceduralLayers(exported).find(layer => layer.id === added!.id)).toMatchObject({ id: added!.id, kind: "procedural" });
  });

  it("deletes an unlinked audio clip independently and restores that deletion through Undo/Redo", async () => {
    await openTimelineView();
    await seedLinkedVideoAudioPairs();
    await selectClip("Video clip 1 audio");
    click(actionNamed("Unlink audio"));
    await flushEffects();
    const beforeDelete = persistedProject();
    const video = beforeDelete.timelineClips?.find(clip => clip.kind === "video")!;
    const audio = beforeDelete.timelineClips?.find(clip => clip.kind === "audio")!;
    expect(audio).not.toHaveProperty("linkedVideoClipId");

    await selectClip(audio.name);
    click(actionNamed("Delete clip"));
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).some(clip => clip.id === video.id)).toBe(true);
    expect((persistedProject().timelineClips ?? []).some(clip => clip.id === audio.id)).toBe(false);
    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).find(clip => clip.id === audio.id)).not.toHaveProperty("linkedVideoClipId");
    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).some(clip => clip.id === video.id)).toBe(true);
    expect((persistedProject().timelineClips ?? []).some(clip => clip.id === audio.id)).toBe(false);
  });

  it("progressively discloses secondary preview controls", async () => {
    await openTimelineView();
    const panel = container.querySelector<HTMLElement>(".integrated-preview-panel");
    expect(panel).toBeTruthy();
    const toggle = Array.from(panel!.querySelectorAll<HTMLButtonElement>("button"))
      .find(button => button.textContent?.trim() === "More controls");
    expect(toggle).toBeTruthy();
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    const secondary = panel!.querySelector<HTMLElement>(".mobile-preview-secondary-controls");
    expect(secondary).toBeTruthy();
    expect(toggle!.getAttribute("aria-controls")).toBe(secondary!.id);
    expect(secondary!.querySelector('[aria-label="Timeline playhead time"]')).toBeTruthy();

    click(toggle!);
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
    expect(toggle!.textContent?.trim()).toBe("Less controls");
    expect(panel!.querySelector(".integrated-preview-controls")?.classList.contains("mobile-preview-tools-open")).toBe(true);

    click(toggle!);
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    expect(toggle!.textContent?.trim()).toBe("More controls");
    expect(panel!.querySelector(".integrated-preview-controls")?.classList.contains("mobile-preview-tools-open")).toBe(false);
  });

  it("opens a compact, accessible layer action menu on the mobile timeline", async () => {
    await openTimelineView();
    const videoTrack = persistedProject().tracks.find(track => track.kind === "video")!;
    const menuButton = buttonsNamed("Layer actions for " + videoTrack.name)[0];
    expect(menuButton).toBeTruthy();
    click(menuButton);
    expect(container.querySelector('[role="menu"]')).toBeTruthy();
    const menuItems = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).map(button => button.textContent?.trim());
    expect(menuItems).toContain("Settings…");
    expect(menuItems).toContain("Add clip");
    expect(menuItems).toContain("Remove layer…");
    click(Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent?.trim()==="Settings…")!);
    expect(container.querySelector(".shot-context-menu")).toBeNull();
  });

  it("removing a video layer deletes linked child audio but preserves detached audio through Undo/Redo", async () => {
    await openTimelineView();
    await seedLinkedVideoAudioPairs(2);
    await selectClip("Video clip 1 audio");
    click(actionNamed("Unlink audio"));
    await flushEffects();
    const initial = persistedProject();
    const videoTrack = initial.tracks.find(track => track.kind === "video")!;
    const detachedAudio = initial.timelineClips?.find(clip => clip.kind === "audio" && !clip.linkedVideoClipId)!;
    expect(detachedAudio).toBeTruthy();

    click(buttonsNamed("Remove " + videoTrack.name + " layer")[0]);
    await flushEffects();
    const removed = persistedProject();
    expect(removed.tracks.some(track => track.id === videoTrack.id)).toBe(false);
    expect(removed.timelineClips?.filter(clip => clip.kind === "video")).toHaveLength(0);
    expect(removed.timelineClips?.filter(clip => clip.kind === "audio")).toEqual([detachedAudio]);

    click(buttonsNamed("Undo")[0]);
    await flushEffects();
    expect(persistedProject().tracks).toEqual(initial.tracks);
    expect(persistedProject().timelineClips).toEqual(initial.timelineClips);

    click(buttonsNamed("Redo").find(button => !button.disabled)!);
    await flushEffects();
    expect(persistedProject().tracks.some(track => track.id === videoTrack.id)).toBe(false);
    expect(persistedProject().timelineClips).toEqual([detachedAudio]);
  });


});


describe("click-to-place timeline insertion", () => {
  it("chooses an empty time, prompts before collision, and ripples later clips without overlap", async () => {
    const project = structuredClone(persistedProject());
    project.shots = [];
    const videoTrack = project.tracks.find(track => track.kind === "video")!;
    project.assets = [{ id: "test-new-video-asset", name: "New footage", kind: "video", createdAt: "2026-10-19T00:00:00.000Z" }];
    project.timelineClips = [
      { id: "existing-first", name: "Existing first", kind: "video", trackId: videoTrack.id, start: 4, duration: 2 },
      { id: "existing-later", name: "Existing later", kind: "video", trackId: videoTrack.id, start: 7, duration: 2 },
    ];

    act(() => root.unmount());
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    await openTimelineView();

    click(buttonsNamed("Add clip to " + videoTrack.name)[0]);
    await flushEffects();
    expect(container.querySelector(".asset-picker-dialog")).toBeTruthy();
    const assetCard = Array.from(container.querySelectorAll<HTMLButtonElement>(".asset-picker-card"))
      .find(button => button.textContent?.includes("New footage"));
    expect(assetCard).toBeTruthy();
    click(assetCard!);
    await flushEffects();
    expect(container.querySelector(".timeline-placement-banner")?.textContent).toContain("New footage");
    expect((persistedProject().timelineClips ?? []).map(clip => clip.id)).toEqual(["existing-first", "existing-later"]);

    const trackRow = Array.from(container.querySelectorAll<HTMLElement>(".visual-track-row"))
      .find(row => row.querySelector(".visual-track-label strong")?.textContent === videoTrack.name);
    const lane = trackRow?.querySelector<HTMLElement>(".visual-track-lane");
    expect(lane).toBeTruthy();
    Object.defineProperty(lane!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 76, width: 100, height: 76, x: 0, y: 0, toJSON: () => ({}) })
    });
    const pointer = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 30 });
    act(() => lane!.dispatchEvent(pointer));
    await flushEffects();
    expect(container.querySelector('[aria-labelledby="timeline-insert-title"]')?.textContent).toContain("Not enough empty space");
    expect(container.querySelectorAll(".timeline-insert-option")).toHaveLength(2);
    expect((persistedProject().timelineClips ?? []).map(clip => clip.id)).toEqual(["existing-first", "existing-later"]);

    click(container.querySelectorAll<HTMLButtonElement>(".timeline-insert-option")[0]);
    await flushEffects();
    const inserted = persistedProject().timelineClips ?? [];
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "New footage", start: 3, duration: 3, trackId: videoTrack.id }),
      expect.objectContaining({ id: "existing-first", start: 6, duration: 2 }),
      expect.objectContaining({ id: "existing-later", start: 9, duration: 2 }),
    ]));
    expect(container.querySelector('[aria-label="Timeline playhead"]')?.getAttribute("aria-valuemax")).toBe("11");
    const sorted = inserted.filter(clip => clip.trackId === videoTrack.id).sort((a, b) => a.start - b.start);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index - 1].start + sorted[index - 1].duration).toBeLessThanOrEqual(sorted[index].start + 1e-7);
    }
    const savedEnvelope = JSON.parse(localStorage.getItem("dionysus.composition.v2")!) as {
      compositionModel: { rootComposition: { placements: Array<{ id: string; start: number; duration: number }> } };
    };
    expect(savedEnvelope.compositionModel.rootComposition.placements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "existing-first", start: 6, duration: 2 }),
      expect.objectContaining({ id: "existing-later", start: 9, duration: 2 }),
      expect.objectContaining({ start: 3, duration: 3 }),
    ]));

    click(buttonsNamed("Undo edit")[0]);
    await flushEffects();
    const afterUndo = JSON.parse(localStorage.getItem("dionysus.composition.v2")!) as typeof savedEnvelope;
    expect(afterUndo.compositionModel.rootComposition.placements.some(placement => placement.start === 3 && placement.duration === 3)).toBe(false);
    expect(afterUndo.compositionModel.rootComposition.placements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "existing-first", start: 4, duration: 2 }),
      expect.objectContaining({ id: "existing-later", start: 7, duration: 2 }),
    ]));

    click(buttonsNamed("Redo edit")[0]);
    await flushEffects();
    const afterRedo = JSON.parse(localStorage.getItem("dionysus.composition.v2")!) as typeof savedEnvelope;
    expect(afterRedo.compositionModel.rootComposition.placements).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "existing-first", start: 6, duration: 2 }),
      expect.objectContaining({ id: "existing-later", start: 9, duration: 2 }),
    ]));
  });
});


describe("mobile touch timeline gestures", () => {
  it("moves a clip after a long press and release on a compatible track", async () => {
    const project = structuredClone(persistedProject());
    project.shots = [];
    const videoTrack = project.tracks.find(track => track.kind === "video")!;
    project.timelineClips = [
      { id: "touch-moving-clip", name: "Touch moving clip", kind: "video", trackId: videoTrack.id, start: 0, duration: 2 },
      { id: "touch-existing-clip", name: "Touch existing clip", kind: "video", trackId: videoTrack.id, start: 3, duration: 2 },
    ];
    act(() => root.unmount());
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    await openTimelineView();

    const moving = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-media-clip"))
      .find(button => button.textContent?.includes("Touch moving clip"));
    const lane = Array.from(container.querySelectorAll<HTMLElement>(".visual-track-lane"))
      .find(element => element.dataset.trackId === videoTrack.id);
    expect(moving).toBeTruthy();
    expect(lane).toBeTruthy();
    Object.defineProperty(lane!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 76, width: 100, height: 76, x: 0, y: 0, toJSON: () => ({}) }),
    });
    Object.defineProperty(moving!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 20, bottom: 56, width: 20, height: 56, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const previousElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => lane });
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
      Object.defineProperties(event, {
        pointerId: { value: 71 }, pointerType: { value: "touch" }, button: { value: 0 },
        clientX: { value: x }, clientY: { value: y },
      });
      return event;
    };
    try {
      act(() => moving!.dispatchEvent(pointer("pointerdown", 10, 20)));
      await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 300)); });
      act(() => window.dispatchEvent(pointer("pointermove", 90, 20)));
      act(() => window.dispatchEvent(pointer("pointerup", 90, 20)));
      await flushEffects();
      const moved = (persistedProject().timelineClips ?? []).find(clip => clip.id === "touch-moving-clip");
      expect(moved?.start).toBeGreaterThan(5);
      expect(moved?.trackId).toBe(videoTrack.id);
    } finally {
      if (previousElementFromPoint) Object.defineProperty(document, "elementFromPoint", previousElementFromPoint);
      else Reflect.deleteProperty(document, "elementFromPoint");
    }
  });
});


describe("mobile nested timeline touch gestures", () => {
  it("moves a Clip Version layer after a long press and release on another track", async () => {
    const nav = Array.from(container.querySelectorAll<HTMLButtonElement>(".nav-item")).find(button => button.textContent?.includes("Assets"));
    click(nav!); await flushEffects();
    click(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Create asset"))!);
    click(Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(button => button.textContent?.trim() === "Clip")!);
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip title"]')!, "Touch Nested Clip");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip canvas width"]')!, "1920");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip canvas height"]')!, "1080");
    setInputValue(container.querySelector<HTMLInputElement>('[aria-label="Clip duration"]')!, "6");
    click(Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Create empty Clip"))!);
    await flushEffects();
    click(Array.from(container.querySelectorAll<HTMLButtonElement>(".asset-card button")).find(button => button.textContent?.includes("Edit Timeline"))!);
    await flushEffects();
    const nested = container.querySelector<HTMLElement>(".nested-timeline-tab.visual-timeline")!;
    const addLayer = () => Array.from(nested.querySelectorAll<HTMLButtonElement>(".inline-actions button")).find(button => button.textContent?.includes("Add layer"))!;
    const addVideoTrack = () => {
      click(addLayer());
      click(Array.from(nested.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(button => button.textContent?.trim() === "Video track")!);
    };
    addVideoTrack(); await flushEffects();
    addVideoTrack(); await flushEffects();
    click(nested.querySelector<HTMLButtonElement>(".nested-timeline-row-label .track-add-clip")!);
    await flushEffects();

    const saved = persistedProject();
    const asset = saved.assets.find(item => item.name === "Touch Nested Clip" && item.kind === "clip")!;
    const version = asset.clipVersions![0];
    const layer = version.layers[0];
    const moving = Array.from(nested.querySelectorAll<HTMLButtonElement>(".nested-timeline-clip"))
      .find(button => button.textContent?.includes(layer.name))!;
    const lanes = Array.from(nested.querySelectorAll<HTMLElement>(".nested-timeline-row-track[data-track-id]"));
    const sourceLane = lanes.find(lane => lane.dataset.trackId === layer.trackId)!;
    const targetLane = lanes.find(lane => lane.dataset.trackId !== layer.trackId)!;
    expect(moving).toBeTruthy();
    expect(targetLane).toBeTruthy();
    Object.defineProperty(sourceLane, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 76, width: 100, height: 76, x: 0, y: 0, toJSON: () => ({}) }),
    });
    Object.defineProperty(targetLane, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 76, right: 100, bottom: 152, width: 100, height: 76, x: 0, y: 76, toJSON: () => ({}) }),
    });
    Object.defineProperty(moving, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 50, bottom: 56, width: 50, height: 56, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const previousElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => targetLane });
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
      Object.defineProperties(event, {
        pointerId: { value: 72 }, pointerType: { value: "touch" }, button: { value: 0 },
        clientX: { value: x }, clientY: { value: y },
      });
      return event;
    };
    try {
      act(() => moving.dispatchEvent(pointer("pointerdown", 25, 20)));
      await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 300)); });
      act(() => window.dispatchEvent(pointer("pointermove", 90, 100)));
      act(() => window.dispatchEvent(pointer("pointerup", 90, 100)));
      await flushEffects();
      const movedAsset = persistedProject().assets.find(item => item.id === asset.id && item.kind === "clip")!;
      const movedLayer = movedAsset.clipVersions![0].layers.find(item => item.id === layer.id)!;
      expect(movedLayer.trackId).toBe(targetLane.dataset.trackId);
    } finally {
      if (previousElementFromPoint) Object.defineProperty(document, "elementFromPoint", previousElementFromPoint);
      else Reflect.deleteProperty(document, "elementFromPoint");
    }
  });
});


describe("mobile contextual timeline tools", () => {
  it("shows selected clip actions and opens/closes the mobile Inspector", async () => {
    const project = structuredClone(persistedProject());
    const videoTrack = project.tracks.find(track => track.kind === "video")!;
    project.timelineClips = [
      { id: "mobile-tools-clip", name: "Mobile tools clip", kind: "video", trackId: videoTrack.id, start: 0, duration: 3 },
    ];
    act(() => root.unmount());
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    await openTimelineView();

    const clip = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-media-clip"))
      .find(button => button.textContent?.includes("Mobile tools clip"))!;
    click(clip);
    await flushEffects();
    expect(container.querySelector(".mobile-clip-toolbar")).toBeTruthy();

    click(Array.from(container.querySelectorAll<HTMLButtonElement>(".mobile-clip-toolbar button"))
      .find(button => button.textContent?.includes("Settings"))!);
    await flushEffects();
    expect(container.querySelector('[role="dialog"] #timeline-clip-settings-title')?.textContent).toContain("Mobile tools clip");
    click(Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-clip-inspector button"))
      .find(button => button.textContent?.trim() === "Close")!);
    await flushEffects();

    click(container.querySelector<HTMLButtonElement>(".timeline-inspector-toggle")!);
    await flushEffects();
    expect(container.querySelector(".workbench.timeline-workbench")?.classList.contains("timeline-inspector-open")).toBe(true);
    click(container.querySelector<HTMLButtonElement>(".mobile-inspector-close")!);
    await flushEffects();
    expect(container.querySelector(".workbench.timeline-workbench")?.classList.contains("timeline-inspector-open")).toBe(false);
  });
});


describe("mobile timeline zoom controls", () => {
  it("zooms the timeline scroll surface without changing clip timing and can fit back to view", async () => {
    const project = structuredClone(persistedProject());
    const videoTrack = project.tracks.find(track => track.kind === "video")!;
    project.timelineClips = [
      { id: "zoom-test-clip", name: "Zoom test clip", kind: "video", trackId: videoTrack.id, start: 1, duration: 3 },
    ];
    act(() => root.unmount());
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    await openTimelineView();

    const scrollSurface = container.querySelector<HTMLElement>(".timeline-horizontal-scroll")!;
    expect(scrollSurface.style.getPropertyValue("--timeline-track-min-width")).toBe("240px");
    click(container.querySelector<HTMLButtonElement>('[aria-label="Zoom in timeline"]')!);
    await flushEffects();
    expect(scrollSurface.style.getPropertyValue("--timeline-track-min-width")).toBe("360px");
    expect((persistedProject().timelineClips ?? []).find(clip => clip.id === "zoom-test-clip")?.duration).toBe(3);
    click(container.querySelector<HTMLButtonElement>('[aria-label="Fit timeline"]')!);
    await flushEffects();
    expect(scrollSurface.style.getPropertyValue("--timeline-track-min-width")).toBe("240px");
  });
});


describe("mobile touch trim handles", () => {
  it("can trim a Master Timeline clip with a touch pointer", async () => {
    const project = structuredClone(persistedProject());
    const videoTrack = project.tracks.find(track => track.kind === "video")!;
    project.timelineClips = [
      { id: "touch-trim-clip", name: "Touch trim clip", kind: "video", trackId: videoTrack.id, start: 0, duration: 3 },
    ];
    act(() => root.unmount());
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    await openTimelineView();

    const clip = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-media-clip"))
      .find(button => button.textContent?.includes("Touch trim clip"))!;
    const right = clip.querySelector<HTMLElement>(".clip-resize-right")!;
    const lane = clip.closest(".visual-track-lane") as HTMLElement;
    expect(right).toBeTruthy();
    Object.defineProperty(lane, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 76, width: 100, height: 76, x: 0, y: 0, toJSON: () => ({}) }),
    });
    const pointer = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
      Object.defineProperties(event, {
        pointerId: { value: 73 }, pointerType: { value: "touch" }, button: { value: 0 }, clientX: { value: x },
      });
      return event;
    };
    act(() => right.dispatchEvent(pointer("pointerdown", 20)));
    act(() => window.dispatchEvent(pointer("pointermove", 30)));
    act(() => window.dispatchEvent(pointer("pointerup", 30)));
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).find(item => item.id === "touch-trim-clip")?.duration).toBeGreaterThan(3);
  });
});


describe("mobile timeline playhead scrubbing", () => {
  it("continues scrubbing during a touch-pointer drag outside the initial point", async () => {
    await openTimelineView();
    const ruler = container.querySelector<HTMLElement>('.visual-timeline-ruler-lane[aria-label="Timeline playhead"]');
    expect(ruler).toBeTruthy();
    Object.defineProperty(ruler!, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, top: 0, right: 100, bottom: 32, width: 100, height: 32, x: 0, y: 0, toJSON: () => ({}) }) });
    const pointer = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
      Object.defineProperties(event, { pointerId: { value: 93 }, pointerType: { value: "touch" }, button: { value: 0 }, clientX: { value: x }, clientY: { value: 10 } });
      return event;
    };
    act(() => ruler!.dispatchEvent(pointer("pointerdown", 20))); await flushEffects();
    act(() => ruler!.dispatchEvent(pointer("pointermove", 80))); await flushEffects();
    const valueAfterMove = Number(ruler!.getAttribute("aria-valuenow"));
    expect(valueAfterMove).toBeGreaterThan(Number(ruler!.getAttribute("aria-valuemax")) * 0.7);
    expect(valueAfterMove * 24).toBeCloseTo(Math.round(valueAfterMove * 24), 5);
    act(() => ruler!.dispatchEvent(pointer("pointerup", 80)));
  });
});


describe("mobile version picker affordances", () => {
  it("opens the Master Shot version picker with version and add-version actions", async () => {
    await openTimelineView();
    const menu = container.querySelector<HTMLDetailsElement>(".master-shot-version-menu");
    expect(menu).toBeTruthy();
    const summary = menu!.querySelector<HTMLElement>("summary");
    expect(summary?.getAttribute("aria-label")).toContain("Show versions for");
    click(summary!);
    expect(menu!.open).toBe(true);
    expect(menu!.querySelector(".timeline-version-menu-row button:first-child")).toBeTruthy();
    expect(Array.from(menu!.querySelectorAll("button")).some(button => button.textContent?.includes("Add Version"))).toBe(true);
  });
});


describe("mobile frame-step preview controls", () => {
  it("moves the playhead by exactly one project frame in either direction", async () => {
    await openTimelineView();
    const playhead = container.querySelector<HTMLInputElement>('input[aria-label="Timeline playhead time"]');
    const nextFrame = container.querySelector<HTMLButtonElement>('button[aria-label="Next frame"]');
    const previousFrame = container.querySelector<HTMLButtonElement>('button[aria-label="Previous frame"]');
    const frameCounter = container.querySelector<HTMLElement>(".mobile-frame-counter");
    expect(frameCounter).toBeTruthy();
    expect(playhead).toBeTruthy();
    expect(nextFrame).toBeTruthy();
    expect(previousFrame).toBeTruthy();
    const frameDuration = 1 / sampleProject.frameRate;
    click(nextFrame!);
    await flushEffects();
    expect(Number(playhead!.value)).toBeCloseTo(frameDuration, 5);
    expect(frameCounter!.textContent).toBe("1f");
    click(previousFrame!);
    await flushEffects();
    expect(Number(playhead!.value)).toBeCloseTo(0, 5);
    expect(frameCounter!.textContent).toBe("0f");
  });
});


describe("frame-accurate timeline keyboard scrubbing", () => {
  it("moves the focused visual ruler by one frame per arrow key", async () => {
    await openTimelineView();
    const ruler = container.querySelector<HTMLElement>('.visual-timeline-ruler-lane[aria-label="Timeline playhead"]');
    expect(ruler).toBeTruthy();
    act(() => ruler!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await flushEffects();
    const value = Number(ruler!.getAttribute("aria-valuenow"));
    expect(value).toBeCloseTo(1 / sampleProject.frameRate, 5);
    act(() => ruler!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    await flushEffects();
    expect(Number(ruler!.getAttribute("aria-valuenow"))).toBeCloseTo(0, 5);
  });
});


describe("mobile preview history controls", () => {
  it("exposes Undo and Redo beside the preview and restores clip duplication", async () => {
    const project = structuredClone(persistedProject());
    const videoTrack = project.tracks.find(track => track.kind === "video")!;
    project.timelineClips = [
      { id: "mobile-history-clip", name: "Mobile history clip", kind: "video", trackId: videoTrack.id, start: 0, duration: 2 },
    ];
    act(() => root.unmount());
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    await openTimelineView();

    const historyButtons = () => Array.from(container.querySelectorAll<HTMLButtonElement>(".integrated-preview-controls .mobile-history-control"));
    expect(historyButtons().map(button => button.getAttribute("aria-label"))).toEqual(["Undo edit", "Redo edit"]);
    expect(historyButtons()[0].disabled).toBe(true);
    expect(historyButtons()[1].disabled).toBe(true);

    const clip = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-media-clip"))
      .find(button => button.textContent?.includes("Mobile history clip"))!;
    click(clip);
    await flushEffects();
    const duplicate = Array.from(container.querySelectorAll<HTMLButtonElement>(".mobile-clip-toolbar button"))
      .find(button => button.getAttribute("aria-label") === "Duplicate selected clip")!;
    click(duplicate);
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).filter(item => item.name === "Mobile history clip")).toHaveLength(2);
    expect(historyButtons()[0].disabled).toBe(false);

    click(historyButtons()[0]);
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).filter(item => item.name === "Mobile history clip")).toHaveLength(1);
    expect(historyButtons()[1].disabled).toBe(false);

    click(historyButtons()[1]);
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).filter(item => item.name === "Mobile history clip")).toHaveLength(2);
  });
});


describe("mobile audio clip controls", () => {
  it("toggles mute for a selected audio clip and persists the state", async () => {
    const project = structuredClone(persistedProject());
    const audioTrack = project.tracks.find(track => track.kind === "audio")!;
    project.timelineClips = [
      { id: "mobile-audio-mute-clip", name: "Mobile audio mute clip", kind: "audio", trackId: audioTrack.id, start: 0, duration: 3, muted: false },
    ];
    act(() => root.unmount());
    localStorage.setItem("dionysus.project.v1", JSON.stringify(project));
    localStorage.removeItem("dionysus.composition.v2");
    root = createRoot(container);
    act(() => root.render(<App />));
    await flushEffects();
    await openTimelineView();

    const clip = Array.from(container.querySelectorAll<HTMLButtonElement>(".visual-media-clip"))
      .find(button => button.textContent?.includes("Mobile audio mute clip"))!;
    click(clip);
    await flushEffects();
    const muteButton = () => container.querySelector<HTMLButtonElement>('[aria-label="Mute selected audio"], [aria-label="Unmute selected audio"]');
    expect(muteButton()?.getAttribute("aria-label")).toBe("Mute selected audio");
    expect(muteButton()?.getAttribute("aria-pressed")).toBe("false");
    click(muteButton()!);
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).find(item => item.id === "mobile-audio-mute-clip")?.muted).toBe(true);
    expect(muteButton()?.getAttribute("aria-label")).toBe("Unmute selected audio");
    expect(muteButton()?.getAttribute("aria-pressed")).toBe("true");
    click(muteButton()!);
    await flushEffects();
    expect((persistedProject().timelineClips ?? []).find(item => item.id === "mobile-audio-mute-clip")?.muted).toBe(false);
  });
});

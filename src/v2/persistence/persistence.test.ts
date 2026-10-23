import { describe, expect, it, vi } from "vitest";
import { Engine } from "../engine/engine";
import { renameProject } from "../engine/commands";
import { createProject } from "../domain/model";
import { createMemoryStorage } from "./memory";
import { attachAutosave } from "./autosave";
import { importFile, mediaKindOf } from "./media";

describe("v2 persistence", () => {
  it("autosaves debounced engine changes", async () => {
    vi.useFakeTimers();
    const s = createMemoryStorage();
    const e = new Engine(createProject("a"));
    const auto = attachAutosave(e, s.projects, 100);
    e.dispatch(renameProject("b"));
    e.dispatch(renameProject("bc"));
    expect(await s.projects.list()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    expect((await s.projects.load(e.getState().project.id))?.name).toBe("bc");
    auto.dispose();
    vi.useRealTimers();
  });

  it("detects media kinds", () => {
    expect(mediaKindOf({ type: "", name: "a.MP4" })).toBe("video");
    expect(mediaKindOf({ type: "audio/mpeg", name: "x" })).toBe("audio");
    expect(mediaKindOf({ type: "", name: "x.html" })).toBe("html");
    expect(mediaKindOf({ type: "text/plain", name: "x.txt" })).toBeUndefined();
  });

  it("imports a file into blob store with probed metadata", async () => {
    const s = createMemoryStorage();
    const file = new File(["x"], "clip.webm", { type: "video/webm" });
    URL.createObjectURL = () => "blob:x";
    URL.revokeObjectURL = () => undefined;
    const asset = await importFile(file, s.blobs, async () => ({ durationTicks: 1200, width: 2, height: 2 }));
    expect(asset?.kind).toBe("video");
    expect(await s.blobs.get(asset!.versions[0].media.blobKey)).toBe(file);
  });
});

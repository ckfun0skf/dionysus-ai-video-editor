import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageThumbnail, createVideoThumbnail, getAssetThumbnail } from "./mediaThumbnail";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installCanvasAndObjectUrlMocks() {
  const context = { drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => "data:image/jpeg;base64,dGh1bWI=")
  };
  const url = {
    createObjectURL: vi.fn(() => "blob:thumbnail-test"),
    revokeObjectURL: vi.fn()
  };
  vi.stubGlobal("URL", url);
  vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
  return { canvas, context, url };
}

describe("media thumbnails", () => {
  it("creates a downsized thumbnail for an image Blob", async () => {
    const { canvas, context, url } = installCanvasAndObjectUrlMocks();
    class FakeImage {
      naturalWidth = 1920;
      naturalHeight = 1080;
      onload: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.(new Event("load")));
      }
    }
    vi.stubGlobal("Image", FakeImage);

    const thumb = await createImageThumbnail(new Blob(["image"], { type: "image/png" }));
    expect(thumb).toBe("data:image/jpeg;base64,dGh1bWI=");
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:thumbnail-test");
  });

  it("captures a representative frame from an imported video Blob", async () => {
    const { canvas, context, url } = installCanvasAndObjectUrlMocks();
    let readyState = 1;
    let currentTime = 0;
    const video = new EventTarget() as EventTarget & Record<string, unknown>;
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.duration = 10;
    video.videoWidth = 640;
    video.videoHeight = 360;
    Object.defineProperty(video, "readyState", { get: () => readyState });
    Object.defineProperty(video, "currentTime", {
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        readyState = 2;
        queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
      }
    });
    video.pause = vi.fn();
    video.removeAttribute = vi.fn();
    video.load = () => queueMicrotask(() => video.dispatchEvent(new Event("loadedmetadata")));
    vi.stubGlobal("document", { createElement: vi.fn((tag: string) => tag === "video" ? video : canvas) });

    const thumb = await createVideoThumbnail(new Blob(["video"], { type: "video/mp4" }));
    expect(thumb).toBe("data:image/jpeg;base64,dGh1bWI=");
    expect(currentTime).toBe(1);
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:thumbnail-test");
  });

  it("uses saved thumbnails first, falls back to image paths, and leaves unsupported video without a fake thumbnail", () => {
    expect(getAssetThumbnail(undefined)).toBeUndefined();
    expect(getAssetThumbnail({ kind: "video", path: "idb://media/clip" })).toBeUndefined();
    expect(getAssetThumbnail({ kind: "video", path: "idb://media/clip", thumbnailPath: "data:image/jpeg;base64,real" }))
      .toBe("data:image/jpeg;base64,real");
    expect(getAssetThumbnail({ kind: "image", path: "data:image/png;base64,full" }))
      .toBe("data:image/png;base64,full");
  });
});

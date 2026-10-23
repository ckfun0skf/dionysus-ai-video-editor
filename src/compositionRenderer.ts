import type { Asset, ClipVersion, CompositionLayer, DionysusProject } from "./types";
import { getAudioEnvelope } from "./audioEnvelope";
import { getMasterShotStarts, getMasterTimelineDuration } from "./masterTimeline";
import { loadMediaBlobFromPath, resolveMediaSource } from "./mediaAssetStore";
import { normalizeClipVersionTracks } from "./clipVersionTracks";
import type { CompositionDocument } from "./compositionModel";
import { projectRootCompositionToLegacy } from "./compositionMigration";

export interface RenderOptions { fps?: number; width?: number; height?: number; duration?: number; /** Avoid blocking interactive preview frames on media seek completion; exports keep precise seeking by default. */ interactivePreview?: boolean }
export interface ExportResult { blob: Blob; filename: string; mimeType: string }

export function collectVersionRenderLayers(version: ClipVersion): CompositionLayer[] {
  if (!version.composition) return version.layers;

  const mutedByTrack = new Map(version.composition.tracks.map(track => [track.id, Boolean(track.muted)]));
  const canonicalLayers = normalizeClipVersionTracks(version).layers.map(layer => {
    const trackId = layer.trackId;
    return {
      ...layer,
      muted: Boolean(layer.muted || (trackId ? mutedByTrack.get(trackId) : false)),
    };
  });
  const linkedAudioLayers = version.composition.placements.flatMap(owner =>
    (owner.linkedAudioChildren ?? []).map(child => {
      const layer = {
        ...(structuredClone(child.legacyData) as Record<string, unknown>),
        id: child.id,
        name: child.name,
        kind: "audio",
        trackId: owner.trackId,
        start: owner.start,
        duration: owner.duration,
        linkedVideoClipId: owner.id,
      } as unknown as CompositionLayer & Record<string, unknown>;

      const sourceFields = layer as unknown as Record<string, unknown>;
      for (const key of ["assetId", "childCompositionId", "clipVersionId", "shotId", "slotId", "shotVersionId", "scriptVersionId"]) {
        delete sourceFields[key];
      }
      if (child.source.type === "asset") {
        sourceFields.assetId = child.source.assetId;
      } else if (child.source.type === "clip") {
        sourceFields.assetId = child.source.assetId;
        sourceFields.childCompositionId = child.source.assetId;
        if (child.source.versionId !== undefined) sourceFields.clipVersionId = child.source.versionId;
      } else if (child.source.type === "missing") {
        sourceFields.assetId = child.source.originalId;
      } else if (child.source.type === "shot") {
        sourceFields.shotId = child.source.shotId;
        if (child.source.slotId !== undefined) sourceFields.slotId = child.source.slotId;
        if (child.source.versionId !== undefined) sourceFields.shotVersionId = child.source.versionId;
      } else if (child.source.type === "script") {
        if (child.source.assetId !== undefined) sourceFields.assetId = child.source.assetId;
        if (child.source.scriptVersionId !== undefined) sourceFields.scriptVersionId = child.source.scriptVersionId;
      }

      if (child.sourceIn === undefined) delete layer.sourceIn;
      else layer.sourceIn = child.sourceIn;
      if (child.sourceOut === undefined) delete layer.sourceOut;
      else layer.sourceOut = child.sourceOut;
      layer.muted = Boolean(child.muted || mutedByTrack.get(owner.trackId));
      if (child.volume === undefined) delete layer.volume;
      else layer.volume = child.volume;
      if (child.fadeIn === undefined) delete layer.fadeIn;
      else layer.fadeIn = child.fadeIn;
      if (child.fadeOut === undefined) delete layer.fadeOut;
      else layer.fadeOut = child.fadeOut;
      return layer;
    })
  );
  return [...canonicalLayers, ...linkedAudioLayers];
}

export function collectCompositionLayers(project: DionysusProject): CompositionLayer[] {
  const shotStarts = getMasterShotStarts(project.shots);
  const nested = project.shots.flatMap((shot, shotIndex) => {
    const shotOffset = shotStarts[shotIndex];
    const layers = shot.slots.flatMap(slot => {
      const version = slot.versions.find(item => item.id === slot.selectedVersionId);
      if (!version) return [];
      // When present, the canonical nested Composition owns placement fields; the layer array
      // is only a compatibility projection and may be stale in recovered/imported documents.
      const versionLayers = collectVersionRenderLayers(version);
      return versionLayers.map(layer => ({ ...layer, start: layer.start + slot.start + shotOffset }));
    });
    return layers;
  });
  const timeline: CompositionLayer[] = (project.timelineClips ?? []).filter(clip => !clip.id.startsWith("storyboard-")).flatMap((clip): CompositionLayer[] => {
    const track = project.tracks.find(item => item.id === clip.trackId);
    const frameX = clip.x ?? track?.x ?? 0;
    const frameY = clip.y ?? track?.y ?? 0;
    const frameWidth = clip.width ?? track?.width ?? 100;
    const frameHeight = clip.height ?? track?.height ?? 100;
    const common = {
      id: clip.id, name: clip.name, kind: clip.kind === "clip" ? "composition" as const : clip.kind, start: clip.start, duration: clip.duration,
      ...(clip.referencedImageAssetIds ? { referencedImageAssetIds: [...clip.referencedImageAssetIds] } : {}),
      ...(clip.scriptVersionId ? { scriptVersionId: clip.scriptVersionId } : {}),
      ...(clip.prompt ? { prompt: clip.prompt } : {}),
      ...(clip.modelName ? { modelName: clip.modelName } : {}),
      ...(clip.modelVersion ? { modelVersion: clip.modelVersion } : {}),
      muted: Boolean(clip.muted || track?.muted),
      ...(clip.linkedVideoClipId ? { linkedVideoClipId: clip.linkedVideoClipId } : {}),
      volume: clip.volume, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, shortSourceBehavior: clip.shortSourceBehavior, textColor: clip.textColor, fontSize: clip.fontSize, textAlign: clip.textAlign
    };
    if (clip.kind === "clip") {
      const asset = project.assets.find(item => item.id === clip.assetId && item.kind === "clip");
      const version = asset?.clipVersions?.find(item => item.id === clip.clipVersionId)
        ?? (clip.clipVersionId ? undefined : asset?.clipVersions?.find(item => item.id === asset.selectedClipVersionId) ?? asset?.clipVersions?.[0]);
      if (!version || version.duration <= 0) return [];
      const result: CompositionLayer[] = [];
      // Resolve nested layers from the canonical document when available instead of trusting
      // its serialized schema-1.0 compatibility projection.
      const versionLayers = collectVersionRenderLayers(version);
      const repeats = clip.shortSourceBehavior === "loop" ? Math.max(1, Math.ceil(clip.duration / version.duration)) : 1;
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        const repeatOffset = repeat * version.duration;
        if (repeatOffset >= clip.duration) break;
        for (const layer of versionLayers) {
          const startOffset = repeatOffset + layer.start;
          if (startOffset >= clip.duration) continue;
          const visibleDuration = Math.min(layer.duration, version.duration - layer.start, clip.duration - startOffset);
          if (visibleDuration <= 0) continue;
          result.push({
            ...layer,
            id: clip.id + ":" + layer.id + ":" + repeat,
            name: layer.name,
            start: clip.start + startOffset,
            duration: visibleDuration,
            muted: Boolean(layer.muted || clip.muted || track?.muted),
            volume: layer.volume === undefined ? clip.volume : layer.volume * (clip.volume ?? 1),
            x: frameX + frameWidth * (layer.x ?? 0) / 100,
            y: frameY + frameHeight * (layer.y ?? 0) / 100,
            width: frameWidth * (layer.width ?? 100) / 100,
            height: frameHeight * (layer.height ?? 100) / 100
          });
        }
      }
      return result;
    }
    if (clip.kind === "text" || clip.kind === "procedural") {
      return [{
        ...common, fitMode: "contain" as const, x: clip.x ?? (clip.kind === "text" ? 0 : frameX), y: clip.y ?? (clip.kind === "text" ? 75 : frameY),
        width: clip.width ?? frameWidth, height: clip.height ?? (clip.kind === "text" ? 18 : frameHeight),
        ...(clip.code !== undefined ? { code: clip.code } : {}),
        ...(clip.html !== undefined ? { html: clip.html } : {}),
        ...(clip.css !== undefined ? { css: clip.css } : {})
      }];
    }
    if (!clip.assetId || !project.assets.some(asset => asset.id === clip.assetId)) return [];
    return [{
      ...common, assetId: clip.assetId, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut,
      fitMode: clip.fitMode ?? "contain", x: frameX, y: frameY, width: frameWidth, height: frameHeight
    }];
  });
  // Preserve Version layer order as the composition stacking order. Timing is checked per layer during rendering/export.
  return [...nested, ...timeline];
}

/** Resolve master-timeline render layers from the canonical root document, keeping the Project as domain/asset context. */
export function collectRootCompositionLayers(
  project: DionysusProject,
  rootComposition: CompositionDocument,
): CompositionLayer[] {
  return collectCompositionLayers(projectRootCompositionToLegacy(project, rootComposition));
}

/** Audio tracks may reference an audio file or the sound component of a video source. */
export function isPlayableAudioLayer(layer: Pick<CompositionLayer, "kind" | "linkedVideoClipId">, asset: Pick<Asset, "kind"> | undefined): boolean {
  if (layer.kind !== "audio" || !asset) return false;
  // Extract/Duplicate converts source audio into an independent Audio Track placement. Its
  // asset remains a video container, but the audio component must stay playable after the
  // ownership link is removed; linkedVideoClipId is UI ownership, not codec eligibility.
  return asset.kind === "audio" || asset.kind === "video";
}

export function getCompositionDuration(layers: CompositionLayer[]): number {
  return layers.reduce((end, layer) => Math.max(end, layer.start + layer.duration), 0);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image layer source"));
    if (/^https?:/i.test(src)) image.crossOrigin = "anonymous";
    image.src = src;
  });
}

// Concurrent preview ticks can reach the same uncached video before its metadata has loaded.
// Share one in-flight load per preview video map/asset so racing renders do not create competing
// media elements and overwrite the element that later frames are trying to seek and draw.
const pendingVideoLoads = new WeakMap<Map<string, HTMLVideoElement>, Map<string, Promise<HTMLVideoElement>>>();

async function getOrLoadPreviewVideo(
  asset: Asset,
  videos: Map<string, HTMLVideoElement>,
  mediaReleases: Map<string, () => void>
): Promise<HTMLVideoElement> {
  const existing = videos.get(asset.id);
  if (existing) return existing;

  let pending = pendingVideoLoads.get(videos);
  if (!pending) {
    pending = new Map<string, Promise<HTMLVideoElement>>();
    pendingVideoLoads.set(videos, pending);
  }
  const inFlight = pending.get(asset.id);
  if (inFlight) return inFlight;

  const loading = (async () => {
    const video = document.createElement("video");
    const resolved = await resolveMediaSource(asset.path!);
    if (resolved.release) mediaReleases.set(asset.id, resolved.release);
    if (resolved.remote) video.crossOrigin = "anonymous";
    video.src = resolved.src;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    await loadMediaMetadata(video, "Unable to load video layer source");
    // Metadata can arrive before the first frame is decoded. Cache only after the element can
    // actually be drawn so every concurrent preview render shares a drawable video element.
    await waitForVideoFrame(video);
    videos.set(asset.id, video);
    return video;
  })();
  pending.set(asset.id, loading);
  try {
    return await loading;
  } finally {
    if (pending.get(asset.id) === loading) pending.delete(asset.id);
  }
}

/**
 * `loadedmetadata` only guarantees duration/dimensions. The preview draws the video to a canvas,
 * which stays black until the browser has decoded a drawable frame (`readyState >= HAVE_CURRENT_DATA`).
 * Wait for that first frame once per cached preview element so the first render cannot silently
 * complete with a black canvas while later renders are being invalidated by the playhead.
 */
export function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => finish(new Error("Unable to decode the first video frame")), 10000);
    const onLoadedData = () => finish();
    const onError = () => finish(new Error("Unable to decode the first video frame"));
    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("error", onError);
    };
    function finish(error?: Error) {
      cleanup();
      if (error) reject(error);
      else resolve();
    }
    video.addEventListener("loadeddata", onLoadedData, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function loadMediaMetadata(media: HTMLMediaElement, message: string): Promise<void> {
  if (media.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoaded = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(message)); };
    const cleanup = () => { media.removeEventListener("loadedmetadata", onLoaded); media.removeEventListener("error", onError); };
    media.addEventListener("loadedmetadata", onLoaded, { once: true });
    media.addEventListener("error", onError, { once: true });
    media.load();
  });
}

function seekMedia(media: HTMLMediaElement, target: number): Promise<void> {
  const boundedTarget = Number.isFinite(media.duration) ? Math.min(Math.max(0, target), Math.max(0, media.duration - 0.001)) : Math.max(0, target);
  if (Math.abs(media.currentTime - boundedTarget) < 0.025) return Promise.resolve();
  return new Promise(resolve => {
    const fallback = window.setTimeout(() => { cleanup(); resolve(); }, 500);
    const onSeeked = () => { cleanup(); resolve(); };
    const cleanup = () => { window.clearTimeout(fallback); media.removeEventListener("seeked", onSeeked); };
    media.addEventListener("seeked", onSeeked, { once: true });
    try { media.currentTime = boundedTarget; } catch { cleanup(); resolve(); }
  });
}

function drawFit(ctx: CanvasRenderingContext2D, image: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number, fit: CompositionLayer["fitMode"] = "contain") {
  if (fit === "fill") { ctx.drawImage(image, x, y, w, h); return; }
  if (!sw || !sh) return;
  const scale = fit === "cover" ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: CompositionLayer, asset: Asset | undefined, seconds: number, width: number, height: number, images: Map<string, HTMLImageElement>, videos: Map<string, HTMLVideoElement>) {
  if (seconds < layer.start || seconds >= layer.start + layer.duration || layer.kind === "audio" || layer.kind === "script" || layer.kind === "procedural") return;
  const x = ((layer.x ?? 0) / 100) * width, y = ((layer.y ?? 0) / 100) * height;
  const w = ((layer.width ?? 100) / 100) * width, h = ((layer.height ?? 100) / 100) * height;
  const scale = layer.scale ?? 1, opacity = Math.max(0, Math.min(1, layer.opacity ?? 1));
  const local = seconds - layer.start;
  ctx.save();
  ctx.globalAlpha *= opacity;
  if (layer.animation === "float") ctx.translate(0, Math.sin(local * 2 * Math.PI / Math.max(.1, layer.animationDuration ?? 2)) * height * .015);
  if (layer.animation === "pulse") { const pulse = 1 + .04 * Math.sin(local * 2 * Math.PI / Math.max(.1, layer.animationDuration ?? 2)); ctx.translate(x + w / 2, y + h / 2); ctx.scale(pulse, pulse); ctx.translate(-(x + w / 2), -(y + h / 2)); }
  if (layer.animation === "rotate") { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(local * 2 * Math.PI / Math.max(.1, layer.animationDuration ?? 3)); ctx.translate(-(x + w / 2), -(y + h / 2)); }
  ctx.translate(x + w / 2, y + h / 2); ctx.scale(scale, scale); ctx.translate(-(x + w / 2), -(y + h / 2));
  const makeFramePath = (inset = 0) => {
    ctx.beginPath();
    if (layer.shape === "circle") ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, Math.min(w, h) / 2 - inset), Math.max(0, Math.min(w, h) / 2 - inset), 0, 0, Math.PI * 2);
    else if (layer.shape === "rounded") ctx.roundRect(x + inset, y + inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2), Math.max(0, (layer.cornerRadius ?? 12) - inset));
    else ctx.rect(x + inset, y + inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2));
  };
  makeFramePath();
  ctx.clip();
  if (layer.backgroundColor) { ctx.fillStyle = layer.backgroundColor; ctx.fillRect(x, y, w, h); }
  if (asset?.path && asset.kind === "image") {
    const image = images.get(asset.id);
    if (image) drawFit(ctx, image, image.naturalWidth, image.naturalHeight, x, y, w, h, layer.fitMode);
  } else if (asset?.path && asset.kind === "video") {
    const video = videos.get(asset.id);
    if (video && video.readyState >= 2) drawFit(ctx, video, video.videoWidth, video.videoHeight, x, y, w, h, layer.fitMode);
  } else if (layer.kind === "text" || layer.kind === "composition" || !asset?.path) {
    ctx.fillStyle = layer.backgroundColor ?? "rgba(8,12,20,.85)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = layer.textColor ?? "#fff";
    ctx.font = `600 ${Math.max(8, Math.round(layer.fontSize ?? height * .04))}px system-ui`;
    ctx.textAlign = layer.textAlign ?? "center"; ctx.textBaseline = "middle";
    const textX = layer.textAlign === "left" ? x + 12 : layer.textAlign === "right" ? x + w - 12 : x + w / 2;
    ctx.fillText(layer.name, textX, y + h / 2, Math.max(0, w - 24));
  }
  if (layer.borderColor && (layer.borderWidth ?? 0) > 0) {
    ctx.strokeStyle = layer.borderColor; ctx.lineWidth = layer.borderWidth!;
    makeFramePath(layer.borderWidth! / 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNestedCompositionFrame(
  ctx: CanvasRenderingContext2D,
  layer: CompositionLayer,
  frame: HTMLCanvasElement,
  seconds: number,
  width: number,
  height: number
) {
  if (seconds < layer.start || seconds >= layer.start + layer.duration) return;
  const x = ((layer.x ?? 0) / 100) * width, y = ((layer.y ?? 0) / 100) * height;
  const w = ((layer.width ?? 100) / 100) * width, h = ((layer.height ?? 100) / 100) * height;
  const opacity = Math.max(0, Math.min(1, layer.opacity ?? 1));
  const local = seconds - layer.start;
  ctx.save();
  ctx.globalAlpha *= opacity;
  if (layer.animation === "float") ctx.translate(0, Math.sin(local * 2 * Math.PI / Math.max(.1, layer.animationDuration ?? 2)) * height * .015);
  if (layer.animation === "pulse") {
    const pulse = 1 + .04 * Math.sin(local * 2 * Math.PI / Math.max(.1, layer.animationDuration ?? 2));
    ctx.translate(x + w / 2, y + h / 2); ctx.scale(pulse, pulse); ctx.translate(-(x + w / 2), -(y + h / 2));
  }
  if (layer.animation === "rotate") {
    ctx.translate(x + w / 2, y + h / 2); ctx.rotate(local * 2 * Math.PI / Math.max(.1, layer.animationDuration ?? 3)); ctx.translate(-(x + w / 2), -(y + h / 2));
  }
  const scale = layer.scale ?? 1;
  ctx.translate(x + w / 2, y + h / 2); ctx.scale(scale, scale); ctx.translate(-(x + w / 2), -(y + h / 2));
  const makeFramePath = (inset = 0) => {
    ctx.beginPath();
    if (layer.shape === "circle") ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, Math.min(w, h) / 2 - inset), Math.max(0, Math.min(w, h) / 2 - inset), 0, 0, Math.PI * 2);
    else if (layer.shape === "rounded") ctx.roundRect(x + inset, y + inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2), Math.max(0, (layer.cornerRadius ?? 12) - inset));
    else ctx.rect(x + inset, y + inset, Math.max(0, w - inset * 2), Math.max(0, h - inset * 2));
  };
  if (layer.backgroundColor) {
    ctx.fillStyle = layer.backgroundColor;
    makeFramePath();
    ctx.fill();
  }
  makeFramePath();
  ctx.clip();
  drawFit(ctx, frame, frame.width, frame.height, x, y, w, h, layer.fitMode);
  if (layer.borderColor && (layer.borderWidth ?? 0) > 0) {
    ctx.strokeStyle = layer.borderColor;
    ctx.lineWidth = layer.borderWidth!;
    makeFramePath(layer.borderWidth! / 2);
    ctx.stroke();
  }
  ctx.restore();
}

export async function renderCompositionFrame(canvas: HTMLCanvasElement, project: DionysusProject, layers: CompositionLayer[], seconds: number, options: RenderOptions = {}, images = new Map<string, HTMLImageElement>(), videos = new Map<string, HTMLVideoElement>(), mediaReleases = new Map<string, () => void>(), compositionPath: Set<string> = new Set()): Promise<void> {
  const width = options.width ?? project.width, height = options.height ?? project.height;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D rendering is unavailable");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
  for (const layer of layers) {
    const referencedCompositionId = layer.kind === "composition"
      ? layer.childCompositionId ?? (project.assets.some(item => item.id === layer.assetId && item.kind === "clip") ? layer.assetId : undefined)
      : undefined;
    if (referencedCompositionId && !compositionPath.has(referencedCompositionId)) {
      const childAsset = project.assets.find(item => item.id === referencedCompositionId && item.kind === "clip");
      const childVersion = childAsset?.clipVersions?.find(item => item.id === layer.clipVersionId)
        ?? (layer.clipVersionId ? undefined : childAsset?.clipVersions?.find(item => item.id === childAsset.selectedClipVersionId) ?? childAsset?.clipVersions?.[0]);
      if (childAsset?.kind === "clip" && childVersion && seconds >= layer.start && seconds < layer.start + layer.duration) {
        const childCanvas = document.createElement("canvas");
        await renderCompositionFrame(
          childCanvas,
          project,
          collectVersionRenderLayers(childVersion),
          seconds - layer.start,
          options,
          images,
          videos,
          mediaReleases,
          new Set([...compositionPath, referencedCompositionId])
        );
        drawNestedCompositionFrame(ctx, layer, childCanvas, seconds, width, height);
        continue;
      }
    }
    const asset = project.assets.find(item => item.id === layer.assetId);
    if (!asset?.path) { drawLayer(ctx, layer, asset, seconds, width, height, images, videos); continue; }
    if (asset.kind === "image" && !images.has(asset.id)) {
      const resolved = await resolveMediaSource(asset.path);
      if (resolved.release) mediaReleases.set(asset.id, resolved.release);
      images.set(asset.id, await loadImage(resolved.src));
    }
    if (asset.kind === "video" && !videos.has(asset.id)) {
      await getOrLoadPreviewVideo(asset, videos, mediaReleases);
    }
    const video = asset.kind === "video" ? videos.get(asset.id) : undefined;
    if (video && video.readyState >= 1 && seconds >= layer.start && seconds < layer.start + layer.duration) {
      const sourceIn = Math.max(0, layer.sourceIn ?? 0);
      const sourceEnd = Math.min(video.duration, layer.sourceOut ?? video.duration);
      const sourceSpan = Math.max(0, sourceEnd - sourceIn);
      const localTime = seconds - layer.start;
      if (sourceSpan <= 0 || (layer.shortSourceBehavior !== "loop" && localTime >= sourceSpan)) continue;
      const sourceOffset = layer.shortSourceBehavior === "loop" ? localTime % sourceSpan : localTime;
      const targetTime = sourceIn + sourceOffset;
      if (options.interactivePreview) {
        // Interactive preview must not wait for every seeked event: slow media seeks can otherwise
        // serialize rendering behind the playhead. Let the browser seek asynchronously and draw
        // the most recently decoded frame; the next preview tick will request the latest time.
        if (!video.seeking && Math.abs(video.currentTime - targetTime) >= 0.025) {
          try { video.currentTime = targetTime; } catch { /* Keep the last decoded frame while media becomes seekable. */ }
        }
      } else {
        await seekMedia(video, targetTime);
      }
    }
    drawLayer(ctx, layer, asset, seconds, width, height, images, videos);
  }
}

export async function exportCompositionWebM(project: DionysusProject, options: RenderOptions = {}): Promise<ExportResult> {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new Error("WebM export requires a browser with MediaRecorder and canvas captureStream support");
  }
  const layers = collectCompositionLayers(project), fps = options.fps ?? project.frameRate ?? 30;
  const projectDuration = getMasterTimelineDuration(project.shots);
  const duration = options.duration ?? Math.max(getCompositionDuration(layers), projectDuration);
  if (!layers.length || duration <= 0) throw new Error("Add at least one visible composition layer before exporting");
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error("Export frame rate must be between 1 and 60 FPS");
  const canvas = document.createElement("canvas");
  const stream = canvas.captureStream(fps);
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) { stream.getTracks().forEach(track => track.stop()); throw new Error("This browser does not support a compatible WebM encoder"); }

  const audioLayers = layers.filter(layer => {
    if (layer.kind !== "audio" || layer.muted) return false;
    const asset = project.assets.find(item => item.id === layer.assetId);
    return Boolean(asset?.path && isPlayableAudioLayer(layer, asset));
  });
  let audioContext: AudioContext | undefined;
  let audioDestination: MediaStreamAudioDestinationNode | undefined;
  let audioResume: Promise<void> | undefined;
  const scheduledAudio: {
    layer: CompositionLayer;
    source?: AudioBufferSourceNode;
    buffer?: AudioBuffer;
    gain: GainNode;
    media?: HTMLMediaElement;
    mediaSource?: MediaElementAudioSourceNode;
  }[] = [];
  const audioMediaReleases = new Map<string, () => void>();
  if (audioLayers.length) {
    if (!window.AudioContext) throw new Error("Audio export requires Web Audio API support");
    audioContext = new window.AudioContext();
    // Invoke resume synchronously from the export click path, before awaiting file decoding.
    audioResume = audioContext.resume();
    audioDestination = audioContext.createMediaStreamDestination();
    for (const layer of audioLayers) {
      const asset = project.assets.find(item => item.id === layer.assetId)!;
      const gain = audioContext.createGain();
      if (asset.kind === "video" && layer.linkedVideoClipId) {
        // Browsers generally cannot decode an MP4/WebM container with decodeAudioData.
        // Route a dedicated media element through Web Audio instead, leaving visual seeking independent.
        const resolved = await resolveMediaSource(asset.path!);
        if (resolved.release) audioMediaReleases.set(layer.id, resolved.release);
        const media = document.createElement("video");
        if (resolved.remote) media.crossOrigin = "anonymous";
        media.src = resolved.src;
        media.preload = "auto";
        media.playsInline = true;
        await loadMediaMetadata(media, "Unable to load linked video audio source");
        const mediaSource = audioContext.createMediaElementSource(media);
        mediaSource.connect(gain);
        gain.connect(audioDestination);
        scheduledAudio.push({ layer, gain, media, mediaSource });
      } else {
        const sourceBlob = await loadMediaBlobFromPath(asset.path!);
        const buffer = await audioContext.decodeAudioData(await sourceBlob.arrayBuffer());
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(audioDestination);
        scheduledAudio.push({ layer, source, buffer, gain });
      }
    }
    for (const track of audioDestination.stream.getAudioTracks()) stream.addTrack(track);
  }

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error("WebM recording failed"));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  const images = new Map<string, HTMLImageElement>(), videos = new Map<string, HTMLVideoElement>(), mediaReleases = new Map<string, () => void>();
  try {
    if (audioContext && audioResume) await audioResume;
    recorder.start(250);
    const audioStartAt = audioContext ? audioContext.currentTime + 0.05 : 0;
    const mediaPlaybackTasks: Promise<void>[] = [];
    for (const item of scheduledAudio) {
      const offset = Math.max(0, item.layer.sourceIn ?? 0);
      const sourceDuration = item.buffer?.duration ?? item.media?.duration ?? Number.POSITIVE_INFINITY;
      const sourceLimit = item.layer.sourceOut === undefined ? item.layer.duration : Math.max(0, item.layer.sourceOut - offset);
      const playbackDuration = Math.min(item.layer.duration, sourceLimit, Math.max(0, sourceDuration - offset));
      if (playbackDuration > 0) {
        const clipStartsAt = audioStartAt + item.layer.start;
        const pointCount = 64;
        const curve = new Float32Array(pointCount);
        for (let point = 0; point < pointCount; point += 1) {
          const elapsed = playbackDuration * point / (pointCount - 1);
          curve[point] = getAudioEnvelope(item.layer.volume, item.layer.fadeIn, item.layer.fadeOut, elapsed, playbackDuration);
        }
        item.gain.gain.setValueCurveAtTime(curve, clipStartsAt, playbackDuration);
        if (item.source) {
          item.source.start(clipStartsAt, offset, playbackDuration);
        } else if (item.media) {
          // Seek before play; a rejected media play must fail the export instead of silently dropping audio.
          const media = item.media;
          mediaPlaybackTasks.push(new Promise<void>((resolve, reject) => {
            window.setTimeout(() => {
              void (async () => {
                try {
                  await seekMedia(media, offset);
                  await media.play();
                  resolve();
                } catch (error) {
                  reject(new Error("Unable to start linked video audio during WebM export", { cause: error }));
                }
              })();
            }, Math.max(0, item.layer.start * 1000));
          }));
          window.setTimeout(() => media.pause(), Math.max(0, (item.layer.start + playbackDuration) * 1000));
        }
      }
    }
    const frames = Math.ceil(duration * fps);
    const started = performance.now();
    for (let frame = 0; frame < frames; frame++) {
      const seconds = frame / fps;
      await renderCompositionFrame(canvas, project, layers, seconds, options, images, videos, mediaReleases);
      const remaining = ((frame + 1) * 1000 / fps) - (performance.now() - started);
      if (remaining > 0) await new Promise<void>(resolve => window.setTimeout(resolve, remaining));
    }
    await Promise.all(mediaPlaybackTasks);
    recorder.stop();
    const blob = await finished;
    if (!blob.size) throw new Error("The browser produced an empty WebM file");
    return {
      blob,
      filename: (project.name.trim().replace(/[^a-z0-9-_]+/gi, "-") || "dionysus-project") + ".webm",
      mimeType
    };
  } catch (error) {
    if (recorder.state !== "inactive") recorder.stop();
    throw error;
  } finally {
    stream.getTracks().forEach(track => track.stop());
    videos.forEach(video => { video.pause(); video.removeAttribute("src"); video.load(); });
    mediaReleases.forEach(release => release());
    scheduledAudio.forEach(item => {
      if (item.source) { try { item.source.stop(); } catch { /* already finished */ } item.source.disconnect(); }
      item.media?.pause();
      item.media?.removeAttribute("src");
      item.media?.load();
      item.mediaSource?.disconnect();
      item.gain.disconnect();
    });
    audioMediaReleases.forEach(release => release());
    if (audioContext) await audioContext.close().catch(() => undefined);
  }
}

export function downloadExport(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = result.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

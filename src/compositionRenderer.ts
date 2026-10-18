import type { Asset, CompositionLayer, DionysusProject } from "./types";

export interface RenderOptions { fps?: number; width?: number; height?: number; duration?: number }
export interface ExportResult { blob: Blob; filename: string; mimeType: string }

export function collectCompositionLayers(project: DionysusProject): CompositionLayer[] {
  let shotOffset = 0;
  const nested = project.shots.flatMap(shot => {
    const layers = shot.slots.flatMap(slot => {
      const version = slot.versions.find(item => item.id === slot.selectedVersionId);
      return version ? version.layers.map(layer => ({ ...layer, start: layer.start + slot.start + shotOffset })) : [];
    });
    shotOffset += shot.duration;
    return layers;
  });
  const timeline = (project.timelineClips ?? []).flatMap(clip => {
    if (!clip.assetId || !project.assets.some(asset => asset.id === clip.assetId)) return [];
    return [{
      id: clip.id, name: clip.name, kind: clip.kind, start: clip.start, duration: clip.duration,
      assetId: clip.assetId, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut,
      fitMode: "contain" as const, x: 0, y: 0, width: 100, height: 100
    }];
  });
  return [...nested, ...timeline].sort((a, b) => a.start - b.start);
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
  if (seconds < layer.start || seconds >= layer.start + layer.duration || layer.kind === "audio" || layer.kind === "script") return;
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
    ctx.fillStyle = "#fff";
    ctx.font = `600 ${Math.max(16, Math.round(height * .04))}px system-ui`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(layer.name, x + w / 2, y + h / 2, Math.max(0, w - 24));
  }
  if (layer.borderColor && (layer.borderWidth ?? 0) > 0) {
    ctx.strokeStyle = layer.borderColor; ctx.lineWidth = layer.borderWidth!;
    makeFramePath(layer.borderWidth! / 2);
    ctx.stroke();
  }
  ctx.restore();
}

export async function renderCompositionFrame(canvas: HTMLCanvasElement, project: DionysusProject, layers: CompositionLayer[], seconds: number, options: RenderOptions = {}, images = new Map<string, HTMLImageElement>(), videos = new Map<string, HTMLVideoElement>()): Promise<void> {
  const width = options.width ?? project.width, height = options.height ?? project.height;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D rendering is unavailable");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
  for (const layer of layers) {
    const asset = project.assets.find(item => item.id === layer.assetId);
    if (!asset?.path) { drawLayer(ctx, layer, asset, seconds, width, height, images, videos); continue; }
    if (asset.kind === "image" && !images.has(asset.id)) images.set(asset.id, await loadImage(asset.path));
    if (asset.kind === "video" && !videos.has(asset.id)) {
      const video = document.createElement("video");
      if (/^https?:/i.test(asset.path)) video.crossOrigin = "anonymous";
      video.src = asset.path; video.muted = true; video.playsInline = true; video.preload = "auto";
      await loadMediaMetadata(video, "Unable to load video layer source");
      videos.set(asset.id, video);
    }
    const video = asset.kind === "video" ? videos.get(asset.id) : undefined;
    if (video && video.readyState >= 1 && seconds >= layer.start && seconds < layer.start + layer.duration) {
      await seekMedia(video, (layer.sourceIn ?? 0) + seconds - layer.start);
    }
    drawLayer(ctx, layer, asset, seconds, width, height, images, videos);
  }
}

export async function exportCompositionWebM(project: DionysusProject, options: RenderOptions = {}): Promise<ExportResult> {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    throw new Error("WebM export requires a browser with MediaRecorder and canvas captureStream support");
  }
  const layers = collectCompositionLayers(project), fps = options.fps ?? project.frameRate ?? 30;
  const duration = options.duration ?? getCompositionDuration(layers);
  if (!layers.length || duration <= 0) throw new Error("Add at least one visible composition layer before exporting");
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error("Export frame rate must be between 1 and 60 FPS");
  const canvas = document.createElement("canvas");
  const stream = canvas.captureStream(fps);
  const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) { stream.getTracks().forEach(track => track.stop()); throw new Error("This browser does not support a compatible WebM encoder"); }

  const audioLayers = layers.filter(layer => layer.kind === "audio" && project.assets.some(asset => asset.id === layer.assetId && asset.path));
  let audioContext: AudioContext | undefined;
  let audioDestination: MediaStreamAudioDestinationNode | undefined;
  let audioResume: Promise<void> | undefined;
  const scheduledAudio: { layer: CompositionLayer; source: AudioBufferSourceNode; buffer: AudioBuffer }[] = [];
  if (audioLayers.length) {
    if (!window.AudioContext) throw new Error("Audio export requires Web Audio API support");
    audioContext = new window.AudioContext();
    // Invoke resume synchronously from the export click path, before awaiting file decoding.
    audioResume = audioContext.resume();
    audioDestination = audioContext.createMediaStreamDestination();
    for (const layer of audioLayers) {
      const asset = project.assets.find(item => item.id === layer.assetId)!;
      const response = await fetch(asset.path!);
      if (!response.ok) throw new Error("Unable to read audio layer source: " + asset.name);
      const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioDestination);
      scheduledAudio.push({ layer, source, buffer });
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
  const images = new Map<string, HTMLImageElement>(), videos = new Map<string, HTMLVideoElement>();
  try {
    if (audioContext && audioResume) await audioResume;
    recorder.start(250);
    const audioStartAt = audioContext ? audioContext.currentTime + 0.05 : 0;
    for (const item of scheduledAudio) {
      const offset = Math.max(0, item.layer.sourceIn ?? 0);
      const sourceLimit = item.layer.sourceOut === undefined ? item.layer.duration : Math.max(0, item.layer.sourceOut - offset);
      const playbackDuration = Math.min(item.layer.duration, sourceLimit, Math.max(0, item.buffer.duration - offset));
      if (playbackDuration > 0) item.source.start(audioStartAt + item.layer.start, offset, playbackDuration);
    }
    const frames = Math.ceil(duration * fps);
    const started = performance.now();
    for (let frame = 0; frame < frames; frame++) {
      const seconds = frame / fps;
      await renderCompositionFrame(canvas, project, layers, seconds, options, images, videos);
      const remaining = ((frame + 1) * 1000 / fps) - (performance.now() - started);
      if (remaining > 0) await new Promise<void>(resolve => window.setTimeout(resolve, remaining));
    }
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
    scheduledAudio.forEach(item => { try { item.source.stop(); } catch { /* already finished */ } item.source.disconnect(); });
    if (audioContext) await audioContext.close().catch(() => undefined);
  }
}

export function downloadExport(result: ExportResult): void {
  const url = URL.createObjectURL(result.blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = result.filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

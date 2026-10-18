import type { Asset, CompositionLayer, DionysusProject } from "./types";

export interface RenderOptions { fps?: number; width?: number; height?: number; duration?: number }
export interface ExportResult { blob: Blob; filename: string; mimeType: string }
export function collectCompositionLayers(project: DionysusProject): CompositionLayer[] {
  return project.shots.flatMap(shot => shot.slots.flatMap(slot => {
    const version = slot.versions.find(item => item.id === slot.selectedVersionId);
    return version ? version.layers.map(layer => ({ ...layer, start: layer.start + slot.start })) : [];
  })).sort((a, b) => a.start - b.start);
}
export function getCompositionDuration(layers: CompositionLayer[]): number {
  return layers.reduce((end, layer) => Math.max(end, layer.start + layer.duration), 0);
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image layer source"));
    image.src = src;
  });
}
function drawFit(ctx: CanvasRenderingContext2D, image: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number, fit: CompositionLayer["fitMode"] = "contain") {
  if (fit === "fill") { ctx.drawImage(image, x, y, w, h); return; }
  const scale = fit === "cover" ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function drawLayer(ctx: CanvasRenderingContext2D, layer: CompositionLayer, asset: Asset | undefined, time: number, width: number, height: number, images: Map<string, HTMLImageElement>) {
  if (time < layer.start || time >= layer.start + layer.duration || layer.kind === "audio" || layer.kind === "script") return;
  const x = (layer.x ?? 0) * width, y = (layer.y ?? 0) * height;
  const w = (layer.width ?? 1) * width, h = (layer.height ?? 1) * height;
  const scale = layer.scale ?? 1, opacity = Math.max(0, Math.min(1, layer.opacity ?? 1));
  const local = time - layer.start;
  ctx.save(); ctx.globalAlpha *= opacity;
  if (layer.animation === "float") ctx.translate(0, Math.sin(local * 2 * Math.PI / Math.max(.1, layer.animationDuration ?? 2)) * height * .015);
  if (layer.animation === "pulse") { const pulse = 1 + .04 * Math.sin(local * 2 * Math.PI / Math.max(.1, layer.animationDuration ?? 2)); ctx.translate(x + w/2, y + h/2); ctx.scale(pulse, pulse); ctx.translate(-(x + w/2), -(y + h/2)); }
  if (layer.animation === "rotate") { ctx.translate(x+w/2,y+h/2); ctx.rotate(local * 2 * Math.PI / Math.max(.1, layer.animationDuration ?? 3)); ctx.translate(-(x+w/2),-(y+h/2)); }
  ctx.translate(x + w/2, y + h/2); ctx.scale(scale, scale); ctx.translate(-(x + w/2), -(y + h/2));
  if (layer.backgroundColor) { ctx.fillStyle = layer.backgroundColor; ctx.fillRect(x,y,w,h); }
  if (layer.shape === "circle" || layer.shape === "rounded") {
    ctx.beginPath();
    if (layer.shape === "circle") ctx.ellipse(x+w/2,y+h/2,Math.min(w,h)/2,Math.min(w,h)/2,0,0,Math.PI*2);
    else ctx.roundRect(x,y,w,h,layer.cornerRadius ?? 12);
    ctx.clip();
  }
  if (asset?.path && asset.kind === "image") {
    const image = images.get(asset.id);
    if (image) drawFit(ctx,image,image.naturalWidth,image.naturalHeight,x,y,w,h,layer.fitMode);
  } else if (layer.kind === "text" || layer.kind === "composition") {
    ctx.fillStyle = layer.backgroundColor ?? "rgba(8,12,20,.75)"; ctx.fillRect(x,y,w,h);
    ctx.fillStyle = "#fff"; ctx.font = `600 ${Math.max(16, Math.round(height * .04))}px system-ui`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(layer.name,x+w/2,y+h/2,Math.max(0,w-24));
  }
  if (layer.borderColor && (layer.borderWidth ?? 0) > 0) { ctx.strokeStyle=layer.borderColor; ctx.lineWidth=layer.borderWidth!; ctx.strokeRect(x,y,w,h); }
  ctx.restore();
}
export async function renderCompositionFrame(canvas: HTMLCanvasElement, project: DionysusProject, layers: CompositionLayer[], seconds: number, options: RenderOptions = {}, images = new Map<string, HTMLImageElement>()): Promise<void> {
  const width=options.width ?? project.width, height=options.height ?? project.height;
  canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D rendering is unavailable");
  ctx.fillStyle="#000"; ctx.fillRect(0,0,width,height);
  for (const layer of layers) {
    const asset=project.assets.find(item=>item.id===layer.assetId);
    if (asset?.kind==="image" && asset.path && !images.has(asset.id)) images.set(asset.id,await loadImage(asset.path));
    drawLayer(ctx,layer,asset,seconds,width,height,images);
  }
}
export async function exportCompositionWebM(project: DionysusProject, options: RenderOptions = {}): Promise<ExportResult> {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") throw new Error("WebM export requires a browser with MediaRecorder and canvas captureStream support");
  const layers=collectCompositionLayers(project), fps=options.fps ?? project.frameRate ?? 30;
  const duration=options.duration ?? getCompositionDuration(layers);
  if (!layers.length || duration <= 0) throw new Error("Add at least one visible composition layer before exporting");
  const canvas=document.createElement("canvas"), stream=canvas.captureStream(fps);
  const mimeType=["video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"].find(type=>MediaRecorder.isTypeSupported(type));
  if (!mimeType) { stream.getTracks().forEach(track=>track.stop()); throw new Error("This browser does not support a compatible WebM encoder"); }
  const recorder=new MediaRecorder(stream,{mimeType}), chunks:BlobPart[]=[];
  const finished=new Promise<Blob>((resolve,reject)=>{ recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)}; recorder.onerror=()=>reject(new Error("WebM recording failed")); recorder.onstop=()=>resolve(new Blob(chunks,{type:mimeType})); });
  const images=new Map<string,HTMLImageElement>();
  try {
    recorder.start();
    const frames=Math.ceil(duration*fps);
    for(let frame=0;frame<frames;frame++){
      await renderCompositionFrame(canvas,project,layers,frame/fps,options,images);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    }
    recorder.stop();
    return {blob:await finished,filename:project.name.trim().replace(/[^a-z0-9-_]+/gi,"-")+".webm",mimeType};
  } catch(error) {
    if(recorder.state!=="inactive")recorder.stop();
    throw error;
  } finally { stream.getTracks().forEach(track=>track.stop()); }
}
export function downloadExport(result: ExportResult): void {
  const url=URL.createObjectURL(result.blob), anchor=document.createElement("a");
  anchor.href=url; anchor.download=result.filename; anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

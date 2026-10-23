/**
 * Preview player: canvas compositor + media element pool, driven by a wall clock.
 * Video/audio elements are slaved to the timeline time with drift correction.
 */
import { activeAt, fitRect } from "./frame";
import { TICKS_PER_SECOND, ticksToSeconds } from "../domain/time";
import { compositionDuration, versionOf, type Project } from "../domain/model";
import type { BlobStore } from "../ports/storage";

type MediaEl = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

export class Player {
  private urls = new Map<string, Promise<string | undefined>>();
  private resolvedUrls = new Map<string, string>();
  private pool = new Map<string, MediaEl>();
  private raf = 0;
  private playing = false;
  private startWall = 0;
  private startTicks = 0;
  time = 0;
  project: Project;
  canvas?: HTMLCanvasElement;
  onTime?: (t: number, playing: boolean) => void;

  constructor(project: Project, private blobs: BlobStore) { this.project = project; }

  setProject(p: Project) { this.project = p; this.draw(); }
  get isPlaying() { return this.playing; }

  private url(blobKey: string): string | undefined {
    const hit = this.resolvedUrls.get(blobKey);
    if (hit) return hit;
    if (!this.urls.has(blobKey)) {
      this.urls.set(blobKey, this.blobs.get(blobKey).then((b) => {
        if (!b) return undefined;
        const u = URL.createObjectURL(b);
        this.resolvedUrls.set(blobKey, u);
        this.draw();
        return u;
      }));
    }
    return undefined;
  }

  private element(placementId: string, kind: string, src: string): MediaEl {
    let el = this.pool.get(placementId);
    if (el && (el as HTMLMediaElement).src !== src && (el as HTMLImageElement).src !== src) { this.release(placementId); el = undefined; }
    if (!el) {
      if (kind === "image") { el = new Image(); el.src = src; el.onload = () => this.draw(); }
      else {
        const m = document.createElement(kind === "video" ? "video" : "audio");
        m.preload = "auto"; m.src = src; (m as HTMLVideoElement).playsInline = true; m.crossOrigin = "anonymous";
        m.onseeked = () => !this.playing && this.draw();
        m.onloadeddata = () => this.draw();
        el = m;
      }
      this.pool.set(placementId, el);
    }
    return el;
  }

  private release(id: string) {
    const el = this.pool.get(id);
    if (el && "pause" in el) { el.pause(); el.removeAttribute("src"); el.load(); }
    this.pool.delete(id);
  }

  duration() { return compositionDuration(this.project.compositions[this.project.rootCompositionId]); }

  play() {
    if (this.playing) return;
    if (this.time >= this.duration()) this.time = 0;
    this.playing = true; this.startWall = performance.now(); this.startTicks = this.time;
    const loop = () => {
      if (!this.playing) return;
      this.time = this.startTicks + ((performance.now() - this.startWall) / 1000) * TICKS_PER_SECOND;
      if (this.time >= this.duration()) { this.time = this.duration(); this.pause(); }
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.onTime?.(this.time, true);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.pool.forEach((el) => "pause" in el && el.pause());
    this.onTime?.(this.time, false);
    this.draw();
  }

  seek(t: number) {
    this.time = Math.max(0, t);
    if (this.playing) { this.startWall = performance.now(); this.startTicks = this.time; }
    this.draw();
  }

  /** Render current frame and sync media elements. */
  draw() {
    const comp = this.project.compositions[this.project.rootCompositionId];
    const layers = activeAt(comp, this.time);
    const live = new Set<string>();
    const canvas = this.canvas;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    for (const { track, placement, sourceTicks } of layers) {
      const version = versionOf(this.project, placement.source);
      if (!version || track.hidden) continue;
      const src = this.url(version.media.blobKey);
      if (!src) continue;
      live.add(placement.id);
      const el = this.element(placement.id, placement.clipType, src);
      if ("pause" in el) {
        const target = ticksToSeconds(sourceTicks);
        el.muted = !!track.muted;
        el.volume = Math.min(1, Math.max(0, placement.volume ?? 1));
        if (this.playing) {
          if (el.paused) { el.currentTime = target; void el.play().catch(() => undefined); }
          else if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target;
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
        }
      }
      if (ctx && canvas && placement.clipType !== "audio") {
        const w = el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLImageElement).naturalWidth;
        const h = el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight;
        if (w && h && (!(el instanceof HTMLVideoElement) || el.readyState >= 2)) {
          const r = fitRect(w, h, canvas.width, canvas.height);
          ctx.drawImage(el as CanvasImageSource, r.x, r.y, r.w, r.h);
        }
      }
    }
    for (const [id, el] of this.pool) if (!live.has(id) && "pause" in el && !el.paused) el.pause();
    for (const id of [...this.pool.keys()]) if (!findAny(this.project, id)) this.release(id);
    this.onTime?.(this.time, this.playing);
  }

  dispose() {
    this.pause();
    for (const id of [...this.pool.keys()]) this.release(id);
    this.resolvedUrls.forEach((u) => URL.revokeObjectURL(u));
  }
}

function findAny(p: Project, placementId: string) {
  return p.compositions[p.rootCompositionId].tracks.some((t) => t.placements.some((pl) => pl.id === placementId));
}

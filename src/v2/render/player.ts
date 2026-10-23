/**
 * Preview player: canvas compositor + media element pool, driven by a master Clock (AudioContext by default).
 * Video/audio elements are slaved to the timeline time with drift correction; audio is routed through a
 * per-element GainNode when an AudioContext is available.
 */
import { activeAt, placeRect, type Placed } from "./frame";
import { TICKS_PER_SECOND, ticksToSeconds } from "../domain/time";
import { compositionDuration, versionOf, type Project } from "../domain/model";
import type { BlobStore } from "../ports/storage";
import { correctDrift, createClock, type Clock } from "./clock";

type MediaEl = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

export class Player {
  private urls = new Map<string, Promise<string | undefined>>();
  private resolvedUrls = new Map<string, string>();
  private pool = new Map<string, MediaEl>();
  private raf = 0;
  private playing = false;
  private startClock = 0;
  private clock: Clock;
  private audioCtx?: AudioContext;
  private gains = new Map<HTMLMediaElement, GainNode>();
  private startTicks = 0;
  time = 0;
  /** Canvas-space placement of each visual clip in the last drawn frame (for on-canvas handles). */
  boxes = new Map<string, Placed>();
  project: Project;
  canvas?: HTMLCanvasElement;
  onTime?: (t: number, playing: boolean) => void;

  constructor(project: Project, private blobs: BlobStore, clock?: Clock) {
    this.project = project;
    if (clock) this.clock = clock;
    else { const c = createClock(); this.clock = c.clock; this.audioCtx = c.ctx; }
  }
  get clockKind() { return this.clock.kind; }

  /** Route a media element through Web Audio (once). Volume then lives on the GainNode. */
  private gainFor(el: HTMLMediaElement): GainNode | undefined {
    if (!this.audioCtx) return undefined;
    let g = this.gains.get(el);
    if (!g) {
      try { g = this.audioCtx.createGain(); this.audioCtx.createMediaElementSource(el).connect(g).connect(this.audioCtx.destination); this.gains.set(el, g); }
      catch { return undefined; }
    }
    return g;
  }

  setProject(p: Project) {
    this.project = p;
    // Revoke object URLs whose asset version is gone (asset removed or version dropped).
    const live = new Set(Object.values(p.assets).flatMap((a) => a.versions.map((v) => v.media.blobKey)));
    for (const key of [...this.urls.keys()]) {
      if (live.has(key)) continue;
      const u = this.resolvedUrls.get(key);
      if (u) URL.revokeObjectURL(u);
      this.resolvedUrls.delete(key);
      this.urls.delete(key);
    }
    this.draw();
  }
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
    if (el && "pause" in el) { el.pause(); el.removeAttribute("src"); el.load(); this.gains.get(el)?.disconnect(); this.gains.delete(el); }
    this.pool.delete(id);
  }

  duration() { return compositionDuration(this.project.compositions[this.project.rootCompositionId]); }

  play() {
    if (this.playing) return;
    if (this.time >= this.duration()) this.time = 0;
    this.clock.start?.();
    this.playing = true; this.startClock = this.clock.now(); this.startTicks = this.time;
    const loop = () => {
      if (!this.playing) return;
      this.tick();
      if (this.playing) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.onTime?.(this.time, true);
  }

  /** Advance time from the master clock and render (one animation frame). */
  tick() {
    if (!this.playing) return;
    this.time = Math.round(this.startTicks + (this.clock.now() - this.startClock) * TICKS_PER_SECOND);
    if (this.time >= this.duration()) { this.time = this.duration(); this.pause(); return; }
    this.draw();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.pool.forEach((el) => "pause" in el && el.pause());
    this.onTime?.(this.time, false);
    this.draw();
  }

  seek(t: number) {
    this.time = Math.max(0, Math.round(t));
    if (this.playing) { this.startClock = this.clock.now(); this.startTicks = this.time; }
    this.draw();
  }

  /** Render current frame and sync media elements. */
  draw() {
    const comp = this.project.compositions[this.project.rootCompositionId];
    const layers = activeAt(comp, this.time);
    const live = new Set<string>();
    this.boxes = new Map();
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
        el.muted = !!track.muted || (placement.clipType === "video" && !!placement.linkedAudio?.muted);
        const vol = Math.max(0, placement.volume ?? 1);
        const gain = this.gainFor(el);
        if (gain) { gain.gain.value = vol; el.volume = 1; } else el.volume = Math.min(1, vol);
        if (this.playing) {
          if (el.paused) { el.currentTime = target; el.playbackRate = 1; void el.play().catch(() => undefined); }
          else {
            const fix = correctDrift(el.currentTime, target);
            if (fix.seek !== undefined) el.currentTime = fix.seek;
            if (el.playbackRate !== fix.rate) el.playbackRate = fix.rate;
          }
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
        }
      }
      if (ctx && canvas && placement.clipType !== "audio") {
        const w = el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLImageElement).naturalWidth;
        const h = el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight;
        if (w && h && (!(el instanceof HTMLVideoElement) || el.readyState >= 2)) {
          const r = placeRect(placement, w, h, canvas.width, canvas.height);
          this.boxes.set(placement.id, r);
          ctx.save(); ctx.globalAlpha = r.alpha; ctx.translate(r.cx, r.cy); ctx.rotate(r.rot);
          ctx.drawImage(el as CanvasImageSource, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h);
          ctx.restore();
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
    void this.audioCtx?.close().catch(() => undefined);
  }
}

function findAny(p: Project, placementId: string) {
  return p.compositions[p.rootCompositionId].tracks.some((t) => t.placements.some((pl) => pl.id === placementId));
}

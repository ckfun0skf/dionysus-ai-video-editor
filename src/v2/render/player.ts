/**
 * Preview player: canvas compositor + media element pool, driven by a master Clock (AudioContext by default).
 * Video/audio elements are slaved to the timeline time with drift correction; audio is routed through a
 * per-element GainNode when an AudioContext is available.
 */
import { activeAt, placeRect, type Placed } from "./frame";
import { TICKS_PER_SECOND, ticksToSeconds } from "../domain/time";
import { compositionDuration, fadeAt, versionOf, type Project } from "../domain/model";
import type { BlobStore } from "../ports/storage";
import { subtitleAt } from "../domain/subtitles";
import { correctDrift, createClock, type Clock } from "./clock";
import { HtmlClipHost } from "./htmlClip";

type MediaEl = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

export class Player {
  private urls = new Map<string, Promise<string | undefined>>();
  private resolvedUrls = new Map<string, string>();
  private pool = new Map<string, MediaEl>();
  private html = new Map<string, { key: string; host: HtmlClipHost }>();
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

  /** Sandboxed iframe for an HTML clip, sized to the output canvas so the page renders at full resolution. */
  private htmlHost(placementId: string, blobKey: string, w: number, h: number): HtmlClipHost {
    const key = `${blobKey}@${w}x${h}`;
    const hit = this.html.get(placementId);
    if (hit?.key === key) return hit.host;
    hit?.host.dispose();
    const host = new HtmlClipHost(this.blobs.get(blobKey).then((b) => b?.text()), w, h, () => { if (!this.playing) this.draw(); });
    this.html.set(placementId, { key, host });
    return host;
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
    for (const { track, placement, sourceTicks, mix } of layers) {
      const version = versionOf(this.project, placement.source);
      if (!version || track.hidden) continue;
      if (placement.clipType === "html") {
        live.add(placement.id);
        const host = this.htmlHost(placement.id, version.media.blobKey, canvas?.width ?? 1280, canvas?.height ?? 720);
        host.request(Math.round(ticksToSeconds(sourceTicks) * 1000) / 1000);
        const f = host.frame;
        if (ctx && canvas && f) {
          const r = placeRect(placement, f.width, f.height, canvas.width, canvas.height, this.time);
          this.boxes.set(placement.id, r);
          ctx.save(); ctx.globalAlpha = r.alpha * (mix ?? 1); ctx.translate(r.cx, r.cy); ctx.rotate(r.rot);
          ctx.drawImage(f, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h);
          ctx.restore();
        }
        continue;
      }
      const src = this.url(version.media.blobKey);
      if (!src) continue;
      live.add(placement.id);
      const el = this.element(placement.id, placement.clipType, src);
      if ("pause" in el) {
        const target = ticksToSeconds(sourceTicks);
        el.muted = !!track.muted || (placement.clipType === "video" && !!placement.linkedAudio?.muted);
        const vol = Math.max(0, placement.volume ?? 1) * fadeAt(placement, this.time);
        const gain = this.gainFor(el);
        if (gain) { gain.gain.value = vol; el.volume = 1; } else el.volume = Math.min(1, vol);
        // Reverse and freeze cannot use native playback: hold the element paused and seek it per frame.
        const held = this.time < placement.startTicks || this.time >= placement.startTicks + placement.durationTicks; // transition overhang
        const scrub = !!placement.reverse || !!placement.freeze || held;
        if (scrub) el.muted = true;
        const speed = placement.speed ?? 1;
        if (this.playing && scrub) {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target;
        } else if (this.playing) {
          if (el.paused) { el.currentTime = target; el.playbackRate = speed; void el.play().catch(() => undefined); }
          else {
            const fix = correctDrift(el.currentTime, target);
            if (fix.seek !== undefined) el.currentTime = fix.seek;
            if (el.playbackRate !== fix.rate * speed) el.playbackRate = fix.rate * speed;
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
          const r = placeRect(placement, w, h, canvas.width, canvas.height, this.time);
          this.boxes.set(placement.id, r);
          ctx.save(); ctx.globalAlpha = r.alpha * (mix ?? 1); ctx.translate(r.cx, r.cy); ctx.rotate(r.rot);
          ctx.drawImage(el as CanvasImageSource, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h);
          ctx.restore();
        }
      }
    }
    const cue = subtitleAt(comp, this.time);
    if (ctx && canvas && cue) drawSubtitle(ctx, canvas.width, canvas.height, cue.text);
    for (const [id, el] of this.pool) if (!live.has(id) && "pause" in el && !el.paused) el.pause();
    for (const id of [...this.pool.keys()]) if (!findAny(this.project, id)) this.release(id);
    for (const [id, h] of this.html) if (!findAny(this.project, id)) { h.host.dispose(); this.html.delete(id); }
    this.onTime?.(this.time, this.playing);
  }

  /** Offline rendering (export): draw time `t` once every source is decoded and seeked. */
  async renderAt(t: number) {
    this.time = Math.max(0, Math.round(t));
    for (let pass = 0; pass < 3; pass++) {
      this.draw();
      await Promise.all(this.urls.values());
      await Promise.all([...this.pool.values()].map(settle));
      await Promise.all([...this.html.values()].map((h) => h.host.settle()));
    }
    this.draw();
  }

  dispose() {
    this.pause();
    for (const id of [...this.pool.keys()]) this.release(id);
    this.html.forEach((h) => h.host.dispose()); this.html.clear();
    this.resolvedUrls.forEach((u) => URL.revokeObjectURL(u));
    void this.audioCtx?.close().catch(() => undefined);
  }
}

/** Resolves when a media element can show its current frame (or after a timeout, so export never hangs). */
function settle(el: MediaEl, ms = 4000): Promise<void> {
  const ready = () => (el instanceof HTMLImageElement ? el.complete : el instanceof HTMLVideoElement ? !el.seeking && el.readyState >= 2 : true);
  if (ready() || !el.getAttribute("src")) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { clearTimeout(to); ["seeked", "loadeddata", "load", "error"].forEach((e) => el.removeEventListener(e, check)); res(); };
    const check = () => ready() && done();
    const to = setTimeout(done, ms);
    ["seeked", "loadeddata", "load", "error"].forEach((e) => el.addEventListener(e, check));
  });
}

function findAny(p: Project, placementId: string) {
  return p.compositions[p.rootCompositionId].tracks.some((t) => t.placements.some((pl) => pl.id === placementId));
}

/** Subtitle style: white, dark outline, bottom-centred, wraps to 80% width. */
export function drawSubtitle(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  const size = Math.round(h * 0.055);
  ctx.save();
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.lineJoin = "round";
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > w * 0.8 && line) { lines.push(line); line = word; } else line = t;
    }
    lines.push(line);
  }
  lines.forEach((l, i) => {
    const y = h * 0.92 - (lines.length - 1 - i) * size * 1.25;
    ctx.lineWidth = size * 0.18; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.strokeText(l, w / 2, y);
    ctx.fillStyle = "#fff"; ctx.fillText(l, w / 2, y);
  });
  ctx.restore();
}

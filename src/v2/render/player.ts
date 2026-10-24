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
import { drawTextClip } from "./text";
import { effectivePlacement } from "../domain/layerStyle";
import { applyEffectFrame, effectFrameAt } from "./effects";
import { mainTrack } from "../domain/ops";
import { correctDrift, createClock, type Clock } from "./clock";
import { HtmlClipHost, isValidFrame, type FrameIssue } from "./htmlClip";
import type { ExportVideoFrames } from "./export/videoFrames";
import { drawWithLook } from "./transitionDraw";

type MediaEl = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
/** Frame problems found while rendering offline: HTML clip timeouts/invalid frames, video frames with no picture. */
export type RenderIssue = FrameIssue | "blank";
type RVFCVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (id: number) => void };

export class Player {
  private urls = new Map<string, Promise<string | undefined>>();
  private resolvedUrls = new Map<string, string>();
  private pool = new Map<string, MediaEl>();
  /** HTML clip frames that timed out or were rejected during renderAt (export reports these). */
  frameIssues: { placementId: string; t: number; issue: RenderIssue }[] = [];
  /**
   * Export mode. Video clips are decoded frame-accurately with WebCodecs (`exportVideo`); clips it can't handle
   * fall back to media elements kept in the DOM (Android/iOS don't decode frames for detached, never-played
   * elements), awaited per frame with requestVideoFrameCallback and checked for an actual picture.
   */
  offline = false;
  exportVideo?: ExportVideoFrames;
  /** Per video placement in export: frames rendered, frames with no picture, first failure time, last error. */
  videoStats = new Map<string, { frames: number; blank: number; first?: number; detail?: string }>();
  private host?: HTMLDivElement;
  private pendingFrame = new Map<HTMLVideoElement, Promise<void>>();
  private probe?: CanvasRenderingContext2D | null;
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
        if (this.offline && kind === "video") {
          m.muted = true;
          this.host ??= Object.assign(document.createElement("div"), { ariaHidden: "true" });
          // In the viewport and (almost) transparent, never display:none, so mobile browsers keep decoding it.
          this.host.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1";
          if (!this.host.isConnected) document.body.appendChild(this.host);
          m.style.cssText = "width:2px;height:2px";
          this.host.appendChild(m);
        }
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
    if (el && "pause" in el) { el.pause(); el.removeAttribute("src"); el.load(); el.remove(); this.gains.get(el)?.disconnect(); this.gains.delete(el); }
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
    if (canvas && ctx) { ctx.fillStyle = this.project.settings.background ?? "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    // V2-101: effect layers modify only the main-track render; applied once main is drawn, before overlays/text.
    const fx = effectFrameAt(comp, this.time);
    const mainId = mainTrack(comp)?.id;
    let fxDone = !fx;
    const applyFx = () => { fxDone = true; if (fx && ctx && canvas) applyEffectFrame(ctx, canvas.width, canvas.height, fx); };
    for (const { track, placement: raw, sourceTicks, mix, tfx } of layers) {
      if (raw.clipType === "effect") continue;
      // V2-103: text clips render with their layer style merged under their own overrides (preview and export alike).
      const placement = effectivePlacement(track, raw);
      if (!fxDone && track.id !== mainId && track.kind !== "audio") applyFx();
      if (placement.clipType === "text") {
        if (ctx && canvas && !track.hidden) this.boxes.set(placement.id, drawTextClip(ctx, placement, canvas.width, canvas.height, this.time, mix ?? 1));
        continue;
      }
      const version = versionOf(this.project, placement.source);
      if (!version || track.hidden) continue;
      if (placement.clipType === "html") {
        live.add(placement.id);
        const host = this.htmlHost(placement.id, version.media.blobKey, canvas?.width ?? 1280, canvas?.height ?? 720);
        host.request(Math.round(ticksToSeconds(sourceTicks) * 1000) / 1000);
        const f = host.frame;
        if (ctx && canvas && isValidFrame(f)) {
          const r = placeRect(placement, f.width, f.height, canvas.width, canvas.height, this.time);
          this.boxes.set(placement.id, r);
          try { // a detached/closed bitmap must not throw out of draw() and stall preview or export
            drawWithLook(ctx, canvas.width, canvas.height, tfx, (g) => {
              g.save();
              try { g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot); g.drawImage(f, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h); } finally { g.restore(); }
            });
          } catch { host.issue = "invalid"; }
        }
        continue;
      }
      if (placement.clipType === "video" && this.exportVideo?.handles(placement.id)) {
        live.add(placement.id);
        const f = this.exportVideo.frame(placement.id)!;
        if (ctx && canvas) {
          const r = placeRect(placement, f.width, f.height, canvas.width, canvas.height, this.time);
          this.boxes.set(placement.id, r);
          drawWithLook(ctx, canvas.width, canvas.height, tfx, (g) => {
            g.save(); g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
            g.drawImage(f.image, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h);
            g.restore();
          });
        }
        continue;
      }
      const src = this.url(version.media.blobKey);
      if (!src) continue;
      live.add(placement.id);
      const el = this.element(placement.id, placement.clipType, src);
      if ("pause" in el) {
        const target = ticksToSeconds(sourceTicks);
        el.muted = !!track.muted || !!track.hidden || (placement.clipType === "video" && !!placement.linkedAudio?.muted);
        const vol = Math.max(0, placement.volume ?? 1) * fadeAt(placement, this.time);
        const gain = this.gainFor(el);
        if (gain) { gain.gain.value = vol; el.volume = 1; } else el.volume = Math.min(1, vol);
        // Reverse and freeze cannot use native playback: hold the element paused and seek it per frame.
        const held = this.time < placement.startTicks || this.time >= placement.startTicks + placement.durationTicks; // transition overhang
        const scrub = !!placement.reverse || !!placement.freeze || held;
        if (scrub || this.offline) el.muted = true;
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
          if (this.offline && el instanceof HTMLVideoElement) {
            // Export: every output frame needs its own exact source frame. Nudge 2 ms past the frame
            // boundary so float rounding cannot land on the previous frame, and never skip a seek.
            const exact = target + 0.002;
            if (Math.abs(el.currentTime - exact) > 0.0005) { this.armFrame(el); el.currentTime = exact; }
          } else if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
        }
      }
      if (ctx && canvas && placement.clipType !== "audio") {
        const w = el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLImageElement).naturalWidth;
        const h = el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight;
        if (w && h && (!(el instanceof HTMLVideoElement) || el.readyState >= 2)) {
          const r = placeRect(placement, w, h, canvas.width, canvas.height, this.time);
          this.boxes.set(placement.id, r);
          drawWithLook(ctx, canvas.width, canvas.height, tfx, (g) => {
            g.save(); g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
            g.drawImage(el as CanvasImageSource, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h);
            g.restore();
          });
        }
      }
    }
    if (!fxDone) applyFx();
    const cue = subtitleAt(comp, this.time);
    if (ctx && canvas && cue) drawSubtitle(ctx, canvas.width, canvas.height, cue.text);
    for (const [id, el] of this.pool) if (!live.has(id) && "pause" in el && !el.paused) el.pause();
    for (const id of [...this.pool.keys()]) if (!findAny(this.project, id)) this.release(id);
    for (const [id, h] of this.html) if (!findAny(this.project, id)) { h.host.dispose(); this.html.delete(id); }
    this.onTime?.(this.time, this.playing);
  }

  /** Resolve once the element presents a new frame after the seek that follows (or after `ms`). */
  private armFrame(el: RVFCVideo, ms = 1500) {
    if (!el.requestVideoFrameCallback) return;
    this.pendingFrame.set(el, new Promise<void>((res) => {
      const id = el.requestVideoFrameCallback!(() => { clearTimeout(to); res(); });
      const to = setTimeout(() => { el.cancelVideoFrameCallback?.(id); res(); }, ms);
    }).finally(() => this.pendingFrame.delete(el)));
  }

  private async settleAll() {
    await Promise.all(this.urls.values());
    await Promise.all([...this.pool.values()].map((el) => settle(el)));
    await Promise.all([...this.pendingFrame.values()]);
    await Promise.all([...this.html.values()].map((h) => h.host.settle()));
  }

  /** True when the element has a decoded picture the canvas can draw (a transparent probe means it has none). */
  private hasPicture(el: HTMLVideoElement): boolean {
    if (el.readyState < 2 || !el.videoWidth || !el.videoHeight) return false;
    if (this.probe === undefined) { const c = document.createElement("canvas"); c.width = c.height = 4; this.probe = c.getContext("2d", { willReadFrequently: true }); }
    const g = this.probe;
    if (!g) return true;
    try {
      g.clearRect(0, 0, 4, 4); g.drawImage(el, 0, 0, 4, 4);
      const d = g.getImageData(0, 0, 4, 4).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    } catch { return false; }
  }

  /** Offline rendering (export): draw time `t` once every source is decoded and seeked. */
  async renderAt(t: number) {
    this.time = Math.max(0, Math.round(t));
    const comp = this.project.compositions[this.project.rootCompositionId];
    const layers = activeAt(comp, this.time);
    const videos = layers.filter((l) => l.placement.clipType === "video");
    if (this.exportVideo) {
      const on = new Set<string>();
      for (const l of videos) {
        const v = versionOf(this.project, l.placement.source);
        if (!v) continue;
        on.add(l.placement.id);
        await this.exportVideo.prepare(l.placement.id, v.media.blobKey, ticksToSeconds(l.sourceTicks));
      }
      this.exportVideo.retain(on);
    }
    for (let pass = 0; pass < 3; pass++) { this.draw(); await this.settleAll(); }
    this.draw();
    if (this.offline) await this.verifyVideo(videos);
    const live = new Set(layers.map((l) => l.placement.id));
    for (const [id, h] of this.html) {
      if (!live.has(id)) continue;
      const issue: FrameIssue | undefined = !h.host.settled() ? "timeout" : h.host.issue;
      if (issue) this.frameIssues.push({ placementId: id, t: this.time, issue });
    }
  }

  /** Element-path video clips: make sure each drew a real picture; nudge (muted play/pause + reseek) once, then record. */
  private async verifyVideo(videos: ReturnType<typeof activeAt>) {
    let redraw = false;
    const bad: string[] = [];
    for (const { placement: p, sourceTicks } of videos) {
      if (this.exportVideo?.handles(p.id) || !versionOf(this.project, p.source)) continue;
      const st = this.videoStats.get(p.id) ?? { frames: 0, blank: 0 };
      this.videoStats.set(p.id, st);
      st.frames += 1;
      const el = this.pool.get(p.id);
      if (el instanceof HTMLVideoElement && this.hasPicture(el)) continue;
      if (el instanceof HTMLVideoElement && !el.error) {
        try { el.muted = true; await el.play(); } catch { /* autoplay refused: the seek below may still decode */ }
        el.pause();
        this.armFrame(el); el.currentTime = ticksToSeconds(sourceTicks) + 0.002;
        await this.settleAll();
        redraw = true;
        if (this.hasPicture(el)) continue;
      }
      bad.push(p.id);
      st.blank += 1; st.first ??= this.time;
      const err = el instanceof HTMLVideoElement ? el.error : undefined;
      if (!el) st.detail = "the media file could not be loaded";
      else if (err) st.detail = `the browser can't play it (${err.message || `media error ${err.code}`})`;
      else st.detail ??= "the browser returned no picture for it";
    }
    if (redraw) this.draw();
    for (const id of bad) this.frameIssues.push({ placementId: id, t: this.time, issue: "blank" });
  }

  dispose() {
    this.pause();
    for (const id of [...this.pool.keys()]) this.release(id);
    this.html.forEach((h) => h.host.dispose()); this.html.clear();
    this.resolvedUrls.forEach((u) => URL.revokeObjectURL(u));
    this.exportVideo?.dispose();
    this.host?.remove();
    void this.audioCtx?.close().catch(() => undefined);
  }
}

/** Resolves when a media element can show its current frame (or after a timeout, so export never hangs). */
function settle(el: MediaEl, ms = 4000): Promise<void> {
  // An element that failed to load won't recover: don't wait out the timeout (export reports it instead).
  const ready = () => (el instanceof HTMLImageElement ? el.complete : el instanceof HTMLVideoElement ? !!el.error || (!el.seeking && el.readyState >= 2) : true);
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

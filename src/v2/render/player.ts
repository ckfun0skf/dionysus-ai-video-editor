/**
 * Preview player: canvas compositor + media element pool, driven by a master Clock (AudioContext by default).
 * Video/audio elements are slaved to the timeline time with drift correction; audio is routed through a
 * per-element GainNode when an AudioContext is available.
 */
import { activeAt, placeRect, upcomingMedia, type Placed } from "./frame";
import { TICKS_PER_SECOND, ticksToSeconds } from "../domain/time";
import { drawKeyed } from "./chromaKey";
import { audioFxData, buildFxChain, fxKey, type FxChain } from "./audioFx";
import { buildSpatial, type SpatialStage } from "./spatial";
import { audioOutputOf, spatialAt, spatialOf, type AudioEnvironment, type AudioOutputMode } from "../domain/spatial";
import { compositionDuration, fadeAt, volumeKeyAt, versionOf, type Placement, type Project } from "../domain/model";
import type { BlobStore } from "../ports/storage";
import { subtitleAt } from "../domain/subtitles";
import { loadBundledFonts } from "./fonts";
import { drawTextClip } from "./text";
import { effectivePlacement } from "../domain/layerStyle";
import { applyEffectFrame, effectFrameAt } from "./effects";
import { mainTrack } from "../domain/ops";
import { correctDrift, createClock, SEEK_DRIFT_S, type Clock } from "./clock";
import { HtmlClipHost, isValidFrame, type FrameIssue, type HtmlClipInit } from "./htmlClip";
import { bindingSignature, resolveClipBindings } from "../domain/htmlClipBindings";
import { readManifest, resolveHtmlParams, type HtmlClipManifest } from "../domain/htmlClipPackage";
import type { ExportVideoFrames } from "./export/videoFrames";
import { drawWithLook } from "./transitionDraw";
import { withBlend } from "./blend";
import { BufferGate, clipLoadOf, idleCap, idleEvictions, loadSignature, mediaStalled, type ClipLoad } from "./stability";

/** P1-SHORT-AUDIO: how far ahead of the playhead the player loads audio and video clips (2 s). */
const PRELOAD_TICKS = 2 * TICKS_PER_SECOND;

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
  /** Manifest per HTML blob, read when its clip first loads (blobs are immutable). */
  private manifests = new Map<string, HtmlClipManifest>();
  /** Latest per-use param overrides by html placement id (V2-HTML-PARAMS), read when a clip's page initialises. */
  private htmlOverrides = new Map<string, Placement["htmlParams"]>();
  private raf = 0;
  private playing = false;
  /** P27-PREVIEW-STABILITY: playhead hold while a playing source is short of data, idle-element LRU, last good frame. */
  private gate = new BufferGate();
  private stalled = false;
  private lastUsed = new Map<string, number>();
  private useCount = 0;
  private lastGood?: CanvasRenderingContext2D | null;
  /** True while the preview waits for media (shown as a loading badge). */
  loading = false;
  onLoading?: (loading: boolean) => void;
  /** P29-CLIP-LOADING: clips whose media is still loading (on screen or about to start), with buffered progress when known. */
  clipLoads: ReadonlyMap<string, ClipLoad> = new Map();
  onClipLoads?: (loads: ReadonlyMap<string, ClipLoad>) => void;
  private loadSig = "";
  /** P30-STALL-HYSTERESIS: elements currently counted as stalled (they need HAVE_FUTURE_DATA to recover). */
  private stalledEls = new WeakSet<HTMLMediaElement>();
  /** P30-WARM-MEDIA: idle elements kept loaded (6 on phones, 16 on desktops). */
  private idleCap = idleCap();
  /** P30-WARM-MEDIA: a small still of each video clip's first frame, drawn while its element (re)loads. */
  private posters = new Map<string, { img: HTMLCanvasElement; w: number; h: number; at: number }>();
  /** Time to first drawable frame per clip entry (ms), for diagnostics and tests. */
  readonly firstFrameMs: { id: string; ms: number; warm: boolean }[] = [];
  private entered = new Map<string, number>();
  private loadPoll?: ReturnType<typeof setTimeout>;
  private startClock = 0;
  private clock: Clock;
  private audioCtx?: AudioContext;
  private gains = new Map<HTMLMediaElement, GainNode>();
  private fxChains = new Map<HTMLMediaElement, { key: string; chain: FxChain }>();
  /** P14-SPATIAL: per-element position stage, rebuilt when the output mode/environment changes. */
  private spatials = new Map<HTMLMediaElement, { key: string; stage: SpatialStage }>();
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
    // P7-FONTS: redraw once the bundled fonts are ready so the preview swaps the fallback face for the real one.
    void loadBundledFonts().then(() => { if (!this.disposed && !this.offline && this.canvas) this.draw(); });
  }
  private disposed = false;
  get clockKind() { return this.clock.kind; }

  /**
   * P3B-12 eyedropper: while set, this clip is drawn without its chroma key so a colour can be sampled from the
   * preview canvas as the user sees the original picture.
   */
  keyBypass: string | null = null;
  private keyOf(p: Placement) { return p.id === this.keyBypass ? undefined : p.chromaKey; }

  /**
   * Route a media element through Web Audio (once): element → gain (volume × fades × volume curve) → [audio effect
   * chain, P3B-11] → speakers. The chain is rebuilt only when the clip's preset or amount changes.
   */
  private gainFor(el: HTMLMediaElement, fx?: { preset: string; amount: number }, spatialKey = ""): GainNode | undefined {
    if (!this.audioCtx) return undefined;
    let g = this.gains.get(el);
    if (!g) {
      try { g = this.audioCtx.createGain(); this.audioCtx.createMediaElementSource(el).connect(g).connect(this.audioCtx.destination); this.gains.set(el, g); }
      catch { return undefined; }
    }
    const key = fxKey(fx);
    const cur = this.fxChains.get(el), sp = this.spatials.get(el);
    if ((cur?.key ?? "") !== key || (sp?.key ?? "") !== spatialKey) {
      g.disconnect();
      cur?.chain.dispose(); this.fxChains.delete(el);
      sp?.stage.dispose(); this.spatials.delete(el);
      // P14-SPATIAL: the position stage sits last, as in export.
      let dest: AudioNode = this.audioCtx.destination;
      if (spatialKey) {
        const [mode, env] = spatialKey.split(":") as [AudioOutputMode, AudioEnvironment];
        const stage = buildSpatial(this.audioCtx, mode, env); stage.output.connect(this.audioCtx.destination);
        this.spatials.set(el, { key: spatialKey, stage }); dest = stage.input;
      }
      const data = key ? audioFxData(fx!.preset) : undefined;
      if (data) {
        const chain = buildFxChain(this.audioCtx, data, fx!.amount, this.audioCtx.currentTime);
        g.connect(chain.input); chain.output.connect(dest);
        this.fxChains.set(el, { key, chain });
      } else g.connect(dest);
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
        // P29-CLIP-LOADING: keep the timeline's per-clip loading state fresh while paused.
        m.oncanplay = m.onerror = () => !this.playing && this.draw();
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
    // Bound assets (V2-HTML-PKG) are part of the key, so selecting another version of a bound asset reloads the clip.
    const known = this.manifests.get(blobKey);
    const sizeKey = `${blobKey}@${w}x${h}`;
    const key = known ? `${sizeKey}|${bindingSignature(resolveClipBindings(this.project, known))}` : undefined;
    const hit = this.html.get(placementId);
    if (hit && (hit.key === key || (!key && hit.key.startsWith(`${sizeKey}|`)))) return hit.host;
    hit?.host.dispose();
    const entry = { key: key ?? `${sizeKey}|?`, host: undefined as unknown as HtmlClipHost };
    entry.host = new HtmlClipHost(this.blobs.get(blobKey).then((b) => b?.text()), w, h, () => { if (!this.playing) this.draw(); }, async (html): Promise<HtmlClipInit> => {
      const m = readManifest(html);
      this.manifests.set(blobKey, m);
      const binds = resolveClipBindings(this.project, m);
      entry.key = `${sizeKey}|${bindingSignature(binds)}`;
      const blobs = await Promise.all(binds.map((b) => this.blobs.get(b.blobKey).catch(() => undefined)));
      const bindings: NonNullable<HtmlClipInit["bindings"]> = {};
      binds.forEach((b, i) => { const blob = blobs[i]; if (blob) bindings[b.name] = { type: b.type, blob }; });
      // V2-HTML-PARAMS: the clip's per-use values (defaults ⊕ this placement's overrides) from the first frame on.
      return { width: w, height: h, bindings, params: resolveHtmlParams(m.params, this.htmlOverrides.get(placementId)) };
    });
    this.html.set(placementId, entry);
    return entry.host;
  }

  private release(id: string) {
    const el = this.pool.get(id);
    if (el && "pause" in el) { el.pause(); el.removeAttribute("src"); el.load(); el.remove(); this.gains.get(el)?.disconnect(); this.gains.delete(el); this.fxChains.get(el)?.chain.dispose(); this.fxChains.delete(el); this.spatials.get(el)?.stage.dispose(); this.spatials.delete(el); }
    this.pool.delete(id);
    this.lastUsed.delete(id);
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
    const now = this.clock.now();
    if (!this.offline && this.gate.update(now * 1000, this.stalled)) {
      // Hold the playhead until the media catches up; restart the clock from here afterwards.
      this.startClock = now; this.startTicks = this.time;
      this.draw();
      return;
    }
    this.time = Math.round(this.startTicks + (this.clock.now() - this.startClock) * TICKS_PER_SECOND);
    if (this.time >= this.duration()) { this.time = this.duration(); this.pause(); return; }
    this.draw();
  }

  pause() {
    this.playing = false;
    this.gate.reset();
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
    const holding = this.playing && this.gate.buffering;
    const run = this.playing && !holding;
    let stalled = false, missing = false;
    const loads = new Map<string, ClipLoad>();
    if (canvas && ctx) { ctx.fillStyle = this.project.settings.background ?? "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    // V2-101 / P6-FX-SCOPE: "main" effects change the main-track render (applied once main is drawn, before
    // overlays/text); "overlay" effects change each overlay clip on its own layer before it is composited; "all"
    // effects change the finished composite (main + overlays + text) at the end, before burned-in subtitles.
    const fx = effectFrameAt(comp, this.time, "main");
    const fxOverlay = effectFrameAt(comp, this.time, "overlay");
    const fxAll = effectFrameAt(comp, this.time, "all");
    const mainId = mainTrack(comp)?.id;
    let fxDone = !fx;
    const applyFx = () => { fxDone = true; if (fx && ctx && canvas) applyEffectFrame(ctx, canvas.width, canvas.height, fx); };
    for (const { track, placement: raw, sourceTicks, mix, tfx } of layers) {
      if (raw.clipType === "effect") continue;
      // V2-103: text clips render with their layer style merged under their own overrides (preview and export alike).
      const placement = effectivePlacement(track, raw);
      if (!fxDone && track.id !== mainId && track.kind !== "audio") applyFx();
      if (placement.clipType === "text") {
        if (ctx && canvas && !track.hidden) withBlend(ctx, placement.blend, () => this.boxes.set(placement.id, drawTextClip(ctx, placement, canvas.width, canvas.height, this.time, mix ?? 1)));
        continue;
      }
      // P35: a storyboard shot with no clip yet: a dark slate with the shot label (preview only; export draws a dark frame).
      if (placement.placeholder) {
        if (ctx && canvas && !track.hidden) {
          if (this.offline) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
          else drawPlaceholderSlate(ctx, canvas.width, canvas.height, placement.placeholder.label);
        }
        continue;
      }
      const version = placement.blank ? undefined : versionOf(this.project, placement.source);
      if ((!version && !placement.blank) || track.hidden) continue;
      // Overlay-scope effects: draw the clip on a transparent layer, apply the effect there, then composite it.
      const paint = (blend: string | undefined, fn: (dc: CanvasRenderingContext2D) => void) => {
        if (!ctx || !canvas) return;
        if (!fxOverlay || track.id === mainId) { withBlend(ctx, blend, () => fn(ctx)); return; }
        const lc = this.overlayLayer(canvas.width, canvas.height);
        if (!lc) { withBlend(ctx, blend, () => fn(ctx)); return; }
        lc.save(); lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalAlpha = 1; lc.globalCompositeOperation = "source-over"; lc.clearRect(0, 0, canvas.width, canvas.height); lc.restore();
        try { fn(lc); } finally { applyEffectFrame(lc, canvas.width, canvas.height, fxOverlay, true); withBlend(ctx, blend, () => ctx.drawImage(lc.canvas, 0, 0)); }
      };
      // P36: blank clip — a solid colour filling the frame, placed and faded like a photo of the frame's size.
      if (placement.blank) {
        if (ctx && canvas) {
          const r = placeRect(placement, canvas.width, canvas.height, canvas.width, canvas.height, this.time);
          this.boxes.set(placement.id, r);
          paint(placement.blend, (dc) => drawWithLook(dc, canvas.width, canvas.height, tfx, (g) => {
            g.save(); g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot); g.fillStyle = placement.blank!.color; g.fillRect(-r.w / 2, -r.h / 2, r.w, r.h); g.restore();
          }));
        }
        continue;
      }
      if (!version) continue;
      if (placement.clipType === "html") {
        live.add(placement.id);
        this.htmlOverrides.set(placement.id, placement.htmlParams);
        const host = this.htmlHost(placement.id, version.media.blobKey, canvas?.width ?? 1280, canvas?.height ?? 720);
        const known = this.manifests.get(version.media.blobKey);
        if (known) host.setParams(resolveHtmlParams(known.params, placement.htmlParams));
        host.request(Math.round(ticksToSeconds(sourceTicks) * 1000) / 1000, ticksToSeconds(placement.sourceInTicks + placement.durationTicks * (placement.speed ?? 1)));
        const f = host.frame;
        if (ctx && canvas && isValidFrame(f)) {
          const r = placeRect(placement, f.width, f.height, canvas.width, canvas.height, this.time);
          this.boxes.set(placement.id, r);
          try { // a detached/closed bitmap must not throw out of draw() and stall preview or export
            paint(placement.blend, (dc) => drawWithLook(dc, canvas.width, canvas.height, tfx, (g) => {
              g.save();
              try { g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot); drawKeyed(g, f, f.width, f.height, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h, this.keyOf(placement)); } finally { g.restore(); }
            }));
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
          paint(placement.blend, (dc) => drawWithLook(dc, canvas.width, canvas.height, tfx, (g) => {
            g.save(); g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
            drawKeyed(g, f.image, f.width, f.height, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h, this.keyOf(placement));
            g.restore();
          }));
        }
        continue;
      }
      const src = this.url(version.media.blobKey);
      if (!src) { loads.set(placement.id, {}); if (placement.clipType !== "image") stalled = true; if (placement.clipType !== "audio") missing = true; continue; }
      live.add(placement.id);
      const el = this.element(placement.id, placement.clipType, src);
      this.lastUsed.set(placement.id, ++this.useCount);
      if ("pause" in el) {
        const ld = clipLoadOf(el, this.playing);
        if (ld) loads.set(placement.id, ld);
        const target = ticksToSeconds(sourceTicks);
        el.muted = !!track.muted || !!track.hidden || (placement.clipType === "video" && !!placement.linkedAudio?.muted);
        const vol = Math.max(0, placement.volume ?? 1) * fadeAt(placement, this.time) * volumeKeyAt(placement, this.time);
        const sp = spatialOf(placement, track), out = audioOutputOf(this.project);
        const gain = this.gainFor(el, placement.audioFx, sp ? `${out.mode}:${out.environment}` : "");
        if (sp && this.audioCtx) this.spatials.get(el)?.stage.set(spatialAt(sp, this.time - placement.startTicks), this.audioCtx.currentTime, "smooth");
        if (gain) { gain.gain.value = vol; el.volume = 1; } else el.volume = Math.min(1, vol);
        // Reverse and freeze cannot use native playback: hold the element paused and seek it per frame.
        const held = this.time < placement.startTicks || this.time >= placement.startTicks + placement.durationTicks; // transition overhang
        const scrub = !!placement.reverse || !!placement.freeze || held;
        if (scrub || this.offline) el.muted = true;
        const speed = placement.speed ?? 1;
        if (holding && !el.paused) el.pause();
        if (!scrub && (!el.muted || placement.clipType === "video")) {
          const st = mediaStalled(el, this.stalledEls.has(el));
          if (st) { this.stalledEls.add(el); stalled = true; } else this.stalledEls.delete(el);
        }
        if (run && scrub) {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - target) > 0.04) el.currentTime = target;
        } else if (run) {
          // Resume without a seek unless the element is really off: a seek drops readyState and would stall again.
          if (el.paused) { if (Math.abs(el.currentTime - target) > SEEK_DRIFT_S) el.currentTime = target; el.playbackRate = speed; void el.play().catch(() => undefined); }
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
        const drawable = !!(w && h && (!(el instanceof HTMLVideoElement) || el.readyState >= 2));
        const poster = !drawable ? this.posters.get(placement.id) : undefined;
        if (el instanceof HTMLVideoElement) this.noteFrame(placement.id, el, drawable, placement.sourceInTicks);
        if (!drawable && poster && Math.abs(poster.at - ticksToSeconds(sourceTicks)) < 0.5) {
          // P30-WARM-MEDIA: re-entering a clip whose element was evicted: show its first frame at once.
          const r = placeRect(placement, poster.w, poster.h, canvas.width, canvas.height, this.time);
          this.boxes.set(placement.id, r);
          paint(placement.blend, (dc) => drawWithLook(dc, canvas.width, canvas.height, tfx, (g) => {
            g.save(); g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
            const k = poster.img.width / poster.w;
            drawKeyed(g, poster.img, poster.img.width, poster.img.height, r.sx * k, r.sy * k, r.sw * k, r.sh * k, -r.w / 2, -r.h / 2, r.w, r.h, this.keyOf(placement));
            g.restore();
          }));
        } else if (!drawable) missing = true;
        if (drawable) {
          const r = placeRect(placement, w, h, canvas.width, canvas.height, this.time);
          this.boxes.set(placement.id, r);
          paint(placement.blend, (dc) => drawWithLook(dc, canvas.width, canvas.height, tfx, (g) => {
            g.save(); g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
            drawKeyed(g, el as CanvasImageSource, w, h, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h, this.keyOf(placement));
            g.restore();
          }));
        }
      }
    }
    if (!fxDone) applyFx();
    // A source without a decoded picture yet (seek or first load): show the last complete frame instead of black.
    if (ctx && canvas && !this.offline) {
      if (missing && this.lastGood && this.lastGood.canvas.width === canvas.width && this.lastGood.canvas.height === canvas.height) ctx.drawImage(this.lastGood.canvas, 0, 0);
      else if (!missing) this.keepFrame(canvas);
    }
    if (fxAll && ctx && canvas) applyEffectFrame(ctx, canvas.width, canvas.height, fxAll);
    const cue = subtitleAt(comp, this.time);
    if (ctx && canvas && cue) drawSubtitle(ctx, canvas.width, canvas.height, cue.text);
    // P1-SHORT-AUDIO: load media of clips starting soon, so a clip shorter than the load time still plays.
    // P30-WARM-MEDIA: while paused also warm clips just before the playhead, so seeking back into one starts at once.
    if (!this.offline) {
      for (const { placement } of upcomingMedia(comp, this.playing ? this.time : Math.max(0, this.time - PRELOAD_TICKS), this.playing ? PRELOAD_TICKS : 2 * PRELOAD_TICKS)) {
        if (live.has(placement.id)) continue;
        const v = versionOf(this.project, placement.source);
        const src = v && this.url(v.media.blobKey);
        if (!src) continue;
        const el = this.element(placement.id, placement.clipType, src);
        if ("pause" in el) { const ld = clipLoadOf(el, false); if (ld) loads.set(placement.id, ld); }
        const at = ticksToSeconds(placement.sourceInTicks);
        if ("pause" in el && el.paused && Math.abs(el.currentTime - at) > 0.02) el.currentTime = at;
      }
    }
    for (const [id, el] of this.pool) if (!live.has(id) && "pause" in el && !el.paused) el.pause();
    if (!this.offline) {
      const keep = new Set(live);
      for (const { placement } of upcomingMedia(comp, this.time, PRELOAD_TICKS)) keep.add(placement.id);
      for (const id of idleEvictions(this.lastUsed, keep, this.idleCap)) { this.release(id); this.lastUsed.delete(id); }
      this.stalled = stalled;
      const loading = (this.playing && this.gate.buffering) || (!this.playing && missing);
      const sig = loadSignature(loads);
      if (sig !== this.loadSig) { this.loadSig = sig; this.clipLoads = loads; this.onClipLoads?.(loads); }
      // While paused nothing else redraws, so poll gently until every visible clip has loaded.
      if (this.loadPoll) clearTimeout(this.loadPoll);
      this.loadPoll = !this.playing && loads.size ? setTimeout(() => { this.loadPoll = undefined; this.draw(); }, 500) : undefined;
      if (loading !== this.loading) { this.loading = loading; this.onLoading?.(loading); }
    }
    for (const id of [...this.pool.keys()]) if (!findAny(this.project, id)) this.release(id);
    for (const [id, h] of this.html) if (!findAny(this.project, id)) { h.host.dispose(); this.html.delete(id); }
    this.onTime?.(this.time, this.playing);
  }

  private overlayCtx?: CanvasRenderingContext2D | null;
  /** Reused transparent layer for overlay-scope effects (P6-FX-SCOPE), sized to the output canvas. */
  private overlayLayer(w: number, h: number): CanvasRenderingContext2D | null {
    if (this.overlayCtx === undefined) {
      const c = typeof document !== "undefined" ? document.createElement("canvas") : null;
      this.overlayCtx = c ? c.getContext("2d") : null;
    }
    const g = this.overlayCtx;
    if (g && (g.canvas.width !== w || g.canvas.height !== h)) { g.canvas.width = w; g.canvas.height = h; }
    return g;
  }

  /** Copy the finished preview frame so a later frame with a missing source can show it instead of black. */
  /** P30-WARM-MEDIA: keep the clip's first frame as a small still, and record time to first frame per clip entry. */
  private noteFrame(id: string, el: HTMLVideoElement, drawable: boolean, sourceIn: number) {
    if (!this.entered.has(id) && !drawable) this.entered.set(id, performance.now());
    if (drawable && this.entered.has(id)) { this.firstFrameMs.push({ id, ms: Math.round(performance.now() - this.entered.get(id)!), warm: this.posters.has(id) }); this.entered.delete(id); if (this.firstFrameMs.length > 50) this.firstFrameMs.shift(); }
    const at = ticksToSeconds(sourceIn);
    if (!drawable || el.seeking || Math.abs(el.currentTime - at) > 0.05 || this.posters.get(id)?.at === at || typeof document === "undefined") return;
    const w = el.videoWidth, h = el.videoHeight, k = Math.min(1, 480 / w);
    const img = document.createElement("canvas"); img.width = Math.max(1, Math.round(w * k)); img.height = Math.max(1, Math.round(h * k));
    try { img.getContext("2d")?.drawImage(el, 0, 0, img.width, img.height); this.posters.set(id, { img, w, h, at }); } catch { /* tainted or not decodable */ }
  }

  private keepFrame(canvas: HTMLCanvasElement) {
    if (this.lastGood === undefined) this.lastGood = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    const g = this.lastGood;
    if (!g) return;
    if (g.canvas.width !== canvas.width || g.canvas.height !== canvas.height) { g.canvas.width = canvas.width; g.canvas.height = canvas.height; }
    try { g.drawImage(canvas, 0, 0); } catch { /* tainted or detached: skip */ }
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
    this.disposed = true;
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

/** P35: preview slate for a placeholder shot: near-black frame, a thin frame line, the shot label and "Not generated". */
export function drawPlaceholderSlate(ctx: CanvasRenderingContext2D, w: number, h: number, label: string): void {
  ctx.save();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#111214"; ctx.fillRect(0, 0, w, h);
  const u = Math.max(1, Math.round(Math.min(w, h) / 360));
  ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 2 * u; ctx.setLineDash([8 * u, 6 * u]);
  ctx.strokeRect(w * 0.06, h * 0.08, w * 0.88, h * 0.84);
  ctx.setLineDash([]);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const big = Math.round(Math.min(w / 24, h / 12));
  ctx.fillStyle = "rgba(255,255,255,0.88)"; ctx.font = `600 ${big}px system-ui, sans-serif`;
  const max = w * 0.8;
  let text = label;
  while (text.length > 4 && ctx.measureText(text).width > max) text = `${text.slice(0, -2)}…`;
  ctx.fillText(text, w / 2, h / 2 - big * 0.4);
  ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = `500 ${Math.round(big * 0.55)}px system-ui, sans-serif`;
  ctx.fillText("NOT GENERATED", w / 2, h / 2 + big * 0.75);
  ctx.restore();
}

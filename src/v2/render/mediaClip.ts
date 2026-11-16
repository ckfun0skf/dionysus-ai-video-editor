/**
 * Media element path shared by the image, video and audio renderers and the unknown-type fallback (P68, moved verbatim
 * from `Player.draw()`): resolve the blob URL, take the pooled element, slave it to the timeline (volume, audio fx,
 * spatial stage, scrub / play / drift correction, export seeks), and draw its picture (or the warm poster).
 */
import { fadeAt, volumeKeyAt } from "../domain/model";
import { audioOutputOf, spatialAt, spatialOf } from "../domain/spatial";
import { ticksToSeconds } from "../domain/time";
import { drawKeyed } from "./chromaKey";
import { correctDrift, SEEK_DRIFT_S } from "./clock";
import { placeRect } from "./frame";
import { clipLoadOf, mediaStalled } from "./stability";
import { drawWithLook } from "./transitionDraw";
import type { ClipFrameHost, MediaEl } from "./clipRenderers";

/**
 * The clip's pooled element, or undefined while its blob URL resolves (then the clip counts as loading; `stalls`
 * holds a playing preview, `misses` shows the last good frame).
 */
export function acquireMedia(h: ClipFrameHost, stalls: boolean, misses: boolean): MediaEl | undefined {
  const { placement, version, frame: st, media: m } = h;
  const src = m.url(version.media.blobKey);
  if (!src) { st.loads.set(placement.id, {}); if (stalls) st.stalled = true; if (misses) st.missing = true; return undefined; }
  st.live.add(placement.id);
  const el = m.element(placement.id, placement.clipType, src);
  m.touch(placement.id);
  return el;
}

/** Slave a video/audio element to the timeline (no-op for an image element). */
export function syncMedia(h: ClipFrameHost, el: MediaEl): void {
  const { placement, track, sourceTicks, frame: st, media: m } = h;
  const { holding, run } = st;
  if ("pause" in el) {
    const ld = clipLoadOf(el, m.playing);
    if (ld) st.loads.set(placement.id, ld);
    const target = ticksToSeconds(sourceTicks);
    el.muted = m.previewMute || !!track.muted || !!track.hidden || (placement.clipType === "video" && !!placement.linkedAudio?.muted);
    const vol = Math.max(0, placement.volume ?? 1) * fadeAt(placement, h.time) * volumeKeyAt(placement, h.time);
    const sp = spatialOf(placement, track), out = audioOutputOf(m.project);
    const gain = m.gainFor(el, placement.audioFx, sp ? `${out.mode}:${out.environment}` : "");
    if (sp && m.audioCtx) m.spatialStage(el)?.set(spatialAt(sp, h.time - placement.startTicks), m.audioCtx.currentTime, "smooth");
    if (gain) { gain.gain.value = vol; el.volume = 1; } else el.volume = Math.min(1, vol);
    // Reverse and freeze cannot use native playback: hold the element paused and seek it per frame.
    const held = h.time < placement.startTicks || h.time >= placement.startTicks + placement.durationTicks; // transition overhang
    const scrub = !!placement.reverse || !!placement.freeze || held;
    if (scrub || h.offline) el.muted = true;
    const speed = placement.speed ?? 1;
    if (holding && !el.paused) el.pause();
    if (!scrub && (!el.muted || placement.clipType === "video")) {
      const stalled = mediaStalled(el, m.stalledEls.has(el));
      if (stalled) { m.stalledEls.add(el); st.stalled = true; } else m.stalledEls.delete(el);
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
      if (h.offline && el instanceof HTMLVideoElement) {
        // Export: every output frame needs its own exact source frame. Nudge 2 ms past the frame
        // boundary so float rounding cannot land on the previous frame, and never skip a seek.
        const exact = target + 0.002;
        if (Math.abs(el.currentTime - exact) > 0.0005) { m.armFrame(el); el.currentTime = exact; }
      } else if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
    }
  }
}

/** Draw the element's current picture (or, while a re-entered video reloads, its first-frame poster). */
export function drawMediaPicture(h: ClipFrameHost, el: MediaEl): void {
  const { g: ctx, canvas, placement, sourceTicks, mix, tfx, paint, frame: st, media: m } = h;
  if (!ctx || !canvas) return;
  const w = el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLImageElement).naturalWidth;
  const hh = el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight;
  const drawable = !!(w && hh && (!(el instanceof HTMLVideoElement) || el.readyState >= 2));
  const poster = !drawable ? m.poster(placement.id) : undefined;
  if (el instanceof HTMLVideoElement) m.noteFrame(placement.id, el, drawable, placement.sourceInTicks);
  if (!drawable && poster && Math.abs(poster.at - ticksToSeconds(sourceTicks)) < 0.5) {
    // P30-WARM-MEDIA: re-entering a clip whose element was evicted: show its first frame at once.
    const r = placeRect(placement, poster.w, poster.h, canvas.width, canvas.height, h.time);
    h.setBox(r);
    paint(placement.blend, (dc) => drawWithLook(dc, canvas.width, canvas.height, tfx, (g) => {
      g.save(); g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
      const k = poster.img.width / poster.w;
      h.blit(g, poster.w, poster.h, r, (gg) => drawKeyed(gg, poster.img, poster.img.width, poster.img.height, r.sx * k, r.sy * k, r.sw * k, r.sh * k, -r.w / 2, -r.h / 2, r.w, r.h, m.keyOf(placement)));
      g.restore();
    }));
  } else if (!drawable) st.missing = true;
  if (drawable) {
    const r = placeRect(placement, w, hh, canvas.width, canvas.height, h.time);
    h.setBox(r);
    paint(placement.blend, (dc) => drawWithLook(dc, canvas.width, canvas.height, tfx, (g) => {
      g.save(); g.globalAlpha = r.alpha * (mix ?? 1); g.translate(r.cx, r.cy); g.rotate(r.rot);
      h.blit(g, w, hh, r, (gg) => drawKeyed(gg, el as CanvasImageSource, w, hh, r.sx, r.sy, r.sw, r.sh, -r.w / 2, -r.h / 2, r.w, r.h, m.keyOf(placement)));
      g.restore();
    }));
  }
}

/** The whole element path for a clip whose element kind follows its `clipType` (video, image, audio, unknown). */
export function drawMediaClip(h: ClipFrameHost): void {
  const kind = h.placement.clipType;
  const el = acquireMedia(h, kind !== "image", kind !== "audio");
  if (!el) return;
  syncMedia(h, el);
  if (kind !== "audio") drawMediaPicture(h, el);
}

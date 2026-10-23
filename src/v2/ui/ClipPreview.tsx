import { useEffect, useRef } from "react";
import { ticksToSeconds, type Placement } from "../domain";
import { clipBars, FILMSTRIP_H, nearestFrame, type Filmstrip, type Peaks } from "./media";

const BAR_PX = 3;

/** Waveform bars for the clip's used source span (canvas, redrawn only when inputs change). */
export function Waveform({ peaks, p, width, height, kind }: { peaks: Peaks; p: Placement; width: number; height: number; kind: "audio" | "video" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.max(1, Math.min(Math.round(width), 8192));
  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!g) return;
    const dpr = window.devicePixelRatio || 1;
    ref.current!.width = w * dpr; ref.current!.height = height * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, height);
    const bars = clipBars(peaks, ticksToSeconds(p.sourceInTicks), ticksToSeconds(p.durationTicks), p.freeze ? 0 : p.speed ?? 1, !!p.reverse, Math.ceil(w / BAR_PX));
    g.fillStyle = kind === "audio" ? "rgba(255,255,255,.75)" : "rgba(255,255,255,.55)";
    const mid = kind === "audio" ? height / 2 : height;
    bars.forEach((v, i) => {
      const h = Math.max(1, v * (kind === "audio" ? height * 0.9 : height));
      g.fillRect(i * BAR_PX, kind === "audio" ? mid - h / 2 : mid - h, BAR_PX - 1, h);
    });
  }, [peaks, p.sourceInTicks, p.durationTicks, p.speed, p.reverse, p.freeze, w, height, kind]);
  return <canvas ref={ref} className={`v2-wave wave-${kind}`} style={{ width: w, height }} aria-hidden data-testid="waveform" />;
}

/** Tiled frames along the clip; each tile shows the source frame nearest its position. */
export function FilmstripTiles({ strip, p, width, pps }: { strip: Filmstrip; p: Placement; width: number; pps: number }) {
  const tileW = Math.round(FILMSTRIP_H * strip.aspect);
  const n = Math.min(200, Math.ceil(width / tileW));
  const speed = p.freeze ? 0 : p.speed ?? 1;
  const src0 = ticksToSeconds(p.sourceInTicks), dur = ticksToSeconds(p.durationTicks);
  return (
    <div className="v2-strip" aria-hidden data-testid="filmstrip">
      {Array.from({ length: n }, (_, i) => {
        const tl = Math.min(dur, (i * tileW + tileW / 2) / pps);
        const t = p.reverse ? src0 + (dur - tl) * speed : src0 + tl * speed;
        return <img key={i} src={strip.frames[nearestFrame(strip.times, t)]} alt="" draggable={false} style={{ left: i * tileW, width: tileW }} />;
      })}
    </div>
  );
}

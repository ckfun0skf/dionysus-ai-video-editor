import { useEffect, useRef } from "react";
import { applyPreset, identityFrame, loopPeriod, type PresetKind } from "../registry";

/** One cycle of a tile preview, in ms. In/out play then hold; loops run one period. */
const CYCLE_MS = 1600;
/** Progress for a tile at loop time u (0..1 of CYCLE_MS) — shared by tiles and tests. */
export function tileProgress(kind: PresetKind, u: number): number {
  const play = Math.min(1, u / 0.6); // animate for 60% of the cycle, then hold the end state
  if (kind === "textAnimIn") return play;
  if (kind === "textAnimOut") return 1 - play;
  return u;
}

/**
 * Live-looping preview of a preset on "ABC123", drawn with the same render function the player uses
 * (V2-098). Works for text animations, effects (static style) and stickers (SVG).
 */
export function PresetTile({ kind, id, label, active, onPick, sample = "ABC123", animate = true }: { kind: PresetKind; id: string; label: string; active?: boolean; onPick: () => void; sample?: string; animate?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, g = c?.getContext?.("2d");
    if (!c || !g) return;
    let raf = 0, img: HTMLImageElement | undefined;
    const t0 = performance.now();
    const draw = (now: number) => {
      const w = c.width, h = c.height;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.filter = "none";
      if (kind === "sticker") {
        if (!img) { img = new Image(); img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(applyPreset("sticker", id, 0).svg ?? "")}`; }
        if (img.complete) g.drawImage(img, (w - h * 0.8) / 2, h * 0.1, h * 0.8, h * 0.8);
      } else {
        const u = ((now - t0) % (kind === "textAnimLoop" ? loopPeriod(id) * 1000 : CYCLE_MS)) / (kind === "textAnimLoop" ? loopPeriod(id) * 1000 : CYCLE_MS);
        const f = id === "none" ? identityFrame() : applyPreset(kind, id, kind === "effect" ? 0 : tileProgress(kind, u), identityFrame(), kind === "effect" ? { color: "#20d5ec" } : undefined);
        const px = h * 0.32;
        g.font = `700 ${px}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
        const text = sample.slice(0, Math.round(sample.length * Math.max(0, Math.min(1, f.chars))));
        const tw = g.measureText(sample).width;
        g.globalAlpha = Math.max(0, Math.min(1, f.alpha));
        g.translate(w / 2 + f.dx * w, h / 2 + f.dy * h); g.rotate((f.rot * Math.PI) / 180); g.scale(f.scale, f.scale);
        if (f.filter) g.filter = f.filter;
        if (f.clip) { const [l, t, r, b] = f.clip; g.beginPath(); g.rect(-tw / 2 + tw * l, -px / 2 - px * 0.2 + px * 1.4 * t, tw * Math.max(0, 1 - l - r), px * 1.4 * Math.max(0, 1 - t - b)); g.clip(); }
        const fx = f.fx ?? {}, ec = fx.color ?? "#20d5ec";
        for (const e of fx.echo ?? []) { g.save(); g.globalAlpha *= e.alpha; g.fillStyle = ec; g.fillText(text, px * e.dx, px * e.dy); g.restore(); }
        if (fx.glowBlur) { g.shadowColor = ec; g.shadowBlur = px * fx.glowBlur; }
        if (fx.hollow) { g.lineWidth = 1.5; g.strokeStyle = "#fff"; g.strokeText(text, 0, 0); }
        else { g.fillStyle = fx.neon ? ec : "#fff"; g.fillText(text, 0, 0); if (fx.neon) { g.shadowBlur = 0; g.fillStyle = "#fff"; g.fillText(text, 0, 0); } }
        g.shadowBlur = 0;
      }
      if (animate && kind !== "sticker" && kind !== "effect") raf = requestAnimationFrame(draw);
      else if (kind === "sticker" && img && !img.complete) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [kind, id, sample, animate]);
  return (
    <button className={`v2-ptile ${active ? "is-active" : ""}`} role="radio" aria-checked={!!active} aria-label={label} title={label} onClick={onPick}>
      <canvas ref={ref} width={144} height={96} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

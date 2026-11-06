import { useEffect, useRef } from "react";
import { text as T } from "../domain";
import { applyPreset, getPreset, identityFrame, loopPeriod, type Params, type PresetKind } from "../registry";

/** One cycle of a generic (unselected) tile preview, in ms. In/out play then hold; loops run one period. */
const CYCLE_MS = 1600;
/** Hold beat after a selected tile finishes its Duration, before looping (ms). */
const SELECTED_HOLD_MS = 400;

/** Progress for a tile at loop time u (0..1 of the cycle) — shared by tiles and tests. */
export function tileProgress(kind: PresetKind, u: number, playFrac = 0.6): number {
  const play = Math.min(1, u / playFrac); // animate for playFrac of the cycle, then hold the end state
  if (kind === "textAnimIn") return play;
  if (kind === "textAnimOut") return 1 - play;
  return u;
}

/**
 * Cycle length and play fraction for a tile. Selected In/Out tiles use the user's Duration then a short hold;
 * unselected tiles keep the fixed 1.6 s demo (60% play).
 */
export function tileCycle(kind: PresetKind, durationSec?: number): { cycleMs: number; playFrac: number; durationSec: number } {
  if (kind === "textAnimLoop" || durationSec === undefined) return { cycleMs: CYCLE_MS, playFrac: 0.6, durationSec: (CYCLE_MS * 0.6) / 1000 };
  const playMs = Math.max(100, durationSec * 1000);
  return { cycleMs: playMs + SELECTED_HOLD_MS, playFrac: playMs / (playMs + SELECTED_HOLD_MS), durationSec };
}

/** Font size that keeps a sample measured at `px` (width `tw`) inside 80% of a `w`-wide tile. */
export function tileFontPx(px: number, tw: number, w: number): number {
  return tw > w * 0.8 ? Math.max(8, (px * w * 0.8) / tw) : px;
}

/**
 * Live-looping preview of a preset on `sample` (default: the descriptor's `preview.text`, else "ABC123"), drawn with the same render function the player uses
 * (V2-098). Works for text animations, effects (static style) and stickers (SVG).
 * P45: when `durationSec` / `params` are set (the selected In/Out tile), the preview uses that Duration and the
 * user's params, including typewriter scramble/caret via resolveCursor; after Duration it holds briefly then loops.
 */
export function PresetTile({ kind, id, label, active, onPick, sample: sampleProp, animate = true, durationSec, params }: {
  kind: PresetKind; id: string; label: string; active?: boolean; onPick: () => void; sample?: string; animate?: boolean;
  /** Selected-tile Duration (seconds). Omit for the generic demo cycle. */
  durationSec?: number;
  /** Selected-tile params (merged with defaults by applyPreset). */
  params?: Params;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const sample = sampleProp ?? getPreset(kind, id)?.preview.text ?? "ABC123";
  const paramsKey = JSON.stringify(params ?? null);
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
        const loopMs = kind === "textAnimLoop" ? loopPeriod(id, params) * 1000 : tileCycle(kind, durationSec).cycleMs;
        const { playFrac, durationSec: animSec } = tileCycle(kind, kind === "textAnimLoop" ? undefined : durationSec);
        const u = ((now - t0) % loopMs) / loopMs;
        const progress = kind === "textAnimLoop" ? u : tileProgress(kind, u, playFrac);
        const f = id === "none" ? identityFrame() : applyPreset(kind, id, kind === "effect" ? 0 : progress, identityFrame(), kind === "effect" ? { color: "#20d5ec" } : params);
        const includeBreaks = params?.includeBreaks === true;
        const aTicks = animSec * 120_000;
        const oTicks = (kind === "textAnimIn" ? progress : kind === "textAnimOut" ? 1 - progress : progress) * aTicks;
        const cursor = f.cursor && kind !== "effect" ? T.resolveCursor(sample, f, oTicks, aTicks, includeBreaks) : undefined;
        const full = cursor?.display ?? (f.chars < 1 - 1e-9 ? T.visibleText(sample, f.chars, includeBreaks) : sample);
        const lines = full.split("\n");
        // V2-111: shrink the sample to fit 80% of the tile width (long samples / wide fonts were clipped at the edges).
        const lineH = lines.length > 1 ? 0.28 : 0.32;
        let px = h * lineH;
        g.font = `700 ${px}px system-ui, sans-serif`;
        const widest = Math.max(1, ...lines.map((l) => g.measureText(l || " ").width));
        const fit = tileFontPx(px, widest, w);
        if (fit !== px) { px = fit; g.font = `700 ${px}px system-ui, sans-serif`; }
        g.textAlign = "center"; g.textBaseline = "middle";
        const tw = Math.max(1, ...lines.map((l) => g.measureText(l || " ").width));
        g.globalAlpha = Math.max(0, Math.min(1, f.alpha));
        g.translate(w / 2 + f.dx * w, h / 2 + f.dy * h); g.rotate((f.rot * Math.PI) / 180); g.scale(f.scale, f.scale);
        if (f.filter) g.filter = f.filter;
        if (f.clip) { const [l, t, r, b] = f.clip; g.beginPath(); g.rect(-tw / 2 + tw * l, -px / 2 - px * 0.2 + px * 1.4 * t, tw * Math.max(0, 1 - l - r), px * 1.4 * Math.max(0, 1 - t - b)); g.clip(); }
        const fx = f.fx ?? {}, ec = fx.color ?? "#20d5ec";
        const lh = px * 1.15;
        const y0 = -((lines.length - 1) * lh) / 2;
        const paintLine = (line: string, i: number, fill: string, dx = 0, dy = 0) => {
          if (fx.hollow) { g.lineWidth = 1.5; g.strokeStyle = fill; g.strokeText(line, dx, y0 + i * lh + dy); }
          else { g.fillStyle = fill; g.fillText(line, dx, y0 + i * lh + dy); }
        };
        for (const e of fx.echo ?? []) { g.save(); g.globalAlpha *= e.alpha; for (let i = 0; i < lines.length; i++) paintLine(lines[i], i, ec, px * e.dx, px * e.dy); g.restore(); }
        if (fx.glowBlur) { g.shadowColor = ec; g.shadowBlur = px * fx.glowBlur; }
        const fill = fx.neon ? ec : "#fff";
        for (let i = 0; i < lines.length; i++) paintLine(lines[i], i, fill);
        if (fx.neon) { g.shadowBlur = 0; for (let i = 0; i < lines.length; i++) paintLine(lines[i], i, "#fff"); }
        g.shadowBlur = 0;
        if (cursor?.caret && cursor.caret.alpha > 0) {
          const li = Math.max(0, lines.length - 1), last = lines[li] ?? "", lw = g.measureText(last).width;
          g.save(); g.globalAlpha = Math.max(0, Math.min(1, f.alpha)) * cursor.caret.alpha; g.textAlign = "left";
          g.fillStyle = fx.neon || fx.hollow ? ec : "#fff";
          g.fillText(cursor.caret.glyph, lw / 2, y0 + li * lh);
          g.restore();
        }
      }
      if (animate && kind !== "sticker" && kind !== "effect") raf = requestAnimationFrame(draw);
      else if (kind === "sticker" && img && !img.complete) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  // paramsKey stabilises the object identity from defaultsOf() each parent render.
  }, [kind, id, sample, animate, durationSec, paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button className={`v2-ptile ${active ? "is-active" : ""}`} role="radio" aria-checked={!!active} aria-label={label} title={label} onClick={onPick}>
      <canvas ref={ref} width={144} height={96} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

/** Canvas renderer for text clips (preview and export share it). */
import { transformAt, type Placement } from "../domain/model";
import { applyPreset } from "../registry";
import { textAnimAt, textOf, visibleText, type TextData } from "../domain/text";
import type { Placed } from "./frame";

export function fontString(d: TextData, px: number): string {
  return `${d.italic ? "italic " : ""}${d.bold ? 700 : 400} ${px}px ${d.font}`;
}

/** Wrap paragraphs to `maxW` using the context's current font. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const t = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(t).width > maxW) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

/** Horizontal start of a line when drawing with `textAlign: "left"` so the finished line matches `align`. */
export function alignedLineStartX(align: "left" | "center" | "right", boxContentWidth: number, fullLineWidth: number): number {
  if (align === "left") return -boxContentWidth / 2;
  if (align === "right") return boxContentWidth / 2 - fullLineWidth;
  return -fullLineWidth / 2;
}

/**
 * Map a revealed typewriter prefix onto lines already wrapped from the full text.
 * Does not re-wrap the partial string (which could reflow mid-word). Hard newlines in `revealed`
 * advance to the next full line; a single space after a fully consumed line is the soft-wrap glue
 * that `wrapLines` dropped between words.
 */
export function revealOntoLines(fullLines: string[], revealed: string): string[] {
  const rem = [...revealed];
  let ri = 0;
  const out: string[] = [];
  let crossed = false;
  for (const full of fullLines) {
    if (ri >= rem.length) {
      // Reveal ended on a hard break or soft-wrap glue: open the next line so the caret sits on it.
      if (crossed) out.push("");
      break;
    }
    const chars = [...full];
    const prefix: string[] = [];
    for (let ci = 0; ci < chars.length && ri < rem.length; ci++) {
      if (rem[ri] === "\n") break;
      prefix.push(rem[ri++]);
    }
    out.push(prefix.join(""));
    crossed = false;
    if (ri < rem.length && rem[ri] === "\n") { ri++; crossed = true; continue; }
    // Soft-wrap glue: wrapLines breaks at a space and omits it from both lines.
    if (prefix.length === chars.length && ri < rem.length && rem[ri] === " ") { ri++; crossed = true; }
  }
  return out;
}

/** Draw a text clip at time `t`; returns its on-canvas box (for selection and handles). */
export function drawTextClip(ctx: CanvasRenderingContext2D, p: Placement, w: number, h: number, t: number, mix = 1): Placed {
  const d = textOf(p.text);
  const tr = transformAt(p, t);
  const a = textAnimAt(d, t - p.startTicks, p.durationTicks);
  const px = Math.max(1, d.size * h);
  const lh = px * (d.lineHeight ?? 1.25);
  ctx.save();
  ctx.font = fontString(d, px);
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${(d.letterSpacing ?? 0) * px}px`;
  const all = wrapLines(ctx, d.text || " ", w * 0.9);
  const includeBreaks = d.animInParams?.includeBreaks === true;
  // P46: layout from the full wrapped lines; map the reveal onto them (never re-wrap a partial string).
  const revealed = a.display ?? visibleText(d.text, a.chars, includeBreaks);
  const shown = a.chars >= 1 - 1e-9 && a.display === undefined ? all : revealOntoLines(all, revealed);
  const bw = Math.max(px * 0.5, ...all.map((l) => ctx.measureText(l).width));
  const pad = d.background ? px * 0.3 : px * 0.1;
  const boxW = bw + pad * 2, boxH = all.length * lh + pad * 2;
  const scale = tr.scale * a.scale;
  const cx = w / 2 + tr.x * w + a.dx * w, cy = h / 2 + tr.y * h + a.dy * h;
  const rot = ((tr.rotation + a.rot) * Math.PI) / 180;
  const alpha = Math.max(0, Math.min(1, tr.opacity * a.alpha * mix));
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(scale, scale);
  if (a.filter && "filter" in ctx) ctx.filter = a.filter;
  if (a.clip) { const [l, t0, r, b] = a.clip; ctx.beginPath(); ctx.rect(-boxW / 2 + boxW * l, -boxH / 2 + boxH * t0, boxW * Math.max(0, 1 - l - r), boxH * Math.max(0, 1 - t0 - b)); ctx.clip(); }
  if (d.background && d.background.opacity > 0) {
    ctx.save(); ctx.globalAlpha = alpha * d.background.opacity; ctx.fillStyle = d.background.color;
    const r = px * 0.2, x0 = -boxW / 2, y0 = -boxH / 2;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0, y0, boxW, boxH, r); else ctx.rect(x0, y0, boxW, boxH); ctx.fill(); ctx.restore();
  }
  // P46: draw every line with textAlign left from the finished-line start so center/right type LTR in place.
  ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const lineX = (i: number) => alignedLineStartX(d.align, bw, ctx.measureText(all[i] ?? "").width);
  const y = (i: number) => -boxH / 2 + pad + lh * (i + 0.5);
  const fx = applyPreset("effect", d.effect, 0, a, { color: d.effectColor ?? "#20d5ec" }).fx ?? {}, ec = fx.color ?? "#20d5ec";
  const paint = (fill: string, stroke?: { c: string; w: number }, dx = 0, dy = 0) => shown.forEach((l, i) => {
    const x = lineX(i) + dx;
    if (stroke && stroke.w > 0) { ctx.lineWidth = stroke.w; ctx.strokeStyle = stroke.c; ctx.strokeText(l, x, y(i) + dy); }
    if (fill !== "transparent") { ctx.fillStyle = fill; ctx.fillText(l, x, y(i) + dy); }
  });
  if (fx.echo) { ctx.save(); for (const e of fx.echo) { ctx.globalAlpha = alpha * e.alpha; paint(ec, undefined, px * e.dx, px * e.dy); } ctx.restore(); }
  if (d.shadow) { ctx.shadowColor = d.shadow.color; ctx.shadowBlur = d.shadow.blur * px; ctx.shadowOffsetX = d.shadow.x * px; ctx.shadowOffsetY = d.shadow.y * px; }
  if (fx.glowBlur) { ctx.shadowColor = ec; ctx.shadowBlur = px * fx.glowBlur; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
  const stroke = { c: d.strokeColor ?? "#000", w: (d.strokeWidth ?? 0) * px };
  if (fx.hollow) paint("transparent", { c: d.color, w: Math.max(2, px * 0.06) });
  else if (fx.neon) { paint(ec, { c: ec, w: px * 0.08 }); ctx.shadowBlur = 0; paint("#ffffff"); }
  else paint(d.color, stroke);
  if (a.caret && a.caret.alpha > 0) {
    // P7/P46: caret follows the last revealed glyph on its line (finished-line start + prefix width).
    const li = Math.max(0, shown.length - 1), last = shown[li] ?? "";
    const cx0 = lineX(li) + ctx.measureText(last).width;
    ctx.save(); ctx.globalAlpha = alpha * a.caret.alpha; ctx.textAlign = "left";
    if (stroke.w > 0 && !fx.hollow) { ctx.lineWidth = stroke.w; ctx.strokeStyle = stroke.c; ctx.strokeText(a.caret.glyph, cx0, y(li)); }
    ctx.fillStyle = fx.neon || fx.hollow ? ec : d.color; ctx.fillText(a.caret.glyph, cx0, y(li));
    ctx.restore();
  }
  ctx.restore();
  return { cx, cy, w: boxW * scale, h: boxH * scale, rot, alpha, sx: 0, sy: 0, sw: boxW, sh: boxH };
}

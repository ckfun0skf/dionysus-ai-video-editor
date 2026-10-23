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
  const shown = wrapLines(ctx, visibleText(d.text, a.chars), w * 0.9);
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
  ctx.textAlign = d.align; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const ax = d.align === "left" ? -bw / 2 : d.align === "right" ? bw / 2 : 0;
  const y = (i: number) => -boxH / 2 + pad + lh * (i + 0.5);
  const fx = applyPreset("effect", d.effect, 0, a, { color: d.effectColor ?? "#20d5ec" }).fx ?? {}, ec = fx.color ?? "#20d5ec";
  const paint = (fill: string, stroke?: { c: string; w: number }, dx = 0, dy = 0) => shown.forEach((l, i) => {
    if (stroke && stroke.w > 0) { ctx.lineWidth = stroke.w; ctx.strokeStyle = stroke.c; ctx.strokeText(l, ax + dx, y(i) + dy); }
    if (fill !== "transparent") { ctx.fillStyle = fill; ctx.fillText(l, ax + dx, y(i) + dy); }
  });
  if (fx.echo) { ctx.save(); for (const e of fx.echo) { ctx.globalAlpha = alpha * e.alpha; paint(ec, undefined, px * e.dx, px * e.dy); } ctx.restore(); }
  if (d.shadow) { ctx.shadowColor = d.shadow.color; ctx.shadowBlur = d.shadow.blur * px; ctx.shadowOffsetX = d.shadow.x * px; ctx.shadowOffsetY = d.shadow.y * px; }
  if (fx.glowBlur) { ctx.shadowColor = ec; ctx.shadowBlur = px * fx.glowBlur; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
  const stroke = { c: d.strokeColor ?? "#000", w: (d.strokeWidth ?? 0) * px };
  if (fx.hollow) paint("transparent", { c: d.color, w: Math.max(2, px * 0.06) });
  else if (fx.neon) { paint(ec, { c: ec, w: px * 0.08 }); ctx.shadowBlur = 0; paint("#ffffff"); }
  else paint(d.color, stroke);
  ctx.restore();
  return { cx, cy, w: boxW * scale, h: boxH * scale, rot, alpha, sx: 0, sy: 0, sw: boxW, sh: boxH };
}

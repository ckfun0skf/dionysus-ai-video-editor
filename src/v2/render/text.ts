/** Canvas renderer for text clips (preview and export share it). */
import { transformAt, type Placement, type Track } from "../domain/model";
import { applyPreset } from "../registry";
import { textAnimAt, textOf, visibleText, type TextData } from "../domain/text";
import { resolveCaption, resolveWordHighlightPaint, wordsForCaption } from "../domain/captionStyle";
import { wordCharRanges, wordIndexAt, wordPhaseAt, type WordTiming } from "../domain/wordTiming";
import type { Placed } from "./frame";

export function fontString(d: TextData, px: number, weight?: number): string {
  return `${d.italic ? "italic " : ""}${weight ?? (d.bold ? 700 : 400)} ${px}px ${d.font}`;
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

type Run = { text: string; phase: "pending" | "current" | "spoken" | "plain"; wordIndex: number };

/**
 * Split one wrapped line into styled runs for word-highlight, using character ranges of `words` in the full string.
 * Layout stays on the finished line (LTR); only fill / scale change per word.
 */
export function highlightRunsForLine(
  fullText: string,
  line: string,
  lineStartChar: number,
  words: WordTiming[],
  tSec: number,
): Run[] {
  if (!words.length) return [{ text: line, phase: "plain", wordIndex: -1 }];
  const ranges = wordCharRanges(fullText, words);
  const lineChars = [...line];
  const lineEnd = lineStartChar + lineChars.length;
  const cuts: { at: number; phase: Run["phase"]; wordIndex: number }[] = [{ at: 0, phase: "plain", wordIndex: -1 }];
  for (let wi = 0; wi < ranges.length; wi++) {
    const r = ranges[wi];
    if (r.end <= lineStartChar || r.start >= lineEnd) continue;
    const localStart = Math.max(0, r.start - lineStartChar);
    const localEnd = Math.min(lineChars.length, r.end - lineStartChar);
    const phase = wordPhaseAt(words, wi, tSec);
    cuts.push({ at: localStart, phase, wordIndex: wi });
    if (localEnd < lineChars.length) cuts.push({ at: localEnd, phase: "plain", wordIndex: -1 });
  }
  cuts.sort((a, b) => a.at - b.at || (a.phase === "plain" ? 1 : -1));
  const runs: Run[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const from = cuts[i].at;
    const to = i + 1 < cuts.length ? cuts[i + 1].at : lineChars.length;
    if (to <= from) continue;
    // Resolve phase at this slice: last non-plain cut that covers it.
    let phase: Run["phase"] = "plain";
    let wordIndex = -1;
    for (let j = i; j >= 0; j--) {
      if (cuts[j].phase !== "plain") { phase = cuts[j].phase; wordIndex = cuts[j].wordIndex; break; }
    }
    // Between words: keep pending look for un-spoken gaps after a spoken word? Use plain (base colour at pending opacity via caller for gaps).
    const text = lineChars.slice(from, to).join("");
    if (!text) continue;
    if (phase === "plain") {
      // Whitespace / punctuation between words: treat as spoken if previous word is spoken/current, else pending.
      const cur = wordIndexAt(words, tSec);
      phase = cur < 0 ? "pending" : "spoken";
    }
    runs.push({ text, phase, wordIndex });
  }
  return runs.length ? runs : [{ text: line, phase: "plain", wordIndex: -1 }];
}

/** Character offset in `fullText` where each wrapped line begins (counting soft-wrap spaces that wrapLines drops). */
export function lineStartOffsets(fullText: string, lines: string[]): number[] {
  const full = [...fullText];
  let cursor = 0;
  const out: number[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = [...lines[li]];
    // Skip a hard newline between paragraphs.
    if (cursor < full.length && full[cursor] === "\n") cursor++;
    out.push(cursor);
    for (let i = 0; i < line.length; i++) {
      if (cursor < full.length && full[cursor] === line[i]) cursor++;
      else {
        // Soft-wrap: wrapLines omitted a space between words.
        while (cursor < full.length && /\s/.test(full[cursor]) && full[cursor] !== "\n") cursor++;
        if (cursor < full.length && full[cursor] === line[i]) cursor++;
      }
    }
    // Consume the soft-wrap space after a full line (not a hard break).
    if (li + 1 < lines.length && cursor < full.length && full[cursor] === " ") cursor++;
  }
  return out;
}

/** Draw a text clip at time `t`; returns its on-canvas box (for selection and handles). */
export function drawTextClip(ctx: CanvasRenderingContext2D, p: Placement, w: number, h: number, t: number, mix = 1, track?: Track): Placed {
  const d = textOf(p.text);
  const tr = transformAt(p, t);
  const resolved = resolveCaption(track, p);
  const captionWords = resolved.mode === "word-highlight" ? wordsForCaption(p) : d.words;
  const drawAsHighlight = resolved.mode === "word-highlight" && !!captionWords?.length;
  const a = textAnimAt(drawAsHighlight && d.animIn !== "word-highlight" ? { ...d, animIn: "word-highlight" } : d, t - p.startTicks, p.durationTicks);
  const px = Math.max(1, d.size * h);
  const lh = px * (d.lineHeight ?? 1.25);
  ctx.save();
  ctx.font = fontString(d, px);
  if ("letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${(d.letterSpacing ?? 0) * px}px`;
  const all = wrapLines(ctx, d.text || " ", w * 0.9);
  const includeBreaks = d.animInParams?.includeBreaks === true;
  const highlight = drawAsHighlight;
  // P46: layout from the full wrapped lines; map the reveal onto them (never re-wrap a partial string).
  const revealed = a.display ?? visibleText(d.text, a.chars, includeBreaks);
  const shown = highlight || (a.chars >= 1 - 1e-9 && a.display === undefined) ? all : revealOntoLines(all, revealed);
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
  const stroke = { c: d.strokeColor ?? "#000", w: (d.strokeWidth ?? 0) * px };
  const paintLine = (fill: string, strokeOpt: { c: string; w: number } | undefined, dx: number, dy: number, text: string, x: number, yy: number) => {
    if (strokeOpt && strokeOpt.w > 0) { ctx.lineWidth = strokeOpt.w; ctx.strokeStyle = strokeOpt.c; ctx.strokeText(text, x + dx, yy + dy); }
    if (fill !== "transparent") { ctx.fillStyle = fill; ctx.fillText(text, x + dx, yy + dy); }
  };

  if (highlight && captionWords?.length) {
    const tSec = (t - p.startTicks) / 120_000;
    const starts = lineStartOffsets(d.text || " ", all);
    const styles = resolveWordHighlightPaint(resolved.highlight, resolved.followsTrack ? undefined : d.animInParams, d);
    for (let i = 0; i < shown.length; i++) {
      const runs = highlightRunsForLine(d.text || " ", shown[i], starts[i] ?? 0, captionWords, tSec);
      let x = lineX(i);
      const yy = y(i);
      for (const run of runs) {
        const phase = run.phase === "current" || run.phase === "spoken" || run.phase === "pending" ? run.phase : "pending";
        const st = styles[phase];
        ctx.save();
        ctx.font = fontString(d, px, st.weight);
        ctx.globalAlpha = alpha * st.opacity;
        if (st.scale) {
          const mid = x + ctx.measureText(run.text).width / 2;
          ctx.translate(mid, yy);
          ctx.scale(1 + st.scale, 1 + st.scale);
          ctx.translate(-mid, -yy);
        }
        if (d.shadow) { ctx.shadowColor = d.shadow.color; ctx.shadowBlur = d.shadow.blur * px; ctx.shadowOffsetX = d.shadow.x * px; ctx.shadowOffsetY = d.shadow.y * px; }
        if (fx.hollow) paintLine("transparent", { c: st.color, w: Math.max(2, px * 0.06) }, 0, 0, run.text, x, yy);
        else paintLine(st.color, stroke.w > 0 ? stroke : undefined, 0, 0, run.text, x, yy);
        ctx.restore();
        ctx.font = fontString(d, px, st.weight);
        x += ctx.measureText(run.text).width;
        ctx.font = fontString(d, px);
      }
    }
  } else {
    const paint = (fill: string, strokeOpt?: { c: string; w: number }, dx = 0, dy = 0) => shown.forEach((l, i) => {
      paintLine(fill, strokeOpt, dx, dy, l, lineX(i), y(i));
    });
    if (fx.echo) { ctx.save(); for (const e of fx.echo) { ctx.globalAlpha = alpha * e.alpha; paint(ec, undefined, px * e.dx, px * e.dy); } ctx.restore(); }
    if (d.shadow) { ctx.shadowColor = d.shadow.color; ctx.shadowBlur = d.shadow.blur * px; ctx.shadowOffsetX = d.shadow.x * px; ctx.shadowOffsetY = d.shadow.y * px; }
    if (fx.glowBlur) { ctx.shadowColor = ec; ctx.shadowBlur = px * fx.glowBlur; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }
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
  }
  ctx.restore();
  return { cx, cy, w: boxW * scale, h: boxH * scale, rot, alpha, sx: 0, sy: 0, sw: boxW, sh: boxH };
}

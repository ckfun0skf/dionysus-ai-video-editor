/**
 * P12-REVIEW: the WebMCP timeline tools. Schemas and the model checks live in domain/timelineReview; this runs the
 * edits as engine commands (each call = ONE undo step labelled with the tool name, returning the clip) and the checks
 * that need decoded media: frame capture / contact sheet (an offline Player, same path as export), black frames and
 * audio clipping / silence (the export audio mix).
 */
import { findPlacement, newId, secondsToTicks, timelineReview, type Placement, type Project } from "../../domain";
import { getPreset, listPresets } from "../../registry";
import { cmd, type Command, type Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { ExportVideoFrames, Player, audioPlan, exportDuration, mixAudio } from "../../render";

export type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface TimelineResult { ok: boolean; text: string; image?: { data: string; mimeType: string }; changed: boolean }

/** Renders frames like export; injectable for tests (jsdom has no canvas). */
export interface FrameSource {
  /** Draw the frame at `ticks` into a fresh canvas `width` px wide; returns the canvas. */
  frames(project: Project, ticksList: number[], width: number): Promise<HTMLCanvasElement[]>;
  /** The export audio mix (undefined = no audio). */
  audio(project: Project): Promise<{ channels: Float32Array[]; sampleRate: number } | undefined>;
  /** Mean luma 0..255 of a frame (default: meanLuma). */
  luma?(c: HTMLCanvasElement): number;
}

const still = { kind: "wall" as const, now: () => 0 };
export function playerFrameSource(blobs: BlobStore): FrameSource {
  return {
    async frames(project, ticksList, width) {
      const w = Math.max(16, Math.round(width)), h = Math.max(16, Math.round((w * project.settings.height) / project.settings.width));
      const player = new Player(project, blobs, still as never);
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      player.canvas = canvas; player.offline = true; player.exportVideo = new ExportVideoFrames((k) => blobs.get(k));
      const out: HTMLCanvasElement[] = [];
      try {
        for (const t of ticksList) {
          await player.renderAt(t);
          const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d")?.drawImage(canvas, 0, 0); out.push(c);
        }
      } finally { player.dispose(); }
      return out;
    },
    async audio(project) {
      const secs = exportDuration(project), plan = audioPlan(project);
      if (secs <= 0 || !plan.length) return undefined;
      const buf = await mixAudio(plan, secs, blobs);
      if (!buf) return undefined;
      return { channels: Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)), sampleRate: buf.sampleRate };
    },
  };
}

const jpeg = (c: HTMLCanvasElement, q = 0.8) => String(c.toDataURL("image/jpeg", q) ?? "").replace(/^data:image\/jpeg;base64,/, "");
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** Mean luma (0..255) of a canvas, sampled on a small grid. */
export function meanLuma(c: HTMLCanvasElement): number {
  const ctx = c.getContext("2d"); if (!ctx) return 255;
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 16) { sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
  return n ? sum / n : 255;
}

/** Clipping runs (|sample| ≥ 0.999) and silences (RMS < -60 dBFS for ≥ 2 s) in the mix. */
export function audioIssues(a: { channels: Float32Array[]; sampleRate: number }): timelineReview.LintIssue[] {
  const out: timelineReview.LintIssue[] = [], sr = a.sampleRate, len = a.channels[0]?.length ?? 0;
  const win = Math.max(1, Math.round(sr * 0.1)), clipAt: number[] = [];
  let silentFrom = -1;
  const flush = (end: number) => { if (silentFrom >= 0 && (end - silentFrom) / sr >= 2) out.push({ kind: "audio-silence", severity: "info", atSec: Math.round((silentFrom / sr) * 10) / 10, message: `Silence from ${fmtT(silentFrom / sr)} to ${fmtT(end / sr)}.` }); silentFrom = -1; };
  for (let s = 0; s < len; s += win) {
    let sq = 0, clip = false; const e = Math.min(len, s + win);
    for (const ch of a.channels) for (let i = s; i < e; i++) { const v = ch[i]; sq += v * v; if (v >= 0.999 || v <= -0.999) clip = true; }
    const rms = Math.sqrt(sq / ((e - s) * a.channels.length));
    if (clip && (!clipAt.length || s / sr - clipAt[clipAt.length - 1] > 1)) clipAt.push(s / sr);
    if (rms < 0.001) { if (silentFrom < 0) silentFrom = s; } else flush(s);
  }
  flush(len);
  for (const t of clipAt.slice(0, 20)) out.push({ kind: "audio-clipping", severity: "warning", atSec: Math.round(t * 10) / 10, message: `Audio clips (peaks at full scale) around ${fmtT(t)}: lower the volume of the clips there.` });
  return out;
}

const PROP_KEYS = new Set(["id", "volume", "transform", "effect", "fades", "speed", "blend", "text"]);
const TF_RANGE: Record<string, [number, number]> = { x: [-2, 2], y: [-2, 2], scale: [0.05, 10], rotation: [-360, 360], opacity: [0, 1] };
const numIn = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const ids = (k: Parameters<typeof listPresets>[0]) => listPresets(k).map((d) => d.id).join(", ");

/** P13: why set_clip_props input is invalid for this clip (empty = valid). Never clamps silently. */
export function clipPropsErrors(a: Record<string, unknown>, pl: Placement): string[] {
  const e: string[] = [];
  for (const k of Object.keys(a)) if (!PROP_KEYS.has(k)) e.push(`Unknown property "${k}" (use volume, transform, effect, fades, speed, blend, text).`);
  if ("volume" in a && !numIn(a.volume, 0, 2)) e.push(`"volume" must be a number from 0 to 2 (got ${JSON.stringify(a.volume)}).`);
  if ("speed" in a && !numIn(a.speed, 0.25, 4)) e.push(`"speed" must be a number from 0.25 to 4 (got ${JSON.stringify(a.speed)}).`);
  if ("transform" in a && a.transform !== null) {
    if (!a.transform || typeof a.transform !== "object") e.push('"transform" must be an object { x, y, scale, rotation, opacity, crop } or null.');
    else for (const [k, v] of Object.entries(a.transform as Record<string, unknown>)) {
      if (k === "crop") { if (!v || typeof v !== "object" || Object.entries(v).some(([ck, cv]) => !["l", "t", "r", "b"].includes(ck) || !numIn(cv, 0, 0.95))) e.push('"transform.crop" must be { l, t, r, b } with each 0 to 0.95.'); }
      else if (!TF_RANGE[k]) e.push(`Unknown transform field "${k}" (use x, y, scale, rotation, opacity, crop).`);
      else if (!numIn(v, ...TF_RANGE[k])) e.push(`"transform.${k}" must be a number from ${TF_RANGE[k][0]} to ${TF_RANGE[k][1]} (got ${JSON.stringify(v)}).`);
    }
  }
  if ("effect" in a) {
    const fx = a.effect as { preset?: unknown; params?: unknown } | null;
    if (pl.clipType !== "effect") e.push(`"effect" only applies to effect clips (clip ${pl.id} is ${pl.clipType}); add an effect clip over it instead.`);
    else if (!fx || typeof fx !== "object") e.push('"effect" must be { preset, params }.');
    else {
      const id = fx.preset === undefined ? pl.effect?.preset : fx.preset;
      const d = typeof id === "string" ? getPreset("videoEffect", id) : undefined;
      if (!d) e.push(`Unknown effect preset ${JSON.stringify(fx.preset)}. Use one of: ${ids("videoEffect")}.`);
      else if (fx.params !== undefined) {
        if (!fx.params || typeof fx.params !== "object") e.push('"effect.params" must be an object.');
        else for (const [k, v] of Object.entries(fx.params as Record<string, unknown>)) {
          const sp = d.params.find((x) => x.key === k);
          if (!sp) e.push(`Effect "${d.id}" has no param "${k}" (params: ${d.params.map((x) => x.key).join(", ") || "none"}).`);
          else if (sp.type === "number" && !numIn(v, sp.min, sp.max)) e.push(`"effect.params.${k}" must be a number from ${sp.min} to ${sp.max} (got ${JSON.stringify(v)}).`);
          else if (sp.type === "select" && !sp.options.includes(v as string)) e.push(`"effect.params.${k}" must be one of ${sp.options.join(", ")}.`);
          else if ((sp.type === "color" || sp.type === "string") && typeof v !== "string") e.push(`"effect.params.${k}" must be a string.`);
        }
      }
    }
  }
  if ("fades" in a) {
    const f = a.fades as Record<string, unknown> | null;
    if (!f || typeof f !== "object" || Object.entries(f).some(([k, v]) => !["inSec", "outSec"].includes(k) || !numIn(v, 0, Infinity))) e.push('"fades" must be { inSec, outSec } with seconds of 0 or more.');
  }
  if ("blend" in a && !(a.blend === "" || (typeof a.blend === "string" && getPreset("blend", a.blend)))) e.push(`Unknown blend ${JSON.stringify(a.blend)}. Use "" (normal) or one of: ${ids("blend")}.`);
  if ("text" in a) {
    if (pl.clipType !== "text") e.push(`"text" only applies to text clips (clip ${pl.id} is ${pl.clipType}).`);
    else if (!a.text || typeof a.text !== "object") e.push('"text" must be an object like { text, size, color }.');
    else { const t = a.text as Record<string, unknown>; if ("size" in t && !numIn(t.size, 0.005, 1)) e.push('"text.size" must be a share of the frame height from 0.005 to 1.'); if ("text" in t && typeof t.text !== "string") e.push('"text.text" must be a string.'); }
  }
  return e;
}

const fail = (text: string): TimelineResult => ({ ok: false, text, changed: false });
const rootOf = (p: Project) => p.compositions[p.rootCompositionId];

export async function runTimelineTool(engine: Engine, source: FrameSource | undefined, name: string, input: unknown, hasBlob?: (key: string) => boolean): Promise<TimelineResult> {
  const a = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const project = () => engine.getState().project;
  const n = (k: string) => (typeof a[k] === "number" && Number.isFinite(a[k]) ? (a[k] as number) : undefined);
  const s = (k: string) => (typeof a[k] === "string" && a[k] ? (a[k] as string) : undefined);
  const clip = (id: string) => { const f = findPlacement(rootOf(project()), id); return f && timelineReview.clipJson(project(), f.placement, f.track); };
  const needClip = (): string | TimelineResult => { const id = s("id"); if (!id || !findPlacement(rootOf(project()), id)) return fail(`No clip "${id ?? ""}". Call get_timeline for clip ids.`); return id; };
  const edit = (cmds: Command | Command[], id: string | string[]): TimelineResult => {
    const changed = engine.dispatch(cmds, name);
    const ids = Array.isArray(id) ? id : [id];
    const clips = ids.map(clip).filter(Boolean);
    return { ok: true, changed, text: changed ? JSON.stringify(clips.length === 1 ? clips[0] : clips, null, 1) : `No change. ${JSON.stringify(clips)}` };
  };
  switch (name) {
    case "get_timeline": return { ok: true, changed: false, text: JSON.stringify(timelineReview.timelineJson(project()), null, 1) };
    case "capture_frame": {
      const t = n("timeSec"); if (t === undefined) return fail('"timeSec" is required.');
      if (!source) return fail("Frame capture isn't available here.");
      const [c] = await source.frames(project(), [secondsToTicks(Math.max(0, t))], clamp(n("maxWidth") ?? 640, 64, 1280));
      return { ok: true, changed: false, text: `Frame at ${t}s (${c.width}×${c.height}).`, image: { data: jpeg(c), mimeType: "image/jpeg" } };
    }
    case "contact_sheet": {
      if (!source) return fail("Frame capture isn't available here.");
      const dur = exportDuration(project()); if (dur <= 0) return fail("The timeline is empty.");
      const iv = n("interval"), count = clamp(Math.round(iv ? dur / iv : n("count") ?? 12), 1, 36);
      const times = Array.from({ length: count }, (_, i) => (iv ? i * iv : ((i + 0.5) * dur) / count)).filter((x) => x < dur);
      const sheetW = clamp(n("maxWidth") ?? 1280, 320, 2048), cols = Math.ceil(Math.sqrt(times.length * 1.3)), cellW = Math.floor(sheetW / cols);
      const frames = await source.frames(project(), times.map(secondsToTicks), cellW);
      const cellH = frames[0]?.height ?? cellW, rows = Math.ceil(frames.length / cols), label = 18;
      const sheet = document.createElement("canvas"); sheet.width = cols * cellW; sheet.height = rows * (cellH + label);
      const ctx = sheet.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#111"; ctx.fillRect(0, 0, sheet.width, sheet.height); ctx.font = "13px system-ui, sans-serif"; ctx.textBaseline = "middle";
        frames.forEach((f, i) => { const x = (i % cols) * cellW, y = Math.floor(i / cols) * (cellH + label); ctx.drawImage(f, x, y); ctx.fillStyle = "#eee"; ctx.fillText(`${fmtT(times[i])}  (${times[i].toFixed(2)}s)`, x + 4, y + cellH + label / 2); });
      }
      return { ok: true, changed: false, text: `Contact sheet: ${frames.length} frames, ${cols} per row, at ${times.map((x) => x.toFixed(2)).join(", ")} s.`, image: { data: jpeg(sheet), mimeType: "image/jpeg" } };
    }
    case "review_lint": {
      const p = project(), issues = timelineReview.reviewLint(p, { minClipSec: n("minClipSec"), hasBlob });
      if (a.media !== false && source) {
        const dur = exportDuration(p);
        if (dur > 0) {
          const step = Math.max(0.5, dur / 40), times: number[] = [];
          for (let t = step / 2; t < dur; t += step) times.push(t);
          const frames = await source.frames(p, times.map(secondsToTicks), 96);
          let last = -10;
          const lum = source.luma ?? meanLuma;
          frames.forEach((f, i) => { if (lum(f) < 6 && times[i] - last > step * 1.5) { issues.push({ kind: "black-frame", severity: "warning", atSec: Math.round(times[i] * 100) / 100, message: `Black frame at ${fmtT(times[i])}.` }); last = times[i]; } else if (lum(f) < 6) last = times[i]; });
        }
        try { const au = await source.audio(p); if (au) issues.push(...audioIssues(au)); } catch (e) { issues.push({ kind: "missing-asset", severity: "warning", message: `Couldn't decode the audio mix: ${(e as Error).message}` }); }
      }
      issues.sort((x, y) => (x.atSec ?? -1) - (y.atSec ?? -1));
      return { ok: true, changed: false, text: issues.length ? `${issues.length} issue(s):\n${JSON.stringify(issues, null, 1)}` : "No issues found." };
    }
    case "move_clip": {
      const id = needClip(); if (typeof id !== "string") return id;
      const t = n("startSec"); if (t === undefined) return fail('"startSec" is required.');
      const f = findPlacement(rootOf(project()), id)!, tr = s("trackId") ?? f.track.id;
      const dest = rootOf(project()).tracks.find((x) => x.id === tr);
      if (!dest) return fail(`No track "${tr}".`);
      if (dest.kind !== f.track.kind) return fail(`Track ${tr} is a ${dest.kind} track; clip ${id} needs a ${f.track.kind} track.`);
      return edit(cmd.movePlacement(id, tr, secondsToTicks(Math.max(0, t))), id);
    }
    case "trim_clip": {
      const id = needClip(); if (typeof id !== "string") return id;
      const t = n("atSec"), edge = a.edge; if (t === undefined || (edge !== "left" && edge !== "right")) return fail('"edge" (left|right) and "atSec" are required.');
      return edit(cmd.trimPlacement(id, edge, secondsToTicks(t), a.ripple === true), id);
    }
    case "split_clip": {
      const id = needClip(); if (typeof id !== "string") return id;
      const t = n("atSec"), pl = findPlacement(rootOf(project()), id)!.placement;
      if (t === undefined) return fail('"atSec" is required.');
      const at = secondsToTicks(t);
      if (at <= pl.startTicks || at >= pl.startTicks + pl.durationTicks) return fail(`${t}s is not inside clip ${id} (${pl.startTicks / 120000}s–${(pl.startTicks + pl.durationTicks) / 120000}s).`);
      const nid = newId("plc");
      return edit(cmd.splitPlacement(id, at, nid), [id, nid]);
    }
    case "delete_clip": {
      const ids = Array.isArray(a.ids) ? a.ids.filter((x): x is string => typeof x === "string") : [];
      const missing = ids.filter((x) => !findPlacement(rootOf(project()), x));
      if (!ids.length || missing.length) return fail(`No clip ${missing.join(", ") || "given"}. Call get_timeline for clip ids.`);
      const changed = engine.dispatch(cmd.deleteClips(ids, a.ripple === true), name);
      return { ok: true, changed, text: changed ? `Deleted ${ids.join(", ")}.` : "No change." };
    }
    case "set_clip_props": {
      const id = needClip(); if (typeof id !== "string") return id;
      // P13: every value is checked first; one bad value fails the whole call (nothing changes) with the reason.
      const bad = clipPropsErrors(a, findPlacement(rootOf(project()), id)!.placement);
      if (bad.length) return fail(`set_clip_props changed nothing: ${bad.join(" ")}`);
      const cmds: Command[] = [];
      const v = n("volume"); if (v !== undefined) cmds.push(cmd.setPlacementVolume(id, v));
      if (a.transform === null) cmds.push(cmd.setTransform(id, null));
      else if (a.transform && typeof a.transform === "object") cmds.push(cmd.setTransform(id, a.transform as never));
      if (a.effect && typeof a.effect === "object") cmds.push(cmd.setEffect(id, a.effect as never));
      if (a.fades && typeof a.fades === "object") { const f = a.fades as { inSec?: number; outSec?: number }; cmds.push(cmd.setFades(id, { ...(typeof f.inSec === "number" ? { in: secondsToTicks(f.inSec) } : {}), ...(typeof f.outSec === "number" ? { out: secondsToTicks(f.outSec) } : {}) })); }
      const sp = n("speed"); if (sp !== undefined) cmds.push(cmd.setSpeed(id, sp));
      if (typeof a.blend === "string") cmds.push(cmd.setBlend(id, a.blend || undefined));
      if (a.text && typeof a.text === "object") cmds.push(cmd.updateText(id, a.text as never));
      if (!cmds.length) return fail("Give at least one of volume, transform, effect, fades, speed, blend, text.");
      return edit(cmds, id);
    }
    case "add_clip": {
      const assetId = s("assetId"), t = n("startSec"), p = project();
      if (!assetId || !p.assets[assetId]) return fail(`No media asset "${assetId ?? ""}". Asset ids: ${Object.keys(p.assets).join(", ")}.`);
      if (t === undefined) return fail('"startSec" is required.');
      const tr = s("trackId"); if (tr && !rootOf(p).tracks.some((x) => x.id === tr)) return fail(`No track "${tr}".`);
      const pid = newId("plc");
      const r = edit(cmd.addAssetToTimeline(assetId, secondsToTicks(Math.max(0, t)), tr, pid), pid);
      return r.changed ? r : fail(`Couldn't place ${assetId} there.`);
    }
  }
  return fail(`Unknown tool ${name}.`);
}

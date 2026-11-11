/**
 * P60: track-level Caption style (none | word-highlight | word-pop) and three-state
 * word-highlight looks (pending / current / spoken). Optional on the track so schema
 * dionysus/3.1 projects without the field load unchanged.
 */
import type { Composition, Placement, Track } from "./model";
import { findPlacement } from "./model";
import { textOf, type TextData } from "./text";
import { applyWordHighlight, expandWordPop, setCueWords } from "./subtitleLayer";
import {
  clampWordTimes, evenSplitWords, parseWordsJson, tokenizeWords, type WordTiming,
} from "./wordTiming";

export const CAPTION_MODES = ["none", "word-highlight", "word-pop"] as const;
export type CaptionMode = (typeof CAPTION_MODES)[number];
export const CAPTION_ENTRANCES = ["pop", "fade", "slide-up"] as const;
export type CaptionEntrance = (typeof CAPTION_ENTRANCES)[number];

export interface WordPhaseStyle {
  /** `#rrggbb`. Absent = the clip colour. */
  color?: string;
  /** 0–1. */
  opacity?: number;
  /** Extra size as a fraction (0.08 = 8% larger). */
  scale?: number;
  /** 100–900. Absent = the clip's bold/regular weight. */
  weight?: number;
}

export interface WordHighlightStyles {
  pending?: WordPhaseStyle;
  current?: WordPhaseStyle;
  spoken?: WordPhaseStyle;
}

export interface CaptionStyle {
  mode: CaptionMode;
  highlight?: WordHighlightStyles;
  entrance?: CaptionEntrance;
}

export interface ResolvedCaption {
  mode: CaptionMode;
  highlight?: WordHighlightStyles;
  entrance?: CaptionEntrance;
  followsTrack: boolean;
}

export interface WordPhasePaint {
  color: string;
  opacity: number;
  scale: number;
  weight: number;
}

/** Visual defaults matching P47: pending dim, current cyan + slightly larger, spoken = clip colour. */
export const DEFAULT_HIGHLIGHT: Required<WordHighlightStyles> = {
  pending: { opacity: 0.4, scale: 0 },
  current: { color: "#20d5ec", opacity: 1, scale: 0.08 },
  spoken: { opacity: 1, scale: 0 },
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const TPS = 120_000;

export const isCaptionMode = (v: unknown): v is CaptionMode =>
  typeof v === "string" && (CAPTION_MODES as readonly string[]).includes(v);
export const isCaptionEntrance = (v: unknown): v is CaptionEntrance =>
  typeof v === "string" && (CAPTION_ENTRANCES as readonly string[]).includes(v);

export function clipFollowsTrack(d?: Partial<TextData>): boolean {
  return d?.captionOverride !== true;
}

function fromClipAnim(d: TextData): ResolvedCaption {
  if (d.animIn === "word-highlight" || d.animIn === "word-pop") {
    return {
      mode: d.animIn,
      highlight: highlightFromParams(d.animInParams),
      entrance: isCaptionEntrance(d.animInParams?.entrance) ? d.animInParams.entrance : "pop",
      followsTrack: false,
    };
  }
  return { mode: "none", followsTrack: !d.captionOverride };
}

/** Effective caption mode for a clip: clip override wins, else the track, else the clip's own animIn. */
export function resolveCaption(track: Track | undefined, placement: Placement): ResolvedCaption {
  const d = textOf(placement.text);
  if (!clipFollowsTrack(d)) return fromClipAnim(d);
  const ts = track?.captionStyle;
  if (ts && isCaptionMode(ts.mode)) {
    return { mode: ts.mode, highlight: ts.highlight, entrance: ts.entrance ?? "pop", followsTrack: true };
  }
  return { ...fromClipAnim(d), followsTrack: true };
}

export function hexColor(v: unknown): string | undefined {
  return typeof v === "string" && HEX.test(v) ? v : undefined;
}

function numIn(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
}

function weightOf(v: unknown): number | undefined {
  const n = numIn(v, 100, 900);
  return n === undefined ? undefined : Math.round(n / 100) * 100;
}

/** Merge a stored phase with legacy / new animInParams keys. */
export function highlightFromParams(params?: Record<string, unknown>, stored?: WordHighlightStyles): WordHighlightStyles {
  const p = params ?? {};
  const phase = (key: "pending" | "current" | "spoken", fallback: WordPhaseStyle, aliases: { color?: unknown; opacity?: unknown; scale?: unknown; weight?: unknown }): WordPhaseStyle => {
    const s = stored?.[key] ?? {};
    const color = hexColor(s.color) ?? hexColor(aliases.color) ?? hexColor(fallback.color);
    return {
      ...(color ? { color } : {}),
      ...((s.opacity ?? numIn(aliases.opacity, 0, 1)) !== undefined ? { opacity: s.opacity ?? numIn(aliases.opacity, 0, 1) } : fallback.opacity !== undefined ? { opacity: fallback.opacity } : {}),
      ...((s.scale ?? numIn(aliases.scale, 0, 1)) !== undefined ? { scale: s.scale ?? numIn(aliases.scale, 0, 1) } : fallback.scale !== undefined ? { scale: fallback.scale } : {}),
      ...((s.weight ?? weightOf(aliases.weight)) !== undefined ? { weight: s.weight ?? weightOf(aliases.weight) } : {}),
    };
  };
  return {
    pending: phase("pending", DEFAULT_HIGHLIGHT.pending, { color: p.pendingColor, opacity: p.pendingOpacity, scale: p.pendingScale, weight: p.pendingWeight }),
    current: phase("current", DEFAULT_HIGHLIGHT.current, { color: p.currentColor ?? p.highlightColor, opacity: p.currentOpacity, scale: p.currentScale, weight: p.currentWeight }),
    spoken: phase("spoken", DEFAULT_HIGHLIGHT.spoken, { color: p.spokenColor, opacity: p.spokenOpacity, scale: p.spokenScale, weight: p.spokenWeight }),
  };
}

export function resolveWordHighlightPaint(
  highlight: WordHighlightStyles | undefined,
  params: Record<string, unknown> | undefined,
  clip: TextData,
): Record<"pending" | "current" | "spoken", WordPhasePaint> {
  const merged = highlightFromParams(params, highlight);
  const clipWeight = clip.bold ? 700 : 400;
  const paint = (key: "pending" | "current" | "spoken"): WordPhasePaint => {
    const s = merged[key] ?? {};
    const fb = DEFAULT_HIGHLIGHT[key];
    return {
      color: hexColor(s.color) ?? hexColor(fb.color) ?? clip.color,
      opacity: s.opacity ?? fb.opacity ?? 1,
      scale: s.scale ?? fb.scale ?? 0,
      weight: s.weight ?? clipWeight,
    };
  };
  return { pending: paint("pending"), current: paint("current"), spoken: paint("spoken") };
}

/** Words for highlight: existing timings, else an even split (spaces → words; CJK → characters). */
export function wordsForCaption(placement: Placement): WordTiming[] {
  const d = textOf(placement.text);
  if (d.words?.length) return clampWordTimes(d.words, placement.durationTicks / TPS);
  return evenSplitWords(d.text, placement.durationTicks / TPS);
}

/** Prepare a new text clip so it inherits the track caption style (no structural expand yet). */
export function prepareCaptionPlacement(track: Track, placement: Placement): Placement {
  if (placement.clipType !== "text") return placement;
  const d = textOf(placement.text);
  if (!clipFollowsTrack(d)) return placement;
  const mode = track.captionStyle?.mode;
  if (mode !== "word-highlight" && mode !== "word-pop") return placement;
  if (d.words?.length) return placement;
  const words = evenSplitWords(d.text, placement.durationTicks / TPS);
  if (!words.length) return placement;
  return { ...placement, text: { ...d, words, ...(mode === "word-highlight" ? { animIn: "word-highlight" as const } : {}) } };
}

/** After inserting a text clip, expand it when the track is word-pop. */
export function applyCaptionAfterInsert(comp: Composition, trackId: string, placementId: string): Composition {
  const track = comp.tracks.find((t) => t.id === trackId);
  if (!track?.captionStyle || track.captionStyle.mode !== "word-pop") return comp;
  const found = findPlacement(comp, placementId);
  if (!found || found.placement.clipType !== "text") return comp;
  if (!clipFollowsTrack(found.placement.text)) return comp;
  const entrance = track.captionStyle.entrance ?? "pop";
  return expandWordPop(comp, placementId, entrance);
}

function mapTrack(comp: Composition, trackId: string, f: (t: Track) => Track): Composition {
  let changed = false;
  const tracks = comp.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const next = f(t);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? { ...comp, tracks } : comp;
}

/** Store captionStyle on the track (no clip rewrite). */
export function storeTrackCaptionStyle(comp: Composition, trackId: string, style: CaptionStyle | undefined): Composition {
  return mapTrack(comp, trackId, (t) => {
    if (t.kind !== "text") return t;
    if (!style) {
      if (!t.captionStyle) return t;
      const { captionStyle: _c, ...rest } = t;
      return rest as Track;
    }
    return { ...t, captionStyle: style };
  });
}

/**
 * Set the track caption style and apply the mode to every non-overridden text clip
 * (even-split missing words; expand word-pop; clear word-highlight when mode is none).
 */
export function setTrackCaptionStyle(comp: Composition, trackId: string, style: CaptionStyle): Composition {
  const stored = storeTrackCaptionStyle(comp, trackId, style);
  return applyTrackCaptionMode(stored, trackId);
}

/** Re-apply the track's stored caption mode to followers (and optionally one clip). */
export function applyTrackCaptionMode(comp: Composition, trackId: string, onlyId?: string): Composition {
  const track = comp.tracks.find((t) => t.id === trackId);
  if (!track || track.kind !== "text") return comp;
  const mode = track.captionStyle?.mode ?? "none";
  const entrance = track.captionStyle?.entrance ?? "pop";
  const ids = track.placements.filter((p) => p.clipType === "text" && (!onlyId || p.id === onlyId) && clipFollowsTrack(p.text)).map((p) => p.id);
  let next = comp;
  if (mode === "word-pop") {
    for (const id of ids) next = expandWordPop(next, id, entrance);
    return next;
  }
  if (mode === "word-highlight") {
    for (const id of ids) next = applyWordHighlight(next, id);
    return next;
  }
  // none (explicit track style): drop word-highlight on followers; leave expanded word-pop clips alone.
  if (track.captionStyle) {
    return mapTrack(next, trackId, (t) => ({
      ...t,
      placements: t.placements.map((p) => {
        if (onlyId && p.id !== onlyId) return p;
        if (p.clipType !== "text" || !clipFollowsTrack(p.text)) return p;
        const d = textOf(p.text);
        if (d.animIn !== "word-highlight") return p;
        return { ...p, text: { ...d, animIn: undefined, animInParams: undefined } };
      }),
    }));
  }
  return next;
}

/** Clear a clip's override so it follows the track again (and re-apply the track mode). */
export function resetClipCaptionStyle(comp: Composition, clipId: string): Composition {
  const found = findPlacement(comp, clipId);
  if (!found || found.placement.clipType !== "text") return comp;
  const cleared = mapTrack(comp, found.track.id, (t) => ({
    ...t,
    placements: t.placements.map((p) => {
      if (p.id !== clipId) return p;
      const d = textOf(p.text);
      const { captionOverride: _o, ...rest } = d;
      return { ...p, text: rest as TextData };
    }),
  }));
  return applyTrackCaptionMode(cleared, found.track.id, clipId);
}

/** Mark a clip as overriding the track caption style. */
export function setClipCaptionOverride(comp: Composition, clipId: string, on: boolean): Composition {
  const found = findPlacement(comp, clipId);
  if (!found || found.placement.clipType !== "text") return comp;
  return mapTrack(comp, found.track.id, (t) => ({
    ...t,
    placements: t.placements.map((p) => {
      if (p.id !== clipId) return p;
      const d = textOf(p.text);
      return { ...p, text: { ...d, captionOverride: on || undefined } };
    }),
  }));
}

export interface TrackCueAlign {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  tokens: string[];
}

export function trackCaptionCues(track: Track): TrackCueAlign[] {
  return [...track.placements]
    .filter((p) => p.clipType === "text")
    .sort((a, b) => a.startTicks - b.startTicks)
    .map((p) => {
      const text = textOf(p.text).text;
      return {
        id: p.id,
        startSec: Math.round((p.startTicks / TPS) * 1000) / 1000,
        endSec: Math.round(((p.startTicks + p.durationTicks) / TPS) * 1000) / 1000,
        text,
        tokens: tokenizeWords(text),
      };
    });
}

/** One copy-prompt listing every cue on the track (text + start/end). Dionysus does not call an AI. */
export function trackWordAlignPrompt(opts: {
  cues: TrackCueAlign[];
  audioDurationSec?: number;
  audioName?: string;
}): string {
  const lines: string[] = [
    "Align each caption word to the narration for EVERY cue on this subtitle track. Reply with ONLY one JSON object (no commentary) of the form:",
    '{"cues":[{"id":"<cue id>","words":[{"text":"<exact token>","atSec":<seconds from that cue start>}, ...]}, ...]}',
    "",
    "Rules:",
    "- Include every cue listed below, using that cue's id.",
    "- For each cue, use exactly these tokens in order (same spelling).",
    "- atSec is seconds from the start of THAT cue (0 ≤ atSec < that cue's duration).",
    "- Times must be non-decreasing; the first word of a cue may start at 0.",
    "- Prefer onsets of each spoken word in the audio; if unsure, space them evenly.",
    "",
    "Cues:",
  ];
  opts.cues.forEach((c, i) => {
    const dur = Math.round((c.endSec - c.startSec) * 1000) / 1000;
    lines.push(`${i + 1}. id=${JSON.stringify(c.id)}  start=${c.startSec}s  end=${c.endSec}s  duration=${dur}s  text=${JSON.stringify(c.text)}`);
    lines.push(`   tokens: ${JSON.stringify(c.tokens)}`);
  });
  if (opts.audioDurationSec !== undefined) {
    const audio = Math.round(opts.audioDurationSec * 1000) / 1000;
    lines.push("", `Linked audio duration (seconds): ${audio}${opts.audioName ? ` (${opts.audioName})` : ""}`);
  }
  return lines.join("\n");
}

export type ParsedTrackCueWords = { id?: string; index?: number; words: WordTiming[] };

/** Pull a track-wide `{ cues: [...] }` (or id → words map) out of pasted JSON. */
export function parseTrackWordsJson(raw: string): { ok: true; cues: ParsedTrackCueWords[] } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Nothing pasted — paste the AI's JSON reply with a \"cues\" array covering every caption." };
  let json = text;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) json = fence[1].trim();
  else {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) json = text.slice(start, end + 1);
  }
  let data: unknown;
  try { data = JSON.parse(json); } catch { return { ok: false, error: "Could not parse JSON — paste an object like {\"cues\":[{\"id\":\"…\",\"words\":[{\"text\":\"Hello\",\"atSec\":0.12}]}]}." }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: 'JSON needs a "cues" array (or a map of cue id → words).' };
  const obj = data as Record<string, unknown>;
  const out: ParsedTrackCueWords[] = [];
  if (Array.isArray(obj.cues)) {
    for (let i = 0; i < obj.cues.length; i++) {
      const row = obj.cues[i];
      if (!row || typeof row !== "object") return { ok: false, error: `cues[${i}] must be an object.` };
      const rec = row as Record<string, unknown>;
      const parsed = parseWordsJson(JSON.stringify({ words: rec.words }));
      if (!parsed.ok) return { ok: false, error: `cues[${i}]: ${parsed.error}` };
      const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : undefined;
      const index = typeof rec.index === "number" && Number.isInteger(rec.index) ? rec.index : undefined;
      out.push({ ...(id ? { id } : {}), ...(index !== undefined ? { index } : {}), words: parsed.words });
    }
  } else {
    for (const [key, val] of Object.entries(obj)) {
      if (key === "cues") continue;
      const parsed = parseWordsJson(JSON.stringify({ words: val }));
      if (!parsed.ok) return { ok: false, error: `${key}: ${parsed.error}` };
      out.push({ id: key, words: parsed.words });
    }
  }
  if (!out.length) return { ok: false, error: "cues is empty." };
  return { ok: true, cues: out };
}

/** Match pasted cue words onto the track (every cue must appear exactly once). */
export function matchTrackWordUpdates(track: Track, parsed: ParsedTrackCueWords[]): { ok: true; updates: { id: string; words: WordTiming[] }[] } | { ok: false; error: string } {
  const cues = trackCaptionCues(track);
  if (!cues.length) return { ok: false, error: "This track has no caption clips." };
  const used = new Set<string>();
  const updates: { id: string; words: WordTiming[] }[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    let cue = row.id ? cues.find((c) => c.id === row.id) : undefined;
    if (!cue && row.index !== undefined) cue = cues[row.index];
    if (!cue && parsed.length === cues.length && !row.id && row.index === undefined) cue = cues[i];
    if (!cue) return { ok: false, error: `cues[${i}] does not match a clip on this track${row.id ? ` (unknown id ${JSON.stringify(row.id)})` : ""}.` };
    if (used.has(cue.id)) return { ok: false, error: `Cue ${JSON.stringify(cue.id)} appears more than once.` };
    used.add(cue.id);
    updates.push({ id: cue.id, words: row.words });
  }
  const missing = cues.filter((c) => !used.has(c.id));
  if (missing.length) return { ok: false, error: `JSON is missing ${missing.length} cue${missing.length === 1 ? "" : "s"} (need every clip on the track): ${missing.map((c) => c.id).join(", ")}.` };
  return { ok: true, updates };
}

/** Apply word timings to many cues in one composition update (one undo). */
export function setTrackCaptionWords(comp: Composition, _trackId: string, updates: { id: string; words: WordTiming[] }[]): Composition {
  let next = comp;
  for (const u of updates) next = setCueWords(next, u.id, u.words);
  return next;
}

/** Parse a storyboard / tool captionStyle (string mode or object). Invalid values return an error. */
export function parseCaptionStyle(raw: unknown): { ok: true; value?: CaptionStyle } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw === "string") {
    if (!isCaptionMode(raw)) return { ok: false, error: `"captionStyle" must be none, word-highlight or word-pop (got ${JSON.stringify(raw)}).` };
    return { ok: true, value: { mode: raw } };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `"captionStyle" must be a mode string or { mode, highlight?, entrance? }.` };
  const o = raw as Record<string, unknown>;
  if (!isCaptionMode(o.mode)) return { ok: false, error: `"captionStyle.mode" must be none, word-highlight or word-pop.` };
  const highlight = parseHighlight(o.highlight);
  if (highlight && "error" in highlight) return { ok: false, error: highlight.error };
  if (o.entrance !== undefined && !isCaptionEntrance(o.entrance)) return { ok: false, error: `"captionStyle.entrance" must be pop, fade or slide-up.` };
  return {
    ok: true,
    value: {
      mode: o.mode,
      ...(highlight && "value" in highlight && highlight.value ? { highlight: highlight.value } : {}),
      ...(isCaptionEntrance(o.entrance) ? { entrance: o.entrance } : {}),
    },
  };
}

function parseHighlight(raw: unknown): { value?: WordHighlightStyles } | { error: string } | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `"highlight" must be { pending?, current?, spoken? }.` };
  const o = raw as Record<string, unknown>;
  const out: WordHighlightStyles = {};
  for (const key of ["pending", "current", "spoken"] as const) {
    if (o[key] === undefined) continue;
    const p = parsePhase(o[key], key);
    if ("error" in p) return p;
    if (p.value) out[key] = p.value;
  }
  return { value: out };
}

function parsePhase(raw: unknown, path: string): { value?: WordPhaseStyle } | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `"${path}" must be { color?, opacity?, scale?, weight? }.` };
  const o = raw as Record<string, unknown>;
  if (o.color !== undefined && !hexColor(o.color)) return { error: `"${path}.color" must be #rrggbb.` };
  if (o.opacity !== undefined && numIn(o.opacity, 0, 1) === undefined) return { error: `"${path}.opacity" must be a number from 0 to 1.` };
  if (o.scale !== undefined && numIn(o.scale, 0, 1) === undefined) return { error: `"${path}.scale" must be a number from 0 to 1.` };
  if (o.weight !== undefined && weightOf(o.weight) === undefined) return { error: `"${path}.weight" must be 100–900.` };
  const value: WordPhaseStyle = {
    ...(hexColor(o.color) ? { color: hexColor(o.color) } : {}),
    ...(numIn(o.opacity, 0, 1) !== undefined ? { opacity: numIn(o.opacity, 0, 1) } : {}),
    ...(numIn(o.scale, 0, 1) !== undefined ? { scale: numIn(o.scale, 0, 1) } : {}),
    ...(weightOf(o.weight) !== undefined ? { weight: weightOf(o.weight) } : {}),
  };
  return { value };
}

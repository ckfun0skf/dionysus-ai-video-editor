/**
 * P47: word-level caption timing shared by word-pop (one short clip per word) and word-highlight
 * (one cue, styles change over time). Times are seconds from the cue/clip start. The app does not
 * call an AI or run on-device STT — Even split is local; Align with AI is copy-prompt / paste JSON.
 */
export interface WordTiming {
  text: string;
  /** Seconds from the cue/clip start when this word becomes current (and appears, for word-pop). */
  atSec: number;
}

export const WORD_STEP_SEC = 0.05;
/** Leave a little room after the last word so highlight/pop can show before the cue ends. */
const END_PAD = 0.02;

/** True when `text` has no whitespace separators (CJK / continuous scripts → split by character). */
export function isContinuousScript(text: string): boolean {
  const t = text.replace(/\s+/g, "");
  return t.length > 0 && !/\s/.test(text.trim()) && /[\u3000-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(t);
}

/**
 * Tokenize caption text into timing units: whitespace-separated words when the string has spaces;
 * otherwise one character per unit (CJK / no-space). Newlines are treated as whitespace separators.
 */
export function tokenizeWords(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").trim();
  if (!raw) return [];
  if (/\s/.test(raw) && !isContinuousScript(raw)) {
    return raw.split(/[\s]+/).map((w) => w.trim()).filter(Boolean);
  }
  // Continuous / CJK: one visible character per token (skip whitespace).
  return [...raw].filter((ch) => !/\s/.test(ch));
}

/** Evenly space word starts across `durationSec` (first at 0, last before the end). */
export function evenSplitWords(text: string, durationSec: number): WordTiming[] {
  const tokens = tokenizeWords(text);
  const n = tokens.length;
  if (!n) return [];
  const dur = Math.max(END_PAD * 2, durationSec);
  // Starts at i/n of the cue; leave END_PAD after the last onset so the final word can show.
  return tokens.map((t, i) => ({ text: t, atSec: n === 1 ? 0 : Math.min((i * dur) / n, dur - END_PAD) }));
}

/** Scale every `atSec` when the cue length changes (stretch/compress), then clamp into order. */
export function scaleWordTimes(words: WordTiming[], fromDurSec: number, toDurSec: number): WordTiming[] {
  if (!words.length) return [];
  const from = Math.max(1e-6, fromDurSec);
  const to = Math.max(0, toDurSec);
  return clampWordTimes(words.map((w) => ({ ...w, atSec: (w.atSec / from) * to })), to);
}

/** Keep words in non-decreasing order inside `[0, durationSec - END_PAD]`. */
export function clampWordTimes(words: WordTiming[], durationSec: number): WordTiming[] {
  if (!words.length) return [];
  const hi = Math.max(0, durationSec - END_PAD);
  let prev = 0;
  return words.map((w, i) => {
    let at = Number.isFinite(w.atSec) ? w.atSec : 0;
    if (i === 0) at = Math.max(0, Math.min(hi, at));
    else at = Math.max(prev, Math.min(hi, at));
    prev = at;
    return { text: w.text, atSec: Math.round(at * 1000) / 1000 };
  });
}

/** Move word `index` by `deltaSec`, keeping order and the cue bounds. */
export function nudgeWordAt(words: WordTiming[], index: number, deltaSec: number, durationSec: number): WordTiming[] {
  if (index < 0 || index >= words.length) return words;
  const next = words.map((w, i) => (i === index ? { ...w, atSec: w.atSec + deltaSec } : w));
  // Allow neighbours to stay put: clamp this word between prev and next.
  const hi = Math.max(0, durationSec - END_PAD);
  const lo = index > 0 ? next[index - 1].atSec : 0;
  const up = index < next.length - 1 ? next[index + 1].atSec : hi;
  next[index] = { ...next[index], atSec: Math.round(Math.min(up, Math.max(lo, next[index].atSec)) * 1000) / 1000 };
  return next;
}

/** Set absolute `atSec` for one word (same clamps as nudge). */
export function setWordAtSec(words: WordTiming[], index: number, atSec: number, durationSec: number): WordTiming[] {
  return nudgeWordAt(words.map((w, i) => (i === index ? { ...w, atSec } : w)), index, 0, durationSec);
}

/** Index of the current word at `tSec` (last word with atSec ≤ t), or -1 before the first. */
export function wordIndexAt(words: WordTiming[], tSec: number): number {
  if (!words.length) return -1;
  let i = -1;
  for (let k = 0; k < words.length; k++) {
    if (words[k].atSec <= tSec + 1e-9) i = k;
    else break;
  }
  return i;
}

export type WordPhase = "pending" | "current" | "spoken";

/** Phase of word `i` at time `tSec` (highlight mode). */
export function wordPhaseAt(words: WordTiming[], i: number, tSec: number): WordPhase {
  const cur = wordIndexAt(words, tSec);
  if (cur < 0 || i > cur) return "pending";
  if (i === cur) return "current";
  return "spoken";
}

/** Rebuild the cue string from word tokens (space-joined; CJK joined with no space). */
export function joinWordsText(words: WordTiming[], continuous = false): string {
  if (!words.length) return "";
  return continuous || words.every((w) => [...w.text].length === 1 && !/\s/.test(w.text))
    ? words.map((w) => w.text).join("")
    : words.map((w) => w.text).join(" ");
}

/**
 * Prompt an external AI can answer with word timings. Dionysus does not call the model —
 * the user (or WebMCP agent) copies this, pastes the reply, and we parse `words` JSON.
 */
export function wordAlignPrompt(opts: {
  text: string;
  cueDurationSec: number;
  audioDurationSec?: number;
  audioName?: string;
}): string {
  const cue = Math.round(opts.cueDurationSec * 1000) / 1000;
  const audio = opts.audioDurationSec !== undefined ? Math.round(opts.audioDurationSec * 1000) / 1000 : undefined;
  const tokens = tokenizeWords(opts.text);
  return [
    "Align each caption word to the narration. Reply with ONLY one JSON object (no commentary) of the form:",
    '{"words":[{"text":"<exact token>","atSec":<seconds from cue start>}, ...]}',
    "",
    "Rules:",
    `- Use exactly these tokens in order (same spelling): ${JSON.stringify(tokens)}`,
    `- atSec is seconds from the start of the caption cue (0 ≤ atSec < ${cue}).`,
    "- Times must be non-decreasing; the first word may start at 0.",
    "- Prefer onsets of each spoken word in the audio; if unsure, space them evenly.",
    "",
    `Caption text: ${JSON.stringify(opts.text)}`,
    `Cue duration (seconds): ${cue}`,
    ...(audio !== undefined ? [`Linked audio duration (seconds): ${audio}${opts.audioName ? ` (${opts.audioName})` : ""}`] : []),
  ].join("\n");
}

/** Pull a `words` array out of pasted JSON (raw object, ```json fence, or chat wrapping). */
export function parseWordsJson(raw: string): { ok: true; words: WordTiming[] } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Nothing pasted — paste the AI's JSON reply with a \"words\" array." };
  let json = text;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) json = fence[1].trim();
  else {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) json = text.slice(start, end + 1);
  }
  let data: unknown;
  try { data = JSON.parse(json); } catch { return { ok: false, error: "Could not parse JSON — paste an object like {\"words\":[{\"text\":\"Hello\",\"atSec\":0.12}]}." }; }
  const arr = (data && typeof data === "object" && Array.isArray((data as { words?: unknown }).words))
    ? (data as { words: unknown[] }).words
    : Array.isArray(data) ? data : null;
  if (!arr) return { ok: false, error: 'JSON needs a "words" array of { "text", "atSec" }.' };
  const words: WordTiming[] = [];
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i];
    if (!row || typeof row !== "object") return { ok: false, error: `words[${i}] must be an object.` };
    const t = (row as { text?: unknown }).text;
    const a = (row as { atSec?: unknown }).atSec;
    if (typeof t !== "string" || !t.trim()) return { ok: false, error: `words[${i}].text must be a non-empty string.` };
    if (typeof a !== "number" || !Number.isFinite(a) || a < 0) return { ok: false, error: `words[${i}].atSec must be a number ≥ 0.` };
    words.push({ text: t, atSec: a });
  }
  if (!words.length) return { ok: false, error: "words is empty." };
  return { ok: true, words };
}

/** Character offsets of each word token inside `full` (best-effort sequential match). */
export function wordCharRanges(full: string, words: WordTiming[]): { start: number; end: number }[] {
  const chars = [...full];
  let cursor = 0;
  const ranges: { start: number; end: number }[] = [];
  for (const w of words) {
    const needle = [...w.text];
    // Skip whitespace in the source before searching.
    while (cursor < chars.length && /\s/.test(chars[cursor])) cursor++;
    let found = -1;
    for (let i = cursor; i <= chars.length - needle.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) if (chars[i + j] !== needle[j]) { ok = false; break; }
      if (ok) { found = i; break; }
      // Allow skipping one whitespace run between search starts.
      if (!/\s/.test(chars[i])) continue;
    }
    if (found < 0) {
      ranges.push({ start: cursor, end: cursor });
      continue;
    }
    ranges.push({ start: found, end: found + needle.length });
    cursor = found + needle.length;
  }
  return ranges;
}

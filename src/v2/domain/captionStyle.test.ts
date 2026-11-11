import { describe, expect, it } from "vitest";
import { applyCaptionAfterInsert, applyTrackCaptionMode, highlightFromParams, matchTrackWordUpdates, parseCaptionStyle, parseTrackWordsJson, prepareCaptionPlacement, resetClipCaptionStyle, resolveCaption, resolveWordHighlightPaint, setClipCaptionOverride, setTrackCaptionStyle, setTrackCaptionWords, storeTrackCaptionStyle, trackCaptionCues, trackWordAlignPrompt, wordsForCaption } from "./captionStyle";
import { insertPlacement } from "./ops";
import { textOf } from "./text";
import { evenSplitWords } from "./wordTiming";
import { TEXT_SOURCE, type Composition, type Placement } from "./model";

const TPS = 120_000;

function cue(id: string, text: string, startSec = 0, durSec = 2, extra?: Partial<Placement["text"]>): Placement {
  return {
    id, startTicks: startSec * TPS, durationTicks: durSec * TPS, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "text",
    text: textOf({ text, ...extra }),
  };
}

function compOf(...placements: Placement[]): Composition {
  return { id: "c", name: "c", tracks: [{ id: "t", name: "Subtitles", kind: "text", placements }] };
}

describe("P60 track caption style", () => {
  it("old projects without captionStyle keep per-clip word-highlight", () => {
    const p = cue("a", "Hello world", 0, 2, { animIn: "word-highlight", words: evenSplitWords("Hello world", 2) });
    const c = compOf(p);
    const r = resolveCaption(c.tracks[0], p);
    expect(r.mode).toBe("word-highlight");
    expect(r.followsTrack).toBe(true);
  });

  it("setting word-highlight applies to every follower and even-splits missing words", () => {
    const c = setTrackCaptionStyle(compOf(cue("a", "Hello world", 0, 2), cue("b", "Next line", 2, 2)), "t", { mode: "word-highlight" });
    expect(c.tracks[0].captionStyle?.mode).toBe("word-highlight");
    for (const pl of c.tracks[0].placements) {
      expect(pl.text?.animIn).toBe("word-highlight");
      expect(pl.text?.words?.length).toBeGreaterThan(0);
    }
    expect(c.tracks[0].placements[0].text?.words?.map((w) => w.text)).toEqual(["Hello", "world"]);
  });

  it("CJK captions even-split by character when the track style is applied", () => {
    const c = setTrackCaptionStyle(compOf(cue("a", "你好世界", 0, 2)), "t", { mode: "word-highlight" });
    expect(c.tracks[0].placements[0].text?.words?.map((w) => w.text)).toEqual(["你", "好", "世", "界"]);
  });

  it("clips added later and SRT-like inserts inherit the track style", () => {
    let c = setTrackCaptionStyle(compOf(cue("a", "Hello world", 0, 2)), "t", { mode: "word-highlight" });
    const added = cue("b", "Fresh cue", 3, 2);
    c = insertPlacement(c, "t", added);
    const fresh = c.tracks[0].placements.find((p) => p.id === "b")!;
    expect(resolveCaption(c.tracks[0], fresh).mode).toBe("word-highlight");
    expect(fresh.text?.words?.map((w) => w.text)).toEqual(["Fresh", "cue"]);
  });

  it("SRT paste onto a styled track even-splits each new cue", () => {
    let c = setTrackCaptionStyle(compOf(cue("old", "Existing", 0, 1)), "t", { mode: "word-highlight" });
    const srt = [cue("n1", "Imported one", 2, 1), cue("n2", "Imported two", 3, 1)];
    c = { ...c, tracks: c.tracks.map((t) => t.id === "t" ? { ...t, placements: [...t.placements, ...srt] } : t) };
    c = applyTrackCaptionMode(c, "t");
    expect(c.tracks[0].placements.find((p) => p.id === "n1")?.text?.words?.map((w) => w.text)).toEqual(["Imported", "one"]);
    expect(c.tracks[0].placements.find((p) => p.id === "n2")?.text?.animIn).toBe("word-highlight");
  });

  it("a clip override wins and Use track style resets it", () => {
    let c = setTrackCaptionStyle(compOf(cue("a", "Hello world", 0, 2), cue("b", "Keep me", 2, 2)), "t", { mode: "word-highlight" });
    c = setClipCaptionOverride(c, "b", true);
    // Override with fade (via animIn) — simulate the animation picker.
    c = { ...c, tracks: c.tracks.map((t) => ({ ...t, placements: t.placements.map((p) => p.id === "b" ? { ...p, text: { ...textOf(p.text), animIn: "fade", captionOverride: true } } : p) })) };
    expect(resolveCaption(c.tracks[0], c.tracks[0].placements.find((p) => p.id === "b")!).mode).toBe("none");
    c = setTrackCaptionStyle(c, "t", { mode: "word-highlight", highlight: { current: { color: "#ff00aa" } } });
    expect(c.tracks[0].placements.find((p) => p.id === "b")?.text?.animIn).toBe("fade");
    c = resetClipCaptionStyle(c, "b");
    const reset = c.tracks[0].placements.find((p) => p.id === "b")!;
    expect(reset.text?.captionOverride).toBeUndefined();
    expect(resolveCaption(c.tracks[0], reset).mode).toBe("word-highlight");
    expect(reset.text?.animIn).toBe("word-highlight");
  });

  it("word-highlight paint defaults match the previous look", () => {
    const clip = textOf({ text: "Hi", color: "#ffffff", bold: true });
    const paint = resolveWordHighlightPaint(undefined, undefined, clip);
    expect(paint.pending).toEqual({ color: "#ffffff", opacity: 0.4, scale: 0, weight: 700 });
    expect(paint.current).toEqual({ color: "#20d5ec", opacity: 1, scale: 0.08, weight: 700 });
    expect(paint.spoken).toEqual({ color: "#ffffff", opacity: 1, scale: 0, weight: 700 });
  });

  it("legacy pendingOpacity / highlightColor / currentScale stay equivalent", () => {
    const clip = textOf({ text: "Hi", color: "#aabbcc", bold: false });
    const paint = resolveWordHighlightPaint(undefined, { pendingOpacity: 0.4, highlightColor: "#20d5ec", currentScale: 0.08 }, clip);
    expect(paint.pending.opacity).toBe(0.4);
    expect(paint.current.color).toBe("#20d5ec");
    expect(paint.current.scale).toBe(0.08);
    expect(paint.spoken.color).toBe("#aabbcc");
    expect(paint.spoken.weight).toBe(400);
  });

  it("track-level highlight styles override defaults when following the track", () => {
    const clip = textOf({ text: "Hi", color: "#ffffff" });
    const paint = resolveWordHighlightPaint({
      pending: { color: "#888888", opacity: 0.2, scale: 0, weight: 400 },
      current: { color: "#ff8800", opacity: 1, scale: 0.15, weight: 800 },
      spoken: { color: "#00ff00", opacity: 0.9, scale: 0.02, weight: 500 },
    }, undefined, clip);
    expect(paint.pending.color).toBe("#888888");
    expect(paint.current).toMatchObject({ color: "#ff8800", scale: 0.15, weight: 800 });
    expect(paint.spoken).toMatchObject({ color: "#00ff00", opacity: 0.9, weight: 500 });
  });

  it("changing track highlight colour does not require rewriting clips", () => {
    let c = setTrackCaptionStyle(compOf(cue("a", "Hello world", 0, 2)), "t", { mode: "word-highlight" });
    c = storeTrackCaptionStyle(c, "t", { mode: "word-highlight", highlight: { current: { color: "#ff00aa", scale: 0.2 } } });
    const r = resolveCaption(c.tracks[0], c.tracks[0].placements[0]);
    expect(r.highlight?.current?.color).toBe("#ff00aa");
    const paint = resolveWordHighlightPaint(r.highlight, undefined, textOf(c.tracks[0].placements[0].text));
    expect(paint.current.color).toBe("#ff00aa");
    expect(paint.current.scale).toBe(0.2);
  });

  it("track Align-all prompt lists every cue; paste JSON applies in one update", () => {
    const c0 = setTrackCaptionStyle(compOf(cue("a", "Hello world", 0, 2), cue("b", "Next line", 2, 2)), "t", { mode: "word-highlight" });
    const cues = trackCaptionCues(c0.tracks[0]);
    const prompt = trackWordAlignPrompt({ cues });
    expect(prompt).toContain("Hello world");
    expect(prompt).toContain("Next line");
    expect(prompt).toContain('"a"');
    expect(prompt).toContain('"b"');
    const parsed = parseTrackWordsJson(`{"cues":[
      {"id":"a","words":[{"text":"Hello","atSec":0.1},{"text":"world","atSec":0.8}]},
      {"id":"b","words":[{"text":"Next","atSec":0},{"text":"line","atSec":0.9}]}
    ]}`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const matched = matchTrackWordUpdates(c0.tracks[0], parsed.cues);
    expect(matched.ok).toBe(true);
    if (!matched.ok) return;
    const next = setTrackCaptionWords(c0, "t", matched.updates);
    expect(next.tracks[0].placements[0].text?.words?.[0]).toEqual({ text: "Hello", atSec: 0.1 });
    expect(next.tracks[0].placements[1].text?.words?.[1].text).toBe("line");
  });

  it("rejects align-all JSON that skips a cue or names an unknown id", () => {
    const c0 = compOf(cue("a", "Hello world", 0, 2), cue("b", "Next line", 2, 2));
    const skip = parseTrackWordsJson('{"cues":[{"id":"a","words":[{"text":"Hello","atSec":0},{"text":"world","atSec":0.5}]}]}');
    expect(skip.ok).toBe(true);
    if (!skip.ok) return;
    const missed = matchTrackWordUpdates(c0.tracks[0], skip.cues);
    expect(missed.ok).toBe(false);
    if (missed.ok) return;
    expect(missed.error).toMatch(/missing/);
    const bad = parseTrackWordsJson('{"cues":[{"id":"nope","words":[{"text":"x","atSec":0}]},{"id":"a","words":[{"text":"Hello","atSec":0},{"text":"world","atSec":0.5}]}]}');
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    const unknown = matchTrackWordUpdates(c0.tracks[0], bad.cues);
    expect(unknown.ok).toBe(false);
  });

  it("setting word-pop expands each follower into per-word clips", () => {
    const c = setTrackCaptionStyle(compOf(cue("a", "One two", 0, 2)), "t", { mode: "word-pop" });
    expect(c.tracks[0].placements.map((p) => p.text?.text)).toEqual(["One", "two"]);
    expect(c.tracks[0].placements.every((p) => p.text?.animIn === "pop")).toBe(true);
  });

  it("a later insert on a word-pop track expands after insert", () => {
    let c = setTrackCaptionStyle(compOf(cue("a", "Hi", 0, 1)), "t", { mode: "word-pop" });
    const prepared = prepareCaptionPlacement(c.tracks[0], cue("n", "New words", 2, 2));
    c = { ...c, tracks: c.tracks.map((t) => ({ ...t, placements: [...t.placements, prepared] })) };
    c = applyCaptionAfterInsert(c, "t", "n");
    const texts = c.tracks[0].placements.map((p) => p.text?.text);
    expect(texts).toContain("New");
    expect(texts).toContain("words");
  });

  it("wordsForCaption even-splits when a highlight clip has no words yet", () => {
    const p = cue("a", "Hello there", 0, 2);
    expect(wordsForCaption(p).map((w) => w.text)).toEqual(["Hello", "there"]);
  });

  it("parseCaptionStyle accepts a mode string or an object", () => {
    expect(parseCaptionStyle("word-highlight")).toEqual({ ok: true, value: { mode: "word-highlight" } });
    const obj = parseCaptionStyle({ mode: "word-highlight", highlight: { current: { color: "#123456", scale: 0.1 } }, entrance: "fade" });
    expect(obj.ok).toBe(true);
    if (!obj.ok) return;
    expect(obj.value?.highlight?.current?.color).toBe("#123456");
    expect(parseCaptionStyle("zoom-in").ok).toBe(false);
  });

  it("legacy highlightFromParams maps P47 keys", () => {
    const h = highlightFromParams({ pendingOpacity: 0.4, highlightColor: "#20d5ec", currentScale: 0.08 });
    expect(h.pending?.opacity).toBe(0.4);
    expect(h.current?.color).toBe("#20d5ec");
    expect(h.current?.scale).toBe(0.08);
  });
});

import { describe, expect, it } from "vitest";
import {
  clampWordTimes, evenSplitWords, isContinuousScript, nudgeWordAt, parseWordsJson,
  scaleWordTimes, tokenizeWords, wordAlignPrompt, wordIndexAt, wordPhaseAt,
} from "./wordTiming";

describe("P47 word timing", () => {
  it("tokenizes spaced text into words and CJK into characters", () => {
    expect(tokenizeWords("Hello world")).toEqual(["Hello", "world"]);
    expect(isContinuousScript("你好世界")).toBe(true);
    expect(tokenizeWords("你好世界")).toEqual(["你", "好", "世", "界"]);
  });

  it("even-splits across the cue duration", () => {
    const w = evenSplitWords("One two three", 3);
    expect(w.map((x) => x.text)).toEqual(["One", "two", "three"]);
    expect(w[0].atSec).toBe(0);
    expect(w[1].atSec).toBeCloseTo(1, 2);
    expect(w[2].atSec).toBeCloseTo(2, 2);
  });

  it("scales and clamps when the cue is stretched", () => {
    const base = evenSplitWords("A B", 2);
    const scaled = scaleWordTimes(base, 2, 4);
    expect(scaled[1].atSec).toBeCloseTo(base[1].atSec * 2, 2);
    expect(clampWordTimes([{ text: "x", atSec: -1 }, { text: "y", atSec: 9 }], 2).map((w) => w.atSec)).toEqual([0, 1.98]);
  });

  it("nudges a word without crossing neighbours", () => {
    const w = [{ text: "a", atSec: 0 }, { text: "b", atSec: 1 }, { text: "c", atSec: 2 }];
    expect(nudgeWordAt(w, 1, -0.5, 3)[1].atSec).toBe(0.5);
    expect(nudgeWordAt(w, 1, -5, 3)[1].atSec).toBe(0);
    expect(nudgeWordAt(w, 1, 5, 3)[1].atSec).toBe(2);
  });

  it("resolves current / pending / spoken phases", () => {
    const w = evenSplitWords("A B C", 3);
    expect(wordIndexAt(w, -0.1)).toBe(-1);
    expect(wordPhaseAt(w, 0, 0)).toBe("current");
    expect(wordPhaseAt(w, 1, 0)).toBe("pending");
    expect(wordPhaseAt(w, 0, 1.1)).toBe("spoken");
    expect(wordPhaseAt(w, 1, 1.1)).toBe("current");
  });

  it("builds an align prompt and parses pasted words JSON", () => {
    const prompt = wordAlignPrompt({ text: "Hi there", cueDurationSec: 2, audioDurationSec: 2.5, audioName: "VO" });
    expect(prompt).toContain("Hi");
    expect(prompt).toContain("2.5");
    const ok = parseWordsJson('```json\n{"words":[{"text":"Hi","atSec":0},{"text":"there","atSec":0.8}]}\n```');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.words).toEqual([{ text: "Hi", atSec: 0 }, { text: "there", atSec: 0.8 }]);
    expect(parseWordsJson("nope").ok).toBe(false);
  });
});

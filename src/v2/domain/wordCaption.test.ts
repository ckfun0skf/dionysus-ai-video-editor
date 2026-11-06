import { describe, expect, it } from "vitest";
import { evenSplitWords } from "./wordTiming";
import { textOf } from "./text";
import { applyWordHighlight, evenSplitCueWords, expandWordPop, setCueTimes, setCueWords } from "./subtitleLayer";
import { newId, TEXT_SOURCE, type Composition, type Placement } from "./model";

const TPS = 120_000;
function textCue(text: string, durSec = 3): { comp: Composition; id: string } {
  const id = newId("plc");
  const pl: Placement = {
    id, startTicks: 0, durationTicks: durSec * TPS, sourceInTicks: 0, source: TEXT_SOURCE, clipType: "text",
    text: textOf({ text }),
  };
  const comp: Composition = { id: "c", name: "c", tracks: [{ id: "t", name: "Subtitles", kind: "text", placements: [pl] }] };
  return { comp, id };
}

describe("P47 caption word modes", () => {
  it("even-splits and applies word-highlight on one cue", () => {
    const { comp, id } = textCue("Hello world friends", 3);
    const next = applyWordHighlight(evenSplitCueWords(comp, id), id);
    const pl = next.tracks[0].placements[0];
    expect(pl.text?.animIn).toBe("word-highlight");
    expect(pl.text?.words?.map((w) => w.text)).toEqual(["Hello", "world", "friends"]);
  });

  it("expands word-pop into one short clip per word", () => {
    const { comp, id } = textCue("One two three", 3);
    const withWords = setCueWords(comp, id, evenSplitWords("One two three", 3));
    const next = expandWordPop(withWords, id, "pop");
    const texts = next.tracks[0].placements.map((p) => p.text?.text);
    expect(texts).toEqual(["One", "two", "three"]);
    expect(next.tracks[0].placements.every((p) => p.text?.animIn === "pop")).toBe(true);
    expect(next.tracks[0].placements[0].startTicks).toBe(0);
  });

  it("scales word times when the cue length changes", () => {
    const { comp, id } = textCue("A B", 2);
    const withWords = setCueWords(comp, id, evenSplitWords("A B", 2));
    const stretched = setCueTimes(withWords, id, 0, 4 * TPS);
    const words = stretched.tracks[0].placements[0].text?.words ?? [];
    expect(words[1].atSec).toBeGreaterThan(1.5);
  });
});

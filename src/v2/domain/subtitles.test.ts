import { describe, expect, it } from "vitest";
import { compositionDuration, createProject, type Composition } from "./model";
import * as subs from "./subtitles";

const S = 120000;
const SRT = "\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\nworld\r\n\r\n2\r\n00:01:00.25 --> 00:01:01,000\r\nSecond\r\n\r\nbroken block\r\n";
const comp = (): Composition => Object.values(createProject().compositions)[0];

describe("subtitles", () => {
  it("parses SRT (CRLF, BOM, dot millis, multi-line) and skips junk", () => {
    const list = subs.parseSrt(SRT);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ startTicks: S, durationTicks: 1.5 * S, text: "Hello\nworld" });
    expect(list[1].startTicks).toBe(60.25 * S);
  });
  it("round-trips through formatSrt", () => {
    const out = subs.formatSrt(subs.parseSrt(SRT));
    expect(out).toContain("1\n00:00:01,000 --> 00:00:02,500\nHello\nworld\n");
    expect(subs.parseSrt(out).map((s) => [s.startTicks, s.durationTicks, s.text])).toEqual(subs.parseSrt(SRT).map((s) => [s.startTicks, s.durationTicks, s.text]));
  });
  it("adds without overlap, updates, removes, and counts toward duration", () => {
    let c = subs.addSubtitle(comp(), { id: "b", startTicks: 4 * S, durationTicks: 3 * S, text: "B" });
    c = subs.addSubtitle(c, { id: "a", startTicks: 2 * S, durationTicks: 3 * S, text: "A" });
    expect(c.subtitles!.map((s) => [s.id, s.durationTicks])).toEqual([["a", 2 * S], ["b", 3 * S]]);
    expect(subs.addSubtitle(c, { id: "x", startTicks: 5 * S, durationTicks: S, text: "X" })).toBe(c);
    expect(compositionDuration(c)).toBe(7 * S);
    expect(subs.subtitleAt(c, 2.5 * S)?.id).toBe("a");
    c = subs.updateSubtitle(c, "a", { text: "A2", startTicks: -5 });
    expect(c.subtitles![0]).toMatchObject({ text: "A2", startTicks: 0 });
    expect(subs.removeSubtitle(c, "a").subtitles).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { alignedLineStartX, revealOntoLines } from "./text";

describe("alignedLineStartX (P46)", () => {
  const bw = 200;
  it("left starts at the left edge of the content box", () => {
    expect(alignedLineStartX("left", bw, 80)).toBe(-100);
    expect(alignedLineStartX("left", bw, 200)).toBe(-100);
  });
  it("center starts so the finished line is centered (LTR from that x)", () => {
    expect(alignedLineStartX("center", bw, 80)).toBe(-40);
    expect(alignedLineStartX("center", bw, 200)).toBe(-100);
    // Partial draw uses the same start: prefix grows rightward without recentering.
    const start = alignedLineStartX("center", bw, 80);
    expect(start + 30).toBe(-10); // caret/end of a 30px prefix stays left of center until the line fills
  });
  it("right starts at rightEdge - fullLineWidth so typing grows toward the right edge", () => {
    expect(alignedLineStartX("right", bw, 80)).toBe(20); // 100 - 80
    expect(alignedLineStartX("right", bw, 200)).toBe(-100); // 100 - 200
    const start = alignedLineStartX("right", bw, 80);
    expect(start + 80).toBe(100); // finished line ends on the right edge
  });
});

describe("revealOntoLines (P46)", () => {
  it("maps a prefix onto a single line", () => {
    expect(revealOntoLines(["Hello"], "Hel")).toEqual(["Hel"]);
    expect(revealOntoLines(["Hello"], "Hello")).toEqual(["Hello"]);
    expect(revealOntoLines(["Hello"], "")).toEqual([]);
  });
  it("maps hard newlines onto full lines without re-wrapping", () => {
    const all = ["AB", "CD"];
    expect(revealOntoLines(all, "A")).toEqual(["A"]);
    expect(revealOntoLines(all, "AB\n")).toEqual(["AB", ""]);
    expect(revealOntoLines(all, "AB\nC")).toEqual(["AB", "C"]);
    expect(revealOntoLines(all, "AB\nCD")).toEqual(["AB", "CD"]);
  });
  it("keeps empty paragraph lines", () => {
    expect(revealOntoLines(["A", "", "B"], "A\n\nB")).toEqual(["A", "", "B"]);
    expect(revealOntoLines(["A", "", "B"], "A\n\n")).toEqual(["A", "", ""]);
  });
  it("consumes soft-wrap glue spaces that wrapLines dropped between lines", () => {
    const all = ["Hello", "world"];
    expect(revealOntoLines(all, "Hello world")).toEqual(["Hello", "world"]);
    expect(revealOntoLines(all, "Hello wor")).toEqual(["Hello", "wor"]);
    expect(revealOntoLines(all, "Hel")).toEqual(["Hel"]);
    expect(revealOntoLines(all, "Hello ")).toEqual(["Hello", ""]); // glue crossed; caret on next line
  });
  it("accepts scramble glyphs that differ from the full line but keep length/structure", () => {
    expect(revealOntoLines(["SEATTLE"], "SE9TTL")).toEqual(["SE9TTL"]);
    expect(revealOntoLines(["AB", "CD"], "A9\nC")).toEqual(["A9", "C"]);
  });
});

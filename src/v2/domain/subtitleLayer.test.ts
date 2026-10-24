import { describe, expect, it } from "vitest";
import { Engine, cmd } from "../engine";
import { createProject, type Project } from "./model";
import { parseSrt } from "./subtitles";
import { activeCue, countMatches, cuesOf, fmtTc, layerToSrt, MIN_CUE, parseTc } from "./subtitleLayer";

const S = 120_000;
const root = (p: Project) => p.compositions[p.rootCompositionId];
const SRT = "1\n00:00:00,000 --> 00:00:02,000\nHello world\n\n2\n00:00:02,500 --> 00:00:04,000\nSecond, line\nwith break\n\n3\n01:02:03,045 --> 01:02:04,999\nLast\n";
function setup() {
  const e = new Engine(createProject("x"));
  e.dispatch(cmd.importSrtLayer(parseSrt(SRT), "sub"));
  const track = () => root(e.getState().project).tracks.find((t) => t.id === "sub")!;
  const cs = () => cuesOf(track());
  return { e, track, cs };
}

describe("subtitle list editor (V2-104)", () => {
  it("SRT export round-trips import exactly", () => {
    const { track } = setup();
    const out = layerToSrt(track());
    expect(out.trim()).toBe(SRT.trim());
    const again = parseSrt(out).map(({ id: _i, ...r }) => r);
    expect(again).toEqual(parseSrt(SRT).map(({ id: _i, ...r }) => r));
  });
  it("typing in one session is one undo step and keeps other style keys", () => {
    const { e, cs, track } = setup();
    const id = cs()[0].id;
    e.dispatch(cmd.updateText(id, { color: "#f00" }));
    e.beginGesture();
    for (const t of ["H", "Hi", "Hi!"]) e.dispatch(cmd.setCueText(id, t));
    e.endGesture();
    expect(cs()[0].text).toBe("Hi!");
    expect(track().placements.find((p) => p.id === id)!.text).toMatchObject({ color: "#f00", text: "Hi!" });
    e.undo();
    expect(cs()[0].text).toBe("Hello world");
  });
  it("timing edits clamp to neighbours and the minimum length", () => {
    const { e, cs } = setup();
    const [a, b] = cs();
    e.dispatch(cmd.setCueTimes(a.id, 0, 10 * S));
    expect(cs()[0].durationTicks).toBe(b.startTicks);
    e.dispatch(cmd.setCueTimes(b.id, 3 * S, 3 * S));
    expect(cs()[1]).toMatchObject({ startTicks: 3 * S, durationTicks: MIN_CUE });
  });
  it("add after, delete, split at cursor, merge next — one undo step each", () => {
    const { e, cs } = setup();
    const a = cs()[0].id;
    e.dispatch(cmd.addCueAfter(a, "n1"));
    expect(cs()[1]).toMatchObject({ id: "n1", startTicks: 2 * S, durationTicks: S / 2, text: "" });
    e.dispatch(cmd.deleteCue("n1"));
    expect(cs().length).toBe(3);
    e.dispatch(cmd.splitCue(a, 5, "sp"));
    expect(cs().slice(0, 2).map((c) => c.text)).toEqual(["Hello", "world"]);
    expect(cs()[1].startTicks).toBe(Math.round((2 * S * 5) / 11));
    e.dispatch(cmd.mergeCueNext(a));
    expect(cs()[0]).toMatchObject({ text: "Hello world", startTicks: 0, durationTicks: 2 * S });
    e.undo(); expect(cs().length).toBe(4);
    e.undo(); expect(cs().length).toBe(3); expect(cs()[0].text).toBe("Hello world");
    e.undo(); e.undo(); expect(cs().length).toBe(3);
  });
  it("find & replace across the layer, case-insensitive by default, literal", () => {
    const { e, cs, track } = setup();
    expect(countMatches(track(), "l")).toBe(5);
    e.dispatch(cmd.replaceInLayer("sub", "LINE", "row"));
    expect(cs()[1].text).toBe("Second, row\nwith break");
    e.dispatch(cmd.replaceInLayer("sub", ".", "!"));
    expect(cs()[0].text).toBe("Hello world");
    e.undo(); expect(cs()[1].text).toContain("line");
  });
  it("timecodes and the active cue", () => {
    expect(fmtTc(2.5 * S)).toBe("00:02.500");
    expect(parseTc("00:02.500")).toBe(2.5 * S);
    expect(parseTc("1:02:03,045")).toBe(Math.round(3723.045 * S));
    expect(parseTc("abc")).toBeUndefined();
    const { track, cs } = setup();
    expect(activeCue(track(), 3 * S)).toBe(cs()[1].id);
    expect(activeCue(track(), 2.2 * S)).toBeUndefined();
  });
});

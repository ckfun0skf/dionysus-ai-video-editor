import { describe, expect, it } from "vitest";
import { EXAMPLE_STORYBOARD, storyboardSystemPrompt, story } from ".";

const ex = () => JSON.parse(JSON.stringify(EXAMPLE_STORYBOARD));
const errs = (v: unknown) => { const r = story.validateStoryboard(v); return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`); };

describe("storyboard JSON", () => {
  it("the bundled example is valid and round-trips", () => {
    const r = story.parseStoryboard(JSON.stringify(EXAMPLE_STORYBOARD));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.doc).toEqual(EXAMPLE_STORYBOARD); expect(r.warnings).toEqual([]); }
    expect(story.storySummary(EXAMPLE_STORYBOARD)).toBe("3 shots · 15s · 4 assets (1 last-frame link) · 16 QA checks · 1 layer · 1 effect · 1 transition");
  });
  it("the system prompt embeds the format and a parseable example", () => {
    const p = storyboardSystemPrompt();
    expect(p).toContain(story.STORYBOARD_FORMAT);
    expect(story.parseStoryboard(p.slice(p.indexOf("EXAMPLE"))).ok).toBe(true);
  });
  it("extracts JSON from code fences and chat text", () => {
    const j = JSON.stringify(EXAMPLE_STORYBOARD);
    expect(story.parseStoryboard("Here you go:\n```json\n" + j + "\n```\nEnjoy!").ok).toBe(true);
    expect(story.parseStoryboard("Sure! " + j + " Hope it helps").ok).toBe(true);
  });
  it("pinpoints common AI JSON mistakes consistently", () => {
    expect(story.jsonSyntaxError('{"a": 1,}')).toEqual({ pos: 8, message: "remove the comma before }" });
    expect(story.jsonSyntaxError('{"a": [1 2]}')?.message).toMatch(/missing comma/);
    expect(story.jsonSyntaxError("{'a': 1}")?.message).toMatch(/double quotes/);
    expect(story.jsonSyntaxError('{"a": 1} // done')?.message).toMatch(/after the end/);
    expect(story.jsonSyntaxError('{"a": "x')?.message).toMatch(/closing/);
    expect(story.jsonSyntaxError('{"a": [1, 2], "b": {"c": null}}')).toBeUndefined();
    const r = story.parseStoryboard('{\n  "shots": [\n    1,\n  ]\n}');
    expect(!r.ok && r.errors[0].message).toMatch(/^Not valid JSON at line 4, column 3: remove the comma before \]/);
  });

  it("reports JSON syntax errors with a line and column", () => {
    const r = story.parseStoryboard('{\n  "format": "dionysus.storyboard/1",\n  "meta": { "title": "x", },\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toMatch(/Not valid JSON( at line 3, column \d+)?/);
    expect(story.parseStoryboard("   ").ok).toBe(false);
  });
  it("gives path-addressed errors for bad references, sources, durations and ids", () => {
    const d = ex();
    d.shots[1].assets.push("ghost");
    d.assets[3].source = { type: "lastFrame", shot: "s9" };
    d.shots[0].durationSec = 0;
    d.shots[2].id = "s1";
    d.assets[0].prompt = "";
    d.assets[1].type = "place";
    const e = errs(d);
    expect(e).toEqual(expect.arrayContaining([
      expect.stringMatching(/^shots\[1\]\.assets\[3\]: Unknown asset "ghost"/),
      expect.stringMatching(/^assets\[3\]\.source\.shot: Unknown shot "s9"/),
      expect.stringMatching(/^shots\[0\]\.durationSec: Duration 0/),
      expect.stringMatching(/^shots\[2\]\.id: Duplicate shot id "s1"/),
      expect.stringMatching(/^assets\[0\]\.prompt: .*needs a generation "prompt"/),
      expect.stringMatching(/^assets\[1\]\.type: Type "place" must be one of/),
    ]));
  });
  it("rejects self and circular last-frame dependencies; warns on backwards ones", () => {
    const self = ex(); self.assets[3].source.shot = "s2";
    expect(errs(self).join("\n")).toMatch(/can't use its own last frame/);
    const loop = ex();
    loop.assets.push({ id: "s2-end", name: "x", type: "frame", source: { type: "lastFrame", shot: "s2" }, qa: [] });
    loop.shots[0].assets.push("s2-end");
    expect(errs(loop).join("\n")).toMatch(/Last-frame links form a loop: (s1 → s2 → s1|s2 → s1 → s2)/);
    const back = ex();
    back.assets[3].source.shot = "s3"; back.connections = [];
    const r = story.validateStoryboard(back);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.message).join()).toMatch(/comes later in the order/);
  });
  it("rejects reference loops and unknown format versions", () => {
    const d = ex(); d.assets[0].references = ["cliff"]; d.assets[1].references = ["keeper"];
    expect(errs(d).join()).toMatch(/reference each other in a loop/);
    expect(errs({ ...ex(), format: "dionysus.storyboard/9" }).join()).toMatch(/Unsupported format/);
    expect(errs([])).toEqual([": The storyboard must be a JSON object { … }."]);
  });
  it("fills defaults: aspect, connections (continuity when using the previous last frame), names", () => {
    const d = ex(); delete d.connections; delete d.format; delete d.meta.aspect; delete d.assets[2].aspect; delete d.assets[2].name;
    const r = story.validateStoryboard(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.meta.aspect).toBe("16:9");
    expect(r.doc.assets[2]).toMatchObject({ aspect: "16:9", name: "lantern" });
    expect(r.doc.connections).toEqual([{ from: "s1", to: "s2", kind: "continuity" }, { from: "s2", to: "s3", kind: "cut" }]);
    expect(r.warnings.map((w) => w.path)).toEqual(["format", "meta.aspect"]);
  });
  it("finds cycles in a dependency map", () => {
    expect(story.findCycle(new Map([["a", ["b"]], ["b", ["c"]], ["c", []]]))).toBeUndefined();
    expect(story.findCycle(new Map([["a", ["b"]], ["b", ["a"]]]))).toEqual(["a", "b", "a"]);
  });
});

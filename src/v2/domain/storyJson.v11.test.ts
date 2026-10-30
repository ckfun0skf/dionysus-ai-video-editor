/** Storyboard format v1.1 (docs/v2/STORYBOARD_FORMAT.md §4): every warning, fallback and hard error, plus the ep01 fixture. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { story } from ".";

const fixtureText = readFileSync(resolve(__dirname, "__fixtures__/ep01_opening.storyboard.json"), "utf8");
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): J => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "bg", name: "Background", type: "image", prompt: "plain blue", qa: [] },
    { id: "logo", name: "Logo", type: "html", prompt: "spinning 3D logo", qa: [] },
    { id: "broll", name: "B-roll", type: "video", source: "upload", qa: [] },
    { id: "hero", name: "Hero", type: "character", prompt: "hero sheet", qa: [] },
  ],
  shots: [
    { id: "s1", title: "One", durationSec: 4, prompt: "a walk", assets: ["hero", "broll"], qa: [] },
    { id: "s2", title: "Two", durationSec: 4, render: "still", clip: "bg", assets: ["bg"], qa: [] },
    { id: "s3", title: "Three", durationSec: 4, render: "html", clip: "logo", assets: ["logo"], qa: [] },
  ],
  connections: [{ from: "s1", to: "s2", kind: "cut" }, { from: "s2", to: "s3", kind: "cut" }],
});
const run = (mut: (d: J) => void) => { const d = base(); mut(d); return story.validateStoryboard(d); };
const errsOf = (mut: (d: J) => void) => { const r = run(mut); return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`); };
const warnsOf = (mut: (d: J) => void) => { const r = run(mut); expect(r.ok, JSON.stringify(r.ok ? "" : r.errors)).toBe(true); return r.warnings.map((w) => `${w.path}: ${w.message}`); };
const docOf = (mut: (d: J) => void) => { const r = run(mut); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };
const text = (over: J = {}): J => ({ id: "t1", type: "text", text: "Hello", startSec: 0, endSec: 2, position: { x: 0.5, y: 0.5 }, ...over });

describe("storyboard v1.1: the ep01 fixture", () => {
  it("imports cleanly with the expected structure", () => {
    const r = story.parseStoryboard(fixtureText);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    const { doc } = r;
    expect(story.storySummary(doc)).toBe("12 shots · 72s · 11 assets · 85 QA checks · 2 layers · 1 effect · 2 transitions · 3 audio cues");
    expect(doc.meta.textStyles).toEqual({ "ata-title": { font: "serif", size: 0.09, color: "#ffffff", align: "center", bold: false, letterSpacing: 0.25, shadow: { color: "#000000", blur: 0.3, x: 0, y: 0.03 } } });
    const s03 = doc.shots.find((s) => s.id === "s03")!;
    expect(s03).toMatchObject({ render: "still", clip: "card-still", effects: [{ preset: "ken-burns", params: {} }] });
    expect(s03.layers).toEqual([{ id: "s03-card-text", type: "text", text: "You may also enjoy: kintsugi.", startSec: 0.5, endSec: 6, box: { x: 0.37, y: 0.42, width: 0.3, height: 0.12 }, textStyle: "plain", style: { font: "serif", size: 0.035, color: "#3a3a3a", align: "center" }, anim: { in: "fade", durationSec: 0.6 }, follow: "shot", blend: "multiply", opacity: 0.9 }]);
    const s07 = doc.shots.find((s) => s.id === "s07")!;
    expect(s07).toMatchObject({ render: "still", clip: "title-bg" });
    expect(s07.layers?.[0]).toMatchObject({ id: "s07-title", text: "ALLOTMENT", startSec: 0.5, endSec: 5.5, position: { x: 0.5, y: 0.5 }, textStyle: "ata-title", anim: { in: "fade", out: "fade", durationSec: 0.8 } });
    expect(doc.shots.filter((s) => s.render).map((s) => s.id)).toEqual(["s03", "s07"]);
    expect(doc.connections.filter((c) => c.transition).map((c) => [c.from, c.to, c.transition!.preset, c.transition!.params?.durationSec])).toEqual([["s06", "s07", "dip", 0.5], ["s07", "s08", "crossfade", 0.8]]);
  });
  it("round-trips: re-validating the imported doc gives the same doc", () => {
    const r = story.parseStoryboard(fixtureText);
    if (!r.ok) throw new Error("fixture invalid");
    const again = story.validateStoryboard(JSON.parse(JSON.stringify(r.doc)));
    expect(again.ok && again.doc).toEqual(r.doc);
  });
});

describe("storyboard v1.1: valid shapes", () => {
  it("html assets, still and html renders, all layer types, captions, effects and transitions", () => {
    const doc = docOf((d) => {
      d.shots[0].dialogue = "Hi there"; d.shots[0].captions = true;
      d.shots[0].layers = [
        text({ textStyle: "caption", style: { font: "mono", size: 0.05, color: "#ffcc00", align: "left", bold: 700 }, anim: { in: "pop", out: "fade", loop: "pulse", durationSec: 0.4 } }),
        { id: "h", type: "html", asset: "logo", startSec: 1, endSec: 3, box: { x: 0.7, y: 0.05, width: 0.25, height: 0.25 } },
        { id: "i", type: "image", asset: "hero", startSec: 0, endSec: 4, box: { x: 0, y: 0, width: 0.2, height: 0.2 } },
        { id: "v", type: "video", asset: "broll", startSec: 2, endSec: 4, box: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } },
      ];
      d.shots[0].effects = [{ preset: "ken-burns", params: { zoom: 0.3 } }, { preset: "bw", startSec: 1, endSec: 2 }];
      d.connections[0].transition = { preset: "crossfade", params: { durationSec: 0.8 } };
      d.connections[1].transition = { preset: "dip@1" };
    });
    const s1 = doc.shots[0];
    expect(s1.captions).toBe(true);
    expect(s1.layers?.map((l) => l.type)).toEqual(["text", "html", "image", "video"]);
    expect(s1.layers?.[0]).toMatchObject({ style: { bold: true, font: "mono" } });
    expect(s1.effects).toEqual([{ preset: "ken-burns", params: { zoom: 0.3 } }, { preset: "bw", startSec: 1, endSec: 2 }]);
    expect(doc.shots[1]).toMatchObject({ render: "still", clip: "bg", prompt: "" });
    expect(doc.shots[2]).toMatchObject({ render: "html", clip: "logo" });
    expect(doc.connections[1].transition).toEqual({ preset: "dip@1" });
    expect(doc.assets[1].type).toBe("html");
  });
  it("a v1.0 file stays valid and unchanged (no new fields appear)", () => {
    const d = base(); d.shots = [d.shots[0]]; d.shots[0].assets = ["hero"]; d.assets = [d.assets[3]]; d.connections = [];
    const r = story.validateStoryboard(d);
    expect(r.ok && Object.keys(r.doc.shots[0]).sort()).toEqual(["assets", "description", "durationSec", "id", "prompt", "qa", "title"]);
  });
  it("prompt is optional for html and still shots but required for ai shots", () => {
    expect(errsOf((d) => { delete d.shots[0].prompt; })).toEqual(['shots[0].prompt: Shot "s1" needs a clip generation "prompt".']);
    expect(errsOf((d) => { d.shots[0].render = "ai"; d.shots[0].prompt = ""; })).toHaveLength(1);
  });
});

describe("storyboard v1.1: warnings and fallbacks (never reject)", () => {
  it("unknown presets warn, fall back and keep the original id", () => {
    const w = warnsOf((d) => {
      d.shots[0].layers = [text({ textStyle: "sparkle", anim: { in: "spin", out: "melt", loop: "orbit" } })];
      d.shots[0].effects = [{ preset: "grain" }];
      d.connections[0].transition = { preset: "star-wipe" };
    });
    expect(w.join("\n")).toMatch(/shots\[0\]\.layers\[0\]\.textStyle: Unknown text style "sparkle"; using "plain"/);
    expect(w.join("\n")).toMatch(/anim\.in: Unknown in animation "spin"; using no animation/);
    expect(w.join("\n")).toMatch(/anim\.out: Unknown out animation "melt"/);
    expect(w.join("\n")).toMatch(/anim\.loop: Unknown loop animation "orbit"/);
    expect(w.join("\n")).toMatch(/shots\[0\]\.effects\[0\]\.preset: Unknown effect "grain"; using no effect/);
    expect(w.join("\n")).toMatch(/connections\[0\]\.transition\.preset: Unknown transition "star-wipe"; using a cut \(the id is kept for export\)\. Known: crossfade, dip, dip-white/);
    const doc = docOf((d) => { d.shots[0].effects = [{ preset: "grain" }]; d.connections[0].transition = { preset: "star-wipe" }; d.shots[0].layers = [text({ textStyle: "sparkle" })]; });
    expect(doc.shots[0].effects?.[0].preset).toBe("grain");
    expect(doc.connections[0].transition?.preset).toBe("star-wipe");
    expect((doc.shots[0].layers?.[0] as { textStyle?: string }).textStyle).toBe("sparkle");
  });
  it("id@N resolves to the current version and warns when N differs", () => {
    expect(warnsOf((d) => { d.shots[0].effects = [{ preset: "ken-burns@1" }]; })).toEqual([]);
    const w = warnsOf((d) => { d.shots[0].effects = [{ preset: "ken-burns@2" }]; });
    expect(w).toEqual(['shots[0].effects[0].preset: "ken-burns@2" asks for version 2, but "ken-burns" is version 1 now; using the current version.']);
    expect(docOf((d) => { d.shots[0].effects = [{ preset: "ken-burns@2" }]; }).shots[0].effects?.[0].preset).toBe("ken-burns@2");
  });
  it("a transition between shots that are not adjacent warns and plays as a cut", () => {
    const w = warnsOf((d) => { d.connections.push({ from: "s1", to: "s3", kind: "cut", transition: { preset: "dip" } }); });
    expect(w).toEqual(['connections[2].transition: "s1" and "s3" are not next to each other, so this transition is played as a cut (it is kept for export).']);
  });
  it("trackMotion warns and is dropped; blend (V2-SB-128) is kept", () => {
    const w = warnsOf((d) => { d.shots[0].layers = [text({ blend: "screen", trackMotion: { target: "face" } })]; });
    expect(w).toEqual(['shots[0].layers[0].trackMotion: "trackMotion" is not supported yet; it is ignored.']);
    expect(docOf((d) => { d.shots[0].layers = [text({ blend: "screen" })]; }).shots[0].layers![0]).toMatchObject({ blend: "screen" });
  });
  it("captions without dialogue warn", () => {
    expect(warnsOf((d) => { d.shots[0].captions = true; })).toEqual(['shots[0].captions: captions is on but shot "s1" has no "dialogue"; nothing will be captioned.']);
  });
  it("clip on an ai shot warns and is ignored", () => {
    expect(warnsOf((d) => { d.shots[0].clip = "bg"; })).toEqual(['shots[0].clip: "clip" only applies to render "html" or "still"; it is ignored for this AI-generated shot.']);
  });
  it("an unknown font warns (falls back to sans)", () => {
    expect(warnsOf((d) => { d.shots[0].layers = [text({ style: { font: "Helvetica Neue" } })]; })[0]).toMatch(/^shots\[0\]\.layers\[0\]\.style\.font: Unknown font "Helvetica Neue"; using "sans"\. Fonts: sans, serif, mono, impact, rounded, hand, script, condensed\./);
  });
  it("a meta.textStyles id that clashes with a registry style warns and the local one wins", () => {
    const w = warnsOf((d) => { d.meta.textStyles = { caption: { font: "serif" } }; d.shots[0].layers = [text({ textStyle: "caption" })]; });
    expect(w).toEqual(['meta.textStyles.caption: "caption" is also a built-in text style; this storyboard\'s own style is used.']);
  });
  it("local text styles are valid textStyle references", () => {
    expect(warnsOf((d) => { d.meta.textStyles = { "my-title": { font: "impact", size: 0.12 } }; d.shots[0].layers = [text({ textStyle: "my-title" })]; })).toEqual([]);
  });
  it("bad style values warn and are dropped; extra keys pass through", () => {
    const r = run((d) => { d.meta.textStyles = { x: { size: 48, color: "white", align: "middle", bold: "heavy", letterSpacing: 0.1 } }; });
    expect(r.ok && r.warnings.map((w) => w.path)).toEqual(["meta.textStyles.x.size", "meta.textStyles.x.color", "meta.textStyles.x.align", "meta.textStyles.x.bold"]);
    expect(r.ok && r.doc.meta.textStyles).toEqual({ x: { letterSpacing: 0.1 } });
    expect(docOf((d) => { d.meta.textStyles = { x: { bold: 400 } }; }).meta.textStyles?.x.bold).toBe(false);
  });
  it("warns when text likely overflows its box or the frame (no wrapping)", () => {
    const box = { x: 0.1, y: 0.1, width: 0.1, height: 0.1 };
    expect(warnsOf((d) => { d.shots[0].layers = [text({ position: undefined, box, text: "A much too long line for this box" })]; })[0]).toMatch(/^shots\[0\]\.layers\[0\]\.text: The text is about [\d.]+ of the frame wide but the box is 0\.1; it may overflow/);
    expect(warnsOf((d) => { d.shots[0].layers = [text({ text: "THIS TITLE IS FAR TOO LONG FOR ONE LINE", style: { size: 0.12 } })]; })[0]).toMatch(/may run off screen/);
    // size fitted to the box height when style.size is absent: a short word in a roomy box fits.
    expect(warnsOf((d) => { d.shots[0].layers = [text({ position: undefined, box: { x: 0.2, y: 0.4, width: 0.6, height: 0.15 }, text: "Hello" })]; })).toEqual([]);
  });
  it("bad params warn; out-of-range numbers will be clamped", () => {
    const w = warnsOf((d) => { d.shots[0].effects = [{ preset: "ken-burns", params: { zoom: 5, speed: 2, pan: "x" } }]; });
    expect(w).toEqual([
      'shots[0].effects[0].params.zoom: Param "zoom" = 5 is outside 0–1; it will be clamped.',
      'shots[0].effects[0].params.speed: "ken-burns" has no param "speed"; it is ignored. Params: zoom, pan.',
      'shots[0].effects[0].params.pan: Param "pan" should be a number; using the default 0.05.',
    ]);
  });
  it("transition durationSec must be positive; otherwise the 0.5 s default applies", () => {
    const r = run((d) => { d.connections[0].transition = { preset: "dip", params: { durationSec: -1 } }; });
    expect(r.ok && r.warnings.map((w) => w.message)).toEqual(["durationSec -1 is ignored; using 0.5 s."]);
    expect(r.ok && r.doc.connections[0].transition).toEqual({ preset: "dip", params: {} });
    expect(story.DEFAULT_TRANSITION_SEC).toBe(0.5);
  });
  it("anim durationSec longer than half the layer warns", () => {
    expect(warnsOf((d) => { d.shots[0].layers = [text({ anim: { in: "fade", durationSec: 1.5 } })]; })[0]).toMatch(/In \+ out \(3 s\) is longer than the layer \(2 s\)/);
  });
  it("assets only used as clip or layer asset are not reported as unused", () => {
    expect(warnsOf((d) => { d.shots[0].assets = ["hero"]; d.shots[1].assets = []; d.shots[2].assets = []; d.shots[0].layers = [{ id: "v", type: "video", asset: "broll", startSec: 0, endSec: 1, box: { x: 0, y: 0, width: 1, height: 1 } }]; })).toEqual([]);
  });
});

describe("storyboard v1.1: hard errors (path-addressed)", () => {
  it("unknown asset ids in clip, layer asset and assets", () => {
    expect(errsOf((d) => { d.shots[1].clip = "nope"; })[0]).toMatch(/^shots\[1\]\.clip: Unknown asset "nope"/);
    expect(errsOf((d) => { d.shots[0].layers = [{ id: "i", type: "image", asset: "ghost", startSec: 0, endSec: 1, box: { x: 0, y: 0, width: 1, height: 1 } }]; })[0]).toMatch(/^shots\[0\]\.layers\[0\]\.asset: Unknown asset "ghost"/);
    expect(errsOf((d) => { d.shots[0].assets = ["hero", "missing"]; })[0]).toMatch(/^shots\[0\]\.assets\[1\]: Unknown asset "missing"/);
  });
  it("a clip of the wrong asset type for its render", () => {
    expect(errsOf((d) => { d.shots[1].clip = "logo"; })).toEqual(['shots[1].clip: Render "still" needs an image asset, but "logo" is type html.']);
    expect(errsOf((d) => { d.shots[2].clip = "bg"; })).toEqual(['shots[2].clip: Render "html" needs an html asset, but "bg" is type image.']);
    expect(errsOf((d) => { d.shots[1].clip = "hero"; })).toEqual(['shots[1].clip: Render "still" needs an image asset, but "hero" is type character.']);
  });
  it("a layer asset of the wrong type", () => {
    expect(errsOf((d) => { d.shots[0].layers = [{ id: "h", type: "html", asset: "bg", startSec: 0, endSec: 1, box: { x: 0, y: 0, width: 1, height: 1 } }]; })).toEqual(['shots[0].layers[0].asset: A html layer can\'t show asset "bg" (type image); it needs an html asset.']);
    expect(errsOf((d) => { d.shots[0].layers = [{ id: "v", type: "video", asset: "bg", startSec: 0, endSec: 1, box: { x: 0, y: 0, width: 1, height: 1 } }]; })[0]).toMatch(/needs a video asset/);
  });
  it("render html or still without clip, and an unknown render", () => {
    expect(errsOf((d) => { delete d.shots[1].clip; })).toEqual(['shots[1].clip: A render "still" shot needs "clip" (the id of an image asset) or "background" (a colour like "#101820" or a gradient).']);
    expect(errsOf((d) => { delete d.shots[2].clip; })).toEqual(['shots[2].clip: A render "html" shot needs "clip": the id of an html asset.']);
    expect(errsOf((d) => { d.shots[0].render = "3d"; })).toEqual(['shots[0].render: Render "3d" must be one of: ai, html, still.']);
  });
  it("a text layer with both or neither of position and box; media layers require box", () => {
    expect(errsOf((d) => { d.shots[0].layers = [text({ box: { x: 0, y: 0, width: 1, height: 1 } })]; })).toEqual(['shots[0].layers[0]: Give either "position" (text centre) or "box" (text area), not both.']);
    expect(errsOf((d) => { d.shots[0].layers = [text({ position: undefined })]; })).toEqual(['shots[0].layers[0]: A text layer needs "position" { x, y } (preferred) or "box" { x, y, width, height }.']);
    expect(errsOf((d) => { d.shots[0].layers = [{ id: "i", type: "image", asset: "bg", startSec: 0, endSec: 1 }]; })).toEqual(['shots[0].layers[0].box: A image layer needs "box" { x, y, width, height }.']);
    expect(errsOf((d) => { d.shots[0].layers = [{ id: "i", type: "html", asset: "logo", startSec: 0, endSec: 1, position: { x: 0.5, y: 0.5 } }]; })).toEqual(['shots[0].layers[0].position: html layers are placed with "box" { x, y, width, height }, not "position".']);
    expect(errsOf((d) => { d.shots[0].layers = [text({ position: { x: "mid" } })]; })[0]).toMatch(/^shots\[0\]\.layers\[0\]\.position: Should be \{ "x": 0\.5/);
    expect(errsOf((d) => { d.shots[0].layers = [text({ position: undefined, box: { x: 0, y: 0, width: 0, height: 0.1 } })]; })).toEqual(["shots[0].layers[0].box: Box width and height must be greater than 0."]);
  });
  it("time ranges: endSec <= startSec, endSec > durationSec, startSec < 0, missing times", () => {
    expect(errsOf((d) => { d.shots[0].layers = [text({ startSec: 2, endSec: 2 })]; })).toEqual(["shots[0].layers[0].endSec: endSec 2 must be after startSec 2."]);
    expect(errsOf((d) => { d.shots[0].layers = [text({ endSec: 5 })]; })).toEqual(["shots[0].layers[0].endSec: endSec 5 is past the end of the shot (durationSec 4)."]);
    expect(errsOf((d) => { d.shots[0].layers = [text({ startSec: -1 })]; })).toEqual(["shots[0].layers[0].startSec: startSec -1 can't be negative."]);
    expect(errsOf((d) => { d.shots[0].layers = [text({ startSec: undefined })]; })).toEqual(['shots[0].layers[0].startSec: Needs "startSec" (seconds from the start of the shot).']);
    expect(errsOf((d) => { d.shots[0].effects = [{ preset: "bw", startSec: 3, endSec: 1 }]; })).toEqual(["shots[0].effects[0].endSec: endSec 1 must be after startSec 3."]);
    expect(errsOf((d) => { d.shots[0].effects = [{ preset: "bw", startSec: 4 }]; })).toEqual(["shots[0].effects[0].endSec: endSec 4 must be after startSec 4."]);
  });
  it("duplicate layer ids within a shot (the same id in another shot is fine)", () => {
    expect(errsOf((d) => { d.shots[0].layers = [text(), text()]; })).toEqual(['shots[0].layers[1].id: Duplicate layer id "t1".']);
    expect(errsOf((d) => { d.shots[0].layers = [text()]; d.shots[1].layers = [text()]; })).toEqual([]);
  });
  it("other structural errors", () => {
    expect(errsOf((d) => { d.shots[0].layers = [{ id: "x", type: "sticker", startSec: 0, endSec: 1 }]; })).toEqual(['shots[0].layers[0].type: Layer type "sticker" must be one of: text, html, image, video.']);
    expect(errsOf((d) => { d.shots[0].layers = [text({ text: " " })]; })).toEqual(['shots[0].layers[0].text: A text layer needs "text".']);
    expect(errsOf((d) => { d.shots[0].effects = [{ params: {} }]; })[0]).toMatch(/^shots\[0\]\.effects\[0\]\.preset: An effect needs "preset": one of fade-in, fade-out, blur, ken-burns/);
    expect(errsOf((d) => { d.assets[1].source = { type: "lastFrame", shot: "s1" }; })).toContain('assets[1].source: An html asset can\'t be a last frame; use "generate" (the user asks their AI for the .html) or "upload".');
    expect(errsOf((d) => { d.assets[1].prompt = ""; })).toEqual(['assets[1].prompt: Asset "logo" is html, so its "prompt" must be a design brief for the user\'s AI (what it shows and how it moves).']);
    expect(errsOf((d) => { d.meta.textStyles = "big"; })[0]).toMatch(/^meta\.textStyles: Should be an object/);
  });
  it("errors point at the right place in the pasted text", () => {
    const d = base(); d.shots[0].layers = [text({ endSec: 9 })];
    const json = JSON.stringify(d, null, 2);
    const r = story.parseStoryboard(json);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const loc = story.locateIssue(json, r.errors[0])!;
    expect(json.slice(loc.start, loc.end)).toBe('"endSec": 9');
  });
});

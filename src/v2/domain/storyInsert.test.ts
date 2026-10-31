import { describe, expect, it } from "vitest";
import { LANTERN_KEEPER } from "./__fixtures__/lanternKeeper";
import { runStoryTool } from "./storyAgent";
import { applyInsertJson, rawDoc, buildInsertPrompt, EXAMPLE_INSERT, INSERT_RULE_KEYS } from "./storyInsert";
import { validateStoryboard } from "./storyJson";
import { ruleNumber } from "./storyPrompt";

const doc = (() => { const r = validateStoryboard(LANTERN_KEEPER); if (!r.ok) throw new Error("fixture"); return r.doc; })();
const json = (o: unknown) => JSON.stringify(o);
const ex = () => structuredClone(EXAMPLE_INSERT) as unknown as { schema: string; insertAfter: string; shots: Record<string, unknown>[]; newAssets: Record<string, unknown>[] };

describe("buildInsertPrompt", () => {
  const p = buildInsertPrompt(doc, "s2", "The keeper lights the lamp.", new Set(["keeper"]));
  it("has the description, the task and the neighbours", () => {
    expect(p).toContain("The keeper lights the lamp.");
    expect(p).toContain("insert one or more shots after shot s2 (shot 2 of 3)");
    expect(p).toMatch(/s1 "Climbing the cliff path": clip s1-clip, 5s/);
    expect(p).toMatch(/s2 "Lighting the lamp": clip s2-clip, 6s, dialogue: One more night\./);
  });
  it("lists every asset and clip with generated or not, and asks to reuse", () => {
    for (const id of ["keeper", "cliff", "lantern", "s1-end", "s1-clip", "s2-clip", "s3-clip"]) expect(p).toContain(`- ${id} (`);
    expect(p).toContain("- keeper (character, generated)");
    expect(p).toContain("- cliff (location, not generated yet)");
    expect(p).toMatch(/Reuse existing assets and clips whenever possible/);
  });
  it("quotes the guide rules by number and the strict format", () => {
    for (const k of INSERT_RULE_KEYS) expect(p).toContain(`\n${ruleNumber(k)}. `);
    expect(p).toContain('{"schema":"3.1-insert","insertAfter":"s2","shots":[...],"newAssets":[...]}');
  });
  it("rejects an unknown shot", () => { expect(() => buildInsertPrompt(doc, "nope", "x")).toThrow(/Unknown shot/); });
});

describe("applyInsertJson", () => {
  it("inserts after the target, adds new assets and classifies new vs reused clips", () => {
    const r = applyInsertJson(doc, `Here you go:\n\`\`\`json\n${json(EXAMPLE_INSERT)}\n\`\`\``, { expectAfter: "s2", generated: new Set(["s2-clip"]) });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.doc.shots.map((s) => s.id)).toEqual(["s1", "s2", "s2b", "s2c", "s3"]);
    expect((rawDoc(r.doc).assets as { id: string }[]).some((a) => a.id === "s2b-clip")).toBe(true);
    expect(r.doc.connections.find((c) => c.to === "s3")?.from).toBe("s2c");
    expect(r.preview.shots.map((s) => [s.id, s.clip, s.durationSec, s.clipNew])).toEqual([["s2b", "s2b-clip", 3, true], ["s2c", "s2-clip", 2.5, false]]);
    const a = Object.fromEntries(r.preview.assets.map((x) => [x.id, x]));
    expect(a["s2b-clip"]).toMatchObject({ isNew: true, generated: false, usedBy: ["s2b"] });
    expect(a["s2-clip"]).toMatchObject({ isNew: false, generated: true });
    expect(a.keeper).toMatchObject({ isNew: false, generated: false });
  });
  it("reports envelope errors", () => {
    const r = applyInsertJson(doc, json({ ...ex(), schema: "3.1", insertAfter: "zz", shots: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.path)).toEqual(["schema", "insertAfter", "shots"]);
    expect(applyInsertJson(doc, "not json").ok).toBe(false);
  });
  it("rejects a different target, existing shot ids and existing assets in newAssets", () => {
    const e = ex(); e.shots[0].id = "s3"; e.newAssets.push({ id: "keeper", type: "character", name: "x", prompt: "x" });
    const r = applyInsertJson(doc, json(e), { expectAfter: "s1" });
    if (r.ok) throw new Error("expected errors");
    const m = r.errors.map((x) => x.message).join("\n");
    expect(m).toMatch(/Expected "s1"/); expect(m).toMatch(/Shot id "s3" already exists/); expect(m).toMatch(/Asset "keeper" already exists/);
  });
  it("reuses the storyboard validator: unknown ids and duplicate ids", () => {
    const e = ex(); e.shots[1].clip = "ghost-clip";
    const r = applyInsertJson(doc, json(e));
    expect(r.ok).toBe(false); if (r.ok) return;
    expect(r.errors.map((x) => x.message).join("\n")).toMatch(/ghost-clip/);
    const d = ex(); d.shots[1].id = "s2b";
    const r2 = applyInsertJson(doc, json(d));
    expect(r2.ok).toBe(false); if (r2.ok) return;
    expect(r2.errors.map((x) => x.message).join("\n")).toMatch(/s2b/);
    expect(r2.errors.some((x) => /^shots "s2b"/.test(x.path) || /^shots\[/.test(x.path))).toBe(true);
  });
  it("warns about a prompt on a shot and a frameOf reference without frameDesc", () => {
    const e = ex(); e.shots[1].prompt = "A prompt on the shot";
    const w = applyInsertJson(doc, json(e));
    expect(w.warnings.map((x) => x.message).join("\n")).toMatch(/prompt/i);
    const f = ex(); f.newAssets[0].references = [{ frameOf: "s1", atSec: 2, role: "start" }];
    const r = applyInsertJson(doc, json(f));
    expect([...(r.ok ? [] : r.errors), ...r.warnings].map((x) => x.message).join("\n")).toMatch(/frameDesc/);
  });
  it("only reports warnings the insert brings in", () => {
    const r = applyInsertJson(doc, json(EXAMPLE_INSERT));
    expect(r.warnings.map((w) => w.path)).toEqual(['assets "s2-clip".camera']);
  });
});

describe("plan_insert_shots tool", () => {
  const ctx = { guide: () => "" };
  it("returns the prompt without insertJson", () => {
    const r = runStoryTool("plan_insert_shots", { after: "s2" }, doc, ctx);
    expect(r.ok).toBe(true); expect(r.doc).toBeUndefined();
    expect(r.text).toContain(doc.shots[1].description.slice(0, 20));
  });
  it("applies insertJson as one doc change", () => {
    const r = runStoryTool("plan_insert_shots", { after: "s2", insertJson: EXAMPLE_INSERT }, doc, ctx);
    expect(r.ok).toBe(true); expect(r.doc!.shots.map((s) => s.id)).toEqual(["s1", "s2", "s2b", "s2c", "s3"]);
    expect(r.label).toBe("AI: insert 2 shot(s) after s2");
    expect(runStoryTool("plan_insert_shots", { after: "s1", insertJson: EXAMPLE_INSERT }, doc, ctx).ok).toBe(false);
  });
});

describe("P22: error scope (only the insert blocks)", () => {
  // A board with pre-existing problems that the app allows: a generated asset without a prompt, a text layer that
  // ends past its (shortened) shot, blank AI shots, and an html title card.
  const messy = (() => {
    const raw = structuredClone(LANTERN_KEEPER) as unknown as { assets: Record<string, unknown>[] };
    raw.assets.push({ id: "title-card", name: "Title card", type: "html", prompt: "Animated title card." });
    const r = validateStoryboard(raw); if (!r.ok) throw new Error("fixture");
    const d = structuredClone(r.doc);
    d.assets.push({ ...d.assets.find((a) => a.id === "keeper")!, id: "news-2", name: "News 2", prompt: "" });
    const s3 = d.shots.find((s) => s.id === "s3")!;
    s3.layers = [{ id: "t1", type: "text", text: "Dawn", startSec: 0, endSec: s3.durationSec + 3 } as never];
    for (const id of ["s4", "s5"]) d.shots.push({ id, title: `Blank ${id}`, description: "", durationSec: 2, prompt: "", assets: [], qa: [] });
    return d;
  })();
  const ins = (o: Record<string, unknown>) => applyInsertJson(messy, json({ ...ex(), insertAfter: "s5", ...o }), { expectAfter: "s5" });
  const shot = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, description: "x", durationSec: 2, clip: "s2-clip", inSec: 0, ...extra });

  it("does not block on pre-existing issues and lists them separately", () => {
    const r = ins({ shots: [shot("s6")], newAssets: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const paths = r.existing.map((i) => i.path).join("\n");
    expect(paths).toMatch(/assets "news-2"\.prompt/);
    expect(paths).toMatch(/shots "s3"\.layers\[0\]\.endSec/);
    expect(r.warnings.map((w) => w.path).join()).not.toMatch(/news-2|"s3"/);
    expect(r.doc.shots.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
  });
  it("blank AI shots are a to-do, not an error, and stay unchanged", () => {
    const r = ins({ shots: [shot("s6")], newAssets: [] });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect([...r.existing, ...r.warnings].some((i) => /"s4"\.clip|"s5"\.clip/.test(i.path))).toBe(false);
    const s4 = r.doc.shots.find((s) => s.id === "s4")!;
    expect(s4.needsPrompt).toBeUndefined();
    expect(s4.prompt).toBe("");
  });
  it("still blocks on errors in the inserted shots and new assets", () => {
    const r = ins({ shots: [shot("s6", { durationSec: 999 })], newAssets: [{ id: "n1", type: "video", name: "N", prompt: "" }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.every((e) => /"s6"|"n1"/.test(e.path))).toBe(true);
    expect(r.errors.some((e) => /"s6"/.test(e.path))).toBe(true);
    expect(r.existing.length).toBeGreaterThan(0);
  });
  it("an error in an existing asset the insert uses becomes a warning", () => {
    const r = ins({ shots: [shot("s6", { clip: "s6-clip" })], newAssets: [{ id: "s6-clip", type: "video", name: "C", prompt: "References: Image 1 = news. A desk.", assets: ["news-2"] }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => /news-2/.test(w.path) && /existing asset this insert uses/.test(w.message))).toBe(true);
    expect(r.existing.some((i) => /news-2/.test(i.path))).toBe(false);
  });
  it("an html asset as an AI shot's clip is an error with a fix, and render html is accepted", () => {
    const bad = ins({ shots: [shot("s6", { clip: "title-card" })], newAssets: [] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0].message).toMatch(/is type html\. To show it as the whole shot set "render": "html"/);
    const good = ins({ shots: [{ id: "s6", title: "Card", description: "x", durationSec: 2, render: "html", clip: "title-card" }], newAssets: [] });
    expect(good.ok).toBe(true);
  });
  it("the prompt lists asset types and says an AI shot's clip must be a video asset", () => {
    const p = buildInsertPrompt(messy, "s5", "x");
    expect(p).toContain("ASSET TYPES AND WHERE THEY GO:");
    expect(p).toContain('A shot without "render" is an AI shot, so its "clip" MUST be a "video" asset.');
    expect(p).toMatch(/"render": "html"/);
    expect(p).toContain("- title-card (html");
  });
});

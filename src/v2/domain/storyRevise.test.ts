/** P36: Revise with AI (3.1-revise) and Edit with AI (3.1-shot-revise). */
import { describe, expect, it } from "vitest";
import { LANTERN_KEEPER } from "./__fixtures__/lanternKeeper";
import { runStoryTool } from "./storyAgent";
import { rawDoc } from "./storyInsert";
import { applyReviseJson, buildRevisePrompt, REVISE_RULE_KEYS } from "./storyRevise";
import { validateStoryboard } from "./storyJson";
import { ruleNumber } from "./storyPrompt";

const doc = (() => { const r = validateStoryboard(LANTERN_KEEPER); if (!r.ok) throw new Error("fixture"); return r.doc; })();
type R = Record<string, unknown>;
const shot = (id: string) => structuredClone((rawDoc(doc).shots as R[]).find((s) => s.id === id)!);
const asset = (id: string) => structuredClone((rawDoc(doc).assets as R[]).find((a) => a.id === id)!);
const J = (o: unknown) => JSON.stringify(o);

describe("buildRevisePrompt", () => {
  it("whole storyboard: the brief, the full JSON, the rules and the strict format", () => {
    const p = buildRevisePrompt(doc, "The ending is too abrupt.", new Set(["s1-clip"]));
    expect(p).toContain("The ending is too abrupt.");
    expect(p).toContain('"id":"s3"');
    expect(p).toContain("GENERATED ALREADY: s1-clip.");
    for (const k of REVISE_RULE_KEYS) expect(p).toContain(`\n${ruleNumber(k)}. `);
    expect(p).toContain('{"schema":"3.1-revise","shots":[...],"add":[{"after":"<shot id>","shots":[...]}],"remove":["<shot id>"],"assets":[...],"newAssets":[...]}');
  });
  it("one shot: only that shot, its clip and its neighbours", () => {
    const p = buildRevisePrompt(doc, "Unclear action.", new Set(), "s2");
    expect(p).toContain("THE SHOT (s2, shot 2 of 3)");
    expect(p).toContain("ITS CLIP (s2-clip)");
    expect(p).toContain('{"schema":"3.1-shot-revise","shotId":"s2","shot":{...},"assets":[...],"newAssets":[...]}');
    expect(() => buildRevisePrompt(doc, "x", new Set(), "nope")).toThrow(/Unknown shot/);
  });
});

describe("applyReviseJson", () => {
  it("changes, adds and removes shots by id in order; untouched shots stay as they were", () => {
    const s2 = { ...shot("s2"), title: "Lamp lit at last" };
    const r = applyReviseJson(doc, J({ schema: "3.1-revise", shots: [s2], add: [{ after: "s1", shots: [{ id: "s1b", title: "Pause", description: "He catches his breath.", durationSec: 2, clip: "s1-clip", inSec: 1 }] }], remove: ["s3"] }));
    if (!r.ok) throw new Error(J(r.errors));
    expect(r.doc.shots.map((s) => s.id)).toEqual(["s1", "s1b", "s2"]);
    expect(r.doc.shots.find((s) => s.id === "s2")!.title).toBe("Lamp lit at last");
    expect(r.doc.shots[0]).toEqual(doc.shots[0]);
    expect(r.preview).toMatchObject({ changed: ["s2"], added: ["s1b"], removed: ["s3"] });
  });
  it("flags generated clips whose prompt changed for regeneration", () => {
    const c = { ...asset("s2-clip"), prompt: "A brand new picture of the lamp." };
    const r = applyReviseJson(doc, J({ schema: "3.1-revise", assets: [c] }), { generated: new Set(["s2-clip"]) });
    if (!r.ok) throw new Error(J(r.errors));
    expect(r.preview.regenerate).toEqual(["s2-clip"]);
  });
  it("rejects unknown ids, new shots in shots, nothing changed and a wrong schema", () => {
    const bad = (o: unknown, re: RegExp) => { const r = applyReviseJson(doc, J(o)); expect(r.ok).toBe(false); expect(J(!r.ok && r.errors)).toMatch(re); };
    bad({ schema: "3.1-revise", shots: [{ id: "zz" }] }, /new shots go in \\"add\\"/);
    bad({ schema: "3.1-revise", remove: ["zz"] }, /Unknown shot/);
    bad({ schema: "3.1-revise" }, /changes nothing/);
    bad({ schema: "3.1-insert", remove: ["s3"] }, /must be \\"3.1-revise\\"/);
    bad({ schema: "3.1-revise", newAssets: [asset("keeper")] }, /already exists/);
  });
  it("blocks only problems in what it changes", () => {
    const s2 = { ...shot("s2"), clip: "keeper" };
    const r = applyReviseJson(doc, J({ schema: "3.1-revise", shots: [s2] }));
    expect(r.ok).toBe(false);
    expect(J(!r.ok && r.errors)).toContain('shots \\"s2\\"');
  });
  it("shot revise: keeps the id and only changes that shot", () => {
    const s3 = { ...shot("s3"), description: "Dawn breaks over a calm sea." };
    const r = applyReviseJson(doc, J({ schema: "3.1-shot-revise", shotId: "s3", shot: s3 }), { shotId: "s3" });
    if (!r.ok) throw new Error(J(r.errors));
    expect(r.doc.shots.find((s) => s.id === "s3")!.description).toBe("Dawn breaks over a calm sea.");
    expect(r.doc.shots.slice(0, 2)).toEqual(doc.shots.slice(0, 2));
    const w = applyReviseJson(doc, J({ schema: "3.1-shot-revise", shotId: "s2", shot: s3 }), { shotId: "s3" });
    expect(w.ok).toBe(false);
  });
});

describe("revise_storyboard (WebMCP)", () => {
  it("returns the prompt without JSON and applies a valid answer", () => {
    const ctx = { generated: new Set<string>() } as never;
    const p = runStoryTool("revise_storyboard", { brief: "Tighten it", shotId: "s2" }, doc, ctx);
    expect(p.ok).toBe(true);
    expect(p.text).toContain("3.1-shot-revise");
    const s2 = { ...shot("s2"), title: "New title" };
    const r = runStoryTool("revise_storyboard", { shotId: "s2", reviseJson: { schema: "3.1-shot-revise", shotId: "s2", shot: s2 } }, doc, ctx);
    expect(r.ok).toBe(true);
    expect(runStoryTool("revise_storyboard", {}, doc, ctx).ok).toBe(false);
  });
});

/**
 * V2-SB-114: the published planner files must match what the registry generates. Run `npm run gen:ai` to refresh them
 * after changing presets, fonts, the rules or the example.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listPresets } from "../registry";
import { aiGuideFiles, presetsJson, storyboardGuideMarkdown } from "./aiGuide";
import { EXAMPLE_STORYBOARD, GUIDE_KINDS, GUIDE_URL, RULES, storyboardShortPrompt, storyboardSystemPrompt } from "./storyPrompt";
import { validateStoryboard } from "./storyJson";

const root = resolve(__dirname, "../../..");
const update = !!process.env.UPDATE_AI_GUIDE;

describe("AI planner guide (V2-SB-114)", () => {
  it.each(Object.entries(aiGuideFiles()))("%s is up to date (npm run gen:ai)", (rel, content) => {
    const file = resolve(root, rel);
    if (update) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); }
    expect(existsSync(file), `${rel} is missing; run npm run gen:ai`).toBe(true);
    expect(readFileSync(file, "utf8"), `${rel} is stale; run npm run gen:ai`).toBe(content);
  });

  it("lists every storyboard preset id with its description and param defaults", () => {
    const md = storyboardGuideMarkdown();
    for (const { kind } of GUIDE_KINDS) for (const d of listPresets(kind)) {
      expect(md).toContain(`- ${d.id}: ${d.description}`);
      for (const p of d.params) expect(md).toContain(`default ${p.type === "number" ? p.default : JSON.stringify(p.default)}`);
    }
    expect(md).not.toContain("arrow-right"); // stickers are not storyboard fields
    const json = JSON.parse(presetsJson());
    expect(json.kinds.videoEffect.presets.find((p: { id: string }) => p.id === "ken-burns").params[0]).toMatchObject({ key: "zoom", default: 0.25 });
  });

  it("the full prompt inlines the guide with RULES 1-12; the short prompt links to it", () => {
    const full = storyboardSystemPrompt();
    for (const s of ["FORMAT (", "PRESETS", "RULES", "EXAMPLE", `12. ${RULES[11]}`, "- crossfade:", "- ken-burns:"]) expect(full).toContain(s);
    expect(RULES).toHaveLength(12);
    const short = storyboardShortPrompt();
    expect(short).toContain(GUIDE_URL);
    expect(short).toContain("Full prompt");
    expect(short.length).toBeLessThan(1500);
  });

  it("the example imports with no warnings and uses v1.1 fields", () => {
    const r = validateStoryboard(EXAMPLE_STORYBOARD);
    expect(r.ok && r.warnings).toEqual([]);
    expect(JSON.stringify(EXAMPLE_STORYBOARD)).toContain('"transition"');
  });
});

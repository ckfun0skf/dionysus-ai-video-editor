/**
 * V2-SB-114: the published planner files must match what the registry generates. Run `npm run gen:ai` to refresh them
 * after changing presets, fonts, the rules or the example.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listPresets } from "../registry";
import { aiGuideFiles, FORMAT_DOC_SOURCE, llmsTxt, presetsJson, storyboardGuideHtml, storyboardGuideMarkdown } from "./aiGuide";
import { aiLinks, DEFAULT_SITE_URL } from "./siteUrl";
import { EXAMPLE_STORYBOARD, GUIDE_KINDS, RULES, storyboardShortPrompt, storyboardSystemPrompt } from "./storyPrompt";
import { validateStoryboard } from "./storyJson";

const root = resolve(__dirname, "../../..");
const update = !!process.env.UPDATE_AI_GUIDE;
const formatDoc = readFileSync(resolve(root, FORMAT_DOC_SOURCE), "utf8");

describe("AI planner guide (V2-SB-114)", () => {
  it.each(Object.entries(aiGuideFiles(DEFAULT_SITE_URL, formatDoc)))("%s is up to date (npm run gen:ai)", (rel, content) => {
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
    const fade = json.kinds.videoEffect.presets.find((p: { id: string }) => p.id === "fade-in").params[0];
    expect(fade.description).toMatch(/fraction of the effect.s time range, not seconds/);
    expect(md).toContain("length 0.05–1, default 0.5 (fraction of the effect's time range, not seconds");
  });

  it("the full prompt inlines the guide with RULES 1-16; the short prompt links to it", () => {
    const full = storyboardSystemPrompt();
    for (const s of ["FORMAT (", "PRESETS", "RULES", "EXAMPLE", `14. ${RULES[13]}`, "not seconds", "START FRAME", "\"references\"?", "\"genDurationSec\"?", "- crossfade:", "- ken-burns:"]) expect(full).toContain(s);
    expect(RULES).toHaveLength(16);
    const short = storyboardShortPrompt();
    expect(short).toContain(aiLinks(DEFAULT_SITE_URL).guide); // outside a browser the prompt links to the configured site
    expect(short).toContain("Full prompt");
    expect(short.length).toBeLessThan(1500);
    expect(short).toContain('"durationSec": 4, "genDurationSec": 6');
    expect(full).toContain('"durationSec": 4, "genDurationSec": 6');
    expect(full).not.toContain("match what the video model can generate");
    expect(EXAMPLE_STORYBOARD.shots.some((s) => s.genDurationSec !== undefined && s.genDurationSec > s.durationSec)).toBe(true);
  });

  it("the example imports with no warnings and uses v1.1 fields", () => {
    const r = validateStoryboard(EXAMPLE_STORYBOARD);
    expect(r.ok && r.warnings).toEqual([]);
    expect(JSON.stringify(EXAMPLE_STORYBOARD)).toContain('"transition"');
  });
});

describe("AI links follow the configured site URL (V2-OPS-LINKS)", () => {
  const SITE = "https://video.example.com/editor/";

  it("every generated file links to the given site, and the spec is published next to the guide", () => {
    const files = aiGuideFiles(SITE, formatDoc);
    for (const [rel, content] of Object.entries(files)) {
      expect(content, rel).not.toContain("github.io");
      expect(content, rel).not.toContain("github.com");
    }
    const md = storyboardGuideMarkdown(SITE);
    expect(md).toContain(`(${SITE}?v2)`);
    expect(md).toContain(`Machine-readable presets: ${SITE}ai/presets.json.`);
    expect(md).toContain(`Full format reference: ${SITE}ai/STORYBOARD_FORMAT.md.`);
    expect(JSON.parse(presetsJson(SITE)).guide).toBe(`${SITE}ai/storyboard-guide.md`);
    for (const p of ["ai/storyboard-guide.md", "ai/storyboard-guide.html", "ai/presets.json", "ai/STORYBOARD_FORMAT.md", "?v2"]) expect(llmsTxt(SITE)).toContain(`(${SITE}${p})`);
    expect(storyboardGuideHtml(SITE)).toContain('<link rel="alternate" type="text/markdown" href="storyboard-guide.md">');
    expect(files["public/ai/STORYBOARD_FORMAT.md"]).toBe(formatDoc);
  });

  it("only the site URL differs between deployments", () => {
    const def = aiGuideFiles(DEFAULT_SITE_URL, formatDoc);
    const other = aiGuideFiles(SITE, formatDoc);
    for (const rel of Object.keys(def)) expect(other[rel], rel).toBe(def[rel].split(DEFAULT_SITE_URL).join(SITE));
  });

  it("the short prompt links to the site it is given", () => {
    const short = storyboardShortPrompt(aiLinks(SITE));
    expect(short).toContain(`guide: ${SITE}ai/storyboard-guide.md`);
    expect(short).toContain(`${SITE}ai/storyboard-guide.html`);
    expect(short).toContain(`${SITE}ai/presets.json`);
    expect(short).not.toContain("github.io");
  });
});

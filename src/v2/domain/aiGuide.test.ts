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
import { CHOOSING_PRESETS, EXAMPLE_STORYBOARD, GUIDE_KINDS, HOW_IT_WORKS, presetsByCategory, RULE_LIST, RULES, ruleNumber, storyboardShortPrompt, storyboardSystemPrompt } from "./storyPrompt";
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

  it("the full prompt inlines the guide with RULES 1-20; the short prompt links to it", () => {
    const full = storyboardSystemPrompt();
    for (const s of ["FORMAT (", "PRESETS", "RULES", "EXAMPLE", `14. ${RULES[13]}`, "not seconds", "START FRAME", "\"references\"?", "\"genDurationSec\"?", "- crossfade:", "- ken-burns:"]) expect(full).toContain(s);
    expect(RULES).toHaveLength(20);
    // V2-SB-125: audio cues: the format block, a rule and a worked example.
    expect(full).toContain('"audio"?: [ {');
    expect(full).toContain('"kind": "voiceover" | "music" | "sfx"');
    expect(full).toContain(`19. ${RULES[18]}`);
    expect(RULES[18]).toContain('{ "asset": "score", "kind": "music", "from": "s1", "to": "s6", "volume": 0.3, "fadeOutSec": 2 }');
    expect(RULES[18]).toMatch(/sound effect sits at the moment in one shot \("atSec"\) with no "to"/);
    // V2-SB-126: fixed vs following layers: the format lines, a rule and a worked example that imports cleanly.
    expect(full).toContain('"follow"?: "frame" | "shot" }      // default "frame" (fixed)');
    expect(full).toContain(`20. ${RULES[19]}`);
    const tag = JSON.parse(RULES[ruleNumber("layer-follow") - 1].match(/(\{ "id": "tag".*?"follow": "shot" \})/)![1]);
    expect(tag).toMatchObject({ type: "text", follow: "shot" });
    // V2-SB-124: keyframe then animate: the format line, a rule and a worked example.
    expect(full).toContain('"keyframe"?: { "prompt": string, "references"?:');
    expect(full).toContain(`18. ${RULES[17]}`);
    expect(RULES[17]).toMatch(/Image 1, the START FRAME/);
    expect(RULES[17]).toContain('"keyframe": { "prompt": "References:');
    // V2-SB-123: asset references can carry roles; the format, a rule and a worked example say so.
    expect(full).toContain('"references"?: (string | { "asset": "<asset id>", "role"?: "start-frame" | "identity" | "look" | "detail", "note"?: string })[]');
    expect(full).toContain(`17. ${RULES[16]}`);
    expect(RULES[16]).toMatch(/"start-frame" means the base image to edit/);
    expect(RULES[16]).toContain('"references": [{ "asset": "mug", "role": "detail", "note": "glaze and colour only" }, "hero"]');
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

describe("generic storyboard guide (V2-SB-GUIDE-GENERIC)", () => {
  const md = storyboardGuideMarkdown();
  const section = (title: string) => md.split(`\n## ${title}\n`)[1]?.split("\n## ")[0] ?? "";

  it("has generic sections in a fixed order, in both the guide and the full prompt", () => {
    const titles = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1].replace(/ \(.*$/, ""));
    expect(titles).toEqual(["HOW IT WORKS", "FORMAT", "CHOOSING PRESETS", "PRESETS", "RULES", "EXAMPLE"]);
    const full = storyboardSystemPrompt();
    let at = -1;
    for (const t of ["HOW IT WORKS", "FORMAT (", "CHOOSING PRESETS", "PRESETS\n", "RULES\n", "EXAMPLE\n"]) {
      const i = full.indexOf(t, at + 1);
      expect(i, t).toBeGreaterThan(at);
      at = i;
    }
    expect(full).toContain(HOW_IT_WORKS);
    expect(full).toContain(CHOOSING_PRESETS);
  });

  it("generates the catalogue from the descriptors, grouped by kind, then by category", () => {
    const presets = section("PRESETS");
    const blocks = presets.split("\n\n");
    for (const { kind, title } of GUIDE_KINDS) {
      const block = blocks.find((b) => b.startsWith(`${title} — `));
      expect(block, title).toBeDefined();
      const groups = presetsByCategory(kind);
      expect(groups.flatMap((g) => g.presets.map((d) => d.id)).sort()).toEqual(listPresets(kind).map((d) => d.id).sort());
      // Each category header appears once, in order, and is followed by exactly its presets.
      const lines = block!.split("\n").slice(1);
      const expected = groups.flatMap((g) => [`[${g.category}]`, ...g.presets.map((d) => `- ${d.id}:`)]);
      expect(lines.map((l) => (l.startsWith("[") ? l : l.slice(0, l.indexOf(":") + 1)))).toEqual(expected);
    }
    expect(presets).toContain("[Light]\n- glow: "); // a module's category shows up without touching the guide
    expect(presets).toMatch(/- glow: .* Use for: /); // and so do its planner hints
    const json = JSON.parse(presetsJson());
    expect(json.kinds.videoEffect.categories).toEqual(presetsByCategory("videoEffect").map((g) => g.category));
    expect(json.kinds.videoEffect.presets.find((p: { id: string }) => p.id === "glow")).toMatchObject({ category: "Light", ai: { use: expect.any(String) } });
  });

  it("keeps the generic sections story-neutral and the example short", () => {
    const generic = [HOW_IT_WORKS, CHOOSING_PRESETS, ...RULES, section("FORMAT")].join("\n").toLowerCase();
    for (const word of ["keeper", "lantern", "lighthouse", "allotment", "mara"]) expect(generic, word).not.toContain(word);
    for (const { kind } of GUIDE_KINDS) for (const d of listPresets(kind)) expect(CHOOSING_PRESETS).not.toContain(`"${d.id}"`);
    const ex = EXAMPLE_STORYBOARD;
    expect(JSON.stringify(ex).toLowerCase()).not.toMatch(/keeper|lantern|allotment/);
    expect(ex.shots.length).toBeLessThanOrEqual(4);
    // …but it still shows every part of the format a planner usually needs.
    expect(ex.assets.some((a) => typeof a.source === "object" && a.source.type === "lastFrame")).toBe(true);
    expect(ex.connections.some((c) => c.kind === "continuity")).toBe(true);
    expect(ex.shots.some((s) => s.references?.some((r) => r.role === "start-frame"))).toBe(true);
    expect(ex.shots.some((s) => s.layers?.some((l) => l.type === "text" && l.anim))).toBe(true);
    expect(ex.shots.some((s) => s.effects?.length)).toBe(true);
    expect(ex.shots.every((s) => s.prompt.startsWith("References:"))).toBe(true);
  });

  it("numbers the rules stably: append-only keys, and every RULE n the spec cites exists", () => {
    // Rule numbers are public (the spec, users, other AIs). Append new keys at the end; never reorder or delete.
    expect(RULE_LIST.slice(0, 20).map((r) => r.key)).toEqual([
      "reusable-assets", "standalone-prompts", "last-frame-continuity", "uploads", "qa-checks", "ids", "valid-json", "text-in-layers", "html-only-for-graphics",
      "transitions-and-effects", "known-presets", "param-units", "duration", "references-block", "transition-overlap", "identity-portrait", "asset-references", "keyframe", "audio", "layer-follow",
    ]);
    expect(new Set(RULE_LIST.map((r) => r.key)).size).toBe(RULE_LIST.length);
    RULE_LIST.forEach((r, i) => expect(section("RULES")).toContain(`${i + 1}. ${r.text}`));
    expect(ruleNumber("duration")).toBe(13);
    expect(ruleNumber("references-block")).toBe(14);
    expect(ruleNumber("asset-references")).toBe(17);
    expect(ruleNumber("audio")).toBe(19);
    expect(ruleNumber("layer-follow")).toBe(20);
    expect(RULES[ruleNumber("duration") - 1]).toMatch(/^"durationSec" is how long/);
    expect(RULES[ruleNumber("references-block") - 1]).toMatch(/"References:" block/);
    const cited = [...formatDoc.matchAll(/RULES? (\d+)(?:[-–](\d+))?/g)].flatMap((m) => [Number(m[1]), ...(m[2] ? [Number(m[2])] : [])]);
    expect(cited.length).toBeGreaterThan(0);
    for (const n of cited) expect(n, `STORYBOARD_FORMAT.md cites RULE ${n}`).toBeLessThanOrEqual(RULES.length);
    // The spec's copy of the rules matches the generated list.
    RULE_LIST.forEach((r, i) => expect(formatDoc, `rule ${i + 1} in STORYBOARD_FORMAT.md`).toContain(`${i + 1}. ${r.text}`));
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

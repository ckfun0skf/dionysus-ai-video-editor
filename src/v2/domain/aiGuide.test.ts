/**
 * V2-SB-114: the published planner files must match what the registry generates. Run `npm run gen:ai` to refresh them
 * after changing presets, fonts, the rules or the example.
 */
import { STORY_TOOLS, storyToolsMarkdown } from "./storyAgent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { listPresets } from "../registry";
import { aiGuideFiles, AUDIO_DOC_SOURCE, CLIP_DOC_SOURCE, FORMAT_DOC_SOURCE, llmsTxt, presetsJson, storyboardGuideHtml, storyboardGuideMarkdown } from "./aiGuide";
import { aiLinks, DEFAULT_SITE_URL } from "./siteUrl";
import { CHOOSING_PRESETS, EXAMPLE_STORYBOARD, exampleStoryboardJson, GUIDE_KINDS, HOW_IT_WORKS, presetsByCategory, RULE_LIST, RULES, ruleNumber, storyboardShortPrompt, storyboardSystemPrompt } from "./storyPrompt";
import { parseStoryboard, validateStoryboard, type StoryDoc } from "./storyJson";
import { storyboardFromDoc } from "./storyboard";
import { referencesBlock } from "./storyRefs";
import { AUDIO_CLIP_REFERENCE, audioClipExamples } from "./audioClipPrompt";
import { AUDIO_TEMPLATES, parseAudioClip } from "./audioClip";
import { CODE_WIZARD_DOC } from "./codeWizard";
import { HTML_CLIP_CONTRACT, HTML_CLIP_FORMAT, htmlClipTemplate, lintHtmlClip } from "./htmlClipPackage";

const root = resolve(__dirname, "../../..");
const update = !!process.env.UPDATE_AI_GUIDE;
const formatDoc = readFileSync(resolve(root, FORMAT_DOC_SOURCE), "utf8");
const clipDocPath = resolve(root, CLIP_DOC_SOURCE);
let clipDoc = readFileSync(clipDocPath, "utf8");
/** The doc's generated blocks (contract, template) are rewritten by `npm run gen:ai` and checked otherwise. */
const between = (doc: string, tag: string) => doc.split(`<!-- ${tag}:start -->\n`)[1]?.split(`\n<!-- ${tag}:end -->`)[0];
const CLIP_BLOCKS: Record<string, string> = { aimode: CODE_WIZARD_DOC, contract: HTML_CLIP_CONTRACT, template: `\`\`\`html\n${htmlClipTemplate()}\`\`\`` };
if (update) {
  for (const [tag, body] of Object.entries(CLIP_BLOCKS)) {
    const old = between(clipDoc, tag);
    if (old !== undefined) clipDoc = clipDoc.replace(`<!-- ${tag}:start -->\n${old}\n<!-- ${tag}:end -->`, `<!-- ${tag}:start -->\n${body}\n<!-- ${tag}:end -->`);
  }
  writeFileSync(clipDocPath, clipDoc);
}
const audioDocPath = resolve(root, AUDIO_DOC_SOURCE);
let audioDoc = readFileSync(audioDocPath, "utf8");
const AUDIO_BLOCKS: Record<string, string> = { reference: AUDIO_CLIP_REFERENCE, examples: audioClipExamples(AUDIO_TEMPLATES.map((t) => t.id)) };
if (update) {
  for (const [tag, body] of Object.entries(AUDIO_BLOCKS)) {
    const old = between(audioDoc, tag) ?? "";
    const from = old ? `<!-- ${tag}:start -->\n${old}\n<!-- ${tag}:end -->` : `<!-- ${tag}:start -->\n<!-- ${tag}:end -->`;
    audioDoc = audioDoc.replace(from, `<!-- ${tag}:start -->\n${body}\n<!-- ${tag}:end -->`);
  }
  writeFileSync(audioDocPath, audioDoc);
}

// P4C: the WebMCP doc's tool list is generated from the tool schema.
const mcpDocPath = resolve(root, "docs/v2/WEB_MCP.md");
let mcpDoc = readFileSync(mcpDocPath, "utf8");
const MCP_BLOCKS: Record<string, string> = { tools: storyToolsMarkdown() };
if (update) {
  for (const [tag, body] of Object.entries(MCP_BLOCKS)) {
    const old = between(mcpDoc, tag) ?? "";
    const from = old ? `<!-- ${tag}:start -->\n${old}\n<!-- ${tag}:end -->` : `<!-- ${tag}:start -->\n<!-- ${tag}:end -->`;
    mcpDoc = mcpDoc.replace(from, `<!-- ${tag}:start -->\n${body}\n<!-- ${tag}:end -->`);
  }
  writeFileSync(mcpDocPath, mcpDoc);
}
describe("WebMCP doc (P4C)", () => {
  it("lists the generated tools", () => {
    for (const [tag, body] of Object.entries(MCP_BLOCKS)) expect(between(mcpDoc, tag), `${tag} block`).toBe(body);
  });
  it("llms.txt describes every tool and the rules exist", () => {
    const txt = llmsTxt(DEFAULT_SITE_URL);
    for (const t of STORY_TOOLS) expect(txt).toContain(`\`${t.name}\``);
    expect(RULE_LIST.map((r) => r.key).slice(-7)).toEqual(["series-reuse", "series-promote", "series-tools", "effect-apply-to", "typewriter-cursor", "link-to-main", "fill-needs-prompt"]);
  });
});

describe("AI planner guide (V2-SB-114)", () => {
  it.each(Object.entries(aiGuideFiles(DEFAULT_SITE_URL, formatDoc, clipDoc, audioDoc)))("%s is up to date (npm run gen:ai)", (rel, content) => {
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

  it("the full prompt inlines the guide with RULES 1-37; the short prompt links to it", () => {
    const full = storyboardSystemPrompt();
    for (const s of ["FORMAT (", "PRESETS", "RULES", "EXAMPLE", `14. ${RULES[13]}`, "not seconds", "START FRAME", "\"references\"?", "\"genDurationSec\"?", "- crossfade:", "- ken-burns:"]) expect(full).toContain(s);
    expect(RULES).toHaveLength(47);
    // P6-FX-SCOPE: rule 44 (appended) documents shots[].effects[].applyTo.
    expect(full).toContain(`44. ${RULES[43]}`);
    // P7-TYPE-CURSOR: rule 45 (appended) documents layers[].anim.inParams (typewriter cursor) and the sci-fi fonts.
    expect(full).toContain(`45. ${RULES[44]}`);
    expect(RULES[43]).toContain('"applyTo": "all"');
    expect(full).toContain('"applyTo"?: "main" | "overlay" | "all"');
    // V2-SB-128: blend modes: the format lines, the blend catalogue and a rule with an example that imports cleanly.
    expect(full).toContain('"blend"?: "<blend id>", "opacity"?: number (0-1, default 1)');
    expect(full).toContain('Blend modes — shots[].layers[].blend');
    expect(full).toContain("- screen:");
    expect(full).toContain(`22. ${RULES[21]}`);
    const leak = JSON.parse(RULES[ruleNumber("blend-overlays") - 1].match(/(\{ "id": "leak".*?"opacity": 0\.7 \})/)![1]);
    expect(leak).toMatchObject({ type: "video", blend: "screen", opacity: 0.7 });
    // V2-SB-125: audio cues: the format block, a rule and a worked example.
    expect(full).toContain('"audio"?: [ {');
    expect(full).toContain('"kind": "voiceover" | "music" | "sfx"');
    expect(full).toContain(`19. ${RULES[18]}`);
    expect(RULES[18]).toContain('{ "asset": "score", "kind": "music", "from": "s1", "to": "s6", "volume": 0.3, "fadeOutSec": 2 }');
    expect(RULES[18]).toMatch(/sound effect sits at the moment in one shot \("atSec"\) with no "to"/);
    // V2-SB-127: text style extras: the TextStyle fields, the text effects catalogue and a rule with an example.
    expect(full).toContain('"shadow"?: { "color", "blur", "x", "y" } | null (fractions of font size)');
    expect(full).toContain(`21. ${RULES[20]}`);
    expect(RULES[20]).toContain('"style": { "color": "#ffffff", "strokeWidth": 0.06, "strokeColor": "#000000"');
    // V2-SB-126: fixed vs following layers: the format lines, a rule and a worked example that imports cleanly.
    expect(full).toContain('"follow"?: "frame" | "shot" }      // default "frame" (fixed)');
    expect(full).toContain(`20. ${RULES[19]}`);
    const tag = JSON.parse(RULES[ruleNumber("layer-follow") - 1].match(/(\{ "id": "tag".*?"follow": "shot" \})/)![1]);
    expect(tag).toMatchObject({ type: "text", follow: "shot" });
    // V2-SB-124: keyframe then animate: the format line, a rule and a worked example.
    expect(full).toContain('"keyframe"?: { "prompt": string, "references"?:');
    expect(full).toContain(`18. ${RULES[17]}`);
    expect(RULES[17]).toMatch(/Image 1 is always the keyframe, the START FRAME/);
    expect(RULES[17]).toContain('"keyframe": { "prompt": "References:');
    // V2-SB-123: asset references can carry roles; the format, a rule and a worked example say so.
    expect(full).toContain('"references"?: (string | { "asset": "<asset id>", "role"?: "start-frame" | "identity" | "look" | "detail", "note"?: string })[]');
    expect(full).toContain(`17. ${RULES[16]}`);
    expect(RULES[16]).toMatch(/"start-frame" means the base image to edit/);
    expect(RULES[16]).toContain('"references": [{ "asset": "mug", "role": "detail", "note": "glaze and colour only" }, "hero"]');
    // V2-HTML-PKG: an html asset's prompt is a design brief; the app adds the package instructions.
    expect(full).toContain(`23. ${RULES[22]}`);
    expect(RULES[ruleNumber("html-clip-package") - 1]).toContain(HTML_CLIP_FORMAT);
    expect(full).toContain('for "html": a design brief for the AI that writes the clip as one .html file');
    const short = storyboardShortPrompt();
    expect(short).toContain(aiLinks(DEFAULT_SITE_URL).guide); // outside a browser the prompt links to the configured site
    expect(short).toContain("Full prompt");
    expect(short.length).toBeLessThan(1500);
    expect(short).toContain('"durationSec": 4, "genDurationSec": 6');
    expect(full).toContain('"durationSec": 4, "genDurationSec": 6');
    expect(full).not.toContain("match what the video model can generate");
    expect(EXAMPLE_STORYBOARD.shots.some((s) => s.genDurationSec !== undefined && s.genDurationSec > s.durationSec)).toBe(true);
  });

  it("RULE 24 (V2-HTML-PARAMS): reuse one html asset with params for title and text-only cards; the example does", () => {
    const rule = RULES[ruleNumber("html-params") - 1];
    expect(rule).toMatch(/^Reuse one "html" asset with "params" instead of duplicating it/);
    for (const s of ["title cards", "text-only", '"render": "html"', '"type": "html"', '"params"']) expect(rule).toContain(s);
    expect(RULES[ruleNumber("text-in-layers") - 1]).toContain("RULE 24");
    expect(RULES[ruleNumber("html-only-for-graphics") - 1]).toContain("RULE 24");
    // The rule's own snippets are valid JSON.
    const shot = JSON.parse(rule.match(/(\{ "render": "html".*?\} \})/)![1]);
    expect(shot).toMatchObject({ render: "html", params: { text: "THE END" } });
    const layer = JSON.parse(rule.match(/(\{ "type": "html", "asset".*?"params": \{ "text": "5:58 AM" \} \})/)![1]);
    expect(layer).toMatchObject({ type: "html", params: { text: "5:58 AM" } });
    // The example reuses ONE html asset as a text-only shot and as a layer, each with its own values.
    const ex = EXAMPLE_STORYBOARD;
    const card = ex.assets.filter((a) => a.type === "html");
    expect(card).toHaveLength(1);
    expect(Object.keys(card[0].params ?? {})).toContain("text");
    expect(ex.shots.find((s) => s.render === "html" && s.clip === card[0].id)?.params?.text).toBe("THE END");
    expect(ex.shots.flatMap((s) => s.layers ?? []).find((l) => l.type === "html" && l.asset === card[0].id && l.params)).toBeDefined();
    const full = storyboardSystemPrompt();
    expect(full).toContain('"params"?: { "<key>": Param }');
    expect(full).toContain('"params"?: { "<key>": value },   // render "html" only');
  });

  it("RULE 30 (P2A): revised JSON is re-imported by id, so ids stay stable", () => {
    expect(RULE_LIST.slice(29, 30).map((r) => r.key)).toEqual(["stable-ids-reimport"]);
    expect(RULE_LIST.slice(30).map((r) => r.key)).toEqual(["self-contained-prompts", "reference-sheets", "html-code-refs", "shot-background", "lastframe-refs", "chroma-key", "audio-shaping", "audio-json", "long-story-parts", "web-mcp", "series-reuse", "series-promote", "series-tools", "effect-apply-to", "typewriter-cursor", "link-to-main", "fill-needs-prompt"]);
    expect(ruleNumber("typewriter-cursor")).toBe(45);
    // P9-LINK: rule 46 (appended) documents layers[].link / audio[].link = false.
    expect(ruleNumber("link-to-main")).toBe(46);
    expect(storyboardSystemPrompt()).toContain(`46. ${RULES[45]}`);
    // P10-SYNC: rule 47 (appended) tells the AI to fill needsPrompt items.
    expect(ruleNumber("fill-needs-prompt")).toBe(47);
    expect(storyboardSystemPrompt()).toContain(`47. ${RULES[46]}`);
    expect(RULES[46]).toMatch(/needsPrompt/);
    expect(ruleNumber("stable-ids-reimport")).toBe(30);
    expect(storyboardSystemPrompt()).toContain(`30. ${RULES[29]}`);
    expect(RULES[29]).toMatch(/re-imports it/);
    expect(RULES[29]).toMatch(/keep every id stable/);
  });

  it("RULE 29 (V2-SB-136): asset states; the example uses one and its rule quotes it", () => {
    expect(RULE_LIST.slice(28, 29).map((r) => r.key)).toEqual(["asset-states"]);
    expect(ruleNumber("asset-states")).toBe(29);
    const full = storyboardSystemPrompt();
    expect(full).toContain(`29. ${RULES[28]}`);
    expect(RULES[ruleNumber("reusable-assets") - 1]).toContain("(RULE 29)");
    expect(RULES[28]).toContain('"<asset id>@<state id>"');
    expect(RULES[28]).toContain('"assets": ["hill@sunrise", "s1.keyframe"]');
    expect(RULES[28]).toContain('"Image 1 (Hill road · Sunrise)"');
    const hill = EXAMPLE_STORYBOARD.assets.find((a) => a.id === "hill")!;
    expect(hill.states?.map((st) => st.id)).toEqual(["sunrise"]);
    expect(RULES[28]).toContain(JSON.stringify(hill.states![0].references![0]).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, "{ ").replace(/\}$/, " }"));
    const s3 = EXAMPLE_STORYBOARD.shots.find((s) => s.id === "s3")!;
    expect(s3.assets).toContain("hill@sunrise");
    expect(s3.prompt).toContain("Image 1 (Hill road · Sunrise)");
    expect(full).toContain('"states"?: [ { "id": string, "name"?: string, "prompt": string');
    expect(full).toContain('"<asset id>@<state id>" = that asset\'s state');
  });

  it("RULES 26-28 (V2-SB-135): keyframe references, ambience and stings, off-screen dialogue; the example uses each", () => {
    expect(RULE_LIST.slice(25, 28).map((r) => r.key)).toEqual(["keyframe-refs", "audio-ambience-sting", "offscreen-dialogue"]);
    expect(ruleNumber("keyframe-refs")).toBe(26);
    expect(ruleNumber("audio-ambience-sting")).toBe(27);
    expect(ruleNumber("offscreen-dialogue")).toBe(28);
    const full = storyboardSystemPrompt();
    for (const k of ["keyframe-refs", "audio-ambience-sting", "offscreen-dialogue"]) expect(full).toContain(`${ruleNumber(k)}. ${RULES[ruleNumber(k) - 1]}`);
    expect(RULES[ruleNumber("keyframe")- 1]).toContain("(RULE 26)");
    expect(RULES[ruleNumber("audio") - 1]).toContain("(RULE 27)");
    expect(RULES[ruleNumber("audio") - 1]).toContain("(RULE 28)");
    expect(RULES[25]).toContain('{ "asset": "s1.keyframe", "role": "look", "note": "same pre-dawn palette and mist" }');
    expect(RULES[26]).toMatch(/never give a sound effect a "to"/);
    const [amb, sting] = JSON.parse(`[${RULES[26].match(/(\{ "asset": "dawn-wind".*?"atSec": 1 \})/)![1]}]`);
    expect(amb).toMatchObject({ kind: "ambience", to: "s3" });
    expect(sting).toMatchObject({ kind: "sting", atSec: 1 });
    expect(JSON.parse(RULES[27].match(/"dialogue": (\[.*?\])\./)![1])).toEqual([{ speaker: "FRIEND", text: "You made it!", offscreen: true }]);
    expect(full).toContain('"kind": "voiceover" | "music" | "sfx" | "ambience" | "sting" | "dialogue"');
    expect(full).toContain('"dialogue"?: string | [ string | { "speaker"?: string, "text": string, "offscreen"?: boolean } ]');
    // The example: s3 reuses s1's keyframe, an ambience bed, a sting and an off-screen line.
    const ex = EXAMPLE_STORYBOARD;
    expect(ex.shots.find((s) => s.id === "s3")!.references).toContainEqual({ asset: "s1.keyframe", role: "look", note: "same pre-dawn palette and mist" });
    expect(ex.audio!.map((c) => c.kind)).toEqual(["ambience", "sting"]);
    expect(ex.shots.find((s) => s.id === "s2")!.dialogue).toEqual([{ speaker: "FRIEND", text: "You made it!", offscreen: true }]);
    expect(exampleStoryboardJson()).toContain('"s1.keyframe"');
  });

  it("the example imports with no warnings and uses v1.1 fields", () => {
    const r = validateStoryboard(EXAMPLE_STORYBOARD);
    expect(r.ok && r.warnings).toEqual([]);
    expect(JSON.stringify(EXAMPLE_STORYBOARD)).toContain('"transition"');
    // V2-SB-133: a 2 s screen-blend overlay from a 6 s video asset.
    const flare = EXAMPLE_STORYBOARD.assets.find((a) => a.id === "sun-flare")!;
    expect(flare).toMatchObject({ type: "video", genDurationSec: 6 });
    const layer = EXAMPLE_STORYBOARD.shots.flatMap((x) => x.layers ?? []).find((l) => l.type === "video")!;
    expect(layer).toMatchObject({ asset: "sun-flare", startSec: 0, endSec: 2, inSec: 3, blend: "screen" });
    expect(exampleStoryboardJson()).toContain('"genDurationSec": 6');
    expect(exampleStoryboardJson()).toContain('"inSec": 3');
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
    expect(ex.shots.length).toBeLessThanOrEqual(5);
    // …but it still shows every part of the format a planner usually needs.
    expect(ex.shots.some((s) => s.references?.some((r) => r.asset === "s1.lastframe" && r.role === "start-frame"))).toBe(true);
    // P2B: reference sheets, html asset references, a still with a drawn background, a Consistency paragraph.
    expect(ex.assets.filter((a) => a.type === "character" || a.type === "prop").every((a) => /reference sheet/i.test(a.prompt))).toBe(true);
    expect(ex.assets.some((a) => a.type === "prop")).toBe(true);
    expect(ex.assets.some((a) => a.type === "html" && a.references?.length)).toBe(true);
    expect(ex.shots.some((s) => s.render === "still" && s.background && !s.clip && s.layers?.length)).toBe(true);
    expect(ex.shots.some((s) => s.prompt.includes("Consistency (this prompt stands alone)"))).toBe(true);
    expect(ex.connections.some((c) => c.kind === "continuity")).toBe(true);
    expect(ex.shots.some((s) => s.references?.some((r) => r.role === "start-frame"))).toBe(true);
    expect(ex.shots.some((s) => s.layers?.some((l) => l.type === "text" && l.anim))).toBe(true);
    expect(ex.shots.some((s) => s.effects?.length)).toBe(true);
    expect(ex.shots.filter((s) => !s.background).every((s) => s.prompt.startsWith("References:"))).toBe(true);
  });

  it("numbers the rules stably: append-only keys, and every RULE n the spec cites exists", () => {
    // Rule numbers are public (the spec, users, other AIs). Append new keys at the end; never reorder or delete.
    expect(RULE_LIST.slice(0, 25).map((r) => r.key)).toEqual([
      "reusable-assets", "standalone-prompts", "last-frame-continuity", "uploads", "qa-checks", "ids", "valid-json", "text-in-layers", "html-only-for-graphics",
      "transitions-and-effects", "known-presets", "param-units", "duration", "references-block", "transition-overlap", "identity-portrait", "asset-references", "keyframe", "audio", "layer-follow", "text-style-extras", "blend-overlays",
      "html-clip-package", "html-params", "video-asset-trim",
    ]);
    expect(new Set(RULE_LIST.map((r) => r.key)).size).toBe(RULE_LIST.length);
    RULE_LIST.forEach((r, i) => expect(section("RULES")).toContain(`${i + 1}. ${r.text}`));
    expect(ruleNumber("duration")).toBe(13);
    expect(ruleNumber("references-block")).toBe(14);
    expect(ruleNumber("asset-references")).toBe(17);
    expect(ruleNumber("audio")).toBe(19);
    expect(ruleNumber("layer-follow")).toBe(20);
    expect(ruleNumber("text-style-extras")).toBe(21);
    expect(ruleNumber("blend-overlays")).toBe(22);
    expect(ruleNumber("html-clip-package")).toBe(23);
    expect(ruleNumber("html-params")).toBe(24);
    expect(ruleNumber("video-asset-trim")).toBe(25);
    // V2-SB-133: video assets used as layers: asset genDurationSec + layer inSec, with the 2 s-from-6 s example.
    expect(RULES[ruleNumber("video-asset-trim") - 1]).toContain('"genDurationSec": 6');
    expect(RULES[ruleNumber("video-asset-trim") - 1]).toContain('"inSec": 3');
    expect(RULES[ruleNumber("duration") - 1]).toMatch(/^"durationSec" is how long/);
    // V2-SB-132: montage = consecutive short shots (no new field), in the duration rule and the spec.
    expect(RULES[ruleNumber("duration") - 1]).toContain("Montage (a quick run of glimpses, e.g. three 2 s moments of a journey) needs no special field: write it as consecutive short shots");
    expect(formatDoc).toContain("**Montage (V2-SB-132).** There is no montage field.");
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
    const files = aiGuideFiles(SITE, formatDoc, clipDoc, audioDoc);
    for (const [rel, content] of Object.entries(files)) {
      expect(content, rel).not.toContain("github.io");
      expect(content, rel).not.toContain("github.com");
    }
    const md = storyboardGuideMarkdown(SITE);
    expect(md).toContain(`(${SITE})`);
    expect(md).toContain(`Machine-readable presets: ${SITE}ai/presets.json.`);
    expect(md).toContain(`Full format reference: ${SITE}ai/STORYBOARD_FORMAT.md.`);
    expect(JSON.parse(presetsJson(SITE)).guide).toBe(`${SITE}ai/storyboard-guide.md`);
    for (const p of ["ai/storyboard-guide.md", "ai/storyboard-guide.html", "ai/presets.json", "ai/STORYBOARD_FORMAT.md", ""]) expect(llmsTxt(SITE)).toContain(`(${SITE}${p})`);
    expect(storyboardGuideHtml(SITE)).toContain('<link rel="alternate" type="text/markdown" href="storyboard-guide.md">');
    expect(files["public/ai/STORYBOARD_FORMAT.md"]).toBe(formatDoc);
    expect(files["public/ai/HTML_CLIP_PACKAGE.md"]).toBe(clipDoc);
    expect(llmsTxt(SITE)).toContain(`(${SITE}ai/HTML_CLIP_PACKAGE.md)`);
    expect(files["public/ai/AUDIO_CLIP_FORMAT.md"]).toBe(audioDoc);
    expect(llmsTxt(SITE)).toContain(`(${SITE}ai/AUDIO_CLIP_FORMAT.md)`);
    expect(JSON.parse(presetsJson(SITE)).audioClip.spec).toBe(`${SITE}ai/AUDIO_CLIP_FORMAT.md`);
  });

  it("only the site URL differs between deployments", () => {
    const def = aiGuideFiles(DEFAULT_SITE_URL, formatDoc, clipDoc, audioDoc);
    const other = aiGuideFiles(SITE, formatDoc, clipDoc, audioDoc);
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

describe("HTML clip package spec (V2-HTML-PKG)", () => {
  it("keeps the contract and the template in HTML_CLIP_PACKAGE.md in sync with the code (npm run gen:ai)", () => {
    for (const [tag, body] of Object.entries(CLIP_BLOCKS)) expect(between(clipDoc, tag), `${tag} block`).toBe(body);
  });

  it("the template and the worked example lint without errors, and the format spec links the package spec", () => {
    const blocks = [...clipDoc.matchAll(/```html\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.startsWith("<!doctype"));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const html of blocks) {
      const r = lintHtmlClip(html, { libs: [] });
      expect(r.issues.filter((i) => i.level === "error"), html.slice(0, 200)).toEqual([]);
      expect(r.legacy).toBe(false);
    }
    expect(clipDoc).toContain("First Light");
    expect(clipDoc.toLowerCase()).not.toMatch(/keeper|lantern/);
    expect(formatDoc).toContain("[HTML_CLIP_PACKAGE.md](HTML_CLIP_PACKAGE.md)");
    expect(clipDoc).toContain(`RULE ${ruleNumber("html-clip-package")}`);
  });
});

describe("guide consistency (V2-SB-131)", () => {
  const md = storyboardGuideMarkdown();
  const exampleText = md.split("## EXAMPLE\n```json\n")[1].split("\n```")[0];

  it("the example writes sources in the documented form: \"generate\" / \"upload\" strings, an object only for lastFrame", () => {
    expect(md).toContain('"source": "generate" | "upload" | "json" | { "type": "lastFrame", "shot": "<shot id>" },');
    const ex = JSON.parse(exampleText) as { assets: { source: unknown }[] };
    expect(exampleText).toBe(exampleStoryboardJson());
    for (const a of ex.assets) {
      const ok = a.source === "generate" || a.source === "upload" || a.source === "json" || (typeof a.source === "object" && a.source !== null && Object.keys(a.source).sort().join() === "shot,type" && (a.source as { type: string }).type === "lastFrame");
      expect(ok, JSON.stringify(a.source)).toBe(true);
    }
    expect(ex.assets.some((a) => a.source === "generate")).toBe(true);
    // No object form of generate/upload anywhere in the guide or the spec.
    for (const text of [md, formatDoc]) expect(text).not.toMatch(/"type":\s*"(generate|upload)"|type:\s*"(generate|upload)"/);
    // The published JSON imports to the same doc, with no warnings.
    const r = parseStoryboard(exampleText);
    expect(r.ok && r.warnings).toEqual([]);
    expect(r.ok && r.doc).toEqual(validateStoryboard(EXAMPLE_STORYBOARD).ok && (validateStoryboard(EXAMPLE_STORYBOARD) as { doc: StoryDoc }).doc);
  });

  it("the importer still accepts the object forms of generate / upload", () => {
    const doc = JSON.parse(exampleText);
    doc.assets[0].source = { type: "generate" };
    doc.assets[1].source = { type: "upload" };
    const r = parseStoryboard(JSON.stringify(doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.assets.slice(0, 2).map((a) => a.source)).toEqual([{ type: "generate" }, { type: "upload" }]);
  });

  it("the keyframe rule's numbering is the clip prompt builder's: keyframe Image 1, then references, then other assets", () => {
    const rule = RULES[ruleNumber("keyframe") - 1];
    expect(ruleNumber("keyframe")).toBe(18);
    expect(rule).toContain("Image 1 is always the keyframe, the START FRAME; Image 2, 3 … are the shot's \"references\" in their order, then the shot's other \"assets\" in \"assets\" order");
    expect(md).toContain('Image 1 = the keyframe (start frame), Image 2 … = the shot\'s "references", then its other "assets"');
    const r = parseStoryboard(JSON.stringify({
      format: "dionysus.storyboard/1", meta: { title: "T", aspect: "16:9" },
      assets: [
        { id: "hero", name: "Hero", type: "character", prompt: "p", source: "generate", qa: ["a", "b"] },
        { id: "cafe", name: "Café", type: "location", prompt: "p", source: "generate", qa: ["a", "b"] },
        { id: "mug", name: "Blue mug", type: "prop", prompt: "p", source: "generate", qa: ["a", "b"] },
        { id: "plate", name: "Plate", type: "frame", prompt: "p", source: "upload", qa: ["a", "b"] },
      ],
      shots: [{ id: "s1", title: "Morning coffee", durationSec: 4, prompt: "She slowly lifts the mug", assets: ["hero", "cafe", "plate"], references: [{ asset: "mug", role: "detail" }], keyframe: { prompt: "p", references: ["hero", "cafe"] }, qa: ["a", "b"] }],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = storyboardFromDoc(r.doc);
    const lines = referencesBlock(b, b.shots.s1).split("\n").slice(1);
    expect(lines.map((l) => l.replace(/: .*$/, ""))).toEqual(["Image 1 (Keyframe · Morning coffee)", "Image 2 (Blue mug)", "Image 3 (Hero)", "Image 4 (Café)", "Image 5 (Plate)"]);
    expect(lines[0]).toContain("START FRAME");
    expect(lines[4]).toContain("not a frame"); // an inferred start frame becomes details only
    // The rule's worked example matches what the app generates for that shot.
    const example = rule.match(/clip prompt "References:\\n(.*?)\\n\\n/)![1].split("\\n").map((l) => l.replace(/: .*$/, ""));
    const plain = parseStoryboard(JSON.stringify({ ...JSON.parse(JSON.stringify(r.doc)), shots: [{ ...r.doc.shots[0], assets: ["hero", "cafe"], references: undefined, keyframe: { prompt: "p", references: ["hero", "cafe"] } }], assets: r.doc.assets.filter((a) => a.id === "hero" || a.id === "cafe").map((a) => ({ ...a, source: "generate" })) }));
    expect(plain.ok).toBe(true);
    if (plain.ok) { const pb = storyboardFromDoc(plain.doc); expect(referencesBlock(pb, pb.shots.s1).split("\n").slice(1).map((l) => l.replace(/: .*$/, ""))).toEqual(example); }
  });
});

describe("Audio clip spec (P4A)", () => {
  it("the doc's generated blocks match the format tables", () => {
    for (const [tag, body] of Object.entries(AUDIO_BLOCKS)) expect(between(audioDoc, tag), `${tag} block`).toBe(body);
  });
  it("every JSON example in the doc parses without errors", () => {
    const blocks = [...audioDoc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBe(AUDIO_TEMPLATES.length);
    for (const b of blocks) { const r = parseAudioClip(b); expect(r.ok, JSON.stringify(r.issues)).toBe(true); expect(r.issues).toEqual([]); }
  });
});

#!/usr/bin/env node
/**
 * Check a storyboard JSON file with the app's importer (V2-SB-131): `npm run validate:storyboard -- <file.json>`.
 * Prints ok / errors / warnings (with their paths) and a summary; exits 1 when the file has errors.
 * The importer is loaded through Vite's module runner (as the build's AI-files plugin does), because the preset
 * registry discovers its modules with import.meta.glob, which plain node / tsx can't run.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2).filter((a) => a !== "--");
if (!files.length) {
  console.error("Usage: npm run validate:storyboard -- <file.json> [more.json …]");
  process.exit(2);
}

const { module: story } = await runnerImport(resolve(root, "src/v2/domain/storyJson.ts"), { configFile: false, root, logLevel: "warn" });
const { module: registry } = await runnerImport(resolve(root, "src/v2/registry/index.ts"), { configFile: false, root, logLevel: "warn" });
if (registry.PRESET_PROBLEMS?.length) console.warn(`Invalid preset modules (their ids are unknown to the importer):\n  ${registry.PRESET_PROBLEMS.join("\n  ")}`);

const count = (list, key) => Object.entries(list.reduce((m, x) => ({ ...m, [key(x)]: (m[key(x)] ?? 0) + 1 }), {})).map(([k, n]) => `${n} ${k}`).join(", ");
let failed = false;
for (const file of files) {
  let text;
  try { text = readFileSync(resolve(process.cwd(), file), "utf8"); } catch (e) { console.error(`${file}: can't read (${e.message})`); failed = true; continue; }
  const r = story.parseStoryboard(text);
  const where = (i) => (i.path ? `${i.path}: ` : "");
  if (!r.ok) {
    failed = true;
    console.log(`${file}: ERRORS (${r.errors.length})`);
    for (const e of r.errors) console.log(`  error   ${where(e)}${e.message}`);
    for (const w of r.warnings ?? []) console.log(`  warning ${where(w)}${w.message}`);
    continue;
  }
  const d = r.doc;
  console.log(`${file}: ok${r.warnings.length ? ` with ${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"}` : " (no warnings)"}`);
  for (const w of r.warnings) console.log(`  warning ${where(w)}${w.message}`);
  const total = d.shots.reduce((t, s) => t + s.durationSec, 0);
  const sum = (f) => d.shots.reduce((t, s) => t + (f(s)?.length ?? 0), 0);
  const lines = [
    ["format", `${d.format} · schema ${JSON.parse(text).schemaVersion ?? "3.0 (migrated on import)"} · ${d.meta.title} · ${d.meta.aspect}`],
    ["clips", (() => { const uses = {}; for (const s of d.shots) if (s.clip && d.assets.some((a) => a.id === s.clip && a.type === "video")) uses[s.clip] = (uses[s.clip] ?? 0) + 1; const shared = Object.values(uses).filter((n) => n > 1).length; return `${d.shots.filter((s) => (s.render ?? "ai") === "ai").length - Object.values(uses).reduce((t, n) => t + n, 0) + Object.keys(uses).length} to generate${shared ? ` (${shared} shared by several shots)` : ""}`; })()],
    ["shots", `${d.shots.length} (${count(d.shots, (s) => s.render ?? "ai")}; ${d.shots.filter((s) => s.keyframe).length} with a keyframe)`],
    ["total seconds", `${Math.round(total * 100) / 100} s on screen${d.shots.some((s) => s.genDurationSec) ? ` (${d.shots.filter((s) => s.genDurationSec).length} shots generate longer via genDurationSec)` : ""}`],
    ["assets", `${d.assets.length}${d.assets.length ? ` (${count(d.assets, (a) => a.type)}; sources: ${count(d.assets, (a) => a.source.type)})` : ""}`],
    ["layers", `${sum((s) => s.layers)}${sum((s) => s.layers) ? ` (${count(d.shots.flatMap((s) => s.layers ?? []), (l) => l.type)})` : ""}`],
    ["effects", String(sum((s) => s.effects))],
    ["transitions", `${d.connections.filter((c) => c.transition).length} of ${d.connections.length} connections`],
    ["audio cues", `${d.audio?.length ?? 0}${d.audio?.length ? ` (${count(d.audio, (c) => c.kind)})` : ""}`],
  ];
  for (const [k, v] of lines) console.log(`  ${k.padEnd(13)} ${v}`);
  console.log(`  summary       ${story.storySummary(d)}`);
}
process.exit(failed ? 1 : 0);

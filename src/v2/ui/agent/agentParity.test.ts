/**
 * P72 (Phase 1 step 1.7 of docs/v2/CLIP_PLUGIN_ARCHITECTURE.md): parity for the WebMCP tools and AI guide rules that
 * clip type cores now contribute to, and for the per-type checks of the timeline tools. A compact golden (one hash per
 * case) recorded on the pre-P72 code covers:
 *  - the registered tool list (names, titles, descriptions, schemas, read-only flags), TIMELINE_TOOLS, STORY_TOOLS
 *    and RULE_LIST;
 *  - get_timeline / get_clip output for a fixture with every clip type (and a video carrying a blank flag, an image
 *    carrying both placeholder and blank flags, never made by the app);
 *  - every per-type check: set_clip_props with effect / text / sound-position values, set_clip_input, set_blank_color,
 *    even_split_words, set_caption_words and word_align_prompt on every clip (result text, ok, changed and the clip after).
 * `AGENT_PARITY_DUMP=<dir>` writes the raw texts; `UPDATE_AGENT_GOLDEN=1` rewrites the golden (intended changes only).
 * The generated guide files themselves are checked by `npm run gen:ai` (no diff).
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findPlacement, timelineReview, type Placement, type Project } from "../../domain";
import { STORY_TOOLS } from "../../domain/storyAgent";
import { RULE_LIST } from "../../domain/storyPrompt";
import { Engine } from "../../engine";
import { timelineParityProject } from "../../__fixtures__/timelineParity";
import { ALL_AGENT_TOOLS } from "./webMcp";
import { runTimelineTool } from "./timelineTools";

const GOLDEN = join(__dirname, "__golden__", "agentParity.json");
const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
const norm = (s: string) => { const ids = new Map<string, string>(); return s.replace(/\b[a-z]{2,6}_[0-9a-f]{8}[0-9a-z]*\b/g, (m) => { if (!ids.has(m)) ids.set(m, `id${ids.size + 1}`); return ids.get(m)!; }); };

function project(): Project {
  const p = timelineParityProject();
  const comp = p.compositions[p.rootCompositionId];
  const overlay = comp.tracks.find((t) => t.placements.some((x) => x.id === "o-blue"))!;
  const vid = comp.tracks.flatMap((t) => t.placements).find((x) => x.id === "m-vid")!;
  // Shapes the app never makes: the old checks read the flag (blank) or the stored clipType, whatever else is set.
  overlay.placements.push({ ...structuredClone(vid), id: "x-vblank", startTicks: 21 * 120_000, durationTicks: 120_000, blank: { color: "#00ff00" }, transitionIn: undefined, speed: undefined, linkedAudio: undefined });
  overlay.placements.push({ ...structuredClone(vid), id: "x-phblank", clipType: "image", startTicks: 23 * 120_000, durationTicks: 120_000, placeholder: { label: "Both" }, blank: { color: "#0000ff" }, transitionIn: undefined, speed: undefined, linkedAudio: undefined });
  return p;
}
const allClips = (p: Project): Placement[] => p.compositions[p.rootCompositionId].tracks.flatMap((t) => t.placements);
/** A stable key for a clip: its id, or its type and position for generated ids (caption cues). */
const keyOf = (p: Project) => { const out = new Map<string, string>(); allClips(p).forEach((pl, i) => out.set(pl.id, /^[a-z]{2,6}_[0-9a-f]{8}/.test(pl.id) ? `${pl.clipType}${i}` : pl.id)); return out; };

const CASES: [string, string, Record<string, unknown>][] = [
  ["props-effect", "set_clip_props", { effect: { preset: "blur" } }],
  ["props-effect-bad", "set_clip_props", { effect: { preset: "nope" } }],
  ["props-text", "set_clip_props", { text: { text: "Changed" } }],
  ["props-pan", "set_clip_props", { pan: 0.25 }],
  ["props-position", "set_clip_props", { position: { azimuth: 30, distance: 2 } }],
  ["props-positionKeys", "set_clip_props", { positionKeys: null }],
  ["props-trackPosition", "set_clip_props", { trackPosition: null }],
  ["props-mixed", "set_clip_props", { volume: 0.5, text: { size: 0.1 }, pan: 0 }],
  ["clip-input", "set_clip_input", { input: "audio" }],
  ["blank-color", "set_blank_color", { color: "#123456" }],
  ["even-split", "even_split_words", {}],
  ["caption-words", "set_caption_words", { words: [{ text: "Hello", atSec: 0 }] }],
  ["word-align", "word_align_prompt", {}],
  ["get-clip", "get_clip", {}],
];

async function record(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const dump = process.env.AGENT_PARITY_DUMP;
  if (dump) mkdirSync(dump, { recursive: true });
  const put = (k: string, s: string) => { const n = norm(s); out[k] = fnv(n); if (dump) writeFileSync(join(dump, `${k}.txt`), n); };
  put("tools-all", JSON.stringify(ALL_AGENT_TOOLS));
  put("tools-timeline", JSON.stringify(timelineReview.TIMELINE_TOOLS));
  put("tools-story", JSON.stringify(STORY_TOOLS));
  put("tools-names", ALL_AGENT_TOOLS.map((t) => t.name).join(","));
  put("rules", JSON.stringify(RULE_LIST));
  put("guide-timeline-tools", timelineReview.timelineToolsMarkdown());
  const p0 = project(), key = keyOf(p0);
  put("timeline-json", JSON.stringify(timelineReview.timelineJson(p0)));
  for (const pl of allClips(p0)) put(`clip-json-${key.get(pl.id)}`, JSON.stringify(timelineReview.clipJson(p0, pl)));
  for (const pl of allClips(p0)) {
    for (const [k, tool, args] of CASES) {
      const e = new Engine(structuredClone(p0));
      const r = await runTimelineTool(e, undefined, tool, { id: pl.id, ...args });
      const p = e.getState().project, after = findPlacement(p.compositions[p.rootCompositionId], pl.id)?.placement;
      put(`${key.get(pl.id)}-${k}`, JSON.stringify({ ok: r.ok, changed: r.changed, text: r.text, after: after ?? null }));
    }
  }
  return out;
}

describe("P72 agent tools, rules and per-type checks parity", () => {
  it("matches the golden recorded before the move", async () => {
    const got = await record();
    if (process.env.UPDATE_AGENT_GOLDEN || !existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(got, null, 0).replace(/,"/g, ',\n"') + "\n");
    const want = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
    expect(Object.keys(got)).toEqual(Object.keys(want));
    for (const k of Object.keys(want)) expect(got[k], k).toBe(want[k]);
  });
});

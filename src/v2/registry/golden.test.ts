/**
 * V2-FX-MOD: golden output of every built-in preset, recorded from the pre-module registry (presets.ts + renderers.ts)
 * before the presets moved to one file each under src/v2/presets/. Proves the migration changed no behaviour: same
 * ids, order, names, categories, versions, types, params (min/max/step/default), preview, data, fonts, and the same
 * frame at 11 progress values with default, minimum and maximum params. Param `description`s are excluded (they
 * were added during the migration). Re-record only for an intentional change: UPDATE_PRESET_GOLDEN=1 npx vitest run golden.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPreset, FONTS, listPresets, PRESET_KINDS, type Params, type PresetDescriptor } from ".";

const FILE = resolve(__dirname, "__golden__/presets.golden.json");
const STEPS = Array.from({ length: 11 }, (_, i) => i / 10);

function paramSets(d: PresetDescriptor): Record<string, Params | undefined> {
  const nums = d.params.filter((p) => p.type === "number");
  if (!nums.length) return { default: undefined };
  return {
    default: undefined,
    min: Object.fromEntries(nums.map((p) => [p.key, p.type === "number" ? p.min : 0])),
    max: Object.fromEntries(nums.map((p) => [p.key, p.type === "number" ? p.max : 0])),
  };
}

/** Everything a preset is, minus prose that the migration may improve, plus what it renders. Built-ins only (no new presets). */
export function snapshot(only?: (kind: string, id: string) => boolean) {
  const kinds: Record<string, unknown[]> = {};
  for (const kind of PRESET_KINDS) {
    kinds[kind] = listPresets(kind).filter((d) => !only || only(kind, d.id)).map((d) => ({
      id: d.id, kind: d.kind, category: d.category, name: d.name, version: d.version, type: d.type, description: d.description,
      params: d.params.map(({ description: _omit, ...p }) => p), preview: d.preview, data: d.data ?? null,
      frames: Object.fromEntries(Object.entries(paramSets(d)).map(([name, params]) => [name, STEPS.map((p) => applyPreset(kind, d.id, p, undefined, params))])),
    }));
  }
  return { fonts: FONTS.map((f) => ({ ...f })), kinds };
}

/** One line per font / preset so diffs stay readable. */
const compact = (s: ReturnType<typeof snapshot>) => `{"fonts":[\n${s.fonts.map((f) => JSON.stringify(f)).join(",\n")}\n],"kinds":{\n${Object.entries(s.kinds).map(([k, list]) => `${JSON.stringify(k)}:[\n${list.map((d) => JSON.stringify(d)).join(",\n")}\n]`).join(",\n")}\n}}\n`;

describe("preset golden output (V2-FX-MOD)", () => {
  it("every pre-migration preset renders exactly as recorded", () => {
    if (process.env.UPDATE_PRESET_GOLDEN || !existsSync(FILE)) writeFileSync(FILE, compact(snapshot()));
    const golden = JSON.parse(readFileSync(FILE, "utf8")) as ReturnType<typeof snapshot>;
    const ids = new Set(Object.entries(golden.kinds).flatMap(([k, list]) => (list as { id: string }[]).map((d) => `${k}:${d.id}`)));
    const now = JSON.parse(JSON.stringify(snapshot((k, id) => ids.has(`${k}:${id}`))));
    expect(now.fonts).toEqual(golden.fonts);
    for (const kind of Object.keys(golden.kinds)) expect(now.kinds[kind], kind).toEqual(golden.kinds[kind]);
  });
});

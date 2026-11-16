/** P72: clip type cores on the agent surface: built-in declarations, and a contributed tool, rule and describe end to end. */
import { describe, expect, it } from "vitest";
import { CLIP_TYPES, agentToolOwner, checkClipType, clipPropFits, clipToolFits, clipTypeAgentRules, clipTypeAgentTools, defineClipType } from "../../clipTypes";
import { createProject, findPlacement, timelineReview, type Placement, type Project } from "../../domain";
import { RULE_LIST } from "../../domain/storyPrompt";
import { Engine } from "../../engine";
import { runTimelineTool } from "./timelineTools";

const pl = (extra: Partial<Placement>): Placement => ({ id: "p", startTicks: 0, durationTicks: 120_000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "v" }, clipType: "video", ...extra });

describe("P72 clip type agent surface", () => {
  it("only the scene type contributes tools and a rule (P78), after the built-ins; clip tools are existing timeline tools", () => {
    expect(clipTypeAgentTools().map((t) => t.name)).toEqual(["create_scene_clip", "get_scene", "list_scene_objects", "add_scene_object", "set_scene_object", "remove_scene_object", "add_scene_event", "update_scene_event", "retime_scene_event", "remove_scene_event", "set_scene_world", "set_scene_light", "apply_scene_edits"]);
    for (const t of clipTypeAgentTools()) expect(agentToolOwner(t.name)?.id).toBe("scene");
    expect(clipTypeAgentRules().map((r) => r.key)).toEqual(["scene-clips"]);
    expect(RULE_LIST.at(-1)!.key).toBe("scene-clips");
    for (const t of clipTypeAgentTools()) expect(timelineReview.TIMELINE_TOOL_NAMES.has(t.name), t.name).toBe(true);
    for (const c of CLIP_TYPES.list()) for (const t of c.agent?.clipTools ?? []) expect(timelineReview.TIMELINE_TOOL_NAMES.has(t), `${c.id} ${t}`).toBe(true);
    expect(new Set(RULE_LIST.map((r) => r.key)).size).toBe(RULE_LIST.length);
  });
  it("checkClipType validates the agent field", () => {
    const base = { id: "x", version: 1, description: "x", trackKind: "video", caps: { sourceTime: false, still: false, sound: false, visual: true, keyable: false, thumb: false, asset: "none" } };
    expect(checkClipType({ ...base, agent: { tools: [{ name: "Bad Name" }] } }).join()).toMatch(/snake_case.*agent.run/);
    expect(checkClipType({ ...base, agent: { rules: [{ key: 1 }], props: "x" } }).join()).toMatch(/rules.*props/);
    expect(checkClipType({ ...base, agent: { clipTools: ["a"], props: ["b"], rules: [] } })).toEqual([]);
  });
  it("clip tools and props match the old checks (stored clipType; blank by its flag)", () => {
    expect(clipToolFits(pl({ clipType: "text" }), "even_split_words")).toBe(true);
    expect(clipToolFits(pl({ clipType: "video" }), "set_caption_words")).toBe(false);
    expect(clipToolFits(pl({ clipType: "html" }), "set_clip_input")).toBe(true);
    expect(clipToolFits(pl({ clipType: "image", blank: { color: "#000000" } }), "set_blank_color")).toBe(true);
    expect(clipToolFits(pl({ clipType: "video", blank: { color: "#000000" } }), "set_blank_color")).toBe(true);
    expect(clipToolFits(pl({ clipType: "image", placeholder: { label: "x" }, blank: { color: "#000000" } }), "set_blank_color")).toBe(true);
    expect(clipToolFits(pl({ clipType: "image" }), "set_blank_color")).toBe(false);
    expect(clipToolFits(pl({}), "get_timeline")).toBeUndefined();
    expect(clipPropFits(pl({ clipType: "effect" }), "effect")).toBe(true);
    expect(clipPropFits(pl({ clipType: "image" }), "text")).toBe(false);
    expect(clipPropFits(pl({}), "volume")).toBeUndefined();
  });
  it("a contributed tool runs through agent.run with one undo step, and describe adds get_timeline fields", async () => {
    CLIP_TYPES.register(defineClipType({
      id: "demo", description: "Test type", trackKind: "video",
      caps: { sourceTime: false, still: true, sound: false, visual: true, keyable: false, thumb: false, asset: "none" },
      agent: {
        tools: [{ name: "demo_rename", title: "Rename", description: "Rename the project.", inputSchema: { type: "object", properties: {} }, readOnly: false }],
        run: (name, input, api) => ({ ok: true, changed: api.edit("Rename", (p: Project) => ({ ...p, name: String(input.name) })), text: `${name} ${api.project().name}` }),
        describe: (p) => ({ demo: p.id }),
      },
    }));
    expect(agentToolOwner("demo_rename")?.id).toBe("demo");
    const e = new Engine(createProject("before"));
    const r = await runTimelineTool(e, undefined, "demo_rename", { name: "after" });
    expect(r).toEqual({ ok: true, changed: true, text: "demo_rename after" });
    expect(e.getState().canUndo).toBe(true);
    e.undo();
    expect(e.getState().project.name).toBe("before");
    const p = createProject("x"), c = p.compositions[p.rootCompositionId];
    c.tracks[0].placements.push(pl({ id: "d1", clipType: "demo" as Placement["clipType"] }));
    expect(timelineReview.clipJson(p, findPlacement(c, "d1")!.placement)).toMatchObject({ id: "d1", type: "demo", demo: "d1" });
    expect((await runTimelineTool(new Engine(createProject("y")), undefined, "nope_tool", {})).text).toBe("Unknown tool nope_tool.");
  });
});

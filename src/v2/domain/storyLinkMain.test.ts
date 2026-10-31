import { describe, expect, it } from "vitest";
import { createProject, type MediaRef, type Project } from "./model";
import * as board from "./storyboard";
import { storyDocJson, validateStoryboard, type StoryDoc } from "./storyJson";
import { sendStory } from "./storySend";
import { TICKS_PER_SECOND } from "./time";

const S = TICKS_PER_SECOND;
const vid: MediaRef = { blobKey: "v", mime: "video/mp4", durationTicks: 5 * S, width: 1920, height: 1080 };
const doc = (extra: Record<string, unknown> = {}) => ({
  format: "dionysus.storyboard/1",
  meta: { title: "T", aspect: "16:9" },
  assets: [],
  shots: [{ id: "a", title: "a", description: "", durationSec: 5, prompt: "P", assets: [], qa: [], layers: [
    { id: "t1", type: "text", text: "Linked", startSec: 0, endSec: 2, position: { x: 0.5, y: 0.5 } },
    { id: "t2", type: "text", text: "Free", startSec: 2, endSec: 4, position: { x: 0.5, y: 0.5 }, ...extra },
  ] }],
});
const parse = (raw: unknown): StoryDoc => { const r = validateStoryboard(raw); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc; };

describe("storyboard link: false (P9-LINK)", () => {
  it("parses, warns on bad values and round-trips", () => {
    const d = parse(doc({ link: false }));
    expect(d.shots[0].layers![1].link).toBe(false);
    expect(d.shots[0].layers![0].link).toBeUndefined();
    expect(parse(JSON.parse(storyDocJson(d))).shots[0].layers![1].link).toBe(false);
    const r = validateStoryboard(doc({ link: "no" }));
    expect(r.ok && r.warnings.some((w) => w.path.endsWith(".link"))).toBe(true);
  });
  it("Send to Timeline links layers to their shot's main clip unless link is false", () => {
    let p: Project = board.setStoryboard(createProject("s"), board.storyboardFromDoc(parse(doc({ link: false }))));
    p = board.addStoryVersion(p, { shot: "a" }, vid, { versionId: "v1", now: "2026-10-30T00:00:00Z" });
    const { project } = sendStory(p);
    const c = project.compositions[project.rootCompositionId];
    const texts = c.tracks.flatMap((t) => t.placements).filter((x) => x.clipType === "text");
    const byText = (s: string) => texts.find((x) => x.text?.text === s)!;
    expect(byText("Linked").link?.parent).toBe(byText("Linked").storyLink?.anchor);
    expect(byText("Free").link).toBeUndefined();
  });
});

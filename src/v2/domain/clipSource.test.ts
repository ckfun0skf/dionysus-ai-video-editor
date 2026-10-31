/** P17-CLIP-SOURCE: switching an AI shot between its own clip and a shared clip. */
import { describe, expect, it } from "vitest";
import { board, clipSource, createProject, story, storyEdit, type Project } from ".";

const DOC = {
  format: "dionysus.storyboard/1", schemaVersion: "3.1", meta: { title: "T", aspect: "16:9" },
  assets: [
    { id: "s1-clip", name: "Clip · Desk", type: "video", prompt: "Desk.", auto: true },
    { id: "wide", name: "Wide", type: "video", prompt: "Wide." },
  ],
  shots: [
    { id: "s1", title: "Desk", description: "", durationSec: 4, clip: "s1-clip" },
    { id: "s2", title: "Climb", description: "", durationSec: 3, clip: "wide" },
    { id: "s3", title: "Later", description: "", durationSec: 3, clip: "wide", inSec: 3 },
  ],
  connections: [],
};
function proj(): Project {
  const r = story.validateStoryboard(DOC);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { ...createProject("t"), storyboard: board.storyboardFromDoc(r.doc) };
}

describe("P17 clip source", () => {
  it("lists shared clips and other shots' own clips, not the shot's own", () => {
    const keys = clipSource.clipChoices(proj(), "s1").map((c) => c.key);
    expect(keys).toEqual(["slot:wide"]);
    expect(clipSource.clipChoices(proj(), "s2").map((c) => c.key)).toEqual(["shot:s1", "slot:wide"]);
  });

  it("reuse via updateShot keeps the link with no prompt; Save of other fields keeps it", () => {
    let p = storyEdit.updateShot(proj(), "s1", { clipSource: { reuse: "slot:wide", inSec: 1.5 }, render: "ai" });
    expect(p.storyboard!.shots.s1).toMatchObject({ clipSlot: "wide", clipInSec: 1.5, prompt: "" });
    p = storyEdit.updateShot(p, "s1", { title: "Desk 2", render: "ai", clipInSec: 2, description: "x" });
    expect(p.storyboard!.shots.s1).toMatchObject({ clipSlot: "wide", clipInSec: 2, title: "Desk 2" });
  });

  it("back to an own clip keeps a clip others use and drops one nobody uses", () => {
    let p = storyEdit.updateShot(proj(), "s3", { clipSource: { own: true }, prompt: "Own." });
    expect(p.storyboard!.shots.s3.clipSlot).toBeUndefined();
    expect(p.storyboard!.slots.wide).toBeTruthy();
    p = storyEdit.updateShot(p, "s2", { clipSource: { own: true }, prompt: "Own 2." });
    expect(p.storyboard!.slots.wide).toBeUndefined();
    expect(p.storyboard!.shots.s2.prompt).toBe("Own 2.");
  });

  it("shares an own clip, then a new shot reuses it via shot:<id>", () => {
    let p = storyEdit.addShot(proj(), "s9", { clipSource: { reuse: "shot:s1" } });
    const slot = p.storyboard!.shots.s1.clipSlot!;
    expect(p.storyboard!.slots[slot]).toMatchObject({ type: "video", prompt: "Desk." });
    expect(p.storyboard!.shots.s9.clipSlot).toBe(slot);
    expect(board.shotClips(p).s9.label).toBe("Clip A");
    p = storyEdit.updateShot(p, "s2", { clipSource: { share: true } });
    expect(p.storyboard!.shots.s2.clipSlot).toBe("wide"); // already shared: unchanged
  });
});

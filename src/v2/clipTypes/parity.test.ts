// @vitest-environment jsdom
/**
 * Phase 1 parity (P65, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §7): every built-in core's `trackKind` and `caps` must equal
 * what today's scattered predicates answer for a clip of that type. Later steps make those predicates read the
 * registry; this test stays and keeps the answers identical.
 */
import { describe, expect, it } from "vitest";
import { CLIP_TYPES, clipTypeOf } from ".";
import { canChromaKey, createProject, hasSound, isStill, TEXT_SOURCE, trackKindFor, type MediaKind, type Placement, type Project } from "../domain";
import { canSetRange } from "../domain/clipRange";
import { mediaKindOf } from "../persistence/media";
import { needsThumb } from "../ui/TimelineClip";

const KINDS: MediaKind[] = ["video", "image", "audio", "html", "text", "effect"];
const MEDIA_FILES = ["a.mp4", "a.png", "a.mp3", "a.html", "a.txt", "a.json", "a.srt"].map((name) => ({ name, type: name.endsWith(".html") ? "text/html" : "" }));

function fixture(): { project: Project; clips: Record<string, Placement> } {
  const project = createProject("parity", "2026-01-01T00:00:00.000Z");
  const clips: Record<string, Placement> = {};
  const base = (id: string, clipType: MediaKind, media: boolean): Placement => {
    if (media) {
      project.assets[`a-${id}`] = { id: `a-${id}`, kind: clipType, name: id, versions: [{ id: "v1", createdAt: "2026-01-01T00:00:00.000Z", media: { blobKey: `b-${id}`, mime: "x/y", durationTicks: 10 * 120_000 }, provenance: { source: "import", inputs: [] } }] };
    }
    return { id, startTicks: 0, durationTicks: 120_000, sourceInTicks: 0, clipType, source: media ? { kind: "assetVersion", assetId: `a-${id}`, versionId: "v1" } : TEXT_SOURCE };
  };
  for (const k of KINDS) clips[k] = base(k, k, k !== "text" && k !== "effect");
  clips.placeholder = { ...base("placeholder", "image", false), placeholder: { label: "Shot 1" } };
  clips.blank = { ...base("blank", "image", false), blank: { color: "#112233" } };
  clips.unknown = base("unknown", "scene" as MediaKind, true);
  return { project, clips };
}

describe("clip type parity with today's predicates (P65)", () => {
  const { project, clips } = fixture();
  it("has a fixture clip for every registered type", () => expect(Object.keys(clips).sort()).toEqual(CLIP_TYPES.list().map((c) => c.id).sort()));
  for (const core of CLIP_TYPES.list()) {
    it(`${core.id}: trackKind and caps match trackKindFor, isStill, hasSound, canChromaKey, needsThumb, canSetRange`, () => {
      const p = clips[core.id];
      expect(clipTypeOf(p).id).toBe(core.id);
      expect(core.trackKind).toBe(trackKindFor(p.clipType));
      expect(core.caps.still).toBe(isStill(p));
      expect(core.caps.sound).toBe(hasSound(p));
      expect(core.caps.keyable).toBe(canChromaKey(p));
      expect(core.caps.thumb).toBe(needsThumb(p));
      expect(core.caps.sourceTime).toBe(canSetRange(project, p));
      // Drawn as a picture: everything on a video or text track.
      expect(core.caps.visual).toBe(core.trackKind === "video" || core.trackKind === "text");
      // Reads an asset version: the importable kinds (mediaKindOf), never a variant (TEXT_SOURCE) or an unknown id.
      const importable = MEDIA_FILES.some((f) => mediaKindOf(f) === core.id);
      expect(core.caps.asset).toBe(importable ? "media" : "none");
    });
  }
  it("covers every MediaKind", () => { for (const k of KINDS) expect(CLIP_TYPES.core(k)?.id).toBe(k); });
});

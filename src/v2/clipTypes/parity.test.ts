// @vitest-environment jsdom
/**
 * Phase 1 parity (P65, docs/v2/CLIP_PLUGIN_ARCHITECTURE.md §7): every built-in core's `trackKind` and `caps` must equal
 * what today's scattered predicates answer for a clip of that type. Later steps make those predicates read the
 * registry; this test stays and keeps the answers identical.
 */
import { describe, expect, it } from "vitest";
import { CLIP_TYPES, clipTypeOf } from ".";
import { canChromaKey, createProject, hasSound, isStill, TEXT_SOURCE, trackKindFor, versionOf, type MediaKind, type Placement, type Project, type Track } from "../domain";
import { canSetRange, sourceSpan } from "../domain/clipRange";
import { slipKind } from "../domain/slip";
import { audioPlan } from "../render/export/plan";
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
  // P73: the placeholder is a host clip state (clipTypes/state.ts), no longer a registered type; its fixture clip stays.
  it("has a fixture clip for every registered type and the placeholder state", () => expect(Object.keys(clips).sort()).toEqual([...CLIP_TYPES.list().map((c) => c.id), "placeholder"].sort()));
  for (const core of [...CLIP_TYPES.list(), clipTypeOf(clips.placeholder)]) {
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

/**
 * P66 (step 1.2): the domain predicates and the export audio plan now read the registry, so comparing them with the
 * cores above alone would be circular. These are the pre-P66 implementations, frozen verbatim; the delegating code
 * must answer exactly as they did for every clip shape.
 */
const LEGACY = {
  trackKindFor: (kind: string) => (kind === "audio" ? "audio" : kind === "text" ? "text" : kind === "effect" ? "effect" : "video"),
  isStill: (p: Placement) => p.clipType === "image" || p.clipType === "text" || p.clipType === "effect",
  canChromaKey: (p: Placement) => p.clipType === "video" || p.clipType === "image" || p.clipType === "html",
  hasSound: (p: Placement) => p.clipType === "audio" || p.clipType === "video",
  sourceTimeKind: (p: Placement) => p.clipType === "video" || p.clipType === "audio",
  slipKind: (p: Placement) => (p.freeze ? undefined : p.clipType === "video" || p.clipType === "audio" ? "media" : p.clipType === "html" ? "html" : undefined),
  audioSkip: (p: Placement) => p.clipType === "image" || p.clipType === "html" || !!p.reverse || !!p.freeze || (p.clipType === "video" && !!p.linkedAudio?.muted),
};

describe("delegating predicates equal the pre-P66 code (P66)", () => {
  const { project, clips } = fixture();
  const shapes: Placement[] = [];
  for (const p of Object.values(clips)) {
    shapes.push(p, { ...p, freeze: true }, { ...p, reverse: true }, { ...p, speed: 2 }, { ...p, linkedAudio: { muted: true } });
    // Same clip without a known media length (canSetRange needs one).
    shapes.push({ ...p, source: TEXT_SOURCE });
  }
  it("trackKindFor for every MediaKind and an unknown id", () => {
    for (const k of [...KINDS, "scene", "unknown", ""]) expect(trackKindFor(k as MediaKind), k).toBe(LEGACY.trackKindFor(k));
  });
  it(`isStill, canChromaKey, hasSound, canSetRange, sourceSpan, slipKind (${shapes.length} clip shapes)`, () => {
    for (const p of shapes) {
      const label = `${p.id} ${JSON.stringify({ freeze: !!p.freeze, reverse: !!p.reverse, src: p.source.assetId })}`;
      expect(isStill(p), label).toBe(LEGACY.isStill(p));
      expect(canChromaKey(p), label).toBe(LEGACY.canChromaKey(p));
      expect(hasSound(p), label).toBe(LEGACY.hasSound(p));
      const media = LEGACY.sourceTimeKind(p) ? versionOf(project, p.source)?.media.durationTicks : undefined;
      expect(sourceSpan(project, p).mediaTicks, label).toBe(media);
      expect(canSetRange(project, p), label).toBe(LEGACY.sourceTimeKind(p) && !p.freeze && !p.reverse && !!media);
      expect(slipKind(p), label).toBe(LEGACY.slipKind(p));
    }
  });
  it("audioPlan mixes exactly the clips the pre-P66 filter mixed", () => {
    const tracks: Track[] = [
      { id: "tv", kind: "video", name: "tv", placements: [] },
      { id: "ta", kind: "audio", name: "ta", placements: [] },
      { id: "tt", kind: "text", name: "tt", placements: [] },
      { id: "te", kind: "effect", name: "te", placements: [] },
    ];
    shapes.forEach((p, i) => {
      const t = tracks.find((x) => x.kind === LEGACY.trackKindFor(p.clipType))!;
      t.placements.push({ ...p, id: `s${i}`, startTicks: i * 120_000 });
    });
    const proj: Project = { ...project, compositions: { ...project.compositions, [project.rootCompositionId]: { ...project.compositions[project.rootCompositionId], tracks } } };
    const mixed = audioPlan(proj).map((seg) => seg.start);
    // P73 (§6, intended): a clip type this build does not know is no longer mixed (it exports as a black frame and silence, warned first).
    const known = (p: Placement) => !!CLIP_TYPES.core(p.clipType);
    const expected = tracks.flatMap((t) => t.placements).filter((p) => known(p) && !LEGACY.audioSkip(p) && !!versionOf(proj, p.source) && (p.volume ?? 1) > 0 && p.durationTicks > 0).map((p) => p.startTicks / 120_000).sort((a, b) => a - b);
    expect([...mixed].sort((a, b) => a - b)).toEqual(expected);
    expect(mixed.length).toBeGreaterThan(3);
  });
});

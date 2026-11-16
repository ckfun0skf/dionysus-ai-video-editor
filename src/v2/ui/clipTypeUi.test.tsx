import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { assetUi, checkClipTypeUi, CLIP_TYPE_UI_PATHS, CLIP_TYPE_UI_PROBLEMS, CLIP_TYPE_UIS, clipUi, DEFAULT_CLIP_UI, loadClipTypeUis, type ClipTypeUi } from "./clipTypeUi";
import { clipDisplayName, clipKindClass, clipThumbStyle, needsThumb } from "./TimelineClip";
import { effectName } from "./effectName";
import { Ic } from "./Icon";
import { createProject, TEXT_SOURCE, type MediaKind, type Placement, type Project } from "../domain";
import type { Filmstrip } from "./media";

/** Frozen pre-P69 switches (TimelineClip.tsx, Timeline.tsx, useThumbs.ts, useMedia.ts), so the parity check is not circular. */
const LEGACY = {
  needsThumb: (p: Placement) => !p.placeholder && !p.blank && (p.clipType === "video" || p.clipType === "image" || p.clipType === "html"),
  kindClass: (p: Placement) => (p.placeholder ? "is-placeholder" : p.blank ? "is-blank" : ""),
  thumbStyle: (p: Placement, thumbs?: Record<string, string>, strips?: Record<string, Filmstrip>) =>
    p.blank ? { background: p.blank.color } :
    thumbs?.[p.source.assetId] && p.clipType !== "audio" && !strips?.[`${p.source.assetId}:${p.source.versionId}`] ? { backgroundImage: `url(${thumbs[p.source.assetId]})` } : {},
  collapsedThumb: (p: Placement) => p.clipType !== "audio",
  body: (p: Placement) => (p.placeholder ? "placeholder" : p.blank ? "blank" : undefined),
  filmstrip: (p: Placement) => p.clipType === "video",
  wave: (p: Placement) => (p.clipType !== "image" && !(p.clipType === "video" && (p.linkedAudio?.muted || p.freeze || p.reverse)) ? (p.clipType === "audio" ? "audio" : "video") : undefined),
  title: (p: Placement, project: Project) => (p.clipType === "effect" ? `Effect: ${effectName(p)}` : p.clipType === "text" ? p.text?.text : project.assets[p.source.assetId]?.name),
  thumbMode: (k: string) => (k === "audio" ? "none" : k === "html" ? "html" : "frame"),
  previews: (k: string) => ({ peaks: !(k === "image" || k === "html"), filmstrip: k === "video" }),
};

function shapes(): Placement[] {
  const base: Placement = { id: "p", startTicks: 0, durationTicks: 120_000, sourceInTicks: 0, source: { kind: "assetVersion", assetId: "a", versionId: "v" }, clipType: "video" };
  const out: Placement[] = [];
  for (const clipType of ["video", "image", "audio", "html", "text", "effect", "scene3d"] as Placement["clipType"][]) {
    for (const extra of [{}, { reverse: true }, { freeze: true }, { linkedAudio: { muted: true } }, { speed: 2 }] as Partial<Placement>[]) out.push({ ...base, clipType, ...extra });
  }
  out.push({ ...base, clipType: "image", placeholder: { label: "Shot 1" } }, { ...base, clipType: "image", blank: { color: "#ff0000" } }, { ...base, clipType: "image", placeholder: { label: "S" }, blank: { color: "#000000" } });
  out.push({ ...base, clipType: "text", source: TEXT_SOURCE, text: { text: "Hello" } as Placement["text"] }, { ...base, clipType: "text", source: TEXT_SOURCE, text: { text: "" } as Placement["text"] });
  out.push({ ...base, clipType: "effect", effect: { preset: "blur", amount: 1 } as Placement["effect"] }, { ...base, clipType: "effect", effect: { preset: "nope", amount: 1 } as Placement["effect"] });
  return out;
}

describe("P69 clip type UI table", () => {
  it("discovers the UI modules with no problems", () => {
    expect(CLIP_TYPE_UI_PROBLEMS).toEqual([]);
    const ids = ["audio", "blank", "effect", "html", "image", "placeholder", "text", "video"];
    expect([...CLIP_TYPE_UIS.keys()].sort()).toEqual(ids);
    expect(CLIP_TYPE_UI_PATHS.sort()).toEqual(ids.map((id) => `../clipTypes/${id}/ui.tsx`));
  });
  it("falls back to the default UI for unknown types and asset kinds", () => {
    expect(clipUi({ clipType: "scene3d" } as unknown as Placement)).toBe(DEFAULT_CLIP_UI);
    expect(assetUi("scene3d")).toBe(DEFAULT_CLIP_UI);
    expect(clipUi({ clipType: "image", blank: { color: "#000000" } } as Placement).id).toBe("blank");
  });
  it("reports invalid UI modules", () => {
    expect(checkClipTypeUi({ id: "video" }, "video")).toEqual([]);
    expect(checkClipTypeUi(undefined, "video")[0]).toMatch(/no default export/);
    expect(checkClipTypeUi({ id: "vid" }, "video").join()).toMatch(/must equal its folder name/);
    expect(checkClipTypeUi({ id: "scene" }, "scene").join()).toMatch(/no clip type "scene"/);
    expect(checkClipTypeUi({ id: "video", name: "x" }, "video").join()).toMatch(/name must be a function/);
    expect(checkClipTypeUi({ id: "video", assetThumb: "gif" }, "video").join()).toMatch(/assetThumb/);
    const { uis, problems } = loadClipTypeUis({ "../clipTypes/video/ui.tsx": { default: { id: "video" } as ClipTypeUi }, "../clipTypes/x/ui.tsx": {} });
    expect([...uis.keys()]).toEqual(["video"]);
    expect(uis.get("video")!.assetThumb).toBe("frame");
    expect(problems).toHaveLength(1);
  });
  it("matches the frozen pre-P69 switches for every clip shape", () => {
    const project = createProject("t");
    project.assets.a = { id: "a", kind: "video", name: "clip.mp4", versions: [], selectedVersionId: "v" };
    const thumbs = { a: "data:t" };
    for (const p of shapes()) {
      const tag = `${p.clipType}${p.placeholder ? "+ph" : ""}${p.blank ? "+blank" : ""}${JSON.stringify([p.reverse, p.freeze, p.linkedAudio, p.speed, p.text, p.effect])}`;
      const u = clipUi(p);
      expect(needsThumb(p), tag).toBe(LEGACY.needsThumb(p));
      expect(clipKindClass(p), tag).toBe(LEGACY.kindClass(p));
      for (const strips of [undefined, { "a:v": { times: [], frames: [], aspect: 1 } }]) {
        expect(clipThumbStyle(p, thumbs, strips), tag).toEqual(LEGACY.thumbStyle(p, thumbs, strips));
        expect(clipThumbStyle(p, undefined, strips), tag).toEqual(LEGACY.thumbStyle(p, undefined, strips));
      }
      expect(u.thumbBackground, tag).toBe(LEGACY.collapsedThumb(p));
      expect(u.body ? u.id : undefined, tag).toBe(LEGACY.body(p));
      if (u.body) continue;
      expect(u.filmstrip, tag).toBe(LEGACY.filmstrip(p));
      expect(u.waveform(p), tag).toBe(LEGACY.wave(p));
      const name = clipDisplayName(p, project);
      expect(u.titlePrefix ? `${u.titlePrefix}${name}` : name, tag).toBe(LEGACY.title(p, project));
    }
  });
  it("placeholder and blank bodies are the pre-P69 markup", () => {
    const ph = { clipType: "image", placeholder: { label: "Shot 2" } } as Placement;
    expect(renderToStaticMarkup(<>{clipUi(ph).body!(ph)}</>)).toBe(renderToStaticMarkup(
      <span className="v2-clip-name v2-ph" title={`${ph.placeholder!.label} — not generated yet. Add its clip on the storyboard and Send to timeline (Update), or Fill placeholder (pick or upload a clip).`}>
        <Ic g="board" size={12} /><span className="v2-ph-label">{ph.placeholder!.label}</span><span className="v2-ph-state">Not generated</span>
      </span>));
    expect(renderToStaticMarkup(<>{clipUi({ clipType: "image", blank: { color: "#123456" } } as Placement).body!({ blank: { color: "#123456" } } as Placement)}</>))
      .toBe('<span class="v2-clip-name v2-blank-body" style="--blank:#123456"><span class="v2-blank-dot" aria-hidden="true"></span>Blank</span>');
  });
  it("asset thumbnails and previews follow the frozen pre-P69 rules for every kind", () => {
    for (const k of ["video", "image", "audio", "html", "text", "effect", "scene3d"] as (MediaKind | string)[]) {
      expect(assetUi(k).assetThumb, k).toBe(LEGACY.thumbMode(k));
      expect(assetUi(k).assetPreviews, k).toEqual(LEGACY.previews(k));
    }
  });
});

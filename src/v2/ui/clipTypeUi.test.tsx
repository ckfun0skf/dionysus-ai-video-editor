import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { assetUi, checkClipTypeUi, CLIP_TYPE_UI_PATHS, CLIP_TYPE_UI_PROBLEMS, CLIP_TYPE_UIS, clipUi, DEFAULT_CLIP_UI, loadClipTypeUis, UNKNOWN_CLIP_UI, type ClipTypeUi, type ResolvedClipTypeUi } from "./clipTypeUi";
import { clipDisplayName, clipKindClass, clipThumbStyle, needsThumb } from "./TimelineClip";
import { effectName } from "./effectName";
import { Ic } from "./Icon";
import { createProject, TEXT_SOURCE, type MediaKind, type Placement, type Project } from "../domain";
import type { Filmstrip } from "./media";
import { isKnownClipType } from "../clipTypes";

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

/** Frozen pre-P70 switches in V2App.tsx (inspector, mobile toolbar, context menu, sheets). */
const LEGACY70 = {
  editor: (p: Placement) => (p.clipType === "text" ? "text" : p.clipType === "effect" ? "effect" : p.clipType === "html" ? "code" : undefined),
  linkedAudio: (p: Placement) => p.clipType === "video",
  timeTools: (p: Placement) => p.clipType === "video",
  inOutFrames: (p: Placement) => p.clipType === "video",
  speed: (p: Placement) => p.clipType !== "image" && p.clipType !== "text",
  volume: (p: Placement) => p.clipType !== "image" && p.clipType !== "text" && p.clipType !== "effect",
  transformInAudioTab: (p: Placement) => p.clipType === "audio",
  fill: (p: Placement) => !!p.placeholder,
  textAdjust: (p: Placement) => p.clipType === "text",
  icon: (p: Placement) => (({ video: "▭", image: "image", audio: "♫", text: "T", html: "</>", effect: "effect" }) as Record<string, string>)[p.clipType] ?? "▭",
  title: (p: Placement, project: Project) => (p.clipType === "text" ? (p.text?.text?.split("\n")[0] || "Text") : p.clipType === "effect" ? `Effect · ${p.effect?.preset ?? ""}` : project.assets[p.source.assetId]?.name ?? p.clipType),
  /** Primary tool keys; `has` says which optional host tools exist (audio/speed may be missing, edit-audio needs an audio spec). */
  toolbar: (p: Placement, main: boolean, has: (k: string) => boolean) => (p.blank ? ["colour", "adjust", "link", "to-main"] : p.clipType === "effect" ? ["fx", "link", "adjust"]
    : p.clipType === "text" ? ["style", "anim", "subs"] : p.clipType === "html" ? ["params", "code", "adjust"]
    : p.clipType === "audio" ? ["audio", "speed", has("edit-audio") ? "edit-audio" : "adjust"] : main ? ["adjust", "audio", "speed"] : ["adjust", "link", "to-main"]).filter(has),
  /** Inspector tab ids (Transform label for text); `speedTab` = speed select, time tools or in-point; `trans` = a transition tab exists. */
  tabs: (p: Placement, speedSelect: boolean, speedTab: boolean, trans: boolean) => {
    const t = trans ? ["transition"] : [];
    if (p.clipType === "text") return ["text", "basic:Transform"];
    if (p.clipType === "effect") return ["effect"];
    if (p.clipType === "audio") return ["audio", ...(speedSelect ? ["speed"] : [])];
    if (p.clipType === "html") return ["params", "basic", "chroma", ...t];
    if (p.blank) return ["colour", "basic", ...t];
    if (p.clipType === "image") return ["basic", "chroma", ...t];
    return ["basic", ...(speedTab ? ["speed"] : []), "audio", "chroma", ...t];
  },
  actions: (p: Placement) => (p.clipType === "text" ? ["edit-all", "caption-style", "subtitles"] : p.clipType === "html" ? ["edit-code"] : []),
};

/** The host's resolution of the P70 fields, as V2App.tsx does it. */
function resolveToolbar(u: ResolvedClipTypeUi, main: boolean, has: (k: string) => boolean): string[] {
  return (main ? u.toolbarMain : u.toolbar).map((r): string | undefined => (Array.isArray(r) ? r.find(has) : has(r) ? r : undefined)).filter((k): k is string => !!k);
}
function resolveTabs(u: ResolvedClipTypeUi, speedTab: boolean, trans: boolean): string[] {
  const avail = (id: string) => (id === "speed" ? speedTab : id === "transition" ? trans : true);
  return u.inspectorTabs.map((r) => (typeof r === "string" ? (avail(r) ? r : undefined) : avail(r.id) ? `${r.id}:${r.label}` : undefined)).filter((k): k is string => !!k);
}

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
    // P73: the placeholder card is host code (PLACEHOLDER_UI), no longer a clip type UI module.
    const ids = ["audio", "blank", "effect", "html", "image", "scene", "text", "video"];
    expect([...CLIP_TYPE_UIS.keys()].sort()).toEqual(ids);
    expect(CLIP_TYPE_UI_PATHS.sort()).toEqual(ids.map((id) => `../clipTypes/${id}/ui.tsx`));
  });
  it("unknown types get the host's unknown-type UI; unknown asset kinds the default", () => {
    // P73 (§6, intended): before P73 an unknown type took DEFAULT_CLIP_UI (a plain media clip).
    expect(clipUi({ clipType: "scene3d" } as unknown as Placement)).toBe(UNKNOWN_CLIP_UI);
    expect(assetUi("scene3d")).toBe(DEFAULT_CLIP_UI);
    expect(clipUi({ clipType: "image", blank: { color: "#000000" } } as Placement).id).toBe("blank");
  });
  it("reports invalid UI modules", () => {
    expect(checkClipTypeUi({ id: "video" }, "video")).toEqual([]);
    expect(checkClipTypeUi(undefined, "video")[0]).toMatch(/no default export/);
    expect(checkClipTypeUi({ id: "vid" }, "video").join()).toMatch(/must equal its folder name/);
    expect(checkClipTypeUi({ id: "hologram" }, "hologram").join()).toMatch(/no clip type "hologram"/);
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
    // P73 (§6): unknown types intentionally leave the pre-P69 rules (UNKNOWN_CLIP_UI; see clipTypeState.test.tsx).
    for (const p of shapes().filter((x) => isKnownClipType(x.clipType))) {
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

describe("P70 inspector, toolbar and menu fields", () => {
  it("every UI module defines the P70 fields (defaults filled in)", () => {
    for (const u of [...CLIP_TYPE_UIS.values(), DEFAULT_CLIP_UI]) {
      expect(typeof u.inspectorTitle, u.id).toBe("function");
      expect(u.inspectorTabs.length, u.id).toBeGreaterThan(0);
      expect(u.toolbar.length, u.id).toBeGreaterThan(0);
      expect(u.toolbarMain.length, u.id).toBeGreaterThan(0);
    }
    expect(checkClipTypeUi({ id: "video", inspectorTitle: "x" }, "video").join()).toMatch(/inspectorTitle must be a function/);
    const { uis } = loadClipTypeUis({ "../clipTypes/audio/ui.tsx": { default: { id: "audio", toolbar: ["audio"] } as ClipTypeUi } });
    expect(uis.get("audio")!.toolbarMain).toEqual(["audio"]);
  });
  it("matches the frozen pre-P70 V2App switches for every clip shape", () => {
    const project = createProject("t");
    project.assets.a = { id: "a", kind: "video", name: "clip.mp4", versions: [], selectedVersionId: "v" };
    const both = (p: Placement) => !!(p.placeholder && p.blank); // never created by the app (accepted edge, as in P67/P69)
    for (const p of shapes().filter((x) => !both(x) && isKnownClipType(x.clipType))) {
      const tag = `${p.clipType}${p.placeholder ? "+ph" : ""}${p.blank ? "+blank" : ""}${JSON.stringify([p.reverse, p.freeze, p.linkedAudio, p.speed, p.text, p.effect])}`;
      const u = clipUi(p);
      expect(u.editor, tag).toBe(LEGACY70.editor(p));
      expect(u.linkedAudio, tag).toBe(LEGACY70.linkedAudio(p));
      expect(u.timeTools, tag).toBe(LEGACY70.timeTools(p));
      expect(u.inOutFrames, tag).toBe(LEGACY70.inOutFrames(p));
      expect(u.speed, tag).toBe(LEGACY70.speed(p));
      expect(u.volume, tag).toBe(LEGACY70.volume(p));
      expect(u.transformInAudioTab, tag).toBe(LEGACY70.transformInAudioTab(p));
      expect(u.extraTools.includes("fill"), tag).toBe(LEGACY70.fill(p));
      expect(u.extraTools.includes("adjust"), tag).toBe(LEGACY70.textAdjust(p));
      expect(u.inspectorIcon, tag).toBe(LEGACY70.icon(p));
      expect(u.inspectorTitle(p, project), tag).toBe(LEGACY70.title(p, project));
      expect(u.inspectorActions, tag).toEqual(LEGACY70.actions(p));
      for (const main of [false, true]) for (const opt of [[], ["audio"], ["speed"], ["edit-audio"], ["audio", "speed", "edit-audio"]]) {
        const has = (k: string) => !["audio", "speed", "edit-audio"].includes(k) || opt.includes(k);
        expect(resolveToolbar(u, main, has), `${tag} main=${main} ${opt}`).toEqual(LEGACY70.toolbar(p, main, has));
      }
      for (const speedSelect of [false, true]) for (const trans of [false, true]) {
        // The speed tab shows with a speed select, time tools or an in-point; for non-video types only the select applies.
        const speedTabs = p.clipType === "video" ? [false, true] : [speedSelect];
        for (const speedTab of speedTabs) {
          if (speedSelect && !speedTab) continue;
          expect(resolveTabs(u, speedTab, trans), `${tag} ${speedSelect} ${speedTab} ${trans}`).toEqual(LEGACY70.tabs(p, speedSelect, speedTab, trans));
        }
      }
    }
  });
});

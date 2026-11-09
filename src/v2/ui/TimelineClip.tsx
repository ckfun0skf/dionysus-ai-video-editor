import { useEffect, useRef, type RefObject } from "react";
import { FilmstripTiles, Waveform } from "./ClipPreview";
import type { Filmstrip, Peaks } from "./media";
import { mediaKey } from "./useMedia";
import { clampPps, pinchZoom, touchDistance } from "./gestures";
import { board, layers, TICKS_PER_SECOND, type Placement, type Project, type Track } from "../domain";
import { Ic } from "./Icon";
import type { ClipLoad } from "../render";
import { getPreset } from "../registry";

/**
 * Timeline clip parts shared by the main timeline and the merge-conflict lanes (P34): the clip's inner look
 * (filmstrip / waveform / name / badges / fades / keyframes), its thumbnail background, and pinch / Ctrl+wheel zoom.
 */
export const effectName = (p: Placement) => getPreset("videoEffect", p.effect?.preset)?.name ?? "Effect";
export const needsThumb = (p: Placement) => !p.placeholder && !p.blank && (p.clipType === "video" || p.clipType === "image" || p.clipType === "html");
/** Extra `.v2-clip` classes from what the clip is (P35: a shot placeholder draws as a hatched card). */
export const clipKindClass = (p: Placement) => (p.placeholder ? "is-placeholder" : p.blank ? "is-blank" : "");
export const clipThumbStyle = (p: Placement, thumbs?: Record<string, string>, strips?: Record<string, Filmstrip>) =>
  p.blank ? { background: p.blank.color } :
  thumbs?.[p.source.assetId] && p.clipType !== "audio" && !strips?.[mediaKey(p.source.assetId, p.source.versionId)] ? { backgroundImage: `url(${thumbs[p.source.assetId]})` } : {};
export const clipNoThumb = (p: Placement, thumbs?: Record<string, string>, strips?: Record<string, Filmstrip>) =>
  needsThumb(p) && !thumbs?.[p.source.assetId] && !strips?.[mediaKey(p.source.assetId, p.source.versionId)];

/** Pinch (two fingers) and Ctrl/⌘+wheel (trackpad) zoom on a scroller. Native non-passive listeners stop page zoom. */
export function useTimelineZoom(ref: RefObject<HTMLElement | null>, pps: number, onZoom?: (pps: number) => void, onPinchStart?: () => void) {
  const z = useRef({ pps, onZoom, onPinchStart });
  z.current = { pps, onZoom, onPinchStart };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pinch: { d0: number; pps0: number } | undefined;
    const ts = (e: TouchEvent) => { if (e.touches.length === 2) { pinch = { d0: touchDistance(e.touches[0], e.touches[1]), pps0: z.current.pps }; z.current.onPinchStart?.(); } };
    const tm = (e: TouchEvent) => { if (pinch && e.touches.length === 2) { e.preventDefault(); z.current.onZoom?.(pinchZoom(pinch.pps0, pinch.d0, touchDistance(e.touches[0], e.touches[1]))); } };
    const te = (e: TouchEvent) => { if (e.touches.length < 2) pinch = undefined; };
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); z.current.onZoom?.(clampPps(z.current.pps * Math.exp(-e.deltaY / 200))); };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { el.removeEventListener("touchstart", ts); el.removeEventListener("touchmove", tm); el.removeEventListener("touchend", te); el.removeEventListener("wheel", wheel); };
  }, [ref]);
}

/** Everything drawn inside a `.v2-clip` box except the trim handles. */
export function ClipBody({ p, track, isMain, project, pps, strips, peaks, loads }: { p: Placement; track: Track; isMain: boolean; project: Project; pps: number; strips?: Record<string, Filmstrip>; peaks?: Record<string, Peaks>; loads?: ReadonlyMap<string, ClipLoad> }) {
  const toPx = (t: number) => (t / TICKS_PER_SECOND) * pps;
  if (p.placeholder) return <PlaceholderBody p={p} />;
  if (p.blank) return <span className="v2-clip-name v2-blank-body" style={{ ["--blank" as string]: p.blank.color }}><span className="v2-blank-dot" aria-hidden />Blank</span>;
  const asset = project.assets[p.source.assetId];
  const link = project.storyboard && p.source.assetId ? board.storyLinkOf(project, p.source.assetId) : undefined;
  return <>
    {(() => {
      const key = mediaKey(p.source.assetId, p.source.versionId);
      const w = Math.max(4, toPx(p.durationTicks));
      const strip = p.clipType === "video" ? strips?.[key] : undefined;
      const pk = p.clipType !== "image" && !(p.clipType === "video" && (p.linkedAudio?.muted || p.freeze || p.reverse)) ? peaks?.[key] : undefined;
      const ld = loads?.get(p.id);
      return <>
        {ld && <ClipLoadBar load={ld} />}
        {strip && <FilmstripTiles strip={strip} p={p} width={w} pps={pps} />}
        {pk && <Waveform peaks={pk} p={p} width={w} height={p.clipType === "audio" ? 38 : 14} kind={p.clipType === "audio" ? "audio" : "video"} />}
      </>;
    })()}
    <span className="v2-clip-name">{link && <span className="v2-clip-badge v2-clip-link" title={`${link.label} on the storyboard: follows the version you pick there (now v${link.versionNo} of ${link.versionCount})`} aria-label={`Storyboard ${link.label}, version ${link.versionNo}`}><Ic g="link" size={11} />v{link.versionNo}</span>}{p.freeze && <span className="v2-clip-badge" title="Freeze frame" aria-label="Freeze frame"><Ic g="❄" /></span>}{p.reverse && <span className="v2-clip-badge" title="Reversed" aria-label="Reversed"><Ic g="⟲" /></span>}{p.speed && p.speed !== 1 && <span className="v2-clip-badge" title={`Speed ${p.speed}×`}>{p.speed}×</span>}{p.linkedAudio?.muted && !p.freeze && <span className="v2-clip-badge" title="Clip audio muted" aria-label="Clip audio muted"><Ic g="🔇" /></span>}{p.clipType === "effect" ? <><Ic g="effect" size={12} /> {effectName(p)}</> : p.clipType === "text" ? <><Ic g="T" size={12} /> {p.text?.text || "Text"}</> : asset?.name ?? "missing media"}</span><AnimBadges p={p} width={Math.max(4, toPx(p.durationTicks))} />
    {p.link && !isMain && <span className={`v2-link-mark ${track.kind === "audio" ? "up" : "down"}`} aria-label="Linked to main clip" title="Linked to the main clip: moves, trims and deletes with it" />}
    {layers.isCustom(track, p) && <span className="v2-custom-dot" title="Custom style: this clip differs from its layer style" aria-label="Custom style" />}
    {!!p.fadeInTicks && <span className="v2-fade in" aria-label="Fade in" style={{ width: toPx(p.fadeInTicks) }} />}
    {!!p.fadeOutTicks && <span className="v2-fade out" aria-label="Fade out" style={{ width: toPx(p.fadeOutTicks) }} />}
    {[...new Set(Object.values(p.keyframes ?? {}).flatMap((ks) => ks!.map((k) => k.t)))].filter((k) => k >= 0 && k <= p.durationTicks).map((k) => (
      <span key={k} className="v2-kf-dot" aria-label="Keyframe" style={{ left: toPx(k) }} />
    ))}
  </>;
}

/** P35: a storyboard shot with no clip yet: shot label and "Not generated" on a hatched card. */
function PlaceholderBody({ p }: { p: Placement }) {
  return (
    <span className="v2-clip-name v2-ph" title={`${p.placeholder!.label} — not generated yet. Add its clip on the storyboard and Send to timeline (Update), or Fill placeholder (pick or upload a clip).`}>
      <Ic g="board" size={12} /><span className="v2-ph-label">{p.placeholder!.label}</span><span className="v2-ph-state">Not generated</span>
    </span>
  );
}

export function animBadges(p: Placement): ("in" | "out" | "loop")[] {
  const t = p.text;
  if (!t) return [];
  const on = (v?: string) => !!v && v !== "none";
  return [...(on(t.animIn) ? ["in" as const] : []), ...(on(t.animOut) ? ["out" as const] : []), ...(on(t.loop) ? ["loop" as const] : [])];
}
const BADGE_LABEL = { in: "In animation", out: "Out animation", loop: "Loop animation" } as const;
/** In badge at the clip start, Out at the end, Loop in between; on narrow clips they pack into one corner chip. */
export function AnimBadges({ p, width }: { p: Placement; width: number }) {
  const b = animBadges(p);
  if (!b.length) return null;
  const narrow = width < b.length * 16 + 8;
  return (
    <span className={`v2-anim-badges ${narrow ? "is-narrow" : ""}`} aria-label={b.map((k) => BADGE_LABEL[k]).join(", ")}>
      {b.map((k) => <span key={k} className={`v2-anim-badge is-${k}`} title={BADGE_LABEL[k]}><Ic g={`anim-${k}`} size={9} /></span>)}
    </span>
  );
}


/** P29-CLIP-LOADING: thin bar at the clip's bottom edge with the loaded share, or a spinner when progress is unknown. */
export function ClipLoadBar({ load }: { load: ClipLoad }) {
  const pct = load.progress === undefined ? undefined : Math.round(load.progress * 100);
  return pct === undefined
    ? <span className="v2-clip-load is-unknown" role="status" aria-label="Loading media"><span className="v2-clip-spin" aria-hidden="true" /></span>
    : <span className="v2-clip-load" role="progressbar" aria-label="Loading media" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span className="v2-clip-load-fill" style={{ width: `${pct}%` }} /></span>;
}


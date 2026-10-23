import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cmd, type Engine } from "../engine";
import { FilmstripTiles, Waveform } from "./ClipPreview";
import type { Filmstrip, Peaks } from "./media";
import { mediaKey } from "./useMedia";
import { clampPps, haptic, LONG_PRESS_MS, LONG_PRESS_SLOP, pinchZoom, touchDistance } from "./gestures";
import { edit, ops, transitions, compositionDuration, TICKS_PER_SECOND, formatTimecode, type Composition, type Project } from "../domain";
import { Ic } from "./Icon";

interface Props {
  engine: Engine;
  project: Project;
  time: number;
  playing: boolean;
  onSeek: (t: number) => void;
  selectedId?: string;
  /** Multi-selection (highlighted); trim handles show only for a single `selectedId`. */
  selectedIds?: string[];
  /** Shift/⌘/Ctrl-click (or mobile multi-select mode) toggles a clip in the selection. */
  onToggleSelect?: (id: string) => void;
  multiMode?: boolean;
  onSelect: (id?: string) => void;
  pps: number;
  /** Pinch (touch) or Ctrl/⌘+wheel (trackpad) zoom. */
  onZoom?: (pps: number) => void;
  /** Mobile/CapCut mode: fixed centred playhead, the tracks scroll under it. */
  centered: boolean;
  /** Centered mode extras (CapCut layout). */
  thumbs?: Record<string, string>;
  /** Per asset-version waveforms / filmstrips (see useMediaPreviews). */
  peaks?: Record<string, Peaks>;
  strips?: Record<string, Filmstrip>;
  onAddMedia?: () => void;
  sideColumn?: ReactNode;
  timeLabel?: ReactNode;
  /** Extra lane rendered above the tracks (subtitles), given the time↔px mapping. */
  /** Ripple mode: trims move later clips on the track. */
  ripple?: boolean;
  /** Click on a cut marker between adjacent clips (id = incoming clip). */
  onTransition?: (id: string) => void;
  topLane?: { label: string; render: (toPx: (t: number) => number, toTicks: (px: number) => number) => ReactNode };
}

/** Fixed playhead position in centered mode, as a fraction of the viewport width. */
const PLAYHEAD_FRAC = 0.42;

type Gesture =
  | { kind: "move"; id: string; x0: number; y0: number; start0: number; trackId: string; start: number; active: boolean; snap?: number }
  | { kind: "trim"; id: string; edge: "left" | "right"; x0: number; edge0: number; to: number; snap?: number };

const HEADER_W = 84;
/** Centered mode: width of the fixed, opaque track-control column left of the lanes. */
export const SIDE_W = 76;

export function Timeline({ engine, project, time, playing, onSeek, selectedId, selectedIds, onToggleSelect, multiMode, onSelect, pps, onZoom, centered, thumbs, peaks, strips, onAddMedia, sideColumn, timeLabel, topLane, ripple, onTransition }: Props) {
  const comp = project.compositions[project.rootCompositionId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture>();
  const [viewW, setViewW] = useState(800);
  const programmatic = useRef(false);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number }>();
  const zoomRef = useRef({ pps, onZoom });
  zoomRef.current = { pps, onZoom };

  // Pinch-to-zoom (two fingers) and Ctrl/⌘+wheel. Native non-passive listeners so we can stop page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pinch: { d0: number; pps0: number } | undefined;
    const ts = (e: TouchEvent) => { if (e.touches.length === 2) { pinch = { d0: touchDistance(e.touches[0], e.touches[1]), pps0: zoomRef.current.pps }; cancelPress(); } };
    const tm = (e: TouchEvent) => { if (pinch && e.touches.length === 2) { e.preventDefault(); zoomRef.current.onZoom?.(pinchZoom(pinch.pps0, pinch.d0, touchDistance(e.touches[0], e.touches[1]))); } };
    const te = (e: TouchEvent) => { if (e.touches.length < 2) pinch = undefined; };
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoomRef.current.onZoom?.(clampPps(zoomRef.current.pps * Math.exp(-e.deltaY / 200))); };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => { el.removeEventListener("touchstart", ts); el.removeEventListener("touchmove", tm); el.removeEventListener("touchend", te); el.removeEventListener("wheel", wheel); };
  }, []);
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = undefined; } };
  const toPx = (t: number) => (t / TICKS_PER_SECOND) * pps;
  const toTicks = (px: number) => Math.round((px / pps) * TICKS_PER_SECOND);
  const duration = compositionDuration(comp);
  const pad = centered ? Math.round(viewW * PLAYHEAD_FRAC) : 0;
  const padRight = centered ? viewW - pad : 0;
  const contentW = Math.max(toPx(duration) + (centered ? 0 : 400), centered ? 1 : viewW - HEADER_W);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Centered mode: keep scroll in sync with time (playback / external seeks).
  useEffect(() => {
    const el = scrollRef.current;
    if (!centered || !el) return;
    const target = toPx(time);
    if (Math.abs(el.scrollLeft - target) > 1) { programmatic.current = true; el.scrollLeft = target; }
  });
  // Desktop: auto-follow playhead during playback.
  useEffect(() => {
    const el = scrollRef.current;
    if (centered || !el || !playing) return;
    const x = toPx(time);
    if (x > el.scrollLeft + el.clientWidth - HEADER_W - 40) el.scrollLeft = x - 40;
  }, [time, playing, centered]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!centered || !el) return;
    if (programmatic.current) { programmatic.current = false; return; }
    if (!playing) onSeek(Math.max(0, toTicks(el.scrollLeft)));
  };

  const preview: Composition = useMemo(() => {
    if (!gesture) return comp;
    try {
      if (gesture.kind === "move") return gesture.active ? ops.movePlacement(comp, gesture.id, gesture.trackId, gesture.start) : comp;
      const p = comp.tracks.flatMap((t) => t.placements).find((x) => x.id === gesture.id);
      const asset = p && project.assets[p.source.assetId];
      const max = asset?.kind === "image" ? undefined : asset?.versions.find((v) => v.id === p?.source.versionId)?.media.durationTicks;
      return (ripple ? edit.rippleTrim : ops.trimPlacement)(comp, gesture.id, gesture.edge, gesture.to, max);
    } catch { return comp; }
  }, [gesture, comp, project.assets, ripple]);

  const snapThreshold = toTicks(8);
  const trackAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-track-id]") as HTMLElement | null)?.dataset.trackId;

  const onClipDown = (e: React.PointerEvent, id: string, trackId: string, start: number) => {
    e.stopPropagation();
    if (onToggleSelect && (multiMode || e.shiftKey || e.metaKey || e.ctrlKey)) { onToggleSelect(id); return; }
    const target = e.currentTarget as HTMLElement;
    const { clientX, clientY, pointerId } = e;
    const startMove = (active: boolean) => {
      target.setPointerCapture?.(pointerId);
      setGesture({ kind: "move", id, x0: clientX, y0: clientY, start0: start, trackId, start, active });
    };
    if (centered && selectedId !== id) {
      // Touch layouts: tap selects; long-press selects AND picks the clip up for dragging.
      onSelect(id);
      cancelPress();
      press.current = { x: clientX, y: clientY, timer: setTimeout(() => { press.current = undefined; haptic(15); startMove(true); }, LONG_PRESS_MS) };
      return;
    }
    onSelect(id);
    startMove(false);
  };
  const onTrimDown = (e: React.PointerEvent, id: string, edge: "left" | "right", edgeTicks: number) => {
    e.stopPropagation();
    onSelect(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGesture({ kind: "trim", id, edge, x0: e.clientX, edge0: edgeTicks, to: edgeTicks });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > LONG_PRESS_SLOP) cancelPress();
    if (!gesture) return;
    if (gesture.kind === "move") {
      const dx = e.clientX - gesture.x0;
      const active = gesture.active || Math.abs(dx) > 4 || Math.abs(e.clientY - gesture.y0) > 8;
      const p = comp.tracks.flatMap((t) => t.placements).find((x) => x.id === gesture.id)!;
      const raw = Math.max(0, gesture.start0 + toTicks(dx));
      const start = Math.max(0, ops.snapMove(comp, raw, p.durationTicks, snapThreshold, [time], gesture.id));
      const trackId = trackAt(e.clientX, e.clientY) ?? gesture.trackId;
      // Snap line at whichever edge aligned (start snaps first, like ops.snapMove).
      const snap = start === raw ? undefined : ops.snapTicks(comp, raw, snapThreshold, [time], gesture.id) !== raw ? start : start + p.durationTicks;
      if (snap !== undefined && snap !== gesture.snap) haptic(8);
      setGesture({ ...gesture, start, trackId, active, snap });
    } else {
      const raw = gesture.edge0 + toTicks(e.clientX - gesture.x0);
      const to = ops.snapTicks(comp, raw, snapThreshold, [time], gesture.id);
      const snap = to === raw ? undefined : to;
      if (snap !== undefined && snap !== gesture.snap) haptic(8);
      setGesture({ ...gesture, to, snap });
    }
  };
  const onPointerUp = () => {
    cancelPress();
    if (!gesture) return;
    if (gesture.kind === "move" && gesture.active) engine.dispatch(cmd.movePlacement(gesture.id, gesture.trackId, gesture.start));
    if (gesture.kind === "trim" && gesture.to !== gesture.edge0) engine.dispatch(cmd.trimPlacement(gesture.id, gesture.edge, gesture.to, ripple));
    setGesture(undefined);
  };

  const scrub = (e: React.PointerEvent) => {
    if (centered) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const seek = (x: number) => onSeek(Math.max(0, toTicks(x - rect.left)));
    seek(e.clientX);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => seek(ev.clientX);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onDrop = (e: React.DragEvent, trackId: string) => {
    const assetId = e.dataTransfer.getData("application/x-dionysus-asset");
    if (!assetId) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    engine.dispatch(cmd.addAssetToTimeline(assetId, Math.max(0, toTicks(e.clientX - rect.left)), trackId));
  };

  const firstVideo = comp.tracks.find((t) => t.kind === "video");
  const laneEnd = (ps: { startTicks: number; durationTicks: number }[]) => ps.reduce((m, p) => Math.max(m, p.startTicks + p.durationTicks), 0);
  const step = pps >= 80 ? 1 : pps >= 30 ? 2 : pps >= 12 ? 5 : 10;
  const ticks: number[] = [];
  const rulerSeconds = (contentW + pad + padRight) / pps;
  for (let s = 0; s <= rulerSeconds; s += step) ticks.push(s);

  return (
    <div className={`v2-timeline ${centered ? "is-centered" : ""}`}>
      {!centered && (
        <div className="v2-track-headers">
          <div className="v2-ruler-spacer" />
          {topLane && <div className="v2-track-header kind-text"><span>{topLane.label}</span></div>}
          {comp.tracks.map((t) => (
            <div key={t.id} className={`v2-track-header kind-${t.kind}`}>
              <span>{t.name}</span>
              <button className="v2-icon" title={t.muted ? "Unmute track" : "Mute track"} aria-label={t.muted ? "Unmute track" : "Mute track"} onClick={() => engine.dispatch(cmd.toggleTrackMute(t.id))}><Ic g={t.muted ? "🔇" : "🔊"} /></button>
            </div>
          ))}
        </div>
      )}
      {centered && sideColumn && <div className="v2-side-col" data-testid="side-col" style={{ width: SIDE_W }}>{sideColumn}</div>}
      <div className="v2-scroll" ref={scrollRef} onScroll={onScroll} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { cancelPress(); setGesture(undefined); }}>
        <div className="v2-content" style={{ width: contentW + pad + padRight, paddingLeft: pad, paddingRight: padRight }}>
          <div className="v2-ruler" onPointerDown={scrub}>
            {ticks.map((s) => (
              <span key={s} className="v2-tick" style={{ left: s * pps }}>{formatTimecode(s * TICKS_PER_SECOND, project.settings.fps).slice(0, 5)}</span>
            ))}
          </div>
          {topLane?.render(toPx, toTicks)}
          {preview.tracks.map((t) => (
            <div key={t.id} className={`v2-lane kind-${t.kind} ${t.muted ? "is-muted" : ""}`} data-track-id={t.id}
              onPointerDown={(e) => { if (e.target === e.currentTarget) { onSelect(undefined); if (!centered) scrub(e); } }}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, t.id)}>
              {centered && t.muted && <span className="v2-lane-label"><Ic g="🔇" /></span>}
              {t.placements.map((p) => {
                const asset = project.assets[p.source.assetId];
                const sel = p.id === selectedId;
                const inSel = sel || !!selectedIds?.includes(p.id);
                return (
                  <div key={p.id} className={`v2-clip clip-${p.clipType} ${inSel ? "is-selected" : ""}`} data-placement-id={p.id}
                    style={{ left: toPx(p.startTicks), width: Math.max(4, toPx(p.durationTicks)), ...(centered && thumbs?.[p.source.assetId] && p.clipType !== "audio" && !strips?.[mediaKey(p.source.assetId, p.source.versionId)] ? { backgroundImage: `url(${thumbs[p.source.assetId]})` } : {}) }}
                    onPointerDown={(e) => onClipDown(e, p.id, t.id, p.startTicks)} title={p.clipType === "text" ? p.text?.text : asset?.name}>
                    {(() => {
                      const key = mediaKey(p.source.assetId, p.source.versionId);
                      const w = Math.max(4, toPx(p.durationTicks));
                      const strip = p.clipType === "video" ? strips?.[key] : undefined;
                      const pk = p.clipType !== "image" && !(p.clipType === "video" && (p.linkedAudio?.muted || p.freeze || p.reverse)) ? peaks?.[key] : undefined;
                      return <>
                        {strip && <FilmstripTiles strip={strip} p={p} width={w} pps={pps} />}
                        {pk && <Waveform peaks={pk} p={p} width={w} height={p.clipType === "audio" ? 38 : 14} kind={p.clipType === "audio" ? "audio" : "video"} />}
                      </>;
                    })()}
                    <span className="v2-clip-name">{p.freeze && <span className="v2-clip-badge" title="Freeze frame" aria-label="Freeze frame"><Ic g="❄" /></span>}{p.reverse && <span className="v2-clip-badge" title="Reversed" aria-label="Reversed"><Ic g="⟲" /></span>}{p.speed && p.speed !== 1 && <span className="v2-clip-badge" title={`Speed ${p.speed}×`}>{p.speed}×</span>}{p.linkedAudio?.muted && !p.freeze && <span className="v2-clip-badge" title="Clip audio muted" aria-label="Clip audio muted"><Ic g="🔇" /></span>}{p.clipType === "text" ? <><Ic g="T" size={12} /> {p.text?.text || "Text"}</> : asset?.name ?? "missing media"}</span>
                    {!!p.fadeInTicks && <span className="v2-fade in" aria-label="Fade in" style={{ width: toPx(p.fadeInTicks) }} />}
                    {!!p.fadeOutTicks && <span className="v2-fade out" aria-label="Fade out" style={{ width: toPx(p.fadeOutTicks) }} />}
                    {[...new Set(Object.values(p.keyframes ?? {}).flatMap((ks) => ks!.map((k) => k.t)))].filter((k) => k >= 0 && k <= p.durationTicks).map((k) => (
                      <span key={k} className="v2-kf-dot" aria-label="Keyframe" style={{ left: toPx(k) }} />
                    ))}
                    {sel && <>
                      <div className="v2-handle left" aria-label="Trim start" onPointerDown={(e) => onTrimDown(e, p.id, "left", p.startTicks)} />
                      <div className="v2-handle right" aria-label="Trim end" onPointerDown={(e) => onTrimDown(e, p.id, "right", p.startTicks + p.durationTicks)} />
                    </>}
                  </div>
                );
              })}
              {onTransition && t.kind === "video" && t.placements.filter((p) => transitions.previousAdjacent(t, p)).map((p) => {
                const tr = p.transitionIn;
                return (
                  <button key={`tr-${p.id}`} className={`v2-trans ${tr ? "has-trans" : ""} ${tr && p.id === selectedId ? "is-selected" : ""}`} style={{ left: toPx(p.startTicks) }}
                    aria-label={tr ? `${transitions.TRANSITIONS[tr.kind].label} ${tr.durationTicks / TICKS_PER_SECOND}s` : "Add crossfade"} title={tr ? "Edit transition" : "Add a crossfade at this cut"}
                    onPointerDown={(e) => e.stopPropagation()} onClick={() => onTransition(p.id)}>
                    <Ic g={tr ? transitions.TRANSITIONS[tr.kind].icon : "+"} size={14} />
                  </button>
                );
              })}
              {centered && onAddMedia && t.id === firstVideo?.id && (
                <button className="v2-lane-add" style={{ left: toPx(laneEnd(t.placements)) + 8 }} aria-label="Add media" onPointerDown={(e) => e.stopPropagation()} onClick={onAddMedia}>+</button>
              )}
            </div>
          ))}
          {gesture?.snap !== undefined && (gesture.kind === "trim" || gesture.active) && <div className="v2-snap-line" data-testid="snap-line" style={{ left: pad + toPx(gesture.snap) }} aria-hidden />}
          {!centered && <div className="v2-playhead" style={{ left: toPx(time) }} />}
        </div>
      </div>
      {centered && <div className="v2-playhead-fixed" style={{ left: (sideColumn ? SIDE_W : 0) + pad }} aria-hidden />}
      {centered && timeLabel && <div className="v2-time-label">{timeLabel}</div>}
    </div>
  );
}

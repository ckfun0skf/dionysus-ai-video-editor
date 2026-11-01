import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cmd, type Engine } from "../engine";
import { FilmstripTiles, Waveform } from "./ClipPreview";
import type { Filmstrip, Peaks } from "./media";
import { mediaKey } from "./useMedia";
import { clampPps, haptic, LONG_PRESS_MS, LONG_PRESS_SLOP, pinchZoom, touchDistance } from "./gestures";
import { board, edit, findPlacement, slip, layers, ops, transitions, compositionDuration, TICKS_PER_SECOND, formatTimecode, type Composition, type Placement, type Project, type Track } from "../domain";
import { Ic } from "./Icon";
import { getPreset } from "../registry";

interface Props {
  /** V2-103: open the layer-mode text editor ("Edit all") for a text layer. */
  onEditSubs?: (trackId: string) => void;
  /** Desktop: click a group header to focus that group (only its layers shown; others become lines on the main track). */
  onFocusGroup?: (g?: ops.TrackGroup) => void;
  onEditLayer?: (trackId: string) => void;
  /** Mobile: the expanded group (lifted so the bottom toolbar's ‹ can collapse it). */
  expanded?: ops.TrackGroup;
  onExpand?: (g: ops.TrackGroup | undefined) => void;
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
  /** V2-106 desktop: browser items (text, stickers, effects, code clips) and OS files dropped at `ticks`. */
  onDropData?: (dt: DataTransfer, ticks: number, trackId?: string) => void;
  /** V2-107 (desktop): right-click on a clip or an empty lane. */
  onContextMenu?: (at: { x: number; y: number; placementId?: string; trackId?: string; ticks: number }) => void;
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
  /** V2-099: a non-Edit mode (Audio/Text/Effect/Overlay) shows only the main track plus this group. */
  focus?: ops.TrackGroup;
  topLane?: { label: string; render: (toPx: (t: number) => number, toTicks: (px: number) => number) => ReactNode };
}

/** Fixed playhead position in centered mode, as a fraction of the viewport width. */
// V2-111: true centre line, like CapCut.
const PLAYHEAD_FRAC = 0.5;
/** V2-111: a ruler label at screen x (≈34px wide) would sit under the fixed time readout ending at labelRight → fade it out. */
export const tickUnderLabel = (x: number, labelRight: number) => x + 34 > 0 && x < labelRight + 4;

type Gesture =
  | { kind: "move"; id: string; x0: number; y0: number; start0: number; trackId: string; start: number; active: boolean; snap?: number }
  | { kind: "trim"; id: string; edge: "left" | "right"; x0: number; edge0: number; to: number; snap?: number };

const HEADER_W = typeof window !== "undefined" && window.innerWidth >= 900 ? 264 : 84;
/** Centered mode: width of the fixed, opaque track-control column left of the lanes. */
/** Compact height of text lanes in centered (mobile) mode; keeps the side column aligned with the main track. */
export const TEXT_LANE_H = 32;
/** True on touch-first devices (phones/tablets): controls grow to 44px hit areas there. */
export const coarsePointer = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
export const SIDE_W = 184;

export function Timeline({ engine, project, time, playing, onSeek, selectedId, selectedIds, onToggleSelect, multiMode, onSelect, pps, onZoom, centered, thumbs, peaks, strips, onAddMedia, sideColumn, timeLabel, topLane, ripple, onTransition, expanded: expandedProp, onExpand, focus, onEditLayer, onEditSubs, onFocusGroup, onDropData, onContextMenu }: Props) {
  const comp = project.compositions[project.rootCompositionId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture>();
  const [scrollTop, setScrollTop] = useState(0);
  /** Mobile: the group shown as its real layers (others are collapsed into one lane each). */
  const [expandedInner, setExpandedInner] = useState<ops.TrackGroup>();
  const expanded = onExpand ? expandedProp : expandedInner;
  const setExpanded = onExpand ?? setExpandedInner;
  const [confirmDel, setConfirmDel] = useState<string>();
  /** V2-099: ≡ handle drag reordering a layer inside its group (live placeholder via row shifts). */
  const [layerDrag, setLayerDrag] = useState<LayerDrag>();
  const rootRef = useRef<HTMLDivElement>(null);
  // CapCut long-press reorder on the main track: clips collapse to square thumbs; drag one to a new slot.
  const [reorder, setReorder] = useState<{ id: string; x0: number; x: number; from: number; closing?: boolean }>();
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
  /** Mobile: tapping empty timeline space leaves the current mode (back to root). */
  // P1-ADD-TRACK: [+] at the bottom of a track-type mode (CapCut-like; 44px touch target, works with touch and mouse).
  const addBtn = (g: Exclude<ops.TrackGroup, "main">) => (
    <button type="button" className="v2-add-track" data-group={g} aria-label={`Add ${ops.GROUP_LABEL[g]} track`} title={`Add an empty ${ops.GROUP_LABEL[g]} track`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); engine.dispatch(cmd.addGroupTrack(g)); if (centered) setExpanded(g); }}>
      <Ic g="+" size={18} /><span>{g === "text" ? "Add text track" : `Add ${ops.GROUP_LABEL[g].toLowerCase()} track`}</span>
    </button>
  );
  const exitMode = () => { if (Date.now() - dragEndAt.current < 400) return; onSelect(undefined); setExpanded(undefined); };
  /** A layer drag ending over empty space fires a click there; it must not count as an exit tap. */
  const dragEndAt = useRef(0);
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = undefined; } };
  const labelRef = useRef<HTMLDivElement>(null);
  const toPx = (t: number) => (t / TICKS_PER_SECOND) * pps;
  const toTicks = (px: number) => Math.round((px / pps) * TICKS_PER_SECOND);
  const duration = compositionDuration(comp);
  const pad = centered ? Math.max(Math.round(viewW * PLAYHEAD_FRAC), sideColumn ? SIDE_W + 8 : 0) : 0;
  const padRight = centered ? viewW - pad : 0;
  const contentW = Math.max(toPx(duration) + (centered ? 0 : 400), centered ? 1 : viewW); // V2-111: the ruler/lanes always reach the panel's right edge (viewW is the scroller, headers excluded)

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
    if (el && el.scrollTop !== scrollTop) setScrollTop(el.scrollTop);
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
    const mainT = ops.mainTrack(comp);
    if (centered && mainT?.id === trackId) {
      // Main track on touch: tap selects, long-press enters reorder mode (no free drag, so the track stays gapless).
      onSelect(id);
      cancelPress();
      press.current = { x: clientX, y: clientY, timer: setTimeout(() => {
        press.current = undefined; haptic(15);
        const from = [...mainT.placements].sort((a, b) => a.startTicks - b.startTicks).findIndex((p) => p.id === id);
        setReorder({ id, x0: clientX, x: clientX, from });
      }, LONG_PRESS_MS) };
      return;
    }
    if (centered && selectedId !== id) {
      // Touch layouts: tap selects; long-press selects AND picks the clip up (drag it, or release in place for the layer menu).
      onSelect(id);
      cancelPress();
      press.current = { x: clientX, y: clientY, timer: setTimeout(() => { press.current = undefined; haptic(15); startMove(true); }, LONG_PRESS_MS) };
      return;
    }
    onSelect(id);
    // P26: Alt+drag on the clip body slips it (desktop): the source range moves under the clip, its place and length stay.
    // Drag right to show later source. One undo step per drag; linked clips stay put.
    const pl0 = findPlacement(comp, id)?.placement;
    if (!centered && e.altKey && pl0 && slip.slipKind(pl0)) {
      e.preventDefault();
      const in0 = pl0.sourceInTicks, speed = pl0.speed ?? 1;
      engine.beginGesture();
      const mv = (ev: PointerEvent) => { engine.dispatch(cmd.slipClip(id, in0 + Math.round(toTicks(ev.clientX - clientX) * speed))); };
      const up = () => { engine.endGesture(); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
      return;
    }
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

  const onDrop = (e: React.DragEvent, trackId?: string) => {
    const lane = trackId ? (e.currentTarget as HTMLElement) : scrollRef.current?.querySelector<HTMLElement>(".v2-lane[data-track-id]");
    if (!lane) return;
    e.preventDefault(); e.stopPropagation();
    const at = Math.max(0, toTicks(e.clientX - lane.getBoundingClientRect().left));
    const assetId = e.dataTransfer.getData("application/x-dionysus-asset");
    if (assetId) engine.dispatch(cmd.addAssetToTimeline(assetId, at, trackId));
    else onDropData?.(e.dataTransfer, at, trackId);
  };
  const contextMenu = (e: React.MouseEvent) => {
    if (centered) { e.preventDefault(); return; }
    if (!onContextMenu) return;
    const t = e.target as HTMLElement;
    const clip = t.closest<HTMLElement>("[data-placement-id]");
    const lane = t.closest<HTMLElement>(".v2-lane[data-track-id]");
    if (!clip && !lane) return;
    e.preventDefault();
    const r = (lane ?? clip!.parentElement!).getBoundingClientRect();
    onContextMenu({ x: e.clientX, y: e.clientY, placementId: clip?.dataset.placementId, trackId: lane?.dataset.trackId, ticks: Math.max(0, toTicks(e.clientX - r.left)) });
  };
  const dragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };

  const main = ops.mainTrack(comp);
  // Keep the selected clip's group open on mobile so its trim handles are reachable.
  const selGroup = useMemo(() => { const t = selectedId ? comp.tracks.find((x) => x.placements.some((p) => p.id === selectedId)) : undefined; return t && ops.groupOf(comp, t); }, [selectedId, comp]);
  useEffect(() => { if (centered && selGroup && selGroup !== "main") setExpanded(selGroup); }, [selGroup, centered]);
  const rows = useMemo(() => buildRows(preview, centered, expanded, focus), [preview, centered, expanded, focus]);
  // Mobile pins the main track first: its top is just below the ruler (and the subtitle lane).
  const mainTop = 30 + (topLane ? TEXT_LANE_H : 0);
  // Align an icon-only button in the fixed left column with each collapsed group lane (CapCut); hidden while a group is expanded.
  const sideRef = useRef<HTMLDivElement>(null);
  const [layerTops, setLayerTops] = useState<{ id: string; top: number }[]>([]);
  const [laneTops, setLaneTops] = useState<{ group: ops.TrackGroup; top: number; hasClips: boolean }[]>([]);
  useLayoutEffect(() => {
    const side = sideRef.current, sc = scrollRef.current;
    if (!side || !sc) return;
    const base = side.getBoundingClientRect().top;
    const rowH = coarsePointer() ? 44 : 36; // side-column button height (44px touch targets on phones)
    const next = [...sc.querySelectorAll<HTMLElement>(".v2-lane.is-collapsed")].map((l) => { const r = l.getBoundingClientRect(); return { group: l.dataset.group as ops.TrackGroup, top: Math.round(r.top - base + (r.height - rowH) / 2), hasClips: !!l.querySelector(".v2-clip") }; });
    if (JSON.stringify(next) !== JSON.stringify(laneTops)) setLaneTops(next);
    const rowsNext = expanded ? [...sc.querySelectorAll<HTMLElement>(`.v2-lane[data-track-id][data-group="${expanded}"]`)].map((l) => { const r = l.getBoundingClientRect(); return { id: l.dataset.trackId!, top: Math.round(r.top - base + (r.height - rowH) / 2) }; }) : [];
    if (JSON.stringify(rowsNext) !== JSON.stringify(layerTops)) setLayerTops(rowsNext);
  });
  const startLayerDrag = (e: React.PointerEvent, id: string) => {
    e.stopPropagation(); e.preventDefault();
    const t = comp.tracks.find((x) => x.id === id);
    const sc = scrollRef.current;
    if (!t || !sc) return;
    const g = ops.groupOf(comp, t);
    const lanes = [...sc.querySelectorAll<HTMLElement>(`.v2-lane[data-track-id][data-group="${g}"]`)].map((l) => { const r = l.getBoundingClientRect(); return { id: l.dataset.trackId!, top: r.top, h: r.height }; });
    const from = lanes.findIndex((l) => l.id === id);
    if (from < 0 || lanes.length < 2) return;
    haptic(10);
    let cur: LayerDrag = { id, group: g, lanes, from, to: from, dy: 0 };
    setLayerDrag(cur);
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => { ev.preventDefault(); const dy = ev.clientY - y0; const to = layerSlot(lanes, from, dy); if (to !== cur.to) haptic(6); cur = { ...cur, dy, to }; setLayerDrag(cur); };
    const block = (ev: Event) => ev.preventDefault();
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); removeEventListener("touchmove", block);
      setLayerDrag(undefined);
      dragEndAt.current = Date.now();
      if (cur.to !== cur.from) {
        // Visual order → array order (mobile lists a group bottom-up).
        const n = lanes.length;
        engine.dispatch(cmd.reorderTrack(id, centered ? n - 1 - cur.to : cur.to));
      }
    };
    addEventListener("pointermove", move, { passive: false }); addEventListener("pointerup", up); addEventListener("pointercancel", up); addEventListener("touchmove", block, { passive: false });
  };
  const layerShift = (id: string): React.CSSProperties | undefined => {
    const d = layerDrag;
    if (!d) return undefined;
    const i = d.lanes.findIndex((l) => l.id === id);
    if (i < 0) return undefined;
    if (i === d.from) return { transform: `translateY(${d.dy}px)`, zIndex: 8, position: "relative" };
    const h = d.lanes[d.from].h;
    const y = d.from < d.to && i > d.from && i <= d.to ? -h : d.to < d.from && i >= d.to && i < d.from ? h : 0;
    return y ? { transform: `translateY(${y}px)`, transition: "transform .12s" } : { transition: "transform .12s" };
  };
  const step = pps >= 80 ? 1 : pps >= 30 ? 2 : pps >= 12 ? 5 : 10;
  const ticks: number[] = [];
  const rulerSeconds = (contentW + pad + padRight) / pps;
  for (let s = 0; s <= rulerSeconds; s += step) ticks.push(s);

  return (
    <div ref={rootRef} onContextMenu={contextMenu} className={`v2-timeline ${centered ? "is-centered" : ""} ${reorder ? "is-reordering" : ""}`}>
      {!centered && (
        <div className="v2-track-headers">
          <div className="v2-ruler-spacer" />
          {topLane && <div className="v2-track-header kind-text"><span>{topLane.label}</span></div>}
          {rows.map((r) => r.type === "header" ? (onFocusGroup && r.group !== "main" ? <button key={r.key} className={`v2-group-header v2-group-focus ${focus === r.group ? "is-on" : ""}`} data-group={r.group} aria-pressed={focus === r.group} title={focus === r.group ? "Show all layers" : `Focus ${ops.GROUP_LABEL[r.group]}: show only these layers`} onClick={() => onFocusGroup(focus === r.group ? undefined : r.group)}>{ops.GROUP_LABEL[r.group]}<span className="v2-focus-hint">{focus === r.group ? "Show all" : "Focus"}</span></button> : <div key={r.key} className="v2-group-header" data-group={r.group}>{ops.GROUP_LABEL[r.group]}</div>) : r.type === "add" ? (
            <div key={r.key} className="v2-track-header v2-add-row" data-add-group={r.group}>{addBtn(r.group)}</div>
          ) : r.type === "track" && (({ t }) => (
            <div key={t.id} className={`v2-track-header kind-${t.kind} ${layerDrag?.id === t.id ? "is-layer-dragging" : ""}`} style={layerShift(t.id)}>
              <span>{t.name}</span>
              {t.kind !== "effect" && t.kind !== "text" && <button className="v2-icon" title={t.muted ? "Unmute track" : "Mute track"} aria-label={t.muted ? "Unmute track" : "Mute track"} onClick={() => engine.dispatch(cmd.toggleTrackMute(t.id))}><Ic g={t.muted ? "🔇" : "🔊"} /></button>}
              <LayerControls t={t} isMain={t.id === main?.id} onToggle={() => engine.dispatch(cmd.toggleTrackHidden(t.id))} onDelete={() => setConfirmDel(t.id)} onReorder={(e) => startLayerDrag(e, t.id)} dragging={layerDrag?.id === t.id} onEditAll={onEditLayer && t.kind === "text" && layers.textClipCount(t) > 0 ? () => onEditLayer(t.id) : undefined} onEditSubs={onEditSubs && t.kind === "text" && layers.textClipCount(t) > 0 ? () => onEditSubs(t.id) : undefined} />
            </div>
          ))(r))}
        </div>
      )}
      <div className="v2-scroll" ref={scrollRef} onDragOver={centered ? undefined : dragOver} onDrop={centered ? undefined : (e) => onDrop(e)} onScroll={onScroll} onPointerMove={onPointerMove} onPointerUp={() => onPointerUp()} onPointerCancel={() => { cancelPress(); setGesture(undefined); }}>
        <div className="v2-content" onClick={(e) => { if (centered && e.target === e.currentTarget) exitMode(); }} style={{ width: contentW + pad + padRight, paddingLeft: pad, paddingRight: padRight }}>
          {centered && sideColumn && <div ref={sideRef} className="v2-side-col" data-testid="side-col" onClick={(e) => { if (e.target === e.currentTarget) exitMode(); }} style={{ width: SIDE_W, left: pad - SIDE_W, paddingTop: mainTop }}><div className="v2-side-main">{sideColumn}</div>
            {!expanded && laneTops.map(({ group, top, hasClips }) => (
              <button key={group} className="v2-group-icon" data-group={group} aria-label={ops.GROUP_LABEL[group]} title={hasClips ? `${ops.GROUP_LABEL[group]}: tap to show layers` : ops.GROUP_LABEL[group]}
                style={{ top }} onClick={() => { if (hasClips) setExpanded(group); }}>
                <Ic g={GROUP_ICON[group]} size={16} />
              </button>
            ))}
            {expanded && layerTops.map(({ id, top }) => { const t = comp.tracks.find((x) => x.id === id); return t && (
              <div key={id} className="v2-layer-side" data-track-id={id} style={{ top }}>
                {/* V2-105: the 184px mobile column fits 4 44px controls; "Edit subtitles" lives in the Text toolbar and the clip toolbar instead. */}
                <LayerControls t={t} isMain={t.id === main?.id} onToggle={() => engine.dispatch(cmd.toggleTrackHidden(t.id))} onDelete={() => setConfirmDel(t.id)} onReorder={(e) => startLayerDrag(e, t.id)} dragging={layerDrag?.id === t.id} onEditAll={onEditLayer && t.kind === "text" && layers.textClipCount(t) > 0 ? () => onEditLayer(t.id) : undefined} />
              </div>); })}
          </div>}
          <div className="v2-ruler" onPointerDown={scrub}>
            {ticks.map((s) => (
              <span key={s} className={`v2-tick ${centered && timeLabel && tickUnderLabel(pad + s * pps - toPx(time), 12 + (labelRef.current?.offsetWidth ?? 92)) ? "is-under" : ""}`} style={{ left: s * pps }}>{formatTimecode(s * TICKS_PER_SECOND, project.settings.fps).slice(0, 5)}</span>
            ))}
          </div>
          {topLane?.render(toPx, toTicks)}
          {rows.map((r) => r.type === "header" ? (
            <div key={r.key} className="v2-group-header" data-group={r.group}>
              {centered && <button className="v2-group-back" aria-label={`Collapse ${ops.GROUP_LABEL[r.group]}`} title="Collapse back to one lane" style={{ left: scrollRef.current?.scrollLeft ?? 0 }} onClick={() => { setExpanded(undefined); onSelect(undefined); }}>‹ {ops.GROUP_LABEL[r.group]}</button>}
              {!centered && <span className="v2-group-name">{ops.GROUP_LABEL[r.group]}</span>}
            </div>
          ) : r.type === "add" ? (
            <div key={r.key} className="v2-lane v2-add-lane" data-add-group={r.group} onClick={(e) => { if (centered && e.target === e.currentTarget) exitMode(); }}>{centered && addBtn(r.group)}</div>
          ) : r.type === "collapsed" ? (
            <div key={r.key} className={`v2-lane is-collapsed group-${r.group}`} data-group={r.group} aria-label={`${ops.GROUP_LABEL[r.group]} (collapsed)`}
              onPointerDown={(e) => { if (!centered && e.target === e.currentTarget) onSelect(undefined); }} onClick={(e) => { if (centered && e.target === e.currentTarget) exitMode(); }}>
              {r.placements.map((p) => (
                <button key={p.id} className={`v2-clip clip-${p.clipType} ${p.id === selectedId ? "is-selected" : ""}`} data-placement-id={p.id}
                  style={{ left: toPx(p.startTicks), width: Math.max(4, toPx(p.durationTicks)), ...(thumbs?.[p.source.assetId] && p.clipType !== "audio" ? { backgroundImage: `url(${thumbs[p.source.assetId]})` } : {}) }}
                  title={`${p.clipType === "effect" ? effectName(p) : p.clipType === "text" ? p.text?.text : project.assets[p.source.assetId]?.name ?? ""} — tap to open ${ops.GROUP_LABEL[r.group]} layers`}
                  onPointerDown={(e) => e.stopPropagation()} onClick={() => { setExpanded(r.group); onSelect(p.id); }}>
                  <span className="v2-clip-name">{p.clipType === "effect" ? <><Ic g="effect" size={12} /> {effectName(p)}</> : p.clipType === "text" ? <><Ic g="T" size={12} /> {p.text?.text || "Text"}</> : project.assets[p.source.assetId]?.name}</span><AnimBadges p={p} width={Math.max(4, toPx(p.durationTicks))} />
                </button>
              ))}
            </div>
          ) : (({ t }) => (
            <div key={t.id} className={`v2-lane kind-${t.kind} ${t.muted ? "is-muted" : ""} ${t.hidden ? "is-hidden" : ""} ${layerDrag?.id === t.id ? "is-layer-dragging" : ""}`} data-track-id={t.id} data-group={r.group} style={layerShift(t.id)}
              onPointerDown={(e) => { if (!centered && e.target === e.currentTarget) { onSelect(undefined); scrub(e); } }} onClick={(e) => { if (centered && e.target === e.currentTarget) exitMode(); }}
              onContextMenu={centered ? (e) => e.preventDefault() : undefined}
              onDragOver={dragOver} onDrop={(e) => onDrop(e, t.id)}>
              {centered && t.muted && <span className="v2-lane-label"><Ic g="🔇" /></span>}
              {t.id === main?.id && focus && hiddenRanges(preview, focus).map(({ group, ranges }, i) => ranges.map(([a, b]) => (
                <span key={`${group}-${a}`} className="v2-hidden-range" data-group={group} aria-hidden title={`${ops.GROUP_LABEL[group]} clips here`} style={{ left: toPx(a), width: Math.max(2, toPx(b - a)), top: 2 + i * 5, background: GROUP_COLOR[group] }} />
              )))}
              {t.placements.map((p) => {
                const asset = project.assets[p.source.assetId];
                const link = project.storyboard && p.source.assetId ? board.storyLinkOf(project, p.source.assetId) : undefined;
                const sel = p.id === selectedId;
                const inSel = sel || !!selectedIds?.includes(p.id);
                return (
                  <div key={p.id} className={`v2-clip clip-${p.clipType} ${inSel ? "is-selected" : ""}`} data-placement-id={p.id}
                    style={{ left: toPx(p.startTicks), width: Math.max(4, toPx(p.durationTicks)), ...(centered && thumbs?.[p.source.assetId] && p.clipType !== "audio" && !strips?.[mediaKey(p.source.assetId, p.source.versionId)] ? { backgroundImage: `url(${thumbs[p.source.assetId]})` } : {}) }}
                    onPointerDown={(e) => onClipDown(e, p.id, t.id, p.startTicks)} title={p.clipType === "effect" ? `Effect: ${effectName(p)}` : p.clipType === "text" ? p.text?.text : asset?.name}>
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
                    <span className="v2-clip-name">{link && <span className="v2-clip-badge v2-clip-link" title={`${link.label} on the storyboard: follows the version you pick there (now v${link.versionNo} of ${link.versionCount})`} aria-label={`Storyboard ${link.label}, version ${link.versionNo}`}><Ic g="link" size={11} />v{link.versionNo}</span>}{p.freeze && <span className="v2-clip-badge" title="Freeze frame" aria-label="Freeze frame"><Ic g="❄" /></span>}{p.reverse && <span className="v2-clip-badge" title="Reversed" aria-label="Reversed"><Ic g="⟲" /></span>}{p.speed && p.speed !== 1 && <span className="v2-clip-badge" title={`Speed ${p.speed}×`}>{p.speed}×</span>}{p.linkedAudio?.muted && !p.freeze && <span className="v2-clip-badge" title="Clip audio muted" aria-label="Clip audio muted"><Ic g="🔇" /></span>}{p.clipType === "effect" ? <><Ic g="effect" size={12} /> {effectName(p)}</> : p.clipType === "text" ? <><Ic g="T" size={12} /> {p.text?.text || "Text"}</> : asset?.name ?? "missing media"}</span><AnimBadges p={p} width={Math.max(4, toPx(p.durationTicks))} />
                    {p.link && t.id !== main?.id && <span className={`v2-link-mark ${t.kind === "audio" ? "up" : "down"}`} aria-label="Linked to main clip" title="Linked to the main clip: moves, trims and deletes with it" />}
                    {layers.isCustom(t, p) && <span className="v2-custom-dot" title="Custom style: this clip differs from its layer style" aria-label="Custom style" />}
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
              {/* V2-109: CapCut-style add tile trails the last main clip and scrolls with the track (never covers clips). */}
              {centered && onAddMedia && t.id === main?.id && !gesture && !selectedId && !selectedIds?.length && (
                <button className="v2-main-add" style={{ left: toPx(Math.max(0, ...t.placements.map((p) => p.startTicks + p.durationTicks))) + 12 }} aria-label="Add media to main track" title="Add videos, photos, code clips or stickers to the main track at the playhead"
                  onPointerDown={(e) => e.stopPropagation()} onClick={onAddMedia}><Ic g="+" size={22} /></button>
              )}
              {onTransition && t.kind === "video" && t.placements.filter((p) => transitions.previousAdjacent(t, p)).map((p) => {
                const tr = p.transitionIn, kind = tr && transitions.transitionKind(tr.kind);
                return (
                  <button key={`tr-${p.id}`} className={`v2-trans ${tr ? "has-trans" : ""} ${tr && p.id === selectedId ? "is-selected" : ""}`} style={{ left: toPx(p.startTicks) }}
                    aria-label={tr ? `${kind?.label ?? "Transition"} ${tr.durationTicks / TICKS_PER_SECOND}s` : "Add transition"} title={tr ? `${kind?.label ?? "Transition"}: tap to change` : "Add a transition at this cut"}
                    onPointerDown={(e) => e.stopPropagation()} onClick={() => onTransition(p.id)}>
                    <Ic g={tr ? "⧓" : "cut"} size={14} />
                  </button>
                );
              })}
            </div>
          ))(r))}
          {gesture?.snap !== undefined && (gesture.kind === "trim" || gesture.active) && <div className="v2-snap-line" data-testid="snap-line" style={{ left: pad + toPx(gesture.snap) }} aria-hidden />}
          {!centered && <div className="v2-playhead" style={{ left: toPx(time) }} />}
        </div>
      </div>
      {reorder && main && <ReorderStrip track={main} state={reorder} top={mainTop} root={rootRef.current} thumbs={thumbs}
        onMove={(x) => setReorder((r) => r && !r.closing ? { ...r, x } : r)}
        onDrop={(to) => { setReorder((r) => r && { ...r, closing: true }); setTimeout(() => { if (to !== reorder.from) { engine.dispatch(cmd.reorderMain(reorder.id, to)); haptic(10); } setReorder(undefined); }, REORDER_ANIM_MS); }} />}
      {confirmDel && (() => { const t = comp.tracks.find((x) => x.id === confirmDel); return t ? <ConfirmDialog title="Delete layer?" message={`Delete this layer and its ${t.placements.length} clip${t.placements.length === 1 ? "" : "s"}? You can undo this.`} confirm="Delete"
        onCancel={() => setConfirmDel(undefined)} onConfirm={() => { engine.dispatch(cmd.deleteTrack(t.id)); setConfirmDel(undefined); onSelect(undefined); }} /> : null; })()}
      {centered && <div className="v2-playhead-fixed" style={{ left: pad }} aria-hidden />}
      {centered && timeLabel && <div ref={labelRef} className="v2-time-label">{timeLabel}</div>}
    </div>
  );
}

interface LayerDrag { id: string; group: ops.TrackGroup; lanes: { id: string; top: number; h: number }[]; from: number; to: number; dy: number }
/** Target visual slot for a dragged layer row: how many other rows' midpoints sit above the dragged row's centre. */
export function layerSlot(lanes: { top: number; h: number }[], from: number, dy: number): number {
  const c = lanes[from].top + dy + lanes[from].h / 2;
  return lanes.filter((l, i) => i !== from && l.top + l.h / 2 < c).length;
}

type Row =
  | { type: "header"; key: string; group: ops.TrackGroup }
  | { type: "collapsed"; key: string; group: ops.TrackGroup; placements: Track["placements"] }
  | { type: "track"; key: string; group: ops.TrackGroup; t: Track }
  /** P1-ADD-TRACK: the [+] row at the bottom of the group in its track-type mode. */
  | { type: "add"; key: string; group: Exclude<ops.TrackGroup, "main"> };

/**
 * Timeline rows. Mobile: main track first, then one collapsed lane per group (Overlay, Audio, Text & Stickers);
 * the expanded group lists its layers bottom-up (a lower row draws higher on the canvas, like CapCut).
 * Desktop: every track, grouped top-layer-first under group headers.
 */
/** Group colours for the hidden-group range lines (and lane tints). */
export const GROUP_COLOR: Record<ops.TrackGroup, string> = { main: "#888", text: "#f5a623", overlay: "#3b82f6", audio: "#22c55e", effect: "#a855f7" };
/** V2-099: in a focused mode, the time ranges where each hidden group has clips (merged), stacked one line per group. */
export function hiddenRanges(comp: Composition, focus?: ops.TrackGroup): { group: ops.TrackGroup; ranges: [number, number][] }[] {
  if (!focus) return [];
  const out: { group: ops.TrackGroup; ranges: [number, number][] }[] = [];
  for (const g of ["text", "overlay", "effect", "audio"] as const) {
    if (g === focus) continue;
    const ps = ops.tracksInGroup(comp, g).flatMap((t) => t.placements).sort((a, b) => a.startTicks - b.startTicks);
    const ranges: [number, number][] = [];
    for (const p of ps) { const e = p.startTicks + p.durationTicks; const last = ranges[ranges.length - 1]; if (last && p.startTicks <= last[1]) last[1] = Math.max(last[1], e); else ranges.push([p.startTicks, e]); }
    if (ranges.length) out.push({ group: g, ranges });
  }
  return out;
}

export function buildRows(comp: Composition, mobile: boolean, expanded?: ops.TrackGroup, focus?: ops.TrackGroup): Row[] {
  const rows: Row[] = [];
  const track = (g: ops.TrackGroup) => (t: Track): Row => ({ type: "track", key: t.id, group: g, t });
  if (!mobile) {
    for (const g of ["text", "overlay", "effect", "main", "audio"] as const) {
      if (focus && g !== focus && g !== "main") continue;
      const ts = ops.tracksInGroup(comp, g);
      const add = g !== "main" && focus === g;
      if (!ts.length && !add) continue;
      rows.push({ type: "header", key: `h-${g}`, group: g }, ...ts.map(track(g)));
      if (add) rows.push({ type: "add", key: `add-${g}`, group: g });
    }
    return rows;
  }
  rows.push(...ops.tracksInGroup(comp, "main").map(track("main")));
  for (const g of ["effect", "overlay", "audio", "text"] as const) {
    if (focus && g !== focus) continue;
    const ts = ops.tracksInGroup(comp, g);
    // Effect lane appears once the project has effect layers (or in Effect mode).
    if (g === "effect" && !ts.length && focus !== "effect") continue;
    // V2-099: no in-timeline group header on mobile; exit via empty-space tap or the toolbar ‹.
    if (expanded === g && ts.length) rows.push(...[...ts].reverse().map(track(g)));
    else rows.push({ type: "collapsed", key: `c-${g}`, group: g, placements: ts.flatMap((t) => t.placements).sort((a, b) => a.startTicks - b.startTicks) });
    if (focus === g || expanded === g) rows.push({ type: "add", key: `add-${g}`, group: g });
  }
  return rows;
}

/** V2-101: display name of an effect clip's preset. */
export const effectName = (p: Placement) => getPreset("videoEffect", p.effect?.preset)?.name ?? "Effect";
const GROUP_ICON: Record<ops.TrackGroup, string> = { main: "image", overlay: "image", audio: "♫", text: "T", effect: "effect" };
const REORDER_ANIM_MS = 180;
const SQ = 52, SQ_GAP = 6;
/** Slot the dragged thumb lands in, given the finger x relative to where the row starts. */
export function reorderSlot(x: number, rowLeft: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round((x - rowLeft - SQ / 2) / (SQ + SQ_GAP))));
}
/** Edge auto-scroll: px per frame when the finger is inside the left/right edge zone, faster the deeper it goes (negative = left edge). */
export const EDGE_ZONE = 56, EDGE_MAX = 14;
export function edgeSpeed(x: number, width: number): number {
  if (x < EDGE_ZONE) return -Math.ceil(EDGE_MAX * Math.min(1, (EDGE_ZONE - x) / EDGE_ZONE));
  if (x > width - EDGE_ZONE) return Math.ceil(EDGE_MAX * Math.min(1, (x - (width - EDGE_ZONE)) / EDGE_ZONE));
  return 0;
}
/** Clamp the reorder row's left so it can scroll until its first or last slot sits just inside the edge zone. */
export function clampRowLeft(left: number, base: number, count: number, width: number): number {
  const span = count * (SQ + SQ_GAP);
  return Math.max(Math.min(base, width - EDGE_ZONE - span), Math.min(Math.max(base, EDGE_ZONE), left));
}
function ReorderStrip({ track, state, top, root, thumbs, onMove, onDrop }: { track: Track; state: { id: string; x0: number; x: number; from: number; closing?: boolean }; top: number; root: HTMLDivElement | null; thumbs?: Record<string, string>; onMove: (x: number) => void; onDrop: (to: number) => void }) {
  const sorted = [...track.placements].sort((a, b) => a.startTicks - b.startTicks);
  const ox = root?.getBoundingClientRect().left ?? 0;
  const baseLeft = state.x0 - ox - state.from * (SQ + SQ_GAP) - SQ / 2;
  const width = root?.clientWidth ?? 390;
  // Holding the finger near a viewport edge scrolls the row (the slot indicator follows), so the first clip can reach the end.
  const [shift, setShift] = useState(0);
  const finger = useRef(state.x); finger.current = state.x;
  useEffect(() => {
    if (state.closing) return;
    let raf = 0;
    const tick = () => { const v = edgeSpeed(finger.current - ox, width); if (v) setShift((sh) => baseLeft - clampRowLeft(baseLeft - sh - v, baseLeft, sorted.length, width)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state.closing]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowLeft = baseLeft - shift;
  const to = reorderSlot(state.x - ox, rowLeft, sorted.length);
  const latest = useRef(to); latest.current = to;
  useEffect(() => {
    const move = (e: PointerEvent) => { e.preventDefault(); onMove(e.clientX); };
    const up = () => onDrop(latest.current);
    // Stop the browser from claiming the touch as a pan (which would fire pointercancel mid-drag) or a callout.
    const block = (e: Event) => e.preventDefault();
    window.addEventListener("touchmove", block, { passive: false });
    window.addEventListener("contextmenu", block);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); window.removeEventListener("touchmove", block); window.removeEventListener("contextmenu", block); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const others = sorted.filter((p) => p.id !== state.id);
  return (
    <div className={`v2-reorder ${state.closing ? "is-closing" : ""}`} data-testid="reorder-strip" role="listbox" aria-label="Reorder clips: drag left or right, release to drop" style={{ top: top + 4 }}>
      {sorted.map((p) => {
        const drag = p.id === state.id;
        const slot = drag ? to : (() => { const i = others.indexOf(p); return i >= to ? i + 1 : i; })();
        const left = drag ? state.x - ox - SQ / 2 : rowLeft + slot * (SQ + SQ_GAP);
        const bg = thumbs?.[p.source.assetId];
        return <div key={p.id} role="option" aria-selected={drag} data-reorder-id={p.id} data-slot={slot} className={`v2-reorder-thumb clip-${p.clipType} ${drag ? "is-dragging" : ""}`}
          style={{ left, width: SQ, height: SQ, ...(bg ? { backgroundImage: `url(${bg})` } : {}) }} />;
      })}
      {!state.closing && <div className="v2-reorder-slot" style={{ left: rowLeft + to * (SQ + SQ_GAP) - 3 }} />}
    </div>
  );
}

/** Per-layer eye (hide/show) and ✕ (delete, asks first). The main track can be hidden but not deleted. */
export function LayerControls({ t, isMain, onToggle, onDelete, onReorder, dragging, onEditAll, onEditSubs }: { t: Track; isMain: boolean; onToggle: () => void; onDelete: () => void; onReorder?: (e: React.PointerEvent) => void; dragging?: boolean; onEditAll?: () => void; onEditSubs?: () => void }) {
  return <span className="v2-layer-ctl">
    {onEditSubs && <button className="v2-icon v2-edit-subs" aria-label={`Edit subtitles in ${t.name}`} title="Edit subtitles: every line in a list — text, timing, split, merge, find & replace, export SRT" onClick={onEditSubs}><Ic g="≡" size={16} /></button>}
    {onEditAll && <button className="v2-icon v2-edit-all" aria-label={`Edit all clips in ${t.name}`} title="Edit all: style, font, effects, animation and position for every clip on this layer" onClick={onEditAll}><Ic g="layers" size={16} /></button>}
    {!isMain && onReorder && <button className={`v2-icon v2-drag-handle ${dragging ? "is-dragging" : ""}`} aria-label={`Reorder ${t.name}`} title="Drag up or down to reorder this layer in its group" onPointerDown={onReorder}><Ic g="grip" size={16} /></button>}
    <button className={`v2-icon ${t.hidden ? "is-off" : ""}`} aria-pressed={!!t.hidden} aria-label={t.hidden ? `Show ${t.name}` : `Hide ${t.name}`} title={t.hidden ? "Show layer (included in preview and export)" : "Hide layer (skipped in preview and export)"} onClick={onToggle}><Ic g={t.hidden ? "eye-off" : "eye"} size={16} /></button>
    {!isMain && <button className="v2-icon v2-danger-icon" aria-label={`Delete ${t.name}`} title="Delete layer and its clips" onClick={onDelete}><Ic g="✕" size={16} /></button>}
  </span>;
}

export function ConfirmDialog({ title, message, confirm, onConfirm, onCancel }: { title: string; message: string; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onCancel]);
  return (
    <div className="v2-menu-backdrop v2-confirm-backdrop" onPointerDown={onCancel}>
      <div className="v2-confirm" role="alertdialog" aria-modal="true" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
        <h4>{title}</h4>
        <p>{message}</p>
        <div className="v2-confirm-actions">
          <button className="v2-btn" autoFocus onClick={onCancel}>Cancel</button>
          <button className="v2-btn danger" onClick={onConfirm}>{confirm}</button>
        </div>
      </div>
    </div>
  );
}

/** Which animation badges a clip shows (V2-098). */
export function animBadges(p: Placement): ("in" | "out" | "loop")[] {
  const t = p.text;
  if (!t) return [];
  const on = (v?: string) => !!v && v !== "none";
  return [...(on(t.animIn) ? ["in" as const] : []), ...(on(t.animOut) ? ["out" as const] : []), ...(on(t.loop) ? ["loop" as const] : [])];
}
const BADGE_LABEL = { in: "In animation", out: "Out animation", loop: "Loop animation" } as const;
/** In badge at the clip start, Out at the end, Loop in between; on narrow clips they pack into one corner chip. */
function AnimBadges({ p, width }: { p: Placement; width: number }) {
  const b = animBadges(p);
  if (!b.length) return null;
  const narrow = width < b.length * 16 + 8;
  return (
    <span className={`v2-anim-badges ${narrow ? "is-narrow" : ""}`} aria-label={b.map((k) => BADGE_LABEL[k]).join(", ")}>
      {b.map((k) => <span key={k} className={`v2-anim-badge is-${k}`} title={BADGE_LABEL[k]}><Ic g={`anim-${k}`} size={9} /></span>)}
    </span>
  );
}

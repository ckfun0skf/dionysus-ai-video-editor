import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Engine } from "../engine/engine";
import * as cmd from "../engine/commands";
import * as ops from "../domain/ops";
import { compositionDuration, type Composition, type Project } from "../domain/model";
import { TICKS_PER_SECOND, formatTimecode } from "../domain/time";

interface Props {
  engine: Engine;
  project: Project;
  time: number;
  playing: boolean;
  onSeek: (t: number) => void;
  selectedId?: string;
  onSelect: (id?: string) => void;
  pps: number;
  /** Mobile/CapCut mode: fixed centred playhead, the tracks scroll under it. */
  centered: boolean;
}

type Gesture =
  | { kind: "move"; id: string; x0: number; y0: number; start0: number; trackId: string; start: number; active: boolean }
  | { kind: "trim"; id: string; edge: "left" | "right"; x0: number; edge0: number; to: number };

const HEADER_W = 84;

export function Timeline({ engine, project, time, playing, onSeek, selectedId, onSelect, pps, centered }: Props) {
  const comp = project.compositions[project.rootCompositionId];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture>();
  const [viewW, setViewW] = useState(800);
  const programmatic = useRef(false);
  const toPx = (t: number) => (t / TICKS_PER_SECOND) * pps;
  const toTicks = (px: number) => (px / pps) * TICKS_PER_SECOND;
  const duration = compositionDuration(comp);
  const pad = centered ? viewW / 2 : 0;
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
      return ops.trimPlacement(comp, gesture.id, gesture.edge, gesture.to, max);
    } catch { return comp; }
  }, [gesture, comp, project.assets]);

  const snapThreshold = toTicks(8);
  const trackAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest("[data-track-id]") as HTMLElement | null)?.dataset.trackId;

  const onClipDown = (e: React.PointerEvent, id: string, trackId: string, start: number) => {
    e.stopPropagation();
    if (centered && selectedId !== id) { onSelect(id); return; } // tap to select first on touch layouts
    onSelect(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGesture({ kind: "move", id, x0: e.clientX, y0: e.clientY, start0: start, trackId, start, active: false });
  };
  const onTrimDown = (e: React.PointerEvent, id: string, edge: "left" | "right", edgeTicks: number) => {
    e.stopPropagation();
    onSelect(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setGesture({ kind: "trim", id, edge, x0: e.clientX, edge0: edgeTicks, to: edgeTicks });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!gesture) return;
    if (gesture.kind === "move") {
      const dx = e.clientX - gesture.x0;
      const active = gesture.active || Math.abs(dx) > 4 || Math.abs(e.clientY - gesture.y0) > 8;
      const p = comp.tracks.flatMap((t) => t.placements).find((x) => x.id === gesture.id)!;
      const raw = Math.max(0, gesture.start0 + toTicks(dx));
      const start = Math.max(0, ops.snapMove(comp, raw, p.durationTicks, snapThreshold, [time], gesture.id));
      const trackId = trackAt(e.clientX, e.clientY) ?? gesture.trackId;
      setGesture({ ...gesture, start, trackId, active });
    } else {
      const to = ops.snapTicks(comp, gesture.edge0 + toTicks(e.clientX - gesture.x0), snapThreshold, [time], gesture.id);
      setGesture({ ...gesture, to });
    }
  };
  const onPointerUp = () => {
    if (!gesture) return;
    if (gesture.kind === "move" && gesture.active) engine.dispatch(cmd.movePlacement(gesture.id, gesture.trackId, gesture.start));
    if (gesture.kind === "trim" && gesture.to !== gesture.edge0) engine.dispatch(cmd.trimPlacement(gesture.id, gesture.edge, gesture.to));
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

  const step = pps >= 80 ? 1 : pps >= 30 ? 2 : pps >= 12 ? 5 : 10;
  const ticks: number[] = [];
  const rulerSeconds = (contentW + pad * 2) / pps;
  for (let s = 0; s <= rulerSeconds; s += step) ticks.push(s);

  return (
    <div className={`v2-timeline ${centered ? "is-centered" : ""}`}>
      {!centered && (
        <div className="v2-track-headers">
          <div className="v2-ruler-spacer" />
          {comp.tracks.map((t) => (
            <div key={t.id} className={`v2-track-header kind-${t.kind}`}>
              <span>{t.name}</span>
              <button className="v2-icon" title={t.muted ? "Unmute track" : "Mute track"} aria-label={t.muted ? "Unmute track" : "Mute track"} onClick={() => engine.dispatch(cmd.toggleTrackMute(t.id))}>{t.muted ? "🔇" : "🔊"}</button>
            </div>
          ))}
        </div>
      )}
      <div className="v2-scroll" ref={scrollRef} onScroll={onScroll} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setGesture(undefined)}>
        <div className="v2-content" style={{ width: contentW + pad * 2, paddingLeft: pad, paddingRight: pad }}>
          <div className="v2-ruler" onPointerDown={scrub}>
            {ticks.map((s) => (
              <span key={s} className="v2-tick" style={{ left: s * pps }}>{formatTimecode(s * TICKS_PER_SECOND, project.settings.fps).slice(0, 5)}</span>
            ))}
          </div>
          {preview.tracks.map((t) => (
            <div key={t.id} className={`v2-lane kind-${t.kind} ${t.muted ? "is-muted" : ""}`} data-track-id={t.id}
              onPointerDown={(e) => { if (e.target === e.currentTarget) { onSelect(undefined); if (!centered) scrub(e); } }}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, t.id)}>
              {centered && <span className="v2-lane-label">{t.muted ? "🔇 " : ""}{t.name}</span>}
              {t.placements.map((p) => {
                const asset = project.assets[p.source.assetId];
                const sel = p.id === selectedId;
                return (
                  <div key={p.id} className={`v2-clip clip-${p.clipType} ${sel ? "is-selected" : ""}`} data-placement-id={p.id}
                    style={{ left: toPx(p.startTicks), width: Math.max(4, toPx(p.durationTicks)) }}
                    onPointerDown={(e) => onClipDown(e, p.id, t.id, p.startTicks)} title={asset?.name}>
                    <span className="v2-clip-name">{asset?.name ?? "missing media"}</span>
                    {sel && <>
                      <div className="v2-handle left" aria-label="Trim start" onPointerDown={(e) => onTrimDown(e, p.id, "left", p.startTicks)} />
                      <div className="v2-handle right" aria-label="Trim end" onPointerDown={(e) => onTrimDown(e, p.id, "right", p.startTicks + p.durationTicks)} />
                    </>}
                  </div>
                );
              })}
            </div>
          ))}
          {!centered && <div className="v2-playhead" style={{ left: toPx(time) }} />}
        </div>
      </div>
      {centered && <div className="v2-playhead-fixed" aria-hidden />}
    </div>
  );
}

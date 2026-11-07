/**
 * P49 Mask sheet. ✕ discards the draft (the project is unchanged). ✓ commits one undo step.
 * Shapes are moved, sized and rotated here. A freeform mask is points the user places and then closes;
 * after that each point and its Bezier handles can be dragged, and points can be added or deleted by id.
 * Pinch and wheel zoom the picture; a second finger cancels a point drag so a zoom never moves a node.
 * Coordinates are fractions of the source picture. The crop is drawn as a guide. The clip's position, scale and
 * rotation are not edited here — the mask moves with the picture.
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { cmd, type Engine } from "../engine";
import {
  masking, sourceAt, TICKS_PER_SECOND, tracking, type ClipMask, type MaskShape, type Placement, type Project,
} from "../domain";
import { multiplyMask } from "../render";
import { Ic } from "./Icon";
import { clampView } from "./TrackSheet";

const SHAPES: { id: MaskShape; label: string }[] = [
  { id: "rect", label: "Rectangle" }, { id: "ellipse", label: "Ellipse" }, { id: "linear", label: "Split" },
  { id: "band", label: "Band" }, { id: "path", label: "Freeform" },
];

export function MaskSheet({ engine, project, placement, time, loadBlob, onPreview, onSeek, onClose, onDone }: {
  engine: Engine; project: Project; placement: Placement; time: number;
  loadBlob: (assetId: string) => Promise<Blob | undefined>;
  onPreview: (mask: ClipMask) => void; onSeek?: (ticks: number) => void;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<ClipMask>(() => placement.mask ? structuredClone(placement.mask) : masking.defaultMask("rect"));
  const [sel, setSel] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [url, setUrl] = useState<string>();
  const [aspect, setAspect] = useState(project.settings.width / project.settings.height);
  const [src, setSrc] = useState({ w: project.settings.width, h: project.settings.height });
  const [localTime, setLocalTime] = useState(time);
  const [error, setError] = useState<string>();
  const [zv, setZv] = useState({ z: 1, tx: 0, ty: 0 });
  const zref = useRef(zv); zref.current = zv;
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number; u: number; v: number } | undefined>();
  const drag = useRef<{ kind: string; id?: string; x: number; y: number; start: ClipMask; rot0?: number; ang0?: number } | undefined>();
  const blobRef = useRef(loadBlob); blobRef.current = loadBlob;
  const draftRef = useRef(draft); draftRef.current = draft;

  const dur = placement.durationTicks;
  const offset = Math.max(0, Math.min(dur - 1, localTime - placement.startTicks));
  const shown = masking.evalMask(draft, offset);
  const follow = masking.maskAt({ ...placement, mask: draft }, sourceAt(placement, localTime), offset).follow;

  const previewRef = useRef(onPreview); previewRef.current = onPreview;
  useEffect(() => { previewRef.current(draft); }, [draft]);

  useEffect(() => {
    if (placement.blank || placement.clipType === "html") return;
    let off = false, made = "";
    void blobRef.current(placement.source.assetId).then((b) => { if (!off && b) { made = URL.createObjectURL(b); setUrl(made); } }).catch(() => undefined);
    return () => { off = true; if (made) URL.revokeObjectURL(made); };
  }, [placement.source.assetId, placement.blank, placement.clipType]);

  useEffect(() => {
    const v = video.current;
    if (!v || !url || playing) return;
    const t = sourceAt(placement, localTime) / TICKS_PER_SECOND + 0.001;
    if (Math.abs(v.currentTime - t) > 1 / 60) v.currentTime = t;
  }, [url, localTime, playing, placement]);

  useEffect(() => {
    const v = video.current;
    if (!playing || !v) return;
    let raf = 0;
    void v.play().catch(() => setPlaying(false));
    const tick = () => {
      const at = placement.startTicks + Math.round((v.currentTime * TICKS_PER_SECOND - placement.sourceInTicks) / (placement.speed ?? 1));
      const clamped = Math.max(placement.startTicks, Math.min(placement.startTicks + placement.durationTicks - 1, at));
      setLocalTime(clamped);
      onSeek?.(clamped);
      const endSrc = (placement.sourceInTicks + placement.durationTicks * (placement.speed ?? 1)) / TICKS_PER_SECOND;
      if (v.currentTime >= endSrc - 0.02 || v.ended) { v.pause(); setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); v.pause(); };
  }, [playing, placement, onSeek]);

  const paint = () => {
    const c = canvas.current; if (!c) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = c.getContext("2d"); } catch { return; }
    if (!ctx) return;
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const media = video.current && video.current.readyState >= 2 ? video.current : img.current?.complete ? img.current : undefined;
    if (media) ctx.drawImage(media as CanvasImageSource, 0, 0, w, h);
    else { ctx.fillStyle = placement.blank?.color ?? "#16161a"; ctx.fillRect(0, 0, w, h); }
    const live = draftRef.current;
    if (live.enabled !== false && !(live.shape === "path" && live.closed === false)) {
      const baked = masking.maskAt({ ...placement, mask: live }, sourceAt(placement, localTime), Math.max(0, localTime - placement.startTicks)).mask ?? live;
      const data = ctx.getImageData(0, 0, w, h);
      multiplyMask(data.data, w, h, baked, w, h, { w, h, sx: 0, sy: 0, sw: w, sh: h }, 0);
      ctx.putImageData(data, 0, 0);
    }
  };
  useEffect(() => { paint(); });

  const at = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect(), c = zref.current;
    return { x: (e.clientX - r.left - c.tx) / c.z / (r.width || 1), y: (e.clientY - r.top - c.ty) / c.z / (r.height || 1) };
  };
  const hit = () => {
    const r = stage.current!.getBoundingClientRect();
    return { x: 22 / ((r.width || 1) * zref.current.z), y: 22 / ((r.height || 1) * zref.current.z) };
  };

  const handles = handleList(shown, sel, src.w, src.h);
  const pinchStart = (e: RPointerEvent) => {
    const m = ptrs.current; m.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (m.size !== 2 || !stage.current) return false;
    const [a, b] = [...m.values()], r = stage.current.getBoundingClientRect(), c = zref.current;
    const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
    pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: c.z, u: (cx - c.tx) / c.z, v: (cy - c.ty) / c.z };
    drag.current = undefined;
    return true;
  };
  const down = (e: RPointerEvent) => {
    if (pinchStart(e)) return;
    if ((e.target as HTMLElement).closest(".v2-mask-pt")) return;
    setPlaying(false);
    const p = at(e);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (draft.shape === "path" && draft.closed === false) { drag.current = { kind: "place", x: p.x, y: p.y, start: draft }; return; }
    if (zref.current.z > 1) drag.current = { kind: "pan", x: e.clientX, y: e.clientY, start: draft };
  };
  const move = (e: RPointerEvent) => {
    const m = ptrs.current;
    if (m.has(e.pointerId)) m.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (m.size >= 2 && pinch.current && stage.current) {
      const [a, b] = [...m.values()], r = stage.current.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      const p = pinch.current, nz = Math.min(8, Math.max(1, p.z * d / p.d));
      setZv(clampView({ z: nz, tx: cx - p.u * nz, ty: cy - p.v * nz }, r.width || 1, r.height || 1));
      drag.current = undefined;
      return;
    }
    const d = drag.current; if (!d) return;
    if (d.kind === "pan") { const r = stage.current?.getBoundingClientRect(); if (!r) return; const c = zref.current; setZv(clampView({ ...c, tx: c.tx + e.clientX - d.x, ty: c.ty + e.clientY - d.y }, r.width || 1, r.height || 1)); d.x = e.clientX; d.y = e.clientY; return; }
    const p = at(e);
    setDraft(applyDrag(d, p.x, p.y, src.w, src.h, e.altKey));
    setError(undefined);
  };
  const up = (e: RPointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = undefined;
    const d = drag.current;
    drag.current = undefined;
    if (d?.kind === "place" && draft.shape === "path" && draft.closed === false) {
      const p = at(e);
      if (Math.hypot(p.x - d.x, p.y - d.y) < 0.02) {
        const nodes = draft.nodes ?? [];
        if (nodes.length >= 3 && Math.hypot(p.x - nodes[0].x, p.y - nodes[0].y) < hit().x) { const c = masking.closePath(draft); setDraft(c.mask); setError(c.error); return; }
        const next = masking.addPoint(draft, Math.min(1.5, Math.max(-0.5, p.x)), Math.min(1.5, Math.max(-0.5, p.y)));
        setDraft(next); setSel(next.nodes!.at(-1)!.id);
      }
    }
  };
  const pointDown = (e: RPointerEvent, id: string, kind: string) => {
    e.stopPropagation();
    if (pinchStart(e)) return;
    setPlaying(false); setSel(id.includes(":") ? id.split(":")[1] : id);
    const p = at(e);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const ang = Math.atan2(p.x - (shown.x ?? 0.5), -(p.y - (shown.y ?? 0.5))) * 180 / Math.PI;
    drag.current = { kind, id, x: p.x, y: p.y, start: draft, rot0: draft.rotation ?? 0, ang0: ang };
  };

  useEffect(() => {
    const el = stage.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); const c = zref.current; const z = Math.min(8, Math.max(1, c.z * Math.exp(-e.deltaY * 0.01))); const u = (e.clientX - r.left - c.tx) / c.z, v = (e.clientY - r.top - c.ty) / c.z; setZv(clampView({ z, tx: e.clientX - r.left - u * z, ty: e.clientY - r.top - v * z }, r.width || 1, r.height || 1)); }
      else if (zref.current.z > 1) { e.preventDefault(); const c = zref.current; setZv(clampView({ ...c, tx: c.tx - e.deltaX, ty: c.ty - e.deltaY }, r.width || 1, r.height || 1)); }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.code !== "Space" || (e.target as HTMLElement).closest?.("input,textarea")) return; e.preventDefault(); if (placement.clipType === "video") setPlaying((p) => !p); };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [placement.clipType]);

  const crop = placement.transform?.crop;
  const del = () => {
    if (!sel) return;
    const r = masking.deletePoint(draft, sel);
    if (r.error) { setError(r.error); return; }
    setDraft(r.mask); setSel(undefined); setError(undefined);
  };
  const apply = () => {
    setPlaying(false);
    const bad = masking.maskErrors(draft);
    if (bad.length) { setError(bad[0]); return; }
    if (engine.dispatch(cmd.setClipMask(placement.id, draft))) onDone(draft.enabled === false ? "Mask bypassed" : "Mask applied");
    else setError("Couldn't apply the mask.");
  };
  const remove = () => { setPlaying(false); if (engine.dispatch(cmd.setClipMask(placement.id, null))) onDone("Mask removed"); };
  const tracks = tracking.tracksOf(placement);
  const pct = (v: number) => `${v * 100}%`;

  return (
    <div className="v2-track v2-mask" role="dialog" aria-label="Mask" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <header className="v2-subimport-head">
        <button type="button" className="v2-icon-btn" aria-label="Cancel" title="Cancel: restore the mask from before this edit (Esc)" onClick={onClose}><Ic g="✕" /></button>
        <h3>Mask</h3>
        <button type="button" className="v2-icon-btn" aria-label="Apply mask" title="Apply (one undo step)" onClick={apply}><Ic g="✓" /></button>
      </header>
      <div className="v2-track-out"><div className="v2-seg" role="radiogroup" aria-label="Mask shape">
        {SHAPES.map((s) => <button key={s.id} type="button" role="radio" aria-checked={draft.shape === s.id} className={draft.shape === s.id ? "is-active" : ""} onClick={() => { setDraft(masking.withShape(draft, s.id)); setSel(undefined); setError(undefined); }}>{s.label}</button>)}
      </div></div>
      <div ref={stage} className="v2-track-stage" style={{ aspectRatio: `${aspect}`, width: "min(100%, 64dvh)" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="v2-track-layer" style={{ transform: `translate(${zv.tx}px, ${zv.ty}px) scale(${zv.z})`, ["--z" as string]: zv.z }}>
          {placement.clipType === "video" && url && <video ref={video} src={url} muted playsInline preload="auto" aria-label="Clip frame" onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth) { setAspect(v.videoWidth / v.videoHeight); setSrc({ w: v.videoWidth, h: v.videoHeight }); } }} />}
          {placement.clipType === "image" && !placement.blank && url && <img ref={img} src={url} alt="" onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth) { setAspect(i.naturalWidth / i.naturalHeight); setSrc({ w: i.naturalWidth, h: i.naturalHeight }); } }} />}
          <canvas ref={canvas} className="v2-mask-canvas" width={480} height={Math.max(1, Math.round(480 / aspect))} aria-hidden />
          {crop && (crop.l || crop.t || crop.r || crop.b) ? <div className="v2-mask-crop" style={{ left: pct(crop.l), top: pct(crop.t), right: pct(crop.r), bottom: pct(crop.b) }} /> : null}
          {shapeBox(shown, src.w, src.h)}
          {handles.map((h) => (
            <button key={h.id + h.kind} type="button" className={`v2-track-pt v2-mask-pt${sel === h.id ? " is-cur" : ""}${h.kind === "in" || h.kind === "out" ? " is-handle" : ""}`} style={{ left: pct(h.x), top: pct(h.y) }}
              aria-label={h.label} onPointerDown={(e) => pointDown(e, h.id, h.kind)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}><i /></button>
          ))}
        </div>
        {shown.shape === "path" && <svg className="v2-track-path" viewBox={viewBox(zv, stage.current?.getBoundingClientRect())} preserveAspectRatio="none" aria-hidden><path d={masking.maskSvgPath(shown)} fill="none" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /></svg>}
        {draft.shape === "path" && draft.closed === false && <p className="v2-track-tip">Tap to place points. Tap the first point, or Close path, when you have at least 3.</p>}
        {zv.z > 1 && <button type="button" className="v2-icon-btn v2-track-fit" aria-label="Fit frame" onPointerDown={(e) => e.stopPropagation()} onClick={() => setZv({ z: 1, tx: 0, ty: 0 })}><Ic g="fit" size={16} /><span>{Math.round(zv.z * 100)}%</span></button>}
        {follow.held && <span className="v2-track-flag" role="status">Tracker lost or out of range — holding the last found position</span>}
        {follow.missing && <span className="v2-track-flag" role="status">No tracker with that name on this clip</span>}
      </div>
      {placement.clipType === "video" && <div className="v2-track-row">
        <button type="button" className="v2-track-play" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => setPlaying((p) => !p)}><Ic g={playing ? "❚❚" : "▶"} size={18} /></button>
        <input type="range" aria-label="Scrub clip" min={0} max={Math.max(1, dur - 1)} value={offset} onChange={(e) => { const t = placement.startTicks + Number(e.target.value); setPlaying(false); setLocalTime(t); onSeek?.(t); }} />
      </div>}
      <label className="v2-track-row">Feather <input type="range" aria-label="Feather" min={0} max={0.5} step={0.005} value={draft.feather ?? 0} onChange={(e) => setDraft({ ...draft, feather: Number(e.target.value) })} /></label>
      <label className="v2-track-row">Expand <input type="range" aria-label="Expand" min={-0.5} max={0.5} step={0.005} value={draft.expand ?? 0} onChange={(e) => setDraft({ ...draft, expand: Number(e.target.value) })} /></label>
      {(draft.shape === "rect") && <label className="v2-track-row">Corners <input type="range" aria-label="Corner radius" min={0} max={0.5} step={0.01} value={draft.radius ?? 0} onChange={(e) => setDraft({ ...draft, radius: Number(e.target.value) })} /></label>}
      <div className="v2-track-row">
        <label className="v2-track-check"><input type="checkbox" checked={!!draft.invert} onChange={(e) => setDraft({ ...draft, invert: e.target.checked || undefined })} /> Invert</label>
        <label className="v2-track-check"><input type="checkbox" checked={draft.enabled !== false} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked ? undefined : false })} /> Enabled</label>
        <button type="button" className="v2-btn" onClick={() => setDraft(masking.keyMask(draft, offset))}>Keyframe</button>
        <button type="button" className="v2-btn" onClick={() => { setDraft(masking.withShape(placement.mask ?? masking.defaultMask("rect"), draft.shape)); setError(undefined); }}>Reset</button>
      </div>
      {draft.shape === "path" && <div className="v2-track-row">
        <button type="button" className="v2-btn" aria-label="Close path" disabled={(draft.nodes?.length ?? 0) < 3 || draft.closed !== false} onClick={() => { const c = masking.closePath(draft); setDraft(c.mask); setError(c.error); }}>Close path</button>
        <button type="button" className="v2-btn" aria-label="Add point" disabled={!sel || draft.closed === false} onClick={() => { const next = masking.insertPoint(draft, sel!); setDraft(next); setSel(next.nodes?.find((n) => !draft.nodes?.some((o) => o.id === n.id))?.id); }}>Add point</button>
        <button type="button" className="v2-btn" aria-label="Delete point" disabled={!sel} onClick={del}>Delete point</button>
      </div>}
      {tracks.length > 0 && <label className="v2-track-row">Follow tracker
        <select aria-label="Follow tracker" value={draft.trackId ?? ""} onChange={(e) => {
          const id = e.target.value;
          if (!id) { const { trackId: _t, trackAnchor: _a, trackScale: _s, ...rest } = draft; setDraft(rest); return; }
          const tr = tracks.find((t) => t.id === id)!;
          const smp = tr.samples.find((s) => !s.lost);
          setDraft({ ...draft, trackId: id, ...(smp ? { trackAnchor: { x: smp.x, y: smp.y, scale: smp.scale || 1 } } : {}) });
        }}>
          <option value="">None</option>
          {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <label className="v2-track-check"><input type="checkbox" checked={!!draft.trackScale} disabled={!draft.trackId} onChange={(e) => setDraft({ ...draft, trackScale: e.target.checked || undefined })} /> Scale</label>
      </label>}
      {error && <p className="v2-hint" role="alert">{error}</p>}
      <p className="v2-hint">The mask is part of this picture. Feather softens the edge; Expand grows it (left of centre shrinks it). Cancel puts the previous mask back. Tracker lost frames hold the last found spot.</p>
      {placement.mask && <button type="button" className="v2-btn" aria-label="Remove mask" onClick={remove}>Remove mask</button>}
    </div>
  );
}

function viewBox(zv: { z: number; tx: number; ty: number }, r?: DOMRect) {
  if (!r?.width || zv.z === 1) return "0 0 1 1";
  return `${-zv.tx / zv.z / r.width} ${-zv.ty / zv.z / r.height} ${1 / zv.z} ${1 / zv.z}`;
}

interface Handle { id: string; x: number; y: number; kind: string; label: string }
function handleList(mask: ClipMask, selected: string | undefined, sw: number, sh: number): Handle[] {
  const m = Math.max(1, Math.min(sw, sh));
  if (mask.shape === "rect" || mask.shape === "ellipse") {
    const uhw = ((mask.w ?? 0.5) / 2) * sw / m, uhh = ((mask.h ?? 0.5) / 2) * sh / m;
    const corners: [string, number, number, string][] = [["nw", -uhw, -uhh, "Resize top left"], ["ne", uhw, -uhh, "Resize top right"], ["se", uhw, uhh, "Resize bottom right"], ["sw", -uhw, uhh, "Resize bottom left"]];
    const out = corners.map(([id, x, y, label]) => ({ id, ...masking.localToWorld(mask, x, y, sw, sh), kind: "corner", label }));
    const rot = masking.localToWorld(mask, 0, -uhh - 0.12 * Math.max(sw, sh) / m, sw, sh);
    return [...out, { id: "rotate", ...rot, kind: "rotate", label: "Rotate" }, { id: "center", x: mask.x ?? 0.5, y: mask.y ?? 0.5, kind: "center", label: "Move" }];
  }
  if (mask.shape === "linear" || mask.shape === "band") {
    const out: Handle[] = [{ id: "center", x: mask.x ?? 0.5, y: mask.y ?? 0.5, kind: "center", label: "Move" }];
    const rot = masking.localToWorld(mask, 0.25 * sw / m, 0, sw, sh);
    out.push({ id: "rotate", ...rot, kind: "rotate", label: "Rotate" });
    if (mask.shape === "band") {
      const half = ((mask.w ?? 0.2) / 2) * sw / m;
      out.push({ id: "width", ...masking.localToWorld(mask, 0, half, sw, sh), kind: "width", label: "Width" });
    }
    return out;
  }
  const nodes = mask.nodes ?? [];
  const out: Handle[] = nodes.map((n, i) => ({ id: n.id, x: n.x, y: n.y, kind: "node", label: `Point ${i + 1}` }));
  const node = nodes.find((n) => n.id === selected);
  if (node && mask.closed !== false) {
    const inn = node.in ?? { x: -0.06, y: 0 }, outH = node.out ?? { x: 0.06, y: 0 };
    out.push({ id: `in:${node.id}`, x: node.x + inn.x, y: node.y + inn.y, kind: "in", label: "Incoming curve handle" });
    out.push({ id: `out:${node.id}`, x: node.x + outH.x, y: node.y + outH.y, kind: "out", label: "Outgoing curve handle" });
  }
  return out;
}

function shapeBox(mask: ClipMask, _sw: number, _sh: number) {
  if (mask.shape !== "rect" && mask.shape !== "ellipse") return null;
  const rot = mask.rotation ?? 0;
  return <div className={`v2-mask-shape is-${mask.shape}`} style={{ left: `${(mask.x ?? 0.5) * 100}%`, top: `${(mask.y ?? 0.5) * 100}%`, width: `${(mask.w ?? 0.5) * 100}%`, height: `${(mask.h ?? 0.5) * 100}%`, transform: `translate(-50%, -50%) rotate(${rot}deg)` }} />;
}

function applyDrag(d: { kind: string; id?: string; x: number; y: number; start: ClipMask; rot0?: number; ang0?: number }, x: number, y: number, sw: number, sh: number, alt: boolean): ClipMask {
  const start = d.start;
  if (d.kind === "center") return masking.moveBy(start, x - d.x, y - d.y);
  if (d.kind === "corner" && d.id) return masking.resizeFromCorner(start, d.id, x, y, sw, sh);
  if (d.kind === "rotate") {
    const ang = Math.atan2(x - (start.x ?? 0.5), -(y - (start.y ?? 0.5))) * 180 / Math.PI;
    return masking.setRotation(start, (d.rot0 ?? 0) + ang - (d.ang0 ?? 0));
  }
  if (d.kind === "width") return masking.setBandWidth(start, x, y, sw, sh);
  if (d.kind === "node" && d.id) return masking.movePoint(start, d.id, x, y);
  if ((d.kind === "in" || d.kind === "out") && d.id) {
    const id = d.id.split(":")[1];
    const n = start.nodes?.find((p) => p.id === id);
    if (!n) return start;
    return masking.setHandle(start, id, d.kind, x - n.x, y - n.y, !alt);
  }
  return start;
}

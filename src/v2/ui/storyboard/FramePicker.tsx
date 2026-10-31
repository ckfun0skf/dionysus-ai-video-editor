import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { board, type Project } from "../../domain";
import { cmd, type Engine } from "../../engine";
import type { BlobStore } from "../../ports";
import { drawVideoFrame } from "../frameGrab";
import { Ic } from "../Icon";
import { saveFile, safeName } from "../saveFile";
import { FRAME_STEP_SEC, grabCurrentFrame, seekTo, storePickedFrame } from "./frameCapture";

const THUMBS = 8;
const fmt = (s: number) => `${(Math.round(s * 100) / 100).toFixed(2)} s`;
const shotNoOf = (p: Project, id: string) => (p.storyboard?.order.indexOf(id) ?? -1) + 1;

/** Thumbnails across a clip, for the picker's strip (best effort: an empty strip still lets you scrub). */
function useThumbs(url: string | undefined, totalSec: number) {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!url || !totalSec) return;
    let dead = false;
    const el = document.createElement("video");
    el.muted = true; el.playsInline = true; el.preload = "auto"; el.src = url;
    const once = (ev: string) => new Promise<void>((res, rej) => { el.addEventListener(ev, () => res(), { once: true }); el.addEventListener("error", () => rej(new Error("decode")), { once: true }); });
    void (async () => {
      try {
        await once("loadeddata");
        const h = 54, w = Math.max(16, Math.round((h * (el.videoWidth || 16)) / (el.videoHeight || 9)));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g) return;
        const out: string[] = [];
        for (let i = 0; i < THUMBS && !dead; i += 1) {
          el.currentTime = (i * totalSec) / THUMBS;
          await once("seeked");
          out.push((await drawVideoFrame(g, el, w, h)) ? c.toDataURL("image/jpeg", 0.6) : "");
          if (!dead) setFrames([...out]);
        }
      } catch { /* no strip */ }
      finally { el.removeAttribute("src"); el.load(); }
    })();
    return () => { dead = true; };
  }, [url, totalSec]);
  return frames;
}

/**
 * P15: pick the exact frame of an earlier shot's clip for a frameOf reference. The source clip plays with a scrubber,
 * previous / next frame buttons and a thumbnail strip; the reference's frameDesc is shown above the player and the
 * player starts at its atSec. "Use this frame" stores a PNG version with { frameOf, atSec, sourceVersionId }.
 */
export function FramePicker({ project, slotId, engine, blobs, onClose }: { project: Project; slotId: string; engine: Engine; blobs: BlobStore; onClose: () => void }) {
  const b = project.storyboard!;
  const slot = b.slots[slotId];
  const st = board.frameRefState(project, slotId);
  const src = b.shots[st.sourceShot];
  const srcNo = shotNoOf(project, st.sourceShot);
  const version = src && st.currentVersionId ? board.versionsOf(project, src).find((v) => v.id === st.currentVersionId) : undefined;
  const target = b.order.find((id) => b.shots[id].slotIds.includes(slotId));
  const [url, setUrl] = useState<string>();
  const [dur, setDur] = useState(0);
  const [t, setT] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const vid = useRef<HTMLVideoElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [host] = useState<Element>(() => document.querySelector(".v2-app") ?? document.body);
  const thumbs = useThumbs(url, dur);

  useEffect(() => {
    if (!version) return;
    let u: string | undefined, dead = false;
    void blobs.get(version.media.blobKey).then((blob) => {
      if (dead) return;
      if (!blob) { setErr("The source clip's file is missing from this device."); return; }
      u = URL.createObjectURL(blob); setUrl(u);
    });
    return () => { dead = true; if (u) URL.revokeObjectURL(u); };
  }, [version?.media.blobKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { card.current?.querySelector<HTMLElement>("button, input")?.focus(); }, [url]);

  const go = (sec: number) => {
    const el = vid.current; if (!el) return;
    const x = Math.min(Math.max(0, sec), Math.max(0, (dur || el.duration || 0) - 0.01));
    el.pause(); el.currentTime = x; setT(x);
  };
  const onMeta = () => {
    const el = vid.current; if (!el) return;
    const d = Number.isFinite(el.duration) ? el.duration : 0;
    setDur(d);
    const at = Math.min(Math.max(0, st.atSec ?? 0), Math.max(0, d - 0.04));
    void seekTo(el, at).then(() => setT(at)).catch(() => undefined);
  };
  const grab = async () => {
    const el = vid.current; if (!el) throw new Error("The clip is not loaded yet.");
    el.pause();
    await seekTo(el, el.currentTime);
    return grabCurrentFrame(el);
  };
  const run = (label: string, fn: () => Promise<void>) => { setBusy(label); setErr(undefined); void fn().catch((e) => setErr(e instanceof Error ? e.message : String(e))).finally(() => setBusy(undefined)); };
  const use = () => run("Saving the frame…", async () => {
    if (!version) return;
    const fr = await grab();
    const at = vid.current?.currentTime ?? t;
    const { media, frameRef } = await storePickedFrame(blobs, slotId, st.sourceShot, version.id, fr, at);
    engine.dispatch(cmd.addStoryVersion({ slot: slotId }, media, { frameRef }));
    onClose();
  });
  const download = () => run("Preparing the PNG…", async () => {
    const fr = await grab();
    await saveFile(fr.blob, `${safeName(`${src?.title ?? "shot"}-frame-${fmt(vid.current?.currentTime ?? t).replace(" ", "")}`)}.png`);
  });
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); go(t + (e.key === "ArrowLeft" ? -FRAME_STEP_SEC : FRAME_STEP_SEC)); }
  };

  return createPortal(
    <div className="v2-modal v2-framepick" role="dialog" aria-modal="true" aria-label={`Pick frame from Shot ${srcNo}`} onKeyDown={onKey} onPointerDown={(e) => e.stopPropagation()}>
      <div className="v2-modal-card v2-framepick-card" ref={card}>
        <div className="v2-framepick-head">
          <h2>Pick frame from Shot {srcNo}{src ? ` · ${src.title}` : ""}</h2>
          <button className="v2-icon v2-sb-icon" aria-label="Close frame picker" onClick={onClose}><Ic g="✕" size={18} /></button>
        </div>
        <p className="v2-framepick-desc" data-testid="frame-desc"><b>Frame to pick{target ? ` for Shot ${shotNoOf(project, target)}` : ""} ({slot?.source.type === "frameOf" && b.shots[target ?? ""]?.references?.find((r) => r.slotId === slotId)?.role === "start-frame" ? "start frame" : "reference image"}):</b> {st.frameDesc || "No description."}</p>
        {!version ? (
          <div className="v2-sb-warnbox" role="note"><p><Ic g="⚠" size={14} /> Generate Shot {srcNo} first. The frame is picked from its clip.</p></div>
        ) : (
          <>
            <div className="v2-framepick-player">
              {url && <video ref={vid} src={url} muted playsInline preload="auto" onLoadedMetadata={onMeta} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />}
            </div>
            <div className="v2-framepick-scrub">
              <button className="v2-btn v2-sb-btn" aria-label="Previous frame" title="Previous frame (←)" disabled={!dur} onClick={() => go(t - FRAME_STEP_SEC)}><Ic g="step-back" size={16} /></button>
              <input type="range" min={0} max={dur || 0} step={FRAME_STEP_SEC} value={t} aria-label="Position in the source clip" aria-valuetext={fmt(t)} disabled={!dur} onChange={(e) => go(Number(e.target.value))} />
              <button className="v2-btn v2-sb-btn" aria-label="Next frame" title="Next frame (→)" disabled={!dur} onClick={() => go(t + FRAME_STEP_SEC)}><Ic g="step-fwd" size={16} /></button>
              <span className="v2-framepick-time" aria-live="polite">{fmt(t)}{dur ? ` / ${fmt(dur)}` : ""}</span>
            </div>
            <div className="v2-framepick-strip" role="group" aria-label="Jump to a point in the clip">
              {Array.from({ length: THUMBS }, (_, i) => {
                const at = dur ? (i * dur) / THUMBS : 0;
                return <button key={i} className={`v2-framepick-thumb ${dur && t >= at && t < at + dur / THUMBS ? "on" : ""}`} disabled={!dur} aria-label={`Jump to ${fmt(at)}`} onClick={() => go(at)}>{thumbs[i] ? <img src={thumbs[i]} alt="" draggable={false} /> : <span />}</button>;
              })}
            </div>
            {st.atSec !== undefined && <p className="v2-hint">The storyboard suggests {fmt(st.atSec)}. <button className="v2-linkbtn" onClick={() => go(st.atSec!)}>Go there</button></p>}
          </>
        )}
        {err && <p className="v2-sb-err" role="alert">{err}</p>}
        <div className="v2-framepick-actions">
          <button className="v2-btn v2-sb-btn" onClick={onClose}>Cancel</button>
          {version && <button className="v2-btn v2-sb-btn" disabled={!url || !!busy} onClick={download}><Ic g="⇩" size={16} /> Download PNG</button>}
          {version && <button className="v2-btn primary v2-sb-btn" disabled={!url || !!busy} onClick={use}><Ic g="ok" size={16} /> {busy ?? "Use this frame"}</button>}
        </div>
      </div>
    </div>,
    host,
  );
}

/**
 * P15: the frameOf state of a reference slot, with its actions: "Pick frame from Shot N" (warning until picked),
 * "Generate Shot N first", or "Source shot changed - frame may be affected" with Re-pick and Dismiss.
 */
export function FrameRefBox({ project, slotId, engine, blobs, compact }: { project: Project; slotId: string; engine: Engine; blobs: BlobStore; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const b = project.storyboard!;
  const slot = b.slots[slotId];
  if (slot?.source.type !== "frameOf") return null;
  const st = board.frameRefState(project, slotId);
  const n = shotNoOf(project, st.sourceShot);
  const title = compact ? <b>{slot.name}: </b> : null;
  const picker = open && <FramePicker project={project} slotId={slotId} engine={engine} blobs={blobs} onClose={() => setOpen(false)} />;
  if (st.state === "no-source") return <div className="v2-sb-warnbox v2-frameref" role="note" data-frameref="no-source"><p><Ic g="⚠" size={14} /> {title}Generate Shot {n} first, then pick the frame from its clip.</p></div>;
  if (st.state === "pick") return (
    <div className="v2-sb-warnbox v2-frameref" role="note" data-frameref="pick">
      <p><span className="v2-frameref-badge"><Ic g="⚠" size={12} /> Not picked</span> {title}{st.frameDesc}</p>
      <div className="v2-sb-actions"><button className="v2-btn primary v2-sb-btn" onClick={() => setOpen(true)} aria-haspopup="dialog"><Ic g="image" size={16} /> Pick frame from Shot {n}</button></div>
      {picker}
    </div>
  );
  if (st.state === "changed") return (
    <div className="v2-sb-warnbox v2-frameref" role="alert" data-frameref="changed">
      <p><Ic g="⚠" size={14} /> {title}<b>{board.FRAME_CHANGED}.</b> Shot {n} has a new clip version since this frame was picked. Check it still fits, then re-pick or dismiss.</p>
      <div className="v2-sb-actions">
        <button className="v2-btn primary v2-sb-btn" onClick={() => setOpen(true)} aria-haspopup="dialog"><Ic g="image" size={16} /> Re-pick</button>
        <button className="v2-btn v2-sb-btn" onClick={() => engine.dispatch(cmd.dismissFrameWarning(slotId))}>Dismiss</button>
      </div>
      {picker}
    </div>
  );
  return (
    <div className="v2-frameref ok" data-frameref="ok">
      <p className="v2-hint">{title}Picked from Shot {n}{st.dismissed ? " (source change dismissed)" : ""}. {st.frameDesc}</p>
      <div className="v2-sb-actions"><button className="v2-btn v2-sb-btn" onClick={() => setOpen(true)} aria-haspopup="dialog"><Ic g="image" size={16} /> Re-pick frame</button></div>
      {picker}
    </div>
  );
}

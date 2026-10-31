import { useEffect, useRef, useState } from "react";
import { fromVideo as fromVideoDomain } from "../domain";
const { clampSpan } = fromVideoDomain;
import { Ic } from "./Icon";
import type { ProjectMedia } from "./MediaPicker";
import { probeVideoAudio } from "./media";

/** P18: what Add audio → From Video adds: the audio of `assetId` from `inSec` to `outSec`, optionally muting its timeline clips. */
export type FromVideoPick = { assetId: string; inSec: number; outSec: number; muteOriginal: boolean; /** P19: the video was uploaded audio-only: drop it after a successful extraction. */ discardVideo?: boolean };
/** P19: result of an Upload video from the From Video tab. */
export type UploadedVideo = { assetId: string; audio: boolean | undefined } | { error: string };
/** P19: file types the From Video upload accepts (video/* keeps the iOS photo library picker). */
export const VIDEO_UPLOAD_ACCEPT = "video/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm";

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const fmtDur = (ticks?: number) => { if (!ticks) return ""; const s = Math.round(ticks / 120_000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/**
 * P18: the From Video tab of Add audio. Lists the project's videos (thumbnail, name, length; "No audio" and disabled
 * when the file has no audio track), and for the chosen one a preview with in/out trim and a "Mute original video clip"
 * option when the video is on the timeline. `pick` is lifted so the picker's footer can add it.
 */
export function FromVideoTab({ videos, loadMedia, onTimeline, pick, onPick, probe = probeVideoAudio, onUpload, notKept = [] }: {
  videos: ProjectMedia[]; loadMedia?: (assetId: string) => Promise<Blob | undefined>;
  /** Whether the video has clips on the timeline (shows the mute option). */ onTimeline?: (assetId: string) => boolean;
  pick?: FromVideoPick; onPick: (p: FromVideoPick | undefined) => void;
  probe?: (b: Blob) => Promise<boolean | undefined>;
  /** P19: Upload video: import the file (kept in the library or audio-only) and report its audio track. */
  onUpload?: (file: File, keep: boolean, progress: (f: number) => void) => Promise<UploadedVideo>;
  /** P19: uploaded audio-only videos (marked "Audio only" in the list). */ notKept?: string[];
}) {
  const [audio, setAudio] = useState<Record<string, boolean | undefined>>({});
  const [keep, setKeep] = useState(true);
  const [up, setUp] = useState<{ name: string; f: number } | undefined>();
  const [upMsg, setUpMsg] = useState<string>();
  const [select, setSelect] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    if (!onUpload) return;
    setUpMsg(undefined); setUp({ name: f.name, f: 0 });
    const r = await onUpload(f, keep, (x) => setUp({ name: f.name, f: x })).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Upload failed" }));
    setUp(undefined);
    if ("error" in r) { setUpMsg(`${f.name}: ${r.error}`); return; }
    setAudio((m) => ({ ...m, [r.assetId]: r.audio }));
    if (r.audio === false) { setUpMsg("This video has no audio"); return; }
    setSelect(r.assetId);
  };
  useEffect(() => {
    const v = select && videos.find((x) => x.id === select);
    if (!v) return;
    setSelect(undefined);
    const d = v.durationTicks ? v.durationTicks / 120_000 : 1;
    onPick({ assetId: v.id, inSec: 0, outSec: Math.round(d * 100) / 100, muteOriginal: false, ...(notKept.includes(v.id) ? { discardVideo: true } : {}) });
  }, [select, videos, notKept, onPick]);
  useEffect(() => {
    if (!loadMedia) return;
    let live = true;
    void (async () => {
      for (const v of videos) {
        if (!live) return;
        const b = await loadMedia(v.id).catch(() => undefined);
        const has = b ? await probe(b) : undefined;
        if (live) setAudio((m) => ({ ...m, [v.id]: has }));
      }
    })();
    return () => { live = false; };
  }, [videos, loadMedia, probe]);
  const sel = pick && videos.find((v) => v.id === pick.assetId);
  const dur = sel?.durationTicks ? sel.durationTicks / 120_000 : undefined;
  const choose = (v: ProjectMedia) => {
    if (audio[v.id] === false) return;
    if (pick?.assetId === v.id) { onPick(undefined); return; }
    const d = v.durationTicks ? v.durationTicks / 120_000 : 1;
    onPick({ assetId: v.id, inSec: 0, outSec: Math.round(d * 100) / 100, muteOriginal: false, ...(notKept.includes(v.id) ? { discardVideo: true } : {}) });
  };
  const uploader = onUpload && (
    <div className="v2-fv-upload">
      <button className="v2-pick-action" disabled={!!up} onClick={() => file.current?.click()}>
        <span className="v2-pick-action-ic"><Ic g="⤒" size={22} /></span>
        <span><b>Upload video</b><small>MP4, MOV or WebM from this device</small></span>
      </button>
      <label className="v2-fv-mute v2-fv-keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep video in library</label>
      {!keep && <p className="v2-muted v2-fv-hint">Audio only: the video is removed after its sound is taken.</p>}
      <input ref={file} type="file" hidden accept={VIDEO_UPLOAD_ACCEPT} aria-label="Upload video" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      {up && <div className="v2-fv-progress" role="status" aria-live="polite"><span>Uploading {up.name}… {Math.round(up.f * 100)}%</span><progress max={1} value={up.f} aria-label="Upload progress" /></div>}
      {upMsg && <p className="v2-fv-msg" role="alert">{upMsg}</p>}
    </div>
  );
  if (!videos.length) return <>{uploader}<p className="v2-muted v2-picker-empty">{onUpload ? "No videos in this project yet. Upload one to take its sound." : "No videos in this project yet. Add a video, then take its sound here."}</p></>;
  return (
    <>
      {uploader}
      <p className="v2-muted v2-pick-note">Take the sound of a video as a new audio clip at the playhead.</p>
      <div className="v2-picker-grid" data-testid="video-sources">
        {videos.map((v) => { const none = audio[v.id] === false, on = pick?.assetId === v.id; return (
          <div key={v.id} className="v2-pick-cell">
            <button className={`v2-pick-tile is-asset kind-video ${on ? "is-on" : ""} ${none ? "is-noaudio" : ""}`} aria-pressed={on} disabled={none} aria-disabled={none}
              title={none ? `${v.name}: no audio` : v.name} aria-label={none ? `${v.name}, no audio` : v.name} onClick={() => choose(v)}>
              {v.thumb ? <img src={v.thumb} alt="" draggable={false} /> : <b aria-hidden><Ic g="▭" size={26} /></b>}
              {v.durationTicks ? <i className="v2-pick-dur">{fmtDur(v.durationTicks)}</i> : null}
              <span className="v2-pick-name">{v.name}</span>
              {notKept.includes(v.id) && !none && <span className="v2-pick-noaudio">Audio only</span>}
              {none && <span className="v2-pick-noaudio">No audio</span>}
              <span className={`v2-pick-badge ${on ? "is-on" : ""}`} aria-hidden>{on ? "✓" : ""}</span>
            </button>
          </div>
        ); })}
      </div>
      {pick && sel && <SpanEditor key={sel.id} media={sel} pick={pick} durSec={dur} loadMedia={loadMedia} onPick={onPick} onTimeline={!!onTimeline?.(sel.id)} />}
    </>
  );
}

function SpanEditor({ media, pick, durSec, loadMedia, onPick, onTimeline }: { media: ProjectMedia; pick: FromVideoPick; durSec?: number; loadMedia?: (id: string) => Promise<Blob | undefined>; onPick: (p: FromVideoPick) => void; onTimeline: boolean }) {
  const [url, setUrl] = useState<string>();
  const vid = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let u: string | undefined, live = true;
    void loadMedia?.(media.id).then((b) => { if (b && live) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [media.id, loadMedia]);
  const set = (inSec: number, outSec: number) => onPick({ ...pick, ...clampSpan(inSec, outSec, durSec) });
  const now = () => vid.current?.currentTime ?? 0;
  const play = () => {
    const v = vid.current; if (!v) return;
    if (playing) { v.pause(); return; }
    v.currentTime = pick.inSec; void v.play().catch(() => setPlaying(false));
  };
  const onTime = () => { const v = vid.current; if (v && playing && v.currentTime >= pick.outSec) { v.pause(); v.currentTime = pick.outSec; } };
  const step = (edge: "in" | "out", d: number) => edge === "in" ? set(pick.inSec + d, pick.outSec) : set(pick.inSec, pick.outSec + d);
  const row = (edge: "in" | "out", label: string) => { const val = edge === "in" ? pick.inSec : pick.outSec; return (
    <div className="v2-fv-row" role="group" aria-label={label}>
      <span className="v2-fv-label">{label}</span>
      <button className="v2-btn v2-fv-step" aria-label={`${label} earlier`} onClick={() => step(edge, -0.1)}>−</button>
      <input type="number" inputMode="decimal" step={0.1} min={0} max={durSec} aria-label={`${label} (seconds)`} value={val}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) (edge === "in" ? set(n, pick.outSec) : set(pick.inSec, n)); }} />
      <button className="v2-btn v2-fv-step" aria-label={`${label} later`} onClick={() => step(edge, 0.1)}>＋</button>
      <button className="v2-btn v2-btn-sm" onClick={() => (edge === "in" ? set(now(), pick.outSec) : set(pick.inSec, now()))}>Set to preview</button>
    </div>
  ); };
  return (
    <section className="v2-fv-span" aria-label={`Audio from ${media.name}`}>
      <h4 className="v2-pick-section">From {media.name}</h4>
      <div className="v2-fv-preview">
        {url ? <video ref={vid} src={url} playsInline preload="metadata" controls onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={onTime} aria-label={`Preview of ${media.name}`} />
          : <div className="v2-fv-ph">{media.thumb ? <img src={media.thumb} alt="" /> : <Ic g="▭" size={32} />}</div>}
      </div>
      <button className="v2-btn" onClick={play} disabled={!url}><Ic g={playing ? "❚❚" : "▶"} size={14} /> {playing ? "Pause" : "Play selection"}</button>
      {row("in", "In")}
      {row("out", "Out")}
      <p className="v2-muted v2-fv-len">Length {fmt(pick.outSec - pick.inSec)}{durSec ? ` of ${fmt(durSec)}` : ""}</p>
      {onTimeline && (
        <label className="v2-fv-mute"><input type="checkbox" checked={pick.muteOriginal} onChange={(e) => onPick({ ...pick, muteOriginal: e.target.checked })} /> Mute original video clip</label>
      )}
    </section>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { AssetPreview } from "./AssetPreview";
import { FromVideoTab, type FromVideoPick, type UploadedVideo } from "./FromVideoTab";
import { Ic } from "./Icon";
import { HTML_IMPORT_ACCEPT } from "./htmlPackage";
import { stickers, stickerUrl, type Sticker } from "./libraryItems";

export type Picked = { files: File[]; stickers: Sticker[]; assets?: string[] };
/** V2-ADD-MEDIA-TABS: what the main/overlay [+] adds; "audio" is the Add audio picker's only tab. */
export type PickerTab = "video" | "photo" | "code" | "stickers" | "audio" | "fromVideo";
type Kind = "video" | "image" | "html" | "audio";
/** A media asset already imported into this project (blob persists in IndexedDB), for re-adding without re-upload. */
export type ProjectMedia = { id: string; name: string; kind: Kind; thumb?: string; durationTicks?: number; createdAt: string; width?: number; height?: number };

const TAB: Record<PickerTab, { label: string; icon: string; kind?: Kind; accept?: string; upload?: string; empty?: string }> = {
  video: { label: "Video", icon: "▭", kind: "video", accept: "video/*", upload: "Videos from this device", empty: "No videos in this project yet." },
  photo: { label: "Photo", icon: "image", kind: "image", accept: "image/*", upload: "Photos from this device", empty: "No photos in this project yet." },
  code: { label: "Code", icon: "</>", kind: "html", accept: HTML_IMPORT_ACCEPT, upload: ".html or .dionysus-html.zip", empty: "No code clips yet. Create one, or upload an .html clip." },
  stickers: { label: "Sticker", icon: "sticker" },
  audio: { label: "Audio", icon: "♫", kind: "audio", accept: "audio/*", upload: "Music or sounds from this device", empty: "No audio in this project yet." },
  /** P18: take the sound of a project video. */
  fromVideo: { label: "From Video", icon: "▭" },
};
/** Which tab a picked device file belongs to (by MIME type, then extension). */
export function fileKind(f: File): Kind | undefined {
  if (f.type.startsWith("video/")) return "video";
  if (f.type.startsWith("image/")) return "image";
  if (f.type.startsWith("audio/")) return "audio";
  if (/\.(html?|zip)$/i.test(f.name) || f.type === "text/html" || /zip/.test(f.type)) return "html";
  return undefined;
}
const fmtDur = (ticks?: number) => { if (!ticks) return ""; const s = Math.round(ticks / 120_000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/**
 * Full-screen CapCut-style Add Media picker (V2-ADD-MEDIA-TABS): Video / Photo / Code / Sticker tabs. Each media tab
 * has Upload (from the device) and the project's own media of that kind (thumbnails, durations); Code also has Create
 * (a new clip in the Code Editor). Multi-select across tabs, numbered in pick order, then Add.
 */
export function MediaPicker({ title, onAdd, onClose, media = [], only, initialTab, onCreateCode, onCreateAudio, loadMedia, onAddFromVideo, onTimeline, probeAudio, onUploadVideo, onDiscardVideo }: {
  title: string; onAdd: (p: Picked) => void; onClose: () => void; media?: ProjectMedia[];
  /** "audio": the audio tab only. */ only?: "audio"; initialTab?: PickerTab;
  /** Code → Create: open the Code Editor on a new clip (the picker closes). */ onCreateCode?: () => void;
  /** Audio → Create audio: open the Audio editor on a new clip (the picker closes). */ onCreateAudio?: () => void;
  /** P2C (item 7): the file of a project asset, for its playable preview (no preview button without it). */
  loadMedia?: (assetId: string) => Promise<Blob | undefined>;
  /** P18: Add audio → From Video (the tab shows when this is given). */ onAddFromVideo?: (p: FromVideoPick) => void;
  /** P19: From Video → Upload video (imports the file; `keep` false = audio-only, removed after extraction). */ onUploadVideo?: (file: File, keep: boolean, progress: (f: number) => void) => Promise<UploadedVideo>;
  /** P19: remove an audio-only upload that was not used. */ onDiscardVideo?: (assetId: string) => void;
  /** P18: audio-track probe for From Video tiles (tests). */ probeAudio?: (b: Blob) => Promise<boolean | undefined>;
  /** P18: whether a video asset has clips on the timeline (offers "Mute original video clip"). */ onTimeline?: (assetId: string) => boolean;
}) {
  const [preview, setPreview] = useState<ProjectMedia>();
  const tabs: PickerTab[] = only === "audio" ? (onAddFromVideo ? ["audio", "fromVideo"] : ["audio"]) : ["video", "photo", "code", "stickers"];
  const [tab, setTab] = useState<PickerTab>(initialTab && tabs.includes(initialTab) ? initialTab : tabs[0]);
  const recent = useMemo(() => [...media].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [media]);
  const [files, setFiles] = useState<File[]>([]);
  const [notKept, setNotKept] = useState<string[]>([]);
  const uploadVideo = onUploadVideo && (async (f: File, keep: boolean, progress: (x: number) => void) => {
    const r = await onUploadVideo(f, keep, progress);
    if (!("error" in r) && !keep) { if (r.audio === false) onDiscardVideo?.(r.assetId); else setNotKept((n) => [...n, r.assetId]); }
    return r;
  });
  /** P19: drop audio-only uploads that are not being added. */
  const discardUnused = (keepId?: string) => notKept.filter((id) => id !== keepId).forEach((id) => onDiscardVideo?.(id));
  const close = () => { discardUnused(); onClose(); };
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fv, setFv] = useState<FromVideoPick>();
  const videos = useMemo(() => recent.filter((m) => m.kind === "video"), [recent]);
  const input = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => files.map((f) => (/^(image|video)\//.test(f.type) ? URL.createObjectURL(f) : "")), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { if (preview) setPreview(undefined); else close(); } }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose, preview, notKept]);
  const key = (f: File, i: number) => `f${i}:${f.name}`;
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const order = [...picked];
  const count = picked.size;
  const add = () => { discardUnused(); addSel(); };
  const addSel = () => onAdd({
    files: order.filter((k) => k.startsWith("f")).map((k) => files[Number(k.slice(1, k.indexOf(":")))]).filter(Boolean),
    assets: order.filter((k) => k.startsWith("a:")).map((k) => k.slice(2)),
    stickers: order.filter((k) => k.startsWith("s:")).map((k) => stickers().find((it) => `s:${it.id}` === k)!).filter(Boolean),
  });
  const badge = (k: string) => { const n = order.indexOf(k); return <span className={`v2-pick-badge ${n >= 0 ? "is-on" : ""}`} aria-hidden>{n >= 0 ? n + 1 : ""}</span>; };
  const spec = TAB[tab];
  const kind = spec.kind;
  const onPick = (fs: File[]) => {
    if (!fs.length) return;
    const base = files.length;
    setFiles((cur) => [...cur, ...fs]);
    setPicked((s) => { const n = new Set(s); fs.forEach((f, i) => n.add(key(f, base + i))); return n; });
  };
  const newFiles = kind ? files.map((f, i) => ({ f, i })).filter(({ f }) => (fileKind(f) ?? (kind === "html" ? "html" : undefined)) === kind) : [];
  const mine = kind ? recent.filter((m) => m.kind === kind) : [];
  const tile = (m: ProjectMedia) => { const k = `a:${m.id}`; return (
    <div key={k} className="v2-pick-cell">
    <button className={`v2-pick-tile is-asset kind-${m.kind} ${picked.has(k) ? "is-on" : ""}`} aria-pressed={picked.has(k)} title={m.name} aria-label={m.name} onClick={() => toggle(k)}>
      {m.thumb ? <img src={m.thumb} alt="" draggable={false} /> : <b aria-hidden><Ic g={TAB[tab].icon} size={26} /></b>}
      {m.kind !== "image" && m.durationTicks ? <i className="v2-pick-dur">{fmtDur(m.durationTicks)}</i> : null}
      {m.kind === "html" && <i className="v2-pick-kind" aria-hidden><Ic g="</>" size={12} /></i>}
      <span className="v2-pick-name">{m.name}</span>
      {badge(k)}
    </button>
    {loadMedia && <button className="v2-pick-peek" aria-label={`Preview ${m.name}`} title="Preview" onClick={() => setPreview(m)}><Ic g={m.kind === "image" ? "eye" : "▶"} size={16} /></button>}
    </div>
  ); };
  return (
    <div className="v2-picker" role="dialog" aria-label={title}>
      <header className="v2-picker-head">
        <button className="v2-icon-btn" aria-label="Close" title="Close (Esc)" onClick={close}><Ic g="✕" /></button>
        <h3>{title}</h3>
        <span />
      </header>
      {tabs.length > 1 && (
        <div className="v2-picker-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>
              <Ic g={TAB[t].icon} size={18} /><span>{TAB[t].label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="v2-picker-body" role="tabpanel" aria-label={spec.label} data-tab={tab}>
        {kind ? (
          <>
            <div className="v2-pick-actions">
              <button className="v2-pick-action" onClick={() => input.current?.click()}>
                <span className="v2-pick-action-ic"><Ic g="⇪" size={22} /></span>
                <span><b>Upload</b><small>{spec.upload}</small></span>
              </button>
              {tab === "code" && onCreateCode && (
                <button className="v2-pick-action is-create" onClick={onCreateCode}>
                  <span className="v2-pick-action-ic"><Ic g="＋" size={22} /></span>
                  <span><b>Create</b><small>Write a canvas clip in the Code Editor</small></span>
                </button>
              )}
              {tab === "audio" && onCreateAudio && (
                <button className="v2-pick-action is-create" onClick={onCreateAudio}>
                  <span className="v2-pick-action-ic"><Ic g="♫" size={22} /></span>
                  <span><b>Create Audio</b><small>Make music or sound effects in the Audio editor</small></span>
                </button>
              )}
            </div>
            <input ref={input} type="file" hidden multiple accept={spec.accept} aria-label={`Upload ${spec.label.toLowerCase()}`} onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; onPick(fs); }} />
            {newFiles.length > 0 && (
              <>
                <h4 className="v2-pick-section">Uploaded</h4>
                <div className="v2-picker-grid" data-testid="device-media">
                  {newFiles.map(({ f, i }) => { const k = key(f, i); return (
                    <button key={k} className={`v2-pick-tile ${picked.has(k) ? "is-on" : ""}`} aria-pressed={picked.has(k)} title={f.name} aria-label={f.name} onClick={() => toggle(k)}>
                      {f.type.startsWith("video/") ? <video src={urls[i]} muted playsInline preload="metadata" /> : urls[i] ? <img src={urls[i]} alt="" /> : <b aria-hidden><Ic g={spec.icon} size={26} /></b>}
                      <span className="v2-pick-name">{f.name}</span>
                      {badge(k)}
                    </button>
                  ); })}
                </div>
              </>
            )}
            <h4 className="v2-pick-section">In this project</h4>
            {mine.length === 0 ? <p className="v2-muted v2-picker-empty">{spec.empty}</p> : (
              <div className="v2-picker-grid" data-testid="project-media">{mine.map(tile)}</div>
            )}
          </>
        ) : tab === "fromVideo" ? (
          <FromVideoTab videos={videos} loadMedia={loadMedia} onTimeline={onTimeline} pick={fv} onPick={setFv} onUpload={uploadVideo} notKept={notKept} {...(probeAudio ? { probe: probeAudio } : {})} />
        ) : (
          <>
            <p className="v2-muted v2-pick-note">Stickers go to the Text &amp; Stickers group, above overlays.</p>
            <div className="v2-picker-grid">
              {stickers().map((it) => { const k = `s:${it.id}`; return (
                <button key={k} className={`v2-pick-tile is-sticker ${picked.has(k) ? "is-on" : ""}`} aria-pressed={picked.has(k)} title={it.name} aria-label={it.name} onClick={() => toggle(k)}>
                  <img src={stickerUrl(it)} alt="" />{badge(k)}
                </button>
              ); })}
            </div>
          </>
        )}
      </div>
      {preview && loadMedia && (
        <div className="v2-pick-preview" role="dialog" aria-label={`Preview of ${preview.name}`}>
          <div className="v2-pick-preview-head"><b>{preview.name}</b><button className="v2-icon-btn" aria-label="Close preview" onClick={() => setPreview(undefined)}><Ic g="✕" /></button></div>
          <AssetPreview kind={preview.kind} name={preview.name} cacheKey={preview.id} load={() => loadMedia(preview.id)} durationSec={preview.durationTicks ? preview.durationTicks / 120_000 : undefined} width={preview.width} height={preview.height} />
          <div className="v2-pick-preview-foot">
            <button className="v2-btn" onClick={() => setPreview(undefined)}>Back</button>
            <button className="v2-btn primary" aria-pressed={picked.has(`a:${preview.id}`)} onClick={() => { toggle(`a:${preview.id}`); setPreview(undefined); }}>{picked.has(`a:${preview.id}`) ? "Unselect" : "Select"}</button>
          </div>
        </div>
      )}
      <footer className="v2-picker-foot">
        {tab === "fromVideo" ? <>
          <span className="v2-muted">{fv ? "Adds at the playhead" : "Choose a video"}</span>
          <button className="v2-btn primary" disabled={!fv} onClick={() => { if (!fv) return; discardUnused(fv.assetId); onAddFromVideo?.({ ...fv, ...(notKept.includes(fv.assetId) ? { discardVideo: true } : {}) }); }}>Add audio</button>
        </> : <>
        <span className="v2-muted">{count ? `${count} selected` : "Select items to add"}</span>
        <button className="v2-btn primary" disabled={!count} onClick={add}>Add{count ? ` (${count})` : ""}</button>
        </>}
      </footer>
    </div>
  );
}

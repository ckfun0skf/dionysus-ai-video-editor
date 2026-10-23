import { useEffect, useMemo, useRef, useState } from "react";
import { LIBRARY_ITEMS, stickers, stickerUrl, type LibraryItem, type Sticker } from "./libraryItems";

export type Picked = { files: File[]; library: LibraryItem[]; stickers: Sticker[]; assets?: string[] };
export type PickerTab = Tab;
type Tab = "project" | "device" | "library" | "stickers";
/** A media asset already imported into this project (blob persists in IndexedDB), for re-adding without re-upload. */
export type ProjectMedia = { id: string; name: string; kind: "video" | "image" | "audio"; thumb?: string; durationTicks?: number; createdAt: string };
const TAB_LABEL: Record<Tab, string> = { project: "Project media", device: "Device", library: "Library", stickers: "Stickers" };
const fmtDur = (ticks?: number) => { if (!ticks) return ""; const s = Math.round(ticks / 120_000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Full-screen CapCut-style picker: Device (photos/videos) and Library tabs, multi-select, then Add. */
export function MediaPicker({ title, onAdd, onClose, media: allMedia = [], only, initialTab }: { title: string; onAdd: (p: Picked) => void; onClose: () => void; media?: ProjectMedia[]; /** "audio": Project media + Device only, audio files only. */ only?: "audio"; initialTab?: Tab }) {
  const media = only === "audio" ? allMedia.filter((m) => m.kind === "audio") : allMedia;
  const tabs: Tab[] = only === "audio" ? ["project", "device"] : ["project", "device", "library", "stickers"];
  const [tab, setTab] = useState<Tab>(initialTab ?? (media.length ? "project" : "device"));
  const recent = useMemo(() => [...media].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [allMedia, only]); // eslint-disable-line react-hooks/exhaustive-deps
  const [files, setFiles] = useState<File[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => files.map((f) => (/^(image|video)\//.test(f.type) ? URL.createObjectURL(f) : "")), [files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  const key = (f: File, i: number) => `f${i}:${f.name}`;
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const order = [...picked];
  const count = picked.size;
  const add = () => onAdd({
    files: order.filter((k) => k.startsWith("f")).map((k) => files[Number(k.slice(1, k.indexOf(":")))]).filter(Boolean),
    library: order.filter((k) => k.startsWith("l:")).map((k) => LIBRARY_ITEMS.find((it) => `l:${it.id}` === k)!).filter(Boolean),
    assets: order.filter((k) => k.startsWith("a:")).map((k) => k.slice(2)),
    stickers: order.filter((k) => k.startsWith("s:")).map((k) => stickers().find((it) => `s:${it.id}` === k)!).filter(Boolean),
  });
  const badge = (k: string) => { const n = order.indexOf(k); return <span className={`v2-pick-badge ${n >= 0 ? "is-on" : ""}`} aria-hidden>{n >= 0 ? n + 1 : ""}</span>; };
  return (
    <div className="v2-picker" role="dialog" aria-label={title}>
      <header className="v2-picker-head">
        <button className="v2-icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>✕</button>
        <h3>{title}</h3>
        <span />
      </header>
      <div className="v2-picker-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
        ))}
      </div>
      <div className="v2-picker-body">
        {tab === "project" ? (
          recent.length === 0 ? <p className="v2-muted v2-picker-empty">{only === "audio" ? "No audio in this project yet. Choose files on the Device tab." : "Nothing imported yet. Media you add to this project shows up here, newest first, so you can re-add it without uploading again."}</p> : (
            <div className="v2-picker-grid" data-testid="project-media">
              {recent.map((m) => { const k = `a:${m.id}`; return (
                <button key={k} className={`v2-pick-tile is-asset ${picked.has(k) ? "is-on" : ""}`} aria-pressed={picked.has(k)} title={m.name} aria-label={m.name} onClick={() => toggle(k)}>
                  {m.thumb ? <img src={m.thumb} alt="" draggable={false} /> : <b aria-hidden>{m.kind === "audio" ? "♫" : m.kind === "video" ? "▶" : "▣"}</b>}
                  {m.kind !== "image" && m.durationTicks ? <i className="v2-pick-dur">{fmtDur(m.durationTicks)}</i> : null}
                  <span className="v2-pick-name">{m.name}</span>
                  {badge(k)}
                </button>
              ); })}
            </div>
          )
        ) : tab === "device" ? (
          <>
            <button className="v2-btn v2-picker-browse" title={only === "audio" ? "Choose audio files from this device" : "Choose photos and videos from this device"} onClick={() => input.current?.click()}>{only === "audio" ? "＋ Choose audio files" : <>＋ Choose photos &amp; videos</>}</button>
            <input ref={input} type="file" hidden multiple accept={only === "audio" ? "audio/*" : "image/*,video/*"} aria-label={only === "audio" ? "Choose audio files" : "Choose photos and videos"} onChange={(e) => {
              const fs = [...(e.target.files ?? [])]; e.target.value = "";
              if (!fs.length) return;
              const base = files.length;
              setFiles((cur) => [...cur, ...fs]);
              setPicked((s) => { const n = new Set(s); fs.forEach((f, i) => n.add(key(f, base + i))); return n; });
            }} />
            {files.length === 0 ? <p className="v2-muted v2-picker-empty">{only === "audio" ? "No audio yet. Choose music or sound files from your device." : "No photos or videos yet. Choose some from your device, or switch to Library for HTML and text clips."}</p> : (
              <div className="v2-picker-grid">
                {files.map((f, i) => { const k = key(f, i); return (
                  <button key={k} className={`v2-pick-tile ${picked.has(k) ? "is-on" : ""}`} aria-pressed={picked.has(k)} title={f.name} onClick={() => toggle(k)}>
                    {f.type.startsWith("video/") ? <video src={urls[i]} muted playsInline preload="metadata" /> : urls[i] ? <img src={urls[i]} alt="" /> : <span className="v2-pick-name">{f.type.startsWith("audio/") ? "♫ " : ""}{f.name}</span>}
                    {badge(k)}
                  </button>
                ); })}
              </div>
            )}
          </>
        ) : tab === "stickers" ? (
          <>
            <p className="v2-muted">Stickers go to the Text &amp; Stickers group, above overlays.</p>
            <div className="v2-picker-grid">
              {stickers().map((it) => { const k = `s:${it.id}`; return (
                <button key={k} className={`v2-pick-tile is-sticker ${picked.has(k) ? "is-on" : ""}`} aria-pressed={picked.has(k)} title={it.name} aria-label={it.name} onClick={() => toggle(k)}>
                  <img src={stickerUrl(it)} alt="" />{badge(k)}
                </button>
              ); })}
            </div>
          </>
        ) : (
          <div className="v2-picker-grid">
            {LIBRARY_ITEMS.map((it) => { const k = `l:${it.id}`; return (
              <button key={k} className={`v2-pick-tile is-lib ${picked.has(k) ? "is-on" : ""}`} aria-pressed={picked.has(k)} title={it.hint} onClick={() => toggle(k)}>
                <b aria-hidden>{it.icon}</b><span>{it.name}</span>{badge(k)}
              </button>
            ); })}
          </div>
        )}
      </div>
      <footer className="v2-picker-foot">
        <span className="v2-muted">{count ? `${count} selected` : "Select items to add"}</span>
        <button className="v2-btn primary" disabled={!count} onClick={add}>Add{count ? ` (${count})` : ""}</button>
      </footer>
    </div>
  );
}

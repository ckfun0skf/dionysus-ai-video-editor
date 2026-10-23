import { useEffect, useMemo, useRef, useState } from "react";
import { LIBRARY_ITEMS, type LibraryItem } from "./libraryItems";

export type Picked = { files: File[]; library: LibraryItem[] };
type Tab = "device" | "library";

/** Full-screen CapCut-style picker: Device (photos/videos) and Library tabs, multi-select, then Add. */
export function MediaPicker({ title, onAdd, onClose }: { title: string; onAdd: (p: Picked) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("device");
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
        {(["device", "library"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>{t === "device" ? "Device" : "Library"}</button>
        ))}
      </div>
      <div className="v2-picker-body">
        {tab === "device" ? (
          <>
            <button className="v2-btn v2-picker-browse" title="Choose photos and videos from this device" onClick={() => input.current?.click()}>＋ Choose photos &amp; videos</button>
            <input ref={input} type="file" hidden multiple accept="image/*,video/*" aria-label="Choose photos and videos" onChange={(e) => {
              const fs = [...(e.target.files ?? [])]; e.target.value = "";
              if (!fs.length) return;
              const base = files.length;
              setFiles((cur) => [...cur, ...fs]);
              setPicked((s) => { const n = new Set(s); fs.forEach((f, i) => n.add(key(f, base + i))); return n; });
            }} />
            {files.length === 0 ? <p className="v2-muted v2-picker-empty">No photos or videos yet. Choose some from your device, or switch to Library for HTML and text clips.</p> : (
              <div className="v2-picker-grid">
                {files.map((f, i) => { const k = key(f, i); return (
                  <button key={k} className={`v2-pick-tile ${picked.has(k) ? "is-on" : ""}`} aria-pressed={picked.has(k)} title={f.name} onClick={() => toggle(k)}>
                    {f.type.startsWith("video/") ? <video src={urls[i]} muted playsInline preload="metadata" /> : urls[i] ? <img src={urls[i]} alt="" /> : <span>{f.name}</span>}
                    {badge(k)}
                  </button>
                ); })}
              </div>
            )}
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

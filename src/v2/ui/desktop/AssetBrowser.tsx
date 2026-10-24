import { useEffect, useRef, useState } from "react";
import { formatTimecode, text as T, type Asset, type Project } from "../../domain";
import { applyEffectFrame } from "../../render";
import { applyPreset, identityFrame, listPresets } from "../../registry";
import { Ic } from "../Icon";
import { LIBRARY_ITEMS, stickers, stickerUrl, type LibraryItem, type Sticker } from "../libraryItems";
import { ASSET_MIME, hasFiles, setDragItem } from "./dnd";

export const BROWSER_TABS = [
  { id: "media", label: "Media", icon: "image" },
  { id: "audio", label: "Audio", icon: "♫" },
  { id: "text", label: "Text", icon: "T" },
  { id: "stickers", label: "Stickers", icon: "sticker" },
  { id: "effects", label: "Effects", icon: "effect" },
  { id: "templates", label: "Templates", icon: "template" },
] as const;
export type BrowserTab = (typeof BROWSER_TABS)[number]["id"];

export interface BrowserActions {
  onImport: (accept?: string) => void;
  onFiles: (files: File[]) => void;
  onAddAsset: (a: Asset) => void;
  onRemoveAsset: (a: Asset) => void;
  onAddText: (template?: string) => void;
  onImportSrt: () => void;
  onAddSticker: (s: Sticker) => void;
  onAddEffect: (id: string) => void;
  onAddTransition: () => void;
  onAddLibrary: (it: LibraryItem) => void;
}

/**
 * V2-106 desktop asset browser (CapCut-style left panel). Every tile adds on click and can be dragged onto the timeline.
 * Text tab items only ADD text; styling lives in the right inspector.
 */
export function AssetBrowser({ project, thumbs, busy, tab, onTab, ...a }: BrowserActions & {
  project: Project; thumbs: Record<string, string>; busy: number; tab: BrowserTab; onTab: (t: BrowserTab) => void;
}) {
  const [over, setOver] = useState(false);
  const assets = Object.values(project.assets).filter((x) => !x.name.startsWith("sticker-"));
  const media = assets.filter((x) => x.kind !== "audio"), audio = assets.filter((x) => x.kind === "audio");
  const drop = {
    onDragOver: (e: React.DragEvent) => { if (hasFiles(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); },
    onDrop: (e: React.DragEvent) => { setOver(false); if (e.dataTransfer.files?.length) { e.preventDefault(); a.onFiles(Array.from(e.dataTransfer.files)); } },
  };
  const fps = project.settings.fps;
  const assetGrid = (list: Asset[], empty: { icon: string; title: string; body: string; accept?: string; cta: string }) => (
    list.length === 0 ? (
      <button className="v2-dropzone" onClick={() => a.onImport(empty.accept)} title={empty.body}>
        <Ic g={empty.icon} size={28} />
        <strong>{empty.title}</strong>
        <span>{empty.body}</span>
        <span className="v2-btn primary" aria-hidden><Ic g="⇪" size={16} /> {empty.cta}</span>
      </button>
    ) : (
      <ul className="v2-tiles" aria-label={empty.title}>
        {list.map((x) => {
          const d = (x.versions.find((v) => v.id === x.selectedVersionId) ?? x.versions[0])?.media.durationTicks;
          return (
            <li key={x.id} className={`v2-tile kind-${x.kind}`} draggable onDragStart={(e) => { e.dataTransfer.setData(ASSET_MIME, x.id); e.dataTransfer.effectAllowed = "copy"; }}>
              <button className="v2-tile-main" title={`${x.name} — click to add to the end of the timeline, or drag onto a track`} aria-label={`Add ${x.name} to timeline`} onClick={() => a.onAddAsset(x)}>
                <span className="v2-tile-thumb" style={thumbs[x.id] ? { backgroundImage: `url(${thumbs[x.id]})` } : undefined}>
                  {!thumbs[x.id] && <Ic g={x.kind === "audio" ? "♫" : x.kind === "html" ? "</>" : x.kind === "image" ? "image" : "▭"} size={22} />}
                  {d ? <em className="v2-tile-dur">{formatTimecode(d, fps).slice(0, 5)}</em> : null}
                  <span className="v2-tile-add" aria-hidden><Ic g="＋" size={16} /></span>
                </span>
                <span className="v2-tile-name">{x.name}</span>
              </button>
              <button className="v2-tile-del" aria-label={`Remove ${x.name}`} title="Remove from project (Undo restores it)" onClick={() => a.onRemoveAsset(x)}><Ic g="✕" size={14} /></button>
            </li>
          );
        })}
      </ul>
    )
  );
  return (
    <section className={`v2-browser v2-abrowser ${over ? "is-drop" : ""}`} aria-label="Media" {...drop}>
      <nav className="v2-abtabs" role="tablist" aria-label="Asset browser">
        {BROWSER_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`v2-abtab ${tab === t.id ? "is-active" : ""}`} title={t.label} onClick={() => onTab(t.id)}>
            <Ic g={t.icon} size={18} /><span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="v2-abbody" role="tabpanel" aria-label={BROWSER_TABS.find((t) => t.id === tab)!.label}>
        {tab === "media" && <>
          <div className="v2-abhead"><strong>Project media</strong><button className="v2-btn primary" title="Import video, images or HTML clips (or drop files here)" onClick={() => a.onImport()}><Ic g="⇪" size={16} /> Import</button></div>
          {busy > 0 && <p className="v2-hint" role="status">Importing {busy}…</p>}
          {assetGrid(media, { icon: "⇪", title: "Drop media here", body: "Video, images or HTML — or click to browse. Then drag onto the timeline or click a tile to add it.", accept: "video/*,image/*,.html,.htm,text/html", cta: "Import media" })}
        </>}
        {tab === "audio" && <>
          <div className="v2-abhead"><strong>Music & sounds</strong><button className="v2-btn primary" title="Import audio files (or drop them here)" onClick={() => a.onImport("audio/*")}><Ic g="⇪" size={16} /> Import</button></div>
          {assetGrid(audio, { icon: "♫", title: "No audio yet", body: "Drop MP3, WAV or M4A files here, or click to browse. Audio goes on an audio track.", accept: "audio/*", cta: "Import audio" })}
        </>}
        {tab === "text" && <>
          <div className="v2-abhead"><strong>Add text</strong></div>
          <button className="v2-addtext" draggable onDragStart={(e) => setDragItem(e.dataTransfer, { kind: "text" })} title="Add a text clip at the playhead (T) — or drag onto the timeline" onClick={() => a.onAddText()}>
            <Ic g="＋" size={18} /> Default text
          </button>
          <p className="v2-abnote">Pick a starting look — style it in the inspector on the right.</p>
          <ul className="v2-tiles v2-tiles-text" aria-label="Text presets">
            {T.textTemplates().map((tp) => (
              <li key={tp.id} className="v2-tile" draggable onDragStart={(e) => setDragItem(e.dataTransfer, { kind: "text", template: tp.id })}>
                <button className="v2-tile-main" aria-label={`Add ${tp.label} text`} title={`Add ${tp.label} text at the playhead`} onClick={() => a.onAddText(tp.id)}>
                  <span className="v2-tile-thumb v2-textprev"><TextSample data={tp.data} label={tp.label} /><span className="v2-tile-add" aria-hidden><Ic g="＋" size={16} /></span></span>
                  <span className="v2-tile-name">{tp.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="v2-abhead"><strong>Subtitles</strong></div>
          <button className="v2-btn v2-wide" title="Import an .srt file as a new text layer" onClick={a.onImportSrt}><Ic g="⇪" size={16} /> Import SRT</button>
        </>}
        {tab === "stickers" && <ul className="v2-tiles v2-tiles-sq" aria-label="Stickers">
          {stickers().map((s) => (
            <li key={s.id} className="v2-tile" draggable onDragStart={(e) => setDragItem(e.dataTransfer, { kind: "sticker", id: s.id })}>
              <button className="v2-tile-main" aria-label={`Add sticker ${s.name}`} title={`${s.name} — click to add at the playhead`} onClick={() => a.onAddSticker(s)}>
                <span className="v2-tile-thumb"><img src={stickerUrl(s)} alt="" draggable={false} /><span className="v2-tile-add" aria-hidden><Ic g="＋" size={16} /></span></span>
                <span className="v2-tile-name">{s.name}</span>
              </button>
            </li>
          ))}
        </ul>}
        {tab === "effects" && <>
          <div className="v2-abhead"><strong>Video effects</strong></div>
          <ul className="v2-tiles" aria-label="Effects">
            {listPresets("videoEffect").map((d) => (
              <li key={d.id} className="v2-tile" draggable onDragStart={(e) => setDragItem(e.dataTransfer, { kind: "effect", id: d.id })}>
                <button className="v2-tile-main" aria-label={`Add effect ${d.name}`} title={`${d.name} — adds an effect layer at the playhead (changes the main track)`} onClick={() => a.onAddEffect(d.id)}>
                  <span className="v2-tile-thumb"><FxPreview id={d.id} /><span className="v2-tile-add" aria-hidden><Ic g="＋" size={16} /></span></span>
                  <span className="v2-tile-name">{d.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="v2-abhead"><strong>Transitions</strong></div>
          <button className="v2-btn v2-wide" title="Pick a transition for the main-track cut nearest the playhead" onClick={a.onAddTransition}><Ic g="⧓" size={16} /> Transition at nearest cut</button>
        </>}
        {tab === "templates" && <>
          <div className="v2-abhead"><strong>Code clips</strong></div>
          <ul className="v2-tiles" aria-label="Templates">
            {LIBRARY_ITEMS.filter((it) => it.html).map((it) => (
              <li key={it.id} className="v2-tile" draggable onDragStart={(e) => setDragItem(e.dataTransfer, { kind: "library", id: it.id })}>
                <button className="v2-tile-main" aria-label={`Add ${it.name}`} title={`${it.hint} — click to add at the playhead`} onClick={() => a.onAddLibrary(it)}>
                  <span className="v2-tile-thumb v2-codeprev"><b>{it.icon}</b><span className="v2-tile-add" aria-hidden><Ic g="＋" size={16} /></span></span>
                  <span className="v2-tile-name">{it.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="v2-abnote">HTML/CSS/JS clips render in a sandbox; select one and choose Edit code in the inspector.</p>
        </>}
      </div>
      {over && <div className="v2-dropveil" aria-hidden><Ic g="⇪" size={28} /><span>Drop to import</span></div>}
    </section>
  );
}

function TextSample({ data, label }: { data: Partial<T.TextData>; label: string }) {
  const st: React.CSSProperties = {
    fontFamily: data.font, fontWeight: data.bold ? 700 : 500, color: data.color ?? "#fff",
    WebkitTextStroke: data.strokeWidth ? `1.5px ${data.strokeColor ?? "#000"}` : undefined,
    background: data.background ? `${data.background.color}${Math.round((data.background.opacity ?? 1) * 255).toString(16).padStart(2, "0")}` : undefined,
    textShadow: data.effect === "neon" ? `0 0 6px ${data.effectColor ?? "#f0f"}, 0 0 12px ${data.effectColor ?? "#f0f"}` : undefined,
  };
  return <span className="v2-textsample" style={st}>{label}</span>;
}

/** Static effect thumbnail; animates only while hovered (keeps idle CPU at zero). */
function FxPreview({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const c = ref.current, g = c?.getContext?.("2d");
    if (!c || !g) return;
    let raf = 0; const t0 = performance.now();
    const draw = (now: number) => {
      g.setTransform(1, 0, 0, 1, 0, 0); g.filter = "none"; g.globalAlpha = 1;
      const w = c.width, h = c.height;
      const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#3b82f6"); sky.addColorStop(1, "#f9a8d4");
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = "#fde047"; g.beginPath(); g.arc(w * 0.7, h * 0.35, h * 0.16, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#16a34a"; g.fillRect(0, h * 0.7, w, h * 0.3);
      const p = hover ? ((now - t0) % 1800) / 1800 : 0.5;
      applyEffectFrame(g, w, h, applyPreset("videoEffect", id, p, identityFrame()));
      if (hover) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [id, hover]);
  return <canvas ref={ref} width={144} height={81} aria-hidden onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} />;
}

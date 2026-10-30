import { useEffect, useMemo, useState } from "react";
import { TICKS_PER_SECOND, type MediaKind, type MediaRef, type Project } from "../../domain";
import type { BlobStore } from "../../ports";
import { AssetPreview, type PreviewKind } from "../AssetPreview";
import { Ic } from "../Icon";

const ICON: Record<PreviewKind, string> = { video: "▭", image: "image", audio: "♫", html: "</>" };
const fmtDur = (ticks?: number) => { if (!ticks) return ""; const s = Math.round(ticks / TICKS_PER_SECOND); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** One version of a project asset of the kind a storyboard item needs. */
export interface LibraryEntry { key: string; assetId: string; versionId: string; name: string; label: string; media: MediaRef; createdAt: string; thumb?: string }

/**
 * Versions of every project asset of `kind` (newest first), except the ones of `exclude` (the item's own asset, whose
 * versions are already listed in its panel). Built-in stickers are left out.
 */
export function libraryEntries(project: Project, kind: MediaKind, exclude: string | undefined, thumbs: Record<string, string> = {}): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const a of Object.values(project.assets)) {
    if (a.kind !== kind || a.id === exclude || a.name.startsWith("sticker-")) continue;
    a.versions.forEach((v, i) => out.push({ key: `${a.id}:${v.id}`, assetId: a.id, versionId: v.id, name: a.name, label: a.versions.length > 1 ? `v${i + 1}` : "", media: v.media, createdAt: v.createdAt, thumb: thumbs[v.id] ?? thumbs[a.id] }));
  }
  return out.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

/**
 * P2C (item 7): the storyboard's "Add version" picker, like Add Media: upload a new file from the device, or choose an
 * existing asset or version from this project's library, with a playable preview of the one selected. The chosen
 * file is shared (not copied) and becomes a new version of the shot or asset.
 */
export function StoryAssetPicker({ project, kind, title, exclude, thumbs, blobs, uploadLabel, onUpload, onPick, onClose }: {
  project: Project; kind: MediaKind; title: string; exclude?: string; thumbs: Record<string, string>; blobs: BlobStore;
  uploadLabel: string; /** Open the device file chooser (the panel's own file input). */ onUpload: () => void; onPick: (e: LibraryEntry) => void; onClose: () => void;
}) {
  const entries = useMemo(() => libraryEntries(project, kind, exclude, thumbs), [project, kind, exclude, thumbs]);
  const [sel, setSel] = useState<string>();
  const cur = entries.find((e) => e.key === sel);
  const pk = (["video", "image", "audio", "html"].includes(kind) ? kind : "image") as PreviewKind;
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="v2-picker v2-sb-picker" role="dialog" aria-label={title}>
      <header className="v2-picker-head">
        <button className="v2-icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><Ic g="✕" /></button>
        <h3>{title}</h3>
        <span />
      </header>
      <div className="v2-picker-body">
        <div className="v2-pick-actions">
          <button className="v2-pick-action" onClick={onUpload} data-testid="sb-picker-upload">
            <span className="v2-pick-action-ic"><Ic g="⇪" size={22} /></span>
            <span><b>Upload new</b><small>{uploadLabel}</small></span>
          </button>
        </div>
        {cur && (
          <section className="v2-sb-picker-preview" aria-label="Preview">
            <AssetPreview kind={pk} name={`${cur.name}${cur.label ? ` ${cur.label}` : ""}`} cacheKey={cur.key} load={() => blobs.get(cur.media.blobKey)}
              durationSec={cur.media.durationTicks ? cur.media.durationTicks / TICKS_PER_SECOND : undefined} width={cur.media.width} height={cur.media.height} />
          </section>
        )}
        <h4 className="v2-pick-section">From this project</h4>
        {entries.length === 0 ? <p className="v2-muted v2-picker-empty">No other {kind === "html" ? "code clips" : `${kind} files`} in this project yet. Upload one.</p> : (
          <div className="v2-picker-grid" data-testid="sb-library" role="listbox" aria-label="Project library">
            {entries.map((e) => (
              <button key={e.key} role="option" aria-selected={sel === e.key} className={`v2-pick-tile is-asset kind-${kind} ${sel === e.key ? "is-on" : ""}`} title={e.name} aria-label={`${e.name}${e.label ? ` ${e.label}` : ""}`} onClick={() => setSel(sel === e.key ? undefined : e.key)}>
                {e.thumb ? <img src={e.thumb} alt="" draggable={false} /> : <b aria-hidden><Ic g={ICON[pk]} size={26} /></b>}
                {kind !== "image" && e.media.durationTicks ? <i className="v2-pick-dur">{fmtDur(e.media.durationTicks)}</i> : null}
                <span className="v2-pick-name">{e.name}{e.label ? ` · ${e.label}` : ""}</span>
                {sel === e.key && <span className="v2-pick-badge is-on" aria-hidden>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <footer className="v2-picker-foot">
        <span className="v2-muted">{cur ? `${cur.name}${cur.label ? ` ${cur.label}` : ""}` : "Tap one to preview it"}</span>
        <button className="v2-btn primary" disabled={!cur} onClick={() => cur && onPick(cur)} data-testid="sb-picker-use">Add as new version</button>
      </footer>
    </div>
  );
}

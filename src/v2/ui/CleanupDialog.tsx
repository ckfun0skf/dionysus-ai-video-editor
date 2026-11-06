/**
 * P38 (item 9): Clean up project. Unused media (checked by default) and old versions (unchecked by default), with the
 * space each frees; ✓ removes the checked items in one undo step. Files are freed by the storage clean-up at next start.
 */
import { useEffect, useMemo, useState } from "react";
import { cleanup, readManifest, type Project } from "../domain";
import { cmd, type Engine } from "../engine";
import type { BlobStore } from "../ports";
import { blobText } from "./AssetPreview";
import { Ic } from "./Icon";

/** Asset ids named by the bindings of the code clips in use (read from their manifests). */
export async function bindingRefsOf(p: Project, blobs: BlobStore): Promise<string[]> {
  const out = new Set<string>(), seen = new Set<string>();
  for (const c of Object.values(p.compositions)) for (const t of c.tracks) for (const pl of t.placements) {
    if (pl.clipType !== "html" || seen.has(pl.source.versionId)) continue;
    seen.add(pl.source.versionId);
    const v = p.assets[pl.source.assetId]?.versions.find((x) => x.id === pl.source.versionId);
    const b = v && (await blobs.get(v.media.blobKey).catch(() => undefined));
    if (!b) continue;
    try { for (const [name, d] of Object.entries(readManifest(await blobText(b)).bindings ?? {})) out.add(d?.asset ?? name); } catch { /* unreadable clip: its bindings stay unknown */ }
  }
  return [...out];
}

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const KIND_ICON: Record<string, string> = { video: "▭", image: "image", audio: "♫", html: "</>" };

export function CleanupDialog({ engine, project, blobs, onClose, onDone }: { engine: Engine; project: Project; blobs: BlobStore; onClose: () => void; onDone: (msg: string) => void }) {
  const [refs, setRefs] = useState<string[]>();
  const [sizes, setSizes] = useState<Record<string, number>>({});
  useEffect(() => { let live = true; void bindingRefsOf(project, blobs).then((r) => { if (live) setRefs(r); }); return () => { live = false; }; }, [project, blobs]);
  const plan = useMemo(() => (refs ? cleanup.cleanupPlan(project, refs) : undefined), [project, refs]);
  const [assets, setAssets] = useState<Set<string>>();
  const [versions, setVersions] = useState<Set<string>>(new Set());
  useEffect(() => { if (plan && !assets) setAssets(new Set(plan.unused.map((u) => u.assetId))); }, [plan, assets]);
  useEffect(() => {
    if (!plan) return;
    let live = true;
    const keys = [...plan.unused.flatMap((u) => u.blobKeys), ...plan.oldVersions.map((o) => o.blobKey)];
    void Promise.all(keys.map(async (k) => [k, (await blobs.get(k).catch(() => undefined))?.size ?? 0] as const)).then((e) => { if (live) setSizes(Object.fromEntries(e)); });
    return () => { live = false; };
  }, [plan, blobs]);
  if (!plan || !assets) return <div className="v2-cleanup" role="dialog" aria-label="Clean up project"><p className="v2-hint" role="status">Checking what the project uses…</p></div>;
  const sizeOfAsset = (u: cleanup.UnusedAsset) => u.blobKeys.reduce((s, k) => s + (sizes[k] ?? 0), 0);
  const freed = plan.unused.filter((u) => assets.has(u.assetId)).reduce((s, u) => s + sizeOfAsset(u), 0) + plan.oldVersions.filter((o) => versions.has(`${o.assetId}/${o.versionId}`)).reduce((s, o) => s + (sizes[o.blobKey] ?? 0), 0);
  const count = assets.size + versions.size;
  const toggle = (set: Set<string>, k: string, apply: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); apply(n); };
  const run = () => {
    const vs = plan.oldVersions.filter((o) => versions.has(`${o.assetId}/${o.versionId}`)).map((o) => ({ assetId: o.assetId, versionId: o.versionId }));
    if (engine.dispatch(cmd.cleanupProject([...assets], vs, refs ?? []))) onDone(`Removed ${assets.size} media and ${vs.length} old version${vs.length === 1 ? "" : "s"} (Undo to restore)`);
  };
  const empty = !plan.unused.length && !plan.oldVersions.length;
  return (
    <div className="v2-cleanup" role="dialog" aria-label="Clean up project" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <header className="v2-subimport-head">
        <button className="v2-icon-btn" aria-label="Cancel" title="Cancel (Esc)" onClick={onClose}><Ic g="✕" /></button>
        <h3>Clean up project</h3>
        <button className="v2-icon-btn" aria-label={`Remove ${count} item${count === 1 ? "" : "s"}`} title="Remove the checked items (one undo step)" disabled={!count} onClick={run}><Ic g="✓" /></button>
      </header>
      {empty ? <p className="v2-hint">Nothing to clean up: every media file and version is in use.</p> : (
        <div className="v2-cleanup-body">
          <section aria-label="Unused media">
            <h4>Unused media <small>{plan.unused.length}</small></h4>
            {!plan.unused.length ? <p className="v2-muted">All media is used on the timeline or the storyboard.</p> : plan.unused.map((u) => (
              <label key={u.assetId} className="v2-cleanup-row">
                <input type="checkbox" checked={assets.has(u.assetId)} onChange={() => toggle(assets, u.assetId, setAssets)} />
                <Ic g={KIND_ICON[u.kind] ?? "▭"} size={16} /><span className="v2-cleanup-name">{u.name}</span><small>{sizes[u.blobKeys[0]] !== undefined ? mb(sizeOfAsset(u)) : ""}</small>
              </label>
            ))}
          </section>
          <section aria-label="Old versions">
            <h4>Old versions <small>{plan.oldVersions.length}</small></h4>
            {!plan.oldVersions.length ? <p className="v2-muted">No old versions: each asset keeps only what is in use.</p> : plan.oldVersions.map((o) => (
              <label key={`${o.assetId}/${o.versionId}`} className="v2-cleanup-row">
                <input type="checkbox" checked={versions.has(`${o.assetId}/${o.versionId}`)} onChange={() => toggle(versions, `${o.assetId}/${o.versionId}`, setVersions)} />
                <Ic g="⎘" size={16} /><span className="v2-cleanup-name">{o.name} · v{o.index + 1}{o.createdAt ? ` · ${o.createdAt.slice(0, 10)}` : ""}</span><small>{sizes[o.blobKey] !== undefined ? mb(sizes[o.blobKey]) : ""}</small>
              </label>
            ))}
          </section>
        </div>
      )}
      <p className="v2-cleanup-foot" role="status">{count ? `${count} selected · frees about ${mb(freed)}` : "Nothing selected"} · Undo restores everything; files are freed after the next start.</p>
    </div>
  );
}

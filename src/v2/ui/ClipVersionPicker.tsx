/**
 * P58: pick which version of a shot this timeline clip shows, or follow the storyboard's current
 * version. Also used to delete a version (with a confirmation listing clips that will switch).
 */
import { useState } from "react";
import { clipVersion, findPlacement, type Project } from "../domain";
import { cmd, type Engine } from "../engine";

const root = (p: Project) => p.compositions[p.rootCompositionId];

export function VersionDeleteConfirm({ plan, versionLabel, fallbackLabel, onConfirm, onCancel }: {
  plan: Extract<ReturnType<typeof clipVersion.versionDeletePlan>, { ok: true }>;
  versionLabel: string;
  fallbackLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="v2-cver-confirm" role="alertdialog" aria-label="Delete version" data-testid="delete-version-confirm">
      <p><b>Delete {versionLabel}?</b></p>
      {plan.affected.length ? (
        <>
          <p>These clips use it and will switch to {fallbackLabel}:</p>
          <ul data-testid="delete-version-affected">
            {plan.affected.map((c) => (
              <li key={c.clipId}>{c.label}{c.pinned ? " (pinned)" : " (following)"} → {fallbackLabel}</li>
            ))}
          </ul>
        </>
      ) : <p>No timeline clips use this version.</p>}
      {plan.dropKeys.length > 0 && <p>The media file will be removed from the project (nothing else references it).</p>}
      <div className="v2-slip-actions">
        <button type="button" className="v2-btn danger" data-testid="delete-version-yes" onClick={onConfirm}>Delete version</button>
        <button type="button" className="v2-btn" data-testid="delete-version-no" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function ClipVersionPicker({ engine, project, clipId, onToast }: {
  engine: Engine; project: Project; clipId: string; onToast?: (message?: string) => void;
}) {
  const pl = findPlacement(root(project), clipId)?.placement;
  const asset = pl ? project.assets[pl.source.assetId] : undefined;
  const [ask, setAsk] = useState<{ versionId: string; plan: Extract<ReturnType<typeof clipVersion.versionDeletePlan>, { ok: true }> }>();
  if (!pl || !asset || !asset.versions.length) return null;
  const resolved = clipVersion.resolvedVersionId(project, pl);
  const labelOf = (id: string) => {
    const i = asset.versions.findIndex((v) => v.id === id);
    return i < 0 ? id : `Version ${i + 1}`;
  };
  const pick = (versionId: string | null) => {
    const ok = engine.dispatch(cmd.setClipVersion(clipId, versionId));
    onToast?.(ok ? (versionId ? `This clip now uses ${labelOf(versionId)}.` : "This clip follows the storyboard.") : "Couldn't change the clip version.");
  };
  const requestDelete = (versionId: string) => {
    const plan = clipVersion.versionDeletePlan(project, asset.id, versionId);
    if (!plan.ok) { onToast?.(plan.error); return; }
    setAsk({ versionId, plan });
  };
  const confirmDelete = () => {
    if (!ask) return;
    const ok = engine.dispatch(cmd.deleteAssetVersion(asset.id, ask.versionId));
    setAsk(undefined);
    onToast?.(ok ? `${labelOf(ask.versionId)} deleted.` : "Couldn't delete the version.");
  };
  return (
    <div className="v2-cver" data-testid="clip-version-picker">
      {resolved.stalePin && <p className="v2-cver-warn" role="status">This clip was pinned to a version that no longer exists; it now follows the current version.</p>}
      <button type="button" className={`v2-btn v2-cver-item ${!pl.versionId ? "is-on" : ""}`} data-testid="clip-version-follow" aria-pressed={!pl.versionId} onClick={() => pick(null)}>Follow storyboard</button>
      {asset.versions.map((v, i) => {
        const pinnedHere = pl.versionId === v.id;
        const showing = resolved.versionId === v.id;
        return (
          <div key={v.id} className="v2-cver-row">
            <button type="button" className={`v2-btn v2-cver-item ${pinnedHere ? "is-on" : ""}`} aria-pressed={pinnedHere} data-testid={`clip-version-${v.id}`} onClick={() => pick(v.id)}>
              Version {i + 1}{v.id === asset.selectedVersionId ? " · current" : ""}{pinnedHere ? " · this clip" : showing && !pl.versionId ? " · showing" : ""}
            </button>
            <button type="button" className="v2-btn v2-cver-del" data-testid={`clip-version-delete-${v.id}`} disabled={asset.versions.length <= 1}
              aria-label={`Delete version ${i + 1}`} title={asset.versions.length <= 1 ? "Cannot delete the last remaining version" : `Delete version ${i + 1}`}
              onClick={() => requestDelete(v.id)}>Delete</button>
          </div>
        );
      })}
      {ask && (
        <VersionDeleteConfirm
          plan={ask.plan}
          versionLabel={labelOf(ask.versionId)}
          fallbackLabel={labelOf(ask.plan.fallbackId)}
          onConfirm={confirmDelete}
          onCancel={() => setAsk(undefined)}
        />
      )}
    </div>
  );
}

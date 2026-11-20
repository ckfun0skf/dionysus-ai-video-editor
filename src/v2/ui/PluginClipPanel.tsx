import { useSyncExternalStore } from "react";
import type { Placement, Project } from "../domain";
import { isPluginEnabled, pluginMetaOf, pluginParamsOf, pluginIssueOf } from "../clipTypes";
import { pluginStatus } from "../render";
import { Ic } from "./Icon";

const shortHash = (h: string) => `${h.replace(/^sha256-/, "").slice(0, 12)}…`;
const shown = (v: number | string | boolean) => (typeof v === "boolean" ? (v ? "On" : "Off") : v === "" ? "—" : String(v));

/**
 * P84 (Phase 3 step 3.2): the inspector's Plugin tab for a clip of a registered third-party plugin type: what the
 * plugin is (name, version, unverified publisher, content hash), that it isn't enabled yet, and the clip's settings
 * (read-only until the editor form in P87). Nothing here runs plugin code.
 */
export function PluginClipPanel({ project, placement, onRetry, onReview }: {
  project: Project; placement: Placement;
  /** P86: start a stopped clip again. */ onRetry?: (placementId: string) => void;
  /** P86: review and allow the plugin (Not enabled). */ onReview?: (clipType: string) => void;
}) {
  useSyncExternalStore(pluginStatus.subscribe, pluginStatus.revision);
  const meta = pluginMetaOf(placement.clipType);
  if (!meta) return null;
  const values = pluginParamsOf(meta, placement);
  const grouped = new Set(meta.editor?.groups.flatMap((g) => g.fields) ?? []);
  const groups = [...(meta.editor?.groups ?? []), ...(Object.keys(meta.params).some((k) => !grouped.has(k)) ? [{ label: meta.editor ? "More" : "Settings", fields: Object.keys(meta.params).filter((k) => !grouped.has(k)) }] : [])];
  const lock = project.plugins?.[placement.clipType];
  const stop = isPluginEnabled(placement.clipType) ? pluginStatus.stopped(placement.id) : undefined;
  return (
    <div className="v2-psettings v2-plugin-panel" data-testid="plugin-clip">
      <section aria-label="Plugin">
        <h4><Ic g="puzzle" size={14} /> {meta.name}</h4>
        {stop
          ? <div className="v2-plugin-state is-stopped" role="status">
              <p><span className="v2-ph-state is-stopped">Stopped</span> The plugin hung or failed several times, so this clip shows a slate and exports as black frames.{stop.reason ? <> Last problem: {stop.reason}</> : null}</p>
              {onRetry && <button className="v2-btn v2-plugin-act" data-testid="plugin-retry" title="Start this clip's plugin again" onClick={() => onRetry(placement.id)}><Ic g="regen" size={16} /> Retry</button>}
            </div>
          : isPluginEnabled(placement.clipType)
          ? <p className="v2-plugin-state" role="status"><span className="v2-ph-state is-on">Enabled</span> Allowed in this project on this device. It draws in a sandbox from its settings and can&apos;t use the network or read your projects or files.</p>
          : <div className="v2-plugin-state" role="status">
              <p><span className="v2-ph-state">Not enabled</span> This plugin hasn&apos;t been allowed to run in this project on this device, so the clip shows a slate and exports as a black frame. Its settings are kept.</p>
              {onReview && <button className="v2-btn primary v2-plugin-act" data-testid="plugin-review" title="See what the plugin is and allow it in this project" onClick={() => onReview(placement.clipType)}><Ic g="shield" size={16} /> Review and allow</button>}
            </div>}
        {meta.description && <p className="v2-abnote">{meta.description}</p>}
        <dl className="v2-plugin-facts">
          <div><dt>Version</dt><dd>{meta.version}</dd></div>
          <div><dt>Publisher</dt><dd>{meta.publisher ? <>{meta.publisher} <span className="v2-plugin-unverified">unverified</span></> : "—"}</dd></div>
          <div><dt>Type id</dt><dd><code>{placement.clipType}</code></dd></div>
          <div><dt>Package</dt><dd><code title={meta.hash}>{shortHash(meta.hash)}</code>{lock && lock.version !== meta.version ? ` (locked ${lock.version})` : ""}</dd></div>
        </dl>
      </section>
      {groups.length > 0 && groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h4>{g.label}</h4>
          <dl className="v2-plugin-facts">
            {g.fields.filter((k) => k in meta.params).map((k) => (
              <div key={k}><dt>{meta.params[k].label ?? k}</dt><dd>{meta.params[k].type === "color" ? <><span className="v2-plugin-swatch" style={{ background: String(values[k]) }} />{shown(values[k])}</> : shown(values[k])}</dd></div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** P84: the Unknown tab's text for a plugin id the project can't load (missing, damaged, newer, not locked). */
export function unknownPluginNote(clipType: string): string {
  const i = pluginIssueOf(clipType);
  const keep = "Its settings are kept as is: you can move, trim, split or delete it. It shows as a slate and exports as a black frame.";
  if (!i) return `This project doesn't include the plugin “${clipType}”, so this clip can't be shown or edited here. ${keep}`;
  return `${i.message} ${keep}`;
}

import { useSyncExternalStore } from "react";
import type { Placement, Project } from "../domain";
import { isPluginEnabled, pluginMetaOf, pluginParamsOf, pluginIssueOf } from "../clipTypes";
import { pluginStatus } from "../render";
import { cmd, type Engine } from "../engine";
import { Ic, pluginIconKey } from "./Icon";
import { ParamControls } from "./ParamControls";
import { htmlParamSpecs } from "./HtmlParamsPanel";

const shortHash = (h: string) => `${h.replace(/^sha256-/, "").slice(0, 12)}…`;
const shown = (v: number | string | boolean) => (typeof v === "boolean" ? (v ? "On" : "Off") : v === "" ? "—" : String(v));

/**
 * The inspector's Plugin tab (and the phone's Params and Plugin sheets) for a clip of a registered third-party plugin
 * type. P84: what the plugin is (name, version, unverified publisher, content hash) and its state. P87: the clip's
 * settings as a form built from the manifest's declarative `editor` groups with the shared ParamControls (params in no
 * group under "More"); a slider drag or a typing session is one undo step, a switch or a pick is one, and the preview
 * redraws while editing. "Update available" when the device has a newer version. Nothing here runs plugin code.
 *
 * `part`: "params" = the form only (phone Params sheet), "details" = state and details only, "all" = both (inspector).
 */
export function PluginClipPanel({ project, placement, engine, part = "all", onRetry, onReview, updateTo, onUpdate }: {
  project: Project; placement: Placement;
  /** P87: edits go through the engine; without one the settings are read-only. */ engine?: Engine;
  part?: "all" | "params" | "details";
  /** P86: start a stopped clip again. */ onRetry?: (placementId: string) => void;
  /** P86: review and allow the plugin (Not enabled). */ onReview?: (clipType: string) => void;
  /** P87: a newer version on this device, and the action that asks to update the project to it. */ updateTo?: string; onUpdate?: (clipType: string) => void;
}) {
  useSyncExternalStore(pluginStatus.subscribe, pluginStatus.revision);
  const meta = pluginMetaOf(placement.clipType);
  if (!meta) return null;
  const values = pluginParamsOf(meta, placement);
  const grouped = new Set(meta.editor?.groups.flatMap((g) => g.fields) ?? []);
  const groups = [...(meta.editor?.groups ?? []), ...(Object.keys(meta.params).some((k) => !grouped.has(k)) ? [{ label: meta.editor ? "More" : "Settings", fields: Object.keys(meta.params).filter((k) => !grouped.has(k)) }] : [])];
  const specs = htmlParamSpecs(meta.params);
  const lock = project.plugins?.[placement.clipType];
  const enabled = isPluginEnabled(placement.clipType);
  const stop = enabled ? pluginStatus.stopped(placement.id) : undefined;
  const stored = placement.plugin?.data?.params ?? {};
  const changed = Object.keys(stored).some((k) => k in meta.params);
  const set = (key: string, value: number | string | boolean) =>
    engine?.dispatch(cmd.setPluginParams(placement.id, { [key]: value }, meta.version, `${meta.name}: ${meta.params[key]?.label ?? key}`));

  const status = stop
    ? <div className="v2-plugin-state is-stopped" role="status">
        <p><span className="v2-ph-state is-stopped">Stopped</span> The plugin hung or failed several times, so this clip shows a slate and exports as black frames.{stop.reason ? <> Last problem: {stop.reason}</> : null}</p>
        {onRetry && <button className="v2-btn v2-plugin-act" data-testid="plugin-retry" title="Start this clip's plugin again" onClick={() => onRetry(placement.id)}><Ic g="regen" size={16} /> Retry</button>}
      </div>
    : enabled
    ? <p className="v2-plugin-state" role="status"><span className="v2-ph-state is-on">Enabled</span> Allowed in this project on this device. It draws in a sandbox from its settings and can&apos;t use the network or read your projects or files.</p>
    : <div className="v2-plugin-state" role="status">
        <p><span className="v2-ph-state">Not enabled</span> This plugin hasn&apos;t been allowed to run in this project on this device, so the clip shows a slate and exports as a black frame. Its settings are kept.</p>
        {onReview && <button className="v2-btn primary v2-plugin-act" data-testid="plugin-review" title="See what the plugin is and allow it in this project" onClick={() => onReview(placement.clipType)}><Ic g="shield" size={16} /> Review and allow</button>}
      </div>;
  const update = updateTo && onUpdate && (
    <div className="v2-plugin-update" role="status">
      <p><Ic g="plugin-update" size={16} /> <span>Update available: <b>{updateTo}</b> (this project uses {meta.version}).</span></p>
      <button className="v2-btn v2-plugin-act" data-testid="plugin-update-clip" title="See what changes and update this project's clips (Undo reverts it)" onClick={() => onUpdate(placement.clipType)}>Update…</button>
    </div>
  );
  const form = groups.map((g) => {
    const fields = g.fields.filter((k) => k in meta.params);
    if (!fields.length) return null;
    return (
      <section key={g.label} aria-label={g.label} className="v2-plugin-group">
        <h4>{g.label}</h4>
        {engine
          ? <ParamControls name={meta.name} params={fields.map((k) => specs.find((x) => x.key === k)!).filter(Boolean)} values={values}
              onBegin={() => engine.beginGesture()} onEnd={() => engine.endGesture()} onChange={(k, v) => set(k, v)} />
          : <dl className="v2-plugin-facts">
              {fields.map((k) => (
                <div key={k}><dt>{meta.params[k].label ?? k}</dt><dd>{meta.params[k].type === "color" ? <><span className="v2-plugin-swatch" style={{ background: String(values[k]) }} />{shown(values[k])}</> : shown(values[k])}</dd></div>
              ))}
            </dl>}
      </section>
    );
  });
  const params = (
    <div className="v2-plugin-form" data-testid="plugin-params">
      {groups.length === 0 && <p className="v2-hint">This plugin has no settings.</p>}
      {form}
      {engine && groups.length > 0 && (
        <div className="v2-hp-actions">
          <button className="v2-btn" disabled={!changed} title="Back to the plugin's defaults (one undo step)" onClick={() => engine.dispatch(cmd.setPluginParams(placement.id, undefined, meta.version), `${meta.name}: reset settings`)}><Ic g="↶" size={14} /> Reset to defaults</button>
        </div>
      )}
    </div>
  );
  const details = (
    <>
      {meta.description && <p className="v2-abnote">{meta.description}</p>}
      <dl className="v2-plugin-facts">
        <div><dt>Version</dt><dd>{meta.version}</dd></div>
        <div><dt>Publisher</dt><dd>{meta.publisher ? <>{meta.publisher} <span className="v2-plugin-unverified">unverified</span></> : "—"}</dd></div>
        <div><dt>Type id</dt><dd><code>{placement.clipType}</code></dd></div>
        <div><dt>Package</dt><dd><code title={meta.hash}>{shortHash(meta.hash)}</code>{lock && lock.version !== meta.version ? ` (locked ${lock.version})` : ""}</dd></div>
      </dl>
    </>
  );
  const title = <h4 className="v2-plugin-title"><Ic g={pluginIconKey(meta.icon)} size={16} /> {meta.name} <small>{meta.version}</small></h4>;
  return (
    <div className="v2-psettings v2-plugin-panel" data-testid="plugin-clip">
      {part === "params" ? (
        <>
          {(stop || !enabled) && status}
          {params}
        </>
      ) : (
        <>
          <section aria-label="Plugin">
            {title}
            {status}
            {update}
          </section>
          {part === "all" && params}
          <section aria-label="About this plugin" className="v2-plugin-about">
            {part === "all" && <h4>About this plugin</h4>}
            {details}
          </section>
        </>
      )}
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

/**
 * P86 (Phase 3 step 3.4): the plugin screens. One hook, `usePluginCenter`, owns the flows and returns the pieces the
 * editor places: the desktop rail's Plugins tab (tiles: click to add at the playhead, drag onto a track), the phone Add
 * media sheet's Plugins tab, the Project → Plugins list, the review banner and one overlay (the add-from dialog, the
 * consent dialog, the manage list and the remove confirmation; a modal at 1440, a bottom sheet at 390).
 * P87: "Update available" on rows and tiles, a Versions list per project plugin, and the consent dialog for a version
 * switch (update or downgrade) with what happens to the clips' settings.
 * Logic: ui/pluginManager.ts. Nothing here runs plugin code.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { comparePluginVersions, newId, type Project } from "../domain";
import type { Engine } from "../engine";
import type { BlobStore } from "../ports";
import { CLIP_LIBRARIES } from "../render";
import type { PluginPackage } from "../persistence";
import { Ic, pluginIconKey } from "./Icon";
import { Sheet } from "./Sheet";
import { setDragItem } from "./desktop/dnd";
import {
  PLUGIN_SAMPLES, addPluginClipAt, deleteFromDevice, installPlugin, libraryPluginPackage, pluginErrorText, pluginFacts, pluginRows, pluginSampleUrl, pluginSize,
  pluginSourceText, pluginSwitchPreview, pluginsToReview, projectPluginPackage, readPluginFrom, removePluginFromProject, shortPluginHash, usePluginLibraryItems,
  type PluginFacts, type PluginRow,
} from "./pluginManager";

type Where = "main" | "overlay" | { trackId: string };
type ClipAt = { at: number; where?: Where };
/** `back`: where Cancel / Esc go; `done`: where the dialog goes after it did its job (undefined = closed). */
type Switch = NonNullable<ReturnType<typeof pluginSwitchPreview>>;
type Consent = { facts: PluginFacts; pkg: PluginPackage; source: string; mode: "install" | "add" | "allow" | "switch"; sw?: Switch; clipAt?: ClipAt; back?: Dialog; done?: Dialog; busy?: boolean; error?: string };
type Dialog =
  | { kind: "add"; busy?: string; error?: string; back?: Dialog; clipAt?: ClipAt }
  | { kind: "consent"; c: Consent }
  | { kind: "manage" }
  | { kind: "remove"; row: PluginRow; back?: Dialog }
  | { kind: "versions"; id: string; back?: Dialog };
const MANAGE: Dialog = { kind: "manage" };

export interface PluginCenterOptions {
  engine: Engine;
  project: Project;
  blobs: BlobStore;
  mobile: boolean;
  /** Registry revision (re-derives the rows when plugins load or get enabled). */
  revision: number;
  /** Playhead in ticks, for "add at the playhead". */
  playhead: () => number;
  /** A clip was added (select it). */
  onAdded: (placementId: string) => void;
  onToast: (message: string, undo?: boolean) => void;
}

const libName = (id: string) => { const l = CLIP_LIBRARIES.find((x) => x.id === id); return l ? `${l.name} ${l.version}` : id; };
const STATE_TEXT: Record<PluginRow["state"], string> = {
  enabled: "Enabled", review: "Not enabled", missing: "Missing", damaged: "Damaged", newer: "Needs a newer Dionysus", conflict: "Can't load", device: "On this device",
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function usePluginCenter(o: PluginCenterOptions) {
  const library = usePluginLibraryItems();
  const rows = useMemo(() => pluginRows(o.project, library), [o.project, library, o.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dialog, setDialog] = useState<Dialog>();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const ctx = { engine: o.engine, blobs: o.blobs };
  const now = () => Math.round(o.playhead());
  const close = () => setDialog(undefined);
  const back = (to?: Dialog) => setDialog(to);

  const openConsent = async (row: PluginRow, clipAt?: ClipAt, from?: Dialog) => {
    try {
      const pkg = row.inProject ? await projectPluginPackage(o.engine.getState().project, row.id, o.blobs) : await libraryPluginPackage(row.hash);
      const source = row.inProject ? "project" : library.find((e) => e.hash === row.hash)?.source ?? "project";
      setDialog({ kind: "consent", c: { facts: pluginFacts(pkg, source), pkg, source, mode: row.inProject ? "allow" : "add", clipAt, back: from, done: from } });
    } catch (e) { o.onToast(pluginErrorText(e)); }
  };

  /** P87: switch a project plugin to the device's version `hash` (update or downgrade), after the consent dialog. */
  const openSwitch = async (id: string, hash: string, from?: Dialog) => {
    try {
      const pkg = await libraryPluginPackage(hash);
      const source = library.find((e) => e.hash === hash)?.source ?? "project";
      const sw = pluginSwitchPreview(o.engine.getState().project, pkg);
      if (!sw || pkg.manifest.id !== id) { o.onToast("That version can't be used in this project."); return; }
      setDialog({ kind: "consent", c: { facts: pluginFacts(pkg, source), pkg, source, mode: "switch", sw, back: from, done: from } });
    } catch (e) { o.onToast(pluginErrorText(e)); }
  };

  /** Click or tap on a tile, or a drop at `at`: add a clip, or ask first. */
  const activate = (row: PluginRow, clipAt: ClipAt = { at: now() }) => {
    if (row.inProject && row.state === "enabled") {
      const id = addPluginClipAt(o.engine, row.id, clipAt.at, clipAt.where);
      if (id) o.onAdded(id); else o.onToast(`Couldn't add a “${row.name}” clip here.`);
      return;
    }
    if (row.inProject && row.state !== "review") { o.onToast(row.message ?? `“${row.name}” can't be used here.`); return; }
    void openConsent(row, clipAt);
  };

  const pickSource = async (from: { file: File } | { url: string }, back?: Dialog, clipAt?: ClipAt) => {
    setDialog({ kind: "add", busy: "file" in from ? `Reading ${from.file.name}…` : "Downloading…", back, clipAt });
    try {
      const { pkg, source } = await readPluginFrom(from);
      const sw = pluginSwitchPreview(o.engine.getState().project, pkg);
      setDialog({ kind: "consent", c: { facts: pluginFacts(pkg, source), pkg, source, mode: sw ? "switch" : "install", sw, clipAt, back: { kind: "add", back, clipAt }, done: back } });
    } catch (e) { setDialog({ kind: "add", error: pluginErrorText(e), back, clipAt }); }
  };

  const confirm = async (c: Consent) => {
    setDialog({ kind: "consent", c: { ...c, busy: true, error: undefined } });
    try {
      const { clipId, switched } = await installPlugin(ctx, c.pkg, c.source, c.clipAt ? { ...c.clipAt, id: newId("plc") } : undefined);
      setDialog(c.done);
      if (clipId) o.onAdded(clipId);
      const lost = switched ? switched.changes.filter((x) => x.reason !== "clamped").length : 0, clamped = switched ? switched.changes.length - lost : 0;
      o.onToast(switched
        ? `${switched.kind === "update" ? "Updated" : "Switched"} “${c.facts.name}” to ${switched.to}${lost ? ` · ${plural(lost, "setting")} dropped` : ""}${clamped ? ` · ${plural(clamped, "value")} adjusted` : ""}`
        : c.mode === "allow" ? `“${c.facts.name}” is enabled in this project` : clipId ? `Added “${c.facts.name}” and a clip at the playhead` : `“${c.facts.name}” is installed. Add clips from its tile in Plugins`, c.mode !== "allow");
    } catch (e) { setDialog({ kind: "consent", c: { ...c, busy: false, error: pluginErrorText(e) } }); }
  };

  const remove = (row: PluginRow, withClips: boolean, from?: Dialog) => {
    if (removePluginFromProject(o.engine, row.id, withClips)) o.onToast(withClips ? `Removed “${row.name}” and ${plural(row.clips, "clip")}` : `Removed “${row.name}” from this project`, true);
    setDialog(from);
  };
  const askRemove = (row: PluginRow, from?: Dialog) => (row.clips ? setDialog({ kind: "remove", row, back: from }) : remove(row, false, from));

  // Esc closes (or goes back from) the open dialog, wherever the focus is.
  useEffect(() => {
    if (!dialog) return;
    const to: Dialog | undefined = dialog.kind === "consent" ? dialog.c.back : dialog.kind === "add" || dialog.kind === "remove" || dialog.kind === "versions" ? dialog.back : undefined;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(dialog.kind === "consent" && dialog.c.busy)) { e.stopPropagation(); back(to); } };
    addEventListener("keydown", k, true);
    return () => removeEventListener("keydown", k, true);
  }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps

  const review = pluginsToReview(rows);
  const pid = o.project.id;
  const banner = review.length && !dismissed.has(pid) ? (
    <div className="v2-pl-banner" role="status" data-testid="plugin-banner">
      <Ic g="shield" size={18} />
      <span>{review.length === 1 ? <>This project uses <b>{review[0].name}</b>, a plugin that isn&apos;t enabled on this device</> : <>This project uses {review.length} plugins that aren&apos;t enabled on this device</>}</span>
      <button className="v2-btn primary" onClick={() => (review.length === 1 ? void openConsent(review[0]) : setDialog(MANAGE))}>Review</button>
      <button className="v2-icon-btn" aria-label="Hide this notice" title="Hide (the plugins stay off until you allow them)" onClick={() => setDismissed((s) => new Set(s).add(pid))}><Ic g="✕" size={18} /></button>
    </div>
  ) : null;

  /** Desktop rail tab body. */
  const browserTab = (
    <>
      <div className="v2-abhead"><strong>Plugins</strong><button className="v2-btn primary" title="Install a plugin from a .dionysus-cliptype.zip file or a web address" onClick={() => setDialog({ kind: "add" })}><Ic g="plugin-add" size={16} /> Add plugin</button></div>
      <PluginTiles rows={rows} onActivate={(r) => activate(r)} onRemove={(r) => askRemove(r)} onManage={() => setDialog(MANAGE)} />
    </>
  );

  /** Phone Add media → Plugins tab body (a tap adds at the playhead, then `done` closes the picker). */
  const pickerTab = (done: () => void) => (
    <>
      <div className="v2-pick-actions">
        <button className="v2-pick-action" onClick={() => { done(); setDialog({ kind: "add", clipAt: { at: now() } }); }}>
          <span className="v2-pick-action-ic"><Ic g="plugin-add" size={22} /></span>
          <span><b>Add plugin</b><small>A .dionysus-cliptype.zip file or a web address</small></span>
        </button>
      </div>
      <h4 className="v2-pick-section">Plugins</h4>
      {rows.length === 0 ? <p className="v2-muted v2-picker-empty">No plugins yet. Add one, or try a sample.</p> : (
        <div className="v2-picker-grid v2-pl-pick" data-testid="plugin-picker">
          {rows.map((r) => (
            <button key={r.hash} className={`v2-pick-tile v2-pl-ptile is-${r.state}`} aria-label={`${r.name}: ${STATE_TEXT[r.state]}`} title={r.description ?? r.name} onClick={() => { done(); activate(r); }}>
              <b aria-hidden><Ic g={pluginIconKey(r.icon)} size={26} /></b>
              {r.state !== "enabled" && <i className="v2-pl-pstate">{STATE_TEXT[r.state]}</i>}
              <span className="v2-pick-name">{r.name}</span>
            </button>
          ))}
        </div>
      )}
      <p className="v2-muted v2-pick-note">Plugins draw a picture from their settings on a layer above, at the playhead. Manage them in Project → Plugins.</p>
    </>
  );

  /** Phone Project sheet / desktop manage dialog: one list for the project and the device. */
  const manageList = (from?: Dialog) => (
    <PluginManageList rows={rows} onAdd={() => setDialog({ kind: "add", back: from })} onAllow={(r) => void openConsent(r, undefined, from)}
      onUpdate={(r) => r.update && void openSwitch(r.id, r.update.hash, from)} onVersions={(r) => setDialog({ kind: "versions", id: r.id, back: from })}
      onAddToProject={(r) => void openConsent(r, undefined, from)} onRemove={(r) => askRemove(r, from)}
      onDelete={(r) => void deleteFromDevice(r.hash).then(() => o.onToast(`Deleted “${r.name}” from this device`), (e) => o.onToast(pluginErrorText(e)))} />
  );

  const frame = (label: string, body: ReactNode, onClose: () => void, cls = "") => o.mobile
    ? <Sheet label={label} className={`v2-msheet-insp v2-pl-sheet ${cls}`} snaps={[0.55, 0.9]} initial={1} onClose={onClose}>{body}</Sheet>
    : <div className="v2-modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className={`v2-pl-dialog ${cls}`} role="dialog" aria-modal="true" aria-label={label} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
          <header className="v2-pl-dhead"><h3>{label}</h3><button className="v2-icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><Ic g="✕" /></button></header>
          {body}
        </div>
      </div>;

  let overlay: ReactNode = null;
  if (dialog?.kind === "add") overlay = frame("Add plugin", <PluginAddSource busy={dialog.busy} error={dialog.error} installed={new Set(rows.filter((r) => r.inProject).map((r) => r.id))} onFile={(f) => void pickSource({ file: f }, dialog.back, dialog.clipAt)} onUrl={(u) => void pickSource({ url: u }, dialog.back, dialog.clipAt)} onCancel={() => back(dialog.back)} />, () => back(dialog.back), "is-add");
  else if (dialog?.kind === "versions") {
    const r = rows.find((x) => x.id === dialog.id && x.inProject), d = dialog;
    overlay = r ? frame(`“${r.name}” versions`, <PluginVersions row={r} onPick={(h) => void openSwitch(r.id, h, d)} onClose={() => back(d.back)} />, () => back(d.back), "is-versions") : null;
  }
  else if (dialog?.kind === "consent") { const c = dialog.c; overlay = frame(c.mode === "switch" ? (c.sw?.kind === "update" ? "Update plugin" : "Use an older version") : c.mode === "install" ? "Install plugin" : c.mode === "add" ? "Add plugin to project" : "Allow plugin", <PluginConsent c={c} onCancel={() => back(c.back)} onConfirm={() => void confirm(c)} />, () => back(c.back), "is-consent"); }
  else if (dialog?.kind === "manage") overlay = frame("Plugins", manageList(MANAGE), close, "is-manage");
  else if (dialog?.kind === "remove") { const r = dialog.row; overlay = frame(`Remove “${r.name}”?`, (
    <div className="v2-pl-body">
      <p>{plural(r.clips, "clip")} in this project use{r.clips === 1 ? "s" : ""} it. Undo brings everything back.</p>
      <div className="v2-pl-actions is-stack">
        <button className="v2-btn" onClick={() => remove(r, false, dialog.back)}><Ic g="puzzle" size={16} /> Remove the plugin, keep the clips<small>They keep their settings and show a slate until you add it again</small></button>
        <button className="v2-btn is-danger" onClick={() => remove(r, true, dialog.back)}><Ic g="🗑" size={16} /> Remove the plugin and {plural(r.clips, "clip")}</button>
        <button className="v2-btn" onClick={() => back(dialog.back)}>Cancel</button>
      </div>
    </div>
  ), () => back(dialog.back), "is-remove"); }

  return {
    rows, banner, browserTab, pickerTab, overlay,
    manageList: () => manageList(),
    openManage: () => setDialog(MANAGE),
    openAdd: () => setDialog({ kind: "add" }),
    /** P87: update a project plugin to the newest version on this device (the inspector's Update available). */
    update: (id: string) => { const r = rows.find((x) => x.id === id && x.inProject); if (r?.update) void openSwitch(id, r.update.hash); },
    /** Review one plugin (the inspector's Not enabled state). */
    review: (id: string) => { const r = rows.find((x) => x.id === id); if (r) void openConsent(r); },
    /** A plugin tile dropped on the timeline. */
    dropAt: (id: string, hash: string, at: number, trackId?: string) => { const r = rows.find((x) => x.id === id && x.hash === hash) ?? rows.find((x) => x.id === id); if (r) activate(r, { at, ...(trackId ? { where: { trackId } } : {}) }); },
  };
}

function PluginTiles({ rows, onActivate, onRemove, onManage }: { rows: PluginRow[]; onActivate: (r: PluginRow) => void; onRemove: (r: PluginRow) => void; onManage: () => void }) {
  const inProject = rows.filter((r) => r.inProject), device = rows.filter((r) => !r.inProject);
  const tile = (r: PluginRow) => (
    <li key={r.hash} className={`v2-tile v2-pl-tile is-${r.state}`} draggable onDragStart={(e) => setDragItem(e.dataTransfer, { kind: "plugin", id: r.id, hash: r.hash })}>
      <button className="v2-tile-main" aria-label={r.state === "enabled" ? `Add ${r.name} clip` : `${r.name}: ${STATE_TEXT[r.state]}`}
        title={r.state === "enabled" ? `${r.name} — click to add at the playhead, or drag onto a track` : r.state === "device" ? `${r.name} — add it to this project (asks first)` : r.state === "review" ? `${r.name} — not enabled on this device: review and allow it` : r.message ?? r.name}
        onClick={() => onActivate(r)}>
        <span className="v2-tile-thumb v2-pl-thumb">
          <Ic g={pluginIconKey(r.icon)} size={26} />
          {r.state !== "enabled" ? <em className="v2-pl-state">{STATE_TEXT[r.state]}</em> : r.update && <em className="v2-pl-state is-update" title={`Version ${r.update.version} is on this device: update it in Manage plugins`}>Update</em>}
          <span className="v2-tile-add" aria-hidden><Ic g={r.state === "enabled" ? "＋" : r.state === "review" ? "shield" : r.state === "device" ? "＋" : "⚠"} size={16} /></span>
        </span>
        <span className="v2-tile-name">{r.name}<small> {r.version}</small></span>
      </button>
      {r.inProject && <button className="v2-tile-del" aria-label={`Remove ${r.name} from this project`} title="Remove from this project (Undo restores it)" onClick={() => onRemove(r)}><Ic g="✕" size={14} /></button>}
    </li>
  );
  return (
    <>
      {inProject.length > 0 && <ul className="v2-tiles v2-pl-tiles" aria-label="Plugins in this project">{inProject.map(tile)}</ul>}
      {device.length > 0 && <><div className="v2-abhead"><strong>On this device</strong></div><ul className="v2-tiles v2-pl-tiles" aria-label="Plugins on this device">{device.map(tile)}</ul></>}
      {rows.length === 0 && <p className="v2-abnote">No plugins yet. A plugin adds a new kind of clip: install one from a file or a web address, or try a sample under Add plugin.</p>}
      {rows.length > 0 && <button className="v2-btn v2-wide" onClick={onManage}><Ic g="settings" size={16} /> Manage plugins</button>}
      <p className="v2-abnote">Plugins are made by other people. Each one draws in a sandbox and can&apos;t use the network or read your projects or files.</p>
    </>
  );
}

function PluginManageList({ rows, onAdd, onAllow, onAddToProject, onRemove, onDelete, onUpdate, onVersions }: {
  rows: PluginRow[]; onAdd: () => void; onAllow: (r: PluginRow) => void; onAddToProject: (r: PluginRow) => void; onRemove: (r: PluginRow) => void; onDelete: (r: PluginRow) => void;
  onUpdate: (r: PluginRow) => void; onVersions: (r: PluginRow) => void;
}) {
  const [confirmDel, setConfirmDel] = useState<string>();
  const row = (r: PluginRow) => (
    <li key={r.hash} className={`v2-pl-row is-${r.state}`}>
      <span className="v2-pl-ic" aria-hidden><Ic g={pluginIconKey(r.icon)} size={22} /></span>
      <span className="v2-pl-main">
        <b>{r.name} <small>{r.version}</small></b>
        <span className="v2-pl-sub"><span className={`v2-ph-state ${r.state === "enabled" ? "is-on" : ""}`}>{STATE_TEXT[r.state]}</span>{r.inProject ? ` ${plural(r.clips, "clip")}` : r.publisher ? ` by ${r.publisher}` : ""}</span>
        {r.message && r.state !== "review" && <span className="v2-pl-msg">{r.message}</span>}
        {r.inProject && r.update && <span className="v2-pl-upd"><Ic g="plugin-update" size={14} /> Update available: {r.update.version}</span>}
      </span>
      <span className="v2-pl-rowacts">
        {r.state === "review" && <button className="v2-btn primary" onClick={() => onAllow(r)}><Ic g="shield" size={16} /> Review</button>}
        {r.state === "device" && <button className="v2-btn" onClick={() => onAddToProject(r)}><Ic g="＋" size={16} /> Add</button>}
        {r.inProject && r.update && r.state !== "review" && <button className="v2-btn primary" data-testid="plugin-update" title={`Update this project to ${r.update.version} (asks first; Undo reverts it)`} onClick={() => onUpdate(r)}>Update</button>}
        {r.inProject && r.versions.length > 0 && <button className="v2-icon-btn" aria-label={`Versions of ${r.name}`} title="Other versions on this device" onClick={() => onVersions(r)}><Ic g="history" size={18} /></button>}
        {r.inProject && <button className="v2-icon-btn" aria-label={`Remove ${r.name} from this project`} title="Remove from this project (Undo restores it)" onClick={() => onRemove(r)}><Ic g="🗑" size={18} /></button>}
        {!r.inProject && (confirmDel === r.hash
          ? <button className="v2-btn is-danger" onClick={() => { setConfirmDel(undefined); onDelete(r); }}>Delete</button>
          : <button className="v2-icon-btn" aria-label={`Delete ${r.name} from this device`} title="Delete from this device (projects that use it keep their copy)" onClick={() => setConfirmDel(r.hash)}><Ic g="🗑" size={18} /></button>)}
      </span>
    </li>
  );
  const inProject = rows.filter((r) => r.inProject), device = rows.filter((r) => !r.inProject);
  return (
    <div className="v2-pl-body v2-pl-manage" data-testid="plugin-manage">
      <button className="v2-btn primary v2-pl-addbtn" onClick={onAdd}><Ic g="plugin-add" size={18} /> Add plugin</button>
      <h4>In this project</h4>
      {inProject.length ? <ul className="v2-pl-list">{inProject.map(row)}</ul> : <p className="v2-abnote">This project uses no plugins.</p>}
      {device.length > 0 && <><h4>On this device</h4><ul className="v2-pl-list">{device.map(row)}</ul></>}
      <p className="v2-abnote">A plugin runs only in projects where you allowed it, on this device. Removing it from a project keeps its clips&apos; settings; Undo brings it back.</p>
    </div>
  );
}

function PluginAddSource({ busy, error, installed, onFile, onUrl, onCancel }: { busy?: string; error?: string; installed: Set<string>; onFile: (f: File) => void; onUrl: (u: string) => void; onCancel: () => void }) {
  const [url, setUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!busy && !("ontouchstart" in globalThis)) urlRef.current?.focus(); }, [busy]);
  return (
    <div className="v2-pl-body v2-pl-add">
      <p className="v2-abnote">A plugin adds a new kind of clip. It comes as a <code>.dionysus-cliptype.zip</code> file or a web address of its <code>manifest.json</code>. You&apos;ll see what it is and what it can do before it&apos;s installed.</p>
      <button className="v2-btn v2-pl-src" disabled={!!busy} onClick={() => input.current?.click()}><Ic g="⇪" size={18} /><span><b>From a file</b><small>.dionysus-cliptype.zip</small></span></button>
      <input ref={input} type="file" hidden accept=".zip,application/zip" aria-label="Plugin file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      <form className="v2-pl-url" onSubmit={(e) => { e.preventDefault(); if (url.trim()) onUrl(url); }}>
        <label htmlFor="v2-pl-url"><Ic g="globe" size={16} /> From a web address</label>
        <span className="v2-pl-urlrow">
          <input id="v2-pl-url" ref={urlRef} type="url" inputMode="url" placeholder="https://…/manifest.json" value={url} disabled={!!busy} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />
          <button className="v2-btn primary" type="submit" disabled={!!busy || !url.trim()}>Load</button>
        </span>
        <small>https only. The server must allow downloads from other sites (CORS). Nothing is sent but the request.</small>
      </form>
      <h4>Samples</h4>
      <ul className="v2-pl-samples">
        {PLUGIN_SAMPLES.map((s) => (
          <li key={s.id}><button className="v2-btn v2-pl-src" disabled={!!busy || installed.has(s.id)} onClick={() => onUrl(pluginSampleUrl(s.id))}><Ic g={s.icon} size={18} /><span><b>{s.name}</b><small>{installed.has(s.id) ? "Already in this project" : s.note}</small></span></button></li>
        ))}
      </ul>
      {busy && <p className="v2-hint" role="status">{busy}</p>}
      {error && <p className="v2-pl-error" role="alert"><Ic g="⚠" size={16} /> {error}</p>}
      <div className="v2-pl-actions"><button className="v2-btn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function PluginVersions({ row, onPick, onClose }: { row: PluginRow; onPick: (hash: string) => void; onClose: () => void }) {
  return (
    <div className="v2-pl-body v2-pl-versions" data-testid="plugin-versions">
      <p className="v2-abnote">A project uses one version of each plugin. Switching changes all its clips in one step; Undo reverts it.</p>
      <ul className="v2-pl-list">
        <li className="v2-pl-row is-enabled"><span className="v2-pl-ic" aria-hidden><Ic g="✓" size={20} /></span><span className="v2-pl-main"><b>{row.version}</b><span className="v2-pl-sub">Used by this project · {plural(row.clips, "clip")}</span></span></li>
        {row.versions.map((v) => {
          const newer = v.version === row.update?.version || (row.update && v.hash === row.update.hash);
          return (
            <li key={v.hash} className="v2-pl-row">
              <span className="v2-pl-ic" aria-hidden><Ic g={newer ? "plugin-update" : "history"} size={20} /></span>
              <span className="v2-pl-main"><b>{v.version}</b><span className="v2-pl-sub">On this device{newer ? " · newest" : ""}</span></span>
              <span className="v2-pl-rowacts"><button className={`v2-btn ${newer ? "primary" : ""}`} onClick={() => onPick(v.hash)}>{versionVerb(v.version, row.version)}</button></span>
            </li>
          );
        })}
      </ul>
      <div className="v2-pl-actions"><button className="v2-btn" onClick={onClose}>Back</button></div>
    </div>
  );
}
const versionVerb = (to: string, from: string) => (comparePluginVersions(to, from) > 0 ? "Update" : "Use this");

function SwitchSummary({ sw, to }: { sw: Switch; to: string }) {
  const lost = sw.changes.filter((x) => x.reason !== "clamped"), clamped = sw.changes.filter((x) => x.reason === "clamped");
  const L = (k: string) => sw.labels[k] ?? k;
  return (
    <div className={`v2-pl-switch ${sw.kind === "downgrade" ? "is-warn" : ""}`} data-testid="plugin-switch">
      {sw.kind === "downgrade"
        ? <p><Ic g="⚠" size={16} /> <span><b>{to} is older than {sw.from}</b>, the version this project uses. Settings added after {to} are dropped from its clips.</span></p>
        : <p><Ic g="plugin-update" size={16} /> <span>This project uses <b>{sw.from}</b>. Updating to <b>{to}</b> changes its {plural(sw.clips, "clip")} in one step; Undo reverts it.</span></p>}
      <ul>
        {sw.added.length > 0 && <li>New settings start at their defaults: {sw.added.map(L).join(", ")}.</li>}
        {lost.map((x) => <li key={x.key} className="is-drop">“{L(x.key)}” is dropped from {plural(x.clips, "clip")}: {x.detail}.</li>)}
        {clamped.map((x) => <li key={x.key}>“{L(x.key)}” is adjusted in {plural(x.clips, "clip")}: {x.detail}.</li>)}
        {!lost.length && !clamped.length && <li>{sw.clips ? "Every clip keeps its settings." : "No clips use it yet."}</li>}
      </ul>
    </div>
  );
}

function PluginConsent({ c, onCancel, onConfirm }: { c: Consent; onCancel: () => void; onConfirm: () => void }) {
  const f = c.facts;
  const verb = c.mode === "switch" ? `${c.sw?.kind === "update" ? "Update" : "Switch"} to ${f.version}` : c.mode === "install" ? "Install" : c.mode === "add" ? "Add to project" : "Allow";
  return (
    <div className="v2-pl-body v2-pl-consent" data-testid="plugin-consent">
      <div className="v2-pl-who">
        <span className="v2-pl-ic is-big" aria-hidden><Ic g={pluginIconKey(f.icon)} size={28} /></span>
        <span><b className="v2-pl-name">{f.name}</b><span className="v2-pl-sub">Version {f.version} · {f.publisher ? <>by {f.publisher} <span className="v2-plugin-unverified">unverified</span></> : <>no publisher <span className="v2-plugin-unverified">unverified</span></>}</span></span>
      </div>
      {f.description && <p className="v2-pl-desc">{f.description}</p>}
      <dl className="v2-plugin-facts v2-pl-facts">
        <div><dt>Size</dt><dd>{pluginSize(f.size)}</dd></div>
        <div><dt>Package</dt><dd><code title={f.hash}>{shortPluginHash(f.hash)}</code></dd></div>
        <div><dt>From</dt><dd className="v2-pl-from" title={f.source}>{pluginSourceText(f.source)}</dd></div>
        <div><dt>Libraries</dt><dd>{f.libs.length ? f.libs.map(libName).join(", ") : "None"}</dd></div>
        <div><dt>Settings</dt><dd>{f.params.length ? f.params.map((p) => p.label).join(", ") : "None"}</dd></div>
      </dl>
      {c.mode === "switch" && c.sw && <SwitchSummary sw={c.sw} to={f.version} />}
      <p className="v2-pl-promise"><Ic g="shield" size={18} /><span>It draws frames from its settings. It can&apos;t use the network or read your projects, files or accounts.</span></p>
      <p className="v2-abnote">{c.mode === "switch" ? "A new version is a new package, so it is allowed again here. " : c.mode === "install" ? `Installing keeps it on this device and adds it to this project, where it may run${c.clipAt ? ", with a clip at the playhead" : ""}. ` : c.clipAt ? "A clip is added at the playhead. " : ""}It runs only in this project on this device; other projects ask again. The publisher isn&apos;t checked by Dionysus.</p>
      {f.warnings.length > 0 && <ul className="v2-pl-warn">{f.warnings.slice(0, 3).map((w) => <li key={w}><Ic g="⚠" size={14} /> {w}</li>)}</ul>}
      {c.error && <p className="v2-pl-error" role="alert"><Ic g="⚠" size={16} /> {c.error}</p>}
      <div className="v2-pl-actions">
        <button className="v2-btn" onClick={onCancel} disabled={c.busy}>Cancel</button>
        <button className="v2-btn primary" onClick={onConfirm} disabled={c.busy} data-testid="plugin-confirm">{c.busy ? "Working…" : verb}</button>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { createProject, type Project } from "../domain";
import type { ProjectSummary, Storage } from "../ports";
import { Ic } from "./Icon";
import { ExportFileDialog, ImportFileDialog, openExportTarget, projectFileName, type ExportTarget } from "./ProjectFile";

/** Human "updated" label: just now / 5 min ago / 3 h ago / date. */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

interface Props { storage: Storage; current: Project; onOpen: (id: string) => void; onRenameCurrent: (name: string) => void; onClose: () => void }

/**
 * Project list: new / open / import, and per project (⋯ menu, or right-click on desktop) export project file / rename /
 * delete. The open project can't be deleted; deletes are undoable.
 */
export function ProjectsDialog({ storage, current, onOpen, onRenameCurrent, onClose }: Props) {
  const [list, setList] = useState<ProjectSummary[]>();
  const [editing, setEditing] = useState<string>();
  const [confirm, setConfirm] = useState<string>();
  const [trash, setTrash] = useState<unknown>();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const [exporting, setExporting] = useState<{ id: string; name: string; target: ExportTarget }>();
  const [importing, setImporting] = useState<File>();
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const menuEl = useRef<HTMLDivElement>(null);
  const busy = !!(menu || exporting || importing);
  const refresh = async () => {
    const all = await storage.projects.list();
    // The open project may not be autosaved yet: show its live name/time.
    const rows = all.some((p) => p.id === current.id) ? all : [{ id: current.id, name: current.name, updatedAt: current.meta.updatedAt }, ...all];
    setList(rows.map((r) => (r.id === current.id ? { ...r, name: current.name } : r)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  };
  useEffect(() => { void refresh(); }, [current.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { input.current?.select(); }, [editing]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key !== "Escape" || editing || exporting || importing) return; if (menu) setMenu(undefined); else onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [editing, onClose, menu, exporting, importing]);
  useEffect(() => { menuEl.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [menu]);

  const openMenu = (id: string, x: number, y: number) => setMenu({ id, x: Math.max(8, Math.min(x, window.innerWidth - 218)), y: Math.max(8, Math.min(y, window.innerHeight - 160)) });
  /** Export runs from the tap itself: the desktop save picker must open before anything else is awaited. */
  const exportProject = async (id: string, name: string) => {
    setMenu(undefined);
    const target = await openExportTarget(projectFileName(name));
    if (target) setExporting({ id, name, target });
  };

  const create = async () => { const p = createProject(`Untitled ${new Date().toLocaleDateString()}`); await storage.projects.save(p); onOpen(p.id); };
  const rename = async (id: string, name: string) => {
    setEditing(undefined);
    name = name.trim();
    if (!name) return;
    if (id === current.id) onRenameCurrent(name);
    else { const p = await storage.projects.load(id); if (p) await storage.projects.save({ ...p, name, meta: { ...p.meta, updatedAt: new Date().toISOString() } }); }
    await refresh();
  };
  const remove = async (id: string) => {
    setConfirm(undefined);
    setTrash(await storage.projects.loadRaw(id));
    await storage.projects.delete(id);
    await refresh();
  };
  const undo = async () => { if (trash) { await storage.projects.save(trash as Project); setTrash(undefined); await refresh(); } };

  return (
    <div className="v2-modal" role="dialog" aria-modal="true" aria-label="Projects">
      <div className="v2-modal-card v2-projects">
        <div className="v2-panel-head v2-projects-head"><h2>Projects</h2><span className="v2-spacer" />
          <button className="v2-btn" title="Import a .dionysus.zip project file" onClick={() => picker.current?.click()}><Ic g="⇪" size={16} /> Import</button>
          <button className="v2-btn primary" title="Start an empty project" onClick={() => void create()}><Ic g="＋" size={16} /> New project</button>
          <input ref={picker} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden aria-label="Project file to import" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) setImporting(f); }} />
        </div>
        {!list ? <p className="v2-muted">Loading…</p> : list.length === 0 ? <p className="v2-empty">No projects yet — create one to start editing.</p> : (
          <ul className="v2-project-list">
            {list.map((p) => (
              <li key={p.id} className={p.id === current.id ? "is-current" : ""} aria-current={p.id === current.id ? "true" : undefined}
                onContextMenu={(e) => { if (editing === p.id) return; e.preventDefault(); openMenu(p.id, e.clientX, e.clientY); }}>
                {editing === p.id ? (
                  <input ref={input} className="v2-title" aria-label="New project name" defaultValue={p.name} onKeyDown={(e) => { if (e.key === "Enter") void rename(p.id, e.currentTarget.value); if (e.key === "Escape") setEditing(undefined); }} onBlur={(e) => void rename(p.id, e.currentTarget.value)} />
                ) : (
                  <button className="v2-project-open" title={p.id === current.id ? "This project is open" : `Open ${p.name}`} onClick={() => (p.id === current.id ? onClose() : onOpen(p.id))}>
                    <strong>{p.name}</strong><small>{p.id === current.id ? "Open now · " : ""}{ago(p.updatedAt)}</small>
                  </button>
                )}
                {confirm === p.id ? (
                  <><button className="v2-btn danger" onClick={() => void remove(p.id)}>Delete</button><button className="v2-btn" onClick={() => setConfirm(undefined)}>Keep</button></>
                ) : editing !== p.id && (
                  <button className="v2-icon v2-project-more" aria-label={`More for ${p.name}`} title="Export, rename or delete" aria-haspopup="menu" aria-expanded={menu?.id === p.id}
                    onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (menu?.id === p.id) setMenu(undefined); else openMenu(p.id, r.right - 210, r.bottom + 4); }}><Ic g="⋯" /></button>
                )}
              </li>
            ))}
          </ul>
        )}
        {menu && (() => {
          const row = list?.find((r) => r.id === menu.id);
          if (!row) return null;
          const isCur = row.id === current.id;
          return <div className="v2-menu-backdrop v2-pmenu-backdrop" onPointerDown={() => setMenu(undefined)} onContextMenu={(e) => { e.preventDefault(); setMenu(undefined); }}>
            <div ref={menuEl} className="v2-layer-menu v2-pmenu" role="menu" aria-label={`${row.name} actions`} style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
              <div className="v2-pmenu-title" aria-hidden="true">{row.name}</div>
              <button role="menuitem" onClick={() => void exportProject(row.id, row.name)}><Ic g="⇩" size={16} /><span>Export project file</span></button>
              <button role="menuitem" onClick={() => { setMenu(undefined); setEditing(row.id); }}><Ic g="✎" size={16} /><span>Rename</span></button>
              <button role="menuitem" className="is-danger" disabled={isCur} title={isCur ? "Open another project to delete this one" : undefined} onClick={() => { setMenu(undefined); setConfirm(row.id); }}><Ic g="🗑" size={16} /><span>Delete{isCur ? " (open now)" : ""}</span></button>
              <button role="menuitem" className="v2-pmenu-cancel" onClick={() => setMenu(undefined)}>Cancel</button>
            </div>
          </div>;
        })()}
        {exporting && <ExportFileDialog fileName={projectFileName(exporting.name)} target={exporting.target} blobs={storage.blobs}
          load={async () => (exporting.id === current.id ? current : storage.projects.load(exporting.id))} onClose={() => setExporting(undefined)} />}
        {importing && <ImportFileDialog file={importing} storage={storage} current={current} onDone={() => void refresh()} onOpen={(id) => { setImporting(undefined); onOpen(id); }} onClose={() => setImporting(undefined)} />}
        {trash !== undefined && <div className="v2-undo-bar" role="status">Project deleted <button className="v2-btn" onClick={() => void undo()}>Undo</button></div>}
        <div className="v2-modal-actions"><button className="v2-btn" disabled={busy} onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

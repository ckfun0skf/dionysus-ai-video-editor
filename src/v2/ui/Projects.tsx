import { useEffect, useRef, useState } from "react";
import { createProject, type Project } from "../domain";
import type { ProjectSummary, Storage } from "../ports";

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

/** Project list: new / open / rename / delete (the open project can't be deleted; deletes are undoable). */
export function ProjectsDialog({ storage, current, onOpen, onRenameCurrent, onClose }: Props) {
  const [list, setList] = useState<ProjectSummary[]>();
  const [editing, setEditing] = useState<string>();
  const [confirm, setConfirm] = useState<string>();
  const [trash, setTrash] = useState<unknown>();
  const input = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    const all = await storage.projects.list();
    // The open project may not be autosaved yet: show its live name/time.
    const rows = all.some((p) => p.id === current.id) ? all : [{ id: current.id, name: current.name, updatedAt: current.meta.updatedAt }, ...all];
    setList(rows.map((r) => (r.id === current.id ? { ...r, name: current.name } : r)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  };
  useEffect(() => { void refresh(); }, [current.name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { input.current?.select(); }, [editing]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !editing) onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [editing, onClose]);

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
        <div className="v2-panel-head"><h2>Projects</h2><span className="v2-spacer" /><button className="v2-btn primary" title="Start an empty project" onClick={() => void create()}>＋ New project</button></div>
        {!list ? <p className="v2-muted">Loading…</p> : list.length === 0 ? <p className="v2-empty">No projects yet — create one to start editing.</p> : (
          <ul className="v2-project-list">
            {list.map((p) => (
              <li key={p.id} className={p.id === current.id ? "is-current" : ""} aria-current={p.id === current.id ? "true" : undefined}>
                {editing === p.id ? (
                  <input ref={input} className="v2-title" aria-label="New project name" defaultValue={p.name} onKeyDown={(e) => { if (e.key === "Enter") void rename(p.id, e.currentTarget.value); if (e.key === "Escape") setEditing(undefined); }} onBlur={(e) => void rename(p.id, e.currentTarget.value)} />
                ) : (
                  <button className="v2-project-open" title={p.id === current.id ? "This project is open" : `Open ${p.name}`} onClick={() => (p.id === current.id ? onClose() : onOpen(p.id))}>
                    <strong>{p.name}</strong><small>{p.id === current.id ? "Open now · " : ""}{ago(p.updatedAt)}</small>
                  </button>
                )}
                {confirm === p.id ? (
                  <><button className="v2-btn danger" onClick={() => void remove(p.id)}>Delete</button><button className="v2-btn" onClick={() => setConfirm(undefined)}>Keep</button></>
                ) : (
                  <><button className="v2-icon" aria-label={`Rename ${p.name}`} title="Rename" onClick={() => setEditing(p.id)}>✎</button>
                  <button className="v2-icon" aria-label={`Delete ${p.name}`} title={p.id === current.id ? "Open another project to delete this one" : "Delete"} disabled={p.id === current.id} onClick={() => setConfirm(p.id)}>🗑</button></>
                )}
              </li>
            ))}
          </ul>
        )}
        {trash !== undefined && <div className="v2-undo-bar" role="status">Project deleted <button className="v2-btn" onClick={() => void undo()}>Undo</button></div>}
        <div className="v2-modal-actions"><button className="v2-btn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

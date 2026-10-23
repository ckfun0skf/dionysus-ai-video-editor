/**
 * Editor engine: single source of truth, command dispatch and one undo/redo history.
 * Commands are pure (project, payload) => project. History stores whole immutable
 * snapshots (structural sharing keeps this cheap for MVP-sized documents).
 */
import type { Project } from "../domain/model";
import { validateComposition } from "../domain/model";

export type Command = { label: string; apply: (project: Project) => Project; coalesceKey?: string };

export interface EngineState { project: Project; canUndo: boolean; canRedo: boolean; revision: number }

interface HistoryEntry { label: string; before: Project; coalesceKey?: string }

export class Engine {
  private project: Project;
  private past: HistoryEntry[] = [];
  private future: { label: string; after: Project }[] = [];
  private listeners = new Set<() => void>();
  private revision = 0;
  private snapshot: EngineState;
  readonly limit: number;

  constructor(project: Project, limit = 200) {
    this.project = project;
    this.limit = limit;
    this.snapshot = this.makeSnapshot();
  }

  private makeSnapshot(): EngineState {
    return { project: this.project, canUndo: this.past.length > 0, canRedo: this.future.length > 0, revision: this.revision };
  }
  private emit() {
    this.revision += 1;
    this.snapshot = this.makeSnapshot();
    this.listeners.forEach((l) => l());
  }

  getState = (): EngineState => this.snapshot;
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Apply one or more commands as a single atomic history step. Returns false if rejected. */
  dispatch(cmd: Command | Command[], label?: string): boolean {
    const cmds = Array.isArray(cmd) ? cmd : [cmd];
    let next = this.project;
    try {
      for (const c of cmds) next = c.apply(next);
    } catch {
      return false;
    }
    if (next === this.project) return false;
    for (const comp of Object.values(next.compositions)) if (validateComposition(comp).length) return false;
    next = { ...next, meta: { ...next.meta, updatedAt: new Date().toISOString() } };
    const key = cmds.length === 1 ? cmds[0].coalesceKey : undefined;
    const last = this.past[this.past.length - 1];
    if (!(key && last && last.coalesceKey === key)) {
      this.past.push({ label: label ?? cmds.map((c) => c.label).join(" + "), before: this.project, coalesceKey: key });
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.project = next;
    this.emit();
    return true;
  }

  undo(): boolean {
    const entry = this.past.pop();
    if (!entry) return false;
    this.future.push({ label: entry.label, after: this.project });
    this.project = entry.before;
    this.emit();
    return true;
  }

  redo(): boolean {
    const entry = this.future.pop();
    if (!entry) return false;
    this.past.push({ label: entry.label, before: this.project });
    this.project = entry.after;
    this.emit();
    return true;
  }

  /** Replace the document without history (e.g. after loading). */
  reset(project: Project) {
    this.project = project;
    this.past = [];
    this.future = [];
    this.emit();
  }
}

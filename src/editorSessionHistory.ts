import type { CompositionDocument } from "./compositionModel";
import type { DionysusProject } from "./types";

/**
 * An undo/redo entry must keep the editable Composition and its legacy project
 * projection together. Keeping them in separate histories allowed the two
 * stacks to become misaligned after non-root edits and project imports.
 */
export interface EditorSessionSnapshot {
  project: DionysusProject;
  composition: CompositionDocument;
}

export interface EditorSessionHistory {
  undo: EditorSessionSnapshot[];
  redo: EditorSessionSnapshot[];
  lastGroup: string;
  lastAt: number;
}

export interface EditorSessionHistoryResult {
  history: EditorSessionHistory;
  snapshot?: EditorSessionSnapshot;
}

function cloneSnapshot(snapshot: EditorSessionSnapshot): EditorSessionSnapshot {
  return structuredClone(snapshot);
}

export function createEditorSessionHistory(): EditorSessionHistory {
  return { undo: [], redo: [], lastGroup: "", lastAt: 0 };
}

/**
 * Records one atomic editor snapshot. Rapid edits with the same non-empty
 * history group coalesce into a single undo step, while every new edit clears
 * redo history. Both project compatibility data and the canonical Composition
 * are captured as one entry.
 */
export function recordEditorSessionChange(
  history: EditorSessionHistory,
  current: EditorSessionSnapshot,
  group: string,
  now: number,
  limit = 50,
): EditorSessionHistory {
  const coalesce = Boolean(group) && group === history.lastGroup && now - history.lastAt < 800;
  const boundedLimit = Math.max(1, Math.floor(limit));
  const undo = coalesce
    ? history.undo
    : [...history.undo.slice(-(boundedLimit - 1)), cloneSnapshot(current)].slice(-boundedLimit);

  return {
    undo,
    redo: [],
    lastGroup: group,
    lastAt: now,
  };
}

export function undoEditorSessionChange(
  history: EditorSessionHistory,
  current: EditorSessionSnapshot,
): EditorSessionHistoryResult {
  if (history.undo.length === 0) return { history };

  return {
    snapshot: cloneSnapshot(history.undo[history.undo.length - 1]),
    history: {
      undo: history.undo.slice(0, -1),
      redo: [...history.redo, cloneSnapshot(current)],
      lastGroup: "",
      lastAt: 0,
    },
  };
}

export function redoEditorSessionChange(
  history: EditorSessionHistory,
  current: EditorSessionSnapshot,
): EditorSessionHistoryResult {
  if (history.redo.length === 0) return { history };

  return {
    snapshot: cloneSnapshot(history.redo[history.redo.length - 1]),
    history: {
      undo: [...history.undo, cloneSnapshot(current)],
      redo: history.redo.slice(0, -1),
      lastGroup: "",
      lastAt: 0,
    },
  };
}

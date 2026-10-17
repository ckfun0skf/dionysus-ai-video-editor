export interface ProjectHistory<T> {
  current: T;
  undo: T[];
  redo: T[];
}

/** Push the current snapshot before a change and clear redo history. */
export function recordProjectChange<T>(history: ProjectHistory<T>, next: T, limit = 50): ProjectHistory<T> {
  return { current: next, undo: [...history.undo.slice(-(limit - 1)), history.current], redo: [] };
}

export function undoProjectChange<T>(history: ProjectHistory<T>): ProjectHistory<T> {
  if (!history.undo.length) return history;
  return {
    current: history.undo[history.undo.length - 1],
    undo: history.undo.slice(0, -1),
    redo: [...history.redo, history.current],
  };
}

export function redoProjectChange<T>(history: ProjectHistory<T>): ProjectHistory<T> {
  if (!history.redo.length) return history;
  return {
    current: history.redo[history.redo.length - 1],
    undo: [...history.undo, history.current],
    redo: history.redo.slice(0, -1),
  };
}

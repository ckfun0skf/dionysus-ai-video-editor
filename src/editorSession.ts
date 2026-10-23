import {
  addCompositionTrack,
  assertValidCompositionDocument,
  deleteCompositionPlacement,
  insertCompositionPlacement,
  removeCompositionTrack,
  reorderCompositionTrack,
  updateCompositionPlacement,
  updateCompositionTrack,
} from "./compositionCommands";
import type { CompositionDocument } from "./compositionModel";
import { migrateLegacyProjectToComposition, projectRootCompositionToLegacy } from "./compositionMigration";
import type { EditorSessionSnapshot } from "./editorSessionHistory";
import { createEditorSessionHistory, recordEditorSessionChange, redoEditorSessionChange, undoEditorSessionChange, type EditorSessionHistory } from "./editorSessionHistory";
import type { DionysusProject } from "./types";

/**
 * Reconcile legacy-domain edits into the canonical root without letting a migrated
 * compatibility projection overwrite timing, track, source ranges, typed sources,
 * or linked ownership for placements already present in the live document.
 */
export function reconcileEditorSessionComposition(
  current: CompositionDocument,
  target: CompositionDocument,
): CompositionDocument {
  let next = structuredClone(current);
  const targetTrackIds = new Set(target.tracks.map(track => track.id));
  for (const track of target.tracks) {
    if (!next.tracks.some(item => item.id === track.id)) next = addCompositionTrack(next, track);
    else next = updateCompositionTrack(next, track.id, track);
  }

  const targetPlacementIds = new Set(target.placements.map(placement => placement.id));
  for (const placement of [...next.placements]) {
    if (!targetPlacementIds.has(placement.id) && next.placements.some(item => item.id === placement.id)) {
      next = deleteCompositionPlacement(next, placement.id);
    }
  }

  // Existing canonical placements are edited with shared immutable commands. New legacy-domain
  // items enter through Composition insertion checks.
  for (const desired of target.placements) {
    const existing = next.placements.find(placement => placement.id === desired.id);
    if (!existing) {
      next = insertCompositionPlacement(next, structuredClone(desired));
      continue;
    }
    const currentPlacement = next.placements.find(placement => placement.id === desired.id)!;
    // Compatibility/domain editors can refresh descriptive metadata, never canonical geometry
    // or source/link ownership of a placement that already exists in the session.
    next = updateCompositionPlacement(next, desired.id, {
      name: desired.name,
      legacyData: { ...currentPlacement.legacyData, ...structuredClone(desired.legacyData) },
    });
  }

  const targetTrackOrder = [...target.tracks].sort((a, b) => a.order - b.order);
  targetTrackOrder.forEach((track, index) => {
    const ordered = [...next.tracks].sort((a, b) => a.order - b.order);
    const currentIndex = ordered.findIndex(item => item.id === track.id);
    if (currentIndex >= 0 && currentIndex !== index) next = reorderCompositionTrack(next, track.id, index);
  });
  for (const track of [...next.tracks]) {
    if (targetTrackIds.has(track.id)) continue;
    const fallback = targetTrackOrder.find(item => item.kind === "video")?.id;
    next = removeCompositionTrack(next, track.id, fallback);
  }
  // Reconciliation can be triggered by legacy-domain metadata edits, whose migrated
  // target only contains snapshots discoverable from the Project projection. Preserve the
  // canonical document's already-pinned child trees; append newly discovered children by ID.
  const nestedCompositions = [...(next.nestedCompositions ?? [])];
  const nestedCompositionIds = new Set(nestedCompositions.map(child => child.id));
  for (const child of target.nestedCompositions ?? []) {
    if (nestedCompositionIds.has(child.id)) continue;
    nestedCompositionIds.add(child.id);
    nestedCompositions.push(structuredClone(child));
  }

  next = {
    ...next,
    id: target.id,
    name: target.name,
    duration: target.duration,
    frameRate: target.frameRate,
    width: target.width,
    height: target.height,
    provenance: target.provenance,
    nestedCompositions,
    legacyData: structuredClone(target.legacyData),
    tracks: [...target.tracks].sort((a, b) => a.order - b.order).map((track, order) => ({ ...structuredClone(track), order })),
  };
  assertValidCompositionDocument(next);
  return next;
}

/**
 * Turn a Project-domain update into one paired Editor session transition. Root
 * commands may supply an explicit canonical document; compatibility-first domain
 * updates are reconciled against the current Composition before projecting back.
 */
export function commitEditorSessionChange(
  current: EditorSessionSnapshot,
  nextProject: DionysusProject,
  canonicalRoot?: CompositionDocument,
): EditorSessionSnapshot {
  const composition = canonicalRoot
    ? structuredClone(canonicalRoot)
    : reconcileEditorSessionComposition(
        current.composition,
        migrateLegacyProjectToComposition(nextProject).rootComposition,
      );
  const project = projectRootCompositionToLegacy(nextProject, composition);
  return { project, composition };
}


export interface EditorSessionTransition {
  session: EditorSessionSnapshot;
  history: EditorSessionHistory;
}

/**
 * Run one editor edit as a single domain transaction: capture the pre-edit snapshot,
 * apply the legacy-domain updater, reconcile/project the paired session, and return
 * both the new session and its matching undo history without mutating caller state.
 */
export function transitionEditorSession(
  current: EditorSessionSnapshot,
  history: EditorSessionHistory,
  updateProject: (project: DionysusProject) => DionysusProject,
  historyGroup = "",
  canonicalRoot?: CompositionDocument,
  now = Date.now(),
): EditorSessionTransition {
  const nextHistory = recordEditorSessionChange(history, current, historyGroup, now);
  const nextProject = {
    ...updateProject(structuredClone(current.project)),
    updatedAt: new Date(now).toISOString(),
  };
  const session = commitEditorSessionChange(current, nextProject, canonicalRoot);
  return { session, history: nextHistory };
}


export type EditorSessionHistoryDirection = "undo" | "redo";

export interface EditorSessionHistoryTransition {
  session?: EditorSessionSnapshot;
  history: EditorSessionHistory;
}

/** Restore one paired history snapshot and rebuild its compatibility projection atomically. */
export function restoreEditorSessionHistory(
  current: EditorSessionSnapshot,
  history: EditorSessionHistory,
  direction: EditorSessionHistoryDirection,
  now = Date.now(),
): EditorSessionHistoryTransition {
  const result = direction === "undo"
    ? undoEditorSessionChange(history, current)
    : redoEditorSessionChange(history, current);
  if (!result.snapshot) return { history: result.history };

  const composition = structuredClone(result.snapshot.composition);
  const project = {
    ...projectRootCompositionToLegacy(structuredClone(result.snapshot.project), composition),
    updatedAt: new Date(now).toISOString(),
  };
  return { session: { project, composition }, history: result.history };
}


/**
 * Import a project through the same paired-session boundary. A supplied canonical root
 * is accepted only when its compatibility projection exactly matches the imported Project;
 * otherwise use the deterministic legacy migration path.
 */
export function createImportedEditorSession(
  project: DionysusProject,
  candidateRoot?: CompositionDocument,
): EditorSessionSnapshot {
  const migratedRoot = migrateLegacyProjectToComposition(project).rootComposition;
  const composition = candidateRoot &&
    JSON.stringify(projectRootCompositionToLegacy(project, candidateRoot)) === JSON.stringify(project)
    ? structuredClone(candidateRoot)
    : migratedRoot;
  return {
    project: projectRootCompositionToLegacy(project, composition),
    composition,
  };
}


/**
 * Build a project-import replacement as one boundary result. A newly imported project
 * must never retain Undo/Redo entries belonging to the previous project.
 */
export function createImportedEditorSessionTransition(
  project: DionysusProject,
  candidateRoot?: CompositionDocument,
): { session: EditorSessionSnapshot; history: EditorSessionHistory } {
  return {
    session: createImportedEditorSession(project, candidateRoot),
    history: createEditorSessionHistory(),
  };
}

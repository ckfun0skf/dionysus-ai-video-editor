import type { CompositionDocument, CompositionPlacement } from "./compositionModel";

const EPSILON = 0.001;

export interface InsertCompositionPlacementInput extends Omit<CompositionPlacement, "order"> {
  order?: number;
}

export interface SplitCompositionPlacementInput {
  /** Map every placement in the linked group to its new right-hand placement ID. */
  newPlacementIds: Record<string, string>;
}

export interface DuplicateCompositionPlacementInput {
  /** Map every placement in the linked group to its copied placement ID. */
  newPlacementIds: Record<string, string>;
  /** New start of the selected placement; linked placements retain their relative offset. */
  start: number;
}

export type CompositionResizeEdge = "left" | "right";

export interface CompositionPlacementResize {
  id: string;
  start: number;
  duration: number;
  edge: CompositionResizeEdge;
}

export interface CompositionResizePreview extends CompositionPlacementResize {
  trims: CompositionPlacementResize[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requirePlacement(document: CompositionDocument, placementId: string): CompositionPlacement {
  const placement = document.placements.find(item => item.id === placementId);
  if (!placement) throw new Error("Composition placement not found.");
  return placement;
}

function syncLegacyPlacement(placement: CompositionPlacement): CompositionPlacement {
  const legacyData: Record<string, unknown> = {
    ...placement.legacyData,
    id: placement.id,
    name: placement.name,
    trackId: placement.trackId,
    start: placement.start,
    duration: placement.duration,
  };
  if (placement.sourceIn === undefined) delete legacyData.sourceIn;
  else legacyData.sourceIn = placement.sourceIn;
  if (placement.sourceOut === undefined) delete legacyData.sourceOut;
  else legacyData.sourceOut = placement.sourceOut;
  if (placement.linkedToPlacementId === undefined) delete legacyData.linkedVideoClipId;
  else legacyData.linkedVideoClipId = placement.linkedToPlacementId;
  for (const key of ["fadeIn", "fadeOut"] as const) {
    if (typeof legacyData[key] === "number") {
      legacyData[key] = Math.min(Math.max(0, legacyData[key] as number), placement.duration);
    }
  }
  return { ...placement, legacyData };
}

/** Validate invariants shared by the root and every nested Composition before applying an edit. */
export function assertValidCompositionDocument(document: CompositionDocument): void {
  const trackIds = new Set<string>();
  for (const track of document.tracks) {
    if (!track.id.trim() || trackIds.has(track.id)) {
      throw new Error("Composition track IDs must be non-empty and unique.");
    }
    trackIds.add(track.id);
  }

  const byId = new Map<string, CompositionPlacement>();
  for (const placement of document.placements) {
    if (!placement.id.trim() || byId.has(placement.id)) {
      throw new Error("Composition placement IDs must be non-empty and unique.");
    }
    if (!trackIds.has(placement.trackId)) {
      throw new Error("Every Composition placement must reference an existing track.");
    }
    if (!Number.isFinite(placement.start) || placement.start < 0 ||
        !Number.isFinite(placement.duration) || placement.duration <= 0) {
      throw new Error("Composition timing must use a non-negative start and positive finite duration.");
    }
    if (placement.sourceIn !== undefined &&
        (!Number.isFinite(placement.sourceIn) || placement.sourceIn < 0)) {
      throw new Error("Composition source in-point must be finite and non-negative.");
    }
    if (placement.sourceOut !== undefined &&
        (!Number.isFinite(placement.sourceOut) || placement.sourceOut <= (placement.sourceIn ?? 0))) {
      throw new Error("Composition source out-point must be finite and greater than source in-point.");
    }
    byId.set(placement.id, placement);
  }

  for (const placement of document.placements) {
    const parentId = placement.linkedToPlacementId;
    if (!parentId) continue;
    const parent = byId.get(parentId);
    if (!parent || parent.id === placement.id) {
      throw new Error("Linked Composition placements must reference an existing different placement.");
    }
    if (placement.start !== parent.start || placement.duration !== parent.duration) {
      throw new Error("Linked Composition placements must share start and duration.");
    }

    const visited = new Set<string>([placement.id]);
    let current: CompositionPlacement | undefined = parent;
    while (current?.linkedToPlacementId) {
      if (visited.has(current.id)) throw new Error("Composition placement links must not contain cycles.");
      visited.add(current.id);
      current = byId.get(current.linkedToPlacementId);
    }
    if (current && visited.has(current.id)) {
      throw new Error("Composition placement links must not contain cycles.");
    }
  }
}

function getLinkedRoot(document: CompositionDocument, placement: CompositionPlacement): CompositionPlacement {
  let current = placement;
  const byId = new Map(document.placements.map(item => [item.id, item]));
  const seen = new Set<string>();
  while (current.linkedToPlacementId) {
    if (seen.has(current.id)) throw new Error("Composition placement links must not contain cycles.");
    seen.add(current.id);
    const parent = byId.get(current.linkedToPlacementId);
    if (!parent) throw new Error("Linked Composition placement was not found.");
    current = parent;
  }
  return current;
}

function getDescendants(document: CompositionDocument, rootId: string): CompositionPlacement[] {
  const descendants: CompositionPlacement[] = [];
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const placement of document.placements) {
      if (placement.linkedToPlacementId !== parentId || visited.has(placement.id)) continue;
      visited.add(placement.id);
      descendants.push(placement);
      queue.push(placement.id);
    }
  }
  return descendants;
}

function getLinkedGroup(document: CompositionDocument, placement: CompositionPlacement): CompositionPlacement[] {
  const root = getLinkedRoot(document, placement);
  return [root, ...getDescendants(document, root.id)];
}

function validateNewIds(document: CompositionDocument, map: Record<string, string>, expectedIds: string[]): void {
  const values: string[] = expectedIds.map(oldId => {
    const newId = map[oldId];
    if (typeof newId !== "string" || !newId.trim()) {
      throw new Error("Provide a non-empty new ID for every placement in the linked group.");
    }
    return newId;
  });
  if (new Set(values).size !== values.length) {
    throw new Error("New Composition placement IDs must be unique.");
  }
  const existingIds = new Set(document.placements.map(item => item.id));
  if (values.some(newId => existingIds.has(newId))) {
    throw new Error("New Composition placement IDs must be unique and must not collide with existing IDs.");
  }
}

function sourceRangeForSplit(placement: CompositionPlacement): { sourceIn: number; sourceOut: number } | undefined {
  const legacyKind = placement.legacyData?.kind;
  const shouldMaterialize = placement.source.type === "shot" ||
    placement.source.type === "clip" ||
    legacyKind === "video" || legacyKind === "audio" || legacyKind === "image";
  const hasRange = placement.sourceIn !== undefined || placement.sourceOut !== undefined || shouldMaterialize;
  if (!hasRange) return undefined;

  const sourceIn = placement.sourceIn ?? 0;
  const sourceOut = placement.sourceOut ?? sourceIn + placement.duration;
  if (Math.abs((sourceOut - sourceIn) - placement.duration) > EPSILON) {
    throw new Error("Source range length must match placement duration before splitting.");
  }
  return { sourceIn, sourceOut };
}

function nextOrder(document: CompositionDocument, trackId: string): number {
  return document.placements
    .filter(placement => placement.trackId === trackId)
    .reduce((max, placement) => Math.max(max, placement.order), -1) + 1;
}

function extendCompositionDuration(document: CompositionDocument): void {
  document.duration = Math.max(
    document.duration,
    ...document.placements.map(placement => placement.start + placement.duration),
  );
}

/** Insert a placement into an existing track without creating a separate root/nested code path. */
export function insertCompositionPlacement(
  document: CompositionDocument,
  input: InsertCompositionPlacementInput,
): CompositionDocument {
  assertValidCompositionDocument(document);
  if (!input.id.trim() || document.placements.some(placement => placement.id === input.id)) {
    throw new Error("Composition placement IDs must be non-empty and unique.");
  }
  if (!document.tracks.some(track => track.id === input.trackId)) {
    throw new Error("Cannot insert a placement on a missing track.");
  }
  const next = clone(document);
  const order = input.order ?? nextOrder(next, input.trackId);
  next.placements.push(syncLegacyPlacement({ ...clone(input), order }));
  extendCompositionDuration(next);
  assertValidCompositionDocument(next);
  return next;
}

/** Moves the selected placement and its linked group as one atomic edit. */
export function moveCompositionPlacement(
  document: CompositionDocument,
  placementId: string,
  start: number,
): CompositionDocument {
  assertValidCompositionDocument(document);
  if (!Number.isFinite(start) || start < 0) {
    throw new Error("Composition start must be finite and non-negative.");
  }
  const selected = requirePlacement(document, placementId);
  const delta = start - selected.start;
  const groupIds = new Set(getLinkedGroup(document, selected).map(item => item.id));
  const next = clone(document);
  next.placements = next.placements.map(placement =>
    groupIds.has(placement.id)
      ? syncLegacyPlacement({ ...placement, start: placement.start + delta })
      : placement
  );
  extendCompositionDuration(next);
  assertValidCompositionDocument(next);
  return next;
}

/** Moves a placement across compatible tracks while sharing the same timing/linked-group command. */
export function moveCompositionPlacementToTrack(
  document: CompositionDocument,
  placementId: string,
  trackId: string,
  start: number,
): CompositionDocument {
  assertValidCompositionDocument(document);
  const selected = requirePlacement(document, placementId);
  const track = document.tracks.find(item => item.id === trackId);
  if (!track) throw new Error("Composition destination track was not found.");
  const legacyKind = selected.legacyData?.kind;
  const requiredKind = legacyKind === "audio" ? "audio" : legacyKind === "text" ? "text" : "video";
  if (track.kind !== requiredKind) {
    throw new Error("This source type cannot be moved to the selected track.");
  }
  const moved = moveCompositionPlacement(document, placementId, start);
  const next = clone(moved);
  next.placements = next.placements.map(placement =>
    placement.id === placementId ? syncLegacyPlacement({ ...placement, trackId }) : placement
  );
  assertValidCompositionDocument(next);
  return next;
}

/** Trims the selected placement and linked group at the right edge, keeping source starts stable. */
export function trimCompositionPlacement(
  document: CompositionDocument,
  placementId: string,
  duration: number,
): CompositionDocument {
  assertValidCompositionDocument(document);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Composition duration must be finite and positive.");
  }
  const selected = requirePlacement(document, placementId);
  const root = getLinkedRoot(document, selected);
  const group = [root, ...getDescendants(document, root.id)];
  const hasSourceRange = group.some(item => item.sourceIn !== undefined || item.sourceOut !== undefined);
  const fallbackSourceIn = root.sourceIn ?? group.find(item => item.sourceIn !== undefined)?.sourceIn ?? 0;
  const groupIds = new Set(group.map(item => item.id));
  const next = clone(document);
  next.placements = next.placements.map(placement => {
    if (!groupIds.has(placement.id)) return placement;
    if (!hasSourceRange) return syncLegacyPlacement({ ...placement, duration });
    return syncLegacyPlacement({
      ...placement,
      duration,
      sourceIn: fallbackSourceIn,
      sourceOut: fallbackSourceIn + duration,
    });
  });
  extendCompositionDuration(next);
  assertValidCompositionDocument(next);
  return next;
}

function resizedSourceRange(
  placement: CompositionPlacement,
  resize: CompositionPlacementResize,
): Pick<CompositionPlacement, "sourceIn" | "sourceOut"> {
  if (placement.sourceIn === undefined && placement.sourceOut === undefined) return {};
  const sourceIn = resize.edge === "left"
    ? Math.max(0, (placement.sourceIn ?? 0) + (resize.start - placement.start))
    : placement.sourceIn ?? 0;
  const sourceOut = resize.edge === "right"
    ? sourceIn + resize.duration
    : placement.sourceOut ?? sourceIn + placement.duration;
  return { sourceIn, sourceOut };
}

/**
 * Applies a frame-snapped resize preview and its adjacent trims as one immutable command.
 * A linked group always receives the root placement's timing and source range, so resizing
 * either member cannot leave linked audio out of sync with its video placement.
 */
export function applyCompositionResizePreview(
  document: CompositionDocument,
  preview: CompositionResizePreview,
): CompositionDocument {
  assertValidCompositionDocument(document);
  const requested = [preview, ...preview.trims];
  const rootUpdates = new Map<string, CompositionPlacementResize>();

  for (const resize of requested) {
    if (!Number.isFinite(resize.start) || resize.start < 0 ||
        !Number.isFinite(resize.duration) || resize.duration <= 0) {
      throw new Error("Composition resize timing must use a non-negative start and positive finite duration.");
    }
    const placement = requirePlacement(document, resize.id);
    const root = getLinkedRoot(document, placement);
    const existing = rootUpdates.get(root.id);
    if (existing && (existing.start !== resize.start || existing.duration !== resize.duration || existing.edge !== resize.edge)) {
      throw new Error("A linked Composition group cannot receive conflicting resize updates.");
    }
    rootUpdates.set(root.id, { ...resize, id: root.id });
  }

  const updates = new Map<string, { resize: CompositionPlacementResize; source: Pick<CompositionPlacement, "sourceIn" | "sourceOut"> }>();
  for (const [rootId, resize] of rootUpdates) {
    const root = requirePlacement(document, rootId);
    const source = resizedSourceRange(root, resize);
    for (const placement of getLinkedGroup(document, root)) {
      updates.set(placement.id, { resize, source });
    }
  }

  const next = clone(document);
  next.placements = next.placements.map(placement => {
    const update = updates.get(placement.id);
    if (!update) return placement;
    const source = Object.keys(update.source).length
      ? update.source
      : resizedSourceRange(placement, update.resize);
    return syncLegacyPlacement({
      ...placement,
      start: update.resize.start,
      duration: update.resize.duration,
      ...source,
    });
  });
  extendCompositionDuration(next);
  assertValidCompositionDocument(next);
  return next;
}

/** Splits a root placement and all linked descendants at one timeline position. */
export function splitCompositionPlacement(
  document: CompositionDocument,
  placementId: string,
  splitTime: number,
  input: SplitCompositionPlacementInput,
): CompositionDocument {
  assertValidCompositionDocument(document);
  const selected = requirePlacement(document, placementId);
  if (selected.linkedToPlacementId) {
    throw new Error("Split the root placement to split its linked group.");
  }
  const end = selected.start + selected.duration;
  if (!Number.isFinite(splitTime) || splitTime <= selected.start || splitTime >= end) {
    throw new Error("Split point must fall strictly inside the placement.");
  }

  const group = [selected, ...getDescendants(document, selected.id)];
  const groupIds = new Set(group.map(item => item.id));
  validateNewIds(document, input.newPlacementIds, [...groupIds]);
  const splitPairs = new Map<string, { left: CompositionPlacement; right: CompositionPlacement }>();
  const orderOffsets = new Map<string, number>();

  const rootRange = sourceRangeForSplit(selected);
  for (const placement of group) {
    const leftDuration = splitTime - placement.start;
    const rightDuration = placement.duration - leftDuration;
    // Linked source audio follows the same source range as its video.
    const range = placement.id === selected.id ? rootRange : placement.linkedToPlacementId ? rootRange : sourceRangeForSplit(placement);
    const { linkedToPlacementId: _link, ...base } = placement;
    const left = syncLegacyPlacement({
      ...base,
      legacyData: { ...base.legacyData, fadeOut: undefined },
      ...(placement.linkedToPlacementId ? { linkedToPlacementId: placement.linkedToPlacementId } : {}),
      duration: leftDuration,
      ...(range ? { sourceIn: range.sourceIn, sourceOut: range.sourceIn + leftDuration } : {}),
    });
    const rightId = input.newPlacementIds[placement.id];
    const rightLink = placement.linkedToPlacementId
      ? input.newPlacementIds[placement.linkedToPlacementId] ?? placement.linkedToPlacementId
      : undefined;
    const order = nextOrder(document, placement.trackId) + (orderOffsets.get(placement.trackId) ?? 0);
    orderOffsets.set(placement.trackId, (orderOffsets.get(placement.trackId) ?? 0) + 1);
    const right = syncLegacyPlacement({
      ...base,
      id: rightId,
      name: placement.name + " (2)",
      start: splitTime,
      duration: rightDuration,
      order,
      legacyData: { ...base.legacyData, fadeIn: undefined },
      ...(rightLink ? { linkedToPlacementId: rightLink } : {}),
      ...(range ? { sourceIn: range.sourceIn + leftDuration, sourceOut: range.sourceOut } : {}),
    });
    splitPairs.set(placement.id, { left, right });
  }

  const next = clone(document);
  next.placements = next.placements.map(placement => splitPairs.get(placement.id)?.left ?? placement);
  next.placements.push(...group.map(placement => splitPairs.get(placement.id)!.right));
  extendCompositionDuration(next);
  assertValidCompositionDocument(next);
  return next;
}

/** Duplicates a placement and its linked descendants as one new, independent placement group. */
export function duplicateCompositionPlacement(
  document: CompositionDocument,
  placementId: string,
  input: DuplicateCompositionPlacementInput,
): CompositionDocument {
  assertValidCompositionDocument(document);
  if (!Number.isFinite(input.start) || input.start < 0) {
    throw new Error("Duplicate start must be finite and non-negative.");
  }
  const selected = requirePlacement(document, placementId);
  const group = getLinkedGroup(document, selected);
  const groupIds = new Set(group.map(item => item.id));
  validateNewIds(document, input.newPlacementIds, [...groupIds]);
  const delta = input.start - selected.start;
  const orderOffsets = new Map<string, number>();
  const copies = group.map(placement => {
    const order = nextOrder(document, placement.trackId) + (orderOffsets.get(placement.trackId) ?? 0);
    orderOffsets.set(placement.trackId, (orderOffsets.get(placement.trackId) ?? 0) + 1);
    return syncLegacyPlacement({
      ...clone(placement),
      id: input.newPlacementIds[placement.id],
      start: placement.start + delta,
      order,
      ...(placement.linkedToPlacementId && groupIds.has(placement.linkedToPlacementId)
        ? { linkedToPlacementId: input.newPlacementIds[placement.linkedToPlacementId] }
        : {}),
    });
  });
  const next = clone(document);
  next.placements.push(...copies);
  extendCompositionDuration(next);
  assertValidCompositionDocument(next);
  return next;
}

/** Deleting a root placement also deletes its linked descendants; deleting a child is local. */
export function deleteCompositionPlacement(
  document: CompositionDocument,
  placementId: string,
): CompositionDocument {
  assertValidCompositionDocument(document);
  const selected = requirePlacement(document, placementId);
  const deleteIds = new Set<string>([
    selected.id,
    ...getDescendants(document, selected.id).map(placement => placement.id),
  ]);
  const next = clone(document);
  next.placements = next.placements.filter(placement => !deleteIds.has(placement.id));
  assertValidCompositionDocument(next);
  return next;
}

/** Removes a link from a dependent placement without moving or mutating its source. */
export function unlinkCompositionPlacement(
  document: CompositionDocument,
  placementId: string,
): CompositionDocument {
  assertValidCompositionDocument(document);
  const selected = requirePlacement(document, placementId);
  if (!selected.linkedToPlacementId) throw new Error("Composition placement is not linked.");
  const next = clone(document);
  next.placements = next.placements.map(placement => {
    if (placement.id !== selected.id) return placement;
    const { linkedToPlacementId: _linkedToPlacementId, ...independent } = placement;
    return syncLegacyPlacement(independent);
  });
  assertValidCompositionDocument(next);
  return next;
}

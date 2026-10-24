/**
 * Production step order (V2-CUT-07). Pure helpers on a Storyboard; the engine wraps each change as one undo step.
 *
 * - The default order is the dependency walk in `productionSteps`: every asset before the shots that use it,
 *   references before what is made from them, and a last-frame asset right after its source shot.
 * - The user can reorder steps. The chosen order is kept as `Storyboard.stepOrder` (step keys) and is always
 *   applied as a stable topological sort, so a step never comes before something it needs. Steps that are
 *   not in the saved order (new shots or assets) keep their place next to their default neighbour.
 * - A move that would break dependency order is clamped to the nearest allowed place; `clampStepMove` says why.
 */
import type { Project } from "./model";
import type { Shot, Storyboard } from "./storyboard";

export type StepKey = string;
const slotKey = (id: string) => `slot:${id}`;
const shotKey = (id: string) => `shot:${id}`;
/** Same as storyRefs.shotRefIds plus the clip slot (kept here to avoid an import cycle with storyboard.ts). */
const shotNeeds = (b: Storyboard, s: Shot) =>
  [...new Set([...s.slotIds, ...(s.layers ?? []).flatMap((l) => (l.type === "text" ? [] : [l.asset])), ...(s.clipSlot ? [s.clipSlot] : [])])].filter((id) => !!b.slots[id]);

/** What each step needs first (step key → step keys), for every shot and asset slot. */
export function stepDeps(b: Storyboard): Map<StepKey, StepKey[]> {
  const deps = new Map<StepKey, StepKey[]>();
  for (const s of Object.values(b.slots)) {
    const need = s.references.filter((r) => b.slots[r]).map(slotKey);
    if (s.source.type === "lastFrame" && b.shots[s.source.shotId]) need.push(shotKey(s.source.shotId));
    deps.set(slotKey(s.id), need);
  }
  for (const s of Object.values(b.shots)) {
    // A shot needs its references (assets and media-layer assets) and, for html/still shots, its clip slot.
    deps.set(shotKey(s.id), shotNeeds(b, s).map(slotKey));
  }
  return deps;
}

/**
 * Apply the saved order to the default (dependency-walk) order. Stable: with no saved order, or one that
 * already respects dependencies, the result is exactly the preferred order.
 */
export function orderSteps(b: Storyboard, natural: StepKey[]): StepKey[] {
  if (!b.stepOrder?.length) return natural;
  const known = new Set(natural);
  const pref = b.stepOrder.filter((k, i, a) => known.has(k) && a.indexOf(k) === i);
  // Steps missing from the saved order go right after their default predecessor (or first).
  const placed = new Set(pref);
  natural.forEach((k, i) => {
    if (placed.has(k)) return;
    const prev = i > 0 ? pref.indexOf(natural[i - 1]) : -1;
    pref.splice(prev + 1, 0, k);
    placed.add(k);
  });
  const deps = stepDeps(b);
  const rank = new Map(pref.map((k, i) => [k, i]));
  const left = new Map(pref.map((k) => [k, (deps.get(k) ?? []).filter((d) => known.has(d) && d !== k).length]));
  const users = new Map<StepKey, StepKey[]>();
  for (const k of pref) for (const d of deps.get(k) ?? []) if (known.has(d) && d !== k) users.set(d, [...(users.get(d) ?? []), k]);
  const out: StepKey[] = [];
  const ready = pref.filter((k) => left.get(k) === 0);
  while (ready.length) {
    ready.sort((x, y) => rank.get(x)! - rank.get(y)!);
    const k = ready.shift()!;
    out.push(k);
    for (const u of users.get(k) ?? []) { const n = left.get(u)! - 1; left.set(u, n); if (n === 0) ready.push(u); }
  }
  // A dependency cycle cannot be imported, but never drop a step if one appears.
  for (const k of pref) if (!out.includes(k)) out.push(k);
  return out;
}

export interface StepMove { to: number; /** Set when the move was clamped: the step that stopped it. */ by?: StepKey; why?: "needs" | "usedBy" }

/** Clamp moving `keys[from]` to index `to` so it stays after what it needs and before what uses it. */
export function clampStepMove(b: Storyboard, keys: StepKey[], from: number, to: number): StepMove {
  const k = keys[from];
  to = Math.max(0, Math.min(keys.length - 1, to));
  if (!k || to === from) return { to: from };
  const deps = stepDeps(b);
  if (to < from) {
    const need = deps.get(k) ?? [];
    let last = -1;
    for (let i = from - 1; i >= 0; i -= 1) if (need.includes(keys[i])) { last = i; break; }
    return to > last ? { to } : { to: last + 1, by: keys[last], why: "needs" };
  }
  for (let i = from + 1; i < keys.length; i += 1) {
    if ((deps.get(keys[i]) ?? []).includes(k)) return to < i ? { to } : { to: i - 1, by: keys[i], why: "usedBy" };
  }
  return { to };
}

/** The furthest up and down `keys[from]` can go. */
export function stepMoveRange(b: Storyboard, keys: StepKey[], from: number): { min: number; max: number } {
  return { min: clampStepMove(b, keys, from, 0).to, max: clampStepMove(b, keys, from, keys.length - 1).to };
}

/** Move a step within `keys` (the current order), clamped to dependency order. Saves the whole order. */
export function moveStep(p: Project, keys: StepKey[], key: StepKey, to: number): Project {
  const b = p.storyboard;
  const from = keys.indexOf(key);
  if (!b || from < 0) return p;
  const m = clampStepMove(b, keys, from, to);
  if (m.to === from) return p;
  const next = [...keys];
  next.splice(from, 1);
  next.splice(m.to, 0, key);
  return { ...p, storyboard: { ...b, stepOrder: next } };
}

/** Go back to the default order. */
export function resetStepOrder(p: Project): Project {
  const b = p.storyboard;
  if (!b?.stepOrder) return p;
  const { stepOrder: _o, ...rest } = b;
  return { ...p, storyboard: rest };
}

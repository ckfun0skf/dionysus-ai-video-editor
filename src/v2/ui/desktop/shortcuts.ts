/** V2-107: desktop keyboard map (shown in the "?" overlay) and J/K/L shuttle logic. */
import { ops, type Composition } from "../../domain";
export const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl";

export type Shortcut = { keys: string[]; label: string };
export const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  { title: "Playback", items: [
    { keys: ["Space"], label: "Play / pause" },
    { keys: ["J", "K", "L"], label: "Shuttle back · stop · forward (press again for 2×, 4×, 8×)" },
    { keys: ["←", "→"], label: "Step one frame" },
    { keys: ["⇧ ←", "⇧ →"], label: "Jump one second" },
    { keys: ["Home", "End"], label: "Go to start / end" },
    { keys: ["↑", "↓"], label: "Jump to previous / next edit point" },
  ] },
  { title: "Editing", items: [
    { keys: ["S", `${MOD} B`, `${MOD} K`], label: "Split at the playhead (selected clips, else the main-track clip)" },
    { keys: ["Del"], label: "Delete selection (⇧ Del: ripple delete)" },
    { keys: [`${MOD} C`, `${MOD} X`, `${MOD} V`], label: "Copy / cut / paste at the playhead" },
    { keys: [`${MOD} D`], label: "Duplicate selection" },
    { keys: [`${MOD} A`], label: "Select all clips" },
    { keys: ["Alt ←", "Alt →"], label: "Nudge selected clip one frame (⇧ for 10)" },
    { keys: ["F"], label: "Freeze frame" },
    { keys: ["Q"], label: "Trim start to playhead" },
    { keys: ["W"], label: "Trim end to playhead" },
    { keys: ["T"], label: "Add text at the playhead" },
    { keys: ["R"], label: "Toggle ripple (shows Ripple on / off)" },
    { keys: ["Esc"], label: "Clear selection / close menus" },
  ] },
  { title: "Project & view", items: [
    { keys: [`${MOD} Z`, `⇧ ${MOD} Z`], label: "Undo / redo" },
    { keys: ["+", "−"], label: "Zoom timeline in / out" },
    { keys: ["⇧ Z"], label: "Zoom to fit" },
    { keys: [`${MOD} E`], label: "Export" },
    { keys: ["?"], label: "Show this list" },
  ] },
];

export const MAX_SHUTTLE = 8;
/** NLE-style shuttle: L speeds forward (1→2→4→8), J backward, K stops. Reversing direction starts at 1×. */
export function shuttleNext(rate: number, key: "j" | "k" | "l"): number {
  if (key === "k") return 0;
  if (key === "l") return rate <= 0 ? 1 : Math.min(MAX_SHUTTLE, rate * 2);
  return rate >= 0 ? -1 : Math.max(-MAX_SHUTTLE, rate * 2);
}
export const shuttleLabel = (rate: number) => (rate === 0 || rate === 1 ? "" : `${rate < 0 ? "◀ " : ""}${Math.abs(rate)}×`);

/** V2-110: every clip start/end on the timeline (plus 0), sorted and unique — the ↑/↓ edit points. */
export function editPoints(comp: Composition): number[] {
  const s = new Set<number>([0]);
  for (const t of comp.tracks) for (const p of t.placements) { s.add(p.startTicks); s.add(p.startTicks + p.durationTicks); }
  return [...s].sort((a, b) => a - b);
}
/** Previous (dir −1) or next (dir 1) edit point strictly away from `t` (half-frame tolerance), or undefined at the ends. */
export function jumpEditPoint(points: number[], t: number, dir: -1 | 1, tol = 1): number | undefined {
  return dir > 0 ? points.find((x) => x > t + tol) : [...points].reverse().find((x) => x < t - tol);
}
/** V2-110: Cmd/Ctrl+B / K targets — selected clips spanning `t`; if none do, the main-track clip under the playhead. */
export function splitTargets(comp: Composition, sel: string[], t: number): string[] {
  const inside = (p: { startTicks: number; durationTicks: number }) => p.startTicks < t && t < p.startTicks + p.durationTicks;
  const all = comp.tracks.flatMap((tr) => tr.placements);
  const picked = all.filter((p) => sel.includes(p.id) && inside(p)).map((p) => p.id);
  if (picked.length) return picked;
  // Nothing selected under the playhead: cut the main track there (Premiere Cmd+K on the targeted track).
  const m = ops.mainTrack(comp)?.placements.find(inside);
  return m ? [m.id] : [];
}

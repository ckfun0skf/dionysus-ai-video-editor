/** V2-107: desktop keyboard map (shown in the "?" overlay) and J/K/L shuttle logic. */
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
  ] },
  { title: "Editing", items: [
    { keys: ["S"], label: "Split selected clip at the playhead" },
    { keys: ["Del"], label: "Delete selection (⇧ Del: ripple delete)" },
    { keys: [`${MOD} C`, `${MOD} V`], label: "Copy / paste at the playhead" },
    { keys: [`${MOD} D`], label: "Duplicate selection" },
    { keys: [`${MOD} A`], label: "Select all clips" },
    { keys: ["Alt ←", "Alt →"], label: "Nudge selected clip one frame (⇧ for 10)" },
    { keys: ["F"], label: "Freeze frame" },
    { keys: ["T"], label: "Add text at the playhead" },
    { keys: ["R"], label: "Toggle ripple" },
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

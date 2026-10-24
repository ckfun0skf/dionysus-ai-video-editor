/** V2-106: desktop panel sizes (px), persisted in localStorage. Pure helpers so they are unit-testable. */
export type PanelSizes = { left: number; right: number; timeline: number; leftOpen: boolean; rightOpen: boolean };
export const LAYOUT_KEY = "v2.desktop.layout";
export const DEFAULT_SIZES: PanelSizes = { left: 320, right: 340, timeline: 300, leftOpen: true, rightOpen: true };
export const LIMITS = { left: [220, 560], right: [260, 560], timeline: [160, 640] } as const;
/** The preview column never gets narrower than this; the timeline leaves at least this much preview height. */
export const MIN_CENTER = 360;
export const MIN_PREVIEW_H = 220;

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.round(Math.min(hi, Math.max(lo, v)));

/** Clamp to limits and to the viewport so the preview always keeps a usable size. */
export function clampSizes(s: PanelSizes, vw = Infinity, vh = Infinity): PanelSizes {
  let left = clamp(s.left, LIMITS.left), right = clamp(s.right, LIMITS.right);
  const over = (s.leftOpen ? left : 0) + (s.rightOpen ? right : 0) + MIN_CENTER - vw;
  if (over > 0) {
    // Shrink the wider side first, never below its minimum.
    const takeR = s.rightOpen ? Math.min(over, right - LIMITS.right[0]) : 0;
    right -= takeR;
    if (s.leftOpen) left = Math.max(LIMITS.left[0], left - (over - takeR));
  }
  const timeline = Math.min(clamp(s.timeline, LIMITS.timeline), Math.max(LIMITS.timeline[0], vh - 48 - MIN_PREVIEW_H));
  return { left, right, timeline, leftOpen: s.leftOpen, rightOpen: s.rightOpen };
}

export function loadSizes(store: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): PanelSizes {
  try {
    const raw = JSON.parse(store?.getItem(LAYOUT_KEY) ?? "null") as Partial<PanelSizes> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SIZES };
    const num = (k: "left" | "right" | "timeline") => (typeof raw[k] === "number" && Number.isFinite(raw[k]) ? (raw[k] as number) : DEFAULT_SIZES[k]);
    const bool = (k: "leftOpen" | "rightOpen") => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : DEFAULT_SIZES[k]);
    return clampSizes({ left: num("left"), right: num("right"), timeline: num("timeline"), leftOpen: bool("leftOpen"), rightOpen: bool("rightOpen") });
  } catch { return { ...DEFAULT_SIZES }; }
}

export function saveSizes(s: PanelSizes, store: Pick<Storage, "setItem"> | undefined = globalThis.localStorage) {
  try { store?.setItem(LAYOUT_KEY, JSON.stringify(s)); } catch { /* private mode / quota: sizes just don't persist */ }
}

/** Canvas pixel size for the preview: the project aspect, longest side 1280 (16:9 → 1280×720 as before). */
export function previewCanvasSize(settings: { width: number; height: number }, longest = 1280) {
  const k = longest / Math.max(settings.width, settings.height, 1);
  return { width: Math.max(2, Math.round(settings.width * k)), height: Math.max(2, Math.round(settings.height * k)) };
}

/** Aspect presets shown in Project settings (CapCut/Premiere names). Sizes are the 1080-class canvas. */
export const ASPECTS = [
  { id: "16:9", label: "16:9", hint: "YouTube, landscape", width: 1920, height: 1080 },
  { id: "9:16", label: "9:16", hint: "TikTok, Reels, Shorts", width: 1080, height: 1920 },
  { id: "1:1", label: "1:1", hint: "Square post", width: 1080, height: 1080 },
  { id: "4:5", label: "4:5", hint: "Instagram portrait", width: 1080, height: 1350 },
  { id: "4:3", label: "4:3", hint: "Classic TV", width: 1440, height: 1080 },
  { id: "21:9", label: "21:9", hint: "Cinematic widescreen", width: 2560, height: 1080 },
] as const;
export const aspectOf = (s: { width: number; height: number }) => ASPECTS.find((a) => a.width * s.height === a.height * s.width)?.id;
export const FPS_CHOICES = [24, 25, 30, 50, 60] as const;
export const BACKGROUNDS = ["#000000", "#ffffff", "#1b1b1f", "#5ad1c8", "#f43f5e", "#f59e0b", "#3b82f6", "#22c55e"] as const;

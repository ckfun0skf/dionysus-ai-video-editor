import type { LucideIcon } from "lucide-react";
import { ChevronDown, Palette } from "lucide-react";
import { ChevronLeft, ChevronRight, MoveHorizontal, Replace, ArrowRightToLine, Library, Unlink, Bot, AudioWaveform, Headphones, Pipette, ScanSearch, Crosshair, Spline } from "lucide-react";
import {
  Clapperboard, Ellipsis, FileJson, Link2, CircleCheck, CircleAlert, ListTodo, ImageUp, RefreshCw,
  AudioLines, Blend, Check, ClipboardPaste, Code2, Copy, CopyPlus, Diamond, Download, FileAudio, FileDown, FileUp, Film, Gauge, ListChecks, Maximize, Menu, Minus,
  Music, Pause, Pencil, Play, Plus, Redo2, Rewind, ArrowLeftToLine, Scissors, SkipBack, SlidersHorizontal, Snowflake, Trash2, TriangleAlert, Type, Undo2,
  Image, Wand2, ArrowLeft, ArrowRight, Repeat, Sparkles, PictureInPicture2, Sticker, LayoutTemplate, Eye, EyeOff, Upload, Volume1, Volume2, VolumeX, X, ZoomIn, ZoomOut, Search, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, SkipForward, StepBack, StepForward, Keyboard, Settings2, Shrink, Captions, RotateCw, Magnet, Layers, ArrowUp, ArrowDown, GripVertical, Pin, ArrowUpToLine, ArrowDownToLine, Bookmark, BookmarkCheck, SeparatorVertical,
} from "lucide-react";

/**
 * One consistent stroke icon set (lucide) for the v2 UI. Call sites keep short legacy glyph keys
 * (e.g. "✂") so menus stay data; unknown keys fall back to the text itself.
 */
export const ICONS: Record<string, LucideIcon> = {
  board: Clapperboard, library: Library, unlink: Unlink, agent: Bot, "⋯": Ellipsis, json: FileJson, link: Link2, ok: CircleCheck, alert: CircleAlert, todo: ListTodo, "image-up": ImageUp, regen: RefreshCw, skip: SkipForward, "to-timeline": Film,
  "≡": Captions, "⟳": RotateCw, "🧲": Magnet,
  "✎": Pencil, "✕": X, "↶": Undo2, "↷": Redo2, "⏮": SkipBack, "❚❚": Pause, "▶": Play, "⇤": ArrowLeftToLine, "⧉": CopyPlus, "⎘": Copy,
  "📋": ClipboardPaste, "🗑": Trash2, "✓": Check, "⤓": FileAudio, "🔈": Volume1, "🔇": VolumeX, "🔊": Volume2, "❄": Snowflake, "⟲": Rewind,
  "⏩": Gauge, "✂": Scissors, "＋": Plus, "+": Plus, "－": Minus, "▭": Film, "♫": Music, "▤": AudioLines, "⤢": Search, "⤧": SlidersHorizontal,
  "☑": ListChecks, T: Type, "⇪": Upload, "⇩": Download, "srt-in": FileUp, "srt-out": FileDown, "film": Film, "⛶": Maximize, "☰": Menu, "◆": Diamond, "⧓": Blend, "⚠": TriangleAlert, "</>": Code2,
  "image": Image, "effect": Sparkles, "overlay": PictureInPicture2, "sticker": Sticker, "template": LayoutTemplate, "anim": Wand2, "grip": Menu, "prev": ChevronLeft, "next": ChevronRight, "anim-in": ArrowLeft, "anim-out": ArrowRight, "anim-loop": Repeat, "eye": Eye, "layers": Layers, "eye-off": EyeOff, "zoom-in": ZoomIn, "panel-close": PanelLeftClose, "panel-open": PanelLeftOpen, "panel-r-close": PanelRightClose, "panel-r-open": PanelRightOpen, "⏭": SkipForward, "step-back": StepBack, "step-fwd": StepForward, "keyboard": Keyboard, "settings": Settings2, "fit": Shrink, "zoom-out": ZoomOut, "↑": ArrowUp, "↓": ArrowDown, "grip-v": GripVertical, "pin": Pin, "to-top": ArrowUpToLine, "to-bottom": ArrowDownToLine, bookmark: Bookmark, bookmarked: BookmarkCheck, cut: SeparatorVertical, "trim-start": ArrowRightToLine, "trim-end": ArrowLeftToLine, "match": ScanSearch, track: Crosshair, chroma: Pipette, curve: Spline, afx: AudioWaveform, spatial: Headphones,
  palette: Palette, "▾": ChevronDown, "⇔": MoveHorizontal, "⇄": Replace, "🔗": Link2, "to-main": ArrowDownToLine,
};

/**
 * P32 "Merge up": an up arrow whose stem splits at the base into two curves that come in from the
 * left and right baselines — two layers joining into one. Same 24px grid, stroke and caps as lucide.
 */
export function MergeUpIcon({ size = 20, className }: { size?: number; className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`v2-ic ${className ?? ""}`} data-icon="merge">
    <path d="M12 3v11" /><path d="M8 7l4-4 4 4" /><path d="M3 21h3a6 6 0 0 0 6-6v-1" /><path d="M21 21h-3a6 6 0 0 1-6-6" />
  </svg>;
}

/** Keys drawn by our own SVGs (same style as lucide). */
/** P49: a rounded window — the clip-mask tool. Same stroke as the other icons. */
export function MaskIcon({ size = 20, className }: { size?: number; className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`v2-ic ${className ?? ""}`} data-icon="mask">
    <rect x="3.5" y="5" width="17" height="14" rx="3" />
    <circle cx="14.5" cy="12" r="3.25" />
  </svg>;
}

/** P60: Caption style (a subtitle bar with a middle word marked). */
export function CaptionStyleIcon({ size = 20, className }: { size?: number; className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`v2-ic ${className ?? ""}`} data-icon="caption-style">
    <rect x="3.5" y="6.5" width="17" height="11" rx="2.5" />
    <path d="M7 13h2.5" /><path d="M10.75 11v4" /><path d="M14.5 13h2.5" />
  </svg>;
}
/** P60: word-highlight — three marks, the middle one emphasised. */
export function WordHighlightIcon({ size = 20, className }: { size?: number; className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`v2-ic ${className ?? ""}`} data-icon="word-highlight">
    <path d="M4 15h4" /><path d="M10 8v9" /><path d="M16 15h4" />
  </svg>;
}
/** P60: word-pop — one word lifting off the line. */
export function WordPopIcon({ size = 20, className }: { size?: number; className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`v2-ic ${className ?? ""}`} data-icon="word-pop">
    <path d="M5 17h14" /><rect x="8" y="5.5" width="8" height="7" rx="1.5" /><path d="M12 12.5V17" />
  </svg>;
}
/** P60: no caption style — plain letters. */
export function CaptionNoneIcon({ size = 20, className }: { size?: number; className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`v2-ic ${className ?? ""}`} data-icon="caption-none">
    <path d="M7 17l4.5-10L16 17" /><path d="M8.6 13.5h6.8" />
  </svg>;
}

export const CUSTOM_ICONS: Record<string, (p: { size?: number; className?: string }) => JSX.Element> = {
  merge: MergeUpIcon, mask: MaskIcon,
  "caption-style": CaptionStyleIcon, "word-highlight": WordHighlightIcon, "word-pop": WordPopIcon, "caption-none": CaptionNoneIcon,
};

export function Ic({ g, size = 20, className }: { g: string; size?: number; className?: string }) {
  const K = CUSTOM_ICONS[g];
  if (K) return <K size={size} className={className} />;
  const C = ICONS[g];
  if (!C) return <>{g}</>;
  return <C size={size} strokeWidth={1.75} aria-hidden className={`v2-ic ${className ?? ""}`} data-icon={g} />;
}

import type { LucideIcon } from "lucide-react";
import {
  AudioLines, Blend, Check, ClipboardPaste, Code2, Copy, CopyPlus, Diamond, Download, FileAudio, Film, Gauge, ListChecks, Maximize, Menu, Minus,
  Music, Pause, Pencil, Play, Plus, Redo2, Rewind, ArrowLeftToLine, Scissors, SkipBack, SlidersHorizontal, Snowflake, Trash2, TriangleAlert, Type, Undo2,
  Image, Wand2, ArrowLeft, ArrowRight, Repeat, Sparkles, PictureInPicture2, Sticker, LayoutTemplate, Eye, EyeOff, Upload, Volume1, Volume2, VolumeX, X, ZoomIn, ZoomOut, Search, PanelLeftClose, PanelLeftOpen, Captions, RotateCw, Magnet,
} from "lucide-react";

/**
 * One consistent stroke icon set (lucide) for the v2 UI. Call sites keep short legacy glyph keys
 * (e.g. "✂") so menus stay data; unknown keys fall back to the text itself.
 */
export const ICONS: Record<string, LucideIcon> = {
  "≡": Captions, "⟳": RotateCw, "🧲": Magnet,
  "✎": Pencil, "✕": X, "↶": Undo2, "↷": Redo2, "⏮": SkipBack, "❚❚": Pause, "▶": Play, "⇤": ArrowLeftToLine, "⧉": CopyPlus, "⎘": Copy,
  "📋": ClipboardPaste, "🗑": Trash2, "✓": Check, "⤓": FileAudio, "🔈": Volume1, "🔇": VolumeX, "🔊": Volume2, "❄": Snowflake, "⟲": Rewind,
  "⏩": Gauge, "✂": Scissors, "＋": Plus, "+": Plus, "－": Minus, "▭": Film, "♫": Music, "▤": AudioLines, "⤢": Search, "⤧": SlidersHorizontal,
  "☑": ListChecks, T: Type, "⇪": Upload, "⇩": Download, "⛶": Maximize, "☰": Menu, "◆": Diamond, "⧓": Blend, "⚠": TriangleAlert, "</>": Code2,
  "image": Image, "effect": Sparkles, "overlay": PictureInPicture2, "sticker": Sticker, "template": LayoutTemplate, "anim": Wand2, "grip": Menu, "anim-in": ArrowLeft, "anim-out": ArrowRight, "anim-loop": Repeat, "eye": Eye, "eye-off": EyeOff, "zoom-in": ZoomIn, "panel-close": PanelLeftClose, "panel-open": PanelLeftOpen, "zoom-out": ZoomOut,
};

export function Ic({ g, size = 20, className }: { g: string; size?: number; className?: string }) {
  const C = ICONS[g];
  if (!C) return <>{g}</>;
  return <C size={size} strokeWidth={1.75} aria-hidden className={`v2-ic ${className ?? ""}`} data-icon={g} />;
}

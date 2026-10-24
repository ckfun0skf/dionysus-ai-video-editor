import type { LucideIcon } from "lucide-react";
import {
  Clapperboard, Ellipsis, FileJson, Link2, CircleCheck, CircleAlert, ListTodo, ImageUp, RefreshCw,
  AudioLines, Blend, Check, ClipboardPaste, Code2, Copy, CopyPlus, Diamond, Download, FileAudio, Film, Gauge, ListChecks, Maximize, Menu, Minus,
  Music, Pause, Pencil, Play, Plus, Redo2, Rewind, ArrowLeftToLine, Scissors, SkipBack, SlidersHorizontal, Snowflake, Trash2, TriangleAlert, Type, Undo2,
  Image, Wand2, ArrowLeft, ArrowRight, Repeat, Sparkles, PictureInPicture2, Sticker, LayoutTemplate, Eye, EyeOff, Upload, Volume1, Volume2, VolumeX, X, ZoomIn, ZoomOut, Search, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, SkipForward, StepBack, StepForward, Keyboard, Settings2, Shrink, Captions, RotateCw, Magnet, Layers,
} from "lucide-react";

/**
 * One consistent stroke icon set (lucide) for the v2 UI. Call sites keep short legacy glyph keys
 * (e.g. "✂") so menus stay data; unknown keys fall back to the text itself.
 */
export const ICONS: Record<string, LucideIcon> = {
  board: Clapperboard, "⋯": Ellipsis, json: FileJson, link: Link2, ok: CircleCheck, alert: CircleAlert, todo: ListTodo, "image-up": ImageUp, regen: RefreshCw, skip: SkipForward, "to-timeline": Film,
  "≡": Captions, "⟳": RotateCw, "🧲": Magnet,
  "✎": Pencil, "✕": X, "↶": Undo2, "↷": Redo2, "⏮": SkipBack, "❚❚": Pause, "▶": Play, "⇤": ArrowLeftToLine, "⧉": CopyPlus, "⎘": Copy,
  "📋": ClipboardPaste, "🗑": Trash2, "✓": Check, "⤓": FileAudio, "🔈": Volume1, "🔇": VolumeX, "🔊": Volume2, "❄": Snowflake, "⟲": Rewind,
  "⏩": Gauge, "✂": Scissors, "＋": Plus, "+": Plus, "－": Minus, "▭": Film, "♫": Music, "▤": AudioLines, "⤢": Search, "⤧": SlidersHorizontal,
  "☑": ListChecks, T: Type, "⇪": Upload, "⇩": Download, "⛶": Maximize, "☰": Menu, "◆": Diamond, "⧓": Blend, "⚠": TriangleAlert, "</>": Code2,
  "image": Image, "effect": Sparkles, "overlay": PictureInPicture2, "sticker": Sticker, "template": LayoutTemplate, "anim": Wand2, "grip": Menu, "anim-in": ArrowLeft, "anim-out": ArrowRight, "anim-loop": Repeat, "eye": Eye, "layers": Layers, "eye-off": EyeOff, "zoom-in": ZoomIn, "panel-close": PanelLeftClose, "panel-open": PanelLeftOpen, "panel-r-close": PanelRightClose, "panel-r-open": PanelRightOpen, "⏭": SkipForward, "step-back": StepBack, "step-fwd": StepForward, "keyboard": Keyboard, "settings": Settings2, "fit": Shrink, "zoom-out": ZoomOut,
};

export function Ic({ g, size = 20, className }: { g: string; size?: number; className?: string }) {
  const C = ICONS[g];
  if (!C) return <>{g}</>;
  return <C size={size} strokeWidth={1.75} aria-hidden className={`v2-ic ${className ?? ""}`} data-icon={g} />;
}

/** Shared file-drag helpers: accept matching, a flicker-safe highlight, and overlay navigation guard. */
import { useRef, useState, type DragEvent as ReactDragEvent, type DragEventHandler } from "react";

export function hasFileDrag(e: { dataTransfer?: DataTransfer | null }): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types as ArrayLike<string>).includes("Files");
}

/**
 * True when `file` matches an `<input accept>` list: MIME tokens (`image/*`, `text/html`) and
 * extensions (`.glb`, `.zip`). Empty type still matches by extension — browsers often leave .glb blank.
 */
const WILDCARD_EXTS: Record<string, readonly string[]> = {
  "image/": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico", ".tif", ".tiff", ".heic", ".heif"],
  "video/": [".mp4", ".webm", ".mov", ".mkv", ".m4v", ".ogv"],
  "audio/": [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".opus"],
};

export function fileMatchesAccept(file: File, accept: string): boolean {
  const tokens = accept.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? `.${name.slice(name.lastIndexOf(".") + 1)}` : "";
  return tokens.some((t) => {
    if (t.endsWith("/*")) {
      const prefix = t.slice(0, -1);
      return type.startsWith(prefix) || (WILDCARD_EXTS[prefix] ?? []).includes(ext);
    }
    if (t.startsWith(".")) return ext === t;
    return type === t;
  });
}

export type FileDragHandlers = {
  onDragEnter: DragEventHandler;
  onDragOver: DragEventHandler;
  onDragLeave: DragEventHandler;
  onDrop: DragEventHandler;
};

/** Counter-based drag highlight so entering a child does not flicker `over` off. */
export function useFileDrag(onFiles: (files: FileList) => void): { over: boolean; handlers: FileDragHandlers } {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const reset = () => { depth.current = 0; setOver(false); };
  return {
    over,
    handlers: {
      onDragEnter: (e) => {
        if (!hasFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e) => {
        if (!hasFileDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (e) => {
        if (!hasFileDrag(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e) => {
        const files = e.dataTransfer?.files;
        if (!files?.length) {
          if (hasFileDrag(e)) e.preventDefault();
          reset();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        reset();
        onFiles(files);
      },
    },
  };
}

/** Stop the browser from navigating to a dropped file on an overlay that is not itself the drop target. */
export const preventFileNav = {
  onDragOver: (e: ReactDragEvent) => { if (hasFileDrag(e)) e.preventDefault(); },
  onDrop: (e: ReactDragEvent) => { if (hasFileDrag(e)) e.preventDefault(); },
};

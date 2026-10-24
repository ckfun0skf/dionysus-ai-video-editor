/**
 * Save a file from the app to the device. Where the Web Share API can share files (iOS / Android), it opens the share
 * sheet, so "Save Image" / "Save to Files" work on iPhone. Elsewhere it falls back to a blob download link.
 * Call it straight from a click handler with the blob already loaded: Safari only shares within the user's tap.
 */
export type SaveResult = "shared" | "downloaded" | "cancelled";

const isTouch = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

export async function saveFile(blob: Blob, name: string, opts: { preferShare?: boolean } = {}): Promise<SaveResult> {
  const file = typeof File === "function" ? new File([blob], name, { type: blob.type || "application/octet-stream" }) : undefined;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const share = (opts.preferShare ?? isTouch()) && file && nav?.share && nav.canShare?.({ files: [file] });
  if (share) {
    try { await nav!.share({ files: [file!], title: name }); return "shared"; } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // NotAllowedError (the tap expired) and others: fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener"; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "downloaded";
}

/** A file name extension for a mime type ("image/png" → "png"). */
export function extFor(mime: string): string {
  const sub = (mime.split("/")[1] ?? "").split(";")[0].toLowerCase();
  return ({ jpeg: "jpg", "svg+xml": "svg", quicktime: "mov", "x-matroska": "mkv", html: "html", mpeg: "mp3" } as Record<string, string>)[sub] ?? (sub.replace(/[^a-z0-9]/g, "") || "bin");
}

/** A safe file name from free text ("Mara's flat" → "Maras-flat"). */
export const safeName = (s: string) => s.normalize("NFKD").replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "file";

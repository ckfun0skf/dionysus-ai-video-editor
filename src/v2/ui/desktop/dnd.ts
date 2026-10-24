/** V2-106: drag payloads from the desktop asset browser to the timeline. */
export const ASSET_MIME = "application/x-dionysus-asset";
export const ITEM_MIME = "application/x-dionysus-item";
export type DragItem =
  | { kind: "text"; template?: string }
  | { kind: "sticker"; id: string }
  | { kind: "effect"; id: string }
  | { kind: "library"; id: string };

export function setDragItem(dt: DataTransfer, item: DragItem) {
  dt.setData(ITEM_MIME, JSON.stringify(item));
  dt.effectAllowed = "copy";
}
export function readDragItem(dt: DataTransfer): DragItem | undefined {
  try {
    const v = JSON.parse(dt.getData(ITEM_MIME) || "null") as DragItem | null;
    return v && ["text", "sticker", "effect", "library"].includes(v.kind) ? v : undefined;
  } catch { return undefined; }
}
/** True while the drag carries OS files (types are readable during dragover; files only on drop). */
export const hasFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types ?? []).includes("Files");

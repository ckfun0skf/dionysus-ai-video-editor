import { applyPreset, listPresets } from "../registry";

/** Built-in stickers (SVG, rasterised to PNG on add so they render like any image clip). */
export type Sticker = { id: string; name: string; svg: string };
/** Sticker list comes from the preset registry. */
export const stickers = (): Sticker[] => listPresets("sticker").map((d) => ({ id: d.id, name: d.name, svg: String(applyPreset("sticker", d.id, 0).svg ?? "") }));
export const stickerUrl = (s: Sticker) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`;
export async function stickerFile(s: Sticker): Promise<File> {
  const img = new Image();
  img.src = stickerUrl(s);
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = 400;
  c.getContext("2d")!.drawImage(img, 0, 0, 400, 400);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("sticker render failed"))), "image/png"));
  return new File([blob], `sticker-${s.id}.png`, { type: "image/png" });
}

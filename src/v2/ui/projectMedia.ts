import type { Project } from "../domain";
import type { ProjectMedia } from "./MediaPicker";

/** Every video/image/HTML (code)/audio asset imported into the project (even if no clip uses it any more), newest first.
 * Built-in stickers are excluded: they live in the Sticker tab. */
export function projectMediaList(project: Project, thumbs: Record<string, string> = {}): ProjectMedia[] {
  const out: ProjectMedia[] = [];
  for (const a of Object.values(project.assets)) {
    if (a.kind !== "video" && a.kind !== "image" && a.kind !== "audio" && a.kind !== "html") continue;
    if (a.name.startsWith("sticker-")) continue;
    const v = a.versions.find((x) => x.id === a.selectedVersionId) ?? a.versions[a.versions.length - 1];
    if (!v) continue;
    out.push({ id: a.id, name: a.name, kind: a.kind, thumb: thumbs[a.id], durationTicks: v.media.durationTicks, createdAt: a.versions[0].createdAt });
  }
  return out.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

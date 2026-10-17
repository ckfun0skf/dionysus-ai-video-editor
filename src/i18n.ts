/**
 * Central UI message catalog.
 *
 * Keep user-facing interface copy here rather than embedding it in components.
 * Add locale catalogs with the same keys and switch the active locale in one
 * place when a language selector is introduced.
 */
export const messages = {
  en: {
    "brand.subtitle": "AI VIDEO COMPOSER",
    "nav.workspace": "WORKSPACE",
    "nav.create": "CREATE",
    "nav.storyboard": "Storyboard",
    "nav.timeline": "Timeline",
    "nav.assets": "Assets",
    "nav.references": "References",
    "project.local": "Local project",
    "storage.title": "Local-first workspace",
    "storage.description": "Your project stays in this browser.",
    "nav.settings": "Settings",
    "nav.help": "Help & documentation",
    "user.workspace": "Creator workspace",
    "breadcrumb.projects": "Projects",
    "action.openProject": "Open project",
    "action.exportProject": "Export project",
    "action.exportPlan": "Export AI plan",
    "heading.eyebrow": "YOUR CREATIVE WORKSPACE",
    "heading.storyboard.title": "Storyboard",
    "heading.storyboard.description": "Shape the story first. Build the edit when you're ready.",
    "heading.timeline.title": "Timeline editor",
    "heading.timeline.description": "Arrange clips, versions, and layers into a sequence.",
    "heading.assets.title": "Asset library",
    "heading.assets.description": "Keep source media reusable and organized.",
    "heading.references.title": "Reference library",
    "heading.references.description": "Keep character and visual references consistent across shots.",
    "status.autosaved": "Autosaved locally",
    "project.current": "CURRENT PROJECT",
    "project.name": "Project name",
    "project.runtime": "planned runtime",
    "project.shots": "shots",
    "project.clipSlots": "clip slots",
    "project.canvas": "CANVAS",
    "project.frameRate": "FRAME RATE",
    "project.canvasSettingsPlanned": "Canvas settings planned",
    "notice.canvasSettingsUnavailable": "Canvas settings are not editable in this milestone.",
    "storyboard.title": "Story beats",
    "storyboard.description": "shots · independent timeline editing",
    "action.addShot": "Add shot",
    "shot.emptyIntent": "Add a short description of what happens in this shot.",
    "shot.addAnother": "Add another story beat",
    "shot.addAnotherHint": "Start with intent, references, and timing",
    "timeline.title": "Master timeline",
    "timeline.description": "Storyboard plan · independent timeline editing",
    "action.addClipSlot": "Add clip slot",
    "timeline.planningNote": "Planning timeline only. Frame-accurate trimming, waveforms, and compositing are planned milestones.",
    "assets.title": "Project assets",
    "assets.description": "Reusable media and procedural resources",
    "action.addAsset": "Add asset",
    "assets.emptyTitle": "Your asset library is ready",
    "assets.emptyDescription": "Add source videos, images, audio, and scripts when asset import is available.",
    "action.importAssets": "Import assets",
    "notice.assetImportPlanned": "Asset importing is planned.",
    "notice.assetImportUnavailable": "Asset import is not implemented yet.",
    "references.title": "Reference profiles",
    "references.description": "Character, environment, prop, and style groups",
    "action.newProfile": "New profile",
    "references.emptyTitle": "Build consistent visual identities",
    "references.emptyDescription": "Group fixed character references, then override outfit, pose, or lighting per shot without changing the global profile.",
    "reference.identity": "Identity",
    "reference.face": "Face",
    "reference.outfit": "Outfit",
    "reference.lighting": "Lighting",
    "notice.referenceEditingPlanned": "Reference profile editing is planned; project schema supports profiles.",
    "inspector.title": "INSPECTOR",
    "inspector.shotDetails": "Shot details",
    "inspector.projectDetails": "Project details",
    "inspector.shotTitle": "SHOT TITLE",
    "inspector.storyIntent": "STORY INTENT",
    "inspector.intentPlaceholder": "What happens in this shot? What should the audience feel or learn?",
    "inspector.targetDuration": "TARGET DURATION",
    "inspector.seconds": "sec",
    "inspector.status": "STATUS",
    "status.planned": "Planned",
    "status.in-progress": "In progress",
    "status.ready": "Ready",
    "inspector.clipSlots": "CLIP SLOTS",
    "action.showSlotDetails": "Show slot details",
    "inspector.aiPlanning": "AI PLANNING",
    "inspector.aiHint": "Shot intent and reference requirements will become inputs for future AI-assisted planning.",
    "inspector.empty": "Select a shot to edit its details.",
    "status.localOnlyNotice": "All changes stay in this browser until exported.",
    "notice.storageFull": "Browser storage is full. Export your project to avoid losing changes.",
    "notice.multiProjectPlanned": "Multi-project switching is planned.",
    "notice.projectSettingsPlanned": "Project settings are planned.",
    "notice.helpDocs": "See docs/PRD.md for product requirements.",
    "notice.shotAdded": "Shot added.",
    "notice.clipSlotAdded": "Clip slot added.",
    "notice.projectExported": "Project JSON exported.",
    "notice.planExported": "AI execution plan exported.",
    "error.invalidProject": "Unsupported or invalid project format. Check that the file is a complete Dionysus schema 1.0 project.",
    "notice.projectImported": "Project imported successfully.",
    "error.importFailed": "Could not import this project.",
    "notice.slotDetails": "{name} · {count} version(s)",
    "notice.slotSelectedVersion": "{name}: selected version {versionId}",
    "footer.schema": "Project schema 1.0",
    "footer.localFirst": "Local-first",
    "footer.aiReady": "AI-ready foundation",
    "version.foundation": "v0.1 foundation",
    "timeline.addLayer": "Add {kind} layer",
    "shot.durationTarget": "{duration}s target",
    "slot.versionCount": "{duration}s · {count} version(s)",
    "references.count": "{count} references",
    "brand.name": "DIONYSUS",
    "status.localBadge": "LOCAL",
    "project.versionFoundation": "v0.1 foundation",
    "action.openProject": "Open project",
    "action.exportProject": "Export project",
    "action.exportPlan": "Export AI plan",
    "project.runtimeSummary": "{duration} planned runtime",
    "project.shotCount": "{count} shots",
    "project.clipSlotCount": "{count} clip slots",
    "storyboard.shotCount": "{count} shots · independent timeline editing",
    "shot.emptyIntent": "Add a short description of what happens in this shot.",
    "shot.durationTarget": "{duration}s target",
    "shot.clipSlotCount": "{count} clip slots",
    "slot.versionCount": "{duration}s · {count} version(s)",
    "timeline.trackAddLayer": "Add {kind} layer",
    "inspector.secondsShort": "sec",
    "asset.actionAdd": "Add asset",
    "asset.actionImport": "Import assets",
    "references.actionNewProfile": "New profile",
    "profile.referencesCount": "{count} references",
    "footer.projectSchema": "Project schema 1.0",
    "footer.localFirst": "Local-first",
    "shot.defaultTitle": "New shot",
    "slot.defaultName": "New clip",
    "slot.defaultPrefix": "Clip "

  }
} as const;

export type Locale = keyof typeof messages;
export type TranslationKey = keyof typeof messages.en;

let activeLocale: Locale = "en";

/** Change this centrally now; a UI language selector can call it in a later milestone. */
export function setLocale(locale: Locale): void {
  activeLocale = locale;
}

export function getLocale(): Locale {
  return activeLocale;
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const template: string = messages[activeLocale][key] ?? messages.en[key];
  return params
    ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? "{" + name + "}"))
    : template;
}

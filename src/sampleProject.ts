import type { DionysusProject } from "./types";
const version = (id: string, duration: number, description: string) => ({ id, name: "Version A", description, duration, layers: [], scriptVersionIds: [], generationRecords: [] });
export const sampleProject: DionysusProject = {
  schemaVersion: "1.0", id: "project-dionysus-demo", name: "Untitled film",
  createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z",
  frameRate: 24, width: 3840, height: 2160, assets: [], referenceProfiles: [],
  tracks: [
    { id: "track-video-1", name: "Video 1", kind: "video" },
    { id: "track-video-2", name: "Video 2", kind: "video" },
    { id: "track-audio-1", name: "Music", kind: "audio" },
    { id: "track-text-1", name: "Titles", kind: "text" }
  ],
  shots: [
    { id: "shot-01", title: "01 · The awakening", intent: "Introduce the central character and establish the visual language.", duration: 8, status: "planned", referenceProfileIds: [], referenceOverrides: [], slots: [
      { id: "slot-01-a", name: "Opening image", start: 0, duration: 4, selectedVersionId: "version-01-a", versions: [version("version-01-a", 4, "Wide establishing composition")] },
      { id: "slot-01-b", name: "Character reveal", start: 4, duration: 4, selectedVersionId: "version-01-b", versions: [version("version-01-b", 4, "Slow reveal, close framing")] }
    ]},
    { id: "shot-02", title: "02 · A new question", intent: "The character notices something unexpected.", duration: 6, status: "planned", referenceProfileIds: [], referenceOverrides: [], slots: [
      { id: "slot-02-a", name: "Discovery", start: 0, duration: 6, selectedVersionId: "version-02-a", versions: [version("version-02-a", 6, "Reaction shot")] }
    ]}
  ]
};

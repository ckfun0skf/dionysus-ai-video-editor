import type { DionysusProject } from "./types";
const version = (id: string, duration: number, description: string) => ({ id, name: "Version A", description, duration, layers: [], scriptVersionIds: [], generationRecords: [] });
export const sampleProject: DionysusProject = {
  schemaVersion: "1.0", id: "project-dionysus-demo", name: "Cyberpunk Awakening",
  createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z",
  frameRate: 24, width: 3840, height: 2160, assets: [],
  referenceProfiles: [],
  timelineClips: [],
  storyboardConnections: [
    { fromShotId: "shot-01", toShotId: "shot-02", label: "Cut to Close-up" },
    { fromShotId: "shot-02", toShotId: "shot-03", label: "Match Cut on Reveal" }
  ],
  tracks: [
    { id: "track-video-1", name: "Main Video", kind: "video" },
    { id: "track-video-2", name: "Overlay / PiP", kind: "video" },
    { id: "track-audio-1", name: "Soundtrack", kind: "audio" },
    { id: "track-text-1", name: "Dialogue & Subtitles", kind: "text" }
  ],
  shots: [
    {
      id: "shot-01",
      title: "01 · City Awakening",
      intent: "Establish the rain-drenched cyberpunk metropolis and introduce Kaelen atop the skyscraper.",
      duration: 6,
      status: "ready",
      canvasX: 80,
      canvasY: 90,
      shotType: "establishing",
      cameraMovement: "Slow Push-In",
      generationPrompt: "Cinematic wide establishing shot of a futuristic neon-lit metropolis at dusk, solitary figure standing on a rain-slicked rooftop, moody cyberpunk atmosphere, 8k resolution, volumetric fog.",
      referenceProfileIds: [],
      referenceOverrides: [],
      slots: [
        { id: "slot-01-a", name: "Opening image", start: 0, duration: 6, selectedVersionId: "version-01-a", versions: [version("version-01-a", 6, "Opening image composition")] }
      ]
    },
    {
      id: "shot-02",
      title: "02 · The Holographic Glitch",
      intent: "Kaelen's ocular implant detects a strange distorted signal floating in mid-air.",
      duration: 5,
      status: "in-progress",
      canvasX: 470,
      canvasY: 90,
      shotType: "close-up",
      cameraMovement: "Rack Focus",
      generationPrompt: "Extreme close-up on Kaelen's eyes reflecting a flickering blue holographic glyph, raindrops dripping down a metallic jawline, shallow depth of field, anamorphic bokeh.",
      referenceProfileIds: [],
      referenceOverrides: [],
      slots: [
        { id: "slot-02-a", name: "Eye Reaction", start: 0, duration: 5, selectedVersionId: "version-02-a", versions: [version("version-02-a", 5, "Reaction shot with eye glow")] }
      ]
    },
    {
      id: "shot-03",
      title: "03 · Descent into the Shadows",
      intent: "Kaelen turns and dashes down the emergency fire escape staircase into the alleys below.",
      duration: 7,
      status: "planned",
      canvasX: 860,
      canvasY: 90,
      shotType: "medium",
      cameraMovement: "Tracking Follow",
      generationPrompt: "Medium dynamic tracking shot following Kaelen descending an industrial metal fire escape, sparks showering from neon signs, intense motion blur, rain cascading down.",
      referenceProfileIds: [],
      referenceOverrides: [],
      slots: [
        { id: "slot-03-a", name: "Escape Run", start: 0, duration: 7, selectedVersionId: "version-03-a", versions: [version("version-03-a", 7, "Dynamic camera follow")] }
      ]
    }
  ]
};

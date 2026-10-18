import type { DionysusProject, Shot, StoryboardConnection } from "./types";

export interface AgentStoryboardImportData {
  projectName?: string;
  shots: Array<{
    title: string;
    intent: string;
    durationSeconds?: number;
    shotType?: "wide" | "medium" | "close-up" | "extreme-close-up" | "aerial" | "point-of-view";
    cameraMovement?: string;
    generationPrompt: string;
    negativePrompt?: string;
    requiredCharacters?: string[];
    requiredLocations?: string[];
    nextShotIndex?: number;
    transitionLabel?: string;
  }>;
  characters?: Array<{
    name: string;
    visualDescription: string;
    clothingStyle?: string;
  }>;
  environments?: Array<{
    name: string;
    visualDescription: string;
  }>;
}

/**
 * System prompt template to copy-paste into ChatGPT, Claude, Gemini, etc.
 * to generate a storyboard formatted for 1-click import into Dionysus.
 */
export const AGENT_BRAINSTORM_SYSTEM_PROMPT = `You are a visionary AI film director and storyboard master.
Help me brainstorm and develop a cinematic video concept, then output the entire storyboard as a single, strictly valid JSON code block that I can import directly into Dionysus AI Video Composer.

JSON Structure required:
\`\`\`json
{
  "projectName": "Title of the Film or Video",
  "characters": [
    {
      "name": "Character Name",
      "visualDescription": "Detailed visual features, face, hair, distinctive traits for consistency across AI image generators",
      "clothingStyle": "Outfit details"
    }
  ],
  "environments": [
    {
      "name": "Location Name",
      "visualDescription": "Lighting, atmosphere, architectural style, weather, color palette"
    }
  ],
  "shots": [
    {
      "title": "01 · Shot Name",
      "intent": "Dramatic narrative beat and emotional goal of this shot",
      "durationSeconds": 5,
      "shotType": "wide", // "wide" | "medium" | "close-up" | "extreme-close-up" | "aerial" | "point-of-view"
      "cameraMovement": "Slow push-in, static, orbital pan, or dynamic tracking",
      "generationPrompt": "Complete, ready-to-run prompt for Midjourney/Flux/Kling/Runway, including subject, lighting, mood, camera lens, and aesthetic styling",
      "requiredCharacters": ["Character Name"],
      "requiredLocations": ["Location Name"],
      "nextShotIndex": 1, // index of the next shot (0-based) to connect in the flow
      "transitionLabel": "Cut on action / Match cut / Dissolve"
    }
  ]
}
\`\`\`

Guidelines:
1. Plan 6 to 12 cohesive shots with clear narrative progression (Setup -> Catalyst -> Rising Beat -> Climax -> Resolution).
2. Write rich, vivid, production-ready 'generationPrompt's for each shot.
3. Keep character visual descriptions precise so AI image generation maintains visual continuity.
4. Output ONLY the raw JSON block inside \`\`\`json ... \`\`\`.`;

/**
 * Converts imported Agent Storyboard JSON into Dionysus project structures.
 */
export function importAgentStoryboard(
  currentProject: DionysusProject,
  jsonText: string
): { success: boolean; project?: DionysusProject; error?: string; count?: number } {
  try {
    // Strip markdown code block wrappers if present
    let cleaned = jsonText.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.replace(/^```json\s*/, "").replace(/```$/, "").trim();
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```\s*/, "").replace(/```$/, "").trim();
    }

    const parsed: unknown = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") {
      return { success: false, error: "Parsed JSON must be an object." };
    }

    const data = parsed as AgentStoryboardImportData;
    if (!Array.isArray(data.shots) || data.shots.length === 0) {
      return { success: false, error: "The imported storyboard must contain an array of 'shots' with at least 1 shot." };
    }

    const now = new Date().toISOString();
    const id = (prefix: string) => prefix + "-" + crypto.randomUUID();

    // Map character and environment profiles
    const newProfiles = [...currentProject.referenceProfiles];
    const profileNameToId = new Map<string, string>();

    // Index existing profiles
    currentProject.referenceProfiles.forEach(p => profileNameToId.set(p.name.toLowerCase(), p.id));

    if (Array.isArray(data.characters)) {
      data.characters.forEach(char => {
        if (!char.name) return;
        const key = char.name.toLowerCase();
        if (!profileNameToId.has(key)) {
          const profileId = id("profile-char");
          newProfiles.push({
            id: profileId,
            name: char.name,
            entityType: "character",
            references: []
          });
          profileNameToId.set(key, profileId);
        }
      });
    }

    if (Array.isArray(data.environments)) {
      data.environments.forEach(env => {
        if (!env.name) return;
        const key = env.name.toLowerCase();
        if (!profileNameToId.has(key)) {
          const profileId = id("profile-env");
          newProfiles.push({
            id: profileId,
            name: env.name,
            entityType: "environment",
            references: []
          });
          profileNameToId.set(key, profileId);
        }
      });
    }

    // Create shots with SeeDance 2D coordinates in a pleasing grid / flow layout
    const createdShots: Shot[] = [];
    const connections: StoryboardConnection[] = [];

    const columnCount = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(data.shots.length * 1.5))));
    const nodeWidth = 360;
    const nodeHeight = 340;
    const startX = 60;
    const startY = 80;

    data.shots.forEach((shotData, index) => {
      const shotId = id("shot");
      const slotId = id("slot");
      const versionId = id("version");
      const duration = Math.max(1, Number(shotData.durationSeconds) || 5);

      const col = index % columnCount;
      const row = Math.floor(index / columnCount);
      const canvasX = startX + col * (nodeWidth + 70);
      const canvasY = startY + row * (nodeHeight + 70);

      const assignedProfileIds: string[] = [];
      if (Array.isArray(shotData.requiredCharacters)) {
        shotData.requiredCharacters.forEach(name => {
          const pId = profileNameToId.get(name.toLowerCase());
          if (pId && !assignedProfileIds.includes(pId)) assignedProfileIds.push(pId);
        });
      }
      if (Array.isArray(shotData.requiredLocations)) {
        shotData.requiredLocations.forEach(name => {
          const pId = profileNameToId.get(name.toLowerCase());
          if (pId && !assignedProfileIds.includes(pId)) assignedProfileIds.push(pId);
        });
      }

      const prompt = shotData.generationPrompt || shotData.intent || "Cinematic visual";

      const shot: Shot = {
        id: shotId,
        title: shotData.title || `Shot ${String(index + 1).padStart(2, "0")}`,
        intent: shotData.intent || "",
        duration,
        status: "planned",
        canvasX,
        canvasY,
        generationPrompt: prompt,
        cameraMovement: shotData.cameraMovement || "Static",
        shotType: shotData.shotType || (index === 0 ? "establishing" : "medium"),
        referenceProfileIds: assignedProfileIds,
        referenceOverrides: [],
        slots: [
          {
            id: slotId,
            name: shotData.title || `Slot ${index + 1}`,
            start: 0,
            duration,
            selectedVersionId: versionId,
            versions: [
              {
                id: versionId,
                name: "Version A",
                description: "Initial AI draft storyboard beat",
                duration,
                layers: [
                  {
                    id: id("layer"),
                    name: "Primary visual",
                    kind: "image",
                    start: 0,
                    duration,
                    prompt,
                    fitMode: "cover",
                    x: 0,
                    y: 0,
                    width: 100,
                    height: 100
                  }
                ],
                scriptVersionIds: [],
                generationRecords: []
              }
            ]
          }
        ]
      };

      createdShots.push(shot);
    });

    // Create connections from nextShotIndex or sequential defaults
    data.shots.forEach((shotData, index) => {
      const fromShot = createdShots[index];
      if (!fromShot) return;

      let targetIndex: number | undefined;
      if (typeof shotData.nextShotIndex === "number" && shotData.nextShotIndex >= 0 && shotData.nextShotIndex < createdShots.length && shotData.nextShotIndex !== index) {
        targetIndex = shotData.nextShotIndex;
      } else if (index + 1 < createdShots.length) {
        targetIndex = index + 1;
      }

      if (targetIndex !== undefined) {
        const toShot = createdShots[targetIndex];
        if (toShot) {
          connections.push({
            id: id("conn"),
            fromShotId: fromShot.id,
            toShotId: toShot.id,
            label: shotData.transitionLabel || "Next Beat"
          });
        }
      }
    });

    const updatedProject: DionysusProject = {
      ...currentProject,
      name: data.projectName?.trim() || currentProject.name,
      updatedAt: now,
      referenceProfiles: newProfiles,
      shots: createdShots,
      storyboardConnections: connections
    };

    return {
      success: true,
      project: updatedProject,
      count: createdShots.length
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to parse JSON."
    };
  }
}

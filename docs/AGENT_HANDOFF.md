# Agent Handoff Guide

This file is the starting point for any agent continuing Dionysus. Keep project knowledge in Git; do not rely on chat history as the source of truth.

## Read first

1. `README.md` — project purpose and development commands.
2. `docs/PRD.md` — confirmed requirements, unresolved decisions, and product scope.
3. `docs/ARCHITECTURE.md` — architecture principles and current structure.
4. This file — workflow, current implementation status, and handoff expectations.
5. The open pull request and latest commit history for work in progress.

## Repository workflow

- Repository: `ckfun0skf/dionysus-ai-video-editor`
- Working branch for the foundation: `feat/dionysus-foundation`
- Never push directly to `main`; work on a feature branch and use a pull request.
- Keep pull requests draft until the implementation has been validated.
- Use English for source code, comments, docs, issues, PRs, and commit messages.
- Update this guide and the relevant docs when implementation status or decisions change.
- Do not claim tests or builds passed unless they were actually run and the result is known.
- Preserve user-approved decisions. Record new decisions in the PRD and explain material trade-offs.
- Do not add or run automated browser smoke tests unless the user explicitly requests them. Use unit/integration tests, type-checking, production build, and deployment status as the default validation path.
- Keep all durable project knowledge in version control. Avoid instructions that exist only in chat.
- Preferred user communication language is Hong Kong Cantonese (`zh_hk`), while all code, docs, and git commits remain in professional English.

## Product Mission & User Core Requirements

**Why Dionysus exists:**
When brainstorming film and video ideas with AI agents (ChatGPT, Claude, Gemini), agents typically generate numerous Markdown files, prompt lists, and fragmented instructions on what assets to create and how to prompt video models. As files multiply, project management becomes chaotic and difficult to track.

Dionysus solves this by providing a **unified visual AI video workstation**:
1. **Interactive Node & Flow Storyboard (SeeDance-style)**:
   - 2D canvas with draggable shot cards (`canvasX`, `canvasY`).
   - Visual Bezier curve transitions between shots with customizable transition labels.
   - Dedicated prompt placeholders in each shot (`generationPrompt`, `cameraMovement`, `shotType`) with 1-click prompt copy for Midjourney, Flux, Runway, Kling, Seedance, etc.
   - Direct image/video attachment into shot cards with IndexedDB binary persistence (`mediaAssetStore.ts`).
2. **AI Storyboard Schema & 1-Click Interchange**:
   - `src/agentInterchange.ts` provides a structured JSON specification and system prompt template.
   - Users can copy the prompt into any external LLM, obtain a clean JSON plan, and import it into Dionysus with one click to generate the connected visual flow.
3. **Step-by-Step Asset Generation Checklist (`ProductionChecklistDrawer.tsx`)**:
   - Step 1: Anchor visual reference profiles (Characters, Environments, Props) to guarantee visual continuity.
   - Step 2: Progressively prompt and generate shot assets, marking them Planned -> In Progress -> Ready.
4. **Storyboard-to-Timeline Synchronization**:
   - `syncStoryboardToTimeline()` transforms the narrative storyboard into multi-track video and audio timeline clips (`TimelineClip[]`) with linked audio handling and non-destructive manual clip preservation.
5. **Timeline & Nested Shot Submodules**:
   - Current direction is the prototype-based workflow in `public/doc/creative-editing-workflow-spec.md`: a Master Timeline tab, per-Shot Version dropdown (+ Add Version/Edit), nested Version timeline tabs, expandable linked audio under video layers, independent audio-layer mute, and a first-class Three.js lane.
   - Treat this as the target specification, not a claim that every item is implemented. The Three.js preview component and WebM compositor do not by themselves prove final timeline compositing fidelity.

## Current Status (2026-10-18)

- **Test Suite**: Latest merged timeline workspace CI reported 59 tests passing; check the exact CI run for the current branch before repeating a count.
- **Build**: `tsc -b && vite build` succeeds with zero TypeScript or compilation errors.
- **Port / Dev Server**: Vite dev server configured to `0.0.0.0:3000` with `allowedHosts: true`.
- **UI Modes**:
  - Storyboard view supports both SeeDance Node Flow Canvas and Grid Cards (`storyboardMode: "flow" | "list"`).
  - Quick action modal for AI Storyboard generation and JSON import.
  - Side drawer for the production checklist guide.
  - Full Undo/Redo stack with keyboard shortcuts (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`).

## Task Tracking & Progress Monitoring

- Dashboard source: `public/doc/task.html` (served at `/doc/task.html`, with redirect from `/docs/task.html`).
- Task data: `public/doc/tasks.json`.
- The user uses `task.html` to monitor project progress across milestones. Always keep `public/doc/tasks.json` up to date when delivering major feature blocks.

## Safe Local Validation

```bash
npm install
npm test
npm run build
npm run dev
```

## Handoff Checklist for Next Agents

- [x] Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, and this file.
- [x] Maintain user communication in `zh_hk`, technical implementation in English.
- [x] Run `npm test` and `npm run build` before claiming completion.
- [x] Keep `public/doc/tasks.json` in sync for the user's progress monitoring dashboard.
- [x] Do not create redundant PRs or unneeded markdown sprawl; prioritize real features in the applet.



## Canonical Shot / Clip / Version rules (2026-10-18)

Use these definitions as the source of truth; older descriptions elsewhere in this guide that imply a Shot contains Clip Slots are superseded by the following model:

- **Shot** identifies a video shot; each Shot has multiple **Shot Versions**, typically concrete video files.
- **Clip** is an independently editable composition that may be empty and can contain Shot Version references, Code, other Clip Versions, and supported audio/image/text content.
- **Clip Version** is a saved composition state with its own internal timeline and explicit pinned references.
- **Layer** is a track containing multiple Clips. Code is content inside a Clip, not a standalone top-level Code Layer. Effects are Clip/Layer settings.
- Shot Versions and Clip Versions are independent histories. Adding a Shot Version does not auto-create or modify Clip Versions. A Clip Version pins the exact Shot Version it uses.
- The Shot asset detail must eventually list referencing Clip Versions and support individual or batch reference changes. Users can explicitly create new Clip Versions for selected references to compare a new Shot Version.
- Clip nesting must be cycle-safe in the UI and in domain/import validation. Filter invalid choices, then validate every attempted reference mutation. No direct or indirect self-containment.
- Assets page: one `+` menu for Clip, Code, Audio, Image. Empty Clip creation is valid; Code uses the existing playground; Audio requires upload. Images must be reusable by Code/Clip and later by Reference/Storyboard.
- Master and Clip timelines share the same editor. Master Timeline can be saved as a Clip Asset. Project settings expose aspect ratio, pixel resolution, and frame rate. Preview transforms must support move/resize. Timeline headers/ruler/lanes must align and labels remain readable.
- Do not add “Add linked video/audio clips” to the Add Layer menu. Linked source audio is a video-Clip operation, not a layer type.
- Keep Storyboard Reference auto-use out of the current initial implementation slice; preserve the architecture so it can be added later.

Before implementation, inspect existing schema and migrations rather than blindly replacing legacy fields. Deliver code and tests alongside docs; documentation-only changes do not count as implementing a feature. Do not add browser smoke tests unless explicitly requested.

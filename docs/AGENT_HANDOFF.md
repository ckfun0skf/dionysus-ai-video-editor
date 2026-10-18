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
   - Full timeline with multi-layer compositing, picture-in-picture, and Three.js procedural animation preview (`ProceduralAnimationPreview.tsx`).
   - WebM client-side export with audio via `compositionRenderer.ts`.

## Current Status (2026-10-18)

- **Test Suite**: 57/57 tests passing across 7 Vitest test suites (`App.test.tsx`, `aiGenerationProvider.test.ts`, `timelineOperations.test.ts`, `projectValidation.test.ts`, `projectHistory.test.ts`, `compositionRenderer.test.ts`, `i18n.test.ts`).
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


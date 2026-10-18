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

## Efficient Agent Workflow: Batch Work, Commits, and CI

This section is mandatory for every agent and every new chat. Optimize for validated, coherent feature slices—not the number of messages, commits, or CI runs.

### Before editing
1. Read this guide, the relevant PRD/architecture/spec, current task dashboard data, and the active PR/branch.
2. Confirm the current `main` SHA, feature branch head, PR state, and newest CI result. Do not assume a previous chat's status is still current.
3. Turn the request into a small, complete vertical slice with explicit acceptance checks. Inspect existing implementation before changing it; do not make speculative edits across unrelated files.

### Implementation and commit policy
- Work on a feature branch; never push directly to `main`.
- Make related code, tests, translations, task status, and documentation changes together in a coherent batch.
- **Do not create one commit per file or per tiny edit.** Avoid GitHub Contents API file-by-file updates when each update creates its own commit. Prefer a local working tree and one normal Git commit, or create a single Git tree/commit for a multi-file batch when using GitHub APIs.
- Default to one meaningful commit for a completed feature slice; use a small number of commits only when they represent genuinely separate, reviewable milestones (for example, foundational model/tests followed by the UI workflow). Do not rewrite shared branches; only rewrite your own feature branch when necessary and use a lease/expected-head check.
- Commit messages should describe the change, not the activity (for example, `feat: add reusable clip timeline workflow`).
- Before pushing, inspect the diff and run the cheapest relevant local checks available. If no local checkout/runtime is available, say so plainly and use CI as the verification source; never claim a local test was run when it was not.
- Do not create redundant PRs. Keep one active PR per coherent feature unless a clear dependency or release boundary requires otherwise.

### CI and deployment policy
The current CI workflow is intentionally configured to run for:
- `pull_request` targeting `main`
- `push` to `main`
- manual `workflow_dispatch`

Feature-branch pushes should not independently trigger a second full CI run. A PR may receive a PR validation run, and merging to `main` intentionally triggers post-merge validation. The workflow's concurrency group cancels stale runs for the same PR/ref when a newer run supersedes them.

- Do not manually rerun a still-running or already-passing check without a specific reason.
- After pushing, inspect the latest run for the **current exact head SHA**; verify test, type-check/build, and audit output. An older green run does not validate a newer commit.
- Wait for the latest required PR checks before merging. After merge, verify the main push CI and GitHub Pages deployment separately when the task includes release/deployment.
- Do not add automated browser smoke tests or browser automation unless the user explicitly asks; this project uses deterministic tests, type-checking, build, and deployment status as the default verification path.
- Keep CI changes narrow. Do not add redundant workflows or triggers to compensate for a stale or misunderstood run.

### Handoff and reporting
- Record durable decisions, changed files, commit/PR links, exact validated SHA, test/build/audit results, and any remaining risks in Git. Update `public/doc/tasks.json` and its task/spec/report artifacts for major feature blocks.
- Clearly distinguish automated checks, actual UI/browser verification, and deployed behavior. Never describe a PR branch as deployed before merge and a successful deployment.
- Report concise evidence and the next concrete action. If a tool/API limitation prevented a check, state that limitation instead of guessing.
- If a chat is getting long, update the Git handoff/status documents before switching chats. The next agent should be able to continue from Git alone without relying on the previous conversation.

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


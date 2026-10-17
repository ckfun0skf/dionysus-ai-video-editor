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

## Current status (2026-10-17)

The foundation PR introduces a React + TypeScript + Vite static web app, a starter project schema, sample data, a dark editor shell, basic Storyboard and Timeline views, browser-local persistence, project JSON import/export, and AI execution-plan JSON export.

The current Timeline is a visualization, not yet a frame-accurate drag-and-drop editor. Assets and References now have metadata-level CRUD on the feature branch: asset records can be added/edited/deleted with reference-use protection; reference profiles can be created/edited/deleted, their reference roles managed, and profiles assigned to shots. File selection currently records metadata and a source filename only; it does not copy media bytes or generate previews. Per-shot reference exclusion/replacement, durable media import/relinking, video compositing/playback, ZIP packaging, persistent Undo/Redo, advanced audio processing, and MP4 rendering are not implemented.

The initial source files were added through GitHub APIs. User-facing UI copy is centralized in `src/i18n.ts`; components should use translation keys rather than inline English strings. The current catalog defaults to English and provides typed interpolation; new locales should mirror the existing keys, and any new UI text must be added to the catalog. Project JSON validation now checks required project collections and nested shot/slot/version/layer shapes before import and when loading from local storage. Vitest tests cover the sample project, missing tracks, invalid selected-version references, invalid durations/canvas values, and malformed layers. CI is configured to run tests and a production build. The tests/build have not been executed in a local runtime by the authoring agent; verify the GitHub Actions results and run a browser smoke test before treating the foundation as validated.

## Task tracking

- Dashboard source: `public/doc/task.html` (deployed path: `/dionysus-ai-video-editor/doc/task.html`).
- Each task has a detail page under `public/doc/tasks/*.html`, a matching Markdown specification, and a report under `public/doc/reports/*-report.md`.
- Update the dashboard, task Markdown, detail page, and report together when status or evidence changes. A report stub is not proof of completion.
- Current task list includes foundation, localization/validation, task tracking, asset/reference management, Timeline/Versions, preview/compositing, history/portability, audio/procedural modules, AI plan/MP4 export, and release QA/deployment.

## Safe local validation

```bash
npm install
npm run build
npm run dev
```

Open the local URL printed by Vite. Check Storyboard editing, shot/slot creation, project JSON export/import, and AI plan export. Test malformed imports before relying on project import in real workflows.

## Public GitHub Pages preview

The app is intended to be a static site. The repository Pages workflow builds the Vite app and deploys it from `main`. The repository owner may need to enable GitHub Pages with **GitHub Actions** as the build/deployment source in repository Settings. Until the workflow is merged to `main` and a deployment succeeds, do not assume a public preview URL is live.

Because this is a client-side app, treat all data in the browser as user-controlled. Do not add secrets, API keys, credentials, or private project assets to the public repository or deployed bundle. Local storage is scoped to a browser origin; it is not cloud sync or a backup. Export project JSON regularly.

## Handoff checklist

- [ ] Read the PRD and architecture notes.
- [ ] Check the open PR, branch head, and CI status.
- [ ] Confirm GitHub Actions test and build results.
- [ ] Build and smoke-test the current code.
- [ ] Reproduce issues before changing behavior.
- [ ] Keep changes scoped and add/update tests where practical.
- [ ] Update documentation and this status section when meaningful work lands.
- [ ] Report exact changed files, commit/PR links, validation performed, and known limitations.

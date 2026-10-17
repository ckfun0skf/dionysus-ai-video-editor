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

The current Timeline is a visualization, not yet a frame-accurate drag-and-drop editor. Assets and References are not full CRUD workspaces. Video compositing/playback, media import, ZIP packaging, persistent Undo/Redo, advanced audio processing, and MP4 rendering are not implemented.

The initial source files were added through GitHub APIs. A local install, TypeScript build, and browser smoke test had not been run at the time this guide was created. Check CI and run the app before treating the foundation as validated.

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
- [ ] Build and smoke-test the current code.
- [ ] Reproduce issues before changing behavior.
- [ ] Keep changes scoped and add/update tests where practical.
- [ ] Update documentation and this status section when meaningful work lands.
- [ ] Report exact changed files, commit/PR links, validation performed, and known limitations.

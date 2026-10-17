# DYS-003 — JSON-driven project management dashboard

**Status:** In progress (PR validation pending)  
**Progress estimate:** 60%  
**Last updated:** 2026-10-17

## Summary
Replace the hard-coded task-card dashboard with a project-management view driven by `public/doc/tasks.json`. The dashboard presents milestone timeline, phases, tasks, subtasks, status, progress estimates, acceptance criteria, and links to each task's Markdown specification and report.

## Confirmed design
- `public/doc/tasks.json` is the single source of truth for project milestone/task metadata, statuses, subtasks, progress estimates, acceptance criteria, evidence notes, and task-document paths.
- `public/doc/task.html` is a renderer only. Do not duplicate task records in HTML or add a fallback hard-coded task list.
- Task specifications and completion reports remain Markdown files under `public/doc/tasks/` and `public/doc/reports/`.
- The dashboard displays a phase/milestone timeline, expandable phase/task rows, search and status filters, subtask status, acceptance criteria, and document links.
- Status and progress values are estimates unless backed by implementation evidence. A report stub does not establish completion.

## Scope
- [x] Define a JSON schema/version and milestone/phase/task hierarchy.
- [x] Move task metadata and subtasks into `tasks.json`.
- [x] Render a horizontal milestone timeline and expandable task breakdown from JSON.
- [x] Show per-task subtasks, acceptance criteria, evidence notes, and Markdown/report links.
- [x] Add search, status filter, and expand/collapse interactions.
- [ ] Validate JSON parsing, dashboard rendering, accessibility, and all relative links.
- [ ] Verify the deployed dashboard in a browser after the PR is merged and Pages deployment succeeds.
- [ ] Keep progress/status and completion evidence current as implementation PRs land.

## Verification / acceptance criteria
- The dashboard fetches `./tasks.json` and does not render a second hard-coded project plan.
- Milestones render in the order defined by JSON; selecting one filters the phase/task view.
- Search matches task IDs, titles, summaries, subtasks, and acceptance criteria.
- Status filter supports Implemented, In progress, and Planned.
- Expanding a task shows its summary, subtask states, acceptance criteria, evidence/notes, and available Markdown/detail/report links.
- Invalid or missing JSON displays a visible error message instead of an empty-looking dashboard.
- Existing Storyboard, References, and Assets application navigation is unaffected.
- Required CI checks pass; deployed browser QA is tracked separately from CI.

## Current implementation notes
The initial JSON-driven dashboard is being implemented on feature branch `feat/project-management-dashboard`. The task JSON includes the planned Timeline/Version model (both single-clip and composite Versions), linked/unlinked audio, preview compositing, mobile editing, portability, and release QA. These are roadmap entries, not claims that the corresponding product features already exist.

## Evidence and links
- [Task dashboard](../task.html)
- [Task data JSON](../tasks.json)
- [Task detail page](./task-tracker.html)
- [Completion report](../reports/task-tracker-report.md)
- [Pull request](https://github.com/ckfun0skf/dionysus-ai-video-editor/pulls)

## Status rules
- **Implemented** means the listed implementation exists and supporting evidence is linked; it does not imply all release QA is complete.
- **In progress** means implementation or verification remains outstanding.
- **Planned** means work has not started or no evidence has been recorded.

# DYS-015 — Production Task graph and Generation Runs

**Status:** Planned · **Progress estimate:** 0% · **Updated:** 2026-10-18

## Goal

Turn the production checklist into a dependency-aware workflow for AI video production. Track required images/references and shot-video generations, prerequisite assets, prompts, outputs and history before any AI provider API is connected.

## Target entities

### Production Task

Describes the objective and how to produce it: expected output kind, target Shot/Composition, prompt/template, explicit input asset/reference requirements and roles, prerequisite task IDs, and status (ready, blocked, running, completed, failed or manual-import-required).

Tasks form a validated directed acyclic graph. Dependency cycles and dangling IDs must be rejected or clearly surfaced.

### Generation Run

Represents one attempt. It records the effective prompt, provider/model/version, parameters/seed where available, exact input-reference snapshot, timestamps, output Asset/Shot Version and error details. Retries create new runs and preserve prior results.

### Output

A generated result becomes a Media Asset and/or concrete Shot Version that references it. Asset identity, Shot version choice and the individual attempt are separate concepts.

## UX requirements

Production Guide lists tasks in dependency-aware order, explains blockers, shows which references to attach, exposes the prompt and says where to import/attach the result. Manual Copy Prompt and Import Result work before API integration. Provider adapters can execute the same tasks later.

## Implementation slices

- [ ] Define task/run types and project validation.
- [ ] Add DAG validation and readiness/blocker calculation as pure TypeScript.
- [ ] Record effective prompt and immutable input-reference snapshots.
- [ ] Extend AI plan export/import reconciliation to include tasks/dependencies.
- [ ] Replace Shot-only checklist with a task-driven guide.
- [ ] Support manual output import/assignment and run failure/retry history.
- [ ] Test dependency cycles, reference snapshots, retries and JSON round-trip.

## Acceptance

- Tasks specify output, prompt, explicit inputs, dependencies and target.
- Blocked tasks explain missing prerequisites.
- Retries preserve prior runs/results.
- Manual generation works with no configured AI provider.
- Task/run data survive JSON round-trip and schema migration.

Dependencies: DYS-004 Asset/Reference workflow, DYS-014 unified model and DYS-009 plan reconciliation. See [Unified Composition Model](https://github.com/ckfun0skf/dionysus-ai-video-editor/blob/main/docs/architecture/UNIFIED_COMPOSITION_MODEL.md).

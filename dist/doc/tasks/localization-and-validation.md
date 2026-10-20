# DYS-002 — Centralized UI localization and project validation

**Status:** Implemented  
**Progress estimate:** 90%  
**Last updated:** 2026-10-17

## Summary
Centralize user-facing UI copy in src/i18n.ts and reject malformed project data before it is loaded or imported.

## Scope
- [x] Use typed translation keys and interpolation for interface text.
- [x] Keep the default locale in one catalog and make future locales mirror its keys.
- [x] Validate project structure, nested layers, durations, canvas values, and cross-record asset/reference links.
- [x] Add automated tests for localization and project validation.

## Implemented / verified
- src/i18n.ts centralizes most interface copy and currently defaults to English.
- src/projectValidation.ts validates imported and persisted project data.
- Vitest coverage exists for project validation and localization.
- CI run 39013558873 passed tests and production build.

## Remaining work
- Audit the full UI for any remaining hard-coded user-facing copy.
- A language selector and additional locale catalogs are not implemented.

## Evidence and links
- [Task detail page](./localization-and-validation.html)
- [Completion report](../reports/localization-and-validation-report.md)
- [Task dashboard](../task.html)

## Status rules
- **Implemented** means the listed implementation exists; it does not imply every release QA step is complete.
- **In progress** means implementation or validation is outstanding.
- **Planned** means implementation has not started or is not evidenced yet.

# DYS-004 — Asset library and reference profiles

**Status:** In progress · **Progress:** 65% · **Updated:** 2026-10-18

Issue [#56 — Asset Management is not user friendly](https://github.com/ckfun0skf/dionysus-ai-video-editor/issues/56) is a **planned extension of this existing task**, not an implemented feature.

## Implemented / verified
- Asset metadata CRUD; unused assets can be deleted and referenced assets are protected.
- File selection recognizes common media/script types, while warning that selecting a file does not yet persist media bytes into the project.
- Reference profile CRUD, per-reference roles, Shot profile assignment, and shot-specific **Use profile / Exclude / Replace** behavior.
- Validation checks profile assets, Shot profile IDs, layer assets, generation snapshot assets, and reference overrides.

## Planned scope recorded from Issue #56
- [ ] Searchable/filterable card browser aligned with the existing Timeline asset picker.
- [ ] Move asset properties into a context-menu **Settings** dialog using the asset-creation fields.
- [ ] Add **Edit Timeline** to Clip Asset context menus.
- [ ] Add confirmed **Delete** with a warning describing dependent Shots, Clip Versions, and other references; remove/repair references deterministically.
- [ ] Add **Manage References** showing reverse usage such as “Clip 1 is used by Shot 1”.
- [ ] Expose per-asset frame/canvas dimensions.
- [ ] Add tests for context actions, dependency-aware deletion, reverse usage, and frame settings.

## Other remaining work
- Persist imported media bytes, relink missing files, and generate durable previews/thumbnails.
- Capture and review the exact reference snapshot used by each generation.
- Do not claim media bytes are durably imported until the binary-storage path is implemented and tested.

## Related
- [Task detail](./assets-and-references.html)
- [Completion report](../reports/assets-and-references-report.md)
- [Task dashboard](../task.html)

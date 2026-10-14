# Open ENV extension changelog

## 0.2.0 — Open ENV editor support

### Editing contracts

- Validate YAML and strict JSON while typing, without opening the preview.
- Underline invalid keys and values and report errors in Problems.
- Complete supported fields and fixed values; show field documentation on hover.
- Keep editor diagnostics and the side preview synchronized with unsaved edits.

### Distribution

- Rename the extension to Open ENV with ID `it-perspectives.openenv`.
- Bundle all validation and editing dependencies for offline use.
- Publish independent `extension-vX.Y.Z` releases to Marketplace and Open VSX.

Remove the previous `it-perspectives.openenv-preview` installation before installing
this extension. The new ID is a separate extension, not an automatic update.

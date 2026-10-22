# Open ENV for VS Code

Validate, complete and preview environment contracts in `openenv.yaml`,
`openenv.yml` and `openenv.json`. Requires VS Code 1.100 or newer.

## Editing contracts

Open ENV checks supported files automatically, including unsaved changes. It
underlines errors in the source and reports them in **Problems** with source
**Open ENV**. No preview panel or YAML extension is required.

Checks cover YAML syntax, strict JSON syntax, duplicate keys, unsupported fields,
missing required fields, types, constraints and the OpenENV semantic rules.
For example, `requred: true` is underlined as an unsupported field. Valid `x-*`
metadata is accepted; consumers ignore extensions they do not understand.

Completion suggests fields and fixed values from the bundled specification,
accounts for existing fields and the selected variable type, and omits literal
fields for sensitive variables. Hover over a field to read its description and
requiredness. The initial release supports specification **0.1.0**. Extension
versions and specification versions are independent.

## Preview

Use **Open ENV: Open Preview to the Side**, the editor title button or the Explorer
context menu. Shortcut: **Cmd+K, V** on macOS or **Ctrl+K, V** on Windows/Linux.
The preview shows types, requiredness, defaults, examples, constraints and
sensitive/deprecated markers. It shares the editor's current validation result
and updates after a 180 ms debounce.

The extension reads only the selected contract. It does not read `.env`, process
environment values, execute workspace commands or fetch schemas. All parser,
linter and editor dependencies are bundled locally. Descriptions are rendered as
text; the preview disables scripts and local resource access. Desktop and remote
Node-based Extension Hosts are supported; a browser-only host is not provided.
Existing YAML/JSON language services can coexist with Open ENV. Configuring the
same schema in another extension may produce additional diagnostics or suggestions.

## Install and migrate

The extension ID is **`it-perspectives.openenv`**. If you installed the previous
prototype `it-perspectives.openenv-preview`, uninstall it before installing Open
ENV. Changing the ID creates a separate extension; the prototype will not update
automatically to the new one.

For local installation from this repository:

```sh
npm ci --ignore-scripts
npm run vscode:package
code --install-extension dist/openenv-0.2.0.vsix
```

## Development and verification

Supports Node.js 22, 24 and 26 for builds. From the repository root:

```sh
npm run vscode:build
code extensions/vscode
```

Press F5 to open an Extension Development Host. Alternatively:

```sh
code --new-window --extensionDevelopmentPath="$PWD/extensions/vscode" "$PWD/examples/openenv.yaml"
```

```sh
npm run verify
npm run previews:verify
npm run vscode:package
npm run vscode:test
```

The host test installs the actual VSIX into an isolated profile, checks automatic
activation, unsaved edits, diagnostic ranges, completion, hover, theme changes and
multi-document cleanup. It does not modify your normal extensions or settings.
`OPENENV_VSCODE_VERSION=1.100.0 npm run vscode:test` tests the minimum supported
version; the default tests stable. An existing executable can be selected with
`OPENENV_VSCODE_EXECUTABLE`.

## Releases

Prepare and commit the extension version and its changelog, then run:

```sh
npm run vscode:deploy 0.2.0
```

This validates the release and atomically pushes `main` and `extension-v0.2.0`.
The pinned open-tooling workflow builds and tests the VSIX, saves it in the
`open-products` bundle with its inventory/checksums, and publishes that same file
to Marketplace and Open VSX through OIDC. Both publication jobs must succeed before
the GitHub release becomes public. After partial publication, rerun only failed
jobs using the saved artifacts; tooling v0.1.0 delegates duplicate-version handling
to the store CLIs. No persistent store token or PAT fallback is configured.

Store publication requires the publisher/namespace owner to configure GitHub
trusted publishing first. See the repository's
[release guide](https://github.com/it-perspectives/OpenENV/blob/main/docs/releases.md)
for setup and recovery. Local packaging does not prove store publication.

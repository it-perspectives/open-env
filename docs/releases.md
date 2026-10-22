# Releasing and consuming OpenENV

## Shared CI/CD

OpenENV uses [open-tooling v0.1.0](https://github.com/it-perspectives/open-tooling/releases/tag/v0.1.0), pinned to commit `0ac78fd5a1bc8c567d453e36e8e13224df62d74d` in both `uses` and `tooling-ref`. Update those pins together.

[.open-project.json](../.open-project.json) declares the specification/npm package, VS Code extension, static website, container image, project checks and publication settings. OpenENV requires the full product set. The shared workflows verify Node.js 22, 24 and 26 on Ubuntu 24.04.

The local callers are intentionally small:

| Caller | Trigger | Shared workflow |
| --- | --- | --- |
| `ci.yml` | PR, main push, manual run | `verify.yml` |
| `release.yml` | `specification-v*`, `website-v*` | `release.yml` |
| `release-extension.yml` | `extension-v*` | `release.yml` |

The extension caller keeps its existing filename for publisher trust policies. Tag triggers are disjoint, so a tag starts one release publisher. The former local `build-artifacts.yml` is removed.

Project hooks retain core tests and example lint, installed npm consumer checks, VS Code packaging and host tests on minimum/stable VS Code, website formatting/types and browser/editor preview parity, and container smoke tests. The host hook tests the exact `OPEN_TOOLING_VSIX` supplied by the builder. Release jobs download the Node 24 artifact after the entire matrix succeeds; they do not rebuild or execute consumer hooks.

## Artifact output

Successful verification saves one Actions artifact named **open-products** for 14 days. Its contents are the same files produced by the common builder in `dist/open-tooling/`:

| File | Purpose |
| --- | --- |
| `openenv-X.Y.Z.schema.json` | Versioned JSON Schema |
| `openenv-X.Y.Z-SPEC.md` | Normative specification |
| `openenv-X.Y.Z.yaml`, `openenv-X.Y.Z.json` | Matching reference examples |
| `it-perspectives-openenv-X.Y.Z.tgz` | Installable npm package |
| `openenv-EXTENSION_VERSION.vsix` | Tested VS Code extension |
| `openenv-website-WEBSITE_VERSION.tar.gz` | Static site |
| `openenv-website-WEBSITE_VERSION-linux-amd64.docker.tar` | Tested Docker image from `docker save` |
| `openenv-COMPONENT-VERSION-source.tar.gz` | Complete configured source archive |
| `CHANGELOG.md`, `release-notes.md` | Full history and selected component entry |
| `release.json`, `SHA256SUMS` | Product/source/tooling identities, file inventory, sizes and hashes |

The specification/npm versions match. Extension and website versions are independent. Each component release attaches the full configured product bundle to GitHub Releases; its tag chooses the release version, notes and registry destinations. Docker image identity in the inventory is the local image/config digest, not a registry manifest digest.

After downloading the bundle, verify it from its directory:

```sh
shasum -a 256 -c SHA256SUMS
docker load --input openenv-website-0.1.0-linux-amd64.docker.tar
code --install-extension openenv-0.2.0.vsix
```

## Local verification

To reproduce the shared build, check out the pinned tooling alongside OpenENV and install its dependencies. From OpenENV:

```sh
node ../open-tooling/bin/open-tooling.js check --complete
node ../open-tooling/bin/open-tooling.js build --complete
node ../open-tooling/bin/open-tooling.js verify-artifacts --artifacts dist/open-tooling
```

A full build requires an available Docker daemon and real VS Code host execution. On Linux, run the build under Xvfb. Build and check commands do not publish anything. Local dirty sources are marked `sourceDirty: true`; the publisher rejects them.

The existing `npm run release:prepare` and `node scripts/smoke-package.js` remain compatibility commands for local specification-only assets in `dist/`. CI uses the common builder and its `dist/open-tooling/` inventory instead. The npm smoke hook accepts the common builder's exact tarball path.

## Prepare and publish a specification

1. Update the package/library/schema/examples, schema filename and immutable URL together. Update `specification.version`, schema/example paths and website assets in `.open-project.json`.
2. Add exactly one nonempty `## X.Y.Z — Title` changelog entry for the new version. Update the lockfile.
3. Run project checks and inspect the common build. Confirm the Node 22/24/26 PR pipeline.
4. Commit the reviewed sources on `main` and run `npm run deploy X.Y.Z` for a fresh specification version.

The deploy command still requires clean `main`, matching metadata and unused local/remote tags. It reruns the local specification preparation/smoke checks, verifies unchanged HEAD, and atomically pushes `main` plus an annotated `specification-vX.Y.Z` tag. It does not bump versions, make commits, publish npm, or wait for CI. On a rejected push it retains the local tag; inspect the remote before retrying without force.

The shared release workflow validates the component tag and complete project, verifies the saved inventory against commit/tag/repository, and stages a draft GitHub release. It downloads and checks uploaded bytes before making that release public. A retry accepts matching existing assets and rejects conflicts.

Historical `vX.Y.Z` tags must not move. OpenENV 0.1.0 retains its original `v0.1.0` schema URL via `legacySchemaTag`; later schema URLs use `specification-vX.Y.Z`. A historical tag also blocks `npm run deploy` from reusing that version. Release a new version after publication.

## Independent extension and website releases

For extensions, update `extensions/vscode/package.json`, its changelog and the `vsix` path in `.open-project.json`, commit, then run:

```sh
npm run vscode:deploy X.Y.Z
```

The local command retains its version/changelog, clean-tree, unused-tag and atomic-push checks. The `extension-vX.Y.Z` tag calls shared release verification and publishes the same tested VSIX to Marketplace and Open VSX through OIDC. The GitHub release becomes public after the requested registry jobs succeed. Never reuse or overwrite a published version.

Website versions and notes belong to `website/package.json` and `website/CHANGELOG.md`. A matching `website-vX.Y.Z` tag creates the shared bundle. No website deploy helper or hosting deployment is configured.

## Publication settings and publisher setup

The manifest preserves the previous destinations: `marketplace: true` and `openVSX: true` for extension tags, `npm: false` for specification tags, and no image-registry destination. Specification/website tags therefore publish GitHub assets only. Static hosting and container registry publication remain separate infrastructure choices.

The publisher owner must configure the `it-perspectives` Marketplace publisher and Open VSX namespace and their GitHub trusted-publishing policies. The caller repository remains `it-perspectives/OpenENV` and its extension workflow remains `release-extension.yml`. Publication now runs inside the pinned reusable `it-perspectives/open-tooling/.github/workflows/release.yml`; verify any trust-policy checks on the called workflow identity/ref as well. No PAT fallback or persistent registry secret is introduced.

The shared v0.1.0 publisher delegates duplicate-extension-version handling to the registry CLIs. After partial success, rerun only failed publication jobs using their saved artifacts; automatic recovery from every already-published-version case is not implemented. The old per-project publisher service is no longer called by CI.

Before enabling npm publication, establish ownership and trusted publishing for `@it-perspectives/openenv` and the calling workflow. For manual publication, use the exact verified tarball from `open-products` or `dist/open-tooling/`:

```sh
npm publish ./dist/open-tooling/it-perspectives-openenv-0.1.0.tgz --access public
```

References: [shared release contract](https://github.com/it-perspectives/open-tooling/blob/v0.1.0/docs/releases.md), [vsce trusted publishing](https://github.com/microsoft/vscode-vsce#trusted-publishing), [Open VSX publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions). Local builds do not demonstrate live publisher access or successful service-side OIDC exchange.

## Consumer integration

Applications can pin/vendor the JSON Schema for editor validation, run the CLI in CI, or call `checkEnvironment` at startup. Other languages implement SPEC.md semantics directly. Only the runtime API resolves environment values/defaults; schema URLs do not authorize remote code execution. The contract's `info.version` belongs to the application and is independent of tooling/product release versions.

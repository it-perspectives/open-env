# Releasing and consuming OpenENV

## Release unit

A specification release is a versioned contract plus companion
tooling. Its contents are:

| Artifact | Purpose |
| --- | --- |
| `SPEC.md` | Normative data model, serialization, semantics, and compatibility rules. |
| `openenv-X.Y.Z.schema.json` | Versioned JSON Schema for document validation and editor completion. |
| `openenv.yaml`, `openenv.json` | Equivalent examples of the same contract. |
| `openenv-X.Y.Z.tar.gz` | Source, schema, documentation, tests, linter, and lockfile. |
| `it-perspectives-openenv-X.Y.Z.tgz` | Installable npm distribution of the linter/checker and schema. |
| `SHA256SUMS` | SHA-256 checksums for the release assets. |
| `CHANGELOG.md` | Full release history, included in both archives and attached separately. |
| `release-notes.md` | Current version's changelog entry, also used as the GitHub release description. |
| `LICENSE` | MIT license included in both distributions. |

The npm package includes the reference implementation, schema, specification,
documentation, and examples. The source archive also includes tests and release
scripts. Tests are run before producing release assets.

YAML and JSON are document serializations. The validation schema is distributed
as JSON; a second YAML schema would duplicate the same source of truth.

## Version identities

- `openenv` pins the specification format, for example `0.1.0`.
- `info.version` is owned by the application author and versions its variables.
- The npm version matches the specification release; new Git tags use `specification-vX.Y.Z`.

The initial implementation supports exactly `0.1.0`. Future implementations may
support several versions, but must select validation by the declared version.
Specification releases are immutable. Never replace an existing schema or tag.
Pre-1.0 breaking format changes use a new minor version; after 1.0 they use a new
major version. See SPEC.md for the complete compatibility policy.

## Prepare a release

1. Review normative wording and update the schema, examples, and tests together.
2. Update `openenv` version, package version, schema filename/ID, example versions,
   and supported version constants together. Record migration impact in the changelog.
   Use a `## X.Y.Z — Title` heading and `###` subsections for the release entry.
3. Run `npm ci --ignore-scripts`, `npm run release:prepare`, and
   `node scripts/smoke-package.js`. Review the generated archive, npm file list,
   and `dist/release-notes.md` as the exact description to be published.
4. Verify the Node.js 22 and 24 CI jobs. Local checks establish only the local runtime.
5. Commit the reviewed release source on `main`.
6. Run `npm run deploy X.Y.Z` when publication is intended. For the initial release:

   ```sh
   npm run deploy 0.1.0
   ```

The deploy command releases the already prepared version; it does not bump versions
or commit files. It requires a clean `main` branch, a matching package version, and
an unused tag on both the local repository and `origin`. It reruns release
preparation and the packed-consumer check before creating an annotated tag with
the message `OpenENV specification vX.Y.Z`. It then pushes only `main` and that tag to `origin`
in one atomic operation. A rejected branch update also rejects the tag update;
force pushes are never used. The remote must support atomic pushes.

If the push fails, the local tag is retained. Inspect the remote branch and tag
before retrying. After resolving the cause and verifying that the tag points to
the intended `main` commit, the push can be retried manually:

```sh
git push --atomic origin refs/heads/main refs/tags/specification-vX.Y.Z
```

The command does not wait for GitHub Actions or publish to npm. Check both Node.js
CI jobs and the release workflow after pushing.

Pushing a `specification-v*` tag triggers the supplied GitHub release workflow. The workflow
checks that the tag matches the package and specification, runs validation,
builds assets, tests the packed consumer, and creates a GitHub release with assets.
The description comes from the matching version's entry in `CHANGELOG.md`, via
`--notes-file dist/release-notes.md`. Other versions and the top-level changelog
heading are excluded; Markdown subsections are preserved. Preparation fails if
the entry is missing, duplicated, or empty. Both Markdown assets are covered by
`SHA256SUMS`. Edit the changelog before tagging to control the published wording.
It needs the repository's GitHub Actions `contents: write` permission. Publishing
is a maintainer action; creating files locally does not run that workflow.

For local use, verify checksums from inside `dist/`:

```sh
shasum -a 256 -c SHA256SUMS
```

The npm tarball can be installed directly before registry publication:

```sh
npm install --save-dev --save-exact ./it-perspectives-openenv-0.1.0.tgz
```

## Website and extension build artifacts

The reusable `build-artifacts.yml` workflow builds two additional distributions:

- `openenv-website-linux-amd64.tar.gz`: a Docker image archive tagged
  `openenv-website:<commit-sha>`. The image serves Astro's static output through
  unprivileged Nginx on port 8080. CI tests all five routes, the schema, example,
  health endpoint and 404 behavior before exporting it.
- `openenv-X.Y.Z.vsix`: the VS Code extension, packaged with the pinned
  `@vscode/vsce` tool and bundled validator. Its version comes from the extension
  manifest, independently of the specification's version.

Download them from the workflow run's **Artifacts** section. Artifacts are retained
for 14 days. The validation workflow calls this build after its checks on PRs and
`main`; the release workflow calls it on `specification-v*` tags and waits for successful builds
before its existing specification release step. These two files are workflow
artifacts, separate from the specification assets attached to a GitHub release.
These artifact builds do not push images, deploy the website or publish to extension stores. Store publication uses the independent extension workflow below.

```sh
docker load --input openenv-website-linux-amd64.tar.gz
code --install-extension openenv-X.Y.Z.vsix
```

## npm publication

`@it-perspectives/openenv` is the proposed scoped package name. Confirm that the
organization scope is available to the publisher; rename the package and update
consumer instructions if needed. GitHub repository ownership does not prove npm
namespace ownership.

This initial workflow publishes GitHub assets only. After confirming npm access,
a maintainer can publish the verified tarball:

```sh
npm publish ./dist/it-perspectives-openenv-0.1.0.tgz --access public
```

No registry token is stored in this repository. npm publication can later be
automated using the publisher's chosen authentication mechanism. Before announcing
the release, install the published exact version in a fresh consumer and check its
CLI and schema export. Never document an unpublished package as already available.

## Consumer integration modes

1. **Editor only:** pin the release schema URL or vendor the schema. This covers
   structural validation and completion, with semantic limitations stated in SPEC.md.
2. **CI:** install the exact npm package as a dev dependency, commit the lockfile,
   and run `openenv lint openenv.yaml --warnings-as-errors`.
3. **Startup:** install as a production dependency and call `checkEnvironment`
   before application initialization. Use its returned typed values and defaults.
4. **Other languages:** parse JSON/YAML, validate the document schema, and implement
   SPEC.md decoding and semantic rules. Use the source archive tests as reference cases.

Only the startup/API mode resolves defaults for the application. Running the CLI
checker does not inject defaults into another process. A schema URL is an editor
hint, not permission for the linter to download or execute remote content.

## Specification tag migration

New specification releases use `specification-vX.Y.Z`; the `v*` trigger has been
removed. `npm run deploy X.Y.Z` retains its existing CLI interface and creates
only the new prefixed tag. CI validates its exact version before artifact builds.
A local or remote historical `vX.Y.Z` tag blocks another release of that version.
Do not rename, delete or move historical tags. Prepare a new version instead.

The existing 0.1.0 schema URL keeps `v0.1.0` for compatibility with documents that
already declare it. Every later schema version uses `specification-vX.Y.Z` in its
`$id` and `$schema` constant. Update examples and consumer URLs together and run
`npm run previews:verify` to regenerate the website assets and validator bundles.
Release titles are `OpenENV Specification X.Y.Z`; notes still come from that
version's root changelog entry. This workflow does not publish npm packages.

## Independent Open ENV extension releases

Extension versions belong to `extensions/vscode/package.json` and have their own
`extensions/vscode/CHANGELOG.md`. The extension 0.2.0 supports specification
0.1.0. To release an already committed extension version from clean `main`:

```sh
npm run vscode:deploy 0.2.0
```

The command checks the manifest version and changelog, runs validation, preview
bundle checks, VSIX packaging and the installed Extension Host tests, then pushes
`main` plus the annotated `extension-v0.2.0` tag atomically. It does not commit or
bump versions. On push failure the local tag remains; inspect the remote first,
then retry the exact reviewed tag without force:

```sh
git push --atomic origin refs/heads/main refs/tags/extension-v0.2.0
```

The extension workflow validates the tag and tests the packaged VSIX. It stages
one immutable VSIX, SHA256SUMS, release notes and a descriptor with the source
commit in a draft GitHub release. Marketplace and Open VSX jobs download and
verify these saved assets before publishing through mandatory OIDC. The final
job confirms both stores and their publication receipts, then publishes the
GitHub release. Neither `specification-v*` nor historical `v*` tags publish to
extension stores.

### One-time publisher setup

The publisher owner must complete these account-side steps before pushing the
first extension release:

1. Create or confirm the Marketplace publisher `it-perspectives` and publishing
   rights for `it-perspectives.openenv`.
2. Create an Eclipse account, sign the Open VSX Publisher Agreement, create the
   `it-perspectives` namespace and claim ownership. A temporary account token may
   be needed for namespace bootstrap; no token is stored in this repository.
3. Configure trusted publishing in both stores for GitHub repository
   `it-perspectives/OpenENV` and workflow `release-extension.yml`. Restrict it to
   the intended release workflow/ref claims supported by each store. The workflow
   does not specify a GitHub Environment, so do not require one in the trust policy.
4. Verify the trust policies allow the `extension-v*` release jobs. Those jobs
   request `id-token: write`; no `VSCE_PAT` or `OVSX_PAT` secret is configured.

References: [vsce trusted publishing](https://github.com/microsoft/vscode-vsce/blob/main/README.md#trusted-publishing),
[Open VSX trusted publishing](https://github.com/eclipse-openvsx/openvsx/blob/main/cli/README.md#trusted-publishing),
and [Open VSX publisher setup](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions).
Account ownership and successful token exchange must be verified by the owner;
building a VSIX or passing mocked workflow tests does not establish these rights.

### Partial publication and recovery

Stores cannot be published atomically. If one job fails, the other may already
have published successfully. Fix the account, trust or registry issue and rerun
failed jobs in the same workflow run. Existing versions are confirmed rather
than uploaded again. A full rerun also reuses the staged VSIX after verifying its
commit, identity and checksum; it never replaces the saved package with a rebuild.
The GitHub release remains draft until both stores confirm the exact version.

If OIDC fails, the job fails without falling back to a stored PAT. If a store is
still processing the upload after the polling limit, retry after processing
finishes. If release staging itself fails mid-upload, repair the incomplete draft
assets from the original build; checksum or commit mismatches stop publication.
Never overwrite a tag or an existing store version. Ship corrections as a newer
extension version. Before announcing the release, install from each store in a
fresh profile and confirm preview, completion and Problems diagnostics.

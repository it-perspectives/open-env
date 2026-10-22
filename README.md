<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/openenv-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/openenv-light.svg">
    <img src="docs/openenv-light.svg" alt="OpenENV logo" width="273" height="288">
  </picture>
</p>

An open specification for application environment variable contracts, independent of programming languages and frameworks, serialized as YAML or JSON.

OpenENV describes what variables mean, their types, whether they are required,
their defaults and constraints, and whether they are sensitive. The initial
scope is environment variables only. The repository, specification, and reference
CLI are named **OpenENV**.

**Status:** initial 0.1.0 draft. Release files and publishing workflows are
prepared locally; no GitHub release or npm publication is implied by this README.
The proposed npm package name is `@it-perspectives/openenv`; namespace availability
and publisher permissions must be confirmed before publication.

## Specification and tools

OpenENV separates the contract format from the tools that implement it. This is
the same distinction used by [OpenAPI](https://spec.openapis.org/oas/latest.html)
for HTTP API descriptions: a specification defines the shared rules, while tools
implement those rules for particular platforms.

| Component                                        | Purpose                                                                    | Platform requirements                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Specification](SPEC.md)                         | Defines fields, constraints, decoding, and validation rules.               | Independent of application language and framework.                      |
| [JSON Schema](schemas/openenv-0.1.0.schema.json) | Supports document validation and editor completion for both JSON and YAML. | A compatible JSON Schema Draft 2020-12 validator or editor integration. |
| `@it-perspectives/openenv`                       | Reference JavaScript implementation and CLI.                               | Node.js 22, 24 or 26; no application framework required.                 |

An application on any stack can keep an OpenENV contract and use the CLI in CI
without using Node.js in the application itself. In a Node.js application, the
library can also check values at startup. Its API accepts an environment object;
the application chooses the source of values, when to validate, and how to handle
failures. No framework lifecycle, configuration loader, or dependency injection
integration is required.

Implementations in other languages can consume the same contract without an npm
runtime dependency. They must implement the specification's decoding and semantic
checks in addition to JSON Schema validation, including ECMAScript regular
expression semantics and the specified numeric limits. The current JavaScript
package uses Node.js APIs and is intended for Node.js execution.

## Example

```yaml
openenv: "0.1.0"
info:
  title: Orders service environment
  version: "1.0.0"
variables:
  PORT:
    description: HTTP listen port.
    type: integer
    default: 8080
    minimum: 1
    maximum: 65535
  API_TOKEN:
    description: Token used to call the upstream service.
    type: string
    required: true
    sensitive: true
    minLength: 1
  ALLOWED_HOSTS:
    description: Hosts allowed to access the service.
    type: array
    delimiter: ","
    default: [localhost]
```

Arrays contain strings and require `delimiter: ","` (comma) or `delimiter: " "`
(space). `ALLOWED_HOSTS=localhost,example.invalid` resolves to
`["localhost", "example.invalid"]`. An empty environment value resolves to `[]`;
whitespace and empty elements between repeated delimiters are preserved.

Equivalent complete examples: [YAML](examples/openenv.yaml) and
[JSON](examples/openenv.json). See [SPEC.md](SPEC.md) for normative semantics.

## Fields and requiredness

The full field reference is in [SPEC.md](SPEC.md#3-root-object), including the
[Info Object](SPEC.md#4-info-object) and [Variable Object](SPEC.md#5-variable-object).
The JSON Schema provides the machine-readable field definitions.

- A document requires `openenv`, `info`, and `variables`.
- `info` requires `title` and `version`.
- Each variable requires `description` and `type`. An `array` also requires
  `delimiter`, even when it has a default.
- The variable field `required` is optional and defaults to `false`. It controls
  whether an environment value must be available after resolving a default.

For example, `minLength` is an optional constraint available only for `string`
variables. `minLength: 1` rejects an empty string, while `required: true` reports
an absent variable when no default exists. Length is measured in Unicode code
points. Declaring a constraint does not make the environment variable required.

## Validation and schema selection

Both JSON and YAML are parsed into the same data model. The reference validator
first checks syntax and supported serialization features, then validates the
document against JSON Schema, then checks additional semantics such as
`minLength <= maxLength` and whether defaults and examples satisfy constraints.
Environment checking additionally decodes and validates the deployed values.

The CLI and library bundle their schema with the npm package and do not download
it from the document's `$schema` URL. The initial implementation supports exactly
`openenv: "0.1.0"` and rejects other versions. A root `$schema` is optional and,
when present, must equal the versioned schema URL defined by the specification.
Editors obtain their schema through a separate association described below.

## Use from this checkout

Supports Node.js 22, 24 and 26 with npm. CI uses the pinned open-tooling v0.1.0 workflows on all three majors.

```sh
npm ci --ignore-scripts
npm run verify
node bin/openenv.js lint examples/openenv.yaml examples/openenv.json
node bin/openenv.js lint ./openenv.yaml --format json --warnings-as-errors
```

To validate the current process environment:

```sh
node bin/openenv.js check ./openenv.yaml
```

To load a local `.env` file using Node's built-in loader:

```sh
node --env-file=.env bin/openenv.js check ./openenv.yaml
```

| Command | What it checks                                                                                                    | Example failure                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `lint`  | The contract: fields, types, constraints, defaults, examples, and enums. It does not inspect environment values.  | `type: array` without `delimiter`, or a default outside its declared bounds. |
| `check` | Everything checked by `lint`, plus values in the current `process.env`: presence, type decoding, and constraints. | A missing required variable, or `PORT=abc` when `PORT` has `type: integer`.  |

`check` does not load `.env` files itself; the command above uses Node's loader.
It resolves defaults for validation without changing the process environment or
injecting values into another application. Both commands report diagnostics and
never output environment values. To obtain typed values and resolved defaults in
an application, use the `checkEnvironment` API shown below.

## Add OpenENV to an application

Keep an `openenv.yaml` or `openenv.json` beside the application code. Pin the
specification version in `openenv`, and version your own contract in `info.version`.

Once the npm package is published:

```sh
npm install --save-dev --save-exact @it-perspectives/openenv@0.1.0
npx --no-install openenv lint openenv.yaml --warnings-as-errors
```

Add `openenv lint openenv.yaml --warnings-as-errors` to your existing CI or npm
scripts. The linter can also consume multiple explicit file paths. Shell-expanded
globs work; the CLI does not implement its own glob or remote URL loading.

For runtime checks, install it as a production dependency instead of a dev dependency:

```js
import { readFileSync } from "node:fs";
import { parseSpec, checkEnvironment } from "@it-perspectives/openenv";

const spec = parseSpec(readFileSync("./openenv.yaml", "utf8"));
const checked = checkEnvironment(spec, process.env);
if (!checked.valid) {
  throw new Error(JSON.stringify(checked.diagnostics));
}
const config = checked.values; // Typed values and defaults; treat secrets carefully.
```

For JSON, use `parseSpec(text, { format: 'json' })`. Public exports are
`parseSpec`, `lintSpec`, `checkEnvironment`, `SpecParseError`, `schema`, and
`specificationVersion`. Results contain `valid` and `diagnostics`. Schema diagnostics additionally expose
`keyword` and, where applicable, `property` for editor source mapping.
`checkEnvironment` additionally returns `values` on success; CLI reports omit them.

The release schema can be vendored for offline use, including by implementations
in other languages.

## Editor integration

A local [Astro documentation website](website/README.md) and
[Open ENV VS Code extension](extensions/vscode/README.md) are available in this
checkout. The preview opens `openenv.yaml`, `openenv.yml`, or `openenv.json` beside
the source and refreshes on unsaved edits using the reference parser and linter.
It does not read environment values and is not published to Marketplace.

```sh
npm run site:dev
npm run site:build
npm run vscode:build
```

See the linked guides for preview launch instructions and verification.

After `v0.1.0` is published, configure the YAML language server:

```json
{
  "yaml.schemas": {
    "https://raw.githubusercontent.com/it-perspectives/OpenENV/v0.1.0/schemas/openenv-0.1.0.schema.json": [
      "**/openenv.yaml",
      "**/openenv.yml"
    ]
  }
}
```

JSON documents may use that URL as their root `$schema`. Before publication, use
the local [JSON Schema](schemas/openenv-0.1.0.schema.json) in editor configuration.
For VS Code, associate JSON files through `json.schemas` and YAML files through
`yaml.schemas` with a YAML language server installed. The association tells the
editor which schema to load; the `openenv` version field alone does not configure
editor schema discovery.
The npm package also exports the schema at `@it-perspectives/openenv/schema`.
Always pin a release URL; a schema from `main` is a moving target.

## Release contents and distribution

Each release includes the normative specification, versioned JSON Schema,
matching YAML/JSON examples, reference linter/checker, conformance tests,
compatibility notes, license, source archive, npm tarball, and SHA-256 checksums.

```sh
npm run release:prepare
node scripts/smoke-package.js
```

These commands prepare `dist/` and test the actual npm tarball in an isolated
consumer. They do not publish anything. See [the release guide](docs/releases.md)
for GitHub releases, npm distribution, version policy, and the publishing steps.

After preparing and committing the release on `main`, publish its tag with:

```sh
npm run deploy 0.1.0
```

This checks the prepared version, builds and tests the release assets, and pushes
`main` and an annotated tag to `origin`. Shared open-tooling CI saves the complete
verified bundle as `open-products` and publishes it to GitHub Releases on a matching
component tag. The manifest requires every product; extension tags publish the
tested VSIX to both stores through OIDC. npm registry publication is a separate
maintainer step. See [.open-project.json](.open-project.json) and the
[release guide](docs/releases.md) for the pinned workflows and artifact layout.

## Contributors

- [Kolosov Aleksandr (@dnwsilver)](https://github.com/dnwsilver)

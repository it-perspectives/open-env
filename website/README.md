# OpenENV website

Local Astro 7 website generating five static HTML pages. Graphite panels, cyan
controls, orange corner marks and the existing logo preserve the console design.
No hosting deployment is configured. Builds support Node.js 22.12+, 24 and 26.
Shared open-tooling CI packages the static site and its tested Docker image in the
`open-products` bundle; website versions are tracked in `package.json` and `CHANGELOG.md`.

## Development

Install from the repository root. The website is a private npm workspace with
its own pinned dependencies and the shared root lockfile.

```sh
npm ci --ignore-scripts
npm run site:dev
```

Open http://127.0.0.1:4321. Astro refreshes pages when sources change.

```sh
npm run site:check
npm run site:build
npm run site:preview
```

`site:check` validates TypeScript and Astro files. `site:build` generates
`website/dist`; `site:preview` serves that output locally. Stop servers with Ctrl+C.

## Source structure

```text
website/
  astro.config.mjs          Static output and normal URL routes
  package.json             Private npm workspace
  src/
    pages/                 Overview, contract, types, quickstart, VS Code
    layouts/               Shared HTML shell and metadata
    components/
      ui/                  Section, badge, intro, code block, command, flow
      contract/            Explorer, variable detail, source viewer
      preview/             YAML live preview and DOM templates
      Header.astro
      Sidebar.astro
      Footer.astro
      Hero.astro
      Metrics.astro
    data/                  Prose, navigation and reference example
    types/                 Contract and diagnostic TypeScript models
    lib/                   Variable formatting helpers
    scripts/               Small browser controllers
    styles/                Formatted shared design styles
    generated/             Ignored browser validator
  public/                  Ignored assets copied from repository sources
  dist/                    Ignored static build output
```

Pages compose components; `data/content.ts` holds prose, decoding rules, CLI steps
and integration examples. `data/contract.ts` imports the actual repository examples.
Astro renders the content, table rows and variable details at build time. Navigation
uses `/contract/`, `/types/`, `/quickstart/` and `/vscode/`, each with its own HTML.
The explanatory pages and initial contract view remain readable without JavaScript.

Browser scripts enhance search, filters, selection, source tabs, copy buttons,
mobile navigation and editable preview. There is no SPA router or HTML assembled
from template strings. Preview clones templates defined in its Astro component
and assigns text with `textContent`, without interpreting contract text as HTML.

`scripts/prepare-site.js` runs before dev, check and build. It refreshes the logo,
specification, schema and downloadable examples in `public`, and bundles reference
`parseSpec` and `lintSpec` into `src/generated`. The adapter only replaces the Node
filesystem schema loader and UTF-8 size check; semantic validation is unchanged.
No YAML is sent to a server. Rebuild after changing reference code or assets.
The site uses Google Fonts with local font fallbacks.

## Docker image

Build from the repository root:

```sh
docker build -f website/Dockerfile -t openenv-website:local .
node scripts/smoke-website-image.js openenv-website:local
docker run --rm -p 127.0.0.1:8080:8080 openenv-website:local
```

Open http://127.0.0.1:8080. The build stage installs locked dependencies and
generates Astro's static pages. The runtime image contains Nginx and static files,
runs as UID/GID 101, listens on port 8080 and exposes `/healthz`. Clean URL routes
serve their own index files; unknown pages return 404. The smoke command creates
and removes its own temporary container.

GitHub Actions builds and tests `linux/amd64`, then saves
`openenv-website-linux-amd64.tar.gz` as an artifact with the source commit in its
artifact name. Load it with `docker load --input openenv-website-linux-amd64.tar.gz`.
The loaded image tag is `openenv-website:<commit-sha>`. On ARM hosts, run the CI image
with `--platform linux/amd64`, or build the Dockerfile locally for the native host.
No image registry push or website deployment is configured.

## Formatting and verification

```sh
npm run format --workspace @openenv/website
npm run format:check --workspace @openenv/website
npm run previews:verify
npm run verify
```

Sources are formatted with Prettier and its Astro plugin. Generated output may
be compacted by Astro.

This repository is for local development. Do not register, synchronize, publish,
or deploy the website without an explicit user request. Local development and
build commands do not publish anything.

Content follows the current draft and deliberately does not imply npm or
Marketplace publication. See [VS Code preview](../extensions/vscode/README.md).

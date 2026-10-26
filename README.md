# Cortex

Cortex is [RS42](https://rs42.ai)'s public learning site about building with AI agents. Its linked notes cover memory, tool connections, skills, autonomy, and the work that remains with the human.

Read it at **[cortex.rs42.ai](https://cortex.rs42.ai/)**, begin with **[Start Here](https://cortex.rs42.ai/start-here)**, or use this repository to study how the same published material supports a website, grounded questions, and agent access.

## What is in this repository?

- **A knowledge graph in Markdown.** Notes in [`content/`](./content/) connect through links, tags, and teaching units. [Quartz](https://quartz.jzhao.xyz/) turns them into pages with search, backlinks, and local/global graph views.
- **Ask Cortex.** A custom site component sends questions to a Cloudflare Worker. The Worker retrieves a bounded selection of published passages, asks a model for an answer, and checks that its citations refer to those passages.
- **Read-only MCP tools.** Agents can search the public notes, read a note and its links, or list the teaching units through the Model Context Protocol. This interface returns evidence; the calling agent writes the explanation.

The graph gives people and agents a shared set of named, connected sources. The implementation does not run a graph database or perform automatic multi-hop graph reasoning: chat uses text retrieval, while MCP exposes links that a client can follow through subsequent reads. See the [architecture walkthrough](./docs/architecture.md).

## Run the website locally

Use Node.js **22.16.0 or newer** and npm **10.9.2 or newer**. The Worker package also uses **pnpm 10.27.0**.

From the repository root:

```sh
npm ci
npm run quartz -- build --serve --port 8080
```

Open [localhost:8080](http://localhost:8080). Edit the public notes in `content/`, the site settings in `quartz.config.ts`, or the layout in `quartz.layout.ts`.

To build static files without starting the development server:

```sh
npm run quartz -- build
```

The output is `public/`. No model account is needed to build or browse the website. Ask Cortex is omitted unless `CORTEX_CHAT_ENDPOINT` is supplied at build time. Running model-backed chat requires a configured Worker and retrieval service; installing this repository alone does not provision them.

## Check the code

Website tests, TypeScript checks, and the publication scan (Python 3 and Bash required), from the repository root:

```sh
npm test
npx tsc --noEmit
npm run check:publication
```

Worker tests and bundle validation:

```sh
cd workers/cortex-access
pnpm install --frozen-lockfile
pnpm test
pnpm run check
```

`check` validates the bundled corpus and chunk manifest, checks types and formatting, and creates Wrangler dry-run bundles. It does not deploy a service.

For a focused, provider-free chat check:

```sh
pnpm run verify:retrieval-loopback
```

This test supplies recorded semantic candidates, starts a deterministic model on localhost, and exercises the actual evidence selector and citation validator. It demonstrates the code path; it does not measure a live model's answer quality. The [Worker guide](./workers/cortex-access/README.md) covers its routes, configuration, and integration checks.

## Content and service updates

The website and Worker have separate build artifacts. The Worker bundles a validated snapshot of the public site's content index; it does not read a private vault or fetch the website for each question. Publishing a website edit does not automatically refresh chat or MCP. Corpus refresh, retrieval-index alignment, and a Worker release must be coordinated. The [architecture walkthrough](./docs/architecture.md#keeping-the-corpus-in-sync) explains the sequence.

## Licenses and attribution

The repository contains material under different licenses:

- **Original code and configuration:** [MIT](./LICENSE).
- **Teaching notes in `content/` and their generated copies:** [CC BY-NC 4.0](./LICENSE-content), with attribution and noncommercial terms.
- **Upstream Quartz code:** Jacky Zhao's original [MIT license](./LICENSE-quartz.txt), preserved separately.

Generated corpus files contain the same educational material and retain its content license. Public access to the repository does not make all of its contents unrestricted for commercial reuse.

Cortex builds on [Quartz](https://github.com/jackyzha0/quartz) by Jacky Zhao. Its upstream documentation is at [quartz.jzhao.xyz](https://quartz.jzhao.xyz/). See the [code of conduct](./CODE_OF_CONDUCT.md) for participation guidelines.

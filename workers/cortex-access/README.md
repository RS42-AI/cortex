# Cortex access Worker

This package exposes a reviewed public teaching corpus through grounded chat and
read-only Model Context Protocol (MCP) tools. The bundled corpus comes from the
Quartz content index. It has no connection to a private vault at runtime.

## How the interfaces use the graph

- `GET /health` reports service health without a model call.
- `POST /chat` combines local BM25 ranking with semantic candidates from a
  Vectorize index. It selects up to six chunks within 2,500 estimated evidence
  tokens, gives the answer model server-owned source IDs, and validates citations
  against that selected evidence. Index pages are deprioritized, not universally
  excluded. This is retrieval over linked notes, not graph traversal reasoning.
- `POST /mcp` provides `search_cortex`, `read_cortex_note`, and `list_cortex_units`.
  MCP search is lexical and model-free; an agent can search, read a note, inspect
  its public links, and decide which note to read next. No tool writes content.
  MCP uses POST; GET does not provide an event stream.

The two routes can run as separate Workers over the same bundled corpus, with
independent enable switches, origins, rate limits, and model access. Publishing a
website change does not update a deployed Worker: regenerate its corpus, validate
it, and release the matching Worker explicitly. See [the architecture](../../docs/architecture.md).

## Local checks and MCP

Use Node.js 22 or newer and pnpm 10.27.0. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run check
pnpm run dev
```

`pnpm run dev` uses `wrangler.dev.jsonc` on `127.0.0.1:8788`. Its chat route is
disabled, MCP accepts localhost, and it declares no remote AI or Vectorize binding.
No Cloudflare account is needed for the local MCP service. In a second terminal:

```sh
pnpm run verify:mcp http://127.0.0.1:8788/mcp
pnpm run verify:mcp http://127.0.0.1:8788/mcp legacy
```

Example client connections to that running service:

```sh
codex mcp add cortex-local --url http://127.0.0.1:8788/mcp
claude mcp add --transport http --scope user cortex-local http://127.0.0.1:8788/mcp
```

A useful first request is: list the units, search for shared memory, read a result,
and explain it with its public source link. Remote clients require a separately
configured HTTPS deployment; localhost on another machine is not this service.

## Test grounded chat without a provider

```sh
pnpm run verify:retrieval-loopback
CORTEX_SEMANTIC_RESULTS=test/fixtures/qmd-semantic-results.json pnpm run evaluate:retrieval
```

The loopback test starts a deterministic localhost model and exercises the bounded
selector and citation validator with test retrieval bindings. It does not call an
external model. The offline evaluator uses its own configurable bounds and a
recorded QMD fixture; its result is not proof of a live Cloudflare deployment.
`benchmark:semantic:qmd` requires QMD and cached local models and is optional.

A browser-to-Worker chat demonstration needs a configured retrieval index,
embedding binding, and answer model. `.dev.vars.example` shows optional mock
answer-model settings; copying that file alone does not provision retrieval.
Without retrieval configuration the route returns `retrieval_unconfigured` and
never sends the full corpus as a fallback. The stock local configuration keeps
chat disabled; provision your own development resources before enabling it.

Once a development Worker is configured, build Quartz from the repository root:

```sh
CORTEX_CHAT_ENDPOINT=http://127.0.0.1:8788/chat npx quartz build --serve --port 8080
```

Without `CORTEX_CHAT_ENDPOINT`, Quartz omits the chat UI. Use exact browser origins;
`localhost` and `127.0.0.1` are different origins.

## Refresh the corpus from reviewed site output

Build Quartz first, then synchronize its local output from this directory:

```sh
pnpm run sync:corpus
pnpm run validate:corpus
pnpm run build:retrieval-manifest
pnpm run validate:retrieval-manifest
pnpm test
```

The default source is the repository's `public/static/contentIndex.json`. An
explicit local path or HTTP(S) content-index URL may be supplied as the final
argument. Only use a reviewed public artifact. The importer validates the content
and applies a 2 MB input bound. Review titles, slugs, link targets, record count,
and corpus/manifest hashes before a release. Generated prose is still licensed
as educational content under [CC BY-NC 4.0](../../LICENSE-content), including
copies under `src/generated/` and the chunk manifest.

## Configure your own deployment

`wrangler.jsonc` and `wrangler.mcp.jsonc` are examples using `my-cortex-*` resource
names and `example.com` hostnames. They do not describe or reconfigure the hosted
Cortex service. Configure your own account, names, exact allowed origins, limiter
namespaces, and hostname bindings before using them. Keep real credentials and
local overrides outside Git. `pnpm run check` performs tests of the corpus,
TypeScript/format checks, and deployment dry runs; it does not publish.

For chat, provision an AI Gateway and Vectorize index, bind Workers AI, and set a
model and calibrated semantic threshold. The example uses `@cf/baai/bge-m3` and a
0.46 score floor from the reference implementation; recalibrate for a different
corpus, embedding model, or index. Native model calls request payload logging off
and caching off, but account-level logging, spending limits, billing, and access
controls remain the operator's responsibility.

`index:vectorize` calls Workers AI and writes a local NDJSON payload. It can incur
provider usage but does not create or modify a Vectorize index. Use a token with
only the permissions required for that embedding call; any separate index write
needs its own reviewed access. `snapshot:vectorize` requires an explicit
`CORTEX_VECTORIZE_INDEX` and reads the selected index into a local evaluation
snapshot. These provider-backed tools are not part of the credential-free checks.

Keep preview and production resources separate. Review a preview with matching
site origins, corpus/index versions, citations, denied-origin behavior, and usage
controls before production. The repository owner personally performs the final
production deployment and merge according to the repository rules. Copying this
repository does not transfer an existing Pages project, Worker, Gateway, or index.

## Configuration reference

| Binding or variable                   | Purpose                                                             |
| ------------------------------------- | ------------------------------------------------------------------- |
| `CHAT_ENABLED` / `MCP_ENABLED`        | Independent route switches                                          |
| `CORTEX_ALLOWED_ORIGINS`              | Exact comma-separated browser origins for chat                      |
| `MCP_ALLOWED_HOSTNAMES`               | Exact hostnames accepted by MCP                                     |
| `MCP_ALLOWED_ORIGINS`                 | Allowed browser origins; origin-less native clients can connect     |
| `ENVIRONMENT`                         | Production mode requires rate limiting and production configuration |
| `AI`                                  | Native Workers AI binding for embedding and supported answer models |
| `CORTEX_VECTORIZE`                    | Semantic index binding with stable chunk IDs in metadata            |
| `RETRIEVAL_EMBEDDING_MODEL`           | Embedding model matched to the index                                |
| `RETRIEVAL_SEMANTIC_FLOOR`            | Calibrated semantic score threshold                                 |
| `MODEL_API_GATEWAY_ID` / `MODEL_NAME` | Gateway and answer model                                            |
| `MODEL_API_URL` / `MODEL_API_TOKEN`   | Optional compatible REST model endpoint and secret                  |
| `RATE_LIMITER`                        | Required Cloudflare rate limiter in production                      |

Application logging omits question bodies, MCP arguments, retrieved content,
credentials, and IP addresses. Hosting providers may retain their own request
metadata; restrict dashboard/log access and review provider settings separately.

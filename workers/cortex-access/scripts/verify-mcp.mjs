import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"

const endpoint = new URL(process.argv[2] ?? "http://127.0.0.1:8788/mcp")
const negotiationMode = process.argv[3] === "legacy" ? "legacy" : "auto"
const expectedTools = ["search_cortex", "read_cortex_note", "list_cortex_units"]
const client = new Client(
  { name: "cortex-verification", version: "1.0.0" },
  { versionNegotiation: { mode: negotiationMode } },
)

try {
  await client.connect(new StreamableHTTPClientTransport(endpoint))
  const tools = await client.listTools()
  const names = tools.tools.map((tool) => tool.name)
  if (JSON.stringify(names) !== JSON.stringify(expectedTools)) {
    throw new Error(`Unexpected Cortex tools: ${names.join(", ")}`)
  }

  const search = await client.callTool({
    name: "search_cortex",
    arguments: { query: "shared memory", limit: 1 },
  })
  const first = search.structuredContent?.results?.[0]
  if (!first?.slug) throw new Error("Cortex search returned no shared-memory result.")

  const studentSearch = await client.callTool({
    name: "search_cortex",
    arguments: { query: "connect AI to external tools", limit: 3 },
  })
  const studentSearchSlugs = studentSearch.structuredContent?.results?.map((result) => result.slug)
  if (!studentSearchSlugs?.some((slug) => slug.startsWith("02-connections-mcp/"))) {
    throw new Error("Cortex search did not return the Connections unit for student phrasing.")
  }

  const zeroResultSearch = await client.callTool({
    name: "search_cortex",
    arguments: { query: "zygmuntquasar", limit: 3 },
  })
  if (
    zeroResultSearch.isError ||
    zeroResultSearch.structuredContent?.total !== 0 ||
    zeroResultSearch.structuredContent?.results?.length !== 0
  ) {
    throw new Error("Cortex search did not return a successful zero-result response.")
  }

  const read = await client.callTool({
    name: "read_cortex_note",
    arguments: { slug: first.slug },
  })
  if (read.isError || read.structuredContent?.slug !== first.slug) {
    throw new Error("Cortex read did not return the searched note.")
  }

  const missing = await client.callTool({
    name: "read_cortex_note",
    arguments: { slug: "missing-preview-verification-note" },
  })
  if (!missing.isError || missing.structuredContent?.error?.code !== "NOTE_NOT_FOUND") {
    throw new Error("Cortex read did not return the expected NOTE_NOT_FOUND error.")
  }

  const units = await client.callTool({
    name: "list_cortex_units",
    arguments: { includeNotes: false },
  })
  if (
    !Array.isArray(units.structuredContent?.units) ||
    units.structuredContent.units.length === 0
  ) {
    throw new Error("Cortex unit listing returned no teaching units.")
  }

  const getResponse = await fetch(endpoint)
  if (getResponse.status !== 405 || getResponse.headers.get("allow") !== "POST") {
    throw new Error("GET /mcp did not return 405 with Allow: POST.")
  }

  const putResponse = await fetch(endpoint, { method: "PUT" })
  if (putResponse.status !== 405 || putResponse.headers.get("allow") !== "POST") {
    throw new Error("PUT /mcp did not return 405 with Allow: POST.")
  }

  const malformedResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  })
  const malformedBody = await malformedResponse.json()
  if (malformedResponse.status !== 400 || malformedBody.error !== "BAD_REQUEST") {
    throw new Error("Malformed MCP JSON did not return the expected BAD_REQUEST error.")
  }

  const mediaTypeResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  })
  const mediaTypeBody = await mediaTypeResponse.json()
  if (mediaTypeResponse.status !== 415 || mediaTypeBody.error !== "UNSUPPORTED_MEDIA_TYPE") {
    throw new Error("Unsupported MCP media type did not return the expected error.")
  }

  const batchResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "[]",
  })
  const batchBody = await batchResponse.json()
  if (batchResponse.status !== 400 || batchBody.error !== "BAD_REQUEST") {
    throw new Error("MCP batch input did not return the expected BAD_REQUEST error.")
  }

  console.log(
    JSON.stringify(
      {
        endpoint: endpoint.toString(),
        negotiationMode,
        tools: names,
        searchSlug: first.slug,
        studentSearchSlugs,
        zeroResultCount: zeroResultSearch.structuredContent.results.length,
        unitCount: units.structuredContent.units.length,
        missingNoteError: missing.structuredContent.error.code,
        getStatus: getResponse.status,
        putStatus: putResponse.status,
        malformedError: malformedBody.error,
        unsupportedMediaTypeError: mediaTypeBody.error,
        batchError: batchBody.error,
      },
      null,
      2,
    ),
  )
} finally {
  await client.close()
}

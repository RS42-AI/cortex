import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { format, resolveConfig } from "prettier"
import { corpusVersion, validateContentIndex } from "../src/content.ts"

const DEFAULT_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../public/static/contentIndex.json",
)
const source = process.argv[2] ?? DEFAULT_SOURCE
const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/generated/cortex-content.json",
)

let bytes: Uint8Array
if (/^https?:\/\//.test(source)) {
  const response = await fetch(source, { headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`Cortex corpus download failed with ${response.status}.`)
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Cortex corpus response has no body.")
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > 2_000_000) {
      await reader.cancel()
      throw new Error("Cortex corpus exceeds the 2 MB build limit.")
    }
    chunks.push(value)
  }
  bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
} else {
  const input = resolve(source)
  if ((await stat(input)).size > 2_000_000)
    throw new Error("Cortex corpus exceeds the 2 MB build limit.")
  bytes = await readFile(input)
  if (bytes.byteLength > 2_000_000) throw new Error("Cortex corpus exceeds the 2 MB build limit.")
}

const index = validateContentIndex(JSON.parse(new TextDecoder().decode(bytes)))
await mkdir(dirname(output), { recursive: true })
const prettierConfig = (await resolveConfig(output)) ?? {}
await writeFile(
  output,
  await format(JSON.stringify(index), { ...prettierConfig, filepath: output }),
  "utf8",
)
console.log(
  JSON.stringify({
    source,
    output,
    records: Object.keys(index).length,
    version: await corpusVersion(index),
  }),
)

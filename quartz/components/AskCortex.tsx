import { QuartzComponent, QuartzComponentConstructor } from "./types"
import style from "./styles/askCortex.scss"
// @ts-ignore
import script from "./scripts/askCortex.inline"

export interface AskCortexOptions {
  endpoint: string
  mockResponses: boolean
  citationOrigin: string
}

const defaultOptions: AskCortexOptions = {
  endpoint: "/chat",
  mockResponses: false,
  citationOrigin: "https://cortex.rs42.ai",
}

export default ((userOpts?: Partial<AskCortexOptions>) => {
  const opts = { ...defaultOptions, ...userOpts }

  const AskCortex: QuartzComponent = () => {
    const privacyCopy = opts.mockResponses
      ? "Preview questions stay in this browser tab. History clears when you refresh."
      : "Questions and recent chat context are sent to the Cortex answer service. History clears when you refresh."

    return (
      <div
        class="ask-cortex"
        data-endpoint={opts.endpoint}
        data-mock-responses={String(opts.mockResponses)}
        data-citation-origin={opts.citationOrigin}
      >
        <button
          class="ask-cortex-trigger"
          type="button"
          aria-controls="ask-cortex-panel"
          aria-expanded="false"
        >
          <span class="ask-cortex-trigger-mark" aria-hidden="true">
            ?
          </span>
          <span>Ask Cortex</span>
        </button>

        <div class="ask-cortex-backdrop" hidden aria-hidden="true"></div>
        <section
          class="ask-cortex-panel"
          id="ask-cortex-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ask-cortex-title"
          aria-describedby="ask-cortex-description"
          hidden
        >
          <header class="ask-cortex-header">
            <div>
              <p class="ask-cortex-eyebrow">Grounded in published notes</p>
              <h2 id="ask-cortex-title">Ask Cortex</h2>
              <p id="ask-cortex-description">
                Get a concise answer, then follow the sources into the knowledge graph.
              </p>
            </div>
            <button class="ask-cortex-close" type="button" aria-label="Close Ask Cortex">
              <span aria-hidden="true">×</span>
            </button>
          </header>

          <div class="ask-cortex-messages" role="log" aria-live="polite" aria-relevant="additions">
            <div class="ask-cortex-empty">
              <p>Ask about memory, MCP, skills, autonomy, or practical AI leverage.</p>
              <div class="ask-cortex-suggestions" aria-label="Suggested questions">
                <button type="button" data-question="Why does memory matter for AI work?">
                  Why does memory matter?
                </button>
                <button type="button" data-question="What does MCP make possible?">
                  What does MCP make possible?
                </button>
              </div>
            </div>
          </div>

          <p class="ask-cortex-error" role="alert" hidden></p>

          <form class="ask-cortex-form">
            <label for="ask-cortex-question">Your question</label>
            <div class="ask-cortex-composer">
              <textarea
                id="ask-cortex-question"
                name="question"
                rows={2}
                maxlength={1000}
                placeholder="Ask about the published Cortex notes…"
                required
              ></textarea>
              <button class="ask-cortex-send" type="submit">
                Ask
              </button>
            </div>
            <div class="ask-cortex-form-meta">
              <span class="ask-cortex-count" aria-live="polite">
                0 / 1000
              </span>
              <span>Enter to send · Shift+Enter for a new line</span>
            </div>
          </form>

          <div class="ask-cortex-footer">
            <p>{privacyCopy}</p>
            <button class="ask-cortex-search-fallback" type="button">
              Search Cortex instead
            </button>
          </div>
        </section>
      </div>
    )
  }

  AskCortex.afterDOMLoaded = script
  AskCortex.css = style

  return AskCortex
}) satisfies QuartzComponentConstructor

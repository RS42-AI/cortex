import {
  ChatMessage,
  ChatResponse,
  CortexChatError,
  mockChat,
  requestChat,
} from "./askCortex.client"

interface DisplayMessage extends ChatMessage {
  citations?: ChatResponse["citations"]
}

let conversation: DisplayMessage[] = []

function interactiveElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true")
}

function setupAskCortex() {
  const root = document.querySelector<HTMLElement>(".ask-cortex")
  if (!root) return

  const trigger = root.querySelector<HTMLButtonElement>(".ask-cortex-trigger")
  const backdrop = root.querySelector<HTMLElement>(".ask-cortex-backdrop")
  const panel = root.querySelector<HTMLElement>(".ask-cortex-panel")
  const closeButton = root.querySelector<HTMLButtonElement>(".ask-cortex-close")
  const messages = root.querySelector<HTMLElement>(".ask-cortex-messages")
  const form = root.querySelector<HTMLFormElement>(".ask-cortex-form")
  const questionInput = root.querySelector<HTMLTextAreaElement>("#ask-cortex-question")
  const sendButton = root.querySelector<HTMLButtonElement>(".ask-cortex-send")
  const count = root.querySelector<HTMLElement>(".ask-cortex-count")
  const error = root.querySelector<HTMLElement>(".ask-cortex-error")
  const searchFallback = root.querySelector<HTMLButtonElement>(".ask-cortex-search-fallback")
  const suggestionButtons = root.querySelectorAll<HTMLButtonElement>("[data-question]")

  if (
    !trigger ||
    !backdrop ||
    !panel ||
    !closeButton ||
    !messages ||
    !form ||
    !questionInput ||
    !sendButton ||
    !count ||
    !error ||
    !searchFallback
  ) {
    return
  }

  const input = questionInput
  const errorMessage = error
  const endpoint = root.dataset.endpoint || "/chat"
  const useMockResponses = root.dataset.mockResponses === "true"
  const citationOrigin = root.dataset.citationOrigin || location.origin
  let isOpen = false
  let isLoading = false
  let pendingQuestion = ""
  let returnFocus: HTMLElement | null = null
  let abortController: AbortController | null = null

  const clearError = () => {
    errorMessage.hidden = true
    errorMessage.textContent = ""
  }

  const showError = (message: string) => {
    errorMessage.textContent = message
    errorMessage.hidden = false
  }

  const appendMessage = (message: DisplayMessage, pending = false) => {
    const item = document.createElement("article")
    item.className = `ask-cortex-message ask-cortex-message-${message.role}`
    if (pending) item.classList.add("is-pending")

    const label = document.createElement("p")
    label.className = "ask-cortex-message-label"
    label.textContent = message.role === "user" ? "You" : "Cortex"

    const content = document.createElement("p")
    content.className = "ask-cortex-message-content"
    content.textContent = message.content

    item.append(label, content)

    if (message.citations?.length) {
      const sources = document.createElement("div")
      sources.className = "ask-cortex-sources"
      const sourceLabel = document.createElement("p")
      sourceLabel.textContent = message.citations.length === 1 ? "Source" : "Sources"
      const list = document.createElement("ul")
      for (const citation of message.citations) {
        const listItem = document.createElement("li")
        const link = document.createElement("a")
        link.href = citation.url
        link.textContent = citation.title
        listItem.append(link)
        list.append(listItem)
      }
      sources.append(sourceLabel, list)
      item.append(sources)
    }

    messages.append(item)
  }

  const renderMessages = () => {
    messages.replaceChildren()
    for (const message of conversation) appendMessage(message)
    if (pendingQuestion) {
      appendMessage({ role: "user", content: pendingQuestion }, true)
      const thinking = document.createElement("div")
      thinking.className = "ask-cortex-thinking"
      thinking.setAttribute("role", "status")
      thinking.innerHTML = "<span></span><span></span><span></span><em>Cortex is reading…</em>"
      messages.append(thinking)
    }

    if (conversation.length === 0 && !pendingQuestion) {
      const empty = document.createElement("div")
      empty.className = "ask-cortex-empty"
      empty.innerHTML = `<p>Ask about memory, MCP, skills, autonomy, or practical AI leverage.</p>
        <div class="ask-cortex-suggestions" aria-label="Suggested questions">
          <button type="button" data-question="Why does memory matter for AI work?">Why does memory matter?</button>
          <button type="button" data-question="What does MCP make possible?">What does MCP make possible?</button>
        </div>`
      messages.append(empty)
      bindSuggestions(empty.querySelectorAll<HTMLButtonElement>("[data-question]"))
    }

    messages.setAttribute("aria-busy", String(isLoading))
    messages.scrollTop = messages.scrollHeight
  }

  const setLoading = (loading: boolean) => {
    isLoading = loading
    input.disabled = loading
    sendButton.disabled = loading
    sendButton.textContent = loading ? "Reading…" : "Ask"
    renderMessages()
  }

  const openPanel = () => {
    if (isOpen) return
    isOpen = true
    returnFocus = document.activeElement as HTMLElement | null
    root.classList.add("is-open")
    panel.hidden = false
    backdrop.hidden = false
    trigger.setAttribute("aria-expanded", "true")
    document.body.classList.add("ask-cortex-open")
    renderMessages()
    window.setTimeout(() => input.focus(), 0)
  }

  const closePanel = () => {
    if (!isOpen) return
    isOpen = false
    root.classList.remove("is-open")
    panel.hidden = true
    backdrop.hidden = true
    trigger.setAttribute("aria-expanded", "false")
    document.body.classList.remove("ask-cortex-open")
    clearError()
    ;(returnFocus ?? trigger).focus()
  }

  const updateCount = () => {
    count.textContent = `${input.value.length} / 1000`
  }

  async function submitQuestion() {
    if (isLoading) return
    const question = input.value.trim()
    if (!question) {
      showError("Enter a question to continue.")
      input.focus()
      return
    }

    clearError()
    pendingQuestion = question
    setLoading(true)
    abortController = new AbortController()
    const timeout = window.setTimeout(() => abortController?.abort(), 15_000)

    try {
      let response: ChatResponse
      if (useMockResponses) {
        await new Promise((resolve) => window.setTimeout(resolve, 450))
        response = mockChat(question)
      } else {
        response = await requestChat({
          endpoint,
          question,
          history: conversation.map(({ role, content }) => ({ role, content })),
          baseUrl: location.href,
          allowedCitationOrigins: [location.origin, citationOrigin],
          signal: abortController.signal,
        })
      }

      conversation.push(
        { role: "user", content: question },
        { role: "assistant", content: response.answer, citations: response.citations },
      )
      conversation = conversation.slice(-6)
      pendingQuestion = ""
      input.value = ""
      updateCount()
    } catch (caught) {
      pendingQuestion = ""
      if (caught instanceof DOMException && caught.name === "AbortError") {
        showError("Cortex took too long to answer. Try again or use site search.")
      } else if (caught instanceof CortexChatError && caught.status === 429) {
        showError("Cortex has reached its current question limit. Use site search for now.")
      } else {
        showError("Cortex is temporarily unavailable. Try again or use site search.")
      }
    } finally {
      window.clearTimeout(timeout)
      abortController = null
      setLoading(false)
      if (!errorMessage.hidden) input.focus()
    }
  }

  function bindSuggestions(buttons: NodeListOf<HTMLButtonElement>) {
    for (const button of buttons) {
      const onSuggestion = () => {
        input.value = button.dataset.question ?? ""
        updateCount()
        input.focus()
      }
      button.addEventListener("click", onSuggestion)
      window.addCleanup(() => button.removeEventListener("click", onSuggestion))
    }
  }

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault()
    void submitQuestion()
  }
  const onInputKeydown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      void submitQuestion()
    }
  }
  const onPanelKeydown = (event: KeyboardEvent) => {
    if (!isOpen) return
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closePanel()
      return
    }
    if (event.key !== "Tab") return

    const focusable = interactiveElements(panel)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  const onSearchFallback = () => {
    closePanel()
    const searchButton = document.querySelector<HTMLButtonElement>(".search-button")
    if (searchButton) searchButton.click()
  }

  trigger.addEventListener("click", openPanel)
  closeButton.addEventListener("click", closePanel)
  backdrop.addEventListener("click", closePanel)
  form.addEventListener("submit", onSubmit)
  questionInput.addEventListener("input", updateCount)
  questionInput.addEventListener("keydown", onInputKeydown)
  panel.addEventListener("keydown", onPanelKeydown)
  searchFallback.addEventListener("click", onSearchFallback)
  bindSuggestions(suggestionButtons)
  renderMessages()

  window.addCleanup(() => {
    abortController?.abort()
    document.body.classList.remove("ask-cortex-open")
    trigger.removeEventListener("click", openPanel)
    closeButton.removeEventListener("click", closePanel)
    backdrop.removeEventListener("click", closePanel)
    form.removeEventListener("submit", onSubmit)
    questionInput.removeEventListener("input", updateCount)
    questionInput.removeEventListener("keydown", onInputKeydown)
    panel.removeEventListener("keydown", onPanelKeydown)
    searchFallback.removeEventListener("click", onSearchFallback)
  })
}

document.addEventListener("nav", setupAskCortex)

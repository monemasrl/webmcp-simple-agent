import { marked } from 'marked'
import { runAgentTurn, type AgentEvent } from './agent'
import { ClaudeApiError, makeProviderClient, type Message } from './claude'
import { listTabTools, makeCallTool, toToolDefs } from './tab-tools'
import { loadSettings } from '../shared/settings'
import type { ToolDescriptor } from '../shared/protocol'

const SYSTEM_PROMPT =
  'You are an assistant operating on the current web page through the tools it exposes. ' +
  'Use the tools to look up real data instead of guessing names or ids. ' +
  'Some actions require the user to confirm inside the page; if a tool reports the user did not approve, stop and say so. ' +
  'Answer in the language of the user prompt.'

const HISTORY_KEY = 'wm-messages'

marked.setOptions({ async: false })

const app = document.getElementById('app')!
app.innerHTML = `
  <div id="banner" hidden></div>
  <div id="header">
    <span id="toolcount">Loading tools…</span>
    <label id="debug-label"><input type="checkbox" id="debug-toggle"> Debug</label>
  </div>
  <div id="chat"></div>
  <form id="composer">
    <textarea id="prompt" rows="3" placeholder="Ask something about this page…"></textarea>
    <button id="send" type="submit">Send</button>
  </form>
`

const banner = document.getElementById('banner')!
const toolcount = document.getElementById('toolcount')!
const chat = document.getElementById('chat')!
const promptEl = document.getElementById('prompt') as HTMLTextAreaElement
const sendBtn = document.getElementById('send') as HTMLButtonElement
const debugToggle = document.getElementById('debug-toggle') as HTMLInputElement

let debugMode = false
debugToggle.addEventListener('change', () => {
  debugMode = debugToggle.checked
  document.body.classList.toggle('debug-on', debugMode)
})

// Parallel display history (for re-render after reload)
type DisplayItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'notice'; text: string }
  | { kind: 'error'; text: string }

let messages: Message[] = []
let displayHistory: DisplayItem[] = []
let currentTools: ToolDescriptor[] = []
let busy = false

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ messages, displayHistory }))
  } catch {
    // storage full — ignore
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    messages = parsed.messages ?? []
    displayHistory = parsed.displayHistory ?? []
    for (const item of displayHistory) renderDisplayItem(item)
  } catch {
    // corrupted — start fresh
    localStorage.removeItem(HISTORY_KEY)
  }
}

function renderMarkdown(text: string): string {
  const result = marked.parse(text)
  return typeof result === 'string' ? result : text
}

function appendEl(el: HTMLElement) {
  chat.appendChild(el)
  chat.scrollTop = chat.scrollHeight
}

function renderDisplayItem(item: DisplayItem) {
  if (item.kind === 'user') {
    const div = document.createElement('div')
    div.className = 'bubble user'
    div.textContent = item.text
    appendEl(div)
  } else if (item.kind === 'assistant') {
    const div = document.createElement('div')
    div.className = 'bubble assistant'
    div.innerHTML = renderMarkdown(item.text)
    appendEl(div)
  } else if (item.kind === 'notice') {
    const div = document.createElement('div')
    div.className = 'notice'
    div.textContent = item.text
    appendEl(div)
  } else if (item.kind === 'error') {
    const div = document.createElement('div')
    div.className = 'bubble error'
    div.textContent = item.text
    appendEl(div)
  }
}

function addDisplay(item: DisplayItem) {
  displayHistory.push(item)
  renderDisplayItem(item)
}

/** Creates a tool-call block with spinner; returns fn to settle it with the result. */
function toolCallBlock(name: string, input: unknown): (ok: boolean, result: string) => void {
  const wrap = document.createElement('div')
  wrap.className = 'tool-block'

  const header = document.createElement('div')
  header.className = 'tool-header'
  header.innerHTML = `<span class="tool-name">${escHtml(name)}</span><span class="spinner" aria-label="loading"></span>`

  const debugIn = document.createElement('pre')
  debugIn.className = 'tool-debug debug-only'
  debugIn.textContent = JSON.stringify(input, null, 2)

  wrap.appendChild(header)
  wrap.appendChild(debugIn)
  appendEl(wrap)

  return (ok: boolean, result: string) => {
    header.querySelector('.spinner')?.remove()
    const status = document.createElement('span')
    status.className = `tool-status ${ok ? 'ok' : 'err'}`
    status.textContent = ok ? '✓' : '✗'
    header.appendChild(status)

    const body = document.createElement('div')
    body.className = 'tool-result'
    // Try markdown; if it's short plain text keep it inline
    const rendered = renderMarkdown(result)
    body.innerHTML = rendered

    const debugOut = document.createElement('pre')
    debugOut.className = 'tool-debug debug-only'
    debugOut.textContent = result

    wrap.appendChild(body)
    wrap.appendChild(debugOut)
    chat.scrollTop = chat.scrollHeight
  }
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderToolCount() {
  toolcount.textContent = currentTools.length
    ? `${currentTools.length} tool${currentTools.length === 1 ? '' : 's'} on this page`
    : 'This page exposes no WebMCP tools.'
}

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

const sendToTab = (tabId: number, msg: unknown) => chrome.tabs.sendMessage(tabId, msg)

async function refreshTools() {
  const tabId = await activeTabId()
  currentTools = tabId === null ? [] : await listTabTools(tabId, sendToTab)
  renderToolCount()
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === 'wm:tools-changed') {
    void refreshTools()
    if (!busy && messages.length > 0) addDisplay({ kind: 'notice', text: 'Tools on this page changed.' })
  }
})

chrome.tabs.onActivated.addListener(() => {
  messages = []
  displayHistory = []
  chat.innerHTML = ''
  localStorage.removeItem(HISTORY_KEY)
  void refreshTools()
})

document.getElementById('composer')!.addEventListener('submit', async (ev) => {
  ev.preventDefault()
  if (busy) return
  const prompt = promptEl.value.trim()
  if (!prompt) return

  const settings = await loadSettings()
  if (!settings.apiKey) {
    banner.hidden = false
    banner.innerHTML = 'Missing API key — <a href="#" id="openOptions">open Options</a>.'
    document.getElementById('openOptions')!.addEventListener('click', () => chrome.runtime.openOptionsPage())
    return
  }
  banner.hidden = true

  const tabId = await activeTabId()
  if (tabId === null) return
  await refreshTools()

  busy = true
  sendBtn.disabled = true
  promptEl.value = ''

  addDisplay({ kind: 'user', text: prompt })
  messages.push({ role: 'user', content: prompt })
  saveHistory()

  // Per-call map: callId (tool_use id) → settler fn; we use name as key during sequential calls
  const settleMap = new Map<string, (ok: boolean, result: string) => void>()

  const onEvent = (e: AgentEvent) => {
    if (e.type === 'phase') {
      return
    } else if (e.type === 'tool-call') {
      const settle = toolCallBlock(e.name, e.input)
      settleMap.set(e.name, settle)
    } else {
      const settle = settleMap.get(e.name)
      settle?.(e.ok, e.result)
      settleMap.delete(e.name)
    }
  }

  try {
    const text = await runAgentTurn({
      client: makeProviderClient(settings.providerId, settings.apiKey),
      model: settings.model,
      system: SYSTEM_PROMPT,
      messages,
      tools: toToolDefs(currentTools),
      callTool: makeCallTool(tabId, sendToTab),
      onEvent,
    })
    addDisplay({ kind: 'assistant', text })
    saveHistory()
  } catch (err) {
    if (err instanceof ClaudeApiError && err.status === 401) {
      banner.hidden = false
      banner.textContent = 'Invalid API key — check Options.'
    }
    const msg = err instanceof Error ? err.message : String(err)
    addDisplay({ kind: 'error', text: msg })
    saveHistory()
  } finally {
    busy = false
    sendBtn.disabled = false
  }
})

loadHistory()
void refreshTools()

import { runAgentTurn, type AgentEvent } from './agent'
import { ClaudeApiError, makeClaudeClient, type Message } from './claude'
import { listTabTools, makeCallTool, toToolDefs } from './tab-tools'
import { loadSettings } from '../shared/settings'
import type { ToolDescriptor } from '../shared/protocol'

const SYSTEM_PROMPT =
  'You are an assistant operating on the current web page through the tools it exposes. ' +
  'Use the tools to look up real data instead of guessing names or ids. ' +
  'Some actions require the user to confirm inside the page; if a tool reports the user did not approve, stop and say so. ' +
  'Answer in the language of the user prompt.'

const app = document.getElementById('app')!
app.innerHTML = `
  <div id="banner" hidden></div>
  <div id="toolcount">Loading tools…</div>
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

const messages: Message[] = []
let currentTools: ToolDescriptor[] = []
let busy = false

function line(cls: string, text: string) {
  const div = document.createElement('div')
  div.className = `line ${cls}`
  div.textContent = text
  chat.appendChild(div)
  chat.scrollTop = chat.scrollHeight
}

function renderToolCount() {
  toolcount.textContent = currentTools.length
    ? `${currentTools.length} tools available on this page`
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
    if (!busy && messages.length > 0) line('notice', 'Tools on this page changed.')
  }
})
chrome.tabs.onActivated.addListener(() => {
  messages.length = 0
  chat.innerHTML = ''
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
  line('user', prompt)
  messages.push({ role: 'user', content: prompt })

  const onEvent = (e: AgentEvent) => {
    if (e.type === 'tool-call') line('tool', `→ ${e.name}(${JSON.stringify(e.input)})`)
    else line('tool', `← ${e.name}: ${e.ok ? 'ok' : 'error'} ${e.result.slice(0, 200)}`)
  }

  try {
    const text = await runAgentTurn({
      client: makeClaudeClient(settings.apiKey),
      model: settings.model,
      system: SYSTEM_PROMPT,
      messages,
      tools: toToolDefs(currentTools),
      callTool: makeCallTool(tabId, sendToTab),
      onEvent,
    })
    line('assistant', text)
  } catch (err) {
    if (err instanceof ClaudeApiError && err.status === 401) {
      banner.hidden = false
      banner.textContent = 'Invalid API key — check Options.'
    }
    line('error', err instanceof Error ? err.message : String(err))
  } finally {
    busy = false
    sendBtn.disabled = false
  }
})

void refreshTools()

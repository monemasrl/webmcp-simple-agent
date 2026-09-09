import { marked } from 'marked'
import { runAgentTurn, type AgentEvent } from '../panel/agent'
import { ClaudeApiError, makeClaudeClient, type Message } from '../panel/claude'
import { loadSettings } from '../shared/settings'
import { WM_NS, type ToolDescriptor } from '../shared/protocol'
import type { ToolDef } from '../panel/claude'

marked.setOptions({ async: false })

// ─── Bridge communication (direct postMessage, no relay needed) ───────────────

let _channelId: string | null = null
let _currentTools: ToolDescriptor[] = []
const _toolResultListeners = new Map<string, (ok: boolean, result: string) => void>()

window.addEventListener('message', (ev) => {
  const msg = ev.data
  if (!msg || msg.ns !== WM_NS) return
  if (msg.kind === 'tools-changed') {
    _channelId = msg.channelId
    _currentTools = msg.tools ?? []
    onToolsChanged(_currentTools)
  } else if (msg.kind === 'tool-result') {
    const settle = _toolResultListeners.get(msg.callId)
    if (settle) {
      _toolResultListeners.delete(msg.callId)
      settle(msg.ok, msg.result)
    }
  }
})

function toToolDefs(tools: ToolDescriptor[]): ToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as ToolDef['input_schema'],
  }))
}

function callTool(name: string, input: unknown): Promise<{ ok: boolean; result: string }> {
  return new Promise((resolve) => {
    if (!_channelId) return resolve({ ok: false, result: 'Bridge not connected' })
    const callId = crypto.randomUUID()
    _toolResultListeners.set(callId, (ok, result) => resolve({ ok, result }))
    window.postMessage({ ns: WM_NS, channelId: _channelId, kind: 'call-tool', callId, name, input }, '*')
  })
}

// ─── Shadow DOM + styles ──────────────────────────────────────────────────────

const CSS = `
:host { all: initial; }

*,*::before,*::after { box-sizing: border-box; }

#fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483646;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #4f46e5;
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 20px rgba(79,70,229,0.45);
  transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.3s ease;
  font-family: system-ui, sans-serif;
}
#fab:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(79,70,229,0.55); }
#fab.hidden { opacity: 0; pointer-events: none; transform: scale(0.7); }
#fab svg { width: 26px; height: 26px; }
#fab .badge {
  position: absolute;
  top: 6px; right: 6px;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: #22c55e;
  border: 2px solid #fff;
}

#panel {
  position: fixed;
  bottom: 96px;
  right: 24px;
  z-index: 2147483647;
  width: 360px;
  height: 520px;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  transform: translateY(16px) scale(0.97);
  opacity: 0;
  pointer-events: none;
  transition: transform 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.22s ease;
}
#panel.open {
  transform: translateY(0) scale(1);
  opacity: 1;
  pointer-events: all;
}

/* Header */
#header {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  flex-shrink: 0;
}
#header .avatar {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: rgba(255,255,255,0.2);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
#header .avatar svg { width: 20px; height: 20px; }
#header .info { flex: 1; min-width: 0; }
#header .title { font-weight: 600; font-size: 14px; line-height: 1.2; }
#header .status { font-size: 11px; opacity: 0.8; display: flex; align-items: center; gap: 4px; margin-top: 1px; }
#header .dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; }
#header .actions { display: flex; gap: 4px; }
#header button {
  background: rgba(255,255,255,0.15);
  border: none; color: #fff; cursor: pointer;
  border-radius: 6px;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
#header button:hover { background: rgba(255,255,255,0.25); }
#header button svg { width: 14px; height: 14px; }

/* Tool count bar */
#toolbar {
  padding: 6px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e8edf2;
  font-size: 11px;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
#toolcount-dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; }

/* Messages */
#messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
  scrollbar-color: #e2e8f0 transparent;
}

/* Welcome */
.welcome {
  text-align: center;
  padding: 32px 16px;
  color: #94a3b8;
}
.welcome .icon { font-size: 32px; margin-bottom: 8px; }
.welcome p { margin: 0; font-size: 13px; line-height: 1.5; }
.welcome strong { color: #64748b; }

/* Bubbles */
.bubble { max-width: 85%; line-height: 1.5; word-break: break-word; }
.bubble.user {
  align-self: flex-end;
  background: #4f46e5;
  color: #fff;
  padding: 9px 13px;
  border-radius: 16px 16px 4px 16px;
  white-space: pre-wrap;
  font-size: 13px;
}
.bubble.assistant {
  align-self: flex-start;
  background: #f1f5f9;
  color: #0f172a;
  padding: 10px 13px;
  border-radius: 16px 16px 16px 4px;
  font-size: 13px;
}
.bubble.error {
  align-self: flex-start;
  background: #fef2f2;
  color: #991b1b;
  padding: 9px 13px;
  border-radius: 12px;
  font-size: 13px;
}
.bubble.assistant p { margin: 0 0 6px; }
.bubble.assistant p:last-child { margin-bottom: 0; }
.bubble.assistant ul, .bubble.assistant ol { margin: 4px 0 6px; padding-left: 18px; }
.bubble.assistant code {
  background: rgba(99,102,241,0.1);
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.bubble.assistant pre {
  background: #1e293b;
  color: #e2e8f0;
  padding: 10px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 6px 0;
}
.bubble.assistant pre code { background: none; padding: 0; color: inherit; font-size: 12px; }

/* Tool block */
.tool-block {
  align-self: flex-start;
  width: 100%;
  max-width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  font-size: 12px;
  background: #fafafa;
}
.tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
  font-family: ui-monospace, monospace;
}
.tool-name { font-weight: 600; color: #4f46e5; font-size: 12px; }
.tool-status { font-size: 12px; line-height: 1; }
.tool-status.ok { color: #16a34a; }
.tool-status.err { color: #dc2626; }
.tool-result {
  padding: 7px 10px;
  color: #334155;
  font-size: 12px;
  word-break: break-word;
  line-height: 1.45;
}
.tool-result p { margin: 0 0 4px; }
.tool-result p:last-child { margin-bottom: 0; }

.debug-only { display: none; }
.debug-on .debug-only {
  display: block;
  padding: 5px 10px;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #94a3b8;
  border-top: 1px dashed #e2e8f0;
  white-space: pre-wrap;
  word-break: break-all;
}

.notice {
  align-self: center;
  font-size: 11px;
  color: #94a3b8;
  text-align: center;
  padding: 2px 0;
}

/* Spinner */
@keyframes spin { to { transform: rotate(360deg); } }
.spinner {
  display: inline-block;
  width: 11px; height: 11px;
  border: 2px solid #c7d2fe;
  border-top-color: #4f46e5;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

/* Input area */
#composer {
  border-top: 1px solid #e8edf2;
  background: #fff;
  padding: 10px 12px;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  flex-shrink: 0;
}
#composer textarea {
  flex: 1;
  resize: none;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 8px 11px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
  max-height: 96px;
  overflow-y: auto;
  outline: none;
  transition: border-color 0.15s;
  color: #0f172a;
  background: #f8fafc;
}
#composer textarea:focus { border-color: #6366f1; background: #fff; }
#composer textarea::placeholder { color: #94a3b8; }
#composer button {
  background: #4f46e5;
  color: #fff;
  border: none;
  border-radius: 10px;
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}
#composer button:hover { background: #4338ca; }
#composer button:disabled { background: #c7d2fe; cursor: default; }
#composer button svg { width: 16px; height: 16px; }

/* Debug toggle row */
#debug-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  padding: 0 12px 8px;
  font-size: 11px;
  color: #94a3b8;
}
#debug-row label { display: flex; align-items: center; gap: 4px; cursor: pointer; }

/* Banner */
#banner {
  background: #fef2f2;
  color: #991b1b;
  padding: 8px 12px;
  font-size: 12px;
  border-bottom: 1px solid #fecaca;
  flex-shrink: 0;
}
#banner a { color: #7f1d1d; }
#banner[hidden] { display: none; }
`

// ─── SVG icons ────────────────────────────────────────────────────────────────

const ICON_CHAT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`
const ICON_SEND = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`
const ICON_BOT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.38-1 1.72V7h1a7 7 0 017 7H3a7 7 0 017-7h1V5.72A2 2 0 1112 2zM7.5 13a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm9 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM3 21v-1a5 5 0 015-5h8a5 5 0 015 5v1H3z"/></svg>`
const ICON_MIN = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>`

// ─── Build DOM ────────────────────────────────────────────────────────────────

const host = document.createElement('div')
host.id = 'webmcp-widget-host'
const shadow = host.attachShadow({ mode: 'closed' })

const styleEl = document.createElement('style')
styleEl.textContent = CSS
shadow.appendChild(styleEl)

const fab = document.createElement('button')
fab.id = 'fab'
fab.setAttribute('aria-label', 'Open AI assistant')
fab.innerHTML = `${ICON_CHAT}<span class="badge"></span>`
fab.classList.add('hidden')
shadow.appendChild(fab)

const panel = document.createElement('div')
panel.id = 'panel'
panel.innerHTML = `
  <div id="header">
    <div class="avatar">${ICON_BOT}</div>
    <div class="info">
      <div class="title">AI Assistant</div>
      <div class="status"><span class="dot"></span><span id="status-text">Online</span></div>
    </div>
    <div class="actions">
      <button id="btn-min" title="Minimize">${ICON_MIN}</button>
      <button id="btn-close" title="Close">${ICON_CLOSE}</button>
    </div>
  </div>
  <div id="banner" hidden></div>
  <div id="toolbar">
    <span id="toolcount-dot"></span>
    <span id="toolcount-label">Checking for tools…</span>
  </div>
  <div id="messages">
    <div class="welcome">
      <div class="icon">✨</div>
      <p>Hi! I'm your AI assistant.<br><strong>Ask me anything about this page.</strong></p>
    </div>
  </div>
  <div id="composer">
    <textarea id="prompt" rows="1" placeholder="Type a message…"></textarea>
    <button id="send" title="Send">${ICON_SEND}</button>
  </div>
  <div id="debug-row">
    <label><input type="checkbox" id="debug-toggle"> Debug</label>
  </div>
`
shadow.appendChild(panel)

document.documentElement.appendChild(host)

// ─── References ───────────────────────────────────────────────────────────────

const $ = (id: string) => panel.querySelector(`#${id}`)
const messagesEl = $('messages') as HTMLDivElement
const promptEl = $('prompt') as HTMLTextAreaElement
const sendBtn = $('send') as HTMLButtonElement
const bannerEl = $('banner') as HTMLDivElement
const toolcountLabel = $('toolcount-label') as HTMLSpanElement
const toolcountDot = $('toolcount-dot') as HTMLSpanElement
const debugToggle = $('debug-toggle') as HTMLInputElement
const statusText = $('status-text') as HTMLSpanElement

let debugMode = false
debugToggle.addEventListener('change', () => {
  debugMode = debugToggle.checked
  messagesEl.classList.toggle('debug-on', debugMode)
})

// ─── State ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are an assistant operating on the current web page through the tools it exposes. ' +
  'Use the tools to look up real data instead of guessing names or ids. ' +
  'Some actions require the user to confirm inside the page; if a tool reports the user did not approve, stop and say so. ' +
  'Answer in the language of the user prompt.'

let messages: Message[] = []
let busy = false
let panelOpen = false

// ─── FAB / panel toggle ───────────────────────────────────────────────────────

function openPanel() {
  panelOpen = true
  panel.classList.add('open')
  fab.innerHTML = `${ICON_CLOSE}`
  fab.setAttribute('aria-label', 'Close AI assistant')
  setTimeout(() => promptEl.focus(), 250)
}
function closePanel() {
  panelOpen = false
  panel.classList.remove('open')
  fab.innerHTML = `${ICON_CHAT}<span class="badge"></span>`
  fab.setAttribute('aria-label', 'Open AI assistant')
}

fab.addEventListener('click', () => {
  if (panelOpen) closePanel(); else openPanel()
})
;($('btn-close') as HTMLButtonElement).addEventListener('click', closePanel)
;($('btn-min') as HTMLButtonElement).addEventListener('click', closePanel)

// ─── Tools detection ──────────────────────────────────────────────────────────

function onToolsChanged(tools: ToolDescriptor[]) {
  if (tools.length > 0) {
    fab.classList.remove('hidden')
    toolcountDot.style.background = '#4ade80'
    toolcountLabel.textContent = `${tools.length} tool${tools.length === 1 ? '' : 's'} available`
    statusText.textContent = 'Online'
  } else {
    fab.classList.add('hidden')
    toolcountDot.style.background = '#94a3b8'
    toolcountLabel.textContent = 'No tools on this page'
    statusText.textContent = 'No tools'
  }
}

// ─── Markdown rendering ───────────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  const result = marked.parse(text)
  return typeof result === 'string' ? result : text
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─── Message rendering ────────────────────────────────────────────────────────

function scrollBottom() { messagesEl.scrollTop = messagesEl.scrollHeight }

function removeWelcome() {
  const w = messagesEl.querySelector('.welcome')
  if (w) w.remove()
}

function appendBubble(cls: string, html: string) {
  removeWelcome()
  const div = document.createElement('div')
  div.className = `bubble ${cls}`
  div.innerHTML = html
  messagesEl.appendChild(div)
  scrollBottom()
}

function appendNotice(text: string) {
  const div = document.createElement('div')
  div.className = 'notice'
  div.textContent = text
  messagesEl.appendChild(div)
  scrollBottom()
}

function toolCallBlock(name: string, input: unknown): (ok: boolean, result: string) => void {
  removeWelcome()
  const wrap = document.createElement('div')
  wrap.className = 'tool-block'
  wrap.innerHTML = `
    <div class="tool-header">
      <span class="tool-name">${escHtml(name)}</span>
      <span class="spinner"></span>
    </div>
    <pre class="debug-only tool-debug">${escHtml(JSON.stringify(input, null, 2))}</pre>
  `
  if (debugMode) wrap.classList.add('debug-on')
  messagesEl.appendChild(wrap)
  scrollBottom()

  return (ok: boolean, result: string) => {
    wrap.querySelector('.spinner')?.remove()
    const header = wrap.querySelector('.tool-header')!
    const status = document.createElement('span')
    status.className = `tool-status ${ok ? 'ok' : 'err'}`
    status.textContent = ok ? '✓' : '✗'
    header.appendChild(status)

    const body = document.createElement('div')
    body.className = 'tool-result'
    body.innerHTML = renderMarkdown(result)
    wrap.appendChild(body)

    const debugOut = document.createElement('pre')
    debugOut.className = 'debug-only tool-debug'
    debugOut.textContent = result
    wrap.appendChild(debugOut)
    scrollBottom()
  }
}

// ─── Auto-resize textarea ─────────────────────────────────────────────────────

promptEl.addEventListener('input', () => {
  promptEl.style.height = 'auto'
  promptEl.style.height = Math.min(promptEl.scrollHeight, 96) + 'px'
})
promptEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    sendBtn.click()
  }
})

// ─── Send ─────────────────────────────────────────────────────────────────────

;($('composer') as HTMLFormElement).addEventListener('submit', (ev) => ev.preventDefault())

sendBtn.addEventListener('click', async () => {
  if (busy) return
  const prompt = promptEl.value.trim()
  if (!prompt) return

  const settings = await loadSettings()
  if (!settings.apiKey) {
    bannerEl.hidden = false
    bannerEl.innerHTML = 'Missing API key — open the extension <a id="opt-link" href="#">Options</a>.'
    bannerEl.querySelector('#opt-link')?.addEventListener('click', (e) => {
      e.preventDefault()
      chrome.runtime.sendMessage({ kind: 'open-options' })
    })
    return
  }
  bannerEl.hidden = true

  if (!_channelId) {
    appendNotice('No WebMCP channel found on this page.')
    return
  }

  busy = true
  sendBtn.disabled = true
  promptEl.value = ''
  promptEl.style.height = 'auto'

  appendBubble('user', escHtml(prompt))
  messages.push({ role: 'user', content: prompt })

  const settleMap = new Map<string, (ok: boolean, result: string) => void>()

  const onEvent = (e: AgentEvent) => {
    if (e.type === 'tool-call') {
      const settle = toolCallBlock(e.name, e.input)
      settleMap.set(e.name, settle)
    } else {
      settleMap.get(e.name)?.(e.ok, e.result)
      settleMap.delete(e.name)
    }
  }

  try {
    const text = await runAgentTurn({
      client: makeClaudeClient(settings.apiKey),
      model: settings.model,
      system: SYSTEM_PROMPT,
      messages,
      tools: toToolDefs(_currentTools),
      callTool,
      onEvent,
    })
    appendBubble('assistant', renderMarkdown(text))
  } catch (err) {
    if (err instanceof ClaudeApiError && err.status === 401) {
      bannerEl.hidden = false
      bannerEl.textContent = 'Invalid API key — check extension Options.'
    }
    appendBubble('error', escHtml(err instanceof Error ? err.message : String(err)))
  } finally {
    busy = false
    sendBtn.disabled = false
    promptEl.focus()
  }
})

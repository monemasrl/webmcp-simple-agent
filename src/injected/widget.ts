import { marked } from 'marked'
import { runAgentTurn, type AgentEvent } from '../panel/agent'
import { ClaudeApiError, makeProviderClient, type Message } from '../panel/claude'
import { loadSettings, saveSettings } from '../shared/settings'
import { PROVIDERS, getProvider, DEFAULT_PROVIDER_ID } from '../shared/providers'
import { WM_NS, type ToolDescriptor } from '../shared/protocol'
import type { ToolDef } from '../panel/claude'

marked.setOptions({ async: false })

// ─── Bridge communication ─────────────────────────────────────────────────────

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

// ─── Slash commands ───────────────────────────────────────────────────────────

type Command = { cmd: string; desc: string }
const COMMANDS: Command[] = [
  { cmd: '/config', desc: 'Configure provider and API key' },
  { cmd: '/model', desc: 'Quick-switch model' },
  { cmd: '/tools', desc: 'List tools available on this page' },
  { cmd: '/clear', desc: 'Clear conversation' },
  { cmd: '/help', desc: 'Show available commands' },
]

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
:host { all: initial; }
*,*::before,*::after { box-sizing: border-box; }

/* FAB */
#fab {
  position: fixed; bottom: 24px; right: 24px; z-index: 2147483646;
  width: 56px; height: 56px; border-radius: 50%;
  background: #4f46e5; color: #fff; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 20px rgba(79,70,229,0.45);
  transition: transform 0.2s, box-shadow 0.2s, opacity 0.3s;
  font-family: system-ui, sans-serif;
}
#fab:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(79,70,229,0.55); }
#fab.hidden { opacity: 0; pointer-events: none; transform: scale(0.7); }
#fab svg { width: 26px; height: 26px; }
#fab .badge {
  position: absolute; top: 6px; right: 6px;
  width: 10px; height: 10px; border-radius: 50%;
  background: #22c55e; border: 2px solid #fff;
}

/* Panel */
#panel {
  position: fixed; bottom: 96px; right: 24px; z-index: 2147483647;
  width: 360px; height: 540px;
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06);
  display: flex; flex-direction: column; overflow: hidden;
  background: #fff;
  font-family: system-ui, -apple-system, sans-serif; font-size: 14px;
  transform: translateY(16px) scale(0.97); opacity: 0; pointer-events: none;
  transition: transform 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.22s ease;
}
#panel.open { transform: translateY(0) scale(1); opacity: 1; pointer-events: all; }

/* Header */
#header {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  padding: 13px 14px; display: flex; align-items: center; gap: 10px;
  color: #fff; flex-shrink: 0;
}
.avatar {
  width: 34px; height: 34px; border-radius: 50%;
  background: rgba(255,255,255,0.18);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.avatar svg { width: 19px; height: 19px; }
.hinfo { flex: 1; min-width: 0; }
.htitle { font-weight: 600; font-size: 13px; }
.hstatus { font-size: 11px; opacity: 0.8; display: flex; align-items: center; gap: 4px; margin-top: 1px; }
.hdot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; }
.hactions { display: flex; gap: 4px; }
.hbtn {
  background: rgba(255,255,255,0.15); border: none; color: #fff; cursor: pointer;
  border-radius: 6px; width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center; transition: background 0.15s;
}
.hbtn:hover { background: rgba(255,255,255,0.28); }
.hbtn svg { width: 14px; height: 14px; }

/* Toolbar */
#toolbar {
  padding: 5px 14px; background: #f8fafc; border-bottom: 1px solid #e8edf2;
  font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 6px; flex-shrink: 0;
}
#tcdot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; }

/* Messages */
#messages {
  flex: 1; overflow-y: auto; padding: 14px 13px;
  display: flex; flex-direction: column; gap: 11px;
  scrollbar-width: thin; scrollbar-color: #e2e8f0 transparent;
}

/* Welcome */
.welcome { text-align: center; padding: 28px 14px; color: #94a3b8; }
.welcome .wicon { font-size: 30px; margin-bottom: 8px; }
.welcome p { margin: 0; font-size: 13px; line-height: 1.5; }
.welcome strong { color: #64748b; }

/* Bubbles */
.bubble { max-width: 85%; line-height: 1.5; word-break: break-word; }
.bubble.user {
  align-self: flex-end; background: #4f46e5; color: #fff;
  padding: 8px 12px; border-radius: 15px 15px 4px 15px; white-space: pre-wrap; font-size: 13px;
}
.bubble.assistant {
  align-self: flex-start; background: #f1f5f9; color: #0f172a;
  padding: 9px 12px; border-radius: 15px 15px 15px 4px; font-size: 13px;
}
.bubble.error {
  align-self: flex-start; background: #fef2f2; color: #991b1b;
  padding: 8px 12px; border-radius: 10px; font-size: 13px;
}
.bubble.assistant p { margin: 0 0 5px; }
.bubble.assistant p:last-child { margin-bottom: 0; }
.bubble.assistant ul,.bubble.assistant ol { margin: 3px 0 5px; padding-left: 17px; }
.bubble.assistant code { background: rgba(99,102,241,.1); padding: 1px 4px; border-radius: 4px; font-size: 12px; font-family: ui-monospace,monospace; }
.bubble.assistant pre { background: #1e293b; color: #e2e8f0; padding: 9px; border-radius: 7px; overflow-x: auto; margin: 5px 0; }
.bubble.assistant pre code { background: none; padding: 0; color: inherit; font-size: 12px; }

/* Tool block */
.tool-block {
  align-self: flex-start; width: 100%;
  border: 1px solid #e2e8f0; border-radius: 9px; overflow: hidden;
  font-size: 12px; background: #fafafa;
}
.tool-header {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-family: ui-monospace,monospace;
}
.tool-name { font-weight: 600; color: #4f46e5; font-size: 12px; }
.ts.ok { color: #16a34a; } .ts.err { color: #dc2626; }
.tool-result { padding: 7px 10px; color: #334155; font-size: 12px; word-break: break-word; line-height: 1.45; }
.tool-result p { margin: 0 0 3px; } .tool-result p:last-child { margin-bottom: 0; }
.debug-only { display: none; }
.debug-on .debug-only {
  display: block; padding: 4px 10px; font-family: ui-monospace,monospace;
  font-size: 11px; color: #94a3b8; border-top: 1px dashed #e2e8f0;
  white-space: pre-wrap; word-break: break-all;
}

.notice { align-self: center; font-size: 11px; color: #94a3b8; text-align: center; }

/* Inline card (used by /model and /tools) */
.card {
  align-self: stretch; width: 100%;
  border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; background: #fff;
}
.card-title {
  padding: 8px 12px; font-size: 12px; font-weight: 600; color: #475569;
  background: #f8fafc; border-bottom: 1px solid #e2e8f0;
}
.card-row {
  padding: 8px 12px; font-size: 12px; color: #334155; border-bottom: 1px solid #f1f5f9;
}
.card-row:last-child { border-bottom: none; }
.card-row.pick { cursor: pointer; transition: background 0.1s; display: flex; align-items: center; gap: 8px; }
.card-row.pick:hover { background: #eef2ff; }
.card-row.current { background: #eef2ff; }
.card-row .rname { font-weight: 500; color: #0f172a; }
.card-row .rdesc { color: #64748b; margin-top: 2px; }
.card-row .rcheck { color: #4f46e5; font-weight: 700; margin-left: auto; }
.card-row .tmono { font-family: ui-monospace,monospace; font-weight: 600; color: #4f46e5; }

/* Spinner */
@keyframes spin { to { transform: rotate(360deg); } }
.spinner {
  display: inline-block; width: 11px; height: 11px;
  border: 2px solid #c7d2fe; border-top-color: #4f46e5;
  border-radius: 50%; animation: spin 0.6s linear infinite; flex-shrink: 0;
}

/* Composer */
#composer {
  border-top: 1px solid #e8edf2; background: #fff;
  padding: 9px 11px; display: flex; gap: 7px; align-items: flex-end; flex-shrink: 0;
}
#prompt {
  flex: 1; resize: none; border: 1px solid #e2e8f0; border-radius: 10px;
  padding: 7px 10px; font-family: inherit; font-size: 13px; line-height: 1.45;
  max-height: 96px; overflow-y: auto; outline: none;
  transition: border-color 0.15s; color: #0f172a; background: #f8fafc;
}
#prompt:focus { border-color: #6366f1; background: #fff; }
#prompt::placeholder { color: #94a3b8; }
#send {
  background: #4f46e5; color: #fff; border: none; border-radius: 10px;
  width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0; transition: background 0.15s;
}
#send:hover { background: #4338ca; } #send:disabled { background: #c7d2fe; cursor: default; }
#send svg { width: 15px; height: 15px; }

/* Footer bar (debug toggle) */
#footer {
  display: flex; align-items: center; justify-content: flex-end;
  padding: 3px 11px 6px; gap: 5px;
}
#footer label { font-size: 11px; color: #94a3b8; display: flex; align-items: center; gap: 4px; cursor: pointer; }

/* Command palette */
#cmd-palette {
  position: absolute; bottom: 110px; left: 11px; right: 11px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12); overflow: hidden;
  z-index: 10;
}
#cmd-palette.hidden { display: none; }
.cmd-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  cursor: pointer; transition: background 0.1s;
}
.cmd-item:hover, .cmd-item.active { background: #eef2ff; }
.cmd-kw { font-family: ui-monospace,monospace; font-weight: 600; color: #4f46e5; font-size: 12px; width: 80px; flex-shrink: 0; }
.cmd-desc { font-size: 12px; color: #64748b; }

/* ─── Config panel ─────────────────────────── */
#config {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 14px;
  background: #fff;
}
#config.hidden { display: none; }
.cfg-title { font-weight: 600; font-size: 14px; color: #0f172a; margin: 0; }
.cfg-subtitle { font-size: 12px; color: #64748b; margin: 0; }
.cfg-field { display: flex; flex-direction: column; gap: 5px; }
.cfg-label { font-size: 12px; font-weight: 500; color: #475569; }
.cfg-select, .cfg-input {
  padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px;
  font-size: 13px; font-family: inherit; color: #0f172a; background: #f8fafc; outline: none;
  transition: border-color 0.15s;
}
.cfg-select:focus, .cfg-input:focus { border-color: #6366f1; background: #fff; }
.cfg-key-row { display: flex; gap: 6px; align-items: center; }
.cfg-key-row .cfg-input { flex: 1; }
.cfg-key-row button {
  background: none; border: 1px solid #e2e8f0; border-radius: 8px;
  padding: 8px 10px; font-size: 11px; color: #64748b; cursor: pointer; white-space: nowrap;
}
.cfg-key-row button:hover { background: #f1f5f9; }
.cfg-docs { font-size: 11px; color: #6366f1; text-decoration: none; }
.cfg-docs:hover { text-decoration: underline; }
.cfg-save {
  background: #4f46e5; color: #fff; border: none; border-radius: 8px;
  padding: 9px 0; font-size: 13px; cursor: pointer; transition: background 0.15s; margin-top: 4px;
}
.cfg-save:hover { background: #4338ca; }
.cfg-saved { font-size: 12px; color: #16a34a; text-align: center; display: none; }

/* ─── Setup screen (first-run) ─────────────── */
#setup {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 20px 20px; gap: 14px; background: #fff;
}
#setup.hidden { display: none; }
.setup-icon { font-size: 36px; }
.setup-title { font-weight: 600; font-size: 15px; color: #0f172a; text-align: center; margin: 0; }
.setup-sub { font-size: 12px; color: #64748b; text-align: center; margin: 0; line-height: 1.5; }
.setup-btn {
  background: #4f46e5; color: #fff; border: none; border-radius: 9px;
  padding: 10px 24px; font-size: 13px; cursor: pointer; transition: background 0.15s;
}
.setup-btn:hover { background: #4338ca; }

/* Banner */
#banner { background: #fef2f2; color: #991b1b; padding: 7px 12px; font-size: 12px; border-bottom: 1px solid #fecaca; flex-shrink: 0; }
#banner[hidden] { display: none; }
#banner a { color: #7f1d1d; }
`

// ─── Icons ────────────────────────────────────────────────────────────────────

const IC_CHAT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`
const IC_CLOSE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`
const IC_SEND = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`
const IC_BOT = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.38-1 1.72V7h1a7 7 0 017 7H3a7 7 0 017-7h1V5.72A2 2 0 1112 2zM7.5 13a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm9 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM3 21v-1a5 5 0 015-5h8a5 5 0 015 5v1H3z"/></svg>`
const IC_MIN = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>`
const IC_COG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94a7 7 0 000-1.88l2.03-1.58a.49.49 0 00.12-.62l-1.92-3.32a.49.49 0 00-.6-.21l-2.39.96a7.02 7.02 0 00-1.63-.94l-.36-2.54A.48.48 0 0014 3h-3.84a.48.48 0 00-.48.41l-.36 2.54a7.02 7.02 0 00-1.63.94l-2.39-.96a.48.48 0 00-.6.21L2.78 9.46a.47.47 0 00.12.62l2.03 1.58a7.23 7.23 0 000 1.88l-2.03 1.58a.47.47 0 00-.12.62l1.92 3.32c.12.22.37.3.6.21l2.39-.96c.5.36 1.05.67 1.63.94l.36 2.54c.05.28.3.49.58.49H14c.28 0 .53-.21.57-.49l.36-2.54a7.02 7.02 0 001.63-.94l2.39.96c.22.09.48 0 .6-.21l1.92-3.32a.47.47 0 00-.12-.62l-2.21-1.58zM12 15.6a3.6 3.6 0 110-7.2 3.6 3.6 0 010 7.2z"/></svg>`

// ─── Shadow DOM ───────────────────────────────────────────────────────────────

const host = document.createElement('div')
host.id = 'webmcp-widget-host'
const shadow = host.attachShadow({ mode: 'closed' })

const styleEl = document.createElement('style')
styleEl.textContent = CSS
shadow.appendChild(styleEl)

const fab = document.createElement('button')
fab.id = 'fab'
fab.setAttribute('aria-label', 'Open AI assistant')
fab.innerHTML = `${IC_CHAT}<span class="badge"></span>`
fab.classList.add('hidden')
shadow.appendChild(fab)

const panel = document.createElement('div')
panel.id = 'panel'
panel.innerHTML = `
<div id="header">
  <div class="avatar">${IC_BOT}</div>
  <div class="hinfo">
    <div class="htitle">AI Assistant</div>
    <div class="hstatus"><span class="hdot" id="hdot"></span><span id="hstatus-text">Online</span></div>
  </div>
  <div class="hactions">
    <button class="hbtn" id="btn-config" title="Settings">${IC_COG}</button>
    <button class="hbtn" id="btn-min" title="Minimize">${IC_MIN}</button>
    <button class="hbtn" id="btn-close" title="Close">${IC_CLOSE}</button>
  </div>
</div>
<div id="banner" hidden></div>
<div id="toolbar"><span id="tcdot"></span><span id="tclabel">Checking for tools…</span></div>
<div id="setup" class="hidden">
  <div class="setup-icon">🔑</div>
  <p class="setup-title">Configure your AI provider</p>
  <p class="setup-sub">Choose a provider and enter your API key to get started. You can change this any time with <code>/config</code>.</p>
  <button class="setup-btn" id="setup-go">Open settings →</button>
</div>
<div id="messages">
  <div class="welcome">
    <div class="wicon">✨</div>
    <p>Hi! I'm your AI assistant.<br><strong>Ask me anything about this page.</strong><br><span style="font-size:11px;margin-top:4px;display:block">Type <code style="background:#e0e7ff;padding:1px 4px;border-radius:3px">/</code> for commands</span></p>
  </div>
</div>
<div id="config" class="hidden">
  <p class="cfg-title">Settings</p>
  <p class="cfg-subtitle">Configure provider, model and API key</p>
  <div class="cfg-field">
    <span class="cfg-label">Provider</span>
    <select class="cfg-select" id="cfg-provider"></select>
  </div>
  <div class="cfg-field">
    <span class="cfg-label">Model</span>
    <select class="cfg-select" id="cfg-model"></select>
  </div>
  <div class="cfg-field">
    <span class="cfg-label">API Key</span>
    <div class="cfg-key-row">
      <input type="password" class="cfg-input" id="cfg-key" autocomplete="off" placeholder="Paste your key…" />
      <button id="cfg-toggle-key" type="button">Show</button>
    </div>
    <a class="cfg-docs" id="cfg-docs" href="#" target="_blank">Get API key ↗</a>
  </div>
  <button class="cfg-save" id="cfg-save">Save</button>
  <div class="cfg-saved" id="cfg-saved">✓ Saved</div>
</div>
<div id="cmd-palette" class="hidden"></div>
<div id="composer">
  <textarea id="prompt" rows="1" placeholder="Type a message or /command…"></textarea>
  <button id="send">${IC_SEND}</button>
</div>
<div id="footer">
  <label><input type="checkbox" id="debug-toggle"> Debug</label>
</div>
`
shadow.appendChild(panel)
document.documentElement.appendChild(host)

// ─── Element refs ─────────────────────────────────────────────────────────────

const $ = (id: string) => panel.querySelector(`#${id}`) as HTMLElement
const messagesEl = $('messages') as HTMLDivElement
const configEl = $('config') as HTMLDivElement
const setupEl = $('setup') as HTMLDivElement
const promptEl = $('prompt') as HTMLTextAreaElement
const sendBtn = $('send') as HTMLButtonElement
const bannerEl = $('banner') as HTMLDivElement
const tclabel = $('tclabel') as HTMLSpanElement
const tcdot = $('tcdot') as HTMLSpanElement
const hstatusText = $('hstatus-text') as HTMLSpanElement
const hdot = $('hdot') as HTMLSpanElement
const debugToggle = $('debug-toggle') as HTMLInputElement
const cmdPalette = $('cmd-palette') as HTMLDivElement

// config refs
const cfgProvider = $('cfg-provider') as HTMLSelectElement
const cfgModel = $('cfg-model') as HTMLSelectElement
const cfgKey = $('cfg-key') as HTMLInputElement
const cfgDocs = $('cfg-docs') as HTMLAnchorElement
const cfgToggleKey = $('cfg-toggle-key') as HTMLButtonElement
const cfgSave = $('cfg-save') as HTMLButtonElement
const cfgSaved = $('cfg-saved') as HTMLDivElement

// ─── State ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are an assistant operating on the current web page through the tools it exposes. ' +
  'Use the tools to look up real data instead of guessing names or ids. ' +
  'Some actions require the user to confirm inside the page; if a tool reports the user did not approve, stop and say so. ' +
  'Answer in the language of the user prompt.'

let messages: Message[] = []
let busy = false
let panelOpen = false
let debugMode = false
let showingConfig = false

// ─── FAB / Panel toggle ───────────────────────────────────────────────────────

async function openPanel() {
  panelOpen = true
  panel.classList.add('open')
  fab.innerHTML = IC_CLOSE
  fab.setAttribute('aria-label', 'Close AI assistant')

  // Check if we need to show setup screen
  const settings = await loadSettings()
  if (!settings.apiKey) {
    showSetup()
  } else {
    hideSetup()
    setTimeout(() => promptEl.focus(), 250)
  }
}

function closePanel() {
  panelOpen = false
  panel.classList.remove('open')
  fab.innerHTML = `${IC_CHAT}<span class="badge"></span>`
  fab.setAttribute('aria-label', 'Open AI assistant')
  hideCmdPalette()
}

fab.addEventListener('click', () => { if (panelOpen) closePanel(); else void openPanel() })
;($('btn-close') as HTMLButtonElement).addEventListener('click', closePanel)
;($('btn-min') as HTMLButtonElement).addEventListener('click', closePanel)
;($('btn-config') as HTMLButtonElement).addEventListener('click', () => {
  if (showingConfig) hideConfig(); else void showConfig()
})
;($('setup-go') as HTMLButtonElement).addEventListener('click', () => void showConfig())

// ─── Tools detection ──────────────────────────────────────────────────────────

function onToolsChanged(tools: ToolDescriptor[]) {
  if (tools.length > 0) {
    fab.classList.remove('hidden')
    tcdot.style.background = '#4ade80'
    tclabel.textContent = `${tools.length} tool${tools.length === 1 ? '' : 's'} available`
    hstatusText.textContent = 'Online'
    hdot.style.background = '#4ade80'
  } else {
    fab.classList.add('hidden')
    tcdot.style.background = '#94a3b8'
    tclabel.textContent = 'No tools on this page'
    hstatusText.textContent = 'No tools'
    hdot.style.background = '#94a3b8'
  }
}

// ─── Setup screen ─────────────────────────────────────────────────────────────

function showSetup() {
  setupEl.classList.remove('hidden')
  messagesEl.style.display = 'none'
  configEl.classList.add('hidden')
  showingConfig = false
}

function hideSetup() {
  setupEl.classList.add('hidden')
  messagesEl.style.display = ''
}

// ─── Config panel ─────────────────────────────────────────────────────────────

function populateCfgProviders(selectedId: string) {
  cfgProvider.innerHTML = ''
  for (const p of PROVIDERS) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = p.name
    opt.selected = p.id === selectedId
    cfgProvider.appendChild(opt)
  }
}

function populateCfgModels(providerId: string, selectedModel: string) {
  const provider = getProvider(providerId)
  if (!provider) return
  cfgModel.innerHTML = ''
  for (const m of provider.models) {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = m.name
    opt.selected = m.id === selectedModel
    cfgModel.appendChild(opt)
  }
  cfgDocs.href = provider.keyDocs
  cfgKey.placeholder = provider.keyPlaceholder
}

cfgProvider.addEventListener('change', () => {
  populateCfgModels(cfgProvider.value, cfgModel.value)
})

cfgToggleKey.addEventListener('click', () => {
  const shown = cfgKey.type === 'text'
  cfgKey.type = shown ? 'password' : 'text'
  cfgToggleKey.textContent = shown ? 'Show' : 'Hide'
})

cfgSave.addEventListener('click', async () => {
  await saveSettings({
    providerId: cfgProvider.value,
    model: cfgModel.value,
    apiKey: cfgKey.value.trim(),
  })
  cfgSaved.style.display = 'block'
  setTimeout(() => { cfgSaved.style.display = '' }, 1800)
  // If we were in setup, transition to chat
  if (!setupEl.classList.contains('hidden')) {
    hideSetup()
    hideConfig()
    setTimeout(() => promptEl.focus(), 100)
  }
})

async function showConfig() {
  const settings = await loadSettings()
  populateCfgProviders(settings.providerId)
  populateCfgModels(settings.providerId, settings.model)
  cfgKey.value = settings.apiKey

  configEl.classList.remove('hidden')
  messagesEl.style.display = 'none'
  setupEl.classList.add('hidden')
  showingConfig = true
}

function hideConfig() {
  configEl.classList.add('hidden')
  messagesEl.style.display = ''
  showingConfig = false
}

// ─── Slash command palette ────────────────────────────────────────────────────

let activeCmdIdx = -1

function buildCmdPalette(matches: Command[]) {
  cmdPalette.innerHTML = ''
  activeCmdIdx = -1
  matches.forEach((c, i) => {
    const div = document.createElement('div')
    div.className = 'cmd-item'
    div.innerHTML = `<span class="cmd-kw">${escHtml(c.cmd)}</span><span class="cmd-desc">${escHtml(c.desc)}</span>`
    div.addEventListener('mousedown', (e) => {
      e.preventDefault()
      promptEl.value = c.cmd + ' '
      hideCmdPalette()
      promptEl.focus()
      executeOrFocusCmd(c.cmd)
    })
    cmdPalette.appendChild(div)
  })
}

function setActiveCmd(idx: number) {
  const items = cmdPalette.querySelectorAll('.cmd-item')
  items.forEach((el, i) => el.classList.toggle('active', i === idx))
  activeCmdIdx = idx
}

function hideCmdPalette() {
  cmdPalette.classList.add('hidden')
  activeCmdIdx = -1
}

function updateCmdPalette() {
  const val = promptEl.value
  if (!val.startsWith('/')) { hideCmdPalette(); return }
  const partial = val.toLowerCase().trim()
  const matches = COMMANDS.filter((c) => c.cmd.startsWith(partial))
  if (matches.length === 0 || partial === matches[0].cmd) { hideCmdPalette(); return }
  buildCmdPalette(matches)
  cmdPalette.classList.remove('hidden')
}

// ─── Command execution ────────────────────────────────────────────────────────

function executeOrFocusCmd(cmd: string) {
  const base = cmd.trim().split(' ')[0]
  if (base === '/clear') { handleClear(); return }
  if (base === '/config') { void showConfig(); return }
  if (base === '/help') { handleHelp(); return }
  if (base === '/model') { void handleModel(); return }
  if (base === '/tools') { handleTools(); return }
}

function handleHelp() {
  removeWelcome()
  const card = document.createElement('div')
  card.className = 'card'
  const rows = COMMANDS.map(
    (c) => `<div class="card-row"><span class="tmono">${escHtml(c.cmd)}</span> — ${escHtml(c.desc)}</div>`,
  ).join('')
  card.innerHTML = `<div class="card-title">Available commands</div>${rows}`
  messagesEl.appendChild(card)
  scrollBottom()
}

function handleTools() {
  removeWelcome()
  const card = document.createElement('div')
  card.className = 'card'
  if (_currentTools.length === 0) {
    card.innerHTML = `<div class="card-title">Page tools</div><div class="card-row">No WebMCP tools exposed on this page.</div>`
  } else {
    const rows = _currentTools
      .map(
        (t) =>
          `<div class="card-row"><div class="rname tmono">${escHtml(t.name)}</div>${
            t.description ? `<div class="rdesc">${escHtml(t.description)}</div>` : ''
          }</div>`,
      )
      .join('')
    card.innerHTML = `<div class="card-title">${_currentTools.length} tool${_currentTools.length === 1 ? '' : 's'} on this page</div>${rows}`
  }
  messagesEl.appendChild(card)
  scrollBottom()
}

async function handleModel() {
  const settings = await loadSettings()
  const provider = getProvider(settings.providerId)
  if (!provider) { void showConfig(); return }

  removeWelcome()
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `<div class="card-title">${escHtml(provider.name)} — pick a model</div>`
  for (const m of provider.models) {
    const row = document.createElement('div')
    row.className = `card-row pick${m.id === settings.model ? ' current' : ''}`
    row.innerHTML = `<span class="rname">${escHtml(m.name)}</span>${m.id === settings.model ? '<span class="rcheck">✓</span>' : ''}`
    row.addEventListener('click', async () => {
      await saveSettings({ model: m.id })
      appendNotice(`Model set to ${m.name}`)
      card.remove()
    })
    card.appendChild(row)
  }
  messagesEl.appendChild(card)
  scrollBottom()
}

function handleClear() {
  messages = []
  messagesEl.innerHTML = `<div class="welcome"><div class="wicon">✨</div><p>Conversation cleared.<br><strong>Ask me something!</strong></p></div>`
  promptEl.value = ''
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  const result = marked.parse(text)
  return typeof result === 'string' ? result : text
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function scrollBottom() { messagesEl.scrollTop = messagesEl.scrollHeight }

function removeWelcome() { messagesEl.querySelector('.welcome')?.remove() }

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
  if (debugMode) wrap.classList.add('debug-on')
  wrap.innerHTML = `
    <div class="tool-header">
      <span class="tool-name">${escHtml(name)}</span>
      <span class="spinner"></span>
    </div>
    <pre class="debug-only">${escHtml(JSON.stringify(input, null, 2))}</pre>
  `
  messagesEl.appendChild(wrap)
  scrollBottom()

  return (ok, result) => {
    wrap.querySelector('.spinner')?.remove()
    const hdr = wrap.querySelector('.tool-header')!
    const st = document.createElement('span')
    st.className = `ts ${ok ? 'ok' : 'err'}`
    st.textContent = ok ? '✓' : '✗'
    hdr.appendChild(st)

    const body = document.createElement('div')
    body.className = 'tool-result'
    body.innerHTML = renderMarkdown(result)
    wrap.appendChild(body)

    const dbgOut = document.createElement('pre')
    dbgOut.className = 'debug-only'
    dbgOut.textContent = result
    wrap.appendChild(dbgOut)
    scrollBottom()
  }
}

// ─── Debug toggle ─────────────────────────────────────────────────────────────

debugToggle.addEventListener('change', () => {
  debugMode = debugToggle.checked
  messagesEl.classList.toggle('debug-on', debugMode)
})

// ─── Auto-resize textarea ─────────────────────────────────────────────────────

promptEl.addEventListener('input', () => {
  promptEl.style.height = 'auto'
  promptEl.style.height = Math.min(promptEl.scrollHeight, 96) + 'px'
  updateCmdPalette()
})

promptEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
    if (cmdPalette.classList.contains('hidden')) return
    const items = cmdPalette.querySelectorAll('.cmd-item')
    if (!items.length) return
    ev.preventDefault()
    const next = ev.key === 'ArrowDown'
      ? Math.min(activeCmdIdx + 1, items.length - 1)
      : Math.max(activeCmdIdx - 1, 0)
    setActiveCmd(next)
    return
  }
  if (ev.key === 'Tab' && !cmdPalette.classList.contains('hidden')) {
    ev.preventDefault()
    const items = cmdPalette.querySelectorAll('.cmd-item')
    const idx = activeCmdIdx >= 0 ? activeCmdIdx : 0
    const kw = (items[idx]?.querySelector('.cmd-kw') as HTMLElement)?.textContent ?? ''
    if (kw) { promptEl.value = kw + ' '; hideCmdPalette(); }
    return
  }
  if (ev.key === 'Escape') {
    if (!cmdPalette.classList.contains('hidden')) { hideCmdPalette(); return }
  }
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    // If palette open and item selected, complete the command
    if (!cmdPalette.classList.contains('hidden') && activeCmdIdx >= 0) {
      const items = cmdPalette.querySelectorAll('.cmd-item')
      const kw = (items[activeCmdIdx]?.querySelector('.cmd-kw') as HTMLElement)?.textContent ?? ''
      if (kw) { promptEl.value = kw; hideCmdPalette(); executeOrFocusCmd(kw); promptEl.value = ''; return }
    }
    sendBtn.click()
  }
})

// ─── Send ─────────────────────────────────────────────────────────────────────

sendBtn.addEventListener('click', async () => {
  if (busy) return
  const raw = promptEl.value.trim()
  if (!raw) return
  hideCmdPalette()

  // Slash command?
  if (raw.startsWith('/')) {
    const cmd = raw.split(' ')[0]
    const known = COMMANDS.some((c) => c.cmd === cmd)
    if (known) {
      promptEl.value = ''
      promptEl.style.height = 'auto'
      executeOrFocusCmd(cmd)
      return
    }
  }

  // Normal message
  const settings = await loadSettings()
  if (!settings.apiKey) {
    showSetup()
    return
  }

  if (!_channelId) {
    appendNotice('No WebMCP channel found on this page.')
    return
  }

  busy = true
  sendBtn.disabled = true
  promptEl.value = ''
  promptEl.style.height = 'auto'
  bannerEl.hidden = true

  appendBubble('user', escHtml(raw))
  messages.push({ role: 'user', content: raw })

  const settleMap = new Map<string, (ok: boolean, result: string) => void>()
  const onEvent = (e: AgentEvent) => {
    if (e.type === 'tool-call') {
      settleMap.set(e.name, toolCallBlock(e.name, e.input))
    } else {
      settleMap.get(e.name)?.(e.ok, e.result)
      settleMap.delete(e.name)
    }
  }

  try {
    const text = await runAgentTurn({
      client: makeProviderClient(settings.providerId, settings.apiKey),
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
      bannerEl.textContent = 'Invalid API key — use /config to update it.'
    }
    appendBubble('error', escHtml(err instanceof Error ? err.message : String(err)))
  } finally {
    busy = false
    sendBtn.disabled = false
    promptEl.focus()
  }
})

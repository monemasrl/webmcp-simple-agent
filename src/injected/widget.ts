import { marked } from 'marked'
import { runAgentTurn, type AgentEvent } from '../panel/agent'
import { ClaudeApiError, makeProviderClient, type Message } from '../panel/claude'
import { loadSettings, saveSettings } from '../shared/settings'
import { PROVIDERS, getProvider, DEFAULT_PROVIDER_ID } from '../shared/providers'
import { LOCALES, t as translate, detectLocale, localeName, speechLang, type Locale } from '../shared/i18n'
import { WM_NS, type ToolDescriptor } from '../shared/protocol'
import { scanDeclarativeTools, type DeclarativeTool } from './declarative'
import type { ToolDef } from '../panel/claude'

marked.setOptions({ async: false })

// ─── Tool sources ─────────────────────────────────────────────────────────────
//
// Two independent sources are merged:
//  1. Imperative — document.modelContext.registerTool() via the MAIN-world bridge
//  2. Declarative — <form toolname="…"> parsed from the DOM by this content script

let _channelId: string | null = null
let _bridgeTools: ToolDescriptor[] = []
let _declTools: DeclarativeTool[] = []
const _declExec = new Map<string, (input: Record<string, unknown>) => string>()
const _toolResultListeners = new Map<string, (ok: boolean, result: string) => void>()

function mergedTools(): ToolDescriptor[] {
  return [..._bridgeTools, ..._declTools.map((d) => d.descriptor)]
}

function recomputeTools() {
  onToolsChanged(mergedTools())
}

window.addEventListener('message', (ev) => {
  const msg = ev.data
  if (!msg || msg.ns !== WM_NS) return
  if (msg.kind === 'tools-changed') {
    _channelId = msg.channelId
    _bridgeTools = msg.tools ?? []
    recomputeTools()
  } else if (msg.kind === 'tool-result') {
    const settle = _toolResultListeners.get(msg.callId)
    if (settle) {
      _toolResultListeners.delete(msg.callId)
      settle(msg.ok, msg.result)
    }
  }
})

/** Ask the MAIN-world bridge to (re-)announce its current tools. */
function sayHello() {
  window.postMessage({ ns: WM_NS, kind: 'hello' }, '*')
}

/**
 * The bridge announces tools once at document_start; this widget is injected
 * at document_idle and may have missed it, especially on SPAs that register
 * tools during bootstrap. Ping a few times to catch late/early registration.
 */
function discoverBridge() {
  sayHello()
  for (const delay of [200, 600, 1500, 3000]) setTimeout(sayHello, delay)
}

/** Rescan the DOM for declarative <form toolname="…"> tools. */
function refreshDeclarativeTools() {
  _declTools = scanDeclarativeTools(document)
  _declExec.clear()
  for (const d of _declTools) _declExec.set(d.descriptor.name, d.execute)
  recomputeTools()
}

function toToolDefs(tools: ToolDescriptor[]): ToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema:
      t.inputSchema && Object.keys(t.inputSchema).length > 0
        ? (t.inputSchema as ToolDef['input_schema'])
        : { type: 'object' },
  }))
}

function callTool(name: string, input: unknown): Promise<{ ok: boolean; result: string }> {
  // Declarative tools run locally (fill + submit the form); no bridge round-trip.
  const declExec = _declExec.get(name)
  if (declExec) {
    return new Promise((resolve) => {
      try {
        resolve({ ok: true, result: declExec((input as Record<string, unknown>) ?? {}) })
      } catch (err) {
        resolve({ ok: false, result: err instanceof Error ? err.message : String(err) })
      }
    })
  }
  return new Promise((resolve) => {
    if (!_channelId) return resolve({ ok: false, result: 'Bridge not connected' })
    const callId = crypto.randomUUID()
    _toolResultListeners.set(callId, (ok, result) => resolve({ ok, result }))
    window.postMessage({ ns: WM_NS, channelId: _channelId, kind: 'call-tool', callId, name, input }, '*')
  })
}

// ─── Slash commands ───────────────────────────────────────────────────────────

type Command = { cmd: string; descKey: string }
const COMMANDS: Command[] = [
  { cmd: '/config', descKey: 'cmd.config' },
  { cmd: '/model', descKey: 'cmd.model' },
  { cmd: '/tools', descKey: 'cmd.tools' },
  { cmd: '/debug', descKey: 'cmd.debug' },
  { cmd: '/language', descKey: 'cmd.language' },
  { cmd: '/clear', descKey: 'cmd.clear' },
  { cmd: '/help', descKey: 'cmd.help' },
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
  /* Never exceed the viewport: on short windows the top would be clipped and
     the message list would be unreachable. */
  max-height: calc(100vh - 120px);
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
.hbtn.active { background: #fbbf24; color: #78350f; }
.hbtn.active:hover { background: #f59e0b; }

/* Toolbar */
#toolbar {
  padding: 5px 14px; background: #f8fafc; border-bottom: 1px solid #e8edf2;
  font-size: 11px; color: #64748b; display: flex; align-items: center; gap: 6px; flex-shrink: 0;
}
#tcdot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; }

/* Messages */
#messages {
  flex: 1; min-height: 0; overflow-y: auto; padding: 14px 13px;
  display: flex; flex-direction: column; gap: 11px;
  scrollbar-width: thin; scrollbar-color: #e2e8f0 transparent;
}
/* Keep entries at natural height so the container scrolls instead of
   squishing them (flex children default to flex-shrink:1). */
#messages > * { flex-shrink: 0; }

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

/* Status bubble (typing / progress indicator) */
.status-bubble {
  align-self: flex-start;
  display: flex; align-items: center; gap: 8px;
  background: #f1f5f9; color: #475569;
  padding: 9px 13px; border-radius: 15px 15px 15px 4px; font-size: 13px;
  max-width: 85%;
}
.status-bubble .stext { transition: opacity 0.15s; }
.status-dots { display: inline-flex; gap: 3px; flex-shrink: 0; }
.status-dots span {
  width: 5px; height: 5px; border-radius: 50%; background: #94a3b8;
  animation: sdot 1.2s infinite ease-in-out both;
}
.status-dots span:nth-child(1) { animation-delay: -0.32s; }
.status-dots span:nth-child(2) { animation-delay: -0.16s; }
@keyframes sdot {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
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

#mic {
  background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; border-radius: 10px;
  width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0; transition: background 0.15s, color 0.15s;
}
#mic:hover { background: #e2e8f0; }
#mic svg { width: 16px; height: 16px; }
#mic.listening {
  background: #ef4444; color: #fff; border-color: #ef4444;
  animation: micpulse 1.4s infinite;
}
@keyframes micpulse {
  0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
  70% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
  100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
}

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
  flex: 1; min-height: 0; overflow-y: auto; padding: 16px;
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
const IC_BUG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 8h-2.81a5.98 5.98 0 00-1.82-1.96l1.63-1.63-1.41-1.41-2.17 2.17a6.02 6.02 0 00-2.44 0L8.83 3 7.42 4.41l1.62 1.63A5.98 5.98 0 007.22 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81a6 6 0 0010.38 0H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/></svg>`
const IC_MIC = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 003-3V5a3 3 0 00-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z"/></svg>`

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
    <div class="htitle" data-i18n="header.title">AI Assistant</div>
    <div class="hstatus"><span class="hdot" id="hdot"></span><span id="hstatus-text">Online</span></div>
  </div>
  <div class="hactions">
    <button class="hbtn" id="btn-debug" title="Debug" hidden>${IC_BUG}</button>
    <button class="hbtn" id="btn-config" title="Settings">${IC_COG}</button>
    <button class="hbtn" id="btn-min" title="Minimize">${IC_MIN}</button>
    <button class="hbtn" id="btn-close" title="Close">${IC_CLOSE}</button>
  </div>
</div>
<div id="banner" hidden></div>
<div id="toolbar"><span id="tcdot"></span><span id="tclabel" data-i18n="toolbar.checking">Checking for tools…</span></div>
<div id="setup" class="hidden">
  <div class="setup-icon">🔑</div>
  <p class="setup-title" data-i18n="setup.title">Configure your AI provider</p>
  <p class="setup-sub" data-i18n="setup.sub">Choose a provider and enter your API key to get started.</p>
  <button class="setup-btn" id="setup-go" data-i18n="setup.go">Open settings →</button>
</div>
<div id="messages">
  <div class="welcome">
    <div class="wicon">✨</div>
    <p><span data-i18n="welcome.hi">Hi! I'm your AI assistant.</span><br><strong data-i18n="welcome.ask">Ask me anything about this page.</strong><br><span style="font-size:11px;margin-top:4px;display:block"><span data-i18n="welcome.hint">Type / for commands</span></span></p>
  </div>
</div>
<div id="config" class="hidden">
  <p class="cfg-title" data-i18n="config.title">Settings</p>
  <p class="cfg-subtitle" data-i18n="config.sub">Configure provider, model and API key</p>
  <div class="cfg-field">
    <span class="cfg-label" data-i18n="config.provider">Provider</span>
    <select class="cfg-select" id="cfg-provider"></select>
  </div>
  <div class="cfg-field">
    <span class="cfg-label" data-i18n="config.model">Model</span>
    <select class="cfg-select" id="cfg-model"></select>
  </div>
  <div class="cfg-field">
    <span class="cfg-label" data-i18n="config.language">Language</span>
    <select class="cfg-select" id="cfg-locale"></select>
  </div>
  <div class="cfg-field">
    <span class="cfg-label" data-i18n="config.apiKey">API Key</span>
    <div class="cfg-key-row">
      <input type="password" class="cfg-input" id="cfg-key" autocomplete="off" placeholder="sk-…" />
      <button id="cfg-toggle-key" type="button" data-i18n="config.show">Show</button>
    </div>
    <a class="cfg-docs" id="cfg-docs" href="#" target="_blank" data-i18n="config.getKey">Get API key ↗</a>
  </div>
  <button class="cfg-save" id="cfg-save" data-i18n="config.save">Save</button>
  <div class="cfg-saved" id="cfg-saved" data-i18n="config.saved">✓ Saved</div>
</div>
<div id="cmd-palette" class="hidden"></div>
<div id="composer">
  <button id="mic" hidden>${IC_MIC}</button>
  <textarea id="prompt" rows="1" data-i18n-ph="composer.placeholder" placeholder="Type a message or /command…"></textarea>
  <button id="send">${IC_SEND}</button>
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
const micBtn = $('mic') as HTMLButtonElement
const bannerEl = $('banner') as HTMLDivElement
const tclabel = $('tclabel') as HTMLSpanElement
const tcdot = $('tcdot') as HTMLSpanElement
const hstatusText = $('hstatus-text') as HTMLSpanElement
const hdot = $('hdot') as HTMLSpanElement
const btnDebug = $('btn-debug') as HTMLButtonElement
const cmdPalette = $('cmd-palette') as HTMLDivElement

// config refs
const cfgProvider = $('cfg-provider') as HTMLSelectElement
const cfgModel = $('cfg-model') as HTMLSelectElement
const cfgLocale = $('cfg-locale') as HTMLSelectElement
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
let currentLocale: Locale = detectLocale()

// ─── i18n ─────────────────────────────────────────────────────────────────────

function t(key: string, params?: Record<string, string | number>): string {
  return translate(currentLocale, key, params)
}

/** Applies data-i18n / data-i18n-ph attributes across the panel. */
function applyTranslations() {
  panel.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')
    if (key) el.textContent = t(key)
  })
  panel.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    const key = el.getAttribute('data-i18n-ph')
    if (key) (el as HTMLInputElement | HTMLTextAreaElement).placeholder = t(key)
  })
  // Dynamic bits not covered by data attributes
  refreshToolbarLabel()
  cfgToggleKey.textContent = cfgKey.type === 'text' ? t('config.hide') : t('config.show')
  if (!micBtn.hidden) micBtn.title = listening ? t('mic.listening') : t('mic.start')
}

function setLocale(loc: Locale) {
  currentLocale = loc
  applyTranslations()
}

let _lastToolCount = -1
function refreshToolbarLabel() {
  const n = _lastToolCount
  if (n < 0) { tclabel.textContent = t('toolbar.checking'); return }
  if (n === 0) { tclabel.textContent = t('toolbar.none'); hstatusText.textContent = t('status.noTools'); return }
  tclabel.textContent = n === 1 ? t('toolbar.available.one') : t('toolbar.available', { n })
  hstatusText.textContent = t('status.online')
}

// ─── FAB / Panel toggle ───────────────────────────────────────────────────────

async function openPanel() {
  panelOpen = true
  panel.classList.add('open')
  fab.innerHTML = IC_CLOSE
  fab.setAttribute('aria-label', 'Close AI assistant')
  // Re-sync tools in case the page changed them while the panel was closed.
  sayHello()

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
  _lastToolCount = tools.length
  if (tools.length > 0) {
    fab.classList.remove('hidden')
    tcdot.style.background = '#4ade80'
    hdot.style.background = '#4ade80'
  } else {
    fab.classList.add('hidden')
    tcdot.style.background = '#94a3b8'
    hdot.style.background = '#94a3b8'
  }
  refreshToolbarLabel()
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

function populateCfgLocales(selected: Locale) {
  cfgLocale.innerHTML = ''
  for (const l of LOCALES) {
    const opt = document.createElement('option')
    opt.value = l.id
    opt.textContent = l.name
    opt.selected = l.id === selected
    cfgLocale.appendChild(opt)
  }
}

cfgProvider.addEventListener('change', () => {
  populateCfgModels(cfgProvider.value, cfgModel.value)
})

// Live-preview the language as soon as it's picked
cfgLocale.addEventListener('change', () => {
  setLocale(cfgLocale.value as Locale)
})

cfgToggleKey.addEventListener('click', () => {
  const shown = cfgKey.type === 'text'
  cfgKey.type = shown ? 'password' : 'text'
  cfgToggleKey.textContent = shown ? t('config.show') : t('config.hide')
})

cfgSave.addEventListener('click', async () => {
  await saveSettings({
    providerId: cfgProvider.value,
    model: cfgModel.value,
    locale: cfgLocale.value as Locale,
    apiKey: cfgKey.value.trim(),
  })
  setLocale(cfgLocale.value as Locale)
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
  populateCfgLocales(settings.locale)
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
    div.innerHTML = `<span class="cmd-kw">${escHtml(c.cmd)}</span><span class="cmd-desc">${escHtml(t(c.descKey))}</span>`
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
  if (base === '/debug') { handleDebug(); return }
  if (base === '/language') { handleLanguage(); return }
}

function handleHelp() {
  removeWelcome()
  const card = document.createElement('div')
  card.className = 'card'
  const rows = COMMANDS.map(
    (c) => `<div class="card-row"><span class="tmono">${escHtml(c.cmd)}</span> — ${escHtml(t(c.descKey))}</div>`,
  ).join('')
  card.innerHTML = `<div class="card-title">${escHtml(t('card.commands'))}</div>${rows}`
  messagesEl.appendChild(card)
  scrollBottom()
}

function handleTools() {
  removeWelcome()
  const tools = mergedTools()
  const card = document.createElement('div')
  card.className = 'card'
  if (tools.length === 0) {
    card.innerHTML = `<div class="card-title">${escHtml(t('card.pageTools'))}</div><div class="card-row">${escHtml(t('card.noPageTools'))}</div>`
  } else {
    const rows = tools
      .map(
        (tool) =>
          `<div class="card-row"><div class="rname tmono">${escHtml(tool.name)}</div>${
            tool.description ? `<div class="rdesc">${escHtml(tool.description)}</div>` : ''
          }</div>`,
      )
      .join('')
    const title = tools.length === 1
      ? t('card.toolsCount.one')
      : t('card.toolsCount', { n: tools.length })
    card.innerHTML = `<div class="card-title">${escHtml(title)}</div>${rows}`
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
  card.innerHTML = `<div class="card-title">${escHtml(t('card.pickModel', { provider: provider.name }))}</div>`
  for (const m of provider.models) {
    const row = document.createElement('div')
    row.className = `card-row pick${m.id === settings.model ? ' current' : ''}`
    row.innerHTML = `<span class="rname">${escHtml(m.name)}</span>${m.id === settings.model ? '<span class="rcheck">✓</span>' : ''}`
    row.addEventListener('click', async () => {
      await saveSettings({ model: m.id })
      appendNotice(t('notice.modelSet', { name: m.name }))
      card.remove()
    })
    card.appendChild(row)
  }
  messagesEl.appendChild(card)
  scrollBottom()
}

function handleLanguage() {
  removeWelcome()
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `<div class="card-title">${escHtml(t('card.pickLanguage'))}</div>`
  for (const l of LOCALES) {
    const row = document.createElement('div')
    row.className = `card-row pick${l.id === currentLocale ? ' current' : ''}`
    row.innerHTML = `<span class="rname">${escHtml(l.name)}</span>${l.id === currentLocale ? '<span class="rcheck">✓</span>' : ''}`
    row.addEventListener('click', async () => {
      await saveSettings({ locale: l.id })
      setLocale(l.id)
      appendNotice(t('notice.languageSet', { name: localeName(l.id) }))
      card.remove()
    })
    card.appendChild(row)
  }
  messagesEl.appendChild(card)
  scrollBottom()
}

function handleClear() {
  messages = []
  messagesEl.innerHTML = `<div class="welcome"><div class="wicon">✨</div><p><span>${escHtml(t('welcome.cleared'))}</span><br><strong>${escHtml(t('welcome.clearedAsk'))}</strong></p></div>`
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

// ─── Status bubble (progress feedback) ────────────────────────────────────────

let statusEl: HTMLDivElement | null = null
let statusWaitTimer: ReturnType<typeof setTimeout> | undefined

function showStatus(text: string) {
  removeWelcome()
  if (!statusEl) {
    statusEl = document.createElement('div')
    statusEl.className = 'status-bubble'
    statusEl.innerHTML = `<span class="stext"></span><span class="status-dots"><span></span><span></span><span></span></span>`
    messagesEl.appendChild(statusEl)
  }
  const stext = statusEl.querySelector('.stext') as HTMLSpanElement
  stext.textContent = text
  scrollBottom()
}

function clearStatusTimer() {
  if (statusWaitTimer) { clearTimeout(statusWaitTimer); statusWaitTimer = undefined }
}

function hideStatus() {
  clearStatusTimer()
  statusEl?.remove()
  statusEl = null
}

/**
 * Drives the single status bubble through a turn. Both the model call and the
 * reprocessing step are one await, so after a short delay we advance the text to
 * "receiving response" to convey progress.
 */
function onPhase(phase: 'sending' | 'tools' | 'reprocessing') {
  clearStatusTimer()
  if (phase === 'sending') {
    showStatus(t('phase.sending'))
    statusWaitTimer = setTimeout(() => showStatus(t('phase.waiting')), 700)
  } else if (phase === 'tools') {
    // The concrete tool name arrives with the tool-call event; leave the
    // current text until then.
  } else if (phase === 'reprocessing') {
    showStatus(t('phase.reprocessing'))
    statusWaitTimer = setTimeout(() => showStatus(t('phase.waiting')), 700)
  }
}

/** The single status bubble reflects the tool being called (no separate block). */
function onToolCallStatus(name: string) {
  clearStatusTimer()
  showStatus(t('phase.tools', { name }))
}

// ─── Debug console (separate window) ──────────────────────────────────────────

type DebugEntry = { kind: string; title: string; text: string }
const debugBuffer: DebugEntry[] = []
const DEBUG_BUFFER_MAX = 300
let debugWin: Window | null = null

const DEBUG_DOC_STYLE = `
  body { margin: 0; background: #0f172a; color: #e2e8f0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  header { position: sticky; top: 0; background: #1e293b; padding: 10px 14px; border-bottom: 1px solid #334155; display: flex; align-items: center; justify-content: space-between; }
  header h1 { font-size: 13px; margin: 0; font-family: system-ui, sans-serif; }
  header button { background: #334155; color: #e2e8f0; border: none; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 11px; }
  header button:hover { background: #475569; }
  #log { padding: 12px 14px; }
  .entry { margin-bottom: 12px; border: 1px solid #1e293b; border-radius: 8px; overflow: hidden; }
  .etitle { padding: 6px 10px; font-weight: 600; background: #1e293b; font-family: system-ui, sans-serif; display: flex; gap: 8px; }
  .etitle .ts { color: #64748b; font-weight: 400; margin-left: auto; }
  .entry pre { margin: 0; padding: 10px; white-space: pre-wrap; word-break: break-word; overflow-x: auto; }
  .entry.request .etitle { color: #93c5fd; }
  .entry.response .etitle { color: #86efac; }
  .entry.tool-call .etitle { color: #fcd34d; }
  .entry.tool-result .etitle { color: #fdba74; }
  .empty { color: #64748b; padding: 20px; text-align: center; }
`

function safeStringify(payload: unknown): string {
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

function renderDebugEntry(w: Window, e: DebugEntry) {
  const log = w.document.getElementById('log')
  if (!log) return
  log.querySelector('.empty')?.remove()
  const entry = w.document.createElement('div')
  entry.className = `entry ${e.kind}`
  const title = w.document.createElement('div')
  title.className = 'etitle'
  title.innerHTML = `<span>${escHtml(e.title)}</span>`
  const pre = w.document.createElement('pre')
  pre.textContent = e.text
  entry.appendChild(title)
  entry.appendChild(pre)
  log.appendChild(entry)
  log.scrollTop = log.scrollHeight
}

function openDebugWindow(): Window | null {
  if (debugWin && !debugWin.closed) {
    debugWin.focus()
    return debugWin
  }
  const w = window.open('', 'webmcp-agent-debug', 'width=680,height=860,scrollbars=yes')
  if (!w) return null
  w.document.open()
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>WebMCP Agent — Debug</title><style>${DEBUG_DOC_STYLE}</style></head>` +
      `<body><header><h1>WebMCP Agent — Debug</h1><button id="clear">Clear</button></header>` +
      `<div id="log"><div class="empty">Waiting for the next request…</div></div></body></html>`,
  )
  w.document.close()
  w.document.getElementById('clear')?.addEventListener('click', () => {
    debugBuffer.length = 0
    const log = w.document.getElementById('log')
    if (log) log.innerHTML = '<div class="empty">Cleared.</div>'
  })
  debugWin = w
  // Replay everything captured so far.
  for (const e of debugBuffer) renderDebugEntry(w, e)
  return w
}

function recordDebug(kind: string, title: string, payload: unknown) {
  if (!debugMode) return
  const entry: DebugEntry = { kind, title, text: safeStringify(payload) }
  debugBuffer.push(entry)
  if (debugBuffer.length > DEBUG_BUFFER_MAX) debugBuffer.shift()
  if (debugWin && !debugWin.closed) renderDebugEntry(debugWin, entry)
}

// ─── Debug toggle ─────────────────────────────────────────────────────────────

function setDebug(on: boolean) {
  debugMode = on
  messagesEl.classList.toggle('debug-on', debugMode)
  btnDebug.hidden = !debugMode
  btnDebug.classList.toggle('active', debugMode)
  if (on) {
    const w = openDebugWindow()
    if (!w) appendNotice(t('debug.popupBlocked'))
  } else if (debugWin && !debugWin.closed) {
    debugWin.close()
    debugWin = null
  }
}

function handleDebug() {
  setDebug(!debugMode)
  appendNotice(debugMode ? t('notice.debugOn') : t('notice.debugOff'))
}

// The bug button reopens the console if it was closed while debug stayed on.
btnDebug.addEventListener('click', () => {
  if (debugMode && (!debugWin || debugWin.closed)) {
    const w = openDebugWindow()
    if (!w) appendNotice(t('debug.popupBlocked'))
    return
  }
  handleDebug()
})

// ─── Voice input (Web Speech API) ─────────────────────────────────────────────

type SpeechRec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((ev: any) => void) | null
  onerror: ((ev: any) => void) | null
  onend: (() => void) | null
}

const SpeechRecognitionCtor: (new () => SpeechRec) | undefined =
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition

let recognition: SpeechRec | null = null
let listening = false
let baseText = '' // textarea content before the current dictation started

if (SpeechRecognitionCtor) {
  micBtn.hidden = false
  micBtn.title = t('mic.start')
}

function stopListening() {
  listening = false
  micBtn.classList.remove('listening')
  micBtn.title = t('mic.start')
  try { recognition?.stop() } catch { /* already stopped */ }
}

function startListening() {
  if (!SpeechRecognitionCtor) { appendNotice(t('mic.unsupported')); return }
  recognition = new SpeechRecognitionCtor()
  recognition.lang = speechLang(currentLocale)
  recognition.continuous = false
  recognition.interimResults = true
  baseText = promptEl.value ? promptEl.value.trimEnd() + ' ' : ''

  recognition.onresult = (ev: any) => {
    let transcript = ''
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      transcript += ev.results[i][0].transcript
    }
    promptEl.value = baseText + transcript
    promptEl.style.height = 'auto'
    promptEl.style.height = Math.min(promptEl.scrollHeight, 96) + 'px'
  }
  recognition.onerror = (ev: any) => {
    if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
      appendNotice(t('mic.denied'))
    }
    stopListening()
  }
  recognition.onend = () => { stopListening(); promptEl.focus() }

  try {
    recognition.start()
    listening = true
    micBtn.classList.add('listening')
    micBtn.title = t('mic.listening')
  } catch {
    stopListening()
  }
}

micBtn.addEventListener('click', () => {
  if (listening) stopListening(); else startListening()
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
  if (listening) stopListening()
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

  // A bridge channel is only required when there are no declarative tools to
  // drive; declarative tools run without the MAIN-world bridge.
  if (!_channelId && _declTools.length === 0) {
    appendNotice(t('notice.noChannel'))
    return
  }

  busy = true
  sendBtn.disabled = true
  promptEl.value = ''
  promptEl.style.height = 'auto'
  bannerEl.hidden = true

  appendBubble('user', escHtml(raw))
  messages.push({ role: 'user', content: raw })

  const onEvent = (e: AgentEvent) => {
    // The chat shows only the single status bubble; all raw payloads go to the
    // debug window (recordDebug), never inline.
    if (e.type === 'phase') {
      onPhase(e.phase)
    } else if (e.type === 'llm-request') {
      recordDebug('request', `→ LLM request #${e.iteration + 1} (${e.request.model})`, e.request)
    } else if (e.type === 'llm-response') {
      recordDebug('response', `← LLM response #${e.iteration + 1} (${e.response.stop_reason})`, e.response)
    } else if (e.type === 'tool-call') {
      onToolCallStatus(e.name)
      recordDebug('tool-call', `⚙ tool call: ${e.name}`, e.input)
    } else {
      recordDebug('tool-result', `⚙ tool result: ${e.name} (${e.ok ? 'ok' : 'error'})`, e.result)
    }
  }

  try {
    const text = await runAgentTurn({
      client: makeProviderClient(settings.providerId, settings.apiKey),
      model: settings.model,
      system: SYSTEM_PROMPT,
      messages,
      tools: toToolDefs(mergedTools()),
      callTool,
      onEvent,
    })
    hideStatus()
    appendBubble('assistant', renderMarkdown(text))
  } catch (err) {
    hideStatus()
    if (err instanceof ClaudeApiError && err.status === 401) {
      bannerEl.hidden = false
      bannerEl.textContent = t('banner.invalidKey')
    }
    appendBubble('error', escHtml(err instanceof Error ? err.message : String(err)))
  } finally {
    busy = false
    sendBtn.disabled = false
    promptEl.focus()
  }
})

// ─── Init ─────────────────────────────────────────────────────────────────────

// Rescan declarative tools when the DOM changes (SPAs add/remove forms on
// navigation). Debounced to coalesce bursts of mutations.
let _declScanTimer: ReturnType<typeof setTimeout> | undefined
function scheduleDeclScan() {
  if (_declScanTimer) return
  _declScanTimer = setTimeout(() => {
    _declScanTimer = undefined
    refreshDeclarativeTools()
  }, 300)
}

async function init() {
  const settings = await loadSettings()
  setLocale(settings.locale)
  discoverBridge()
  refreshDeclarativeTools()

  const observer = new MutationObserver(scheduleDeclScan)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['toolname'],
  })
}

void init()

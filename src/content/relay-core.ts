import {
  WM_NS,
  type BridgeToRelay,
  type CallToolResponse,
  type RelayToBridge,
  type ToolDescriptor,
} from '../shared/protocol'

export type RelayRuntime = {
  sendMessage: (msg: unknown) => void
  onMessage: (
    handler: (msg: unknown, sendResponse: (res: unknown) => void) => boolean | void,
  ) => void
}

export function installRelay(win: Window, runtime: RelayRuntime): void {
  let channelId: string | null = null
  let lastTools: ToolDescriptor[] = []
  const pendingCalls = new Map<string, (res: CallToolResponse) => void>()
  const pendingLists = new Map<string, (tools: ToolDescriptor[]) => void>()
  let seq = 0
  const nextId = () => `r${++seq}`

  const post = (msg: RelayToBridge) => win.postMessage(msg, '*')

  win.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as BridgeToRelay
    if (!msg || msg.ns !== WM_NS) return
    if (msg.kind === 'tools-changed') {
      channelId = msg.channelId
      lastTools = msg.tools
      runtime.sendMessage({ kind: 'wm:tools-changed', tools: msg.tools })
    } else if (msg.kind === 'tools-list') {
      pendingLists.get(msg.requestId)?.(msg.tools)
      pendingLists.delete(msg.requestId)
    } else if (msg.kind === 'tool-result') {
      pendingCalls.get(msg.callId)?.({ ok: msg.ok, result: msg.result })
      pendingCalls.delete(msg.callId)
    }
  })

  runtime.onMessage((raw, sendResponse) => {
    const msg = raw as { kind?: string; name?: string; input?: unknown }
    if (msg?.kind === 'wm:list-tools') {
      if (!channelId) {
        sendResponse(lastTools)
        return true
      }
      const requestId = nextId()
      pendingLists.set(requestId, sendResponse)
      post({ ns: WM_NS, channelId, kind: 'list-tools', requestId })
      return true
    }
    if (msg?.kind === 'wm:call-tool') {
      if (!channelId) {
        sendResponse({ ok: false, result: 'No WebMCP bridge on this page' })
        return true
      }
      const callId = nextId()
      pendingCalls.set(callId, sendResponse)
      post({ ns: WM_NS, channelId, kind: 'call-tool', callId, name: msg.name!, input: msg.input })
      return true
    }
  })
}

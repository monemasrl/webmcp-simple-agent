export type ToolDescriptor = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const WM_NS = 'webmcp-agent'

/** window.postMessage envelopes (MAIN-world bridge <-> isolated relay) */
export type BridgeToRelay =
  | { ns: typeof WM_NS; channelId: string; kind: 'tools-changed'; tools: ToolDescriptor[] }
  | { ns: typeof WM_NS; channelId: string; kind: 'tool-result'; callId: string; ok: boolean; result: string }
  | { ns: typeof WM_NS; channelId: string; kind: 'tools-list'; requestId: string; tools: ToolDescriptor[] }

export type RelayToBridge =
  | { ns: typeof WM_NS; kind: 'hello' }
  | { ns: typeof WM_NS; channelId: string; kind: 'list-tools'; requestId: string }
  | { ns: typeof WM_NS; channelId: string; kind: 'call-tool'; callId: string; name: string; input: unknown }

/** chrome.runtime / chrome.tabs messages (panel <-> relay) */
export type RuntimeRequest =
  | { kind: 'wm:list-tools' }
  | { kind: 'wm:call-tool'; name: string; input: unknown }

export type RuntimeEvent = { kind: 'wm:tools-changed'; tools: ToolDescriptor[] }

export type CallToolResponse = { ok: boolean; result: string }

import type { CallTool } from './agent'
import type { ToolDef } from './claude'
import type { CallToolResponse, ToolDescriptor } from '../shared/protocol'

export type TabMessenger = (tabId: number, msg: unknown) => Promise<unknown>

export function toToolDefs(tools: ToolDescriptor[]): ToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    // A tool may arrive without a schema (some sites omit inputSchema); guard
    // against Object.keys(undefined) → "Cannot convert undefined or null to object".
    input_schema: t.inputSchema && Object.keys(t.inputSchema).length > 0 ? t.inputSchema : { type: 'object' },
  }))
}

export async function listTabTools(tabId: number, send: TabMessenger): Promise<ToolDescriptor[]> {
  try {
    return ((await send(tabId, { kind: 'wm:list-tools' })) as ToolDescriptor[]) ?? []
  } catch {
    return [] // no relay in the tab (chrome:// pages, panel opened before load, …)
  }
}

export function makeCallTool(tabId: number, send: TabMessenger): CallTool {
  return async (name, input) => {
    try {
      return (await send(tabId, { kind: 'wm:call-tool', name, input })) as CallToolResponse
    } catch (err) {
      return { ok: false, result: err instanceof Error ? err.message : String(err) }
    }
  }
}

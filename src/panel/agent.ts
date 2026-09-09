import type { ClaudeClient, ContentBlock, Message, ToolDef } from './claude'

export const MAX_ITERATIONS = 20

export type CallTool = (name: string, input: unknown) => Promise<{ ok: boolean; result: string }>

export type AgentPhase = 'sending' | 'tools' | 'reprocessing'

export type AgentEvent =
  | { type: 'phase'; phase: AgentPhase }
  | { type: 'tool-call'; name: string; input: unknown }
  | { type: 'tool-result'; name: string; ok: boolean; result: string }

export async function runAgentTurn(opts: {
  client: ClaudeClient
  model: string
  system: string
  messages: Message[]
  tools: ToolDef[]
  callTool: CallTool
  onEvent?: (ev: AgentEvent) => void
}): Promise<string> {
  const { client, model, system, messages, tools, callTool, onEvent } = opts

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    onEvent?.({ type: 'phase', phase: i === 0 ? 'sending' : 'reprocessing' })
    const res = await client.createMessage({ model, system, messages, tools })
    messages.push({ role: 'assistant', content: res.content })

    const toolUses = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
    if (toolUses.length === 0 || res.stop_reason !== 'tool_use') {
      return res.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
    }

    onEvent?.({ type: 'phase', phase: 'tools' })
    const results: ContentBlock[] = []
    for (const tu of toolUses) {
      onEvent?.({ type: 'tool-call', name: tu.name, input: tu.input })
      const outcome = await callTool(tu.name, tu.input)
      onEvent?.({ type: 'tool-result', name: tu.name, ...outcome })
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: outcome.result,
        ...(outcome.ok ? {} : { is_error: true }),
      })
    }
    messages.push({ role: 'user', content: results })
  }

  const notice = `Stopped: reached the ${MAX_ITERATIONS}-tool iteration limit for one turn.`
  messages.push({ role: 'assistant', content: notice })
  return notice
}

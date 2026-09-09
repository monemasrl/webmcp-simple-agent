import { describe, expect, it, vi } from 'vitest'
import { MAX_ITERATIONS, runAgentTurn } from '../src/panel/agent'
import type { ClaudeClient, ClaudeResponse, Message } from '../src/panel/claude'

function scriptedClient(responses: ClaudeResponse[]): ClaudeClient & { calls: Message[][] } {
  const calls: Message[][] = []
  let i = 0
  return {
    calls,
    async createMessage({ messages }) {
      calls.push(JSON.parse(JSON.stringify(messages)))
      return responses[Math.min(i++, responses.length - 1)]
    },
  }
}

const textResponse = (text: string): ClaudeResponse => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
})

const toolUseResponse = (name: string, input: unknown): ClaudeResponse => ({
  content: [{ type: 'tool_use', id: `tu_${name}`, name, input }],
  stop_reason: 'tool_use',
})

const base = (client: ClaudeClient) => ({
  client,
  model: 'test-model',
  system: 'sys',
  tools: [],
  messages: [{ role: 'user', content: 'do it' } as Message],
})

describe('runAgentTurn', () => {
  it('returns text directly when no tool is used', async () => {
    const client = scriptedClient([textResponse('done')])
    const text = await runAgentTurn({ ...base(client), callTool: vi.fn() })
    expect(text).toBe('done')
  })

  it('executes a tool_use and feeds tool_result back', async () => {
    const client = scriptedClient([toolUseResponse('list_segments', {}), textResponse('found XYZ')])
    const callTool = vi.fn(async () => ({ ok: true, result: '[{"name":"XYZ"}]' }))
    const events: { type: string }[] = []
    const text = await runAgentTurn({ ...base(client), callTool, onEvent: (e) => events.push(e) })
    expect(text).toBe('found XYZ')
    expect(callTool).toHaveBeenCalledWith('list_segments', {})
    const secondCall = client.calls[1]
    const toolResultMsg = secondCall.at(-1) as { role: string; content: any[] }
    expect(toolResultMsg.role).toBe('user')
    expect(toolResultMsg.content[0]).toMatchObject({
      type: 'tool_result', tool_use_id: 'tu_list_segments', content: '[{"name":"XYZ"}]',
    })
    const toolEvents = events.filter((e) => e.type === 'tool-call' || e.type === 'tool-result')
    expect(toolEvents).toHaveLength(2)
    // phase events: sending → tools → reprocessing
    expect(events.filter((e) => e.type === 'phase').map((e) => (e as any).phase))
      .toEqual(['sending', 'tools', 'reprocessing'])
  })

  it('marks failed tool calls with is_error', async () => {
    const client = scriptedClient([toolUseResponse('boom', {}), textResponse('it failed')])
    const callTool = vi.fn(async () => ({ ok: false, result: 'The user did not approve this action.' }))
    await runAgentTurn({ ...base(client), callTool })
    const toolResultMsg = client.calls[1].at(-1) as { content: any[] }
    expect(toolResultMsg.content[0]).toMatchObject({ is_error: true })
  })

  it('stops after MAX_ITERATIONS tool rounds', async () => {
    const client = scriptedClient([toolUseResponse('loop', {})])
    const callTool = vi.fn(async () => ({ ok: true, result: 'again' }))
    const text = await runAgentTurn({ ...base(client), callTool })
    expect(callTool).toHaveBeenCalledTimes(MAX_ITERATIONS)
    expect(text).toContain('iteration limit')
  })
})

import { getProvider } from '../shared/providers'

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> }

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] }

export type ClaudeResponse = { content: ContentBlock[]; stop_reason: string }

export interface ClaudeClient {
  createMessage(params: {
    model: string
    system?: string
    messages: Message[]
    tools?: ToolDef[]
    max_tokens?: number
  }): Promise<ClaudeResponse>
}

export class ClaudeApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ClaudeApiError'
  }
}

// ─── Anthropic client ─────────────────────────────────────────────────────────

export function makeClaudeClient(apiKey: string, fetchFn: typeof fetch = fetch): ClaudeClient {
  return {
    async createMessage({ model, system, messages, tools, max_tokens = 4096 }) {
      const res = await fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, system, messages, tools, max_tokens }),
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          detail = body?.error?.message ?? detail
        } catch { /* keep generic detail */ }
        throw new ClaudeApiError(res.status, detail)
      }
      return (await res.json()) as ClaudeResponse
    },
  }
}

// ─── OpenAI-compatible client ─────────────────────────────────────────────────

type OAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type OAIToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

function toOAIMessages(system: string | undefined, messages: Message[]): OAIMessage[] {
  const result: OAIMessage[] = []
  if (system) result.push({ role: 'system', content: system })

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as 'user' | 'assistant', content: msg.content })
      continue
    }

    if (msg.role === 'assistant') {
      const textParts = msg.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      const toolCalls = msg.content
        .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: JSON.stringify(b.input) },
        }))
      const assistantMsg: OAIMessage = {
        role: 'assistant',
        content: textParts || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      }
      result.push(assistantMsg)
      continue
    }

    // user role: may contain tool_result blocks
    const blocks = msg.content
    const toolResults = blocks.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result',
    )
    const textBlocks = blocks.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')

    if (textBlocks.length) {
      result.push({ role: 'user', content: textBlocks.map((b) => b.text).join('\n') })
    }
    for (const tr of toolResults) {
      result.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content })
    }
  }
  return result
}

function fromOAIResponse(body: Record<string, unknown>): ClaudeResponse {
  const choices = body.choices as { finish_reason: string; message: Record<string, unknown> }[]
  const choice = choices[0]
  const message = choice.message
  const content: ContentBlock[] = []

  if (typeof message.content === 'string' && message.content) {
    content.push({ type: 'text', text: message.content })
  }

  const toolCalls = message.tool_calls as OAIToolCall[] | undefined
  if (toolCalls?.length) {
    for (const tc of toolCalls) {
      let input: unknown = {}
      try { input = JSON.parse(tc.function.arguments) } catch { /* keep empty */ }
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
    }
  }

  const stop_reason = choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn'
  return { content, stop_reason }
}

function makeOpenAICompatClient(baseUrl: string, apiKey: string, fetchFn: typeof fetch = fetch): ClaudeClient {
  return {
    async createMessage({ model, system, messages, tools, max_tokens = 4096 }) {
      const oaiTools = tools?.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }))

      const res = await fetchFn(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: toOAIMessages(system, messages),
          ...(oaiTools?.length ? { tools: oaiTools, tool_choice: 'auto' } : {}),
          max_tokens,
        }),
      })

      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          detail = (body as any)?.error?.message ?? detail
        } catch { /* keep generic detail */ }
        throw new ClaudeApiError(res.status, detail)
      }

      return fromOAIResponse(await res.json())
    },
  }
}

// ─── Unified factory ──────────────────────────────────────────────────────────

export function makeProviderClient(
  providerId: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): ClaudeClient {
  const provider = getProvider(providerId)
  if (!provider) throw new Error(`Unknown provider: ${providerId}`)

  if (provider.format === 'anthropic') return makeClaudeClient(apiKey, fetchFn)
  return makeOpenAICompatClient(provider.baseUrl, apiKey, fetchFn)
}

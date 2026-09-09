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

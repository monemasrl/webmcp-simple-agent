import { describe, expect, it, vi } from 'vitest'
import { ClaudeApiError, makeClaudeClient } from '../src/panel/claude'

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('makeClaudeClient', () => {
  it('POSTs to the Messages API with browser-access headers', async () => {
    const fetchFn = vi.fn(async () => okResponse({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }))
    const client = makeClaudeClient('sk-test', fetchFn as unknown as typeof fetch)
    const res = await client.createMessage({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'ciao' }] })
    expect(res.content[0]).toEqual({ type: 'text', text: 'hi' })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    const body = JSON.parse(init.body as string)
    expect(body.max_tokens).toBe(4096)
  })

  it('throws ClaudeApiError with the API error message on non-2xx', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }))
    const client = makeClaudeClient('bad', fetchFn as unknown as typeof fetch)
    await expect(client.createMessage({ model: 'm', messages: [] })).rejects.toThrowError(ClaudeApiError)
    await expect(client.createMessage({ model: 'm', messages: [] })).rejects.toThrow('invalid x-api-key')
  })
})

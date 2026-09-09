import { describe, expect, it, vi } from 'vitest'
import { installBridge } from '../src/bridge/install'
import { WM_NS, type BridgeToRelay } from '../src/shared/protocol'

type AnyDoc = Document & { modelContext?: any }

function setup(opts?: { timeoutMs?: number }) {
  const win = window as unknown as Window & { document: AnyDoc }
  delete (win.document as AnyDoc).modelContext
  const received: BridgeToRelay[] = []
  const onMsg = (ev: MessageEvent) => {
    if (ev.data?.ns === WM_NS && ['tools-changed', 'tool-result', 'tools-list'].includes(ev.data.kind))
      received.push(ev.data)
  }
  win.addEventListener('message', onMsg)
  const { channelId } = installBridge(win, { channelId: 'ch-test', ...opts })
  return { win, received, channelId, cleanup: () => win.removeEventListener('message', onMsg) }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('installBridge', () => {
  it('defines document.modelContext and announces an initial empty tools-changed', async () => {
    const { win, received, channelId, cleanup } = setup()
    expect(win.document.modelContext).toBeDefined()
    await flush()
    expect(received[0]).toMatchObject({ kind: 'tools-changed', channelId, tools: [] })
    cleanup()
  })

  it('registerTool triggers tools-changed with the descriptor', async () => {
    const { win, received, cleanup } = setup()
    win.document.modelContext.registerTool({
      name: 'echo',
      description: 'echoes',
      inputSchema: { type: 'object' },
      execute: async (input: unknown) => input,
    })
    await flush()
    const last = received.at(-1)
    expect(last).toMatchObject({ kind: 'tools-changed', tools: [{ name: 'echo' }] })
    cleanup()
  })

  it('call-tool executes the tool and posts tool-result with stringified output', async () => {
    const { win, received, channelId, cleanup } = setup()
    win.document.modelContext.registerTool({
      name: 'add',
      description: 'adds',
      inputSchema: {},
      execute: async (input: any) => ({ sum: input.a + input.b }),
    })
    win.postMessage({ ns: WM_NS, channelId, kind: 'call-tool', callId: 'c1', name: 'add', input: { a: 2, b: 3 } }, '*')
    await flush(); await flush()
    const result = received.find((m) => m.kind === 'tool-result') as any
    expect(result).toMatchObject({ callId: 'c1', ok: true, result: JSON.stringify({ sum: 5 }) })
    cleanup()
  })

  it('call-tool on unknown tool or throwing execute yields ok:false', async () => {
    const { win, received, channelId, cleanup } = setup()
    win.document.modelContext.registerTool({
      name: 'boom', description: '', inputSchema: {},
      execute: async () => { throw new Error('kaput') },
    })
    win.postMessage({ ns: WM_NS, channelId, kind: 'call-tool', callId: 'c1', name: 'missing', input: {} }, '*')
    win.postMessage({ ns: WM_NS, channelId, kind: 'call-tool', callId: 'c2', name: 'boom', input: {} }, '*')
    await flush(); await flush()
    const results = received.filter((m) => m.kind === 'tool-result') as any[]
    expect(results.find((r) => r.callId === 'c1')).toMatchObject({ ok: false })
    expect(results.find((r) => r.callId === 'c2').result).toContain('kaput')
    cleanup()
  })

  it('ignores messages with a wrong channelId', async () => {
    const { win, received, cleanup } = setup()
    win.postMessage({ ns: WM_NS, channelId: 'evil', kind: 'call-tool', callId: 'x', name: 'a', input: {} }, '*')
    await flush(); await flush()
    expect(received.filter((m) => m.kind === 'tool-result')).toHaveLength(0)
    cleanup()
  })

  it('times out a hanging execute with ok:false', async () => {
    // Use a short real timeout instead of fake timers: happy-dom dispatches
    // postMessage via its own setTimeout, which makes fake-timer chaining brittle
    // when an async catch block is the source of the dispatched event.
    const { win, received, channelId, cleanup } = setup({ timeoutMs: 50 })
    win.document.modelContext.registerTool({
      name: 'hang', description: '', inputSchema: {},
      execute: () => new Promise(() => {}),
    })
    win.postMessage({ ns: WM_NS, channelId, kind: 'call-tool', callId: 'c1', name: 'hang', input: {} }, '*')
    await flush(); await flush()
    await new Promise((r) => setTimeout(r, 120))
    await flush(); await flush()
    const result = received.find((m) => m.kind === 'tool-result') as any
    expect(result).toMatchObject({ callId: 'c1', ok: false })
    expect(result.result).toContain('timed out')
    cleanup()
  })

  it('provideContext replaces previously provided declarative tools', async () => {
    const { win, received, cleanup } = setup()
    win.document.modelContext.provideContext({ tools: [
      { name: 'a', description: '', inputSchema: {}, execute: async () => 1 },
    ]})
    win.document.modelContext.provideContext({ tools: [
      { name: 'b', description: '', inputSchema: {}, execute: async () => 2 },
    ]})
    await flush()
    const last = received.at(-1) as any
    expect(last.tools.map((t: any) => t.name)).toEqual(['b'])
    cleanup()
  })
})

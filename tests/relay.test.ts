import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installRelay, type RelayRuntime } from '../src/content/relay-core'
import { installBridge } from '../src/bridge/install'
import { WM_NS } from '../src/shared/protocol'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('installRelay (wired to a real bridge over window.postMessage)', () => {
  let handler: (msg: unknown, sendResponse: (res: unknown) => void) => boolean | void
  let events: unknown[]
  let runtime: RelayRuntime

  beforeEach(() => {
    delete (window.document as any).modelContext
    events = []
    runtime = {
      sendMessage: (m) => events.push(m),
      onMessage: (h) => { handler = h },
    }
    installRelay(window, runtime)
    installBridge(window, { channelId: 'ch-test' })
  })

  it('forwards tools-changed announcements as wm:tools-changed events', async () => {
    ;(window.document as any).modelContext.registerTool({
      name: 'echo', description: '', inputSchema: {}, execute: async () => 'hi',
    })
    await flush()
    expect(events.at(-1)).toMatchObject({ kind: 'wm:tools-changed', tools: [{ name: 'echo' }] })
  })

  it('answers wm:list-tools with the current descriptors', async () => {
    ;(window.document as any).modelContext.registerTool({
      name: 'echo', description: 'd', inputSchema: {}, execute: async () => 'hi',
    })
    await flush()
    const response = await new Promise((resolve) => {
      handler({ kind: 'wm:list-tools' }, resolve)
    })
    expect(response).toEqual([{ name: 'echo', description: 'd', inputSchema: {} }])
  })

  it('answers wm:call-tool with the tool result', async () => {
    ;(window.document as any).modelContext.registerTool({
      name: 'add', description: '', inputSchema: {}, execute: async (i: any) => i.a + i.b,
    })
    await flush()
    const response = await new Promise((resolve) => {
      handler({ kind: 'wm:call-tool', name: 'add', input: { a: 1, b: 2 } }, resolve)
    })
    expect(response).toEqual({ ok: true, result: '3' })
  })

  it('ignores unrelated runtime messages', () => {
    const sendResponse = vi.fn()
    const ret = handler({ kind: 'something-else' }, sendResponse)
    expect(ret).not.toBe(true)
    expect(sendResponse).not.toHaveBeenCalled()
  })
})

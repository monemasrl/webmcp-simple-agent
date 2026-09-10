import { describe, expect, it, vi } from 'vitest'
import { listTabTools, makeCallTool, toToolDefs } from '../src/panel/tab-tools'

describe('toToolDefs', () => {
  it('maps inputSchema to input_schema and defaults empty schemas to object', () => {
    expect(toToolDefs([
      { name: 'a', description: 'd', inputSchema: { type: 'object', properties: {} } },
      { name: 'b', description: '', inputSchema: {} },
    ])).toEqual([
      { name: 'a', description: 'd', input_schema: { type: 'object', properties: {} } },
      { name: 'b', description: '', input_schema: { type: 'object' } },
    ])
  })

  it('defaults a missing inputSchema to object instead of throwing', () => {
    // Some sites register tools without an inputSchema; Object.keys(undefined)
    // would throw "Cannot convert undefined or null to object".
    expect(toToolDefs([{ name: 'c', description: '' } as any])).toEqual([
      { name: 'c', description: '', input_schema: { type: 'object' } },
    ])
  })
})

describe('tab messaging helpers', () => {
  it('listTabTools sends wm:list-tools and returns [] when the tab has no relay', async () => {
    const send = vi.fn(async () => { throw new Error('no receiver') })
    expect(await listTabTools(7, send)).toEqual([])
    expect(send).toHaveBeenCalledWith(7, { kind: 'wm:list-tools' })
  })

  it('makeCallTool sends wm:call-tool and passes through the response', async () => {
    const send = vi.fn(async () => ({ ok: true, result: '42' }))
    const call = makeCallTool(7, send)
    expect(await call('answer', { q: 'life' })).toEqual({ ok: true, result: '42' })
    expect(send).toHaveBeenCalledWith(7, { kind: 'wm:call-tool', name: 'answer', input: { q: 'life' } })
  })

  it('makeCallTool maps a messaging failure to ok:false', async () => {
    const send = vi.fn(async () => { throw new Error('tab gone') })
    const call = makeCallTool(7, send)
    expect(await call('x', {})).toEqual({ ok: false, result: 'tab gone' })
  })
})

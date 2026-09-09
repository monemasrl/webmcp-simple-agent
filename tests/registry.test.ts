import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '../src/bridge/registry'

const tool = (name: string) => ({
  name,
  description: `desc ${name}`,
  inputSchema: { type: 'object' },
  execute: async () => 'ok',
})

describe('ToolRegistry', () => {
  it('registers and lists tools as descriptors (no execute)', () => {
    const r = new ToolRegistry()
    r.register(tool('a'))
    expect(r.list()).toEqual([{ name: 'a', description: 'desc a', inputSchema: { type: 'object' } }])
    expect(r.get('a')?.execute).toBeTypeOf('function')
  })

  it('replaces a duplicate name instead of duplicating', () => {
    const r = new ToolRegistry()
    r.register(tool('a'))
    r.register({ ...tool('a'), description: 'v2' })
    expect(r.list()).toHaveLength(1)
    expect(r.list()[0].description).toBe('v2')
  })

  it('register returns an unregister function; unregister(name) works too', () => {
    const r = new ToolRegistry()
    const off = r.register(tool('a'))
    r.register(tool('b'))
    off()
    r.unregister('b')
    expect(r.list()).toEqual([])
  })

  it('notifies onChange on register and unregister, and unsubscribes', () => {
    const r = new ToolRegistry()
    const fn = vi.fn()
    const unsub = r.onChange(fn)
    r.register(tool('a'))
    r.unregister('a')
    expect(fn).toHaveBeenCalledTimes(2)
    unsub()
    r.register(tool('b'))
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

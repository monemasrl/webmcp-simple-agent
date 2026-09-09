import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, loadSettings, saveSettings, type KVStore } from '../src/shared/settings'

function memoryStore(): KVStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    data,
    async get(keys) {
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))
    },
    async set(items) {
      Object.assign(data, items)
    },
  }
}

describe('settings', () => {
  it('defaults: empty apiKey, claude-sonnet-4-6 model', async () => {
    const s = await loadSettings(memoryStore())
    expect(s).toEqual({ apiKey: '', model: DEFAULT_MODEL })
    expect(DEFAULT_MODEL).toBe('claude-sonnet-4-6')
  })

  it('round-trips saved values and merges partial saves', async () => {
    const store = memoryStore()
    await saveSettings({ apiKey: 'sk-1' }, store)
    await saveSettings({ model: 'claude-opus-4-8' }, store)
    expect(await loadSettings(store)).toEqual({ apiKey: 'sk-1', model: 'claude-opus-4-8' })
  })

  it('treats a blank saved model as the default', async () => {
    const store = memoryStore()
    await saveSettings({ model: '  ' }, store)
    expect((await loadSettings(store)).model).toBe(DEFAULT_MODEL)
  })
})

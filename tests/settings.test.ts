import { describe, expect, it } from 'vitest'
import { loadSettings, saveSettings, type KVStore } from '../src/shared/settings'
import { DEFAULT_PROVIDER_ID, DEFAULT_MODEL_ID } from '../src/shared/providers'

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
  it('defaults: empty apiKey, default provider and model', async () => {
    const s = await loadSettings(memoryStore())
    expect(s).toEqual({ providerId: DEFAULT_PROVIDER_ID, apiKey: '', model: DEFAULT_MODEL_ID })
    expect(DEFAULT_PROVIDER_ID).toBe('anthropic')
    expect(DEFAULT_MODEL_ID).toBe('claude-sonnet-4-6')
  })

  it('round-trips saved values and merges partial saves', async () => {
    const store = memoryStore()
    await saveSettings({ apiKey: 'sk-1' }, store)
    await saveSettings({ model: 'claude-opus-4-8' }, store)
    const s = await loadSettings(store)
    expect(s.apiKey).toBe('sk-1')
    expect(s.model).toBe('claude-opus-4-8')
  })

  it('treats a blank saved model as the default', async () => {
    const store = memoryStore()
    await saveSettings({ model: '  ' }, store)
    expect((await loadSettings(store)).model).toBe(DEFAULT_MODEL_ID)
  })
})

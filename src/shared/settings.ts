export const DEFAULT_MODEL = 'claude-sonnet-4-6'

export type Settings = { apiKey: string; model: string }

export type KVStore = {
  get(keys: string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export function chromeStore(): KVStore {
  return {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
  }
}

export async function loadSettings(store: KVStore = chromeStore()): Promise<Settings> {
  const raw = await store.get(['apiKey', 'model'])
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : DEFAULT_MODEL
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : ''
  return { apiKey, model }
}

export async function saveSettings(patch: Partial<Settings>, store: KVStore = chromeStore()): Promise<void> {
  await store.set({ ...patch })
}

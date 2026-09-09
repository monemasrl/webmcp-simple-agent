import { DEFAULT_PROVIDER_ID, DEFAULT_MODEL_ID } from './providers'

export type Settings = { providerId: string; apiKey: string; model: string }

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
  const raw = await store.get(['providerId', 'apiKey', 'model'])
  const providerId = typeof raw.providerId === 'string' && raw.providerId.trim() ? raw.providerId.trim() : DEFAULT_PROVIDER_ID
  const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : ''
  const model = typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : DEFAULT_MODEL_ID
  return { providerId, apiKey, model }
}

export async function saveSettings(patch: Partial<Settings>, store: KVStore = chromeStore()): Promise<void> {
  await store.set({ ...patch })
}

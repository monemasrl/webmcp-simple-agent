export type ModelDef = { id: string; name: string }

export type ProviderDef = {
  id: string
  name: string
  baseUrl: string
  format: 'anthropic' | 'openai'
  models: ModelDef[]
  keyDocs: string
  keyPlaceholder: string
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    format: 'anthropic',
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    ],
    keyDocs: 'https://console.anthropic.com/api-keys',
    keyPlaceholder: 'sk-ant-…',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    format: 'openai',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
    ],
    keyDocs: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn',
    format: 'openai',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot 8k' },
      { id: 'moonshot-v1-32k', name: 'Moonshot 32k' },
      { id: 'moonshot-v1-128k', name: 'Moonshot 128k' },
    ],
    keyDocs: 'https://platform.moonshot.cn/console/api-keys',
    keyPlaceholder: 'sk-…',
  },
]

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

export const DEFAULT_PROVIDER_ID = 'anthropic'
export const DEFAULT_MODEL_ID = PROVIDERS[0].models[0].id

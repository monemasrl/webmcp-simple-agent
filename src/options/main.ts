import { PROVIDERS, getProvider } from '../shared/providers'
import { loadSettings, saveSettings } from '../shared/settings'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const providerEl = $<HTMLSelectElement>('provider')
const modelEl = $<HTMLSelectElement>('model')
const apiKeyEl = $<HTMLInputElement>('apiKey')
const keyDocsEl = $<HTMLAnchorElement>('key-docs')

function populateProviders(selectedId: string) {
  providerEl.innerHTML = ''
  for (const p of PROVIDERS) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = p.name
    opt.selected = p.id === selectedId
    providerEl.appendChild(opt)
  }
}

function populateModels(providerId: string, selectedModel: string) {
  const provider = getProvider(providerId)
  if (!provider) return
  modelEl.innerHTML = ''
  for (const m of provider.models) {
    const opt = document.createElement('option')
    opt.value = m.id
    opt.textContent = m.name
    opt.selected = m.id === selectedModel
    modelEl.appendChild(opt)
  }
  keyDocsEl.href = provider.keyDocs
  apiKeyEl.placeholder = provider.keyPlaceholder
}

providerEl.addEventListener('change', () => {
  populateModels(providerEl.value, modelEl.value)
})

async function init() {
  const settings = await loadSettings()
  populateProviders(settings.providerId)
  populateModels(settings.providerId, settings.model)
  apiKeyEl.value = settings.apiKey

  $<HTMLFormElement>('settings').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    await saveSettings({
      providerId: providerEl.value,
      model: modelEl.value,
      apiKey: apiKeyEl.value.trim(),
    })
    $('status').textContent = 'Saved.'
    setTimeout(() => ($('status').textContent = ''), 1500)
  })
}

void init()

import { PROVIDERS, getProvider } from '../shared/providers'
import { LOCALES, type Locale } from '../shared/i18n'
import { loadSettings, saveSettings } from '../shared/settings'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const providerEl = $<HTMLSelectElement>('provider')
const modelEl = $<HTMLSelectElement>('model')
const localeEl = $<HTMLSelectElement>('locale')
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

function populateLocales(selected: Locale) {
  localeEl.innerHTML = ''
  for (const l of LOCALES) {
    const opt = document.createElement('option')
    opt.value = l.id
    opt.textContent = l.name
    opt.selected = l.id === selected
    localeEl.appendChild(opt)
  }
}

async function init() {
  const settings = await loadSettings()
  populateProviders(settings.providerId)
  populateModels(settings.providerId, settings.model)
  populateLocales(settings.locale)
  apiKeyEl.value = settings.apiKey

  $<HTMLFormElement>('settings').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    await saveSettings({
      providerId: providerEl.value,
      model: modelEl.value,
      locale: localeEl.value as Locale,
      apiKey: apiKeyEl.value.trim(),
    })
    $('status').textContent = 'Saved.'
    setTimeout(() => ($('status').textContent = ''), 1500)
  })
}

void init()

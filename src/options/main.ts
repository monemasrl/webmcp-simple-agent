import { DEFAULT_MODEL, loadSettings, saveSettings } from '../shared/settings'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

async function init() {
  const settings = await loadSettings()
  $<HTMLInputElement>('apiKey').value = settings.apiKey
  $<HTMLInputElement>('model').value = settings.model
  $<HTMLInputElement>('model').placeholder = DEFAULT_MODEL

  $<HTMLFormElement>('settings').addEventListener('submit', async (ev) => {
    ev.preventDefault()
    await saveSettings({
      apiKey: $<HTMLInputElement>('apiKey').value.trim(),
      model: $<HTMLInputElement>('model').value.trim() || DEFAULT_MODEL,
    })
    $('status').textContent = 'Saved.'
    setTimeout(() => ($('status').textContent = ''), 1500)
  })
}

void init()

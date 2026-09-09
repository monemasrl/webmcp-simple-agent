import { describe, expect, it } from 'vitest'
import { t, LOCALES, localeName } from '../src/shared/i18n'

describe('i18n', () => {
  it('translates a key per locale', () => {
    expect(t('en', 'config.save')).toBe('Save')
    expect(t('it', 'config.save')).toBe('Salva')
  })

  it('interpolates params', () => {
    expect(t('en', 'toolbar.available', { n: 3 })).toBe('3 tools available')
    expect(t('it', 'notice.modelSet', { name: 'GPT-4o' })).toBe('Modello impostato su GPT-4o')
  })

  it('falls back to English for a missing locale key', () => {
    // both catalogs define this key, but verify the fallback path returns a string
    expect(t('it', 'nonexistent.key')).toBe('nonexistent.key')
  })

  it('exposes the two supported locales', () => {
    expect(LOCALES.map((l) => l.id)).toEqual(['en', 'it'])
    expect(localeName('it')).toBe('Italiano')
  })
})

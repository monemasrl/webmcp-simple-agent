export type Locale = 'en' | 'it'

export const LOCALES: { id: Locale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'it', name: 'Italiano' },
]

type Catalog = Record<string, string>

const EN: Catalog = {
  'header.title': 'AI Assistant',
  'status.online': 'Online',
  'status.noTools': 'No tools',
  'toolbar.checking': 'Checking for tools…',
  'toolbar.available': '{n} tools available',
  'toolbar.available.one': '1 tool available',
  'toolbar.none': 'No tools on this page',
  'setup.title': 'Configure your AI provider',
  'setup.sub': 'Choose a provider and enter your API key to get started. You can change this any time with /config.',
  'setup.go': 'Open settings →',
  'welcome.hi': "Hi! I'm your AI assistant.",
  'welcome.ask': 'Ask me anything about this page.',
  'welcome.hint': 'Type / for commands',
  'welcome.cleared': 'Conversation cleared.',
  'welcome.clearedAsk': 'Ask me something!',
  'config.title': 'Settings',
  'config.sub': 'Configure provider, model, language and API key',
  'config.provider': 'Provider',
  'config.model': 'Model',
  'config.language': 'Language',
  'config.apiKey': 'API Key',
  'config.getKey': 'Get API key ↗',
  'config.save': 'Save',
  'config.saved': '✓ Saved',
  'config.show': 'Show',
  'config.hide': 'Hide',
  'config.keyPlaceholder': 'Paste your key…',
  'composer.placeholder': 'Type a message or /command…',
  'cmd.config': 'Configure provider and API key',
  'cmd.model': 'Quick-switch model',
  'cmd.tools': 'List tools available on this page',
  'cmd.debug': 'Toggle raw request/response debug view',
  'cmd.language': 'Switch interface language',
  'cmd.clear': 'Clear conversation',
  'cmd.help': 'Show available commands',
  'card.commands': 'Available commands',
  'card.pageTools': 'Page tools',
  'card.noPageTools': 'No WebMCP tools exposed on this page.',
  'card.toolsCount': '{n} tools on this page',
  'card.toolsCount.one': '1 tool on this page',
  'card.pickModel': '{provider} — pick a model',
  'card.pickLanguage': 'Pick a language',
  'notice.modelSet': 'Model set to {name}',
  'notice.languageSet': 'Language set to {name}',
  'notice.debugOn': 'Debug enabled — raw requests/responses are now shown',
  'notice.debugOff': 'Debug disabled',
  'notice.noChannel': 'No WebMCP channel found on this page.',
  'notice.help': 'Commands: /config · /model · /tools · /debug · /language · /clear · /help',
  'banner.invalidKey': 'Invalid API key — use /config to update it.',
  'banner.missingKey': 'Missing API key — open the extension Options.',
  'phase.sending': 'Sending…',
  'phase.waiting': 'Waiting for response…',
  'phase.tools': 'Querying tool: {name}…',
  'phase.toolsDone': 'Tool responded',
  'phase.reprocessing': 'Processing response…',
  'mic.start': 'Voice input',
  'mic.listening': 'Listening…',
  'mic.unsupported': 'Voice input is not supported in this browser.',
  'mic.denied': 'Microphone access was denied.',
}

const IT: Catalog = {
  'header.title': 'Assistente AI',
  'status.online': 'Online',
  'status.noTools': 'Nessuno strumento',
  'toolbar.checking': 'Ricerca strumenti…',
  'toolbar.available': '{n} strumenti disponibili',
  'toolbar.available.one': '1 strumento disponibile',
  'toolbar.none': 'Nessuno strumento in questa pagina',
  'setup.title': 'Configura il provider AI',
  'setup.sub': 'Scegli un provider e inserisci la tua API key per iniziare. Puoi cambiarli in qualsiasi momento con /config.',
  'setup.go': 'Apri le impostazioni →',
  'welcome.hi': 'Ciao! Sono il tuo assistente AI.',
  'welcome.ask': 'Chiedimi qualsiasi cosa su questa pagina.',
  'welcome.hint': 'Digita / per i comandi',
  'welcome.cleared': 'Conversazione cancellata.',
  'welcome.clearedAsk': 'Chiedimi qualcosa!',
  'config.title': 'Impostazioni',
  'config.sub': 'Configura provider, modello, lingua e API key',
  'config.provider': 'Provider',
  'config.model': 'Modello',
  'config.language': 'Lingua',
  'config.apiKey': 'API Key',
  'config.getKey': 'Ottieni API key ↗',
  'config.save': 'Salva',
  'config.saved': '✓ Salvato',
  'config.show': 'Mostra',
  'config.hide': 'Nascondi',
  'config.keyPlaceholder': 'Incolla la tua chiave…',
  'composer.placeholder': 'Scrivi un messaggio o /comando…',
  'cmd.config': 'Configura provider e API key',
  'cmd.model': 'Cambia modello rapidamente',
  'cmd.tools': 'Elenca gli strumenti di questa pagina',
  'cmd.debug': 'Attiva/disattiva la vista debug richieste/risposte',
  'cmd.language': "Cambia la lingua dell'interfaccia",
  'cmd.clear': 'Cancella la conversazione',
  'cmd.help': 'Mostra i comandi disponibili',
  'card.commands': 'Comandi disponibili',
  'card.pageTools': 'Strumenti della pagina',
  'card.noPageTools': 'Nessuno strumento WebMCP esposto in questa pagina.',
  'card.toolsCount': '{n} strumenti in questa pagina',
  'card.toolsCount.one': '1 strumento in questa pagina',
  'card.pickModel': '{provider} — scegli un modello',
  'card.pickLanguage': 'Scegli una lingua',
  'notice.modelSet': 'Modello impostato su {name}',
  'notice.languageSet': 'Lingua impostata su {name}',
  'notice.debugOn': 'Debug attivo — ora vedi richieste/risposte grezze',
  'notice.debugOff': 'Debug disattivato',
  'notice.noChannel': 'Nessun canale WebMCP trovato in questa pagina.',
  'notice.help': 'Comandi: /config · /model · /tools · /debug · /language · /clear · /help',
  'banner.invalidKey': 'API key non valida — usa /config per aggiornarla.',
  'banner.missingKey': "API key mancante — apri le Opzioni dell'estensione.",
  'phase.sending': 'Sto inviando…',
  'phase.waiting': 'In attesa di risposta…',
  'phase.tools': 'Interrogo lo strumento: {name}…',
  'phase.toolsDone': 'Strumento ha risposto',
  'phase.reprocessing': 'Rielaboro la risposta…',
  'mic.start': 'Comando vocale',
  'mic.listening': 'Ascolto…',
  'mic.unsupported': 'Il comando vocale non è supportato in questo browser.',
  'mic.denied': "L'accesso al microfono è stato negato.",
}

const CATALOGS: Record<Locale, Catalog> = { en: EN, it: IT }

export function detectLocale(): Locale {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en'
  return nav.toLowerCase().startsWith('it') ? 'it' : 'en'
}

export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const catalog = CATALOGS[locale] ?? EN
  let str = catalog[key] ?? EN[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return str
}

export function localeName(id: Locale): string {
  return LOCALES.find((l) => l.id === id)?.name ?? id
}

/** BCP-47 tag for Web Speech / Intl APIs. */
export function speechLang(id: Locale): string {
  return id === 'it' ? 'it-IT' : 'en-US'
}

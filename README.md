# WebMCP Simple Agent

Chrome extension: an in-page chat (plus a side panel) where an AI model executes
your prompt using the [WebMCP](https://webmachinelearning.github.io/webmcp/)
tools the current page exposes — both imperative
(`document.modelContext.registerTool()`) and declarative (`<form toolname>`).
Works on stable Chrome: a MAIN-world content script polyfills
`document.modelContext`, so no origin-trial flag is needed.

Bring your own API key — Anthropic, OpenAI or Kimi, with model selection.
Design doc: `docs/specs/2026-09-09-webmcp-agent-extension-design.md`.

## Build & load

    pnpm install
    pnpm build

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist/`
2. Extension **Options** → paste your Anthropic API key (stored in `chrome.storage.local`)
3. Open any WebMCP page, click the toolbar icon to open the side panel

## Manual e2e checklist

Demo page (`open demo/index.html` via any static server, e.g. `python3 -m http.server -d demo`):

- [ ] Page shows "3 tools registered"; panel shows "3 tools available on this page"
- [ ] Prompt "what time is it?" → Claude calls `get_time` and answers
- [ ] Prompt "add a note saying hello, then list all notes" → chained `add_note` + `list_notes`, note appears in the page
- [ ] Wrong API key → clear error banner pointing at Options

Procmail dashboard (WebMCP toggle enabled in /app/profile):

- [ ] Panel lists the dashboard tools on /app pages
- [ ] "Crea una broadcast col segmento XYZ, template TPL01, programmala per il 10/10/2026 23:00 UTC"
      → agent resolves segment/template via list tools, creates the broadcast,
      and `schedule_broadcast` opens the dashboard confirmation modal
- [ ] Rejecting the modal → agent reports the action was not approved

## Development

    pnpm test        # vitest
    pnpm typecheck   # tsc --noEmit

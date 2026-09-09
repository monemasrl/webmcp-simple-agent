# WebMCP Agent — Chrome extension design

**Date:** 2026-09-09
**Status:** approved design, pre-implementation
**Repo:** standalone (`webmcp-agent`), not part of the InboundEmail monorepo

## Purpose

A Chrome extension that lets the user type a natural-language prompt in a side panel and have Claude execute it using the [WebMCP](https://webmachinelearning.github.io/webmcp/) tools exposed by the current page via `document.modelContext`.

Primary use case today: driving the Procmail dashboard (`dash.procmail.sh`), e.g. *"Crea una campagna broadcast col segmento XYZ, template TPL01, programmala per il 10 ottobre 2026 alle 23:00 UTC"*. The design is deliberately generic: nothing in the extension is Procmail-specific, so it works on any WebMCP-enabled site.

**Audience:** internal/demo tool. API key pasted in the Options page, loaded unpacked — no Chrome Web Store distribution, no third-party key onboarding.

## Key decision: polyfill, not native browser APIs

The WebMCP standard gives extensions no API to enumerate tools a page registered on `document.modelContext`. Chrome's native support is behind an origin-trial flag until ~Chrome 157, and the extension APIs Google's Tool Inspector uses are experimental and undocumented.

Instead, a MAIN-world content script injected at `document_start` **defines (or wraps, if already present) `document.modelContext` itself**. Page calls to `registerTool()` are captured into a local registry; tool calls invoke the page's original `execute` function. Consequences:

- Works on **stable Chrome without any flag** — the polyfill *is* the implementation.
- Same pattern as MCP-B; zero dependency on experimental APIs.
- If native Chrome later adds behavior (e.g. permission UI), the polyfill bypasses it — acceptable for an internal tool; revisit when WebMCP ships stable.

## Architecture

Manifest V3, TypeScript, bundled with esbuild (three IIFE content/background scripts + two static HTML pages — no need for Vite). Four components:

1. **MAIN-world bridge** (`bridge.js`, `document_start`, `<all_urls>` — an allowlist can be added later): polyfills/wraps `document.modelContext` (`registerTool`, `unregisterTool`, declarative registration if used). Keeps a registry of `{name, description, inputSchema, execute}`. Talks to the isolated world via `window.postMessage` scoped by a random channel id generated per page load.
2. **Isolated content script**: relay between the bridge and the service worker over a `chrome.runtime` port. Forwards tool added/removed notifications, tool-call requests, and results.
3. **Service worker**: routes ports per tab; tracks which tools the active tab exposes; wakes the side panel state on tab switch.
4. **Side panel** (chrome side panel API, per-tab): minimal chat UI + agent loop.
   - API key from `chrome.storage.local`, set via an Options page.
   - Calls `api.anthropic.com` directly from the browser with the `anthropic-dangerous-direct-browser-access: true` header.
   - Default model `claude-sonnet-4-6`, configurable in Options.
   - The active tab's tools become the `tools` array of the Messages request; each `tool_use` is executed in the page and returned as `tool_result`, looping until Claude answers without tool calls.

**No approval UI in the extension.** Consequential actions (e.g. `schedule_broadcast` on the Procmail dashboard) are confirmed by the page's own modal — the page's security model stays authoritative.

## Data flow (broadcast example)

1. User opens the dashboard on `/app`, opens the side panel, types the prompt.
2. Panel sends prompt + the tab's tools to Claude with a short system prompt ("you are an assistant operating on the current page through its tools").
3. Claude calls e.g. `list_segments` / `list_email_templates` to resolve names → executed in the page → results returned as `tool_result`.
4. Claude calls `create_broadcast` then `schedule_broadcast` → the dashboard opens its confirmation modal; the user approves in the page; the outcome flows back to Claude.
5. Claude summarizes in the panel. Chat state is per-tab, in memory only — no persistence (YAGNI).

## Error handling

- Tab exposes no WebMCP tools → panel says so explicitly.
- In-page modal rejected → "The user did not approve this action" returns as a normal `tool_result`; Claude reports it.
- `execute` throws or exceeds a 60 s timeout → `tool_result` with `is_error: true`.
- Missing/invalid API key → banner in the panel linking to Options.
- Tab navigation/refresh → registry cleared and rebuilt from new registrations; the chat notes that tools changed.
- Agent loop capped at 20 tool iterations per turn.

## Testing

- **Unit (vitest):** bridge registry (register/unregister/duplicates), bridge↔panel message protocol, agent loop against a fake Claude client (tool_use → tool_result sequences, errors, max iterations).
- **Demo page:** a static page in the repo registering 2–3 fake tools on `document.modelContext` — for manual testing and to prove the client is site-agnostic.
- **Manual e2e:** the broadcast scenario on the Procmail dashboard.

## Out of scope (deliberate)

- Chrome Web Store packaging / key onboarding for third parties.
- Chat persistence across page loads.
- Multi-provider LLM support (Claude only for now).
- Streaming responses (nice-to-have later; start with non-streaming Messages calls).
- Site allowlist UI (constant in code is enough for an internal tool).

# WebMCP Agent Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome MV3 extension with a side-panel chat where Claude executes user prompts by calling the WebMCP tools the current page registers on `document.modelContext`.

**Architecture:** A MAIN-world content script polyfills/wraps `document.modelContext`, capturing tool registrations into a registry and executing tool calls in-page. An isolated content script relays between the page and extension via `window.postMessage` (guarded by a per-page-load channel id) and `chrome.runtime` messaging. The side panel runs a non-streaming agent loop against the Anthropic Messages API called directly from the browser.

**Tech Stack:** TypeScript, esbuild (bundling — no Vite; three IIFE scripts + two static HTML pages don't need it), vitest + happy-dom, @types/chrome, pnpm.

**Spec:** `docs/specs/2026-09-09-webmcp-agent-extension-design.md`

## Global Constraints

- Repo is standalone at `~/Projects/webmcp-agent` — no InboundEmail monorepo coupling, nothing Procmail-specific in code.
- Manifest V3; content scripts are classic scripts (IIFE), background is a module service worker.
- Default model `claude-sonnet-4-6`, configurable in Options; API key in `chrome.storage.local` only.
- Anthropic API called with header `anthropic-dangerous-direct-browser-access: true` and `anthropic-version: 2023-06-01`.
- Agent loop hard cap: 20 tool iterations per turn. Tool execute timeout: 60 s (in the bridge).
- No approval UI in the extension — consequential actions are confirmed by the page's own UI.
- No streaming, no chat persistence, no multi-provider support (spec "Out of scope").
- All tests run with `pnpm vitest run`; build with `pnpm build` producing a loadable `dist/`.

## File Structure

```
manifest.json                  # copied verbatim into dist/
scripts/build.mjs              # esbuild bundling + static copy
src/shared/protocol.ts         # message envelopes + ToolDescriptor (Task 2)
src/shared/settings.ts         # chrome.storage.local settings wrapper (Task 7)
src/bridge/registry.ts         # pure ToolRegistry (Task 2)
src/bridge/main.ts             # MAIN-world entry: polyfill + postMessage server (Task 3)
src/content/relay.ts           # isolated content script relay (Task 4)
src/background/index.ts        # service worker: side panel behavior (Task 1)
src/panel/claude.ts            # Anthropic Messages API client (Task 5)
src/panel/agent.ts             # agent loop (Task 6)
src/panel/main.ts              # panel wiring + rendering (Task 8)
public/panel.html  public/panel.css  public/options.html   # static pages
src/options/main.ts            # options page logic (Task 7)
demo/index.html                # standalone demo page with fake tools (Task 9)
tests/...                      # one test file per module
README.md                      # load-unpacked + e2e checklist (Task 9)
```

---

### Task 1: Scaffold, build pipeline, loadable empty extension

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `manifest.json`, `scripts/build.mjs`, `src/background/index.ts`, `public/panel.html`, `public/panel.css`, `public/options.html`

**Interfaces:**
- Consumes: nothing.
- Produces: `pnpm build` → `dist/` containing `manifest.json`, `bridge.js`, `relay.js`, `background.js`, `panel.js`, `options.js`, `panel.html`, `panel.css`, `options.html`. Later tasks only add sources; the build script does not change.

- [ ] **Step 1: Write config files**

`package.json`:

```json
{
  "name": "webmcp-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.280",
    "esbuild": "^0.24.0",
    "happy-dom": "^15.11.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["chrome"],
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src", "tests", "scripts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'happy-dom' },
})
```

`.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 2: Write manifest.json**

```json
{
  "manifest_version": 3,
  "name": "WebMCP Agent",
  "version": "0.1.0",
  "description": "Claude-powered agent for pages exposing WebMCP tools (document.modelContext)",
  "permissions": ["storage", "sidePanel", "tabs"],
  "host_permissions": ["https://api.anthropic.com/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["bridge.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["<all_urls>"],
      "js": ["relay.js"],
      "run_at": "document_start"
    }
  ],
  "action": { "default_title": "WebMCP Agent" },
  "side_panel": { "default_path": "panel.html" },
  "options_page": "options.html"
}
```

- [ ] **Step 3: Write the build script**

`scripts/build.mjs`:

```js
import { build } from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })

const entries = [
  { in: 'src/bridge/main.ts', out: 'bridge' },
  { in: 'src/content/relay.ts', out: 'relay' },
  { in: 'src/background/index.ts', out: 'background' },
  { in: 'src/panel/main.ts', out: 'panel' },
  { in: 'src/options/main.ts', out: 'options' },
]

await build({
  entryPoints: entries.map((e) => ({ in: e.in, out: e.out })),
  bundle: true,
  format: 'iife',
  outdir: 'dist',
  target: 'chrome120',
  logLevel: 'info',
})

cpSync('manifest.json', 'dist/manifest.json')
cpSync('public', 'dist', { recursive: true })
```

- [ ] **Step 4: Write minimal entry points so the build has all five inputs**

`src/background/index.ts` (this is its final content — never grows):

```ts
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('sidePanel behavior', err))
```

Placeholders (replaced by later tasks): `src/bridge/main.ts`, `src/content/relay.ts`, `src/panel/main.ts`, `src/options/main.ts` each containing only:

```ts
export {}
```

`public/panel.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>WebMCP Agent</title>
    <link rel="stylesheet" href="panel.css" />
  </head>
  <body>
    <main id="app"></main>
    <script src="panel.js"></script>
  </body>
</html>
```

`public/panel.css` (final layout arrives in Task 8; start empty with a comment):

```css
/* styles in Task 8 */
```

`public/options.html`:

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>WebMCP Agent — Options</title></head>
  <body>
    <h1>WebMCP Agent</h1>
    <form id="settings">
      <label>Anthropic API key <input type="password" id="apiKey" size="60" /></label><br />
      <label>Model <input type="text" id="model" size="40" /></label><br />
      <button type="submit">Save</button> <span id="status"></span>
    </form>
    <script src="options.js"></script>
  </body>
</html>
```

- [ ] **Step 5: Install and build**

Run: `cd ~/Projects/webmcp-agent && pnpm install && pnpm build && ls dist`
Expected: `background.js bridge.js manifest.json options.html options.js panel.css panel.html panel.js relay.js`

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold MV3 extension with esbuild pipeline"
```

---

### Task 2: Shared protocol types + ToolRegistry

**Files:**
- Create: `src/shared/protocol.ts`, `src/bridge/registry.ts`
- Test: `tests/registry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ToolDescriptor = { name: string; description: string; inputSchema: Record<string, unknown> }`
  - `WM_NS = 'webmcp-agent'`, message unions `BridgeToRelay` / `RelayToBridge`, runtime messages `RuntimeRequest` / `RuntimeEvent`, `CallToolResponse = { ok: boolean; result: string }`
  - `class ToolRegistry` with `register(tool): () => void`, `unregister(name)`, `get(name)`, `list(): ToolDescriptor[]`, `onChange(fn): () => void`

- [ ] **Step 1: Write `src/shared/protocol.ts`**

```ts
export type ToolDescriptor = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export const WM_NS = 'webmcp-agent'

/** window.postMessage envelopes (MAIN-world bridge <-> isolated relay) */
export type BridgeToRelay =
  | { ns: typeof WM_NS; channelId: string; kind: 'tools-changed'; tools: ToolDescriptor[] }
  | { ns: typeof WM_NS; channelId: string; kind: 'tool-result'; callId: string; ok: boolean; result: string }
  | { ns: typeof WM_NS; channelId: string; kind: 'tools-list'; requestId: string; tools: ToolDescriptor[] }

export type RelayToBridge =
  | { ns: typeof WM_NS; channelId: string; kind: 'list-tools'; requestId: string }
  | { ns: typeof WM_NS; channelId: string; kind: 'call-tool'; callId: string; name: string; input: unknown }

/** chrome.runtime / chrome.tabs messages (panel <-> relay) */
export type RuntimeRequest =
  | { kind: 'wm:list-tools' }
  | { kind: 'wm:call-tool'; name: string; input: unknown }

export type RuntimeEvent = { kind: 'wm:tools-changed'; tools: ToolDescriptor[] }

export type CallToolResponse = { ok: boolean; result: string }
```

- [ ] **Step 2: Write the failing registry test**

`tests/registry.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '../src/bridge/registry'

const tool = (name: string) => ({
  name,
  description: `desc ${name}`,
  inputSchema: { type: 'object' },
  execute: async () => 'ok',
})

describe('ToolRegistry', () => {
  it('registers and lists tools as descriptors (no execute)', () => {
    const r = new ToolRegistry()
    r.register(tool('a'))
    expect(r.list()).toEqual([{ name: 'a', description: 'desc a', inputSchema: { type: 'object' } }])
    expect(r.get('a')?.execute).toBeTypeOf('function')
  })

  it('replaces a duplicate name instead of duplicating', () => {
    const r = new ToolRegistry()
    r.register(tool('a'))
    r.register({ ...tool('a'), description: 'v2' })
    expect(r.list()).toHaveLength(1)
    expect(r.list()[0].description).toBe('v2')
  })

  it('register returns an unregister function; unregister(name) works too', () => {
    const r = new ToolRegistry()
    const off = r.register(tool('a'))
    r.register(tool('b'))
    off()
    r.unregister('b')
    expect(r.list()).toEqual([])
  })

  it('notifies onChange on register and unregister, and unsubscribes', () => {
    const r = new ToolRegistry()
    const fn = vi.fn()
    const unsub = r.onChange(fn)
    r.register(tool('a'))
    r.unregister('a')
    expect(fn).toHaveBeenCalledTimes(2)
    unsub()
    r.register(tool('b'))
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/registry.test.ts`
Expected: FAIL — cannot resolve `../src/bridge/registry`

- [ ] **Step 4: Write `src/bridge/registry.ts`**

```ts
import type { ToolDescriptor } from '../shared/protocol'

export type RegisteredTool = ToolDescriptor & {
  execute: (input: unknown) => unknown
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()
  private listeners = new Set<() => void>()

  register(tool: RegisteredTool): () => void {
    this.tools.set(tool.name, tool)
    this.emit()
    return () => this.unregister(tool.name)
  }

  unregister(name: string): void {
    if (this.tools.delete(name)) this.emit()
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  list(): ToolDescriptor[] {
    return [...this.tools.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }))
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/registry.test.ts`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add src/shared/protocol.ts src/bridge/registry.ts tests/registry.test.ts
git commit -m "feat: shared message protocol and tool registry"
```

---

### Task 3: MAIN-world bridge — polyfill `document.modelContext` + postMessage server

**Files:**
- Create: `src/bridge/install.ts` (testable logic), replace placeholder `src/bridge/main.ts` (entry)
- Test: `tests/bridge.test.ts`

**Interfaces:**
- Consumes: `ToolRegistry`, protocol types from Task 2.
- Produces: `installBridge(win: Window, opts?: { timeoutMs?: number; channelId?: string }): { registry: ToolRegistry; channelId: string }`. After install:
  - `win.document.modelContext.registerTool(tool)` exists (returns `{ unregister() }`), plus `unregisterTool(name)` and `provideContext({ tools })` (replaces all previously provided declarative tools).
  - Bridge posts `tools-changed` on every registry change and once at install (so the relay learns `channelId`).
  - Bridge answers `list-tools` with `tools-list`, and `call-tool` with `tool-result` (60 s timeout → `ok: false`).

- [ ] **Step 1: Write the failing bridge test**

`tests/bridge.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { installBridge } from '../src/bridge/install'
import { WM_NS, type BridgeToRelay } from '../src/shared/protocol'

type AnyDoc = Document & { modelContext?: any }

function setup(opts?: { timeoutMs?: number }) {
  const win = window as unknown as Window & { document: AnyDoc }
  delete (win.document as AnyDoc).modelContext
  const received: BridgeToRelay[] = []
  const onMsg = (ev: MessageEvent) => {
    if (ev.data?.ns === WM_NS && ['tools-changed', 'tool-result', 'tools-list'].includes(ev.data.kind))
      received.push(ev.data)
  }
  win.addEventListener('message', onMsg)
  const { channelId } = installBridge(win, { channelId: 'ch-test', ...opts })
  return { win, received, channelId, cleanup: () => win.removeEventListener('message', onMsg) }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('installBridge', () => {
  it('defines document.modelContext and announces an initial empty tools-changed', async () => {
    const { win, received, channelId, cleanup } = setup()
    expect(win.document.modelContext).toBeDefined()
    await flush()
    expect(received[0]).toMatchObject({ kind: 'tools-changed', channelId, tools: [] })
    cleanup()
  })

  it('registerTool triggers tools-changed with the descriptor', async () => {
    const { win, received, cleanup } = setup()
    win.document.modelContext.registerTool({
      name: 'echo',
      description: 'echoes',
      inputSchema: { type: 'object' },
      execute: async (input: unknown) => input,
    })
    await flush()
    const last = received.at(-1)
    expect(last).toMatchObject({ kind: 'tools-changed', tools: [{ name: 'echo' }] })
    cleanup()
  })

  it('call-tool executes the tool and posts tool-result with stringified output', async () => {
    const { win, received, channelId, cleanup } = setup()
    win.document.modelContext.registerTool({
      name: 'add',
      description: 'adds',
      inputSchema: {},
      execute: async (input: any) => ({ sum: input.a + input.b }),
    })
    win.postMessage({ ns: WM_NS, channelId, kind: 'call-tool', callId: 'c1', name: 'add', input: { a: 2, b: 3 } }, '*')
    await flush(); await flush()
    const result = received.find((m) => m.kind === 'tool-result') as any
    expect(result).toMatchObject({ callId: 'c1', ok: true, result: JSON.stringify({ sum: 5 }) })
    cleanup()
  })

  it('call-tool on unknown tool or throwing execute yields ok:false', async () => {
    const { win, received, channelId, cleanup } = setup()
    win.document.modelContext.registerTool({
      name: 'boom', description: '', inputSchema: {},
      execute: async () => { throw new Error('kaput') },
    })
    win.postMessage({ ns: WM_NS, channelId, kind: 'call-tool', callId: 'c1', name: 'missing', input: {} }, '*')
    win.postMessage({ ns: WM_NS, channelId, kind: 'call-tool', callId: 'c2', name: 'boom', input: {} }, '*')
    await flush(); await flush()
    const results = received.filter((m) => m.kind === 'tool-result') as any[]
    expect(results.find((r) => r.callId === 'c1')).toMatchObject({ ok: false })
    expect(results.find((r) => r.callId === 'c2').result).toContain('kaput')
    cleanup()
  })

  it('ignores messages with a wrong channelId', async () => {
    const { win, received, cleanup } = setup()
    win.postMessage({ ns: WM_NS, channelId: 'evil', kind: 'call-tool', callId: 'x', name: 'a', input: {} }, '*')
    await flush(); await flush()
    expect(received.filter((m) => m.kind === 'tool-result')).toHaveLength(0)
    cleanup()
  })

  it('times out a hanging execute with ok:false', async () => {
    vi.useFakeTimers()
    const { win, received, channelId, cleanup } = setup({ timeoutMs: 1000 })
    win.document.modelContext.registerTool({
      name: 'hang', description: '', inputSchema: {},
      execute: () => new Promise(() => {}),
    })
    win.postMessage({ ns: WM_NS, channelId, kind: 'call-tool', callId: 'c1', name: 'hang', input: {} }, '*')
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(1001)
    vi.useRealTimers()
    await flush()
    const result = received.find((m) => m.kind === 'tool-result') as any
    expect(result).toMatchObject({ callId: 'c1', ok: false })
    expect(result.result).toContain('timed out')
    cleanup()
  })

  it('provideContext replaces previously provided declarative tools', async () => {
    const { win, received, cleanup } = setup()
    win.document.modelContext.provideContext({ tools: [
      { name: 'a', description: '', inputSchema: {}, execute: async () => 1 },
    ]})
    win.document.modelContext.provideContext({ tools: [
      { name: 'b', description: '', inputSchema: {}, execute: async () => 2 },
    ]})
    await flush()
    const last = received.at(-1) as any
    expect(last.tools.map((t: any) => t.name)).toEqual(['b'])
    cleanup()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/bridge.test.ts`
Expected: FAIL — cannot resolve `../src/bridge/install`

- [ ] **Step 3: Write `src/bridge/install.ts`**

```ts
import { WM_NS, type BridgeToRelay, type RelayToBridge } from '../shared/protocol'
import { ToolRegistry, type RegisteredTool } from './registry'

const DEFAULT_TIMEOUT_MS = 60_000

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? 'null'
  } catch {
    return String(value)
  }
}

export function installBridge(
  win: Window,
  opts: { timeoutMs?: number; channelId?: string } = {},
): { registry: ToolRegistry; channelId: string } {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const channelId = opts.channelId ?? crypto.randomUUID()
  const registry = new ToolRegistry()
  const declarative = new Set<string>()

  const post = (msg: BridgeToRelay) => win.postMessage(msg, '*')
  const announce = () => post({ ns: WM_NS, channelId, kind: 'tools-changed', tools: registry.list() })

  registry.onChange(announce)

  const modelContext = {
    registerTool(tool: RegisteredTool): { unregister: () => void } {
      const off = registry.register(tool)
      return { unregister: off }
    },
    unregisterTool(name: string): void {
      registry.unregister(name)
    },
    provideContext(ctx: { tools?: RegisteredTool[] }): void {
      for (const name of declarative) registry.unregister(name)
      declarative.clear()
      for (const tool of ctx.tools ?? []) {
        registry.register(tool)
        declarative.add(tool.name)
      }
    },
  }

  // Wrap-if-present: keep any native implementation working, but capture everything.
  const native = (win.document as any).modelContext
  if (native) {
    const nativeRegister = native.registerTool?.bind(native)
    const nativeProvide = native.provideContext?.bind(native)
    ;(win.document as any).modelContext = {
      ...native,
      registerTool(tool: RegisteredTool) {
        nativeRegister?.(tool)
        return modelContext.registerTool(tool)
      },
      unregisterTool(name: string) {
        native.unregisterTool?.(name)
        modelContext.unregisterTool(name)
      },
      provideContext(ctx: { tools?: RegisteredTool[] }) {
        nativeProvide?.(ctx)
        modelContext.provideContext(ctx)
      },
    }
  } else {
    ;(win.document as any).modelContext = modelContext
  }

  async function callTool(callId: string, name: string, input: unknown): Promise<void> {
    const tool = registry.get(name)
    if (!tool) {
      post({ ns: WM_NS, channelId, kind: 'tool-result', callId, ok: false, result: `Unknown tool: ${name}` })
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        Promise.resolve(tool.execute(input)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeoutMs} ms`)), timeoutMs)
        }),
      ])
      post({ ns: WM_NS, channelId, kind: 'tool-result', callId, ok: true, result: stringify(result) })
    } catch (err) {
      post({ ns: WM_NS, channelId, kind: 'tool-result', callId, ok: false, result: String(err instanceof Error ? err.message : err) })
    } finally {
      clearTimeout(timer)
    }
  }

  win.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as RelayToBridge
    if (ev.source !== win || !msg || msg.ns !== WM_NS || msg.channelId !== channelId) return
    if (msg.kind === 'list-tools') {
      post({ ns: WM_NS, channelId, kind: 'tools-list', requestId: msg.requestId, tools: registry.list() })
    } else if (msg.kind === 'call-tool') {
      void callTool(msg.callId, msg.name, msg.input)
    }
  })

  announce()
  return { registry, channelId }
}
```

- [ ] **Step 4: Replace `src/bridge/main.ts` placeholder**

```ts
import { installBridge } from './install'

installBridge(window)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/bridge.test.ts`
Expected: 7 passed

- [ ] **Step 6: Typecheck + build + commit**

Run: `pnpm typecheck && pnpm build`
Expected: both exit 0

```bash
git add src/bridge tests/bridge.test.ts
git commit -m "feat: MAIN-world bridge polyfilling document.modelContext"
```

---

### Task 4: Isolated relay content script

**Files:**
- Create: `src/content/relay-core.ts` (testable), replace placeholder `src/content/relay.ts` (entry)
- Test: `tests/relay.test.ts`

**Interfaces:**
- Consumes: protocol types; bridge message behavior from Task 3.
- Produces: `installRelay(win: Window, runtime: RelayRuntime): void` where

  ```ts
  export type RelayRuntime = {
    sendMessage: (msg: unknown) => void // fire-and-forget event to the extension
    onMessage: (
      handler: (msg: unknown, sendResponse: (res: unknown) => void) => boolean | void,
    ) => void
  }
  ```

  Behavior later tasks rely on: `chrome.tabs.sendMessage(tabId, { kind: 'wm:list-tools' })` resolves to `ToolDescriptor[]`; `{ kind: 'wm:call-tool', name, input }` resolves to `CallToolResponse`; relay broadcasts `{ kind: 'wm:tools-changed', tools }` via `runtime.sendMessage` whenever the bridge announces.

- [ ] **Step 1: Write the failing relay test**

`tests/relay.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installRelay, type RelayRuntime } from '../src/content/relay-core'
import { installBridge } from '../src/bridge/install'
import { WM_NS } from '../src/shared/protocol'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('installRelay (wired to a real bridge over window.postMessage)', () => {
  let handler: (msg: unknown, sendResponse: (res: unknown) => void) => boolean | void
  let events: unknown[]
  let runtime: RelayRuntime

  beforeEach(() => {
    delete (window.document as any).modelContext
    events = []
    runtime = {
      sendMessage: (m) => events.push(m),
      onMessage: (h) => { handler = h },
    }
    installRelay(window, runtime)
    installBridge(window, { channelId: 'ch-test' })
  })

  it('forwards tools-changed announcements as wm:tools-changed events', async () => {
    ;(window.document as any).modelContext.registerTool({
      name: 'echo', description: '', inputSchema: {}, execute: async () => 'hi',
    })
    await flush()
    expect(events.at(-1)).toMatchObject({ kind: 'wm:tools-changed', tools: [{ name: 'echo' }] })
  })

  it('answers wm:list-tools with the current descriptors', async () => {
    ;(window.document as any).modelContext.registerTool({
      name: 'echo', description: 'd', inputSchema: {}, execute: async () => 'hi',
    })
    await flush()
    const response = await new Promise((resolve) => {
      handler({ kind: 'wm:list-tools' }, resolve)
    })
    expect(response).toEqual([{ name: 'echo', description: 'd', inputSchema: {} }])
  })

  it('answers wm:call-tool with the tool result', async () => {
    ;(window.document as any).modelContext.registerTool({
      name: 'add', description: '', inputSchema: {}, execute: async (i: any) => i.a + i.b,
    })
    await flush()
    const response = await new Promise((resolve) => {
      handler({ kind: 'wm:call-tool', name: 'add', input: { a: 1, b: 2 } }, resolve)
    })
    expect(response).toEqual({ ok: true, result: '3' })
  })

  it('ignores unrelated runtime messages', () => {
    const sendResponse = vi.fn()
    const ret = handler({ kind: 'something-else' }, sendResponse)
    expect(ret).not.toBe(true)
    expect(sendResponse).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/relay.test.ts`
Expected: FAIL — cannot resolve `../src/content/relay-core`

- [ ] **Step 3: Write `src/content/relay-core.ts`**

```ts
import {
  WM_NS,
  type BridgeToRelay,
  type CallToolResponse,
  type RelayToBridge,
  type ToolDescriptor,
} from '../shared/protocol'

export type RelayRuntime = {
  sendMessage: (msg: unknown) => void
  onMessage: (
    handler: (msg: unknown, sendResponse: (res: unknown) => void) => boolean | void,
  ) => void
}

export function installRelay(win: Window, runtime: RelayRuntime): void {
  let channelId: string | null = null
  let lastTools: ToolDescriptor[] = []
  const pendingCalls = new Map<string, (res: CallToolResponse) => void>()
  const pendingLists = new Map<string, (tools: ToolDescriptor[]) => void>()
  let seq = 0
  const nextId = () => `r${++seq}`

  const post = (msg: RelayToBridge) => win.postMessage(msg, '*')

  win.addEventListener('message', (ev: MessageEvent) => {
    const msg = ev.data as BridgeToRelay
    if (ev.source !== win || !msg || msg.ns !== WM_NS) return
    if (msg.kind === 'tools-changed') {
      channelId = msg.channelId
      lastTools = msg.tools
      runtime.sendMessage({ kind: 'wm:tools-changed', tools: msg.tools })
    } else if (msg.kind === 'tools-list') {
      pendingLists.get(msg.requestId)?.(msg.tools)
      pendingLists.delete(msg.requestId)
    } else if (msg.kind === 'tool-result') {
      pendingCalls.get(msg.callId)?.({ ok: msg.ok, result: msg.result })
      pendingCalls.delete(msg.callId)
    }
  })

  runtime.onMessage((raw, sendResponse) => {
    const msg = raw as { kind?: string; name?: string; input?: unknown }
    if (msg?.kind === 'wm:list-tools') {
      if (!channelId) {
        sendResponse(lastTools)
        return true
      }
      const requestId = nextId()
      pendingLists.set(requestId, sendResponse)
      post({ ns: WM_NS, channelId, kind: 'list-tools', requestId })
      return true
    }
    if (msg?.kind === 'wm:call-tool') {
      if (!channelId) {
        sendResponse({ ok: false, result: 'No WebMCP bridge on this page' })
        return true
      }
      const callId = nextId()
      pendingCalls.set(callId, sendResponse)
      post({ ns: WM_NS, channelId, kind: 'call-tool', callId, name: msg.name!, input: msg.input })
      return true
    }
  })
}
```

- [ ] **Step 4: Replace `src/content/relay.ts` placeholder**

```ts
import { installRelay } from './relay-core'

installRelay(window, {
  sendMessage: (msg) => {
    chrome.runtime.sendMessage(msg).catch(() => {
      /* no listener (panel closed) — fine */
    })
  },
  onMessage: (handler) => {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      return handler(msg, sendResponse) === true
    })
  },
})
```

- [ ] **Step 5: Run tests, typecheck, build**

Run: `pnpm vitest run tests/relay.test.ts && pnpm typecheck && pnpm build`
Expected: 4 passed; typecheck and build exit 0

- [ ] **Step 6: Commit**

```bash
git add src/content tests/relay.test.ts
git commit -m "feat: isolated relay between page bridge and extension runtime"
```

---

### Task 5: Anthropic Messages API client

**Files:**
- Create: `src/panel/claude.ts`
- Test: `tests/claude.test.ts`

**Interfaces:**
- Consumes: nothing internal.
- Produces:

  ```ts
  export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> }
  export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  export type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] }
  export type ClaudeResponse = { content: ContentBlock[]; stop_reason: string }
  export interface ClaudeClient {
    createMessage(params: {
      model: string; system?: string; messages: Message[]; tools?: ToolDef[]; max_tokens?: number
    }): Promise<ClaudeResponse>
  }
  export class ClaudeApiError extends Error { constructor(public status: number, message: string) }
  export function makeClaudeClient(apiKey: string, fetchFn?: typeof fetch): ClaudeClient
  ```

- [ ] **Step 1: Write the failing client test**

`tests/claude.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ClaudeApiError, makeClaudeClient } from '../src/panel/claude'

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('makeClaudeClient', () => {
  it('POSTs to the Messages API with browser-access headers', async () => {
    const fetchFn = vi.fn(async () => okResponse({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }))
    const client = makeClaudeClient('sk-test', fetchFn as unknown as typeof fetch)
    const res = await client.createMessage({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'ciao' }] })
    expect(res.content[0]).toEqual({ type: 'text', text: 'hi' })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    const body = JSON.parse(init.body as string)
    expect(body.max_tokens).toBe(4096)
  })

  it('throws ClaudeApiError with the API error message on non-2xx', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }))
    const client = makeClaudeClient('bad', fetchFn as unknown as typeof fetch)
    await expect(client.createMessage({ model: 'm', messages: [] })).rejects.toThrowError(ClaudeApiError)
    await expect(client.createMessage({ model: 'm', messages: [] })).rejects.toThrow('invalid x-api-key')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/claude.test.ts`
Expected: FAIL — cannot resolve `../src/panel/claude`

- [ ] **Step 3: Write `src/panel/claude.ts`**

```ts
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> }

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] }

export type ClaudeResponse = { content: ContentBlock[]; stop_reason: string }

export interface ClaudeClient {
  createMessage(params: {
    model: string
    system?: string
    messages: Message[]
    tools?: ToolDef[]
    max_tokens?: number
  }): Promise<ClaudeResponse>
}

export class ClaudeApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ClaudeApiError'
  }
}

export function makeClaudeClient(apiKey: string, fetchFn: typeof fetch = fetch): ClaudeClient {
  return {
    async createMessage({ model, system, messages, tools, max_tokens = 4096 }) {
      const res = await fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model, system, messages, tools, max_tokens }),
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          detail = body?.error?.message ?? detail
        } catch { /* keep generic detail */ }
        throw new ClaudeApiError(res.status, detail)
      }
      return (await res.json()) as ClaudeResponse
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/claude.test.ts`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add src/panel/claude.ts tests/claude.test.ts
git commit -m "feat: browser-direct Anthropic Messages API client"
```

---

### Task 6: Agent loop

**Files:**
- Create: `src/panel/agent.ts`
- Test: `tests/agent.test.ts`

**Interfaces:**
- Consumes: `ClaudeClient`, `Message`, `ContentBlock`, `ToolDef` from Task 5; `CallToolResponse` shape from Task 2.
- Produces:

  ```ts
  export const MAX_ITERATIONS = 20
  export type CallTool = (name: string, input: unknown) => Promise<{ ok: boolean; result: string }>
  export type AgentEvent =
    | { type: 'tool-call'; name: string; input: unknown }
    | { type: 'tool-result'; name: string; ok: boolean; result: string }
  export function runAgentTurn(opts: {
    client: ClaudeClient
    model: string
    system: string
    messages: Message[]          // full history INCLUDING the new user message; mutated in place
    tools: ToolDef[]
    callTool: CallTool
    onEvent?: (ev: AgentEvent) => void
  }): Promise<string>            // final assistant text
  ```

- [ ] **Step 1: Write the failing agent test**

`tests/agent.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { MAX_ITERATIONS, runAgentTurn } from '../src/panel/agent'
import type { ClaudeClient, ClaudeResponse, Message } from '../src/panel/claude'

function scriptedClient(responses: ClaudeResponse[]): ClaudeClient & { calls: Message[][] } {
  const calls: Message[][] = []
  let i = 0
  return {
    calls,
    async createMessage({ messages }) {
      calls.push(JSON.parse(JSON.stringify(messages)))
      return responses[Math.min(i++, responses.length - 1)]
    },
  }
}

const textResponse = (text: string): ClaudeResponse => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
})

const toolUseResponse = (name: string, input: unknown): ClaudeResponse => ({
  content: [{ type: 'tool_use', id: `tu_${name}`, name, input }],
  stop_reason: 'tool_use',
})

const base = (client: ClaudeClient) => ({
  client,
  model: 'test-model',
  system: 'sys',
  tools: [],
  messages: [{ role: 'user', content: 'do it' } as Message],
})

describe('runAgentTurn', () => {
  it('returns text directly when no tool is used', async () => {
    const client = scriptedClient([textResponse('done')])
    const text = await runAgentTurn({ ...base(client), callTool: vi.fn() })
    expect(text).toBe('done')
  })

  it('executes a tool_use and feeds tool_result back', async () => {
    const client = scriptedClient([toolUseResponse('list_segments', {}), textResponse('found XYZ')])
    const callTool = vi.fn(async () => ({ ok: true, result: '[{"name":"XYZ"}]' }))
    const events: unknown[] = []
    const text = await runAgentTurn({ ...base(client), callTool, onEvent: (e) => events.push(e) })
    expect(text).toBe('found XYZ')
    expect(callTool).toHaveBeenCalledWith('list_segments', {})
    const secondCall = client.calls[1]
    const toolResultMsg = secondCall.at(-1) as { role: string; content: any[] }
    expect(toolResultMsg.role).toBe('user')
    expect(toolResultMsg.content[0]).toMatchObject({
      type: 'tool_result', tool_use_id: 'tu_list_segments', content: '[{"name":"XYZ"}]',
    })
    expect(events).toHaveLength(2)
  })

  it('marks failed tool calls with is_error', async () => {
    const client = scriptedClient([toolUseResponse('boom', {}), textResponse('it failed')])
    const callTool = vi.fn(async () => ({ ok: false, result: 'The user did not approve this action.' }))
    await runAgentTurn({ ...base(client), callTool })
    const toolResultMsg = client.calls[1].at(-1) as { content: any[] }
    expect(toolResultMsg.content[0]).toMatchObject({ is_error: true })
  })

  it('stops after MAX_ITERATIONS tool rounds', async () => {
    const client = scriptedClient([toolUseResponse('loop', {})])
    const callTool = vi.fn(async () => ({ ok: true, result: 'again' }))
    const text = await runAgentTurn({ ...base(client), callTool })
    expect(callTool).toHaveBeenCalledTimes(MAX_ITERATIONS)
    expect(text).toContain('iteration limit')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/agent.test.ts`
Expected: FAIL — cannot resolve `../src/panel/agent`

- [ ] **Step 3: Write `src/panel/agent.ts`**

```ts
import type { ClaudeClient, ContentBlock, Message, ToolDef } from './claude'

export const MAX_ITERATIONS = 20

export type CallTool = (name: string, input: unknown) => Promise<{ ok: boolean; result: string }>

export type AgentEvent =
  | { type: 'tool-call'; name: string; input: unknown }
  | { type: 'tool-result'; name: string; ok: boolean; result: string }

export async function runAgentTurn(opts: {
  client: ClaudeClient
  model: string
  system: string
  messages: Message[]
  tools: ToolDef[]
  callTool: CallTool
  onEvent?: (ev: AgentEvent) => void
}): Promise<string> {
  const { client, model, system, messages, tools, callTool, onEvent } = opts

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await client.createMessage({ model, system, messages, tools })
    messages.push({ role: 'assistant', content: res.content })

    const toolUses = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
    if (toolUses.length === 0 || res.stop_reason !== 'tool_use') {
      return res.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
    }

    const results: ContentBlock[] = []
    for (const tu of toolUses) {
      onEvent?.({ type: 'tool-call', name: tu.name, input: tu.input })
      const outcome = await callTool(tu.name, tu.input)
      onEvent?.({ type: 'tool-result', name: tu.name, ...outcome })
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: outcome.result,
        ...(outcome.ok ? {} : { is_error: true }),
      })
    }
    messages.push({ role: 'user', content: results })
  }

  const notice = `Stopped: reached the ${MAX_ITERATIONS}-tool iteration limit for one turn.`
  messages.push({ role: 'assistant', content: notice })
  return notice
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/agent.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/panel/agent.ts tests/agent.test.ts
git commit -m "feat: capped agent loop with tool_use/tool_result cycle"
```

---

### Task 7: Settings module + Options page

**Files:**
- Create: `src/shared/settings.ts`, replace placeholder `src/options/main.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `public/options.html` element ids from Task 1 (`#settings`, `#apiKey`, `#model`, `#status`).
- Produces:

  ```ts
  export const DEFAULT_MODEL = 'claude-sonnet-4-6'
  export type Settings = { apiKey: string; model: string }
  export type KVStore = {
    get(keys: string[]): Promise<Record<string, unknown>>
    set(items: Record<string, unknown>): Promise<void>
  }
  export function chromeStore(): KVStore            // wraps chrome.storage.local
  export function loadSettings(store?: KVStore): Promise<Settings>
  export function saveSettings(patch: Partial<Settings>, store?: KVStore): Promise<void>
  ```

- [ ] **Step 1: Write the failing settings test**

`tests/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL, loadSettings, saveSettings, type KVStore } from '../src/shared/settings'

function memoryStore(): KVStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    data,
    async get(keys) {
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))
    },
    async set(items) {
      Object.assign(data, items)
    },
  }
}

describe('settings', () => {
  it('defaults: empty apiKey, claude-sonnet-4-6 model', async () => {
    const s = await loadSettings(memoryStore())
    expect(s).toEqual({ apiKey: '', model: DEFAULT_MODEL })
    expect(DEFAULT_MODEL).toBe('claude-sonnet-4-6')
  })

  it('round-trips saved values and merges partial saves', async () => {
    const store = memoryStore()
    await saveSettings({ apiKey: 'sk-1' }, store)
    await saveSettings({ model: 'claude-opus-4-8' }, store)
    expect(await loadSettings(store)).toEqual({ apiKey: 'sk-1', model: 'claude-opus-4-8' })
  })

  it('treats a blank saved model as the default', async () => {
    const store = memoryStore()
    await saveSettings({ model: '  ' }, store)
    expect((await loadSettings(store)).model).toBe(DEFAULT_MODEL)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/settings.test.ts`
Expected: FAIL — cannot resolve `../src/shared/settings`

- [ ] **Step 3: Write `src/shared/settings.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/settings.test.ts`
Expected: 3 passed

- [ ] **Step 5: Replace `src/options/main.ts` placeholder**

```ts
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
```

- [ ] **Step 6: Typecheck, build, commit**

Run: `pnpm typecheck && pnpm build`
Expected: exit 0

```bash
git add src/shared/settings.ts src/options/main.ts tests/settings.test.ts
git commit -m "feat: settings storage and options page"
```

---

### Task 8: Side panel — chat UI wired to agent loop and active tab

**Files:**
- Create: `src/panel/tab-tools.ts` (chrome-tab helpers), replace placeholder `src/panel/main.ts`, replace `public/panel.css`
- Test: `tests/tab-tools.test.ts`

**Interfaces:**
- Consumes: `runAgentTurn`/`AgentEvent` (Task 6), `makeClaudeClient`/`ClaudeApiError`/`Message`/`ToolDef` (Task 5), `loadSettings` (Task 7), `ToolDescriptor`/`CallToolResponse`/`RuntimeRequest` (Task 2), relay behavior (Task 4).
- Produces (used only within this task, but split for testability):

  ```ts
  export type TabMessenger = (tabId: number, msg: unknown) => Promise<unknown>
  export function toToolDefs(tools: ToolDescriptor[]): ToolDef[]   // inputSchema -> input_schema; {} schema becomes {type:'object'}
  export function makeCallTool(tabId: number, send: TabMessenger): CallTool
  export function listTabTools(tabId: number, send: TabMessenger): Promise<ToolDescriptor[]>
  ```

- [ ] **Step 1: Write the failing helper test**

`tests/tab-tools.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { listTabTools, makeCallTool, toToolDefs } from '../src/panel/tab-tools'

describe('toToolDefs', () => {
  it('maps inputSchema to input_schema and defaults empty schemas to object', () => {
    expect(toToolDefs([
      { name: 'a', description: 'd', inputSchema: { type: 'object', properties: {} } },
      { name: 'b', description: '', inputSchema: {} },
    ])).toEqual([
      { name: 'a', description: 'd', input_schema: { type: 'object', properties: {} } },
      { name: 'b', description: '', input_schema: { type: 'object' } },
    ])
  })
})

describe('tab messaging helpers', () => {
  it('listTabTools sends wm:list-tools and returns [] when the tab has no relay', async () => {
    const send = vi.fn(async () => { throw new Error('no receiver') })
    expect(await listTabTools(7, send)).toEqual([])
    expect(send).toHaveBeenCalledWith(7, { kind: 'wm:list-tools' })
  })

  it('makeCallTool sends wm:call-tool and passes through the response', async () => {
    const send = vi.fn(async () => ({ ok: true, result: '42' }))
    const call = makeCallTool(7, send)
    expect(await call('answer', { q: 'life' })).toEqual({ ok: true, result: '42' })
    expect(send).toHaveBeenCalledWith(7, { kind: 'wm:call-tool', name: 'answer', input: { q: 'life' } })
  })

  it('makeCallTool maps a messaging failure to ok:false', async () => {
    const send = vi.fn(async () => { throw new Error('tab gone') })
    const call = makeCallTool(7, send)
    expect(await call('x', {})).toEqual({ ok: false, result: 'tab gone' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/tab-tools.test.ts`
Expected: FAIL — cannot resolve `../src/panel/tab-tools`

- [ ] **Step 3: Write `src/panel/tab-tools.ts`**

```ts
import type { CallTool } from './agent'
import type { ToolDef } from './claude'
import type { CallToolResponse, ToolDescriptor } from '../shared/protocol'

export type TabMessenger = (tabId: number, msg: unknown) => Promise<unknown>

export function toToolDefs(tools: ToolDescriptor[]): ToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: Object.keys(t.inputSchema).length > 0 ? t.inputSchema : { type: 'object' },
  }))
}

export async function listTabTools(tabId: number, send: TabMessenger): Promise<ToolDescriptor[]> {
  try {
    return ((await send(tabId, { kind: 'wm:list-tools' })) as ToolDescriptor[]) ?? []
  } catch {
    return [] // no relay in the tab (chrome:// pages, panel opened before load, …)
  }
}

export function makeCallTool(tabId: number, send: TabMessenger): CallTool {
  return async (name, input) => {
    try {
      return (await send(tabId, { kind: 'wm:call-tool', name, input })) as CallToolResponse
    } catch (err) {
      return { ok: false, result: err instanceof Error ? err.message : String(err) }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/tab-tools.test.ts`
Expected: 4 passed

- [ ] **Step 5: Replace `src/panel/main.ts` placeholder (UI wiring — verified by build + manual test)**

```ts
import { runAgentTurn, type AgentEvent } from './agent'
import { ClaudeApiError, makeClaudeClient, type Message } from './claude'
import { listTabTools, makeCallTool, toToolDefs } from './tab-tools'
import { loadSettings } from '../shared/settings'
import type { ToolDescriptor } from '../shared/protocol'

const SYSTEM_PROMPT =
  'You are an assistant operating on the current web page through the tools it exposes. ' +
  'Use the tools to look up real data instead of guessing names or ids. ' +
  'Some actions require the user to confirm inside the page; if a tool reports the user did not approve, stop and say so. ' +
  'Answer in the language of the user prompt.'

const app = document.getElementById('app')!
app.innerHTML = `
  <div id="banner" hidden></div>
  <div id="toolcount">Loading tools…</div>
  <div id="chat"></div>
  <form id="composer">
    <textarea id="prompt" rows="3" placeholder="Ask something about this page…"></textarea>
    <button id="send" type="submit">Send</button>
  </form>
`
const banner = document.getElementById('banner')!
const toolcount = document.getElementById('toolcount')!
const chat = document.getElementById('chat')!
const promptEl = document.getElementById('prompt') as HTMLTextAreaElement
const sendBtn = document.getElementById('send') as HTMLButtonElement

const messages: Message[] = []
let currentTools: ToolDescriptor[] = []
let busy = false

function line(cls: string, text: string) {
  const div = document.createElement('div')
  div.className = `line ${cls}`
  div.textContent = text
  chat.appendChild(div)
  chat.scrollTop = chat.scrollHeight
}

function renderToolCount() {
  toolcount.textContent = currentTools.length
    ? `${currentTools.length} tools available on this page`
    : 'This page exposes no WebMCP tools.'
}

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

const sendToTab = (tabId: number, msg: unknown) => chrome.tabs.sendMessage(tabId, msg)

async function refreshTools() {
  const tabId = await activeTabId()
  currentTools = tabId === null ? [] : await listTabTools(tabId, sendToTab)
  renderToolCount()
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === 'wm:tools-changed') {
    void refreshTools()
    if (!busy && messages.length > 0) line('notice', 'Tools on this page changed.')
  }
})
chrome.tabs.onActivated.addListener(() => {
  messages.length = 0
  chat.innerHTML = ''
  void refreshTools()
})

document.getElementById('composer')!.addEventListener('submit', async (ev) => {
  ev.preventDefault()
  if (busy) return
  const prompt = promptEl.value.trim()
  if (!prompt) return

  const settings = await loadSettings()
  if (!settings.apiKey) {
    banner.hidden = false
    banner.innerHTML = 'Missing API key — <a href="#" id="openOptions">open Options</a>.'
    document.getElementById('openOptions')!.addEventListener('click', () => chrome.runtime.openOptionsPage())
    return
  }
  banner.hidden = true

  const tabId = await activeTabId()
  if (tabId === null) return
  await refreshTools()

  busy = true
  sendBtn.disabled = true
  promptEl.value = ''
  line('user', prompt)
  messages.push({ role: 'user', content: prompt })

  const onEvent = (e: AgentEvent) => {
    if (e.type === 'tool-call') line('tool', `→ ${e.name}(${JSON.stringify(e.input)})`)
    else line('tool', `← ${e.name}: ${e.ok ? 'ok' : 'error'} ${e.result.slice(0, 200)}`)
  }

  try {
    const text = await runAgentTurn({
      client: makeClaudeClient(settings.apiKey),
      model: settings.model,
      system: SYSTEM_PROMPT,
      messages,
      tools: toToolDefs(currentTools),
      callTool: makeCallTool(tabId, sendToTab),
      onEvent,
    })
    line('assistant', text)
  } catch (err) {
    if (err instanceof ClaudeApiError && err.status === 401) {
      banner.hidden = false
      banner.textContent = 'Invalid API key — check Options.'
    }
    line('error', err instanceof Error ? err.message : String(err))
  } finally {
    busy = false
    sendBtn.disabled = false
  }
})

void refreshTools()
```

- [ ] **Step 6: Replace `public/panel.css`**

```css
:root { font-family: system-ui, sans-serif; font-size: 14px; }
body { margin: 0; }
#app { display: flex; flex-direction: column; height: 100vh; }
#banner { background: #fde8e8; color: #9b1c1c; padding: 8px 12px; }
#toolcount { color: #666; padding: 6px 12px; border-bottom: 1px solid #eee; }
#chat { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.line { white-space: pre-wrap; word-break: break-word; padding: 8px 10px; border-radius: 8px; }
.line.user { background: #eef2ff; align-self: flex-end; max-width: 90%; }
.line.assistant { background: #f3f4f6; }
.line.tool { color: #666; font-family: ui-monospace, monospace; font-size: 12px; padding: 2px 10px; }
.line.error { background: #fde8e8; color: #9b1c1c; }
.line.notice { color: #92600a; font-size: 12px; }
#composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #eee; }
#prompt { flex: 1; resize: none; }
```

- [ ] **Step 7: Run everything, build, commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm build`
Expected: all suites pass, build exit 0

```bash
git add src/panel public/panel.css tests/tab-tools.test.ts
git commit -m "feat: side panel chat wired to agent loop and active tab tools"
```

---

### Task 9: Demo page, README, manual e2e

**Files:**
- Create: `demo/index.html`, `README.md`

**Interfaces:**
- Consumes: the built extension (Tasks 1–8).
- Produces: a self-contained manual verification path proving the client is site-agnostic.

- [ ] **Step 1: Write `demo/index.html`**

A static page registering fake tools on `document.modelContext` — the bridge polyfill provides the API, the page just uses it (guarded for when the extension isn't installed):

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>WebMCP Agent demo</title></head>
  <body>
    <h1>WebMCP Agent demo page</h1>
    <p>Status: <span id="status">checking…</span></p>
    <ul id="log"></ul>
    <script>
      const log = (t) => {
        const li = document.createElement('li')
        li.textContent = t
        document.getElementById('log').appendChild(li)
      }
      const notes = []
      if (!document.modelContext) {
        document.getElementById('status').textContent =
          'document.modelContext missing — is the WebMCP Agent extension installed and enabled?'
      } else {
        document.modelContext.registerTool({
          name: 'get_time',
          description: 'Returns the current time as an ISO string',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => new Date().toISOString(),
        })
        document.modelContext.registerTool({
          name: 'add_note',
          description: 'Appends a note to the page and to an in-memory list',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string', description: 'The note text' } },
            required: ['text'],
          },
          execute: async ({ text }) => { notes.push(text); log(text); return `Added. ${notes.length} notes total.` },
        })
        document.modelContext.registerTool({
          name: 'list_notes',
          description: 'Lists all notes added so far',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => JSON.stringify(notes),
        })
        document.getElementById('status').textContent = '3 tools registered'
      }
    </script>
  </body>
</html>
```

- [ ] **Step 2: Write `README.md`**

```markdown
# WebMCP Agent

Chrome extension: a side-panel chat where Claude executes your prompt using the
[WebMCP](https://webmachinelearning.github.io/webmcp/) tools the current page
registers on `document.modelContext`. Works on stable Chrome — a MAIN-world
content script polyfills `document.modelContext`, so no origin-trial flag is
needed.

Internal/demo tool. Claude API only. Design doc:
`docs/specs/2026-09-09-webmcp-agent-extension-design.md`.

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
```

- [ ] **Step 3: Serve the demo and run the manual checklist**

Run: `pnpm build && python3 -m http.server 8123 -d demo` then load the extension and open `http://localhost:8123`.
Expected: demo-page checklist items pass. (Procmail-dashboard items require a running dashboard — check them when available; they are not a gate for this task's commit.)

- [ ] **Step 4: Full suite one last time**

Run: `pnpm vitest run && pnpm typecheck && pnpm build`
Expected: all green

- [ ] **Step 5: Commit**

```bash
git add demo README.md
git commit -m "docs: demo page and README with manual e2e checklist"
```

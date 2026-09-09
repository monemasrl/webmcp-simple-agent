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

const LISTENER_KEY = Symbol.for('webmcp-bridge-listener')

export function installBridge(
  win: Window,
  opts: { timeoutMs?: number; channelId?: string } = {},
): { registry: ToolRegistry; channelId: string } {
  const prev = (win as any)[LISTENER_KEY] as EventListener | undefined
  if (prev) win.removeEventListener('message', prev)

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
  // Use Object.defineProperty to shadow a read-only prototype getter if present.
  const native = (win.document as any).modelContext
  const value = native
    ? {
        ...native,
        registerTool(tool: RegisteredTool) {
          native.registerTool?.call(native, tool)
          return modelContext.registerTool(tool)
        },
        unregisterTool(name: string) {
          native.unregisterTool?.call(native, name)
          modelContext.unregisterTool(name)
        },
        provideContext(ctx: { tools?: RegisteredTool[] }) {
          native.provideContext?.call(native, ctx)
          modelContext.provideContext(ctx)
        },
      }
    : modelContext
  try {
    ;(win.document as any).modelContext = value
  } catch {
    // In Chrome, document.modelContext is a read-only getter on the prototype;
    // shadow it with an own property instead.
    Object.defineProperty(win.document, 'modelContext', {
      value,
      writable: true,
      configurable: true,
    })
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

  const listener = (ev: MessageEvent) => {
    const msg = ev.data as RelayToBridge
    if (!msg || msg.ns !== WM_NS) return
    // `hello` is a discovery ping: a relay/widget that missed the initial
    // announce (e.g. injected after tools already registered) asks us to
    // re-announce. It carries no channelId — answer it before the id check.
    if (msg.kind === 'hello') {
      announce()
      return
    }
    if (msg.channelId !== channelId) return
    if (msg.kind === 'list-tools') {
      post({ ns: WM_NS, channelId, kind: 'tools-list', requestId: msg.requestId, tools: registry.list() })
    } else if (msg.kind === 'call-tool') {
      void callTool(msg.callId, msg.name, msg.input)
    }
  }
  ;(win as any)[LISTENER_KEY] = listener
  win.addEventListener('message', listener)

  announce()
  return { registry, channelId }
}

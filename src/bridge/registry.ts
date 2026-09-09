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

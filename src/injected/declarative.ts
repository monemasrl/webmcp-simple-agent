import type { ToolDescriptor } from '../shared/protocol'

/**
 * Declarative WebMCP tools: `<form toolname="…" tooldescription="…" [toolautosubmit]>`
 * with named controls carrying `toolparamdescription`. Chrome's native WebMCP
 * origin trial exposes these to its own agent; we replicate detection here so
 * the widget can surface and drive them by filling + submitting the form.
 */

export type DeclarativeTool = {
  descriptor: ToolDescriptor
  execute: (input: Record<string, unknown>) => string
}

type Control = {
  name: string
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  required: boolean
  schema: Record<string, unknown>
}

function controlSchema(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): Record<string, unknown> {
  const description = el.getAttribute('toolparamdescription')?.trim() ?? ''
  const base: Record<string, unknown> = description ? { description } : {}

  if (el.tagName === 'SELECT') {
    const options = Array.from((el as HTMLSelectElement).options)
      .map((o) => o.value)
      .filter((v) => v !== '')
    return { type: 'string', ...(options.length ? { enum: options } : {}), ...base }
  }
  const type = (el as HTMLInputElement).type
  if (type === 'number' || type === 'range') return { type: 'number', ...base }
  if (type === 'checkbox') return { type: 'boolean', ...base }
  return { type: 'string', ...base }
}

function collectControls(container: Element): Control[] {
  const nodes = container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input[name], select[name], textarea[name]',
  )
  const controls: Control[] = []
  nodes.forEach((el) => {
    const name = el.getAttribute('name')?.trim()
    if (!name) return
    if (el instanceof HTMLInputElement && (el.type === 'submit' || el.type === 'button' || el.type === 'hidden')) return
    controls.push({ name, el, required: el.hasAttribute('required'), schema: controlSchema(el) })
  })
  return controls
}

function setControlValue(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: unknown,
): void {
  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    el.checked = Boolean(value)
  } else {
    el.value = String(value ?? '')
  }
  // Let frameworks (Angular/React) observe the change.
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

function fillAndSubmit(
  container: Element,
  controls: Control[],
  input: Record<string, unknown>,
  autosubmit: boolean,
): string {
  const name = container.getAttribute('toolname') ?? 'tool'
  const applied: string[] = []
  for (const c of controls) {
    if (input && Object.prototype.hasOwnProperty.call(input, c.name)) {
      setControlValue(c.el, input[c.name])
      applied.push(c.name)
    }
  }

  const isForm = container instanceof HTMLFormElement
  if (autosubmit && isForm) {
    try {
      if (typeof (container as HTMLFormElement).requestSubmit === 'function') {
        ;(container as HTMLFormElement).requestSubmit()
      } else {
        ;(container as HTMLFormElement).submit()
      }
      return `Filled and submitted "${name}" with: ${applied.join(', ') || '(no fields)'}. The page is navigating to show the result.`
    } catch (err) {
      return `Filled "${name}" but could not submit: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  return `Filled "${name}" with: ${applied.join(', ') || '(no fields)'}. Ask the user to submit the form to continue.`
}

export function scanDeclarativeTools(root: ParentNode): DeclarativeTool[] {
  const elements = root.querySelectorAll('[toolname]')
  const tools: DeclarativeTool[] = []
  const seen = new Set<string>()

  elements.forEach((el) => {
    const name = el.getAttribute('toolname')?.trim()
    if (!name || seen.has(name)) return
    seen.add(name)

    const description = el.getAttribute('tooldescription')?.trim() ?? ''
    const autosubmit = el.hasAttribute('toolautosubmit')
    const controls = collectControls(el)

    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const c of controls) {
      properties[c.name] = c.schema
      if (c.required) required.push(c.name)
    }

    const descriptor: ToolDescriptor = {
      name,
      description,
      inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) },
    }

    tools.push({
      descriptor,
      execute: (input) => fillAndSubmit(el, controls, input ?? {}, autosubmit),
    })
  })

  return tools
}

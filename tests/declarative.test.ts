import { describe, expect, it, beforeEach } from 'vitest'
import { scanDeclarativeTools } from '../src/injected/declarative'

function mount(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('scanDeclarativeTools', () => {
  it('builds a descriptor from a toolname form with a select', () => {
    const root = mount(`
      <form toolname="get_order_status" tooldescription="Search orders" toolautosubmit>
        <select name="timeframe" required toolparamdescription="Timeframe for lookup">
          <option value="today">Today</option>
          <option value="last_7_days">Last 7 Days</option>
        </select>
      </form>
    `)
    const tools = scanDeclarativeTools(root)
    expect(tools).toHaveLength(1)
    expect(tools[0].descriptor).toMatchObject({
      name: 'get_order_status',
      description: 'Search orders',
      inputSchema: {
        type: 'object',
        properties: {
          timeframe: { type: 'string', enum: ['today', 'last_7_days'], description: 'Timeframe for lookup' },
        },
        required: ['timeframe'],
      },
    })
  })

  it('fills control values on execute', () => {
    const root = mount(`
      <form toolname="search" tooldescription="d">
        <input name="q" toolparamdescription="query" />
      </form>
    `)
    const [tool] = scanDeclarativeTools(root)
    const result = tool.execute({ q: 'hello' })
    const input = root.querySelector('input[name="q"]') as HTMLInputElement
    expect(input.value).toBe('hello')
    // Not autosubmit → asks the user to submit
    expect(result).toContain('Ask the user to submit')
  })

  it('marks number inputs and skips submit/hidden controls', () => {
    const root = mount(`
      <form toolname="calc" tooldescription="d">
        <input name="n" type="number" />
        <input name="secret" type="hidden" />
        <button type="submit">Go</button>
      </form>
    `)
    const [tool] = scanDeclarativeTools(root)
    const props = (tool.descriptor.inputSchema as any).properties
    expect(props.n).toMatchObject({ type: 'number' })
    expect(props.secret).toBeUndefined()
  })

  it('dedupes repeated toolnames and ignores empty ones', () => {
    const root = mount(`
      <form toolname="dup" tooldescription="a"><input name="x" /></form>
      <form toolname="dup" tooldescription="b"><input name="y" /></form>
      <form toolname="" tooldescription="c"><input name="z" /></form>
    `)
    const tools = scanDeclarativeTools(root)
    expect(tools.map((t) => t.descriptor.name)).toEqual(['dup'])
  })
})

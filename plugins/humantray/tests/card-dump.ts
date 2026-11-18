// A compact text dump of a drawn subtree, for comparing drawings: one line an
// element, its type, its key with the item's id put as <id>, its props but its
// handlers, and its text. Handlers never cross into a found element (`press`
// holds only a handle number), so they are left out: what is compared is what
// a surface is handed to draw.

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

export function dumpTree(node: unknown, id: string, depth = 0): string {
  if (typeof node === 'string') return `${'  '.repeat(depth)}${JSON.stringify(node)}`
  const { type, props = {}, children = [] } = node as Node
  const swap = (text: string) => text.split(id).join('<id>')
  const head = [type ?? '?']
  for (const name of Object.keys(props).sort()) {
    if (name === 'children') continue
    const value = props[name]
    head.push(`${name}=${swap(typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value))}`)
  }
  const lines = [`${'  '.repeat(depth)}${head.join(' ')}`]
  // Adjacent strings are one run of text, however the JSX split them.
  let run: string | undefined
  const flush = () => {
    if (run !== undefined) lines.push(`${'  '.repeat(depth + 1)}${JSON.stringify(swap(run))}`)
    run = undefined
  }
  for (const child of children) {
    if (typeof child === 'string') run = (run ?? '') + child
    else {
      flush()
      lines.push(dumpTree(child, id, depth + 1))
    }
  }
  flush()
  return lines.join('\n')
}

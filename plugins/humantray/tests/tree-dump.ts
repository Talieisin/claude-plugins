// A drawn tree as compact text, one element a line (#67): what the per-surface
// snapshots in card-snapshots.ts hold, so a change to a drawing shows as a
// reviewable diff. Every prop is kept but functions, undefined and the few in
// NOISE; text is quoted with JSON.stringify, so a line never breaks.

import { type DrawnNode, isNode } from './surface-rules'

/** Props that say nothing about the drawing. */
const NOISE: ReadonlySet<string> = new Set(['key'])

/** What varies between runs: item ids (ULIDs) and their short codes. */
const steady = (text: string) => text.replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<id>').replace(/\bHT-[0-9A-HJKMNP-TV-Z]{5}\b/g, 'HT-<short>')

const propsOf = (node: DrawnNode): string[] => {
  const props = node.props ?? {}
  const shown = Object.keys(props)
    .filter(name => !NOISE.has(name) && props[name] !== undefined && typeof props[name] !== 'function')
    .sort()
    .map(name => `${name}=${JSON.stringify(props[name])}`)
  return typeof props.key === 'string' ? [`#${props.key}`, ...shown] : shown
}

/** The node, its props (key first, as `#key`), its text; then its children, two spaces in. */
export function dump(tree: unknown): string {
  const lines: string[] = []
  const walk = (node: DrawnNode, depth: number) => {
    const pad = '  '.repeat(depth)
    const children = (node.children ?? []).filter(child => child !== null && child !== undefined && child !== false && child !== '')
    const allText = children.every(child => typeof child === 'string')
    const head = [node.type, ...propsOf(node)]
    if (allText && children.length > 0) head.push(JSON.stringify(children.join('')))
    lines.push(pad + head.join(' '))
    if (allText) return
    // Mixed children: each run of strings is one quoted line, in order.
    let run = ''
    const flush = () => {
      if (run !== '') lines.push(`${pad}  ${JSON.stringify(run)}`)
      run = ''
    }
    for (const child of children) {
      if (typeof child === 'string') run += child
      else if (isNode(child)) {
        flush()
        walk(child, depth + 1)
      }
    }
    flush()
  }
  if (isNode(tree)) walk(tree, 0)
  return steady(lines.join('\n'))
}

/** The element keyed `key` in a drawn tree, outermost first, or undefined. */
export function subtree(tree: unknown, key: string): DrawnNode | undefined {
  if (!isNode(tree)) return undefined
  if (tree.props?.key === key) return tree
  for (const child of tree.children ?? []) {
    const found = subtree(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

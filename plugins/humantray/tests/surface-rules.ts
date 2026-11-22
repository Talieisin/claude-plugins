// Surface rules (#67): paint traps the test kit cannot see by itself. The kit
// checks the tree each surface is handed, never what the app paints, so a
// valid tree can still draw wrong on the desktop app, VS Code or a phone.
// Each rule here names a fault the owner found by eye; each new one the owner
// finds becomes a rule here, with the issue it came from.
//
// Every test mounts through `mount` below, never `$.ui.mount` itself, so every
// drawing on an app surface is held to the rules: after the mount, after each
// act, before each read and before it is let go. The full verification checks
// that `$.ui.mount(` appears in no other test file.
//
// This file imports nothing from `world.ts`, which may import it.

import type { RenderComponent, RenderSurface } from 'claude-code'
import type { Engine, MountTarget, Mounted } from 'claude-code/testing'

/** The surfaces whose paint the rules are about: the app's, not the terminal's. */
export const APP_SURFACES: readonly string[] = ['desktop', 'vscode', 'mobile']

/** A drawn element as plain data: what `ui.drawn()` gives. */
export type DrawnNode = { type: string; props?: Record<string, unknown>; children?: unknown[] }

export const isNode = (value: unknown): value is DrawnNode =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'

/** Every string under a node, in order. */
export const textOf = (node: DrawnNode): string =>
  (node.children ?? []).map(child => (typeof child === 'string' ? child : isNode(child) ? textOf(child) : '')).join('')

/** A node as a rule meets it: with its nearest key and its ancestors' types and keys. */
type Visit = { node: DrawnNode; key: string; ancestors: readonly DrawnNode[]; surface: string }

/** One rule: a name, the fault it came from, and the faults it finds at one node. */
export type SurfaceRule = { name: string; from: string; check: (visit: Visit) => string[] }

/**
 * Styles the app does not draw on a `Text` inside a `Button`. From #64: on the
 * desktop app a `plain` Button drew its option's description, a dim `Text`
 * inside it, at full strength. Add a style here when the owner finds another.
 */
export const IGNORED_IN_BUTTON: readonly string[] = ['dimColor']

/** Theme keys meant for text, which the app paints dark as a fill (#72). */
export const TEXT_COLOURS: readonly string[] = ['text', 'subtle', 'inactive', 'inverseText']

/** The marks an option's Button starts with on an app surface (#75; `choiceGlyph` in hooks/choice.ts). */
export const CHOICE_MARKS: readonly string[] = ['☐', '✅', '○', '◉']

/** A terminal mark at the start of a line: `[ ]`, `[x]`, `( )`, `(•)`. */
const MARK = /^\s*(?:[-*+]\s+)?(?:\[[ xX]\]|\(\s?\)|\(•\))/

/**
 * Item content: the author's or the person's own text, which may hold a mark
 * of its own (a `- [ ] task` list) and is not a control. A body and its
 * pieces, an answer's parts (Answer, Other, Feedback, Notes), in the pane,
 * History, an entry in full and the viewer alike.
 */
const CONTENT = /:(?:body|Answer|Other|Feedback|Notes)(?::\d+)?$/

const keyOf = (node: DrawnNode): string | undefined => {
  const key = node.props?.key
  return typeof key === 'string' ? key : undefined
}

const keyed = (node: DrawnNode): boolean => keyOf(node) !== undefined

const inside = (visit: Visit, test: (node: DrawnNode) => boolean) => visit.ancestors.some(test)

export const RULES: readonly SurfaceRule[] = [
  {
    // #64: `[ ] Label <Text dimColor>description</Text>` in one plain Button;
    // the desktop app drew the description at full strength.
    name: 'no-ignored-style-in-button',
    from: '#64',
    check: ({ node, ancestors }) => {
      if (node.type !== 'Text' || !ancestors.some(a => a.type === 'Button')) return []
      return IGNORED_IN_BUTTON.filter(style => node.props?.[style] !== undefined && node.props[style] !== false).map(
        style => `a Text with ${style} inside a Button, which the app does not draw there`,
      )
    },
  },
  {
    // #64: the terminal's `[ ]`, `[x]`, `( )` and `(•)` marks drawn on an app
    // surface, which has its own glyphs (☐ ✅ ○ ◉). Controls only: a Button's
    // text and label, a Text inside a Button or a choice's options, and any
    // Markdown that is not item content.
    name: 'no-terminal-marks',
    from: '#64',
    check: visit => {
      const { node } = visit
      if (node.type === 'Button') {
        const found = []
        if (MARK.test(textOf(node))) found.push(`a terminal mark in the Button's text: ${JSON.stringify(textOf(node))}`)
        const label = node.props?.label
        if (typeof label === 'string' && MARK.test(label)) found.push(`a terminal mark in the Button's label: ${JSON.stringify(label)}`)
        return found
      }
      if (node.type === 'Text') {
        const control = inside(visit, a => a.type === 'Button' || (keyOf(a) ?? '').endsWith(':options'))
        return control && MARK.test(textOf(node)) ? [`a terminal mark in a control's Text: ${JSON.stringify(textOf(node))}`] : []
      }
      if (node.type === 'Markdown') {
        const text = node.props?.text
        if (CONTENT.test(keyOf(node) ?? '') || typeof text !== 'string') return []
        return text.split('\n').some(line => MARK.test(line)) ? [`a terminal mark in Markdown that is not item content`] : []
      }
      return []
    },
  },
  {
    // #64, on 0.2.3: the desktop app draws a Button's `label` prop in place of
    // its children. An option drawn `label="Blue, not selected"` around
    // "○ Blue" showed "Blue, not selected" and no glyph. So a Button whose
    // label is not its children's text draws something other than its
    // children. A Button with a label and no children is a plain label.
    name: 'button-label-is-its-text',
    from: '#64',
    check: ({ node }) => {
      if (node.type !== 'Button') return []
      const label = node.props?.label
      if (typeof label !== 'string' || (node.children ?? []).length === 0) return []
      const text = textOf(node)
      return label === text ? [] : [`a label ${JSON.stringify(label)} the app draws in place of the children ${JSON.stringify(text)}`]
    },
  },
  {
    // #72: the hairline between option rows was first written as an Svg with
    // no `height`, which a surface draws at "the markup's own height at the
    // drawn width": scaled to the slot, a fraction of a pixel. Every Svg here
    // says how tall it is.
    name: 'svg-has-height',
    from: '#72',
    check: ({ node }) => {
      if (node.type !== 'Svg') return []
      const height = node.props?.height
      return typeof height === 'number' && height > 0 ? [] : ['an Svg with no height, drawn at its markup\'s height scaled to the slot']
    },
  },
  {
    // #75, on 0.2.6: an option's checkbox or radio was an Svg beside its label
    // Button. The engine never makes an Svg pressable (it cannot sit in a
    // Button, and a Box takes no press), so the owner's clicks on the boxes
    // did nothing. On an app surface every option's Button, under a choice's
    // options, starts with its mark glyph, so the box is part of the press;
    // and no drawn control (an Svg whose alt names a state) is drawn at all.
    name: 'mark-in-its-button',
    from: '#75',
    check: visit => {
      const { node } = visit
      if (node.type === 'Svg') {
        const alt = node.props?.alt
        return typeof alt === 'string' && /selected$/.test(alt) ? [`a drawn control (${JSON.stringify(alt)}) that cannot be pressed`] : []
      }
      if (node.type !== 'Button' || !inside(visit, a => (keyOf(a) ?? '').endsWith(':options'))) return []
      // A Button's one string child is drawn as its label.
      const label = node.props?.label
      const text = textOf(node) || (typeof label === 'string' ? label : '')
      return CHOICE_MARKS.some(mark => text.startsWith(`${mark} `)) ? [] : [`an option's Button without its mark glyph first: ${JSON.stringify(text)}`]
    },
  },
  {
    // #75, on 0.2.7: on the desktop app each option's description started
    // about 3 CSS pixels right of its label (the owner's check). A cell is
    // too coarse to move the description, so the label is moved: a thin
    // space (U+2009) after the mark's space. On the desktop app an option's
    // Button under a choice's options carries it, ticked or not (a ticked
    // ✅ is wider, so its label sits a little right: the owner's choice,
    // 0.2.10).
    name: 'label-meets-its-description',
    from: '#75',
    check: visit => {
      const { node, surface } = visit
      if (surface !== 'desktop' || node.type !== 'Button' || !inside(visit, a => (keyOf(a) ?? '').endsWith(':options'))) return []
      const label = node.props?.label
      const text = textOf(node) || (typeof label === 'string' ? label : '')
      return CHOICE_MARKS.some(mark => text.startsWith(`${mark} \u2009`)) ? [] : [`an option's label without the thin space that lines it up with its description: ${JSON.stringify(text)}`]
    },
  },
  {
    // #72, on 0.2.5: the header band and the row hover were filled with
    // `subtle`, a theme key meant for text, and the desktop app painted them
    // dark grey. No Box on an app surface is filled with a text colour.
    // Only the fill is seen on a real drawing: `ui.drawn()` does not carry
    // `hover`, so a hover fill is caught only in a hand-made tree.
    name: 'no-text-colour-as-fill',
    from: '#72',
    check: ({ node }) => {
      if (node.type !== 'Box') return []
      const fill = node.props?.backgroundColor
      const hover = (node.props?.hover as { backgroundColor?: unknown } | undefined)?.backgroundColor
      return [fill, hover]
        .filter((colour): colour is string => typeof colour === 'string' && TEXT_COLOURS.includes(colour))
        .map(colour => `a Box filled with ${JSON.stringify(colour)}, a text colour the app paints dark`)
    },
  },
  {
    // #72, on 0.2.5: the desktop app took no press on an option's label
    // Button whose column grew and stretched (flexGrow 1, alignItems
    // stretch) and also held its description or Other's field; Other,
    // alone in that same column while closed, took its presses (the owner's
    // check). Which of the two props it is, the tree cannot say: a Button
    // shares a Box that grows or stretches with nothing.
    name: 'button-alone-in-a-stretched-box',
    from: '#72',
    check: ({ node, ancestors }) => {
      if (node.type !== 'Button') return []
      const parent = ancestors.at(-1)
      if (parent === undefined || parent.type !== 'Box') return []
      const grows = typeof parent.props?.flexGrow === 'number' && parent.props.flexGrow > 0
      const stretches = parent.props?.alignItems === 'stretch'
      if (!grows && !stretches) return []
      const others = (parent.children ?? []).filter(child => child !== node && (isNode(child) || (typeof child === 'string' && child.trim() !== '')))
      return others.length === 0 ? [] : [`a Button in a Box that ${grows ? 'grows' : 'stretches'} and holds something else, where the desktop app took no press`]
    },
  },
]

/**
 * The faults in a drawn tree on a surface, one line each: the rule, the
 * nearest key, and what it found. None on the terminal or a surface not
 * listed in APP_SURFACES.
 */
export function surfaceFaults(tree: unknown, surface: string, rules: readonly SurfaceRule[] = RULES): string[] {
  if (!APP_SURFACES.includes(surface)) return []
  const faults: string[] = []
  const walk = (value: unknown, ancestors: DrawnNode[]) => {
    if (!isNode(value)) return
    const nearest = keyOf(value) ?? [...ancestors].reverse().find(keyed)?.props?.key
    const key = typeof nearest === 'string' ? nearest : '(no key)'
    for (const rule of rules) {
      for (const detail of rule.check({ node: value, key, ancestors, surface })) faults.push(`${rule.name} (${rule.from}) at ${key}: ${detail}`)
    }
    for (const child of value.children ?? []) walk(child, [...ancestors, value])
  }
  walk(tree, [])
  return faults
}

/** Members that read the tree: the rules run before they answer. */
const READS = new Set(['find', 'findAll', 'drawn', 'keepsBeneath'])
/** Members that change it: the rules run once they have settled. */
const ACTS = new Set(['press', 'input', 'select', 'key', 'pointer', 'post', 'advance', 'resize', 'redraw'])

/**
 * `$.ui.mount`, with the surface rules held on every drawing on an app
 * surface: after the mount, after each act, before each read and before
 * `unmount`. A fault rejects with every fault in the tree listed. An act that
 * fails rejects with its own error, unchanged. The terminal is not checked.
 *
 * @example
 * const ui = await mount($, { ...PANE, surface })
 */
export async function mount<P extends RenderSurface, C extends RenderComponent>($: Engine, target: MountTarget<P, C>): Promise<Mounted<P, C>> {
  const ui = await $.ui.mount(target)
  if (!APP_SURFACES.includes(target.surface)) return ui
  const members = ui as unknown as Record<string, unknown> & { drawn: () => Promise<unknown> }
  const check = async (when: string) => {
    let tree: unknown
    try {
      tree = await members.drawn()
    } catch {
      // A tree the surface refused: the test's own read or act says so.
      return
    }
    const faults = surfaceFaults(tree, target.surface)
    if (faults.length > 0) throw new Error(`surface rules on ${target.surface}, ${when}:\n${faults.join('\n')}`)
  }
  await check('after the mount')
  // The kit's handle is frozen, so the checked handle is a new object with
  // the same members, each method wrapped.
  const checked: Record<string, unknown> = {}
  for (const name of Object.getOwnPropertyNames(members)) {
    const value = members[name]
    if (typeof value !== 'function') {
      checked[name] = value
      continue
    }
    const call = (...args: unknown[]): unknown => (value as (...a: unknown[]) => unknown).apply(members, args)
    if (READS.has(name)) {
      checked[name] = async (...args: unknown[]) => {
        await check(`before ${name}`)
        return call(...args)
      }
    } else if (ACTS.has(name)) {
      checked[name] = async (...args: unknown[]) => {
        const result = await call(...args)
        await check(`after ${name}`)
        return result
      }
    } else if (name === 'unmount') {
      checked[name] = async () => {
        await check('before unmount')
        return call()
      }
    } else {
      checked[name] = call
    }
  }
  return Object.freeze(checked) as unknown as Mounted<P, C>
}

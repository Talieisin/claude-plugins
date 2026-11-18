// A choice card's options on each surface (#64): checkbox and radio rows with
// the description apart from the label on the desktop app, VS Code and a
// phone; the terminal's one-line drawing of 0.2.1 kept. Pressing an option by
// its key toggles it the same way everywhere.

import { type Engine, describe, expect, test } from 'claude-code/testing'

import { DESCRIPTION_INDENT, choiceMark, drawsChoiceRows } from '../hooks/choice'
import { ADD, PANE, START_EVENT, answerOf, world } from './world'
import { mount } from './surface-rules'

const OPTIONS = [
  { label: 'Plugin validate', description: 'Run claude plugin validate on the repository' },
  { label: 'Shell syntax', description: 'Run bash -n on every script under templates/ and plugins/' },
  { label: 'Bare', description: '   ' },
]

const APPS = ['desktop', 'vscode', 'mobile'] as const
const SURFACES = ['terminal', ...APPS] as const

type Node = { type: string; key: string | undefined; props: Record<string, unknown>; text: string; children: unknown[] }
/** A child as drawn: its tag, props and children; no key or text of its own. */
type Child = { type: string; props: Record<string, unknown>; children: unknown[] }

async function addChoice($: Engine, multiSelect: boolean) {
  // A question of its own per kind: the same question again would be a bump of the first.
  const question = multiSelect ? 'Which checks?' : 'Which one check?'
  const added = await $.tool.call({ tool: ADD, type: 'choice', header: 'Checks', question, options: OPTIONS, multiSelect })
  return answerOf<{ id: string }>(added).id
}

/** The element children of a drawn node, strings left out. */
const elements = (node: Node | Child | undefined): Child[] =>
  (node?.children ?? []).filter((child): child is Child => typeof child === 'object' && child !== null && 'type' in child)

/** A child's own string children, joined. */
const own = (child: Child | undefined) => (child?.children ?? []).filter(part => typeof part === 'string').join('')

const spacing = (props: Record<string, unknown> | undefined) =>
  Object.fromEntries(Object.entries(props ?? {}).filter(([name]) => name.startsWith('padding') || name.startsWith('margin')))

describe('the pure rules', () => {
  test('rows on the desktop app, VS Code and a phone; the terminal and anything unknown keep one line', () => {
    for (const surface of APPS) expect(drawsChoiceRows(surface)).toBe(true)
    for (const surface of ['terminal', '', 'later', undefined]) expect(drawsChoiceRows(surface)).toBe(false)
  })

  test('marks: glyphs on the app surfaces, terminal text elsewhere', () => {
    for (const surface of APPS) {
      expect([choiceMark(surface, true, false), choiceMark(surface, true, true)]).toEqual(['☐', '☑'])
      expect([choiceMark(surface, false, false), choiceMark(surface, false, true)]).toEqual(['○', '◉'])
    }
    expect([choiceMark('terminal', true, false), choiceMark('terminal', true, true)]).toEqual(['[ ]', '[x]'])
    expect([choiceMark('terminal', false, false), choiceMark('terminal', false, true)]).toEqual(['( )', '(•)'])
  })
})

describe('the app surfaces draw checkbox and radio rows', () => {
  const field = { desktop: { marginBottom: 'sm' }, vscode: { marginBottom: 1 }, mobile: {} }
  for (const surface of APPS) {
    for (const multi of [true, false]) {
      test(`${surface}, ${multi ? 'multi-select' : 'single choice'}: mark and label pressable, description dim under it, state in the name`, async ($, on) => {
        world(on, { surfaces: [surface] })
        await $.session.start(START_EVENT)
        const id = await addChoice($, multi)
        const ui = await mount($, { ...PANE, surface })
        const [off, onMark] = multi ? ['☐', '☑'] : ['○', '◉']

        // The tree is drawn: the group, each row and its Button are there.
        const group = (await ui.find({ key: `${id}:options` })) as Node | undefined
        expect(group?.type).toBe('Box')
        expect(spacing(group?.props)).toEqual(field[surface])
        expect(elements(group).map(row => row.props.key)).toEqual([0, 1, 2].map(n => `${id}:opt:${String(n)}:row`))

        for (const [index, option] of OPTIONS.entries()) {
          const row = (await ui.find({ key: `${id}:opt:${String(index)}:row` })) as Node | undefined
          expect(row?.props.flexDirection).toBe('column')
          const button = (await ui.find({ key: `${id}:opt:${String(index)}` })) as Node | undefined
          expect(button?.type).toBe('Button')
          expect(button?.props.plain).toBe(true)
          expect(button?.text).toBe(`${off} ${option.label}`)
          // No label of its own, which the desktop app would draw in place of the glyph (0.2.3).
          expect(button?.props.label ?? button?.text).toBe(`${off} ${option.label}`)
          // Nothing but the mark and the label inside the pressable.
          expect(elements(button)).toEqual([])
          expect(button?.text).not.toContain(option.description.trim() || '\u0000')
          const about = (await ui.find({ key: `${id}:opt:${String(index)}:about` })) as Node | undefined
          if (option.description.trim() === '') {
            // An empty description draws no line.
            expect(about).toBeUndefined()
            expect(elements(row).map(child => child.type)).toEqual(['Button'])
          } else {
            expect(elements(row).map(child => child.type)).toEqual(['Button', 'Box'])
            expect(about?.props.paddingLeft).toBe(DESCRIPTION_INDENT)
            const text = elements(about)[0]
            expect(text?.type).toBe('Text')
            expect(text?.props.dimColor).toBe(true)
            expect(own(text)).toBe(option.description)
          }
        }

        // Pressed by the unchanged key, the mark follows.
        await ui.press({ key: `${id}:opt:1` })
        const picked = (await ui.find({ key: `${id}:opt:1` })) as Node | undefined
        expect(picked?.text).toBe(`${onMark} Shell syntax`)
        expect(picked?.props.label ?? picked?.text).toBe(`${onMark} Shell syntax`)
        await ui.press({ key: `${id}:opt:0` })
        const first = (await ui.find({ key: `${id}:opt:0` })) as Node | undefined
        const second = (await ui.find({ key: `${id}:opt:1` })) as Node | undefined
        expect(first?.text).toBe(`${onMark} Plugin validate`)
        // A multi-select keeps both; a single choice moves the pick.
        expect(second?.text).toBe(`${multi ? onMark : off} Shell syntax`)
        await ui.unmount()
      })
    }
  }
})

describe('the terminal draws as in 0.2.1', () => {
  for (const multi of [true, false]) {
    test(`${multi ? 'multi-select' : 'single choice'}: one plain Button per option, mark, label and dim description on one line`, async ($, on) => {
      world(on)
      await $.session.start(START_EVENT)
      const id = await addChoice($, multi)
      const ui = await mount($, { ...PANE, surface: 'terminal' })
      const [off, onMark] = multi ? ['[ ]', '[x]'] : ['( )', '(•)']
      expect(await ui.find({ key: `${id}:options` })).toBeUndefined()
      expect(await ui.find({ key: `${id}:opt:0:row` })).toBeUndefined()
      for (const [index, option] of OPTIONS.entries()) {
        const button = (await ui.find({ key: `${id}:opt:${String(index)}` })) as Node | undefined
        expect(button?.props.plain).toBe(true)
        expect(String(button?.props.label)).not.toContain('selected')
        expect(button?.text.startsWith(`${off} ${option.label} `)).toBe(true)
        const dim = elements(button)
        expect(dim.map(child => [child.type, child.props.dimColor, own(child)])).toEqual([['Text', true, option.description]])
      }
      await ui.press({ key: `${id}:opt:1` })
      expect(((await ui.find({ key: `${id}:opt:1` })) as Node | undefined)?.text.startsWith(`${onMark} Shell syntax`)).toBe(true)
      await ui.unmount()
    })
  }
})

describe('the answer is the same on every surface', () => {
  for (const surface of SURFACES) {
    test(`${surface}: multi-select toggles on and off, single choice moves; Submit stores the labels`, async ($, on) => {
      const w = world(on, { surfaces: [surface] })
      await $.session.start(START_EVENT)
      const multi = await addChoice($, true)
      const single = await addChoice($, false)
      const ui = await mount($, { ...PANE, surface })
      for (const n of [0, 1, 2, 1]) await ui.press({ key: `${multi}:opt:${String(n)}` })
      await ui.press({ key: `${multi}:submit` })
      for (const n of [0, 2]) await ui.press({ key: `${single}:opt:${String(n)}` })
      await ui.press({ key: `${single}:submit` })
      await ui.unmount()
      const items = w.store().items
      expect(items.find(item => item.id === multi)?.response).toEqual({ selected: ['Plugin validate', 'Bare'] })
      expect(items.find(item => item.id === single)?.response).toEqual({ selected: ['Bare'] })
    })
  }
})

// A choice card's options on each surface (#64, #72, #75): on the desktop app,
// VS Code and a phone, a row per option whose Button holds the checkbox or
// radio glyph and the label (so a click on the box presses it), the
// description dim under the label and set in to line up with it, Other a row
// that opens its field under it, the actions bottom right; the terminal's
// one-line drawing of 0.2.1 kept. Pressing an option by its key toggles it the
// same way everywhere.

import { type Engine, describe, expect, test } from 'claude-code/testing'

import { CHOICE_GLYPHS, THIN_SPACE, choiceGlyph, choiceMark, choiceText, descriptionIndent, drawsChoiceRows, otherIsOn } from '../hooks/choice'
import { EMPTY_DRAFT } from '../hooks/items'
import { ADD, PANE, START_EVENT, answerOf, world } from './world'
import { CHOICE_MARKS, mount } from './surface-rules'

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

  test('terminal marks', () => {
    expect([choiceMark(true, false), choiceMark(true, true)]).toEqual(['[ ]', '[x]'])
    expect([choiceMark(false, false), choiceMark(false, true)]).toEqual(['( )', '(•)'])
  })

  test('app marks: a checkbox or radio glyph, the same set the surface rule names', () => {
    expect([choiceGlyph(true, false), choiceGlyph(true, true)]).toEqual(['☐', '✅'])
    expect([choiceGlyph(false, false), choiceGlyph(false, true)]).toEqual(['○', '◉'])
    expect(CHOICE_GLYPHS).toEqual(CHOICE_MARKS)
  })

  test('the option text: mark, space, label; on the desktop app a thin space more, to meet the description (#75, 0.2.7 check)', () => {
    expect(choiceText('desktop', true, true, 'Blue')).toBe(`✅ ${THIN_SPACE}Blue`)
    expect(THIN_SPACE).toBe('\u2009')
    for (const surface of ['vscode', 'mobile']) expect(choiceText(surface, false, false, 'Blue')).toBe('○ Blue')
  })

  test('the indent under a label: the glyph and its space, and the desktop button\'s inset', () => {
    expect(descriptionIndent('desktop')).toBe(3)
    expect(descriptionIndent('vscode')).toBe(2)
    expect(descriptionIndent('mobile')).toBe(2)
  })
})

/** What a Button says: its label, which its one string child is drawn as, else its text. */
const said = (node: Node | undefined): string => String(node?.props.label ?? node?.text ?? '')

/** A drawn node's element children by type. */
const shape = (node: Node | Child | undefined) => elements(node).map(child => child.type)

describe('the app surfaces draw each option as one pressable row (#72, #75)', () => {
  const field = { desktop: { marginBottom: 'sm' }, vscode: { marginBottom: 1 }, mobile: {} }
  for (const surface of APPS) {
    for (const multi of [true, false]) {
      test(`${surface}, ${multi ? 'multi-select' : 'single choice'}: a row per option, its glyph and label in one Button alone in its line, the description dim and set in under it, Other last`, async ($, on) => {
        world(on, { surfaces: [surface] })
        await $.session.start(START_EVENT)
        const id = await addChoice($, multi)
        const ui = await mount($, { ...PANE, surface })
        const indent = descriptionIndent(surface)

        const group = (await ui.find({ key: `${id}:options` })) as Node | undefined
        expect(group?.type).toBe('Box')
        expect(spacing(group?.props)).toEqual(field[surface])
        expect(elements(group).map(child => String(child.props.key))).toEqual([
          `${id}:opt:0:row`, `${id}:opt:1:row`, `${id}:opt:2:row`, `${id}:opt:other:row`,
        ])

        for (const [index, option] of OPTIONS.entries()) {
          const row = (await ui.find({ key: `${id}:opt:${String(index)}:row` })) as Node | undefined
          expect(row?.props).toEqual({ key: `${id}:opt:${String(index)}:row`, flexDirection: 'column' })
          // The line holds the Button and nothing else: no Svg, nothing that grows or stretches.
          const line = (await ui.find({ key: `${id}:opt:${String(index)}:line` })) as Node | undefined
          expect(line?.props).toEqual({ key: `${id}:opt:${String(index)}:line`, flexDirection: 'row' })
          expect(shape(line)).toEqual(['Button'])
          const button = (await ui.find({ key: `${id}:opt:${String(index)}` })) as Node | undefined
          expect(button?.props.plain).toBe(true)
          // The glyph and the label, one string (drawn as the Button's label): a click on the box is a click on the Button (#75).
          expect(said(button)).toBe(choiceText(surface, multi, false, option.label))
          expect(elements(button)).toEqual([])
          const under = (await ui.find({ key: `${id}:opt:${String(index)}:under` })) as Node | undefined
          const about = (await ui.find({ key: `${id}:opt:${String(index)}:about` })) as Node | undefined
          if (option.description.trim() === '') {
            expect(under).toBeUndefined()
            expect(about).toBeUndefined()
            expect(shape(row)).toEqual(['Box'])
          } else {
            expect(shape(row)).toEqual(['Box', 'Box'])
            // Set in by the glyph, its space and the button's inset, to line up with the label.
            expect(under?.props).toEqual({ key: `${id}:opt:${String(index)}:under`, flexDirection: 'row', paddingLeft: indent })
            expect(shape(under)).toEqual(['Box'])
            const text = elements(about)[0]
            expect(text?.type).toBe('Text')
            expect(text?.props.dimColor).toBe(true)
            expect(own(text)).toBe(option.description)
          }
        }
        // Other: the same row, closed, with no field.
        expect(shape((await ui.find({ key: `${id}:opt:other:line` })) as Node | undefined)).toEqual(['Button'])
        expect(said((await ui.find({ key: `${id}:opt:other` })) as Node | undefined)).toBe(choiceText(surface, multi, false, 'Other'))
        expect(await ui.find({ key: `${id}:other:field` })).toBeUndefined()
        // No drawn control anywhere on the card.
        expect(JSON.stringify(await ui.find({ key: `${id}:card` }))).not.toContain('"Svg"')

        // Pressed by its key, the glyph follows; an option with a description presses too.
        const glyph = async (n: number) => said((await ui.find({ key: `${id}:opt:${String(n)}` })) as Node | undefined).slice(0, 1)
        await ui.press({ key: `${id}:opt:1` })
        expect(await glyph(1)).toBe(choiceGlyph(multi, true))
        await ui.press({ key: `${id}:opt:0` })
        expect(await glyph(0)).toBe(choiceGlyph(multi, true))
        // A multi-select keeps both; a single choice moves the pick.
        expect(await glyph(1)).toBe(choiceGlyph(multi, multi))
        // A multi-select unticks on a second press.
        if (multi) {
          await ui.press({ key: `${id}:opt:1` })
          expect(await glyph(1)).toBe(choiceGlyph(true, false))
        }
        await ui.unmount()
      })
    }
  }

  for (const surface of APPS) {
    test(`${surface}: no header band and no fill; the card as before, its actions bottom right`, async ($, on) => {
      world(on, { surfaces: [surface] })
      await $.session.start(START_EVENT)
      const id = await addChoice($, false)
      const ack = answerOf<{ id: string }>(await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Deployed' })).id
      const task = answerOf<{ id: string }>(await $.tool.call({ tool: ADD, type: 'do', header: 'Key', question: 'Rotate' })).id
      const plan = answerOf<{ id: string }>(await $.tool.call({ tool: ADD, type: 'approve', header: 'Plan', question: 'OK?' })).id
      const ui = await mount($, { ...PANE, surface })
      for (const card of [id, ack, task, plan]) {
        const frame = (await ui.find({ key: `${card}:card` })) as Node | undefined
        expect(frame?.props.borderStyle).toBe('round')
        expect(frame?.props.backgroundColor).toBeUndefined()
        expect(await ui.find({ key: `${card}:head` })).toBeUndefined()
        expect(shape(frame).slice(0, 2)).toEqual(['Text', 'Text'])
      }
      expect(((await ui.find({ key: `${id}:actions` })) as Node | undefined)?.props.justifyContent).toBe('flex-end')
      expect(((await ui.find({ key: `${ack}:actions` })) as Node | undefined)?.props.justifyContent).toBe('flex-end')
      expect(((await ui.find({ key: `${task}:outcomes` })) as Node | undefined)?.props.justifyContent).toBe('flex-end')
      expect(((await ui.find({ key: `${plan}:verdicts` })) as Node | undefined)?.props.justifyContent).toBe('flex-end')
      await ui.unmount()
    })
  }
})

describe('Other on the app surfaces is a row that opens its field under it (#72, #75)', () => {
  for (const surface of APPS) {
    for (const multi of [true, false]) {
      test(`${surface}, ${multi ? 'multi-select' : 'single choice'}: pressing Other ticks it and opens its field under it, set in; pressing it again closes it and clears the text`, async ($, on) => {
        world(on, { surfaces: [surface] })
        await $.session.start(START_EVENT)
        const id = await addChoice($, multi)
        const ui = await mount($, { ...PANE, surface })
        await ui.press({ key: `${id}:opt:other` })
        const other = async () => said((await ui.find({ key: `${id}:opt:other` })) as Node | undefined)
        expect(await other()).toBe(choiceText(surface, multi, true, 'Other'))
        // The field is under the line, not beside the Button, and set in like a description: not the card's full width.
        expect(shape((await ui.find({ key: `${id}:opt:other:line` })) as Node | undefined)).toEqual(['Button'])
        const under = (await ui.find({ key: `${id}:opt:other:under` })) as Node | undefined
        expect(under?.props.paddingLeft).toBe(descriptionIndent(surface))
        expect(elements(under).map(child => child.props.key)).toEqual([`${id}:other:field`])
        expect((await ui.find({ key: `${id}:other` }))?.type).toBe('Input')
        await ui.input({ key: `${id}:other`, text: 'Teal', kind: 'change' })
        await ui.press({ key: `${id}:opt:other` })
        expect(await ui.find({ key: `${id}:other:field` })).toBeUndefined()
        expect(await other()).toBe(choiceText(surface, multi, false, 'Other'))
        // Opened again, the field is empty.
        await ui.press({ key: `${id}:opt:other` })
        expect((await ui.find({ key: `${id}:other` }))?.props.value).toBe('')
        await ui.unmount()
      })
    }
  }

  test('multi-select: options and Other together, then Submit, delivers both', async ($, on) => {
    const w = world(on, { surfaces: ['desktop'] })
    await $.session.start(START_EVENT)
    const id = await addChoice($, true)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:opt:0` })
    await ui.press({ key: `${id}:opt:other` })
    await ui.input({ key: `${id}:other`, text: 'Teal', kind: 'change' })
    // Ticking another option keeps Other open on a multi-select.
    await ui.press({ key: `${id}:opt:2` })
    expect((await ui.find({ key: `${id}:other` }))?.type).toBe('Input')
    await ui.press({ key: `${id}:submit` })
    await ui.unmount()
    expect(w.store().items.find(item => item.id === id)?.response).toEqual({ selected: ['Plugin validate', 'Bare'], other: 'Teal' })
  })

  test('multi-select: unticking Other that holds text, then Submit, delivers no Other', async ($, on) => {
    const w = world(on, { surfaces: ['desktop'] })
    await $.session.start(START_EVENT)
    const id = await addChoice($, true)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:opt:0` })
    await ui.press({ key: `${id}:opt:other` })
    await ui.input({ key: `${id}:other`, text: 'Teal', kind: 'change' })
    await ui.press({ key: `${id}:opt:other` })
    await ui.press({ key: `${id}:submit` })
    await ui.unmount()
    expect(w.store().items.find(item => item.id === id)?.response).toEqual({ selected: ['Plugin validate'] })
  })

  test('single choice: Other open and empty, then Submit, asks for an option or Other', async ($, on) => {
    const w = world(on, { surfaces: ['desktop'] })
    await $.session.start(START_EVENT)
    const id = await addChoice($, false)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:opt:1` })
    // Opening Other clears a single choice's pick.
    await ui.press({ key: `${id}:opt:other` })
    expect(said((await ui.find({ key: `${id}:opt:1` })) as Node | undefined)).toBe(choiceText('desktop', false, false, 'Shell syntax'))
    await ui.press({ key: `${id}:submit` })
    expect((await ui.find({ key: `${id}:card` }))?.text).toContain('Pick an option or fill in Other.')
    // Picking an option closes Other and clears its text.
    await ui.input({ key: `${id}:other`, text: 'Mauve', kind: 'change' })
    await ui.press({ key: `${id}:opt:2` })
    expect(await ui.find({ key: `${id}:other:field` })).toBeUndefined()
    await ui.press({ key: `${id}:submit` })
    await ui.unmount()
    expect(w.store().items.find(item => item.id === id)?.response).toEqual({ selected: ['Bare'] })
  })

  test('single choice: Other with text, then Submit, delivers Other alone', async ($, on) => {
    const w = world(on, { surfaces: ['vscode'] })
    await $.session.start(START_EVENT)
    const id = await addChoice($, false)
    const ui = await mount($, { ...PANE, surface: 'vscode' })
    await ui.press({ key: `${id}:opt:other` })
    await ui.input({ key: `${id}:other`, text: 'Mauve', kind: 'change' })
    await ui.press({ key: `${id}:submit` })
    await ui.unmount()
    expect(w.store().items.find(item => item.id === id)?.response).toEqual({ selected: [], other: 'Mauve' })
  })

  test('a draft stored before 0.2.5 (no otherOpen) reads as closed, or as on when it holds Other text', () => {
    const old = { selected: [], other: '', text: '', feedback: '', notes: '', error: '', entered: 0, codeAt: 0 }
    expect({ ...EMPTY_DRAFT, ...old }.otherOpen).toBe(false)
    expect(otherIsOn({ ...EMPTY_DRAFT, ...old })).toBe(false)
    expect(otherIsOn({ ...EMPTY_DRAFT, ...old, other: 'kept' })).toBe(true)
    expect(otherIsOn({ ...EMPTY_DRAFT, other: '  \n ' })).toBe(false)
    expect(otherIsOn({ ...EMPTY_DRAFT, otherOpen: true })).toBe(true)
  })

  test('the terminal always draws the Other field, as before', async ($, on) => {
    world(on)
    await $.session.start(START_EVENT)
    const id = await addChoice($, true)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    expect(await ui.find({ key: `${id}:opt:other` })).toBeUndefined()
    expect((await ui.find({ key: `${id}:other` }))?.type).toBe('Input')
    await ui.unmount()
  })
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

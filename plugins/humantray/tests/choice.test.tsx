// A choice card's options on each surface (#64, #72): on the desktop app, VS
// Code and a phone, the desktop app's own question dialog as near as the mod
// API allows (a header band, a row per option with a drawn control, the
// description dim under the label, Other a row that opens its field, the
// actions bottom right); the terminal's one-line drawing of 0.2.1 kept.
// Pressing an option by its key toggles it the same way everywhere.

import { type Engine, describe, expect, test } from 'claude-code/testing'

import { CONTROL_OFF, CONTROL_ON, SPACER_SVG, choiceMark, controlAlt, controlSvg, drawsChoiceRows, otherIsOn } from '../hooks/choice'
import { EMPTY_DRAFT } from '../hooks/items'
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

  test('terminal marks', () => {
    expect([choiceMark(true, false), choiceMark(true, true)]).toEqual(['[ ]', '[x]'])
    expect([choiceMark(false, false), choiceMark(false, true)]).toEqual(['( )', '(•)'])
  })

  test('the Svg control: a circle or a square, blue and marked when picked, grey outline when not; its alt names the state', () => {
    const radioOff = controlSvg(false, false)
    const radioOn = controlSvg(false, true)
    const boxOff = controlSvg(true, false)
    const boxOn = controlSvg(true, true)
    for (const svg of [radioOff, radioOn, boxOff, boxOn]) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).not.toMatch(/<script|on[a-z]+=/i)
    }
    expect(radioOff).toContain('<circle')
    expect(radioOff).toContain(`stroke="${CONTROL_OFF}"`)
    expect(radioOff).not.toContain(CONTROL_ON)
    expect(radioOn).toContain(`fill="${CONTROL_ON}"`)
    expect(radioOn).toContain('r="3" fill="#ffffff"')
    expect(boxOff).toContain('<rect')
    expect(boxOff).not.toContain(CONTROL_ON)
    expect(boxOn).toContain(`fill="${CONTROL_ON}"`)
    expect(boxOn).toContain('<polyline')
    expect(controlAlt(false, true)).toBe('Radio button, selected')
    expect(controlAlt(true, false)).toBe('Checkbox, not selected')
  })

  test('the spacer under a label is the control\'s width, one pixel tall, and draws nothing', () => {
    expect(SPACER_SVG).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="1" viewBox="0 0 16 1"></svg>')
  })
})

/** A drawn node's element children by type. */
const shape = (node: Node | Child | undefined) => elements(node).map(child => child.type)

describe('the app surfaces draw the desktop dialog look (#72)', () => {
  const field = { desktop: { marginBottom: 'sm' }, vscode: { marginBottom: 1 }, mobile: {} }
  for (const surface of APPS) {
    for (const multi of [true, false]) {
      test(`${surface}, ${multi ? 'multi-select' : 'single choice'}: a row per option, an Svg control beside the label Button alone, the description dim under the label, Other last`, async ($, on) => {
        world(on, { surfaces: [surface] })
        await $.session.start(START_EVENT)
        const id = await addChoice($, multi)
        const ui = await mount($, { ...PANE, surface })

        const group = (await ui.find({ key: `${id}:options` })) as Node | undefined
        expect(group?.type).toBe('Box')
        expect(spacing(group?.props)).toEqual(field[surface])
        // No rule between rows (0.2.5's were not drawn), and no fill or hover shade.
        expect(elements(group).map(child => String(child.props.key))).toEqual([
          `${id}:opt:0:row`, `${id}:opt:1:row`, `${id}:opt:2:row`, `${id}:opt:other:row`,
        ])

        for (const [index, option] of OPTIONS.entries()) {
          const row = (await ui.find({ key: `${id}:opt:${String(index)}:row` })) as Node | undefined
          expect(row?.props).toEqual({ key: `${id}:opt:${String(index)}:row`, flexDirection: 'column' })
          // The line: the control and the Button, and nothing else; no Box around the Button.
          const line = (await ui.find({ key: `${id}:opt:${String(index)}:line` })) as Node | undefined
          expect(line?.props).toEqual({ key: `${id}:opt:${String(index)}:line`, flexDirection: 'row', gap: 1 })
          expect(shape(line)).toEqual(['Svg', 'Button'])
          expect(elements(line)[0]?.props).toMatchObject({ source: controlSvg(multi, false), alt: controlAlt(multi, false), width: 16, height: 16 })
          const button = (await ui.find({ key: `${id}:opt:${String(index)}` })) as Node | undefined
          expect(button?.props.plain).toBe(true)
          // The label alone: no mark, no description, nothing but a string.
          expect(button?.props.label ?? button?.text).toBe(option.label)
          expect(elements(button)).toEqual([])
          const under = (await ui.find({ key: `${id}:opt:${String(index)}:under` })) as Node | undefined
          const about = (await ui.find({ key: `${id}:opt:${String(index)}:about` })) as Node | undefined
          if (option.description.trim() === '') {
            expect(under).toBeUndefined()
            expect(about).toBeUndefined()
            expect(shape(row)).toEqual(['Box'])
          } else {
            // Under the line, in a Box of its own: a spacer the control's width, then the description.
            expect(shape(row)).toEqual(['Box', 'Box'])
            expect(shape(under)).toEqual(['Svg', 'Box'])
            expect(elements(under)[0]?.props).toMatchObject({ source: SPACER_SVG, alt: '', width: 16, height: 1 })
            // The desktop's native button sets its label in by about a cell: the description matches it.
            expect(about?.props.paddingLeft).toBe(surface === 'desktop' ? 1 : 0)
            const text = elements(about)[0]
            expect(text?.type).toBe('Text')
            expect(text?.props.dimColor).toBe(true)
            expect(own(text)).toBe(option.description)
          }
        }
        // Other: the same control, closed, with no field.
        expect(shape((await ui.find({ key: `${id}:opt:other:line` })) as Node | undefined)).toEqual(['Svg', 'Button'])
        expect(((await ui.find({ key: `${id}:opt:other` })) as Node | undefined)?.props.label).toBe('Other')
        expect(await ui.find({ key: `${id}:other:field` })).toBeUndefined()

        // Pressed by the unchanged key, the control follows; an option with a description presses too.
        const control = async (n: number | 'other') => elements((await ui.find({ key: `${id}:opt:${String(n)}:line` })) as Node | undefined)[0]?.props.alt
        await ui.press({ key: `${id}:opt:1` })
        expect(await control(1)).toBe(controlAlt(multi, true))
        await ui.press({ key: `${id}:opt:0` })
        expect(await control(0)).toBe(controlAlt(multi, true))
        // A multi-select keeps both; a single choice moves the pick.
        expect(await control(1)).toBe(controlAlt(multi, multi))
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

describe('Other on the app surfaces is a row that opens its field (#72)', () => {
  for (const surface of APPS) {
    test(`${surface}: pressing Other opens the field in its row; pressing it again closes it and clears the text`, async ($, on) => {
      world(on, { surfaces: [surface] })
      await $.session.start(START_EVENT)
      const id = await addChoice($, true)
      const ui = await mount($, { ...PANE, surface })
      await ui.press({ key: `${id}:opt:other` })
      // The field is under the line, not beside the Button: the Button keeps its line to itself.
      expect(shape((await ui.find({ key: `${id}:opt:other:line` })) as Node | undefined)).toEqual(['Svg', 'Button'])
      const under = (await ui.find({ key: `${id}:opt:other:under` })) as Node | undefined
      expect(elements(under).map(child => child.props.key ?? child.type)).toEqual(['Svg', `${id}:other:field`])
      expect((await ui.find({ key: `${id}:other` }))?.type).toBe('Input')
      const control = async () => elements((await ui.find({ key: `${id}:opt:other:line` })) as Node | undefined)[0]?.props.alt
      expect(await control()).toBe(controlAlt(true, true))
      await ui.input({ key: `${id}:other`, text: 'Teal', kind: 'change' })
      await ui.press({ key: `${id}:opt:other` })
      expect(await ui.find({ key: `${id}:other:field` })).toBeUndefined()
      expect(elements((await ui.find({ key: `${id}:opt:other:line` })) as Node | undefined)[0]?.props.alt).toBe(controlAlt(true, false))
      // Opened again, the field is empty.
      await ui.press({ key: `${id}:opt:other` })
      expect((await ui.find({ key: `${id}:other` }))?.props.value).toBe('')
      await ui.unmount()
    })
  }

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
    expect(elements((await ui.find({ key: `${id}:opt:1:line` })) as Node | undefined)[0]?.props.alt).toBe(controlAlt(false, false))
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

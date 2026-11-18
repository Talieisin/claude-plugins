// The surface rules (#67) fail on the faulty trees #64 found by eye, pass on
// today's drawings, leave the terminal alone, and are held by `mount` itself.

import type { On } from 'claude-code'
import { type Engine, describe, expect, test } from 'claude-code/testing'

import { RULES, mount, surfaceFaults } from './surface-rules'
import { ADD, PANE, START_EVENT, answerOf, world } from './world'

const APPS = ['desktop', 'vscode', 'mobile'] as const

const OPTIONS = [
  { label: 'Plugin validate', description: 'Run claude plugin validate' },
  { label: 'Shell syntax', description: 'Run bash -n' },
]

/** One option as 0.2.1 drew it on every surface: the tree #64 removed from the app surfaces. */
const OPTION_0_2_1 = {
  type: 'Box',
  props: { key: 'card' },
  children: [
    {
      type: 'Button',
      props: { key: 'X:opt:0', plain: true },
      children: ['[ ]', ' ', 'Plugin validate', ' ', { type: 'Text', props: { dimColor: true }, children: ['Run claude plugin validate'] }],
    },
  ],
}

const rulesIn = (faults: string[]) => [...new Set(faults.map(fault => fault.split(' ')[0]))].sort()

async function addChoice($: Engine, multiSelect: boolean) {
  const question = multiSelect ? 'Which checks?' : 'Which one check?'
  return answerOf<{ id: string }>(await $.tool.call({ tool: ADD, type: 'choice', header: 'Checks', question, options: OPTIONS, multiSelect })).id
}

/** Whether a promise rejects, and with what message. */
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => '',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )

describe('each rule fails on the faulty #64 tree', () => {
  test('every rule names the fault it came from', () => {
    expect(RULES.map(rule => [rule.name, rule.from])).toEqual([
      ['no-ignored-style-in-button', '#64'],
      ['no-terminal-marks', '#64'],
      ['button-label-is-its-text', '#64'],
      ['svg-has-height', '#72'],
      ['control-beside-its-button', '#72'],
      ['no-text-colour-as-fill', '#72'],
      ['button-alone-in-a-stretched-box', '#72'],
    ])
  })

  for (const surface of APPS) {
    test(`${surface}: a 0.2.1 option fails both rules, naming the option's key`, () => {
      const faults = surfaceFaults(OPTION_0_2_1, surface)
      expect(rulesIn(faults)).toEqual(['no-ignored-style-in-button', 'no-terminal-marks'])
      for (const fault of faults) expect(fault).toContain('at X:opt:0:')
    })
  }

  test('the terminal is not checked', () => {
    expect(surfaceFaults(OPTION_0_2_1, 'terminal')).toEqual([])
  })

  for (const multi of [true, false]) {
    test(`the real terminal drawing of a ${multi ? 'multi-select' : 'single choice'}, checked as an app surface, fails both rules on every option`, async ($, on) => {
      world(on)
      await $.session.start(START_EVENT)
      const id = await addChoice($, multi)
      const ui = await mount($, { ...PANE, surface: 'terminal' })
      const tree = await ui.drawn()
      for (const surface of APPS) {
        const faults = surfaceFaults(tree, surface)
        expect(rulesIn(faults)).toEqual(['no-ignored-style-in-button', 'no-terminal-marks'])
        for (const index of [0, 1]) {
          const at = faults.filter(fault => fault.includes(` at ${id}:opt:${String(index)}:`))
          expect(rulesIn(at)).toEqual(['no-ignored-style-in-button', 'no-terminal-marks'])
        }
      }
      await ui.unmount()
    })
  }

  for (const surface of APPS) {
    test(`${surface}: today's drawing of both choices passes, picked and not`, async ($, on) => {
      world(on, { surfaces: [surface] })
      await $.session.start(START_EVENT)
      const multi = await addChoice($, true)
      const single = await addChoice($, false)
      const ui = await mount($, { ...PANE, surface })
      expect(surfaceFaults(await ui.drawn(), surface)).toEqual([])
      await ui.press({ key: `${multi}:opt:0` })
      await ui.press({ key: `${single}:opt:1` })
      expect(surfaceFaults(await ui.drawn(), surface)).toEqual([])
      await ui.unmount()
    })
  }
})

describe('the label rule: a Button draws its own text (#64, 0.2.3)', () => {
  /** One option as 0.2.3 drew it on the app surfaces: a label naming the state, which the desktop app drew in place of "○ Blue". */
  const OPTION_0_2_3 = {
    type: 'Box',
    props: { key: 'X:options' },
    children: [
      {
        type: 'Box',
        props: { key: 'X:opt:0:row', flexDirection: 'column' },
        children: [{ type: 'Button', props: { key: 'X:opt:0', label: 'Blue, not selected', plain: true }, children: ['○ Blue'] }],
      },
    ],
  }

  for (const surface of APPS) {
    test(`${surface}: a 0.2.3 option fails it alone, naming the option's key`, () => {
      const faults = surfaceFaults(OPTION_0_2_3, surface)
      expect(rulesIn(faults)).toEqual(['button-label-is-its-text'])
      expect(faults).toEqual([
        'button-label-is-its-text (#64) at X:opt:0: a label "Blue, not selected" the app draws in place of the children "○ Blue"',
      ])
    })
  }

  test('the terminal is not checked', () => {
    expect(surfaceFaults(OPTION_0_2_3, 'terminal')).toEqual([])
  })

  test('a label equal to its text, a label with no children, and children with no label pass', () => {
    const tree = {
      type: 'Box',
      props: { key: 'I:card' },
      children: [
        { type: 'Button', props: { key: 'I:a', label: '◉ Blue' }, children: ['◉ Blue'] },
        { type: 'Button', props: { key: 'I:b', label: 'Submit', variant: 'primary' } },
        { type: 'Button', props: { key: 'I:c', plain: true }, children: ['○ Green'] },
      ],
    }
    for (const surface of APPS) expect(surfaceFaults(tree, surface)).toEqual([])
  })
})

describe('the Svg rules (#72)', () => {
  const svg = (props: Record<string, unknown>) => ({ type: 'Svg', props: { source: '<svg/>', alt: '', ...props } })
  const card = (children: unknown[]) => ({ type: 'Box', props: { key: 'I:card' }, children })

  for (const surface of APPS) {
    test(`${surface}: the hairline as first written (no height) fails svg-has-height alone`, () => {
      const faults = surfaceFaults(card([svg({})]), surface)
      expect(rulesIn(faults)).toEqual(['svg-has-height'])
      expect(faults[0]).toContain('at I:card:')
    })

    test(`${surface}: a control alone in its row fails control-beside-its-button; beside its Button, or a Button deeper in the row, it passes`, () => {
      const control = svg({ alt: 'Radio button, not selected', height: 16 })
      const alone = card([{ type: 'Box', props: { key: 'I:opt:0:row' }, children: [control] }])
      expect(rulesIn(surfaceFaults(alone, surface))).toEqual(['control-beside-its-button'])
      const beside = card([
        {
          type: 'Box',
          props: { key: 'I:opt:0:row' },
          children: [control, { type: 'Box', props: { key: 'I:opt:0:text' }, children: [{ type: 'Button', props: { key: 'I:opt:0', label: 'Blue' } }] }],
        },
      ])
      expect(surfaceFaults(beside, surface)).toEqual([])
    })
  }

  test('a decorative Svg (no state in its alt) needs no Button; the terminal is not checked', () => {
    expect(surfaceFaults(card([svg({ height: 1 })]), 'desktop')).toEqual([])
    expect(surfaceFaults(card([svg({})]), 'terminal')).toEqual([])
  })
})

describe('the fill rule (#72, 0.2.5)', () => {
  /** The 0.2.5 header band, as it was drawn: filled with `subtle`. */
  const BAND_0_2_5 = {
    type: 'Box',
    props: { key: 'X:card', borderStyle: 'round' },
    children: [{ type: 'Box', props: { key: 'X:head', backgroundColor: 'subtle' }, children: [{ type: 'Text', props: { bold: true }, children: ['[Q] Which?'] }] }],
  }

  for (const surface of APPS) {
    test(`${surface}: the 0.2.5 header band fails it alone, naming the band's key`, () => {
      const faults = surfaceFaults(BAND_0_2_5, surface)
      expect(rulesIn(faults)).toEqual(['no-text-colour-as-fill'])
      expect(faults[0]).toContain('at X:head:')
    })
  }

  test('a hover fill with a text colour fails; a raw colour, or no fill, passes; the terminal is not checked', () => {
    const row = (props: Record<string, unknown>) => ({ type: 'Box', props: { key: 'X:row', ...props }, children: [] })
    expect(rulesIn(surfaceFaults(row({ hover: { backgroundColor: 'inactive' } }), 'desktop'))).toEqual(['no-text-colour-as-fill'])
    expect(surfaceFaults(row({ backgroundColor: '#f5f5f5' }), 'desktop')).toEqual([])
    expect(surfaceFaults(row({}), 'vscode')).toEqual([])
    expect(surfaceFaults(BAND_0_2_5, 'terminal')).toEqual([])
  })
})

describe('the dead-press rule (#72, 0.2.5)', () => {
  /** One option and Other, open, as 0.2.5 drew them on the desktop app (its snapshot). */
  const column = (key: string, children: unknown[]) => ({ type: 'Box', props: { key, flexDirection: 'column', flexGrow: 1, alignItems: 'stretch' }, children })
  const control = { type: 'Svg', props: { source: '<svg/>', alt: 'Radio button, not selected', width: 16, height: 16 } }
  const ROWS_0_2_5 = {
    type: 'Box',
    props: { key: 'X:options', flexDirection: 'column' },
    children: [
      {
        type: 'Box',
        props: { key: 'X:opt:0:row', flexDirection: 'row' },
        children: [
          control,
          column('X:opt:0:text', [
            { type: 'Button', props: { key: 'X:opt:0', plain: true }, children: ['Squash'] },
            { type: 'Box', props: { key: 'X:opt:0:about' }, children: [{ type: 'Text', props: { dimColor: true }, children: ['One commit'] }] },
          ]),
        ],
      },
      {
        type: 'Box',
        props: { key: 'X:opt:1:row', flexDirection: 'row' },
        children: [control, column('X:opt:1:text', [{ type: 'Button', props: { key: 'X:opt:1', plain: true }, children: ['Green'] }])],
      },
      {
        type: 'Box',
        props: { key: 'X:opt:other:row', flexDirection: 'row' },
        children: [
          control,
          column('X:opt:other:text', [
            { type: 'Button', props: { key: 'X:opt:other', plain: true }, children: ['Other'] },
            { type: 'Box', props: { key: 'X:other:field' }, children: [{ type: 'Input', props: { key: 'X:other' } }] },
          ]),
        ],
      },
    ],
  }

  for (const surface of APPS) {
    test(`${surface}: 0.2.5's rows fail it on the option with a description and on Other open, not on the option alone in its column`, () => {
      const faults = surfaceFaults(ROWS_0_2_5, surface)
      expect(rulesIn(faults)).toEqual(['button-alone-in-a-stretched-box'])
      expect(faults.map(fault => fault.split(' at ')[1]?.split(':').slice(0, -1).join(':'))).toEqual(['X:opt:0', 'X:opt:other'])
    })
  }

  test('a Button alone in a stretched Box, or beside others in a plain one, passes; the terminal is not checked', () => {
    const plain = { type: 'Box', props: { key: 'X:line', flexDirection: 'row' }, children: [control, { type: 'Button', props: { key: 'X:b' }, children: ['B'] }] }
    expect(surfaceFaults(plain, 'desktop')).toEqual([])
    expect(surfaceFaults(column('X:c', [{ type: 'Button', props: { key: 'X:b' }, children: ['B'] }]), 'desktop')).toEqual([])
    expect(surfaceFaults(ROWS_0_2_5, 'terminal')).toEqual([])
  })
})

describe('the marks rule: controls, not content', () => {
  const card = (children: unknown[]) => ({ type: 'Box', props: { key: 'I:card' }, children })

  test('a mark later in a Button, or in a label after the start, is an option label of its own', () => {
    const tree = card([{ type: 'Button', props: { key: 'I:opt:0', label: '☐ Keep [x] as typed', plain: true }, children: ['☐ Keep [x] as typed'] }])
    expect(surfaceFaults(tree, 'desktop')).toEqual([])
  })

  test("a mark at the start of a Button's label fails", () => {
    const tree = card([{ type: 'Button', props: { key: 'I:opt:0', label: '(•) One' } }])
    expect(rulesIn(surfaceFaults(tree, 'vscode'))).toEqual(['no-terminal-marks'])
  })

  test('a task list in a body, an answer part or a note is content and passes', () => {
    const tree = card([
      { type: 'Text', props: { bold: true }, children: ['[x] header'] },
      { type: 'Markdown', props: { key: 'I:body', text: '- [ ] one\n- [x] two' } },
      { type: 'Box', props: { key: 'I:body' }, children: [{ type: 'Markdown', props: { key: 'I:body:0', text: '[ ] one' } }] },
      { type: 'Markdown', props: { key: 'I:full:Answer', text: '( ) a' } },
      { type: 'Markdown', props: { key: 'v:I:Notes:2', text: '[x] b' } },
      { type: 'Text', props: { key: 'I:answer' }, children: ['[ ] the person typed this'] },
    ])
    expect(surfaceFaults(tree, 'mobile')).toEqual([])
  })

  test('a control drawn as Markdown, or a mark in a Text among the options, fails', () => {
    const tree = card([
      { type: 'Markdown', props: { key: 'I:choices', text: 'Pick:\n- [ ] one' } },
      { type: 'Box', props: { key: 'I:options' }, children: [{ type: 'Text', children: ['( ) two'] }] },
    ])
    const faults = surfaceFaults(tree, 'desktop')
    expect(faults).toHaveLength(2)
    expect(faults[0]).toContain('at I:choices:')
    expect(faults[1]).toContain('at I:options:')
  })

  test('a Text without dimColor inside a Button passes the style rule', () => {
    const tree = card([{ type: 'Button', props: { key: 'I:x' }, children: ['A ', { type: 'Text', props: { bold: true }, children: ['b'] }] }])
    expect(surfaceFaults(tree, 'desktop')).toEqual([])
  })
})

describe('mount holds every drawing to the rules', () => {
  /**
   * A test-only pane: a plain Button until `faulty.now` is set, then a 0.2.1
   * option. A test's own hooks may not call `$.ui.invalidate`, so the change
   * is drawn by `redraw`, an act like any other.
   */
  const faultyPane = (on: On, faulty: { now: boolean }) => {
    on('ui.render', { component: 'Pane', requestId: 'faulty' }, ($, e) => {
      const { Box, Button, Text } = $.ui.resolve(e)
      if (!faulty.now) {
        return (
          <Box>
            <Button key="fine" label="Fine" onPress={() => undefined} />
          </Box>
        )
      }
      return (
        <Box>
          <Button key="old:opt:0" plain onPress={() => undefined}>
            [ ] Old <Text dimColor>description</Text>
          </Button>
        </Box>
      )
    })
  }
  // Hooks a test adds are the test's own plugin's, named `test`.
  const FAULTY = { ...PANE, plugin: 'test', requestId: 'faulty' }

  for (const surface of APPS) {
    test(`${surface}: a faulty drawing rejects the mount, naming both rules and the key`, async ($, on) => {
      faultyPane(on, { now: true })
      const message = await rejection(mount($, { ...FAULTY, surface }))
      expect(message).toContain(`surface rules on ${surface}, after the mount`)
      expect(message).toContain('no-ignored-style-in-button (#64) at old:opt:0')
      expect(message).toContain('no-terminal-marks (#64) at old:opt:0')
    })
  }

  test('a drawing that turns faulty rejects the act that drew it, and every read and the unmount after it', async ($, on) => {
    const faulty = { now: false }
    faultyPane(on, faulty)
    const ui = await mount($, { ...FAULTY, surface: 'desktop' })
    expect(await ui.find({ key: 'fine' })).toBeDefined()
    faulty.now = true
    expect(await rejection(ui.redraw())).toContain('after redraw')
    expect(await rejection(ui.find({ key: 'old:opt:0' }))).toContain('before find')
    expect(await rejection(ui.findAll({ type: 'Button' }))).toContain('before findAll')
    expect(await rejection(ui.drawn())).toContain('before drawn')
    expect(await rejection(ui.unmount())).toContain('before unmount')
  })

  test('the terminal draws the 0.2.1 option unchecked', async ($, on) => {
    faultyPane(on, { now: true })
    const ui = await mount($, { ...FAULTY, surface: 'terminal' })
    expect((await ui.find({ key: 'old:opt:0' }))?.text).toContain('[ ] Old')
    await ui.unmount()
  })

  test("a failed act rejects with its own error, unchanged", async ($, on) => {
    faultyPane(on, { now: false })
    const ui = await mount($, { ...FAULTY, surface: 'mobile' })
    let direct = ''
    try {
      await ui.press({ key: 'no-such-button' })
    } catch (error) {
      direct = error instanceof Error ? error.message : String(error)
    }
    expect(direct).not.toBe('')
    expect(direct).not.toContain('surface rules')
    await ui.unmount()
  })
})

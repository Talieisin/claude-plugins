// Per-surface snapshots of each card state (#67): the open card's drawn tree
// as compact text (tree-dump.ts), against the expected strings beside this
// file in card-snapshots.ts. A change to how a card draws shows as a diff of
// those strings; a pull request that changes them lists the surfaces and
// states in its body, and its reader checks each against the issue.
//
// The kit has no file system, so a changed snapshot is copied by hand: the
// failing test's message shows the drawing as it is now.

import { describe, expect, test } from 'claude-code/testing'

import { CARD_STATES, EXPECTED, SNAPSHOT_SURFACES, snapshotName } from './card-snapshots'
import { mount } from './surface-rules'
import { dump, subtree } from './tree-dump'
import { ADD, PANE, START_EVENT, answerOf, world } from './world'

describe('card snapshots', () => {
  for (const surface of SNAPSHOT_SURFACES) {
    for (const state of CARD_STATES) {
      const name = snapshotName(surface, state.name)
      test(name, async ($, on) => {
        world(on, { surfaces: [surface] })
        await $.session.start(START_EVENT)
        const id = answerOf<{ id: string }>(await $.tool.call({ ...state.call, tool: ADD })).id
        const ui = await mount($, { ...PANE, surface })
        for (const press of state.presses ?? []) await ui.press({ key: `${id}:${press}` })
        const card = subtree(await ui.drawn(), `${id}:card`)
        expect(card).toBeDefined()
        expect(dump(card)).toBe(EXPECTED[name] ?? '(no snapshot yet)')
        await ui.unmount()
      })
    }
  }

  test('every snapshot belongs to a state and a surface', () => {
    const names = SNAPSHOT_SURFACES.flatMap(surface => CARD_STATES.map(state => snapshotName(surface, state.name)))
    expect(Object.keys(EXPECTED).sort()).toEqual([...names].sort())
  })
})

describe('the dump', () => {
  test('one element a line, props sorted, key first, functions and undefined dropped, ids steadied', () => {
    const tree = {
      type: 'Box',
      props: { key: '01MCC5RM001H19Q3BY4GGW8XYH:card', padding: 'sm', borderStyle: 'round', onPress: () => undefined, gone: undefined },
      children: [
        { type: 'Text', props: { bold: true }, children: ['[', 'H', '] ', 'Q?'] },
        { type: 'Text', props: { dimColor: true }, children: ['HT-W8XYH', '', ''] },
        { type: 'Button', props: { key: 'b', plain: true }, children: ['[ ] A ', { type: 'Text', props: { dimColor: true }, children: ['line\nnext'] }] },
      ],
    }
    expect(dump(tree)).toBe(
      [
        'Box #<id>:card borderStyle="round" padding="sm"',
        '  Text bold=true "[H] Q?"',
        '  Text dimColor=true "HT-<short>"',
        '  Button #b plain=true',
        '    "[ ] A "',
        '    Text dimColor=true "line\\nnext"',
      ].join('\n'),
    )
  })
})

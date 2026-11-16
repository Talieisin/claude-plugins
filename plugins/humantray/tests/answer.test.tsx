// Answering in the pane: what each type stores, notes, empty and conflicting
// answers, two cards of one type, and the compare-and-set on `open`.

import { describe, expect, test } from 'claude-code/testing'

import type { Item, ItemResponse } from '../types'
import { ADD, answerOf, FILE, PANE, START_EVENT, type Step, answerOne, stored, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const

const OPTIONS = [
  { label: 'Red', description: 'Warm' },
  { label: 'Blue', description: 'Cool' },
  { label: 'Green', description: 'Fresh' },
]

const CASES: Array<[string, Record<string, unknown>, Step[], ItemResponse, Item['status']]> = [
  ['ack', { type: 'ack', header: 'FYI', question: 'Deployed' }, [{ press: 'ack' }], { acknowledged: true }, 'acknowledged'],
  [
    'choice, single',
    { type: 'choice', header: 'Colour', question: 'Which?', options: OPTIONS },
    [{ press: 'opt:1' }, { press: 'submit' }],
    { selected: ['Blue'] },
    'answered',
  ],
  [
    'choice, single, Other only',
    { type: 'choice', header: 'Colour', question: 'Which?', options: OPTIONS },
    [{ change: 'other', text: 'Purple' }, { press: 'submit' }],
    { selected: [], other: 'Purple' },
    'answered',
  ],
  [
    'choice, multi with Other',
    { type: 'choice', header: 'Colour', question: 'Which?', options: OPTIONS, multiSelect: true },
    [{ press: 'opt:0' }, { press: 'opt:2' }, { press: 'opt:1' }, { press: 'opt:1' }, { type: 'other', text: 'Teal' }, { press: 'submit' }],
    { selected: ['Red', 'Green'], other: 'Teal' },
    'answered',
  ],
  [
    'question (Enter submits)',
    { type: 'question', header: 'Name', question: 'What name?' },
    [{ type: 'text', text: '  humantray  ' }],
    { text: 'humantray' },
    'answered',
  ],
  ['do, done', { type: 'do', header: 'Key', question: 'Rotate' }, [{ press: 'done' }], { outcome: 'done' }, 'done'],
  [
    'do, not done with feedback',
    { type: 'do', header: 'Key', question: 'Rotate' },
    [{ change: 'feedback', text: 'No access' }, { press: 'not_done' }],
    { outcome: 'not_done', feedback: 'No access' },
    'done',
  ],
  ['approve, Approve', { type: 'approve', header: 'Plan', question: 'OK?' }, [{ press: 'approve' }], { selected: ['Approve'] }, 'answered'],
  ['approve, Reject', { type: 'approve', header: 'Plan', question: 'OK?' }, [{ press: 'reject' }], { selected: ['Reject'] }, 'answered'],
]

describe('each type stores its response', () => {
  for (const [name, call, steps, response, status] of CASES) {
    for (const surface of SURFACES) {
      test(`${name}, on ${surface}`, async ($, on) => {
        const w = world(on, { surfaces: [surface] })
        await $.session.start(START_EVENT)
        const item = await answerOne($, w, surface, call, steps)
        expect(item.response).toEqual(response)
        expect(item.status).toBe(status)
        expect(item.response_at).toBe(w.clock.now())
      })
    }
  }
})

describe('notes', () => {
  for (const [name, call, steps, response] of CASES) {
    test(`${name}: with notes: true the answer carries the notes`, async ($, on) => {
      const w = world(on)
      await $.session.start(START_EVENT)
      const item = await answerOne($, w, 'desktop', { ...call, notes: true }, [{ change: 'notes', text: ' see the log ' }, ...steps])
      expect(item.response).toEqual({ ...response, notes: 'see the log' })
    })
  }

  test('notes: false draws no notes field', async ($, on) => {
    world(on)
    await $.session.start(START_EVENT)
    const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q', notes: false })
    const id = answerOf<{ id: string }>(added).id
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ key: `${id}:notes` })).toBeUndefined()
    expect(await ui.find({ key: `${id}:ack` })).toBeDefined()
    await ui.unmount()
  })

  test('an empty notes or feedback box leaves the field out', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const item = await answerOne(
      $,
      w,
      'desktop',
      { type: 'do', header: 'Key', question: 'Rotate', notes: true },
      [{ change: 'notes', text: '   ' }, { change: 'feedback', text: '' }, { press: 'done' }],
    )
    expect(item.response).toEqual({ outcome: 'done' })
  })
})

describe('empty and conflicting answers', () => {
  test('a choice with nothing picked stores nothing and says so on the card', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const added = await $.tool.call({ tool: ADD, type: 'choice', header: 'C', question: 'Which?', options: OPTIONS })
    const id = answerOf<{ id: string }>(added).id
    const before = w.files.get(FILE)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:submit` })
    expect(await ui.find({ type: 'Text', text: 'Pick an option or fill in Other.' })).toBeDefined()
    expect(w.files.get(FILE)).toBe(before)
    expect(w.submits).toEqual([])
    await ui.unmount()
  })

  test('an empty question stores nothing and says so on the card', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const added = await $.tool.call({ tool: ADD, type: 'question', header: 'Q', question: 'Name?' })
    const id = answerOf<{ id: string }>(added).id
    const before = w.files.get(FILE)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.input({ key: `${id}:text`, text: '  ' })
    expect(await ui.find({ type: 'Text', text: 'Type an answer.' })).toBeDefined()
    expect(w.files.get(FILE)).toBe(before)
    await ui.unmount()
  })

  test('single choice: an option then Other text keeps Other alone', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const item = await answerOne(
      $,
      w,
      'desktop',
      { type: 'choice', header: 'C', question: 'Which?', options: OPTIONS },
      [{ press: 'opt:0' }, { change: 'other', text: 'Mauve' }, { press: 'submit' }],
    )
    expect(item.response).toEqual({ selected: [], other: 'Mauve' })
  })

  test('single choice: Other text then an option keeps the option alone', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const item = await answerOne(
      $,
      w,
      'desktop',
      { type: 'choice', header: 'C', question: 'Which?', options: OPTIONS },
      [{ change: 'other', text: 'Mauve' }, { press: 'opt:2' }, { press: 'submit' }],
    )
    expect(item.response).toEqual({ selected: ['Green'] })
  })

  test('a bump that drops a selected option: the stored answer holds current labels only', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const call = { type: 'choice', header: 'C', question: 'Which?', options: OPTIONS, multiSelect: true, key: 'c' }
    const added = await $.tool.call({ ...call, tool: ADD })
    const id = answerOf<{ id: string }>(added).id
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:opt:0` })
    await ui.press({ key: `${id}:opt:1` })
    await $.tool.call({ ...call, tool: ADD, options: OPTIONS.slice(1) })
    await ui.press({ key: `${id}:submit` })
    await ui.unmount()
    expect(w.store().items[0]?.response).toEqual({ selected: ['Blue'] })
  })
})

describe('cards', () => {
  for (const [type, control, response] of [
    ['approve', 'approve', { selected: ['Approve'] }],
    ['do', 'done', { outcome: 'done' }],
  ] as const) {
    test(`two open ${type} items: pressing the second card changes only the second`, async ($, on) => {
      const w = world(on)
      await $.session.start(START_EVENT)
      const first = await $.tool.call({ tool: ADD, type, header: 'One', question: 'First' })
      const second = await $.tool.call({ tool: ADD, type, header: 'Two', question: 'Second' })
      const firstId = answerOf<{ id: string }>(first).id
      const secondId = answerOf<{ id: string }>(second).id
      const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
      expect(await ui.findAll({ type: 'Button', key: `${firstId}:${control}` })).toHaveLength(1)
      await ui.press({ key: `${secondId}:${control}` })
      await ui.unmount()
      const items = w.store().items
      expect(items.find(item => item.id === secondId)?.response).toEqual(response)
      expect(items.find(item => item.id === firstId)?.status).toBe('open')
    })
  }

  test('a card for another session says so', async ($, on) => {
    const w = world(on)
    w.seed({ version: 1, items: [stored({ id: '01AAAAAAAAAAAAAAAAAAAAOTHER', type: 'ack', session_id: 'session-b' })], sessions: {} })
    await $.session.start(START_EVENT)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /another session/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('compare-and-set', () => {
  test('an item already answered on disk: file byte-identical, no submit, the card goes, a toast', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const added = await $.tool.call({ tool: ADD, type: 'approve', header: 'Plan', question: 'OK?' })
    const id = answerOf<{ id: string }>(added).id
    // Another pane answered it; this session's cache still shows it open.
    const file = w.store()
    const item = file.items[0]
    if (item === undefined) throw new Error('no item')
    item.status = 'answered'
    item.response = { selected: ['Reject'] }
    item.delivered = true
    w.seed(file)
    const before = w.files.get(FILE)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:approve` })
    expect(w.files.get(FILE)).toBe(before)
    expect(w.submits).toEqual([])
    expect(w.toasts.at(-1)).toBe(`HT-${id.slice(-5)} was already answered`)
    expect(await ui.find({ key: `${id}:approve` })).toBeUndefined()
    await ui.unmount()
  })

  test('a store that became unreadable: the press shows the error, the file byte-identical', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const added = await $.tool.call({ tool: ADD, type: 'approve', header: 'Plan', question: 'OK?' })
    const id = answerOf<{ id: string }>(added).id
    w.seed('{"version": 9}')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:approve` })
    expect(await ui.find({ type: 'Text', text: /is unreadable/ })).toBeDefined()
    expect(w.files.get(FILE)).toBe('{"version": 9}')
    expect(w.submits).toEqual([])
    await ui.unmount()
  })
})

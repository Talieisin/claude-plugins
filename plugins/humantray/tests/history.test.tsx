// History and pruning, through the mod as the engine runs it: a ticked item
// leaves the open list and appears in History; pruning keeps the last 200
// finished items per repository, inside the store's locked change, and never
// a protected item.

import { type Mounted, describe, expect, test } from 'claude-code/testing'

import type { Item, StoreFile } from '../types'
import {
  ADD,
  BAND,
  FILE,
  HOUR,
  PANE,
  START,
  START_EVENT,
  TURN,
  answerOf,
  finished,
  finishedMany,
  oldestOfMany,
  stored,
  world,
} from './world'
import { mount } from './surface-rules'

const OTHER = 'github.com/owner/other'
const TOGGLE = 'humantray:view'

const OPTIONS = [
  { label: 'Red', description: 'Warm' },
  { label: 'Blue', description: 'Cool' },
]

const file = (items: Item[], sessions: StoreFile['sessions'] = {}): StoreFile => ({ version: 1, items, sessions })

/** An item of `session-z`, a session that is not running: nobody here delivers it. */
const owed = (n: number, fields: Partial<Item> = {}) =>
  finished(n, { session_id: 'session-z', delivered: false, delivered_at: undefined, ...fields })

describe('a ticked item leaves the main list and appears in History', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`on ${surface}`, async ($, on) => {
      const w = world(on, { surfaces: [surface] })
      await $.session.start(START_EVENT)
      const call = { tool: ADD, type: 'choice', header: 'Colour', question: 'Which?', options: OPTIONS, notes: true, key: 'colour' } as const
      const id = answerOf<{ id: string }>(await $.tool.call(call)).id
      await $.tool.call(call)
      const ui = await mount($, { ...PANE, surface })
      expect((await ui.find({ key: TOGGLE }))?.props.label).toBe('History (0)')
      expect(await ui.find({ key: `${id}:submit` })).toBeDefined()

      await ui.press({ key: `${id}:opt:0` })
      await ui.input({ key: `${id}:notes`, text: 'see the log', kind: 'change' })
      await ui.press({ key: `${id}:submit` })

      expect(await ui.find({ key: `${id}:submit` })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: 'No open items.' })).toBeDefined()
      expect((await ui.find({ key: TOGGLE }))?.props.label).toBe('History (1)')

      await ui.press({ key: TOGGLE })
      expect(await ui.find({ type: 'Text', text: '[Colour] Which?' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^Red$/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Notes:' })).toBeDefined()
      expect((await ui.find({ key: `${id}:Notes` }))?.props.text).toBe('see the log')
      const line = await ui.find({ type: 'Text', text: /^HT-/ })
      expect(line?.text).toMatch(/bumps: 1 · delivered$/)
      expect(line?.text).not.toMatch(/another session/)
      // Read only: the toggle is the one control; nothing reopens the item.
      expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual([TOGGLE])
      expect((await ui.find({ key: TOGGLE }))?.props.label).toBe('Open items (0)')

      await ui.press({ key: TOGGLE })
      expect(await ui.find({ type: 'Text', text: 'No open items.' })).toBeDefined()
      await ui.unmount()
      expect(w.store().items[0]?.status).toBe('answered')
    })
  }

  test('a dropped submit reads "not delivered" straight after the answer, with no pass between', async ($, on) => {
    const w = world(on)
    w.answerSubmit = () => ({ drop: 'the prompt was removed from the queue before it ran' })
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call({ tool: ADD, type: 'approve', header: 'Plan', question: 'OK?' })).id
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:approve` })
    await ui.press({ key: TOGGLE })
    expect((await ui.find({ type: 'Text', text: /^HT-/ }))?.text).toMatch(/ · not delivered$/)
    expect(w.submits).toHaveLength(1)
    await ui.unmount()
  })
})

describe('History', () => {
  test('newest first, ties by id, open items left out; "another session" only for another session\'s item', async ($, on) => {
    const w = world(on)
    w.seed(
      file(
        [
          finished(3, { header: 'Mine', response_at: START - 3_000 }),
          finished(1, { header: 'Inherited', session_id: 'session-old', response_at: START - 1_000 }),
          finished(5, { header: 'Theirs', session_id: 'session-b', response_at: START - 1_000 }),
          stored({ id: '01OPEN00000000000000000000', type: 'ack', header: 'Open', updated: START }),
        ],
        { 'session-old': { seen: START - HOUR, successor: 'session-a' } },
      ),
    )
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: TOGGLE })
    const titles = (await ui.findAll({ type: 'Text', text: /^\[/ })).map(t => t.text)
    expect(titles).toEqual([`[Theirs] Seeded ${finished(5).id}`, `[Inherited] Seeded ${finished(1).id}`, `[Mine] Seeded ${finished(3).id}`])
    const another = await ui.findAll({ type: 'Text', text: /another session/ })
    expect(another.map(t => t.text?.slice(0, 8))).toEqual([finished(5).short])
    await ui.unmount()
  })

  test('the marks: delivered, delivering, a stale claim, never collected, and no mark when no line is due', async ($, on) => {
    const w = world(on)
    w.seed(
      file([
        finished(1, { session_id: 'session-z' }),
        owed(2, { delivering_at: START - 10_000, delivering_by: 'x/1' }),
        owed(3, { delivering_at: START - 61_000, delivering_by: 'gone/1' }),
        owed(4),
        owed(5, { type: 'ack', status: 'acknowledged', response: { acknowledged: true }, options: undefined }),
        finished(6, { type: 'ack', status: 'acknowledged', response: { acknowledged: true }, options: undefined }),
        finished(7, { type: 'ack', status: 'acknowledged', response: { acknowledged: true }, options: undefined, notify_on_done: true }),
      ]),
    )
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: TOGGLE })
    const lines = new Map((await ui.findAll({ type: 'Text', text: /^HT-/ })).map(t => [t.text?.slice(0, 8), t.text ?? '']))
    expect(lines.get(finished(1).short)).toMatch(/ · delivered$/)
    expect(lines.get(finished(2).short)).toMatch(/ · delivering$/)
    expect(lines.get(finished(3).short)).toMatch(/ · not delivered$/)
    expect(lines.get(finished(4).short)).toMatch(/ · not delivered$/)
    expect(lines.get(finished(5).short)).toMatch(/bumps: 0$/)
    // An FYI the owner's pass flagged delivered still owes no line: no mark.
    expect(lines.get(finished(6).short)).toMatch(/bumps: 0$/)
    expect(lines.get(finished(7).short)).toMatch(/ · delivered$/)
    await ui.unmount()
  })

  test('every repo value, under headings, this repository first; the count is the whole', async ($, on) => {
    const w = world(on)
    w.seed(file([...finishedMany(5, { repo: OTHER }), ...finishedMany(3, {}, 100)]))
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect((await ui.find({ key: TOGGLE }))?.props.label).toBe('History (8)')
    await ui.press({ key: TOGGLE })
    const headings = await ui.findAll({ type: 'Text', text: /^github\.com\// })
    expect(headings.map(t => t.text)).toEqual(['github.com/owner/repo (this repository)', OTHER])
    const shorts = (await ui.findAll({ type: 'Text', text: /^HT-/ })).map(t => t.text?.slice(0, 8))
    expect(shorts.slice(0, 3).sort()).toEqual(finishedMany(3, {}, 100).map(item => item.short).sort())
    expect(shorts.slice(3).sort()).toEqual(finishedMany(5).map(item => item.short).sort())
    await ui.unmount()
  })

  test('one repository: no heading', async ($, on) => {
    const w = world(on)
    w.seed(file(finishedMany(3)))
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: TOGGLE })
    expect(await ui.find({ type: 'Text', text: /^github\.com\// })).toBeUndefined()
    expect(await ui.findAll({ type: 'Text', text: /^HT-/ })).toHaveLength(3)
    await ui.unmount()
  })

  test('an item of another repo value, ticked in this pane, appears in History under its heading', async ($, on) => {
    const w = world(on)
    const theirs = stored({ id: '01THEIRS000000000000000000', type: 'approve', repo: OTHER, header: 'Elsewhere' })
    w.seed(file([theirs]))
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `${theirs.id}:approve` })
    expect(await ui.find({ key: `${theirs.id}:approve` })).toBeUndefined()
    expect((await ui.find({ key: TOGGLE }))?.props.label).toBe('History (1)')
    await ui.press({ key: TOGGLE })
    expect((await ui.findAll({ type: 'Text', text: /^github\.com\// })).map(t => t.text)).toEqual([OTHER])
    expect(await ui.find({ type: 'Text', text: /^\[Elsewhere\]/ })).toBeDefined()
    await ui.unmount()
  })

  test('straight after a pruning pass the pruned ids are gone and the count matches what the pages show', async ($, on) => {
    const w = world(on)
    w.seed(file(finishedMany(203)))
    await $.session.start(START_EVENT)
    const pruned = oldestOfMany(203, 3)
    const kept = new Set(w.store().items.map(item => item.id))
    expect(pruned.some(id => kept.has(id))).toBe(false)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect((await ui.find({ key: TOGGLE }))?.props.label).toBe('History (200)')
    await ui.press({ key: TOGGLE })
    const shown = await allPages(ui)
    expect(shown.flat()).toHaveLength(200)
    expect(new Set(shown.flat()).size).toBe(200)
    for (const id of pruned) expect(shown.flat()).not.toContain(`HT-${id.slice(-5)}`)
    await ui.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`a 200-entry History of long text draws every entry across its pages, clipped at block boundaries, on ${surface}`, async ($, on) => {
      const w = world(on, { surfaces: [surface] })
      // Forty 99-character paragraphs: the list keeps the first four whole.
      const paragraphs = Array.from({ length: 40 }, (_, i) => `${String(i).padStart(2, '0')}${'a'.repeat(97)}`).join('\n\n')
      const long = finishedMany(200, {
        type: 'question',
        options: undefined,
        question: `Q ${'q'.repeat(499)}`,
        // Long enough to clip, and short enough for the store's 3 MiB read limit.
        response: { text: paragraphs, notes: 'n'.repeat(2_000) },
      })
      w.seed(file(long))
      await $.session.start(START_EVENT)
      const ui = await mount($, { ...PANE, surface })
      expect((await ui.find({ key: TOGGLE }))?.props.label).toBe('History (200)')
      await ui.press({ key: TOGGLE })
      const id = (await ui.find({ type: 'Text', text: /^HT-/ }))?.text.slice(3, 8) ?? ''
      const entry = long.find(item => item.id.endsWith(id))?.id ?? ''
      expect((await ui.find({ key: `${entry}:Answer` }))?.props.text).toBe(paragraphs.split('\n\n').slice(0, 4).join('\n\n'))
      expect(await ui.find({ type: 'Text', text: `(… cut short: ${String(paragraphs.length)} characters in all)` })).toBeDefined()
      // One paragraph longer than the budget: its first characters (no space to cut at), with an ellipsis.
      expect((await ui.find({ key: `${entry}:Notes` }))?.props.text).toBe(`${'n'.repeat(499)}…`)
      expect(await ui.find({ type: 'Text', text: '(… cut short: 2000 characters in all)' })).toBeDefined()
      expect((await ui.find({ type: 'Text', text: /^\[Done\] Q q+…$/ }))?.text).toHaveLength('[Done] '.length + 200)
      expect(await ui.findAll({ type: 'Button', text: 'Show in full' })).toHaveLength(50)
      const shown = await allPages(ui)
      expect(shown.map(one => one.length)).toEqual([50, 50, 50, 50])
      expect(new Set(shown.flat())).toEqual(new Set(long.map(item => item.short)))
      // And back: Previous from the last page shows the third.
      await ui.press({ key: 'humantray:history:previous' })
      expect(await ui.find({ type: 'Text', text: 'Page 3 of 4' })).toBeDefined()

      // Any entry is reachable in full: the question, the answer and the notes whole.
      const last = (await ui.findAll({ type: 'Text', text: /^HT-/ })).at(-1)?.text.slice(3, 8) ?? ''
      const item = long.find(one => one.id.endsWith(last))
      if (item === undefined) throw new Error('no entry on the page')
      await ui.press({ key: `${item.id}:full` })
      expect(await ui.find({ type: 'Text', text: `[Done] ${item.question}` })).toBeDefined()
      expect((await ui.find({ key: `${item.id}:full:Answer` }))?.props.text).toBe(paragraphs)
      expect((await ui.find({ key: `${item.id}:full:Notes` }))?.props.text).toBe('n'.repeat(2_000))
      expect(await ui.find({ key: `${item.id}:Answer` })).toBeUndefined()
      // Back returns to the same page of the list.
      await ui.press({ key: 'humantray:history:back' })
      expect(await ui.find({ type: 'Text', text: 'Page 3 of 4' })).toBeDefined()
      expect(await ui.find({ key: `${item.id}:full:Answer` })).toBeUndefined()
      await ui.unmount()
      // Nothing in the store was shortened.
      expect(w.store().items.find(one => one.id === item.id)?.response).toEqual({ text: paragraphs, notes: 'n'.repeat(2_000) })
    })
  }
})

/** Reads every History page from the first, pressing Next: the shorts on each page. */
async function allPages(ui: Pick<Mounted<'terminal' | 'desktop', 'Pane'>, 'find' | 'findAll' | 'press'>): Promise<string[][]> {
  const pages: string[][] = []
  for (;;) {
    pages.push((await ui.findAll({ type: 'Text', text: /^HT-/ })).map(t => t.text?.slice(0, 8) ?? ''))
    if ((await ui.find({ key: 'humantray:history:next' })) === undefined) return pages
    await ui.press({ key: 'humantray:history:next' })
  }
}

describe('a time no Date can hold', () => {
  test('response_at 1e20: History draws with a placeholder, every other entry too, and the toggle still works', async ($, on) => {
    const w = world(on)
    w.seed(file([finished(1, { response_at: 1e20 }), finished(2), stored({ id: '01OPEN00000000000000000000', type: 'ack', header: 'Open' })]))
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: TOGGLE })
    const lines = (await ui.findAll({ type: 'Text', text: /^HT-/ })).map(t => t.text ?? '')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(new RegExp(`^${finished(1).short} · answered at an unknown time · `))
    expect(lines[1]).toMatch(/ · answered \d{4}-\d\d-\d\d \d\d:\d\d UTC · /)
    await ui.press({ key: TOGGLE })
    expect(await ui.find({ type: 'Text', text: /^\[Open\]/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('pruning in the mod', () => {
  test('an add past 200 finished items removes exactly the oldest by response_at', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.seed(file(finishedMany(205)))
    const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'New' })
    expect(added.deny).toBeUndefined()
    const left = w.store().items
    expect(left).toHaveLength(201)
    expect(left.filter(item => item.status === 'open')).toHaveLength(1)
    const gone = finishedMany(205).map(item => item.id).filter(id => !left.some(item => item.id === id))
    expect(new Set(gone)).toEqual(new Set(oldestOfMany(205, 5)))
  })

  test('protected items neither count nor go, however old; an ack with no line due counts and can go', async ($, on) => {
    const w = world(on)
    const done = finishedMany(220)
    const open = Array.from({ length: 30 }, (_, i) =>
      stored({ id: `01OPN${String(i).padStart(21, '0')}`, type: 'ack', session_id: 'session-z', updated: START - 40 * HOUR }),
    )
    const due = Array.from({ length: 20 }, (_, i) => owed(1_000 + i, { response_at: START - 30 * HOUR }))
    const claimed = Array.from({ length: 10 }, (_, i) =>
      owed(2_000 + i, {
        delivering_at: i === 0 ? START - 2 * HOUR : START - 30_000,
        delivering_by: 'gone/1',
        response_at: START - 50 * HOUR - i,
      }),
    )
    const ack = owed(3_000, { type: 'ack', status: 'acknowledged', response: { acknowledged: true }, options: undefined, response_at: START - 60 * HOUR })
    w.seed(file([...claimed, ...done, ack, ...due, ...open]))
    await $.session.start(START_EVENT)
    await w.drain()
    const left = new Set(w.store().items.map(item => item.id))
    for (const item of [...open, ...due, ...claimed]) expect(left.has(item.id)).toBe(true)
    expect(left.has(ack.id)).toBe(false)
    const gone = done.filter(item => !left.has(item.id)).map(item => item.id)
    expect(new Set(gone)).toEqual(new Set(oldestOfMany(220, 20)))
    expect(w.store().items).toHaveLength(260)
    expect(w.submits).toEqual([])
  })

  test("this session's own answers: claimed and kept by the pass, delivered after, pruned at the next pass", async ($, on) => {
    const w = world(on)
    const mine = [0, 1, 2].map(i =>
      finished(700 + i, { delivered: false, delivered_at: undefined, response_at: START - 90 * HOUR + i }),
    )
    w.seed(file([...finishedMany(200), ...mine]))
    w.answerSubmit = async e => {
      await w.clock.sleep(1_000)
      return { text: e.text }
    }
    await $.session.start(START_EVENT)
    for (const item of mine) {
      const now = w.store().items.find(one => one.id === item.id)
      expect(now?.delivering_by).toBeDefined()
    }
    await w.clock.advance(2_000)
    for (const item of mine) expect(w.store().items.find(one => one.id === item.id)?.delivered).toBe(true)
    expect(w.store().items).toHaveLength(203)
    await $.turn.complete(TURN)
    const left = new Set(w.store().items.map(item => item.id))
    for (const item of mine) expect(left.has(item.id)).toBe(false)
    expect(w.store().items).toHaveLength(200)
  })

  test('two repo values: each keeps its own 200', async ($, on) => {
    const w = world(on)
    w.seed(file([...finishedMany(201, { repo: OTHER }), ...finishedMany(10, {}, 500)]))
    await $.session.start(START_EVENT)
    const items = w.store().items
    expect(items.filter(item => item.repo === OTHER)).toHaveLength(200)
    expect(items.filter(item => item.repo !== OTHER)).toHaveLength(10)
    expect(items.some(item => item.id === oldestOfMany(201, 1)[0])).toBe(false)
  })

  test('succession holds: a predecessor\'s owed answer is kept and delivered by its successor', async ($, on) => {
    const w = world(on, { sessionId: 'session-b' })
    const theirs = finished(600, { session_id: 'session-a', header: 'Plan', delivered: false, delivered_at: undefined, response_at: START - 99 * HOUR })
    w.seed(
      file([...finishedMany(250, { session_id: 'session-c' }), theirs], {
        'session-a': { seen: START - 40 * 24 * HOUR, successor: 'session-b' },
        'session-c': { seen: START - 40 * 24 * HOUR },
      }),
    )
    await $.session.start(START_EVENT)
    await w.drain()
    const after = w.store()
    expect(after.sessions['session-a']?.successor).toBe('session-b')
    expect(after.items.filter(item => item.session_id === 'session-c')).toHaveLength(200)
    expect(w.submits).toEqual([`humantray ${theirs.short} (Plan): Approve`])
    expect(after.items.find(item => item.id === theirs.id)?.delivered).toBe(true)
  })
})

describe('pruning writes nothing when the change is refused', () => {
  test('an add refused for a key held by another type prunes nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const open = stored({ id: '01OPEN00000000000000000000', type: 'question', key: 'k' })
    w.seed(file([...finishedMany(205), open]))
    const before = w.files.get(FILE)
    const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q', key: 'k' })
    expect(added.deny).toMatch(/already has this key/)
    expect(w.files.get(FILE)).toBe(before)
  })

  test('an add still past 2 MiB after pruning prunes nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const big = Array.from({ length: 110 }, (_, i) =>
      stored({ id: `01BIG${String(i).padStart(21, '0')}`, type: 'ack', session_id: 'session-z', body_md: 'x'.repeat(20_000) }),
    )
    w.seed(file([...finishedMany(201), ...big]))
    const before = w.files.get(FILE)
    const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q' })
    expect(added.deny).toMatch(/the store is full/)
    expect(w.files.get(FILE)).toBe(before)
  })

  test('a pass whose write fails prunes nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.seed(file(finishedMany(205)))
    const before = w.files.get(FILE)
    w.failMoveOfTemporary = true
    await $.turn.complete(TURN)
    expect(w.files.get(FILE)).toBe(before)
  })
})

describe('a finished item never changes again', () => {
  test('an add with its key and type makes a new item; a pass by its owner leaves it as it was', async ($, on) => {
    const w = world(on)
    const p = finished(7, { key: 'the key' })
    w.seed(file([p]))
    await $.session.start(START_EVENT)
    const frozen = JSON.stringify(w.store().items.find(item => item.id === p.id))
    expect(frozen).toBe(JSON.stringify(p))
    const added = answerOf<{ id: string; bumped: boolean }>(
      await $.tool.call({ tool: ADD, type: 'approve', header: 'Done', question: 'Again', key: 'the key' }),
    )
    expect(added.bumped).toBe(false)
    expect(added.id).not.toBe(p.id)
    await $.turn.complete(TURN)
    expect(JSON.stringify(w.store().items.find(item => item.id === p.id))).toBe(frozen)
  })

  test('an answer pressed on a card the cache still shows takes the stale path and leaves it as it was', async ($, on) => {
    const w = world(on)
    const open = stored({ id: '01STALE0000000000000000000', type: 'approve' })
    w.seed(file([open]))
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const p = finished(0, { id: open.id, short: open.short, question: open.question, key: open.key })
    w.seed(file([p]))
    const before = w.files.get(FILE)
    await ui.press({ key: `${open.id}:approve` })
    await ui.unmount()
    expect(w.files.get(FILE)).toBe(before)
    expect(w.toasts).toContain(`${open.short} was already answered`)
    expect(w.submits).toEqual([])
  })

  test('a held submit whose item leaves the store settles to nothing, and nothing throws', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.answerSubmit = async e => {
      await w.clock.sleep(5_000)
      return { text: e.text }
    }
    const id = answerOf<{ id: string }>(await $.tool.call({ tool: ADD, type: 'approve', header: 'Plan', question: 'OK?' })).id
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:approve` })
    await ui.unmount()
    expect(w.submits).toHaveLength(1)
    const emptied = w.store()
    emptied.items = emptied.items.filter(item => item.id !== id)
    w.seed(emptied)
    const before = w.files.get(FILE)
    await w.clock.advance(6_000)
    expect(w.files.get(FILE)).toBe(before)
  })
})

describe('reload', () => {
  test('a tray cached by the earlier version is not drawn; the start rebuilds it with History', async ($, on) => {
    const w = world(on)
    const open = stored({ id: '01OPEN00000000000000000000', type: 'ack' })
    w.seed(file([finished(1), open]))
    // What the code as merged in 0.1.0 cached: a tray-2 value, with no History.
    let earlier = true
    on('state.get', { plugin: 'humantray', key: 'tray' }, (_, e, next) =>
      earlier
        ? { value: { value: { shape: 'tray-2', value: { items: [open, open], me: 'session-a', mine: [] } }, version: 1 } }
        : next(e),
    )
    const band = await mount($, { ...BAND, surface: 'desktop' })
    expect(await band.find({ type: 'Text', text: /Humantray/ })).toBeUndefined()
    await band.unmount()
    earlier = false
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect((await ui.find({ key: TOGGLE }))?.props.label).toBe('History (1)')
    await ui.unmount()
  })
})

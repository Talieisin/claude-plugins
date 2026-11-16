// Pruning and History as pure rules: what may go, what counts towards the
// 200, the order, the marks, and that a finished item never changes again.

import { describe, expect, test } from 'claude-code/testing'

import {
  KEEP_PER_REPO,
  addOrBump,
  applySettle,
  historyOf,
  isLineDue,
  isPrunable,
  prune,
  validateAdd,
} from '../hooks/items'
import type { Item, StoreFile } from '../types'
import { HOUR, START, finished, finishedMany, oldestOfMany, stored } from './world'

const REPO = 'github.com/owner/repo'
const OTHER = 'github.com/owner/other'

const file = (items: Item[], sessions: StoreFile['sessions'] = {}): StoreFile => ({ version: 1, items, sessions })
const ids = (f: StoreFile) => new Set(f.items.map(item => item.id))

describe('isLineDue and isPrunable', () => {
  const cases: Array<[string, Partial<Item> & Pick<Item, 'type'>, boolean, boolean]> = [
    ['open', { type: 'approve', status: 'open' }, false, false],
    ['answered, delivered', { type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: true }, true, true],
    ['answered, not delivered', { type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: false }, true, false],
    [
      'answered, delivered, but claimed',
      { type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: true, delivering_at: START, delivering_by: 'x/1' },
      true,
      false,
    ],
    [
      'claimed long ago by an instance that died',
      { type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: false, delivering_at: START - 2 * HOUR, delivering_by: 'gone/1' },
      true,
      false,
    ],
    ['ack without notify, not flagged delivered', { type: 'ack', status: 'acknowledged', response: { acknowledged: true }, delivered: false }, false, true],
    [
      'ack with notify, not delivered',
      { type: 'ack', status: 'acknowledged', response: { acknowledged: true }, delivered: false, notify_on_done: true },
      true,
      false,
    ],
    ['do, done, delivered', { type: 'do', status: 'done', response: { outcome: 'not_done' }, delivered: true }, true, true],
  ]
  for (const [name, fields, due, prunable] of cases) {
    test(name, () => {
      const item = stored({ id: '01AAAAAAAAAAAAAAAAAAAAAAAAA', ...fields })
      expect(isLineDue(item)).toBe(due)
      expect(isPrunable(item)).toBe(prunable)
    })
  }
})

describe('prune: the last 200 finished items per repository', () => {
  test('exactly 200 finished: nothing goes', () => {
    const f = file(finishedMany(200))
    expect(prune(f)).toEqual([])
    expect(f.items).toHaveLength(200)
  })

  test('201 finished: exactly the oldest by response_at goes, not the first by position, id or updated', () => {
    const items = finishedMany(201)
    const expected = oldestOfMany(201, 1)
    expect(expected[0]).not.toBe(items[0]?.id)
    expect(expected[0]).not.toBe(items[200]?.id)
    const f = file(items)
    expect(prune(f)).toEqual(expected)
    expect(f.items).toHaveLength(200)
    expect(ids(f).has(expected[0] ?? '')).toBe(false)
  })

  test('205 finished: the five oldest go, whatever their place', () => {
    const f = file(finishedMany(205))
    expect(new Set(prune(f))).toEqual(new Set(oldestOfMany(205, 5)))
    expect(f.items).toHaveLength(200)
  })

  test('two on the same response_at at the boundary: the smaller id goes', () => {
    const items = finishedMany(199, {}, 10)
    // Both older than every other; the larger id is placed first.
    items.unshift(finished(2, { response_at: START - 9 * HOUR }))
    items.push(finished(1, { response_at: START - 9 * HOUR }))
    const f = file(items)
    expect(prune(f)).toEqual([finished(1).id])
    expect(ids(f).has(finished(2).id)).toBe(true)
  })

  test('protected items neither count nor go', () => {
    const done = finishedMany(200)
    const open = Array.from({ length: 30 }, (_, i) => stored({ id: `01OPN${String(i).padStart(21, '0')}`, type: 'ack', session_id: 'session-z' }))
    const owed = Array.from({ length: 20 }, (_, i) =>
      finished(1_000 + i, { session_id: 'session-z', delivered: false, delivered_at: undefined, response_at: START - 10 * HOUR }),
    )
    const claimed = Array.from({ length: 10 }, (_, i) =>
      finished(2_000 + i, {
        session_id: 'session-z',
        delivered: false,
        delivered_at: undefined,
        delivering_at: START - 2 * HOUR,
        delivering_by: 'gone/1',
        response_at: START - 20 * HOUR - i,
      }),
    )
    const f = file([...claimed, ...done, ...owed, ...open])
    expect(prune(f)).toEqual([])
    expect(f.items).toHaveLength(260)
  })

  test('an ack with no line due counts and can go, though not flagged delivered', () => {
    const ack = stored({
      id: '01ACK000000000000000000000',
      type: 'ack',
      session_id: 'session-z',
      status: 'acknowledged',
      response: { acknowledged: true },
      response_at: START - 30 * HOUR,
      delivered: false,
    })
    const f = file([...finishedMany(200), ack])
    expect(prune(f)).toEqual([ack.id])
  })

  test('each repo value is counted on its own', () => {
    const other = finishedMany(201, { repo: OTHER })
    const mine = finishedMany(10, {}, 500)
    const f = file([...other, ...mine])
    expect(prune(f)).toEqual(oldestOfMany(201, 1))
    expect(f.items.filter(item => item.repo === OTHER)).toHaveLength(200)
    expect(f.items.filter(item => item.repo === REPO)).toHaveLength(10)
  })

  test('relayed items follow the same rules', () => {
    const relayed = finishedMany(201, { origin: 'relayed' })
    relayed.push(finished(900, { origin: 'relayed', delivered: false, delivered_at: undefined, response_at: START - 50 * HOUR }))
    const f = file(relayed)
    expect(prune(f)).toEqual(oldestOfMany(201, 1))
    expect(ids(f).has(finished(900).id)).toBe(true)
  })

  test('an answered item with no response_at is ordered by updated', () => {
    const items = finishedMany(199)
    const old = finished(800, { response_at: undefined, updated: START - 50 * HOUR })
    const recent = finished(801, { response_at: undefined, updated: START })
    const f = file([recent, ...items, old])
    expect(prune(f)).toEqual([old.id])
    expect(ids(f).has(recent.id)).toBe(true)
  })

  test('session records are never touched', () => {
    const sessions = {
      'session-a': { seen: START - 30 * 24 * HOUR, successor: 'session-b' },
      'session-b': { seen: START },
      'session-c': { seen: START - 30 * 24 * HOUR },
    }
    const f = file(finishedMany(250, { session_id: 'session-c' }), structuredClone(sessions))
    expect(prune(f)).toHaveLength(50)
    expect(f.sessions).toEqual(sessions)
  })

  test('the default keeps 200', () => {
    expect(KEEP_PER_REPO).toBe(200)
  })
})

describe('a finished item never changes again', () => {
  const p = finished(7, { key: 'the key', response_at: START - HOUR })
  const frozen = JSON.stringify(p)

  test('a settle under any claim leaves it as it was', () => {
    const f = file([structuredClone(p)])
    for (const claim of ['x/1', 'gone/9', '']) {
      expect(applySettle(f, p.id, claim, true, START)).toBe(false)
      expect(applySettle(f, p.id, claim, false, START)).toBe(false)
    }
    expect(JSON.stringify(f.items[0])).toBe(frozen)
  })

  test('an add with its key and type makes a new item and leaves it as it was', () => {
    const f = file([structuredClone(p)])
    const input = validateAdd({ type: 'approve', header: 'Done', question: 'Again', key: 'the key' })
    if (input.error !== undefined) throw new Error(input.error)
    const added = addOrBump(f, input.ok, { repo: REPO, session_id: 'session-a', now: START, id: '01NEW000000000000000000000' })
    expect(added.ok?.bumped).toBe(false)
    expect(f.items).toHaveLength(2)
    expect(JSON.stringify(f.items[0])).toBe(frozen)
  })

  test('a settle for an id no longer in the store does nothing', () => {
    const f = file([structuredClone(p)])
    const before = JSON.stringify(f)
    expect(applySettle(f, '01GONE00000000000000000000', 'x/1', true, START)).toBe(false)
    expect(JSON.stringify(f)).toBe(before)
  })
})

describe('historyOf', () => {
  const NOW = START

  test('answered items of this repository only, newest first, ties by id; open items left out', () => {
    const f = file([
      finished(3, { response_at: NOW - 3_000 }),
      finished(1, { response_at: NOW - 1_000 }),
      finished(5, { response_at: NOW - 1_000 }),
      finished(4, { response_at: undefined, updated: NOW - 2_000 }),
      finished(9, { repo: OTHER, response_at: NOW }),
      stored({ id: '01OPEN00000000000000000000', type: 'ack', updated: NOW }),
    ])
    expect(historyOf(f, REPO, 'session-a', NOW).map(e => e.id)).toEqual([
      finished(5).id,
      finished(1).id,
      finished(4).id,
      finished(3).id,
    ])
    expect(historyOf(f, OTHER, 'session-a', NOW).map(e => e.id)).toEqual([finished(9).id])
  })

  test('the delivery marks', () => {
    const f = file([
      finished(1),
      finished(2, { delivered: false, delivered_at: undefined, delivering_at: NOW - 10_000, delivering_by: 'x/1' }),
      finished(3, { delivered: false, delivered_at: undefined, delivering_at: NOW - 61_000, delivering_by: 'gone/1' }),
      finished(4, { delivered: false, delivered_at: undefined }),
      finished(5, { type: 'ack', response: { acknowledged: true }, status: 'acknowledged', options: undefined, delivered: false, delivered_at: undefined }),
      finished(6, { type: 'ack', response: { acknowledged: true }, status: 'acknowledged', options: undefined, notify_on_done: true }),
    ])
    const marks = Object.fromEntries(historyOf(f, REPO, 'session-a', NOW).map(e => [e.id, e.mark]))
    expect(marks).toEqual({
      [finished(1).id]: 'delivered',
      [finished(2).id]: 'delivering',
      [finished(3).id]: 'not delivered',
      [finished(4).id]: 'not delivered',
      [finished(5).id]: 'none',
      [finished(6).id]: 'delivered',
    })
  })

  test('mine: this session\'s and its predecessor\'s; another session\'s is not', () => {
    const f = file(
      [finished(1, { session_id: 'session-a' }), finished(2, { session_id: 'session-old' }), finished(3, { session_id: 'session-b' })],
      { 'session-old': { seen: NOW - HOUR, successor: 'session-a' }, 'session-a': { seen: NOW } },
    )
    const mine = Object.fromEntries(historyOf(f, REPO, 'session-a', NOW).map(e => [e.id, e.isMine]))
    expect(mine).toEqual({ [finished(1).id]: true, [finished(2).id]: true, [finished(3).id]: false })
  })

  test('the answer without its notes, the notes apart, and the bumps', () => {
    const f = file([
      finished(1, {
        type: 'choice',
        response: { selected: ['Red'], other: 'Teal', notes: 'see\nthe log' },
        bumps: 2,
      }),
    ])
    const [entry] = historyOf(f, REPO, 'session-a', NOW)
    expect(entry?.answer).toBe('Red; Other: Teal')
    expect(entry?.notes).toBe('see / the log')
    expect(entry?.bumps).toBe(2)
  })
})

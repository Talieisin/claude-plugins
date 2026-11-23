// Items that come after others, and withdrawn items (#82): `after` and
// `holding` on humantray_add, what a dependency comes to, the answer checks on
// every route, humantray_withdraw, what pruning and adoption keep, and what a
// version older than 0.3.0 still reads.

import { describe, expect, test } from 'claude-code/testing'

import type { Item, ItemRow, ResponseRow, StoreFile } from '../types'
import {
  addOrBump,
  answerLock,
  checkStoreFile,
  dependencyState,
  historyOf,
  isLive,
  mirroredLock,
  openItems,
  prune,
  refreshDependencies,
  reopenRefused,
  validateAdd,
  withdrawItems,
} from '../hooks/items'
import { adoptRows, checkItemRow, itemToRow, prunableRows, refusalOf } from '../hooks/rows'
import { ADD, HOUR, LIST, PANE, START, START_EVENT, TURN, answerOf, finished, stored, world } from './world'
import { mount } from './surface-rules'

const WITHDRAW = 'mcp__humantray__humantray_withdraw'
const REPO = 'github.com/owner/repo'
const ME = 'session-a'

const id = (n: number) => `01DEP${String(n).padStart(21, '0')}`
const short = (n: number) => `HT-${id(n).slice(-5)}`
const fileOf = (items: Item[], sessions: StoreFile['sessions'] = {}): StoreFile => ({ version: 1, items, sessions })
const open = (n: number, fields: Partial<Item> = {}) => stored({ id: id(n), type: 'do', ...fields })
const done = (n: number, outcome: 'done' | 'not_done', fields: Partial<Item> = {}) =>
  stored({ id: id(n), type: 'do', status: 'done', response: { outcome }, response_at: START, delivered: true, ...fields })
const input = (raw: Record<string, unknown>) => {
  const checked = validateAdd({ type: 'do', header: 'Step', question: 'Do it', ...raw })
  if (checked.error !== undefined) throw new Error(checked.error)
  return checked.ok
}
const context = (n: number) => ({ repo: REPO, session_id: ME, now: START, id: id(n) })

describe('humantray_add: after and holding', () => {
  const refused: Array<[string, Record<string, unknown>, RegExp]> = [
    ['after that is not a list', { after: 'HT-AAAAA' }, /after must be a list/],
    ['an empty id in after', { after: [' '] }, /after must be a list/],
    ['seven items in after', { after: Array.from({ length: 7 }, (_, n) => `HT-${n}`) }, /at most 6/],
    ['holding on an ack', { type: 'ack', holding: true }, /holding is not for ack/],
    ['holding that is not a boolean', { holding: 'yes' }, /holding must be true or false/],
  ]
  for (const [name, raw, error] of refused) {
    test(`refused: ${name}`, () => {
      expect(validateAdd({ type: 'do', header: 'Step', question: 'Do it', ...raw }).error).toMatch(error)
    })
  }

  test('after takes short or full ids of this chain, stored as full ids', () => {
    const file = fileOf([open(1), open(2)])
    const added = addOrBump(file, input({ after: [short(1), id(2), short(1).toLowerCase()] }), context(3))
    expect(added.ok?.item.after).toEqual([id(1), id(2)])
  })

  const badRefs: Array<[string, Item[], string, RegExp]> = [
    ['an unknown id', [], 'HT-NOPE1', /not an item this session raised/],
    ["another session's item", [open(1, { session_id: 'session-b' })], short(1), /not an item this session raised/],
    ['an item of another repository', [open(1, { repo: 'github.com/other/repo' })], short(1), /not an item this session raised/],
    ['a withdrawn item', [open(1, { withdrawn: { at: START, reason: 'gone' }, delivered: true })], short(1), /was withdrawn/],
  ]
  for (const [name, items, ref, error] of badRefs) {
    test(`after refused: ${name}`, () => {
      const file = fileOf(items)
      const before = JSON.stringify(file)
      expect(addOrBump(file, input({ after: [ref] }), context(9)).error).toMatch(error)
      expect(JSON.stringify(file)).toBe(before)
    })
  }

  test("an item inherited after a /clear can be named: the owner chain's end decides", () => {
    const file = fileOf([open(1, { session_id: 'session-old' })], { 'session-old': { seen: START, successor: ME } })
    expect(addOrBump(file, input({ after: [short(1)] }), context(2)).ok?.item.after).toEqual([id(1)])
  })

  test('a bump replaces after and holding only when passed; [] and false clear them', () => {
    const file = fileOf([open(1), open(2)])
    const first = addOrBump(file, input({ key: 'k', after: [short(1)], holding: true }), context(3))
    const item = first.ok?.item as Item
    expect(item).toMatchObject({ after: [id(1)], holding: true })
    addOrBump(file, input({ key: 'k', body_md: 'again' }), context(4))
    expect(item).toMatchObject({ after: [id(1)], holding: true, bumps: 1 })
    addOrBump(file, input({ key: 'k', after: [short(2)] }), context(4))
    expect(item.after).toEqual([id(2)])
    addOrBump(file, input({ key: 'k', after: [], holding: false }), context(4))
    expect(item.after).toBeUndefined()
    expect(item.holding).toBeUndefined()
  })

  test('a bump may not make an item come after itself, directly or through another', () => {
    const file = fileOf([open(1)])
    addOrBump(file, input({ key: 'two', after: [short(1)] }), context(2))
    expect(addOrBump(file, input({ key: 'two', after: [short(2)] }), context(5)).error).toMatch(/cannot come after itself/)
    // Item 1 raised again after item 2, which already comes after item 1.
    const one = file.items[0] as Item
    one.key = 'one'
    expect(addOrBump(file, input({ key: 'one', after: [short(2)] }), context(5)).error).toMatch(/would come after itself/)
  })

  test('a withdrawn item is never bumped: the same key raises a new one', () => {
    const file = fileOf([open(1, { key: 'k', withdrawn: { at: START, reason: 'no' }, delivered: true })])
    const added = addOrBump(file, input({ key: 'k' }), context(2))
    expect(added.ok?.bumped).toBe(false)
    expect(file.items).toHaveLength(2)
  })
})

describe('what a dependency comes to', () => {
  test('waiting while open; free once done; blocked by not done, withdrawn or missing', () => {
    const after = (ids: number[]) => open(9, { after: ids.map(id) })
    const cases: Array<[string, Item[], ReturnType<typeof dependencyState>]> = [
      ['an open prerequisite', [open(1)], { waiting_on: [id(1)], blocks: 0 }],
      ['a do answered Done', [done(1, 'done')], { waiting_on: [], blocks: 0 }],
      ['a question answered at all', [stored({ id: id(1), type: 'question', status: 'answered', response: { text: 'x' } })], { waiting_on: [], blocks: 0 }],
      ['a do answered Not done', [done(1, 'not_done')], { waiting_on: [], blocks: 0, blocked: { by: id(1), reason: 'not_done' } }],
      ['a withdrawn one', [open(1, { withdrawn: { at: START, reason: 'r' } })], { waiting_on: [], blocks: 0, blocked: { by: id(1), reason: 'withdrawn' } }],
      ['one gone from the file', [], { waiting_on: [], blocks: 0, blocked: { by: id(1), reason: 'missing' } }],
    ]
    for (const [name, items, want] of cases) {
      const item = after([1])
      expect({ name, state: dependencyState(fileOf([...items, item]), item) }).toEqual({ name, state: want })
    }
  })

  test('blocks counts the live items after it', () => {
    const first = open(1)
    const file = fileOf([first, open(2, { after: [id(1)] }), open(3, { after: [id(1)] }), done(4, 'done', { after: [id(1)] })])
    expect(dependencyState(file, first).blocks).toBe(2)
  })

  test('answerLock says why, by short id; none when free', () => {
    const file = fileOf([open(1), done(2, 'not_done'), open(3, { after: [id(1)] }), open(4, { after: [id(2)] }), open(5)])
    expect(answerLock(file, file.items[2] as Item)).toBe(`${short(3)} comes after ${short(1)}: answer that first.`)
    expect(answerLock(file, file.items[3] as Item)).toMatch(new RegExp(`^Blocked: ${short(2)} was answered Not done\\.`))
    expect(answerLock(file, file.items[4] as Item)).toBeUndefined()
  })

  test('refreshDependencies mirrors the state on live items only, and clears it once free', () => {
    const file = fileOf([open(1), open(2, { after: [id(1)] })])
    expect(refreshDependencies(file)).toBe(true)
    expect(file.items[0]).toMatchObject({ blocks: 1 })
    expect(file.items[1]).toMatchObject({ waiting_on: [id(1)] })
    expect(refreshDependencies(file)).toBe(false)
    Object.assign(file.items[0] as Item, { status: 'done', response: { outcome: 'done' } })
    expect(refreshDependencies(file)).toBe(true)
    expect(file.items[0]?.blocks).toBeUndefined()
    expect(file.items[1]?.waiting_on).toBeUndefined()
  })

  test('the mirrored lock reads as the local one', () => {
    const file = fileOf([open(1), open(2, { after: [id(1)] })])
    refreshDependencies(file)
    const row = file.items[1] as Item
    expect(mirroredLock(row)).toBe(answerLock(file, row))
  })
})

describe('withdrawing', () => {
  test('all or none: an answered item refuses the whole call', () => {
    const file = fileOf([open(1), done(2, 'done')])
    expect(withdrawItems(file, [short(1), short(2)], 'r', { repo: REPO, session_id: ME, now: START }).error).toMatch(/already answered/)
    expect(file.items[0]?.withdrawn).toBeUndefined()
  })

  test('refused while a live item comes after it, unless that one goes too', () => {
    const file = fileOf([open(1), open(2, { after: [id(1)] })])
    const ctx = { repo: REPO, session_id: ME, now: START + 5 }
    expect(withdrawItems(file, [short(1)], 'r', ctx).error).toMatch(new RegExp(`${short(2)} comes after ${short(1)}`))
    expect(withdrawItems(file, [short(1), short(2)], 'not needed', ctx).ok?.map(item => item.id)).toEqual([id(1), id(2)])
    expect(file.items.every(item => !isLive(item) && item.delivered && item.status === 'open')).toBe(true)
    expect(file.items[0]?.withdrawn).toEqual({ at: START + 5, reason: 'not needed' })
  })

  test("another session's item, an unknown id, or one already withdrawn is refused", () => {
    const file = fileOf([open(1, { session_id: 'session-b' }), open(2, { withdrawn: { at: START, reason: 'r' } })])
    const ctx = { repo: REPO, session_id: ME, now: START }
    expect(withdrawItems(file, [short(1)], 'r', ctx).error).toMatch(/not an item this session raised/)
    expect(withdrawItems(file, ['HT-NOPE1'], 'r', ctx).error).toMatch(/not an item this session raised/)
    expect(withdrawItems(file, [short(2)], 'r', ctx).error).toMatch(/already withdrawn/)
  })

  test('a withdrawn item leaves the open list for History, owing no line', () => {
    const file = fileOf([open(1, { withdrawn: { at: START, reason: 'superseded by HT-12345' }, delivered: true })])
    expect(openItems(file)).toEqual([])
    const [entry] = historyOf(file, REPO, ME, START)
    expect(entry).toMatchObject({ answer: 'withdrawn: superseded by HT-12345', mark: 'none' })
  })
})

describe('pruning and adoption keep what an item comes after', () => {
  test('a finished prerequisite past the kept count stays while an item after it is live or undelivered', () => {
    const file = fileOf([done(1, 'done', { response_at: START - HOUR }), open(2, { after: [id(1)] }), finished(1), finished(2)])
    prune(file, 1)
    expect(file.items.map(item => item.id)).toContain(id(1))
    // Answered and not yet delivered: its delivery check reads the prerequisite again.
    Object.assign(file.items[1] as Item, { status: 'done', response: { outcome: 'done' }, delivered: false })
    prune(file, 1)
    expect(file.items.map(item => item.id)).toContain(id(1))
    Object.assign(file.items[1] as Item, { delivered: true })
    prune(file, 1)
    expect(file.items.map(item => item.id)).not.toContain(id(1))
  })

  test('a withdrawn item is pruned as a finished one', () => {
    const file = fileOf([open(1, { withdrawn: { at: START - HOUR, reason: 'r' }, delivered: true }), finished(1), finished(2)])
    prune(file, 1)
    expect(file.items.map(item => item.id)).not.toContain(id(1))
  })

  const rowOf = (item: Item, session = 'session_0123456789abcdefghijABCD'): { row: ItemRow; version: number } => ({
    row: itemToRow({ ...item, remote: { session_id: session, session_title: null, parent_session_id: null, lead_session_id: null } }),
    version: 1,
  })

  test('rows: a needed prerequisite is kept; a withdrawn row is pruned', () => {
    const rows = [
      rowOf(done(1, 'done', { response_at: START - 2 * HOUR })),
      rowOf(open(2, { withdrawn: { at: START - HOUR, reason: 'r' }, delivered: true })),
      rowOf(open(3, { after: [id(1)] })),
      rowOf(finished(1, { response_at: START })),
    ]
    expect(prunableRows(rows, 1).map(each => each.id)).toEqual([id(2)])
  })

  test('adoption takes a finished prerequisite of an adopted row, and not a withdrawn row alone', () => {
    const routable = 'session_0123456789abcdefghijABCD'
    const file = fileOf([])
    const rows = [rowOf(done(1, 'done')), rowOf(open(2, { after: [id(1)] })), rowOf(open(3, { withdrawn: { at: START, reason: 'r' }, delivered: true }))]
    expect(adoptRows(file, rows, ME, routable, 'https://claude.ai/artifact/x').sort()).toEqual([id(1), id(2)])
  })
})

describe('the answer checks on every route', () => {
  const response = (n: number, bumps = 0): ResponseRow => ({
    schema: 1,
    id: id(n),
    answer_id: 'answer_0123456789abcd',
    response: { outcome: 'done' },
    status: 'done',
    answered_at: START,
    seen: { bumps, updated: START },
    by: 'page',
  })

  test('a store answer is refused while the item waits, is blocked, or was withdrawn', () => {
    const file = fileOf([open(1), open(2, { after: [id(1)] }), open(3, { withdrawn: { at: START, reason: 'r' } })])
    expect(refusalOf(file.items[1] as Item, response(2), file)).toEqual({ refuse: `${short(2)} comes after ${short(1)}: answer that first.` })
    expect(refusalOf(file.items[2] as Item, response(3))).toEqual({ refuse: `${short(3)} was withdrawn by its session.` })
    expect('apply' in refusalOf(file.items[0] as Item, response(1), file)).toBe(true)
  })

  test('an answer written straight into the file to a waiting item is reopened, refused, before delivery', () => {
    const file = fileOf([open(1), done(2, 'done', { after: [id(1)], delivered: false, answer_id: 'answer_kept_0123456' })])
    const item = file.items[1] as Item
    expect(reopenRefused(file, item, START + 1, 'rfresh0123456789ab')).toBe(true)
    expect(item).toMatchObject({ status: 'open', delivered: false, response_refused: { answer_id: 'answer_kept_0123456', at: START + 1 } })
    expect(item.response).toBeUndefined()
    // Free once item 1 is done: nothing to reopen.
    const free = fileOf([done(1, 'done'), done(2, 'done', { after: [id(1)], delivered: false })])
    expect(reopenRefused(free, free.items[1] as Item, START, 'rfresh0123456789ab')).toBe(false)
  })

  test('the pane draws a waiting card without its controls, and refuses it; the next step is free once the first is done', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const first = answerOf<{ id: string; short: string }>(await $.tool.call({ tool: ADD, type: 'do', header: 'Dir', question: 'Make the directory' }))
    const second = answerOf<{ id: string }>(
      await $.tool.call({ tool: ADD, type: 'do', header: 'Build', question: 'Run the build in it', after: [first.short] }),
    )
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await ui.find({ key: `${second.id}:done` })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: new RegExp(`comes after ${first.short}: answer that first`) })).toBeDefined()
    await ui.press({ key: `${first.id}:done` })
    expect(await ui.find({ key: `${second.id}:done` })).toBeDefined()
    await ui.unmount()
    expect(w.store().items.find(item => item.id === second.id)?.waiting_on).toBeUndefined()
  })

  test('an older pane wrote an answer to a waiting item: the session never receives it, and the card says why', async ($, on) => {
    const w = world(on)
    w.seed(fileOf([open(1), done(2, 'done', { after: [id(1)], delivered: false, response_at: START - 1 })]))
    await $.session.start(START_EVENT)
    await w.drain()
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toEqual([])
    const item = w.store().items.find(one => one.id === id(2)) as Item
    expect(item).toMatchObject({ status: 'open', response_refused: { reason: expect.stringContaining(`answered before ${short(1)}`) } })
    expect(item.response_refused?.answer_id).toMatch(/^[A-Za-z0-9_-]{16,64}$/)
  })
})

describe('humantray_withdraw and humantray_list', () => {
  test('withdraws, leaves the tray, and humantray_list shows what waits and what blocks', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    expect(w.tools).toContain('humantray_withdraw')
    const a = answerOf<{ short: string }>(await $.tool.call({ tool: ADD, type: 'do', header: 'A', question: 'Step A' }))
    const b = answerOf<{ short: string }>(await $.tool.call({ tool: ADD, type: 'do', header: 'B', question: 'Step B', after: [a.short] }))
    const listed = answerOf<{ items: Array<{ short: string; waiting_on?: string[] }> }>(await $.tool.call({ tool: LIST }))
    expect(listed.items.find(item => item.short === b.short)?.waiting_on).toEqual([a.short])
    expect((await $.tool.call({ tool: WITHDRAW, ids: [a.short], reason: 'not needed' })).deny).toMatch(/comes after/)
    const gone = await $.tool.call({ tool: WITHDRAW, ids: [a.short, b.short], reason: 'plan changed' })
    expect(answerOf(gone)).toEqual({ withdrawn: [a.short, b.short] })
    expect(answerOf<{ items: unknown[] }>(await $.tool.call({ tool: LIST })).items).toEqual([])
    expect((await $.tool.call({ tool: WITHDRAW, ids: [a.short], reason: 'again' })).deny).toMatch(/already withdrawn/)
    expect((await $.tool.call({ tool: WITHDRAW, ids: [], reason: 'x' })).deny).toMatch(/ids must be/)
    expect((await $.tool.call({ tool: WITHDRAW, ids: [a.short], reason: ' ' })).deny).toMatch(/give a reason/)
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toEqual([])
  })
})

describe('what a version older than 0.3.0 reads', () => {
  // The rules 0.2.10 holds every item of the shared file to (items.ts at
  // a5050a2): one it refuses makes the whole file unreadable to it.
  const OLD_STATUSES = ['open', 'acknowledged', 'done', 'answered']
  const oldReads = (item: Item) =>
    OLD_STATUSES.includes(item.status) &&
    (item.status === 'open' || item.response !== undefined) &&
    (item.response_refused === undefined ||
      (typeof item.response_refused.answer_id === 'string' &&
        typeof item.response_refused.reason === 'string' &&
        typeof item.response_refused.at === 'number'))

  test('a withdrawn item, and an answer reopened as refused, use only what 0.2.10 reads', () => {
    const file = fileOf([open(1), done(2, 'done', { after: [id(1)], delivered: false }), open(3)])
    reopenRefused(file, file.items[1] as Item, START, 'rfresh0123456789ab')
    withdrawItems(file, [short(3)], 'gone', { repo: REPO, session_id: ME, now: START })
    refreshDependencies(file)
    expect(file.items.every(oldReads)).toBe(true)
    expect(checkStoreFile(JSON.parse(JSON.stringify(file))).error).toBeUndefined()
  })

  test('rows with the new fields read; a malformed one does not', () => {
    const row = itemToRow({
      ...open(2, { after: [id(1)], holding: true, waiting_on: [id(1)], blocks: 1 }),
      remote: { session_id: 'session_0123456789abcdefghijABCD', session_title: null, parent_session_id: null, lead_session_id: null },
    })
    expect('ok' in checkItemRow(row)).toBe(true)
    expect(checkItemRow({ ...row, blocked: { by: id(1), reason: 'bored' } })).toEqual({ bad: 'blocked is malformed' })
    expect(checkItemRow({ ...row, after: [1] })).toEqual({ bad: 'after is not a list of ids' })
  })
})

// `humantray_config` and the heading a cloud session's items are shown under
// (#27): the parent by default, an override recorded in `$.store` under the
// session's routable id, a clear kept as a record, and `self` alone restored
// from the session's rows after its container was replaced. The override
// changes nothing but `lead_session_id` on rows written from then on.

import { type Engine, describe, expect, test } from 'claude-code/testing'

import type { Item } from '../types'
import { fingerprint, itemToRow } from '../hooks/row-shape'
import { LEAD, ME, OTHER, TITLE, URL_A, artifactWorld, meta } from './artifact-world'
import { envelopeFor, textOf, warmReceive, wrapped } from './envelope-fixtures'
import { ADD, LIST, START, START_EVENT, TURN, answerOf, finished, stored, world } from './world'

const CONFIG = 'mcp__humantray__humantray_config'
const CLOUD = { env: { CLAUDE_CODE_REMOTE: 'true' } }
const KEY = `lead:${ME}`
const TURN_START = { text: '', turnId: 'turn-1' } as const
const REMOTE = { session_id: ME, session_title: 'worker for #1', parent_session_id: LEAD, lead_session_id: LEAD }
const ID1 = '01AAAAAAAAAAAAAAAAAAAAITEM1'

type On = Parameters<typeof world>[0]
type Shown = { session_id: string; parent_session_id: string | null; shown_under: string; shown_under_from: string; page: string }

function linked(on: On, options: Parameters<typeof world>[1] = {}) {
  const w = world(on, { ...CLOUD, ...options })
  const a = artifactWorld(on, { read: path => w.files.get(path) })
  a.add(URL_A, TITLE)
  a.put(URL_A, 'meta/page', meta(START - 1000))
  return { w, a }
}

async function settle(w: ReturnType<typeof world>) {
  for (let i = 0; i < 3; i++) {
    await w.clock.settle()
    await w.drain()
  }
  await w.clock.settle()
}

const config = ($: Engine, lead?: unknown) => $.tool.call(lead === undefined ? { tool: CONFIG } : { tool: CONFIG, lead })

async function add($: Engine, key: string, body_md = ''): Promise<string> {
  const ran = await $.tool.call({ tool: ADD, type: 'ack', header: 'Note', question: `FYI ${key}`, key, body_md })
  return answerOf<{ id: string }>(ran).id
}

const rowOf = (a: ReturnType<typeof artifactWorld>, id: string) => a.doc(URL_A, `items/${id}`)?.data

/** A row of this session already in the store, as a replaced container finds it. */
function priorRow(id: string, created: number, lead: string | null, fields: Partial<Item> = {}) {
  const item = stored({ id, type: 'ack', created, updated: created, ...fields, remote: { ...REMOTE, lead_session_id: lead } }) as Item &
    Required<Pick<Item, 'remote'>>
  item.row = { artifact: URL_A, version: 1, sent: fingerprint(item) }
  return itemToRow(item) as unknown as Record<string, unknown>
}

describe('the default: the session that started this one', () => {
  test('a worker with no override is shown under its parent, and get_session is asked only about itself', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ session_id: ME, parent_session_id: LEAD, lead_session_id: LEAD })
    expect(a.sessionCalls.length).toBeGreaterThan(0)
    expect(a.sessionCalls.every(args => Object.keys(args).length === 0)).toBe(true)
  })

  test('reading changes nothing, and says where items are shown and whether the page is reached', async ($, on) => {
    const { w } = linked(on)
    await $.session.start(START_EVENT)
    await settle(w)
    const read = await config($)
    expect(answerOf<Shown>(read)).toEqual({
      session_id: ME,
      parent_session_id: LEAD,
      shown_under: LEAD,
      shown_under_from: 'parent',
      page: 'queued',
    })
    expect(w.kv(KEY)).toBeUndefined()
    // The result never calls the heading a lead.
    expect(Object.keys(answerOf(read)).some(key => key.includes('lead'))).toBe(false)
  })

  test('with no page in the repository, the page reads waiting', async ($, on) => {
    const w = world(on, CLOUD)
    artifactWorld(on)
    await $.session.start(START_EVENT)
    await settle(w)
    expect(answerOf<Shown>(await config($)).page).toBe('waiting')
  })
})

describe('an override', () => {
  test('"self": new items are shown under the session itself, and the record is kept', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    await settle(w)
    const set = answerOf<Shown>(await config($, 'self'))
    expect(set).toMatchObject({ session_id: ME, parent_session_id: LEAD, shown_under: ME, shown_under_from: 'config' })
    expect(w.kv(KEY)).toMatchObject({ lead: ME, from: 'call' })
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ session_id: ME, parent_session_id: LEAD, lead_session_id: ME })
  })

  test('another id changes only the heading: the row keeps its session and parent, and adoption still reads this session', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    await settle(w)
    await config($, OTHER)
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ session_id: ME, parent_session_id: LEAD, lead_session_id: OTHER })
    const before = a.calls.length
    await $.session.start(START_EVENT)
    await settle(w)
    const queries = a.calls.slice(before).filter(c => c.input.action === 'query' && c.input.collection === 'items')
    const where = (c: (typeof queries)[number]) => JSON.stringify((c.input.query as { where?: unknown }).where)
    expect(queries.some(c => where(c) === JSON.stringify([['session_id', '==', ME]]))).toBe(true)
    expect(queries.some(c => where(c).includes(OTHER))).toBe(false)
  })

  test('after another id, an envelope to this session is still taken, and one to that id is not', async ($, on) => {
    const { w, a } = linked(on)
    const item = stored({ id: ID1, type: 'approve', remote: { ...REMOTE } }) as Item & Required<Pick<Item, 'remote'>>
    item.row = { artifact: URL_A, version: 1, sent: fingerprint(item) }
    w.seed({ version: 1, items: [item], sessions: {} })
    a.put(URL_A, `items/${ID1}`, itemToRow(item) as unknown as Record<string, unknown>)
    await $.session.start(START_EVENT)
    await settle(w)
    await config($, OTHER)
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1, { to: OTHER })))))
    await settle(w)
    expect(w.submits).toEqual([])
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    expect(w.submits).toEqual([`humantray HT-${ID1.slice(-5)} (Seeded): Approve`])
  })

  test('rows already written keep their heading, through a later pass and a bump; only new items move', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const first = await add($, 'one', 'first')
    await settle(w)
    expect(rowOf(a, first)).toMatchObject({ lead_session_id: LEAD })
    await config($, 'self')
    await $.turn.start(TURN_START)
    await $.turn.complete(TURN)
    await settle(w)
    expect(rowOf(a, first)).toMatchObject({ lead_session_id: LEAD })
    expect(await add($, 'one', 'second')).toBe(first)
    await settle(w)
    expect(rowOf(a, first)).toMatchObject({ lead_session_id: LEAD, bumps: 1, body_md: 'second' })
    const next = await add($, 'two')
    await settle(w)
    expect(rowOf(a, next)).toMatchObject({ lead_session_id: ME })
  })

  test('set while get_session has not answered: refused, nothing kept; it works once the id is known', async ($, on) => {
    const { w, a } = linked(on)
    const answer = a.session
    a.session = undefined
    await $.session.start(START_EVENT)
    await settle(w)
    const ran = await config($, 'self')
    expect(String(ran.deny)).toContain('not known yet')
    expect(w.kv(KEY)).toBeUndefined()
    a.session = answer
    expect(answerOf<Shown>(await config($, 'self')).shown_under).toBe(ME)
    expect(w.kv(KEY)).toMatchObject({ lead: ME })
  })

  test('the store refuses to keep it: refused, and nothing changes', async ($, on) => {
    const { w, a } = linked(on)
    w.failStoreSet = key => key === KEY
    await $.session.start(START_EVENT)
    await settle(w)
    const ran = await config($, 'self')
    expect(String(ran.deny)).toContain('could not be kept')
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ lead_session_id: LEAD })
  })
})

describe('a clear', () => {
  test('null goes back to the parent and is kept as a record', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    await settle(w)
    await config($, 'self')
    const cleared = answerOf<Shown>(await config($, null))
    expect(cleared).toMatchObject({ shown_under: LEAD, shown_under_from: 'parent' })
    expect(w.kv(KEY)).toMatchObject({ lead: null, from: 'call' })
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ lead_session_id: LEAD })
  })

  test('a later adoption does not undo a clear, though the newest row says self', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    await settle(w)
    await config($, 'self')
    const mine = await add($, 'one')
    await settle(w)
    expect(rowOf(a, mine)).toMatchObject({ lead_session_id: ME })
    await config($, null)
    // A relink-style adoption, and a start's.
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.kv(KEY)).toMatchObject({ lead: null })
    const id = await add($, 'two')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ lead_session_id: LEAD })
  })

  test('a kept explicit id is not replaced by a restore, though the newest row says self', async ($, on) => {
    const { w, a } = linked(on, { store: { [KEY]: { lead: OTHER, at: START - 10, from: 'call' } } })
    a.put(URL_A, 'items/01AAAAAAAAAAAAAAAAAAAAOLD01', priorRow('01AAAAAAAAAAAAAAAAAAAAOLD01', START - 100, ME))
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.kv(KEY)).toMatchObject({ lead: OTHER, from: 'call' })
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ lead_session_id: OTHER })
  })

  test('a clear kept in the store survives a reload, and blocks the restore from rows', async ($, on) => {
    const { w, a } = linked(on, { store: { [KEY]: { lead: null, at: START - 10, from: 'call' } } })
    a.put(URL_A, `items/01AAAAAAAAAAAAAAAAAAAAOLD01`, priorRow('01AAAAAAAAAAAAAAAAAAAAOLD01', START - 100, ME))
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.kv(KEY)).toMatchObject({ lead: null, from: 'call' })
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ lead_session_id: LEAD })
  })
})

describe('a reload and a replaced container', () => {
  test('a reload keeps the override: it is read back from the store', async ($, on) => {
    const { w, a } = linked(on, { store: { [KEY]: { lead: OTHER, at: START - 10, from: 'call' } } })
    await $.session.start(START_EVENT)
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ lead_session_id: OTHER })
    expect(answerOf<Shown>(await config($))).toMatchObject({ shown_under: OTHER, shown_under_from: 'config' })
  })

  test('a replaced container whose newest row says self takes self back, and new items follow it', async ($, on) => {
    const { w, a } = linked(on)
    a.put(URL_A, 'items/01AAAAAAAAAAAAAAAAAAAAOLD01', priorRow('01AAAAAAAAAAAAAAAAAAAAOLD01', START - 200, LEAD))
    a.put(URL_A, 'items/01AAAAAAAAAAAAAAAAAAAAOLD02', priorRow('01AAAAAAAAAAAAAAAAAAAAOLD02', START - 100, ME))
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.kv(KEY)).toMatchObject({ lead: ME, from: 'restored' })
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ lead_session_id: ME })
  })

  test('a replaced container whose newest row agrees with the parent restores nothing', async ($, on) => {
    const { w, a } = linked(on)
    a.put(URL_A, 'items/01AAAAAAAAAAAAAAAAAAAAOLD01', priorRow('01AAAAAAAAAAAAAAAAAAAAOLD01', START - 200, ME))
    a.put(URL_A, 'items/01AAAAAAAAAAAAAAAAAAAAOLD02', priorRow('01AAAAAAAAAAAAAAAAAAAAOLD02', START - 100, LEAD))
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.kv(KEY)).toBeUndefined()
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ lead_session_id: LEAD })
  })

  test('a replaced container with a row it cannot read restores nothing: that row may be the newest', async ($, on) => {
    const { w, a } = linked(on)
    a.put(URL_A, 'items/01AAAAAAAAAAAAAAAAAAAAOLD02', priorRow('01AAAAAAAAAAAAAAAAAAAAOLD02', START - 100, ME))
    a.put(URL_A, 'items/01AAAAAAAAAAAAAAAAAAAAOLD03', { schema: 1, id: '01AAAAAAAAAAAAAAAAAAAAOLD03', session_id: ME, created: START - 50 })
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.kv(KEY)).toBeUndefined()
  })

  test('a replaced container with no rows takes the default', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.kv(KEY)).toBeUndefined()
    const id = await add($, 'one')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ lead_session_id: LEAD })
  })
})

describe('a /clear and a /branch', () => {
  for (const source of ['clear', 'fork'] as const) {
    test(`after a ${source}, the override still applies: it is kept by the routable id`, async ($, on) => {
      const { w, a } = linked(on)
      await $.session.start(START_EVENT)
      await settle(w)
      await config($, 'self')
      w.sessionId = 'session-new'
      await $.classic.SessionStart({ source })
      await settle(w)
      const id = await add($, 'after')
      await settle(w)
      expect(rowOf(a, id)).toMatchObject({ session_id: ME, lead_session_id: ME })
    })
  }
})

describe('refused, and nothing kept', () => {
  test('in a local session', async ($, on) => {
    const w = world(on)
    artifactWorld(on)
    await $.session.start(START_EVENT)
    const ran = await config($, 'self')
    expect(String(ran.deny)).toContain('only in a cloud session')
    expect(w.kv(KEY)).toBeUndefined()
    await add($, 'one')
    expect(w.store().items[0]?.remote).toBeUndefined()
  })

  test('outside a git repository', async ($, on) => {
    const { w } = linked(on, { isRepo: false })
    await $.session.start(START_EVENT)
    const ran = await config($, 'self')
    expect(ran.deny).toBe('humantray: not in a git repository')
    expect(w.kv(KEY)).toBeUndefined()
  })

  const bad: Array<[string, unknown]> = [
    ['a string that is not a session id', 'my lead'],
    ['"self " with a space', 'self '],
    ['a number', 3],
  ]
  for (const [name, lead] of bad) {
    test(`a bad lead: ${name}`, async ($, on) => {
      const { w } = linked(on)
      await $.session.start(START_EVENT)
      await settle(w)
      const ran = await config($, lead)
      expect(String(ran.deny)).toStartWith('humantray: lead must be')
      expect(w.kv(KEY)).toBeUndefined()
    })
  }
})

describe('registration', () => {
  test('a refused humantray_config leaves humantray_add and humantray_list registered and working', async ($, on) => {
    const { w } = linked(on)
    w.refuseTool = name => name === 'humantray_config'
    await $.session.start(START_EVENT)
    expect(w.tools).toEqual(['humantray_add', 'humantray_list', 'humantray_withdraw'])
    // The rest of the start still runs: the commands register after it.
    expect(w.commands).toEqual(['humantray-open', 'humantray-viewer', 'humantray-gallery', 'humantray-page'])
    await add($, 'one')
    expect(answerOf<{ items: unknown[] }>(await $.tool.call({ tool: LIST })).items).toHaveLength(1)
  })

  test('refused humantray_add and humantray_list leave humantray_config registered and working', async ($, on) => {
    const { w } = linked(on)
    w.refuseTool = name => name !== 'humantray_config'
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.tools).toEqual(['humantray_config'])
    expect(answerOf<Shown>(await config($, 'self')).shown_under).toBe(ME)
  })
})

describe('review findings on PR #50', () => {
  test('a clear made while a restore is being written wins: the record is kept one write at a time', async ($, on) => {
    const { w, a } = linked(on)
    a.put(URL_A, 'items/01AAAAAAAAAAAAAAAAAAAAOLD02', priorRow('01AAAAAAAAAAAAAAAAAAAAOLD02', START - 100, ME))
    let release = () => undefined as void
    let held = false
    w.storeSetGate = key => {
      if (key !== KEY || held) return undefined
      held = true
      return new Promise<void>(resolve => {
        release = resolve
      })
    }
    const started = $.session.start(START_EVENT)
    for (let i = 0; i < 20 && !held; i++) await w.clock.settle()
    expect(held).toBe(true)
    const cleared = config($, null)
    await w.clock.settle()
    release()
    await w.clock.advance(5_000)
    await started
    expect(answerOf<Shown>(await cleared)).toMatchObject({ shown_under: LEAD, shown_under_from: 'parent' })
    await settle(w)
    expect(w.kv(KEY)).toMatchObject({ lead: null, from: 'call' })
    const id = await add($, 'after')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ lead_session_id: LEAD })
  })

  test('a read of the session rows that reaches its limit restores nothing: the newest row may be past it', async ($, on) => {
    const { w, a } = linked(on)
    // 1,001 rows: the read returns the first 1,000 by id, whose newest says self;
    // the true newest, past the limit, agrees with the parent.
    for (let n = 0; n < 1000; n++) {
      const item = finished(n, { created: START - 10_000 + n, remote: { ...REMOTE, lead_session_id: n === 999 ? ME : LEAD } }) as Item &
        Required<Pick<Item, 'remote'>>
      a.put(URL_A, `items/${item.id}`, itemToRow(item) as unknown as Record<string, unknown>)
    }
    const last = finished(5000, { created: START - 1, remote: { ...REMOTE } }) as Item & Required<Pick<Item, 'remote'>>
    a.put(URL_A, `items/${last.id}`, itemToRow(last) as unknown as Record<string, unknown>)
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.kv(KEY)).toBeUndefined()
  })

  test('a setting that cannot be read leaves the default heading, and the item is still mirrored', async ($, on) => {
    const { w, a } = linked(on)
    w.failStoreGet = key => key === KEY
    await $.session.start(START_EVENT)
    const added = answerOf<{ id: string; page: string }>(
      await $.tool.call({ tool: ADD, type: 'ack', header: 'Note', question: 'FYI', key: 'one' }),
    )
    expect(added.page).toBe('queued')
    await settle(w)
    expect(rowOf(a, added.id)).toMatchObject({ lead_session_id: LEAD })
    expect(String((await config($)).deny)).toContain('could not be read')
  })

  test('a page made after the start is found by the call itself, not ten minutes later, and earlier items are pushed', async ($, on) => {
    const w = world(on, CLOUD)
    const a = artifactWorld(on, { read: path => w.files.get(path) })
    await $.session.start(START_EVENT)
    const id = await add($, 'early')
    await settle(w)
    expect(answerOf<Shown>(await config($)).page).toBe('waiting')
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', meta(START - 1000))
    expect(answerOf<Shown>(await config($)).page).toBe('queued')
    await settle(w)
    expect(rowOf(a, id)).toMatchObject({ session_id: ME, lead_session_id: LEAD })
    // The call delivers nothing and, once linked, looks for the page no more.
    expect(w.submits).toEqual([])
    const lists = a.calls.filter(c => c.tool === 'Artifact').length
    await config($)
    expect(a.calls.filter(c => c.tool === 'Artifact').length).toBe(lists)
  })
})

describe('the re-reads at e0460f6', () => {
  test("the call's own page find delivers nothing, though it adopts an answer waiting to be delivered; the next turn delivers it", async ($, on) => {
    const w = world(on, CLOUD)
    const a = artifactWorld(on, { read: path => w.files.get(path) })
    // A replaced container: no file, and no page yet at the start.
    await $.session.start(START_EVENT)
    await settle(w)
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', meta(START - 1000))
    a.put(
      URL_A,
      `items/${ID1}`,
      priorRow(ID1, START - 100, LEAD, { type: 'approve', status: 'answered', response: { selected: ['Approve'] }, response_at: START - 50 }),
    )
    expect(answerOf<Shown>(await config($)).page).toBe('queued')
    await settle(w)
    expect(w.store().items.map(item => item.id)).toEqual([ID1])
    expect(w.submits).toEqual([])
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toEqual([`humantray HT-${ID1.slice(-5)} (Seeded): Approve`])
  })
})

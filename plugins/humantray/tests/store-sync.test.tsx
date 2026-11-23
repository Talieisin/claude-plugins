// The store pass (#33): a cloud session mirrors its items to the repository's
// artifact, adopts rows a replaced container left, and brings answers given
// on the page back, delivering each exactly once.

import { describe, expect, test } from 'claude-code/testing'

import type { Item } from '../types'
import { WRITER_VERSION, fingerprint, itemToRow } from '../hooks/row-shape'
import { NEWER_ANSWER } from '../hooks/rows'
import { FIND_AGAIN_MS } from '../hooks/store-pass'
import { LEAD, ME, OTHER, TITLE, URL_A, artifactWorld, meta, response } from './artifact-world'
import { ADD, COMMAND, PANE, START, START_EVENT, TURN, answerOf, stored, world } from './world'
import { mount } from './surface-rules'

const CLOUD = { env: { CLAUDE_CODE_REMOTE: 'true' } }
const TURN_START = { text: '', turnId: 'turn-1' } as const
const REMOTE = { session_id: ME, session_title: 'worker for #1', parent_session_id: LEAD, lead_session_id: LEAD }

type On = Parameters<typeof world>[0]

/** A linked cloud session: the artifact exists with its meta, and is found by title. */
function linked(on: On, options: Parameters<typeof world>[1] = {}) {
  const w = world(on, { ...CLOUD, ...options })
  const a = artifactWorld(on, { read: path => w.files.get(path) })
  a.add(URL_A, TITLE)
  a.put(URL_A, 'meta/page', meta(START - 1000))
  return { w, a }
}

const approve = { tool: ADD, type: 'approve', header: 'Merge', question: 'Merge the pull request?' } as const
const choice = {
  tool: ADD,
  type: 'choice',
  header: 'Format',
  question: 'Which format first?',
  options: [
    { label: 'TOML', description: 'Small.' },
    { label: 'YAML', description: 'Wanted.' },
  ],
  multiSelect: true,
} as const

/** An item of this session, mirrored to URL_A at `version` (the row written to match). */
function mirrored(fields: Partial<Item> & Pick<Item, 'id' | 'type'>): Item & Required<Pick<Item, 'remote'>> {
  const item = stored({ ...fields, remote: { ...REMOTE } }) as Item & Required<Pick<Item, 'remote'>>
  item.row = { artifact: URL_A, version: 1, sent: fingerprint(item) }
  return item
}

/** Seeds the file and the matching rows. */
function seedMirrored(w: ReturnType<typeof world>, a: ReturnType<typeof artifactWorld>, items: Item[]) {
  w.seed({ version: 1, items, sessions: {} })
  for (const item of items) {
    if (item.remote === undefined) continue
    a.put(URL_A, `items/${item.id}`, itemToRow(item as Item & Required<Pick<Item, 'remote'>>) as unknown as Record<string, unknown>)
  }
}

/** Lets detached passes and deliveries finish. */
async function settle(w: ReturnType<typeof world>) {
  await w.clock.settle()
  await w.drain()
  await w.clock.settle()
}

const ID1 = '01AAAAAAAAAAAAAAAAAAAAITEM1'
const ID2 = '01AAAAAAAAAAAAAAAAAAAAITEM2'

describe('pushing items', () => {
  test('a cloud add writes a row with the lineage; the add says the row is queued', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const added = await $.tool.call(approve)
    const result = answerOf<{ id: string; page: string }>(added)
    expect(result.page).toBe('queued')
    await settle(w)
    expect(a.doc(URL_A, `items/${result.id}`)?.data).toMatchObject({
      schema: 1,
      id: result.id,
      type: 'approve',
      status: 'open',
      session_id: ME,
      parent_session_id: LEAD,
      lead_session_id: LEAD,
      session_title: 'worker for #1',
      writer_version: WRITER_VERSION,
    })
    const item = w.store().items[0] as Item & Required<Pick<Item, 'remote'>>
    expect(item.remote.session_id).toBe(ME)
    expect(item.row).toEqual({ artifact: URL_A, version: 1, sent: fingerprint(item) })
  })

  test('a session with no parent is its own lead', async ($, on) => {
    const { w, a } = linked(on)
    a.session = { id: ME, title: null, parent: null }
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    expect(a.doc(URL_A, `items/${id}`)?.data).toMatchObject({ parent_session_id: null, lead_session_id: ME, session_title: null })
  })

  test('a bump updates the row, pinned to its version', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call({ ...approve, body_md: 'first' })).id
    await settle(w)
    await $.tool.call({ ...approve, body_md: 'second' })
    await settle(w)
    expect(a.doc(URL_A, `items/${id}`)).toMatchObject({ version: 2, data: { body_md: 'second', bumps: 1 } })
    const pinned = a.writes().filter(c => c.input.doc_id === id)
    expect(pinned.map(c => c.input.if_version)).toEqual([undefined, 1])
  })

  test('a local session writes nothing and its add says none', async ($, on) => {
    const w = world(on)
    const a = artifactWorld(on)
    a.add(URL_A, TITLE)
    await $.session.start(START_EVENT)
    const added = await $.tool.call(approve)
    expect(answerOf<{ page: string }>(added).page).toBe('none')
    await settle(w)
    expect(a.calls).toEqual([])
    expect(w.store().items[0]?.remote).toBeUndefined()
  })

  test('with no artifact linked the add says waiting, and nothing is created', async ($, on) => {
    const w = world(on, CLOUD)
    const a = artifactWorld(on)
    await $.session.start(START_EVENT)
    const added = await $.tool.call(approve)
    expect(answerOf<{ page: string }>(added).page).toBe('waiting')
    await settle(w)
    expect(a.calls.filter(c => c.input.action === 'publish')).toEqual([])
    expect(a.writes()).toEqual([])
    // The lineage is still taken, so the item is pushed once a page is linked.
    expect(w.store().items[0]?.remote?.session_id).toBe(ME)
  })
})

describe('answers from the page', () => {
  test('an answer is applied and delivered once, even when read on two passes, and mirrored', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    a.put(URL_A, `responses/${id}`, response(id))
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toEqual([`humantray HT-${id.slice(-5)} (Merge): Approve`])
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toHaveLength(1)
    expect(w.store().items[0]).toMatchObject({ status: 'answered', delivered: true, response_by: 'page', answer_id: response(id).answer_id })
    await $.turn.start(TURN_START)
    await settle(w)
    expect(a.doc(URL_A, `items/${id}`)?.data).toMatchObject({ status: 'answered', delivered: true, response_by: 'page' })
  })

  test('a cold start with the item answered and delivered on disk sends no line', async ($, on) => {
    const { w, a } = linked(on)
    const item = mirrored({
      id: ID1,
      type: 'approve',
      status: 'answered',
      response: { selected: ['Approve'] },
      response_at: START - 10,
      response_by: 'page',
      delivered: true,
      delivered_at: START - 5,
    })
    seedMirrored(w, a, [item])
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    await $.session.start(START_EVENT)
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toEqual([])
  })

  test('a cold start with the item answered, undelivered and unclaimed sends one line', async ($, on) => {
    const { w, a } = linked(on)
    const item = mirrored({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Approve'] }, response_at: START - 10 })
    seedMirrored(w, a, [item])
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    await $.session.start(START_EVENT)
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toEqual([`humantray HT-${ID1.slice(-5)} (Seeded): Approve`])
  })

  test('push before pull: a row created in this pass has its answer read in the same pass', async ($, on) => {
    const { w, a } = linked(on)
    const item = stored({ id: ID1, type: 'approve', remote: { ...REMOTE } })
    w.seed({ version: 1, items: [item], sessions: {} })
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.submits).toEqual([`humantray HT-${ID1.slice(-5)} (Seeded): Approve`])
  })

  test('an answer to an item already answered here is left alone: no second line, the row keeps the local answer', async ($, on) => {
    const { w, a } = linked(on)
    const item = mirrored({
      id: ID1,
      type: 'approve',
      status: 'answered',
      response: { selected: ['Reject'] },
      response_at: START - 10,
      response_by: 'pane',
      delivered: true,
    })
    seedMirrored(w, a, [item])
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    await $.session.start(START_EVENT)
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toEqual([])
    expect(w.store().items[0]?.response).toEqual({ selected: ['Reject'] })
    expect(a.doc(URL_A, `items/${ID1}`)?.data).toMatchObject({ response: { selected: ['Reject'] } })
    expect(a.doc(URL_A, `responses/${ID1}`)?.version).toBe(1)
  })

  test("an answer for another session's item is not applied", async ($, on) => {
    const { w, a } = linked(on)
    const theirs = mirrored({ id: ID1, type: 'approve', session_id: 'session-b' })
    seedMirrored(w, a, [theirs])
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    await $.session.start(START_EVENT)
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toEqual([])
    expect(w.store().items[0]?.status).toBe('open')
  })

  test('an empty or partial response document counts as no answer: nothing applied, nothing refused', async ($, on) => {
    const { w, a } = linked(on)
    seedMirrored(w, a, [mirrored({ id: ID1, type: 'approve' }), mirrored({ id: ID2, type: 'approve' })])
    a.put(URL_A, `responses/${ID1}`, {})
    a.put(URL_A, `responses/${ID2}`, { schema: 1, id: ID2, response: { selected: ['Approve'] } })
    await $.session.start(START_EVENT)
    await settle(w)
    for (const item of w.store().items) {
      expect(item.status).toBe('open')
      expect(item.response_refused).toBeUndefined()
    }
    expect(w.submits).toEqual([])
  })

  test('31 open items are read in two queries (the in limit is 30)', async ($, on) => {
    const { w, a } = linked(on)
    const items = Array.from({ length: 31 }, (_, n) => mirrored({ id: `01BBBBBBBBBBBBBBBBBBBB${String(n).padStart(4, '0')}`, type: 'ack' }))
    seedMirrored(w, a, items)
    await $.session.start(START_EVENT)
    await settle(w)
    const reads = a.calls.filter(c => c.input.action === 'query' && c.input.collection === 'responses')
    expect(reads.map(c => ((c.input.query as { where: unknown[][] }).where[0]?.[2] as string[]).length)).toEqual([30, 1])
  })
})

describe('refusals never wedge an item', () => {
  test('a bad label alone is refused and shown; a new answer with a fresh id is then applied', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(choice)).id
    await settle(w)
    a.put(URL_A, `responses/${id}`, response(id, { response: { selected: ['JSON'] }, answer_id: 'firstanswer0000001' }))
    await $.turn.start(TURN_START)
    await settle(w)
    const refused = w.store().items[0]
    expect(refused?.status).toBe('open')
    expect(refused?.response_refused).toMatchObject({ answer_id: 'firstanswer0000001', reason: 'Pick an option or fill in Other.' })
    await $.turn.start(TURN_START)
    await settle(w)
    expect(a.doc(URL_A, `items/${id}`)?.data).toMatchObject({ status: 'open', response_refused: { answer_id: 'firstanswer0000001' } })
    expect(w.submits).toEqual([])
    // The page may replace a refused answer.
    a.put(URL_A, `responses/${id}`, response(id, { response: { selected: ['YAML'] }, answer_id: 'secondanswer000002' }))
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.store().items[0]).toMatchObject({ status: 'answered', response: { selected: ['YAML'] } })
    expect(w.store().items[0]?.response_refused).toBeUndefined()
    expect(w.submits).toEqual([`humantray HT-${id.slice(-5)} (Format): YAML`])
  })

  test('a bad label beside a valid one keeps the valid one, as the pane does', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(choice)).id
    await settle(w)
    a.put(URL_A, `responses/${id}`, response(id, { response: { selected: ['JSON', 'TOML'] } }))
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.store().items[0]).toMatchObject({ status: 'answered', response: { selected: ['TOML'] } })
  })

  test("another type's shape is refused", async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(choice)).id
    await settle(w)
    a.put(URL_A, `responses/${id}`, response(id, { response: { acknowledged: true }, status: 'acknowledged' }))
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.store().items[0]?.response_refused?.reason).toBe('The answer does not fit a choice item.')
  })

  test('an answer given before the item was raised again is refused', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call({ ...approve, body_md: 'one' })).id
    await settle(w)
    await $.tool.call({ ...approve, body_md: 'two' })
    await settle(w)
    a.put(URL_A, `responses/${id}`, response(id, { seen: { bumps: 0, updated: START } }))
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.store().items[0]?.status).toBe('open')
    expect(w.store().items[0]?.response_refused?.reason).toMatch(/raised again/)
    expect(w.submits).toEqual([])
  })

  test('an answer to an item that comes after one still open is refused, and the row says why (#82)', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const first = answerOf<{ id: string; short: string }>(await $.tool.call(approve))
    const next = answerOf<{ id: string }>(await $.tool.call({ ...approve, question: 'And then?', after: [first.short] })).id
    await settle(w)
    expect(a.doc(URL_A, `items/${next}`)?.data).toMatchObject({ waiting_on: [first.id] })
    expect(a.doc(URL_A, `items/${first.id}`)?.data).toMatchObject({ blocks: 1 })
    a.put(URL_A, `responses/${next}`, response(next))
    await $.turn.start(TURN_START)
    await settle(w)
    const item = w.store().items.find(one => one.id === next)
    expect(item?.status).toBe('open')
    expect(item?.response_refused?.reason).toMatch(new RegExp(`comes after ${first.short}`))
    expect(w.submits).toEqual([])
  })

  test('an answer to a withdrawn item is refused where the page shows it, and never delivered (#82)', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const added = answerOf<{ id: string; short: string }>(await $.tool.call(approve))
    await settle(w)
    await $.tool.call({ tool: 'mcp__humantray__humantray_withdraw', ids: [added.short], reason: 'plan changed' })
    await settle(w)
    expect(a.doc(URL_A, `items/${added.id}`)?.data).toMatchObject({ status: 'open', withdrawn: { reason: 'plan changed' } })
    a.put(URL_A, `responses/${added.id}`, response(added.id))
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toEqual([])
    expect(w.store().items[0]?.response_refused?.reason).toMatch(/withdrawn/)
  })

  test("a newer page's answer is refused with a reason the page shows", async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    a.put(URL_A, `responses/${id}`, response(id, { schema: 2, answer_id: 'neweranswer0000001' }))
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.store().items[0]?.response_refused).toMatchObject({ answer_id: 'neweranswer0000001', reason: NEWER_ANSWER })
    expect(w.submits).toEqual([])
  })
})

describe('the outbox', () => {
  test('a row that exists but has no version here is read, then written pinned, keeping its unknown fields', async ($, on) => {
    const { w, a } = linked(on)
    const item = stored({ id: ID1, type: 'approve', remote: { ...REMOTE } }) as Item & Required<Pick<Item, 'remote'>>
    w.seed({ version: 1, items: [item], sessions: {} })
    a.put(URL_A, `items/${ID1}`, { ...(itemToRow(item) as unknown as Record<string, unknown>), future_field: 'kept' })
    a.put(URL_A, `items/${ID1}`, { ...(itemToRow(item) as unknown as Record<string, unknown>), future_field: 'kept', body_md: 'old' })
    await $.session.start(START_EVENT)
    await settle(w)
    expect(a.doc(URL_A, `items/${ID1}`)).toMatchObject({ version: 3, data: { future_field: 'kept', body_md: '' } })
    expect(w.store().items[0]?.row?.version).toBe(3)
  })

  test('a pinned write to a row that moved on is read, then written again', async ($, on) => {
    const { w, a } = linked(on)
    const item = mirrored({ id: ID1, type: 'approve' })
    seedMirrored(w, a, [item])
    // Another container wrote the row since (it is now at version 2), and this item changed here.
    a.put(URL_A, `items/${ID1}`, itemToRow(item) as unknown as Record<string, unknown>)
    w.seed({ version: 1, items: [{ ...item, body_md: 'changed' }], sessions: {} })
    await $.session.start(START_EVENT)
    await settle(w)
    expect(a.doc(URL_A, `items/${ID1}`)).toMatchObject({ version: 3, data: { body_md: 'changed' } })
  })

  test('an add made while a pass runs gets one more pass', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    let open: () => void = () => undefined
    a.hold = new Promise(resolve => {
      open = resolve
    })
    const first = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await w.clock.settle()
    const second = answerOf<{ id: string }>(await $.tool.call({ ...approve, key: 'second' })).id
    a.hold = undefined
    open()
    await settle(w)
    expect(a.doc(URL_A, `items/${first}`)).toBeDefined()
    expect(a.doc(URL_A, `items/${second}`)).toBeDefined()
  })

  test('a failed write is retried in this process, then from the outbox at the next turn', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    a.garble = 1
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    expect(a.doc(URL_A, `items/${id}`)).toBeUndefined()
    await w.clock.advance(5_000)
    await settle(w)
    expect(a.doc(URL_A, `items/${id}`)).toBeDefined()

    const later = answerOf<{ id: string }>(await $.tool.call({ ...approve, key: 'later' })).id
    a.garble = 1_000
    await settle(w)
    await w.clock.advance(5_000)
    await w.clock.advance(15_000)
    await w.clock.advance(40_000)
    await w.clock.advance(60_000)
    await settle(w)
    expect(a.doc(URL_A, `items/${later}`)).toBeUndefined()
    a.garble = 0
    await $.turn.start(TURN_START)
    await settle(w)
    expect(a.doc(URL_A, `items/${later}`)).toBeDefined()
  })

  test('get_session fails at the add and answers later: the lineage is backfilled and the item pushed', async ($, on) => {
    const { w, a } = linked(on)
    const answer = a.session
    a.session = undefined
    await $.session.start(START_EVENT)
    const added = answerOf<{ id: string; page: string }>(await $.tool.call(approve))
    expect(added.page).toBe('waiting')
    await settle(w)
    expect(w.store().items[0]?.remote).toBeUndefined()
    a.session = answer
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.store().items[0]?.remote?.session_id).toBe(ME)
    expect(a.doc(URL_A, `items/${added.id}`)).toBeDefined()
  })

  test("a local mod's refused write stops writes until the next session start", async ($, on) => {
    const { w, a } = linked(on)
    a.needsPerson = true
    await $.session.start(START_EVENT)
    await $.tool.call(approve)
    await settle(w)
    const added = answerOf<{ page: string }>(await $.tool.call({ ...approve, key: 'two' }))
    expect(added.page).toBe('none')
    await $.turn.start(TURN_START)
    await $.turn.complete(TURN)
    await settle(w)
    expect(a.writes()).toHaveLength(1)
    await $.session.start(START_EVENT)
    await settle(w)
    expect(a.writes().length).toBeGreaterThan(1)
  })

  test('any other deny is unavailable for that pass only', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    a.denyOther = true
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    a.denyOther = false
    const again = answerOf<{ page: string }>(await $.tool.call({ ...approve, key: 'two' }))
    expect(again.page).toBe('queued')
    await settle(w)
    expect(a.doc(URL_A, `items/${id}`)).toBeDefined()
  })

  test('a store that never answers at session start: the hook returns at the deadline', async ($, on) => {
    const { w, a } = linked(on)
    a.hold = new Promise(() => undefined)
    let returned = false
    const started = $.session.start(START_EVENT).then(() => {
      returned = true
    })
    await w.clock.advance(3_999)
    expect(returned).toBe(false)
    await w.clock.advance(1)
    await started
    expect(returned).toBe(true)
  })

  test('a subagent turn makes no pass', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    await settle(w)
    const before = a.calls.length
    await $.turn.start({ ...TURN_START, agentId: 'agent-1' })
    await $.turn.complete({ ...TURN, agentId: 'agent-1' })
    await settle(w)
    expect(a.calls.length).toBe(before)
  })

  test('with an answer waiting in the store, an add and the page command submit nothing', async ($, on) => {
    const { w, a } = linked(on)
    seedMirrored(w, a, [mirrored({ id: ID1, type: 'approve' })])
    a.session = { id: ME, title: 'worker for #1', parent: LEAD }
    await $.session.start({ ...START_EVENT })
    await settle(w)
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    await $.tool.call({ ...approve, key: 'other' })
    await $.command.run({ ...COMMAND, command: 'humantray-page', args: '' })
    await settle(w)
    expect(w.submits).toEqual([])
    // The next turn takes it.
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toHaveLength(1)
  })

  test('a finished item still owed a push is not pruned locally', async ($, on) => {
    const { w, a } = linked(on)
    const owed = mirrored({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: true })
    owed.row = { artifact: URL_A, version: 1, sent: 'stale' }
    const done = Array.from({ length: 201 }, (_, n) =>
      stored({
        id: `01CCCCCCCCCCCCCCCCCCCC${String(n).padStart(4, '0')}`,
        type: 'approve',
        status: 'answered',
        response: { selected: ['Approve'] },
        response_at: START + n,
        delivered: true,
      }),
    )
    w.seed({ version: 1, items: [owed, ...done], sessions: {} })
    a.listFails = true
    a.garble = 1_000
    await $.session.start(START_EVENT)
    expect(w.store().items.some(item => item.id === ID1)).toBe(true)
  })
})

describe('adopting the rows of a replaced container', () => {
  test("open rows and an answered, undelivered row of this session are adopted; others' and delivered rows are not", async ($, on) => {
    const { w, a } = linked(on)
    const open = mirrored({ id: ID1, type: 'approve' })
    const answered = mirrored({ id: ID2, type: 'approve', status: 'answered', response: { selected: ['Reject'] }, response_at: START - 5 })
    const delivered = mirrored({
      id: '01AAAAAAAAAAAAAAAAAAAAITEM3',
      type: 'approve',
      status: 'answered',
      response: { selected: ['Reject'] },
      delivered: true,
    })
    const theirs = mirrored({ id: '01AAAAAAAAAAAAAAAAAAAAITEM4', type: 'approve' })
    theirs.remote = { ...REMOTE, session_id: OTHER }
    for (const item of [open, answered, delivered, theirs]) {
      a.put(URL_A, `items/${item.id}`, itemToRow(item) as unknown as Record<string, unknown>)
    }
    // The fresh container: no file at all.
    await $.session.start(START_EVENT)
    await settle(w)
    const ids = w.store().items.map(item => item.id).sort()
    expect(ids).toEqual([ID1, ID2])
    expect(w.store().items.every(item => item.session_id === 'session-a' && item.remote?.session_id === ME)).toBe(true)
    expect(w.submits).toEqual([`humantray HT-${ID2.slice(-5)} (Seeded): Reject`])
    // The open one is later answered on the page.
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toHaveLength(2)
  })
})

describe('pruning finished rows', () => {
  test('past the newest 200 finished rows, prunable ones are deleted with their answers; others are kept', async ($, on) => {
    const { w, a } = linked(on)
    const rows: Item[] = []
    for (let n = 0; n < 205; n++) {
      rows.push(
        mirrored({
          id: `01DDDDDDDDDDDDDDDDDDDD${String(n).padStart(4, '0')}`,
          type: 'approve',
          status: 'answered',
          response: { selected: ['Approve'] },
          response_at: START - 1_000_000 + n * 10,
          delivered: true,
        }),
      )
    }
    // Among the oldest: one undelivered, one refused, and one open item (never finished).
    const undelivered = { ...(rows[0] as Item), delivered: false }
    const refused = { ...(rows[1] as Item), response_refused: { answer_id: 'refusedanswer00001', reason: 'no', at: 1 } }
    rows[0] = undelivered
    rows[1] = refused
    const open = mirrored({ id: '01DDDDDDDDDDDDDDDDDDDDOPEN', type: 'approve' })
    for (const item of [...rows, open]) {
      a.put(URL_A, `items/${item.id}`, itemToRow(item as Item & Required<Pick<Item, 'remote'>>) as unknown as Record<string, unknown>)
    }
    a.put(URL_A, `responses/${rows[2]?.id}`, response(rows[2]?.id ?? ''))
    a.session = { id: OTHER, title: null, parent: null }
    await $.session.start(START_EVENT)
    await settle(w)
    const left = (n: number) => a.doc(URL_A, `items/${rows[n]?.id}`) !== undefined
    expect([left(0), left(1), left(2), left(3), left(4), left(5)]).toEqual([true, true, false, false, false, true])
    expect(a.doc(URL_A, `responses/${rows[2]?.id}`)).toBeUndefined()
    expect(a.doc(URL_A, `items/${open.id}`)).toBeDefined()
    expect(left(204)).toBe(true)
  })
})

describe('finding and adopting later in the life of the process', () => {
  test('a store unreachable for the first 70 s: a turn after ten minutes finds the page and pushes', async ($, on) => {
    const { w, a } = linked(on)
    a.listFails = true
    await $.session.start(START_EVENT)
    await settle(w)
    await w.clock.advance(70_000)
    a.listFails = false
    const id = answerOf<{ id: string; page: string }>(await $.tool.call(approve))
    expect(id.page).toBe('waiting')
    await $.turn.start(TURN_START)
    await settle(w)
    // Within ten minutes of the last try: no new find.
    expect(a.doc(URL_A, `items/${id.id}`)).toBeUndefined()
    await w.clock.advance(FIND_AGAIN_MS)
    await $.turn.start(TURN_START)
    await settle(w)
    expect(a.doc(URL_A, `items/${id.id}`)).toBeDefined()
    expect(answerOf<{ page: string }>(await $.tool.call({ ...approve, key: 'next' })).page).toBe('queued')
  })

  test('a replaced container whose get_session fails for the first 70 s adopts at a later turn, and takes the waiting answer', async ($, on) => {
    const { w, a } = linked(on)
    const open = mirrored({ id: ID1, type: 'approve' })
    a.put(URL_A, `items/${ID1}`, itemToRow(open) as unknown as Record<string, unknown>)
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    const answer = a.session
    a.session = undefined
    await $.session.start(START_EVENT)
    await settle(w)
    await w.clock.advance(70_000)
    a.session = answer
    await $.turn.start(TURN_START)
    await settle(w)
    await w.clock.advance(FIND_AGAIN_MS)
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.store().items.map(item => item.id)).toEqual([ID1])
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.submits).toEqual([`humantray HT-${ID1.slice(-5)} (Seeded): Approve`])
  })

  test('a page made after the session started is found at a turn ten minutes on', async ($, on) => {
    const w = world(on, CLOUD)
    const a = artifactWorld(on, { read: path => w.files.get(path) })
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', meta(START))
    await w.clock.advance(FIND_AGAIN_MS)
    await $.turn.start(TURN_START)
    await settle(w)
    expect(a.doc(URL_A, `items/${id}`)).toBeDefined()
  })
})

describe('the pane and the store', () => {
  test('a pane answer clears a refused store answer and names the pane', async ($, on) => {
    const { w, a } = linked(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    a.put(URL_A, `responses/${id}`, response(id, { response: { selected: ['Maybe'] } }))
    await $.turn.start(TURN_START)
    await settle(w)
    expect(w.store().items[0]?.response_refused).toBeDefined()
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:reject` })
    await ui.unmount()
    await settle(w)
    const item = w.store().items[0]
    expect(item).toMatchObject({ status: 'answered', response: { selected: ['Reject'] }, response_by: 'pane' })
    expect(item?.response_refused).toBeUndefined()
    await $.turn.start(TURN_START)
    await settle(w)
    const row = a.doc(URL_A, `items/${id}`)?.data
    expect(row).toMatchObject({ status: 'answered', response_by: 'pane', delivered: true })
    expect(row).not.toHaveProperty('response_refused')
  })
})

describe('rewrites keep what this version does not know', () => {
  test('an adopted row with a field this version does not know keeps it through a bump', async ($, on) => {
    const { w, a } = linked(on)
    const item = mirrored({ id: ID1, type: 'approve', key: 'merge', body_md: 'one' })
    a.put(URL_A, `items/${ID1}`, { ...(itemToRow(item) as unknown as Record<string, unknown>), role: 'worker' })
    // A replaced container: adopted at the row's own version, so the next push is pinned to it.
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.store().items[0]?.row?.version).toBe(1)
    const bumped = answerOf<{ id: string; bumped: boolean }>(await $.tool.call({ ...approve, key: 'merge', body_md: 'two' }))
    expect(bumped).toMatchObject({ id: ID1, bumped: true })
    await settle(w)
    expect(a.doc(URL_A, `items/${ID1}`)?.data).toMatchObject({ role: 'worker', body_md: 'two', bumps: 1 })
  })
})

describe('pruning, linked or not', () => {
  test('a cloud session with no page prunes its finished items to 200', async ($, on) => {
    const w = world(on, CLOUD)
    artifactWorld(on)
    const done = Array.from({ length: 205 }, (_, n) =>
      stored({
        id: `01FFFFFFFFFFFFFFFFFFFF${String(n).padStart(4, '0')}`,
        type: 'approve',
        status: 'answered',
        response: { selected: ['Approve'] },
        response_at: START - 1_000_000 + n,
        delivered: true,
        remote: { ...REMOTE },
      }),
    )
    w.seed({ version: 1, items: done, sessions: {} })
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.store().items).toHaveLength(200)
  })

  test('no finished row is pruned while any finished row could not be read', async ($, on) => {
    const { w, a } = linked(on)
    for (let n = 0; n < 205; n++) {
      const item = mirrored({
        id: `01GGGGGGGGGGGGGGGGGGGG${String(n).padStart(4, '0')}`,
        type: 'approve',
        status: 'answered',
        response: { selected: ['Approve'] },
        response_at: START - 1_000_000 + n * 10,
        delivered: true,
      })
      a.put(URL_A, `items/${item.id}`, itemToRow(item) as unknown as Record<string, unknown>)
    }
    a.put(URL_A, 'items/01GGGGGGGGGGGGGGGGGGGGNEWR', { schema: 2, status: 'answered', response_at: START })
    a.session = { id: OTHER, title: null, parent: null }
    await $.session.start(START_EVENT)
    await settle(w)
    expect(a.doc(URL_A, 'items/01GGGGGGGGGGGGGGGGGGGG0000')).toBeDefined()
    expect(a.writes().filter(c => c.input.action === 'batch')).toEqual([])
  })
})

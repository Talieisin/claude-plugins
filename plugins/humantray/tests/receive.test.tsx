// The asker's side of the viewer's answers (#32): a cloud session takes a
// response envelope in `prompt.submit` (a cold container) or
// `session.receive` (a running one), as test 0 recorded, writes the response
// row under rule 4, and delivers the answer exactly once.

import { type Engine, describe, expect, test } from 'claude-code/testing'

import type { Item } from '../types'
import { fingerprint, itemToRow } from '../hooks/row-shape'
import { LEAD, ME, OTHER, TITLE, URL_A, URL_B, artifactWorld, meta, response } from './artifact-world'
import { TYPED, coldSubmit, envelopeFor, textOf, warmReceive, wrapped } from './envelope-fixtures'
import { COMMAND, START, START_EVENT, stored, world } from './world'

const CLOUD = { env: { CLAUDE_CODE_REMOTE: 'true' } }
const REMOTE = { session_id: ME, session_title: 'worker for #1', parent_session_id: LEAD, lead_session_id: LEAD }
const ID1 = '01AAAAAAAAAAAAAAAAAAAAITEM1'
const ID2 = '01AAAAAAAAAAAAAAAAAAAAITEM2'
const LINE1 = `humantray HT-${ID1.slice(-5)} (Seeded): Approve`

type On = Parameters<typeof world>[0]

function linked(on: On, options: Parameters<typeof world>[1] = {}) {
  const w = world(on, { ...CLOUD, ...options })
  const a = artifactWorld(on, { read: path => w.files.get(path) })
  a.add(URL_A, TITLE)
  a.put(URL_A, 'meta/page', meta(START - 1000))
  return { w, a }
}

function mirrored(fields: Partial<Item> & Pick<Item, 'id' | 'type'>): Item & Required<Pick<Item, 'remote'>> {
  const item = stored({ ...fields, remote: { ...REMOTE } }) as Item & Required<Pick<Item, 'remote'>>
  item.row = { artifact: URL_A, version: 1, sent: fingerprint(item) }
  return item
}

function seedMirrored(w: ReturnType<typeof world>, a: ReturnType<typeof artifactWorld>, items: Item[]) {
  w.seed({ version: 1, items, sessions: {} })
  for (const item of items) {
    if (item.remote === undefined) continue
    a.put(URL_A, `items/${item.id}`, itemToRow(item as Item & Required<Pick<Item, 'remote'>>) as unknown as Record<string, unknown>)
  }
}

/** Lets detached takes, passes and deliveries finish. */
async function settle(w: ReturnType<typeof world>) {
  for (let i = 0; i < 4; i++) {
    await w.clock.settle()
    await w.drain()
  }
  await w.clock.settle()
}

/** A linked cloud session with one open approve item of its own, started. */
async function asker($: Engine, on: On, items?: Item[]) {
  const { w, a } = linked(on)
  seedMirrored(w, a, items ?? [mirrored({ id: ID1, type: 'approve' })])
  await $.session.start(START_EVENT)
  await settle(w)
  w.submits.length = 0
  return { w, a }
}

const responseWrites = (a: ReturnType<typeof artifactWorld>) => a.writes().filter(c => c.input.collection === 'responses')

describe('where an envelope is taken (test 0 on #32)', () => {
  test('cold: at prompt.submit (origin peer, isMeta, no turnId) it is dropped, written, applied and delivered as one submit', async ($, on) => {
    const { w, a } = await asker($, on)
    const sent = await $.prompt.submit(coldSubmit(wrapped(textOf(envelopeFor(ID1)))))
    expect(sent.drop).toBeDefined()
    await settle(w)
    expect(w.submits).toEqual([LINE1])
    const row = a.doc(URL_A, `responses/${ID1}`)
    expect(row?.data).toMatchObject({ schema: 1, id: ID1, by: 'viewer', response: { selected: ['Approve'] } })
    expect(row?.data.to).toBeUndefined()
    expect(row?.data.artifact).toBeUndefined()
    const item = w.store().items[0]
    expect(item).toMatchObject({ status: 'answered', delivered: true, response_by: 'viewer', answer_id: envelopeFor(ID1).answer_id })
    // The delivery is mirrored to the row, where the viewer settles its entry.
    expect(a.doc(URL_A, `items/${ID1}`)?.data).toMatchObject({ status: 'answered', delivered: true, envelope: 1 })
  })

  test('running: at session.receive (origin peer) it is consumed and delivered as one submit', async ($, on) => {
    const { w } = await asker($, on)
    const got = await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    expect(got.consumed).toBeDefined()
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })

  test('typed Markdown arrives whole in the delivered answer', async ($, on) => {
    const { w } = await asker($, on, [mirrored({ id: ID1, type: 'question', question: 'How?' })])
    const envelope = envelopeFor(ID1, { response: { text: TYPED }, status: 'answered' })
    await $.session.receive(warmReceive(wrapped(textOf(envelope))))
    await settle(w)
    expect(w.submits).toHaveLength(1)
    expect(w.submits[0]?.startsWith(`humantray HT-${ID1.slice(-5)} (Seeded):`)).toBe(true)
    expect(w.submits[0]?.includes(TYPED)).toBe(true)
    expect((w.store().items[0]?.response as { text: string }).text).toBe(TYPED)
  })

  test('the same text from any other origin passes untouched and writes nothing', async ($, on) => {
    const { w, a } = await asker($, on)
    const text = wrapped(textOf(envelopeFor(ID1)))
    for (const kind of ['composer', 'bridge', 'task-notification', 'scheduled-trigger', 'sdk'] as const) {
      const passed = await $.prompt.submit({ text, origin: { kind }, wait: false })
      expect(passed.drop).toBeUndefined()
      expect(passed.text).toBe(text)
    }
    const fromPlugin = await $.prompt.submit({ text, origin: { kind: 'plugin', name: 'other' }, wait: false })
    expect(fromPlugin.drop).toBeUndefined()
    for (const kind of ['bridge', 'task-notification', 'scheduled-trigger', 'unclassified'] as const) {
      const got = await $.session.receive({ origin: { kind }, text })
      expect(got.consumed).toBeUndefined()
    }
    await settle(w)
    expect(responseWrites(a)).toEqual([])
    expect(w.store().items[0]?.status).toBe('open')
  })

  test("a peer's message with other text beside an envelope passes untouched", async ($, on) => {
    const { w, a } = await asker($, on)
    const text = wrapped(`Here is the answer:\n${textOf(envelopeFor(ID1))}`)
    const got = await $.session.receive(warmReceive(text))
    expect(got.consumed).toBeUndefined()
    expect(w.received).toEqual([text])
    const sent = await $.prompt.submit(coldSubmit(text))
    expect(sent.drop).toBeUndefined()
    await settle(w)
    expect(responseWrites(a)).toEqual([])
  })

  test('the hook decides at once: with the store held, the envelope is still stopped', async ($, on) => {
    const { w, a } = await asker($, on)
    let release = () => undefined as void
    a.hold = new Promise<void>(resolve => {
      release = resolve
    })
    const got = await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    expect(got.consumed).toBeDefined()
    release()
    a.hold = undefined
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })

  test("a subagent's delivery passes untouched", async ($, on) => {
    const { w, a } = await asker($, on)
    const got = await $.session.receive({ ...warmReceive(wrapped(textOf(envelopeFor(ID1)))), agentId: 'agent-1' })
    expect(got.consumed).toBeUndefined()
    await settle(w)
    expect(responseWrites(a)).toEqual([])
  })
})

describe('exactly once, whatever repeats', () => {
  test('the same envelope three times gives one submit', async ($, on) => {
    const { w } = await asker($, on)
    const text = wrapped(textOf(envelopeFor(ID1)))
    await $.session.receive(warmReceive(text))
    await settle(w)
    await $.session.receive(warmReceive(text))
    await $.prompt.submit(coldSubmit(text))
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })

  test('two copies taken at once: one create, one submit', async ($, on) => {
    const { w, a } = await asker($, on)
    const text = wrapped(textOf(envelopeFor(ID1)))
    await Promise.all([$.session.receive(warmReceive(text)), $.session.receive(warmReceive(text))])
    await settle(w)
    expect(w.submits).toEqual([LINE1])
    expect(a.doc(URL_A, `responses/${ID1}`)?.version).toBe(1)
  })

  test('taken mid-turn, then delivered again at the next cold start (as test 0 saw): no second submit, still stopped', async ($, on) => {
    const { w } = await asker($, on)
    const text = wrapped(textOf(envelopeFor(ID1)))
    await $.session.receive(warmReceive(text))
    await settle(w)
    const again = await $.prompt.submit(coldSubmit(text))
    expect(again.drop).toBeDefined()
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })

  test('racing a page answer: the counting row is left alone and one answer is delivered', async ($, on) => {
    const { w, a } = await asker($, on)
    a.put(URL_A, `responses/${ID1}`, response(ID1, { response: { selected: ['Reject'] } }))
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    expect(w.submits).toEqual([`humantray HT-${ID1.slice(-5)} (Seeded): Reject`])
    expect(a.doc(URL_A, `responses/${ID1}`)?.data).toMatchObject({ by: 'page' })
    expect(responseWrites(a)).toEqual([])
  })
})

describe('cold starts', () => {
  test('the row was written and the process ended before the apply: the next start gives one submit', async ($, on) => {
    const { w, a } = linked(on)
    seedMirrored(w, a, [mirrored({ id: ID1, type: 'approve' })])
    // What the envelope left in the store before the process went away.
    const { to: _to, artifact: _artifact, ...row } = envelopeFor(ID1)
    a.put(URL_A, `responses/${ID1}`, row as unknown as Record<string, unknown>)
    await $.session.start(START_EVENT)
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })

  test('the same envelope after the answer was delivered gives no submit and is still stopped', async ($, on) => {
    const answered = mirrored({
      id: ID1,
      type: 'approve',
      status: 'answered',
      response: { selected: ['Approve'] },
      response_at: START - 10,
      response_by: 'viewer',
      answer_id: envelopeFor(ID1).answer_id,
      delivered: true,
      delivered_at: START - 5,
    })
    const { w } = await asker($, on, [answered])
    const sent = await $.prompt.submit(coldSubmit(wrapped(textOf(envelopeFor(ID1)))))
    expect(sent.drop).toBeDefined()
    await settle(w)
    expect(w.submits).toEqual([])
  })
})

describe('rule 4', () => {
  test('absent: an unpinned create', async ($, on) => {
    const { w, a } = await asker($, on)
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    const writes = responseWrites(a)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.input.if_version).toBeUndefined()
  })

  test('present but not counting (an empty lease document): a set pinned to the version read', async ($, on) => {
    const { w, a } = await asker($, on)
    a.put(URL_A, `responses/${ID1}`, { holder: 'someone' })
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    const writes = responseWrites(a)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.input.if_version).toBe(1)
    expect(w.submits).toEqual([LINE1])
  })

  test('present but the answer this item refused: replaced, pinned', async ($, on) => {
    const refusedId = 'refusedanswerid00000000'
    const item = mirrored({ id: ID1, type: 'approve', response_refused: { answer_id: refusedId, reason: 'no', at: START } })
    const { w, a } = await asker($, on, [item])
    a.put(URL_A, `responses/${ID1}`, response(ID1, { answer_id: refusedId }))
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    expect(responseWrites(a)[0]?.input.if_version).toBe(1)
    expect(w.submits).toEqual([LINE1])
  })
})

describe('checked before anything is written', () => {
  test('an answer given before the item was raised again is refused on the row, and no response row is written', async ($, on) => {
    const { w, a } = await asker($, on, [mirrored({ id: ID1, type: 'approve', bumps: 1 })])
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1, { seen: { bumps: 0, updated: 0 } })))))
    await settle(w)
    expect(responseWrites(a)).toEqual([])
    expect(w.submits).toEqual([])
    const item = w.store().items[0]
    expect(item?.status).toBe('open')
    expect(item?.response_refused?.answer_id).toBe(envelopeFor(ID1).answer_id)
    expect(a.doc(URL_A, `items/${ID1}`)?.data).toMatchObject({ response_refused: { answer_id: envelopeFor(ID1).answer_id } })
  })

  test('an envelope answer to an item that comes after one still open is refused before writing, with the reason (#82)', async ($, on) => {
    const { w, a } = await asker($, on, [
      mirrored({ id: ID2, type: 'do' }),
      mirrored({ id: ID1, type: 'approve', after: [ID2] }),
    ])
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    expect(responseWrites(a)).toEqual([])
    expect(w.submits).toEqual([])
    const item = w.store().items.find(one => one.id === ID1)
    expect(item?.status).toBe('open')
    expect(item?.response_refused).toMatchObject({ answer_id: envelopeFor(ID1).answer_id, reason: expect.stringMatching(/comes after HT-/) })
  })

  test('an envelope answer to a withdrawn item is refused before writing, with the reason (#82)', async ($, on) => {
    const { w, a } = await asker($, on, [mirrored({ id: ID1, type: 'approve', withdrawn: { at: START - 5, reason: 'gone' }, delivered: true })])
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    expect(responseWrites(a)).toEqual([])
    expect(w.submits).toEqual([])
    expect(w.store().items[0]?.response_refused?.reason).toMatch(/withdrawn by its session/)
  })

  test('an item answered and not yet delivered is delivered once, and nothing is written', async ($, on) => {
    const applied = mirrored({
      id: ID1,
      type: 'approve',
      status: 'answered',
      response: { selected: ['Approve'] },
      response_at: START - 10,
      response_by: 'viewer',
      answer_id: envelopeFor(ID1).answer_id,
      delivered: false,
    })
    const { w, a } = linked(on)
    seedMirrored(w, a, [applied])
    // A start that cannot deliver (every submit dropped), as after a lost submit.
    w.answerSubmit = () => ({ drop: 'busy' })
    await $.session.start(START_EVENT)
    await settle(w)
    w.answerSubmit = e => ({ text: e.text })
    w.submits.length = 0
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    expect(w.submits).toEqual([LINE1])
    expect(responseWrites(a)).toEqual([])
    expect(w.store().items[0]?.delivered).toBe(true)
  })
})

describe('routing: nothing is written, the envelope is still stopped', () => {
  const cases: Array<[string, Parameters<typeof envelopeFor>[1]]> = [
    ['addressed to another session', { to: OTHER }],
    ['read from another artifact', { artifact: URL_B }],
  ]
  for (const [name, fields] of cases) {
    test(name, async ($, on) => {
      const { w, a } = await asker($, on)
      const got = await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1, fields)))))
      expect(got.consumed).toBeDefined()
      await settle(w)
      expect(responseWrites(a)).toEqual([])
      expect(w.submits).toEqual([])
    })
  }

  test("another session's item", async ($, on) => {
    const theirs = mirrored({ id: ID2, type: 'approve', session_id: 'session-b' })
    const { w, a } = await asker($, on, [mirrored({ id: ID1, type: 'approve' }), theirs])
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID2)))))
    await settle(w)
    expect(responseWrites(a)).toEqual([])
    expect(w.submits).toEqual([])
  })

  test('a local session takes an envelope and does nothing with it', async ($, on) => {
    const w = world(on)
    const a = artifactWorld(on)
    a.add(URL_A, TITLE)
    await $.session.start(START_EVENT)
    const got = await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    expect(got.consumed).toBeDefined()
    await settle(w)
    expect(a.writes()).toEqual([])
    expect(w.submits).toEqual([])
  })
})

describe('when the session cannot act yet', () => {
  test('lineage unknown: the envelope is dropped; a later copy works', async ($, on) => {
    const { w, a } = linked(on)
    seedMirrored(w, a, [mirrored({ id: ID1, type: 'approve' })])
    a.session = undefined
    await $.session.start(START_EVENT)
    await settle(w)
    const text = wrapped(textOf(envelopeFor(ID1)))
    await $.session.receive(warmReceive(text))
    await settle(w)
    expect(responseWrites(a)).toEqual([])
    expect(w.submits).toEqual([])
    a.session = { id: ME, title: 'worker for #1', parent: LEAD }
    await $.session.receive(warmReceive(text))
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })

  test('the store unavailable: nothing applied; a later copy works', async ($, on) => {
    const { w, a } = await asker($, on)
    const text = wrapped(textOf(envelopeFor(ID1)))
    a.garble = 1_000
    await $.session.receive(warmReceive(text))
    await settle(w)
    expect(w.store().items[0]?.status).toBe('open')
    expect(w.submits).toEqual([])
    a.garble = 0
    await $.session.receive(warmReceive(text))
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })

  test('a replaced container: the row is adopted first, then the answer applied and delivered', async ($, on) => {
    const { w, a } = linked(on)
    const item = mirrored({ id: ID1, type: 'approve' })
    a.put(URL_A, `items/${ID1}`, itemToRow(item) as unknown as Record<string, unknown>)
    // The local file is gone; this session started after a store outage, so it has not adopted yet.
    a.garble = 1_000
    await $.session.start(START_EVENT)
    await settle(w)
    a.garble = 0
    expect(w.store().items).toEqual([])
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })

  test('the delivering submit dropped once: the next envelope delivers it once', async ($, on) => {
    const { w } = await asker($, on)
    let entered = 0
    let drops = 1
    w.answerSubmit = e => {
      if (drops > 0) {
        drops -= 1
        return { drop: 'busy' }
      }
      entered += 1
      return { text: e.text }
    }
    const text = wrapped(textOf(envelopeFor(ID1)))
    await $.session.receive(warmReceive(text))
    await settle(w)
    expect(entered).toBe(0)
    expect(w.store().items[0]).toMatchObject({ status: 'answered', delivered: false })
    await $.session.receive(warmReceive(text))
    await settle(w)
    expect(entered).toBe(1)
    expect(w.store().items[0]?.delivered).toBe(true)
  })
})

describe('a retry that applies an answer delivers it (F3)', () => {
  test('an idle asker whose pull fails once: the retry applies the page answer and delivers it, with no turn event', async ($, on) => {
    const { w, a } = await asker($, on)
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    let failed = false
    a.before = input => {
      if (!failed && input.collection === 'responses') {
        failed = true
        a.garble = 1
      }
    }
    // One turn: its pull fails, then the session is idle.
    await $.turn.start({ text: '', turnId: 'turn-1' })
    await settle(w)
    expect(w.submits).toEqual([])
    // The in-process retry, about 5 s later.
    await w.clock.advance(6_000)
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })
})

describe('the hooks fail closed, and only a whole text is taken', () => {
  test('the hooks decide without waiting: with $.session.id() slow, both return at once with the envelope stopped, then take it', async ($, on) => {
    const { w } = await asker($, on, [mirrored({ id: ID1, type: 'approve' }), mirrored({ id: ID2, type: 'approve' })])
    let open = () => undefined as void
    w.sessionIdGate = new Promise<void>(resolve => {
      open = resolve
    })
    // Neither call may wait on the gate: if one did, the await would never resolve and the test would time out.
    const sent = await $.prompt.submit(coldSubmit(wrapped(textOf(envelopeFor(ID1)))))
    expect(sent.drop).toBe(`humantray: took an answer for HT-${ID1.slice(-5)} from the viewer`)
    const got = await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID2)))))
    expect(got.consumed).toBe(`humantray: took an answer for HT-${ID2.slice(-5)} from the viewer`)
    expect(w.received).toEqual([])
    w.sessionIdGate = undefined
    open()
    await settle(w)
    expect(w.submits).toHaveLength(2)
  })

  test('a failing $.session.id(): the envelope is still stopped at once, the take is discarded with a log line, and a later copy is taken', async ($, on) => {
    const { w, a } = await asker($, on)
    w.failSessionId = true
    const sent = await $.prompt.submit(coldSubmit(wrapped(textOf(envelopeFor(ID1)))))
    expect(sent.drop).toBeDefined()
    const got = await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    expect(got.consumed).toBeDefined()
    await settle(w)
    expect(w.received).toEqual([])
    expect(responseWrites(a)).toEqual([])
    expect(w.logs.some(line => line.includes('was discarded'))).toBe(true)
    w.failSessionId = false
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })

  test('what is not an envelope passes on, whatever the session id does', async ($, on) => {
    const { w } = await asker($, on)
    w.failSessionId = true
    const text = 'an ordinary message from another session'
    const got = await $.session.receive(warmReceive(text))
    expect(got.consumed).toBeUndefined()
    expect(w.received).toEqual([text])
  })

  test('a wrapper is taken only as the whole text: a line before it or after it passes untouched', async ($, on) => {
    const { w, a } = await asker($, on)
    const one = wrapped(textOf(envelopeFor(ID1)))
    for (const text of [`Look:\n${one}`, `${one}\nThat was it.`]) {
      const got = await $.session.receive(warmReceive(text))
      expect(got.consumed).toBeUndefined()
    }
    await settle(w)
    expect(responseWrites(a)).toEqual([])
  })

  test('two complete wrapped envelopes in one text (two deliveries dequeued together): each is taken', async ($, on) => {
    const { w } = await asker($, on, [mirrored({ id: ID1, type: 'approve' }), mirrored({ id: ID2, type: 'approve' })])
    const text = `${wrapped(textOf(envelopeFor(ID1)))}\n${wrapped(textOf(envelopeFor(ID2, { response: { selected: ['Reject'] } })))}`
    const sent = await $.prompt.submit(coldSubmit(text))
    expect(sent.drop).toContain(`HT-${ID1.slice(-5)}`)
    expect(sent.drop).toContain(`HT-${ID2.slice(-5)}`)
    await settle(w)
    expect([...w.submits].sort()).toEqual([LINE1, `humantray HT-${ID2.slice(-5)} (Seeded): Reject`].sort())
  })

  test('two envelopes with anything else between or around them pass untouched', async ($, on) => {
    const { w, a } = await asker($, on, [mirrored({ id: ID1, type: 'approve' }), mirrored({ id: ID2, type: 'approve' })])
    const two = `${wrapped(textOf(envelopeFor(ID1)))}\nand also\n${wrapped(textOf(envelopeFor(ID2)))}`
    const got = await $.session.receive(warmReceive(two))
    expect(got.consumed).toBeUndefined()
    await settle(w)
    expect(responseWrites(a)).toEqual([])
  })
})

describe('rule 4 when someone writes first', () => {
  test('the page creates the row between our read and our create: read again, nothing written, the page answer delivered once', async ($, on) => {
    const { w, a } = await asker($, on)
    let raced = false
    a.before = input => {
      if (!raced && input.action === 'set' && input.collection === 'responses' && input.if_version === undefined) {
        raced = true
        a.put(URL_A, `responses/${ID1}`, response(ID1, { response: { selected: ['Reject'] } }))
      }
    }
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    await settle(w)
    expect(raced).toBe(true)
    expect(a.doc(URL_A, `responses/${ID1}`)?.data).toMatchObject({ by: 'page' })
    expect(w.submits).toEqual([`humantray HT-${ID1.slice(-5)} (Seeded): Reject`])
  })
})

describe('only a cloud session acts on an envelope', () => {
  test('a local session with the item, the page and a lineage still writes and delivers nothing', async ($, on) => {
    const w = world(on)
    const a = artifactWorld(on, { read: path => w.files.get(path) })
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', meta(START - 1000))
    const item = mirrored({ id: ID1, type: 'approve' })
    w.seed({ version: 1, items: [item], sessions: {} })
    a.put(URL_A, `items/${ID1}`, itemToRow(item) as unknown as Record<string, unknown>)
    await $.session.start(START_EVENT)
    const got = await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1)))))
    expect(got.consumed).toBeDefined()
    await settle(w)
    expect(a.writes()).toEqual([])
    expect(w.submits).toEqual([])
    expect(w.store().items[0]?.status).toBe('open')
  })

  test('the artifact link in its other form (/code/artifact/) is the same artifact', async ($, on) => {
    const { w } = await asker($, on)
    const other = URL_A.replace('/artifact/', '/code/artifact/')
    await $.session.receive(warmReceive(wrapped(textOf(envelopeFor(ID1, { artifact: other })))))
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })
})

describe('the page command never delivers (decided on #32)', () => {
  test('/humantray-page adopting an answered, undelivered row submits nothing; the next turn delivers it once', async ($, on) => {
    const { w, a } = linked(on)
    const answered = mirrored({
      id: ID1,
      type: 'approve',
      status: 'answered',
      response: { selected: ['Approve'] },
      response_at: START - 10,
      response_by: 'page',
      answer_id: 'pageanswer00000000000000',
      delivered: false,
    })
    a.put(URL_A, `items/${ID1}`, itemToRow(answered) as unknown as Record<string, unknown>)
    // A replaced container whose store could not be reached at start: nothing linked or adopted yet.
    a.garble = 1_000
    await $.session.start(START_EVENT)
    await settle(w)
    a.garble = 0
    await $.command.run({ ...COMMAND, command: 'humantray-page', args: '' })
    await settle(w)
    expect(w.store().items.map(item => item.id)).toEqual([ID1])
    expect(w.submits).toEqual([])
    await $.turn.start({ text: '', turnId: 'turn-2' })
    await settle(w)
    expect(w.submits).toEqual([LINE1])
  })
})

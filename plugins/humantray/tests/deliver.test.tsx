// Delivery: each answer reaches the owning session as one line, at least once
// and never lost. A claim is written before the submit; the submit is never
// awaited by a hook; a drop or a rejection releases the claim for a retry.

import { describe, expect, test } from 'claude-code/testing'

import type { Item, StoreFile } from '../types'
import {
  ADD,
  BAND,
  COMMAND,
  HOUR,
  LIST,
  PANE,
  START,
  START_EVENT,
  type Step,
  TURN,
  answerOne,
  stored,
  world,
} from './world'

const OPTIONS = [
  { label: 'Red', description: 'Warm' },
  { label: 'Blue', description: 'Cool' },
  { label: 'Green', description: 'Fresh' },
]

const LINES: Array<[string, Record<string, unknown>, Step[], string]> = [
  ['ack, notified', { type: 'ack', header: 'FYI', question: 'Deployed', notify_on_done: true }, [{ press: 'ack' }], '(FYI): acknowledged'],
  [
    'choice, single',
    { type: 'choice', header: 'Colour', question: 'Which?', options: OPTIONS },
    [{ press: 'opt:1' }, { press: 'submit' }],
    '(Colour): Blue',
  ],
  [
    'choice, Other only',
    { type: 'choice', header: 'Colour', question: 'Which?', options: OPTIONS },
    [{ change: 'other', text: 'Purple' }, { press: 'submit' }],
    '(Colour): Other: Purple',
  ],
  [
    'choice, multi with Other',
    { type: 'choice', header: 'Colour', question: 'Which?', options: OPTIONS, multiSelect: true },
    [{ press: 'opt:0' }, { press: 'opt:2' }, { change: 'other', text: 'Teal' }, { press: 'submit' }],
    '(Colour): Red; Green; Other: Teal',
  ],
  ['question', { type: 'question', header: 'Name', question: 'What?' }, [{ type: 'text', text: 'humantray' }], '(Name): humantray'],
  [
    'question, several lines',
    { type: 'question', header: 'Name', question: 'What?' },
    [{ type: 'text', text: 'line one\n\n   line two\r\nline three' }],
    '(Name): line one / line two / line three',
  ],
  ['do, done', { type: 'do', header: 'Key', question: 'Rotate' }, [{ press: 'done' }], '(Key): done'],
  [
    'do, not done with feedback',
    { type: 'do', header: 'Key', question: 'Rotate' },
    [{ change: 'feedback', text: 'No access' }, { press: 'not_done' }],
    '(Key): not done: No access',
  ],
  ['approve', { type: 'approve', header: 'Plan', question: 'OK?' }, [{ press: 'approve' }], '(Plan): Approve'],
  ['reject', { type: 'approve', header: 'Plan', question: 'OK?' }, [{ press: 'reject' }], '(Plan): Reject'],
]

describe('the line', () => {
  for (const [name, call, steps, line] of LINES) {
    test(`${name}: one line, once`, async ($, on) => {
      const w = world(on)
      await $.session.start(START_EVENT)
      const item = await answerOne($, w, 'desktop', call, steps)
      expect(w.submits).toEqual([`humantray ${item.short} ${line}`])
      expect(item.delivered).toBe(true)
      expect(item.delivering_at).toBeUndefined()
      await $.turn.complete(TURN)
      await $.session.start(START_EVENT)
      expect(w.submits).toHaveLength(1)
    })

    test(`${name}, with notes: the notes follow the answer`, async ($, on) => {
      const w = world(on)
      await $.session.start(START_EVENT)
      const item = await answerOne($, w, 'desktop', { ...call, notes: true }, [{ change: 'notes', text: 'see\nthe log' }, ...steps])
      expect(w.submits).toEqual([`humantray ${item.short} ${line} | notes: see / the log`])
    })
  }
})

/** Seeds one answered, undelivered approve item of the given session. */
function answered(fields: Partial<Item> = {}): Item {
  return stored({
    id: '01AAAAAAAAAAAAAAAAAAAAANSWR',
    type: 'approve',
    header: 'Plan',
    status: 'answered',
    response: { selected: ['Approve'] },
    response_at: START - 60_000,
    ...fields,
  })
}

const seedWith = (items: Item[], sessions: StoreFile['sessions'] = { 'session-a': { seen: START - HOUR } }): StoreFile => ({
  version: 1,
  items,
  sessions,
})

describe('claim, send, settle', () => {
  test('the claim is on disk before the submit; delivered and no claim after it', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    const seen: Array<Partial<Item>> = []
    w.duringSubmit = () => {
      const item = w.store().items[0]
      seen.push({ delivered: item?.delivered, delivering_at: item?.delivering_at, delivering_by: item?.delivering_by })
    }
    await $.session.start(START_EVENT)
    await w.drain()
    expect(seen).toEqual([{ delivered: false, delivering_at: START, delivering_by: expect.stringMatching(/^[0-9a-f]{16}$/) }])
    const item = w.store().items[0]
    expect(item?.delivered).toBe(true)
    expect(item?.delivered_at).toBe(START)
    expect(item?.delivering_at).toBeUndefined()
    expect(item?.delivering_by).toBeUndefined()
  })

  test('a dropped submit releases the claim; the next turn end sends exactly one line', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    let drops = 1
    w.answerSubmit = e => (drops-- > 0 ? { drop: 'the prompt was removed from the queue before it ran' } : { text: e.text })
    await $.session.start(START_EVENT)
    await w.drain()
    expect(w.submits).toHaveLength(1)
    let item = w.store().items[0]
    expect(item?.delivered).toBe(false)
    expect(item?.delivering_at).toBeUndefined()
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toEqual(['humantray HT-ANSWR (Plan): Approve', 'humantray HT-ANSWR (Plan): Approve'])
    item = w.store().items[0]
    expect(item?.delivered).toBe(true)
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toHaveLength(2)
  })

  test('a rejected submit releases the claim; the next turn end sends exactly one line', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    let rejections = 1
    w.answerSubmit = e => {
      if (rejections-- > 0) throw new Error('the session was stopped and nobody has sent input since')
      return { text: e.text }
    }
    await $.session.start(START_EVENT)
    await w.drain()
    expect(w.submits).toHaveLength(1)
    expect(w.store().items[0]?.delivered).toBe(false)
    expect(w.store().items[0]?.delivering_at).toBeUndefined()
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toHaveLength(2)
    expect(w.store().items[0]?.delivered).toBe(true)
  })

  test('a held submit holds no hook: a turn end and a start meanwhile return at once, one submit in all', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await w.drain()
    w.answerSubmit = async e => {
      await w.clock.sleep(5_000)
      return { text: e.text }
    }
    const added = await $.tool.call({ tool: ADD, type: 'approve', header: 'Plan', question: 'OK?' })
    const id = (added.result as { id: string }).id
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:approve` })
    await ui.unmount()
    expect(w.submits).toHaveLength(1)
    const when = w.clock.now()
    await $.turn.complete(TURN)
    await $.session.start(START_EVENT)
    expect(w.clock.now()).toBe(when)
    expect(w.submits).toHaveLength(1)
    expect(w.store().items[0]?.delivered).toBe(false)
    expect(w.store().items[0]?.delivering_at).toBe(when)
    await w.clock.advance(5_000)
    expect(w.store().items[0]?.delivered).toBe(true)
    expect(w.submits).toHaveLength(1)
  })

  test('two undelivered answers: two lines, the older answer first, each once', async ($, on) => {
    const w = world(on)
    w.seed(
      seedWith([
        answered({ id: '01AAAAAAAAAAAAAAAAAAAANEWER', header: 'Newer', response_at: START - 1_000 }),
        answered({ id: '01AAAAAAAAAAAAAAAAAAAAOLDER', header: 'Older', response_at: START - 9_000 }),
      ]),
    )
    await $.session.start(START_EVENT)
    await w.drain()
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toEqual(['humantray HT-OLDER (Older): Approve', 'humantray HT-NEWER (Newer): Approve'])
  })
})

describe('cold starts (each test loads the module afresh)', () => {
  test('an answer already delivered is not sent again', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered({ delivered: true, delivered_at: START - 1_000 })]))
    await $.session.start(START_EVENT)
    await w.drain()
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toEqual([])
  })

  test('an answer not yet delivered is sent at start, and the open items show', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered(), stored({ id: '01AAAAAAAAAAAAAAAAAAAASTILL', type: 'ack', header: 'Still' })]))
    await $.session.start(START_EVENT)
    await w.drain()
    expect(w.submits).toEqual(['humantray HT-ANSWR (Plan): Approve'])
    const listed = await $.tool.call({ tool: LIST })
    expect((listed.result as { items: Array<{ short: string }> }).items.map(i => i.short)).toEqual(['HT-STILL'])
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /\[Still\]/ })).toBeDefined()
    await ui.unmount()
  })

  test('a claim another instance made over 60 s ago is sent again', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered({ delivering_at: START - 61_000, delivering_by: 'gone' })]))
    await $.session.start(START_EVENT)
    await w.drain()
    expect(w.submits).toHaveLength(1)
    expect(w.store().items[0]?.delivered).toBe(true)
  })

  test('a claim another instance made 30 s ago is left, then sent once it is stale', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered({ delivering_at: START - 30_000, delivering_by: 'alive' })]))
    await $.session.start(START_EVENT)
    await w.drain()
    expect(w.submits).toEqual([])
    await w.clock.advance(31_000)
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toHaveLength(1)
  })
})

describe('who delivers', () => {
  test('a turn end in a subagent makes no pass at all', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    await $.turn.complete({ ...TURN, agentId: 'agent-1' })
    expect(w.submits).toEqual([])
    expect(w.argv).toEqual([])
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toHaveLength(1)
  })

  test("another session's answer is not sent here while its owner is live", async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered({ session_id: 'session-b' })], { 'session-b': { seen: START - HOUR } }))
    await $.session.start(START_EVENT)
    await w.drain()
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toEqual([])
    expect(w.store().items[0]?.delivered).toBe(false)
  })

  test('an ack is delivered silently without notify_on_done, and as a line with it', async ($, on) => {
    const w = world(on)
    w.seed(
      seedWith([
        stored({ id: '01AAAAAAAAAAAAAAAAAAAAQUIET', type: 'ack', header: 'Quiet', status: 'acknowledged', response: { acknowledged: true } }),
        stored({
          id: '01AAAAAAAAAAAAAAAAAAAALOUD1',
          type: 'ack',
          header: 'Loud',
          status: 'acknowledged',
          response: { acknowledged: true },
          notify_on_done: true,
        }),
      ]),
    )
    await $.session.start(START_EVENT)
    await w.drain()
    expect(w.submits).toEqual(['humantray HT-LOUD1 (Loud): acknowledged'])
    expect(w.store().items.every(item => item.delivered)).toBe(true)
  })

  test('an owner with no successor, unseen for 25 h: any session delivers its answer', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered({ session_id: 'session-z' })], { 'session-z': { seen: START - 25 * HOUR } }))
    await $.session.start(START_EVENT)
    await w.drain()
    expect(w.submits).toEqual(['humantray HT-ANSWR (Plan): Approve'])
  })

  test('an owner unseen for 23 h keeps its answer', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered({ session_id: 'session-z' })], { 'session-z': { seen: START - 23 * HOUR } }))
    await $.session.start(START_EVENT)
    await w.drain()
    expect(w.submits).toEqual([])
  })

  test('tool and command hooks never submit, even with an answer waiting', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q' })
    await $.tool.call({ tool: LIST })
    const ran = await $.command.run(COMMAND)
    expect(ran.text).toBe('Humantray pane opened.')
    expect(w.opened).toEqual(['humantray', 'humantray'])
    expect(w.submits).toEqual([])
  })
})

describe('/clear, /resume and /branch', () => {
  test('after a /clear (no session.start, $.state reset) the band is rebuilt from the file', async ($, on) => {
    const w = world(on)
    w.seed(
      seedWith([
        stored({ id: '01AAAAAAAAAAAAAAAAAAAAOPEN1', type: 'ack' }),
        stored({ id: '01AAAAAAAAAAAAAAAAAAAAOPEN2', type: 'do' }),
      ]),
    )
    await $.classic.SessionStart({ source: 'clear' })
    const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await band.find({ type: 'Text', text: /Humantray/ }))?.text).toBe('Humantray: 2 open')
    await band.unmount()
  })

  test('the session id is read on every call; the new id takes over the old one', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await w.drain()
    const before = await $.tool.call({ tool: ADD, type: 'approve', header: 'Before', question: 'Before the clear?' })
    w.sessionId = 'session-new'
    const after = await $.tool.call({ tool: ADD, type: 'ack', header: 'After', question: 'After the clear' })
    const items = w.store().items
    expect(items.find(item => item.header === 'After')?.session_id).toBe('session-new')
    expect(w.store().sessions['session-a']?.successor).toBe('session-new')
    // The item made before the clear is the new session's to list and to receive.
    const listed = await $.tool.call({ tool: LIST })
    expect((listed.result as { items: Array<{ header: string }> }).items.map(i => i.header).sort()).toEqual(['After', 'Before'])
    const id = (before.result as { id: string }).id
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:approve` })
    await ui.unmount()
    expect(w.submits).toEqual([`humantray HT-${id.slice(-5)} (Before): Approve`])
    expect(after.isError).toBeUndefined()
  })

  test('a session resumed again answers for itself: its old successor is dropped', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()], { 'session-a': { seen: START - HOUR, successor: 'session-b' }, 'session-b': { seen: START - HOUR } }))
    w.sessionId = 'session-b'
    await $.session.start(START_EVENT)
    await w.drain()
    w.sessionId = 'session-a'
    await $.classic.SessionStart({ source: 'resume' })
    await w.drain()
    const sessions = w.store().sessions
    expect(sessions['session-a']?.successor).toBeUndefined()
    expect(sessions['session-b']?.successor).toBe('session-a')
    // Delivered once, by whichever of the two held it then.
    expect(w.submits).toEqual(['humantray HT-ANSWR (Plan): Approve'])
  })
})

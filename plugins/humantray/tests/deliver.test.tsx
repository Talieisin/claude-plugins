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
  answerOf,
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
    expect(seen).toEqual([{ delivered: false, delivering_at: START, delivering_by: expect.stringMatching(/^[0-9a-f]{16}\/\d+$/) }])
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
    const id = answerOf<{ id: string }>(added).id
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
    expect(answerOf<{ items: Array<{ short: string }> }>(listed).items.map(i => i.short)).toEqual(['HT-STILL'])
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

  test('an owner with no successor, unseen for 25 h, keeps its answer: no other session takes it over', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered({ session_id: 'session-z' })], { 'session-z': { seen: START - 25 * HOUR } }))
    await $.session.start(START_EVENT)
    await w.drain()
    await w.clock.advance(30 * 24 * HOUR)
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toEqual([])
    const item = w.store().items[0]
    expect(item?.status).toBe('answered')
    expect(item?.delivered).toBe(false)
    expect(item?.delivering_at).toBeUndefined()
  })

  test('tool and command hooks never submit, even with an answer waiting', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q' })
    // The add wrote once, and claimed nothing: no delivery pass ran in it.
    expect(w.commits).toBe(1)
    expect(w.store().items.find(item => item.id === '01AAAAAAAAAAAAAAAAAAAAANSWR')?.delivering_at).toBeUndefined()
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

  test('after a /clear the new id takes over: its items, its list, its card and its answers', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const before = await $.tool.call({ tool: ADD, type: 'approve', header: 'Before', question: 'Before the clear?' })
    w.sessionId = 'session-new'
    await $.classic.SessionStart({ source: 'clear' })
    await w.drain()
    expect(w.store().sessions['session-a']?.successor).toBe('session-new')
    const after = await $.tool.call({ tool: ADD, type: 'ack', header: 'After', question: 'After the clear' })
    expect(after.deny).toBeUndefined()
    expect(w.store().items.find(item => item.header === 'After')?.session_id).toBe('session-new')
    const listed = await $.tool.call({ tool: LIST })
    expect(answerOf<{ items: Array<{ header: string }> }>(listed).items.map(i => i.header).sort()).toEqual(['After', 'Before'])
    const id = answerOf<{ id: string }>(before).id
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // The inherited card is this session's: it does not say "another session".
    expect(await ui.find({ type: 'Text', text: /another session/ })).toBeUndefined()
    await ui.press({ key: `${id}:approve` })
    await ui.unmount()
    expect(w.submits).toEqual([`humantray HT-${id.slice(-5)} (Before): Approve`])
  })

  test('a /clear whose pass fails keeps its hand-over for the next pass', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.tool.call({ tool: ADD, type: 'approve', header: 'Before', question: 'Before the clear?' })
    w.holdLock('busy')
    w.sessionId = 'session-new'
    const clearing = $.classic.SessionStart({ source: 'clear' })
    for (let i = 0; i < 6; i++) {
      await w.clock.advance(1_000)
      w.holdLock('busy')
    }
    await clearing
    expect(w.store().sessions['session-a']?.successor).toBeUndefined()
    w.dropLock()
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.store().sessions['session-a']?.successor).toBe('session-new')
    const listed = await $.tool.call({ tool: LIST })
    expect(answerOf<{ items: Array<{ header: string }> }>(listed).items.map(i => i.header)).toEqual(['Before'])
  })

  test('a /branch (fork) hands over too', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.sessionId = 'session-branch'
    await $.classic.SessionStart({ source: 'fork' })
    await w.drain()
    expect(w.store().sessions['session-a']?.successor).toBe('session-branch')
  })

  for (const source of ['resume', 'startup', 'compact'] as const) {
    test(`a ${source} hands nothing over, even when the id changed`, async ($, on) => {
      const w = world(on)
      w.seed(seedWith([answered()]))
      w.answerSubmit = () => ({ drop: 'not yet' })
      await $.session.start(START_EVENT)
      await w.drain()
      w.sessionId = 'session-other'
      w.answerSubmit = e => ({ text: e.text })
      await $.classic.SessionStart({ source })
      await w.drain()
      expect(w.store().sessions['session-a']?.successor).toBeUndefined()
      // session-a's answer is not delivered into the other conversation.
      expect(w.submits).toHaveLength(1)
      expect(w.store().items[0]?.delivered).toBe(false)
    })
  }

  test('a session seen again answers for itself: a successor it had is dropped', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()], { 'session-a': { seen: START - HOUR, successor: 'session-b' }, 'session-b': { seen: START - HOUR } }))
    await $.session.start(START_EVENT)
    await w.drain()
    expect(w.store().sessions['session-a']?.successor).toBeUndefined()
    expect(w.submits).toEqual(['humantray HT-ANSWR (Plan): Approve'])
  })

  test('tidying drops an old record nobody needs, and keeps one an owner chain runs through', async ($, on) => {
    const w = world(on)
    const DAY = 24 * HOUR
    w.seed(
      seedWith([stored({ id: '01AAAAAAAAAAAAAAAAAAAACHAIN', type: 'ack', session_id: 'session-old' })], {
        'session-old': { seen: START - 20 * DAY, successor: 'session-middle' },
        'session-middle': { seen: START - 8 * DAY, successor: 'session-a' },
        'session-unused': { seen: START - 8 * DAY },
        'session-recent': { seen: START - 6 * DAY },
      }),
    )
    await $.session.start(START_EVENT)
    await w.drain()
    const sessions = w.store().sessions
    expect(Object.keys(sessions).sort()).toEqual(['session-a', 'session-middle', 'session-old', 'session-recent'])
    // The chain still ends here, so the item is still this session's.
    const listed = await $.tool.call({ tool: LIST })
    expect(answerOf<{ items: Array<{ short: string }> }>(listed).items.map(i => i.short)).toEqual(['HT-CHAIN'])
  })
})

describe('guards on delivery', () => {
  test('a submit held over 60 s is not sent again by its own instance', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.answerSubmit = async e => {
      await w.clock.sleep(120_000)
      return { text: e.text }
    }
    const added = await $.tool.call({ tool: ADD, type: 'approve', header: 'Plan', question: 'OK?' })
    const id = answerOf<{ id: string }>(added).id
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:approve` })
    await ui.unmount()
    await w.clock.advance(119_000)
    await $.turn.complete(TURN)
    expect(w.submits).toHaveLength(1)
    await w.clock.advance(1_000)
    await w.drain()
    expect(w.store().items[0]?.delivered).toBe(true)
    expect(w.submits).toHaveLength(1)
  })

  test("a late settle leaves alone a claim another instance has since taken", async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    w.answerSubmit = async e => {
      await w.clock.sleep(5_000)
      return { text: e.text }
    }
    await $.session.start(START_EVENT)
    const file = w.store()
    const item = file.items[0]
    if (item === undefined) throw new Error('no item')
    item.delivering_by = 'other-instance'
    item.delivering_at = w.clock.now()
    w.seed(file)
    await w.clock.advance(5_000)
    await w.drain()
    const after = w.store().items[0]
    expect(after?.delivered).toBe(false)
    expect(after?.delivering_by).toBe('other-instance')
  })

  test('a settle that fails once is tried again at once', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    w.answerSubmit = async e => {
      await w.clock.sleep(1_000)
      return { text: e.text }
    }
    await $.session.start(START_EVENT)
    w.failMoves = 1
    await w.clock.advance(1_000)
    await w.drain()
    expect(w.store().items[0]?.delivered).toBe(true)
    expect(w.submits).toHaveLength(1)
  })

  test('a settle that cannot write at all is written by the next pass, with no second line', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    w.answerSubmit = async e => {
      await w.clock.sleep(1_000)
      return { text: e.text }
    }
    await $.session.start(START_EVENT)
    w.failMoves = 3
    await w.clock.advance(1_000)
    await w.drain()
    expect(w.store().items[0]?.delivered).toBe(false)
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.store().items[0]?.delivered).toBe(true)
    expect(w.store().items[0]?.delivering_at).toBeUndefined()
    expect(w.submits).toHaveLength(1)
  })

  test('a released claim whose settle was lost is claimed again by its own instance', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    let drops = 1
    w.answerSubmit = async e => {
      await w.clock.sleep(1_000)
      return drops-- > 0 ? { drop: 'removed from the queue' } : { text: e.text }
    }
    await $.session.start(START_EVENT)
    w.failMoves = 3
    await w.clock.advance(1_000)
    await w.drain()
    await $.turn.complete(TURN)
    await w.clock.advance(1_000)
    await w.drain()
    expect(w.submits).toHaveLength(2)
    expect(w.store().items[0]?.delivered).toBe(true)
  })

  test('a late settle of a dropped send leaves the retry\'s claim alone: one more send, no duplicate', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    let sent = 0
    w.answerSubmit = async e => {
      sent += 1
      if (sent === 1) {
        await w.clock.sleep(1_000)
        return { drop: 'removed from the queue' }
      }
      if (sent === 2) await w.clock.sleep(5_000)
      return { text: e.text }
    }
    await $.session.start(START_EVENT)
    // Submit 1 is dropped; its settle reaches the lock only after a pass has
    // applied the drop, claimed the item again and sent submit 2.
    let open = () => undefined as void
    w.lockGate = new Promise<void>(resolve => {
      open = resolve
    })
    await w.clock.advance(1_000)
    await $.turn.complete(TURN)
    expect(w.submits).toHaveLength(2)
    open()
    await w.clock.settle()
    await $.turn.complete(TURN)
    await w.clock.advance(5_000)
    await w.drain()
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.submits).toHaveLength(2)
    expect(w.store().items[0]?.delivered).toBe(true)
  })

  test('a pass refreshes when this session was seen', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await w.clock.advance(HOUR)
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.store().sessions['session-a']?.seen).toBeGreaterThanOrEqual(START + HOUR)
  })

  test('a surface attaching makes a pass', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
    await w.drain()
    expect(w.submits).toEqual(['humantray HT-ANSWR (Plan): Approve'])
  })

  test('classic.SessionStart makes a pass', async ($, on) => {
    const w = world(on)
    w.seed(seedWith([answered()]))
    await $.classic.SessionStart({ source: 'startup' })
    await w.drain()
    expect(w.submits).toEqual(['humantray HT-ANSWR (Plan): Approve'])
  })

  test('a store near the add limit still delivers: claims and settles may pass it', async ($, on) => {
    const w = world(on)
    const big = stored({ id: '01AAAAAAAAAAAAAAAAAAAAABIG1', type: 'ack', body_md: 'b'.repeat(2 * 1024 * 1024 - 1_500) })
    w.seed(seedWith([big, answered()]))
    await $.session.start(START_EVENT)
    await w.drain()
    expect(w.submits).toEqual(['humantray HT-ANSWR (Plan): Approve'])
    expect(w.store().items.find(item => item.short === 'HT-ANSWR')?.delivered).toBe(true)
    const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q', body_md: 'b'.repeat(2_000) })
    expect(String(added.deny)).toContain('the store is full')
  })
})

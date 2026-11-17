// humantray_add and humantray_list: validation, bumping, and the store's
// guards (no repository, an unreadable or full file, the lock).

import { describe, expect, test } from 'claude-code/testing'

import { ADD, DIR, FILE, HOUR, LIST, LOCK, PANE, START, START_EVENT, answerOf, stored, world } from './world'

const CHOICE = {
  tool: ADD,
  type: 'choice',
  header: 'Colour',
  question: 'Which colour?',
  options: [
    { label: 'Red', description: 'Warm' },
    { label: 'Blue', description: 'Cool' },
  ],
} as const

describe('validation', () => {
  test('each of the five types is accepted', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    for (const call of [
      { tool: ADD, type: 'ack', header: 'FYI', question: 'Deployed to staging' },
      CHOICE,
      { tool: ADD, type: 'question', header: 'Name', question: 'What should it be called?' },
      { tool: ADD, type: 'do', header: 'Key', question: 'Rotate the key' },
      { tool: ADD, type: 'approve', header: 'Plan', question: 'Approve the plan?' },
    ] as const) {
      const ran = await $.tool.call(call)
      expect(ran.deny).toBeUndefined()
      expect(answerOf(ran)).toMatchObject({ short: expect.stringMatching(/^HT-[0-9A-Z]{5}$/), bumped: false })
    }
    const items = w.store().items
    expect(items.map(item => item.type)).toEqual(['ack', 'choice', 'question', 'do', 'approve'])
    expect(items.find(item => item.type === 'approve')?.options?.map(o => o.label)).toEqual(['Approve', 'Reject'])
    expect(items.every(item => item.status === 'open' && item.origin === 'local' && !item.delivered)).toBe(true)
    expect(items[0]?.repo).toBe('github.com/owner/repo')
    expect(items[0]?.session_id).toBe('session-a')
  })

  const refused: Array<[string, Record<string, unknown>]> = [
    ['an unknown type', { type: 'rank', header: 'X', question: 'Q' }],
    ['an empty header', { type: 'ack', header: '', question: 'Q' }],
    ['a 13-character header', { type: 'ack', header: 'thirteen-char', question: 'Q' }],
    ['an empty question', { type: 'ack', header: 'X', question: '  ' }],
    ['a choice with one option', { ...CHOICE, options: [{ label: 'Red', description: '' }] }],
    [
      'a choice with seven options',
      { ...CHOICE, options: Array.from({ length: 7 }, (_, i) => ({ label: `O${i}`, description: '' })) },
    ],
    ['a choice with no options', { ...CHOICE, options: undefined }],
    ['an option without a description', { ...CHOICE, options: [{ label: 'Red' }, { label: 'Blue' }] }],
    ['options on a question', { type: 'question', header: 'X', question: 'Q', options: CHOICE.options }],
    ['options on an approve', { type: 'approve', header: 'X', question: 'Q', options: CHOICE.options }],
    ['multiSelect on a do', { type: 'do', header: 'X', question: 'Q', multiSelect: true }],
    ['notify_on_done on a question', { type: 'question', header: 'X', question: 'Q', notify_on_done: true }],
    [
      'duplicate labels',
      { ...CHOICE, options: [{ label: 'Red', description: '' }, { label: 'red', description: '' }] },
    ],
    [
      'a label of Other',
      { ...CHOICE, options: [{ label: 'Red', description: '' }, { label: 'other', description: '' }] },
    ],
    ['a question over 500 characters', { type: 'ack', header: 'X', question: 'q'.repeat(501) }],
    ['a body over 20,000 characters', { type: 'ack', header: 'X', question: 'Q', body_md: 'b'.repeat(20_001) }],
    ['a key over 200 characters', { type: 'ack', header: 'X', question: 'Q', key: 'k'.repeat(201) }],
    [
      'a label over 60 characters',
      { ...CHOICE, options: [{ label: 'l'.repeat(61), description: '' }, { label: 'Blue', description: '' }] },
    ],
    [
      'a description over 300 characters',
      { ...CHOICE, options: [{ label: 'Red', description: 'd'.repeat(301) }, { label: 'Blue', description: '' }] },
    ],
  ]
  for (const [name, call] of refused) {
    test(`refused, nothing written: ${name}`, async ($, on) => {
      const w = world(on)
      await $.session.start(START_EVENT)
      const before = w.files.get(FILE)
      const ran = await $.tool.call({ ...call, tool: ADD })
      expect(ran.deny).toBeDefined()
      expect(String(ran.deny)).toStartWith('humantray: ')
      expect(w.files.get(FILE)).toBe(before)
    })
  }
})

describe('bumping', () => {
  test('the same key in the same session bumps: same id, bumps 1, new body and options, first place', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const first = await $.tool.call({ ...CHOICE, key: 'colour', body_md: 'one' })
    await w.clock.advance(1000)
    await $.tool.call({ tool: ADD, type: 'ack', header: 'Other', question: 'Something else' })
    await w.clock.advance(1000)
    const again = await $.tool.call({
      ...CHOICE,
      key: 'colour',
      body_md: 'two',
      options: [
        { label: 'Green', description: 'Fresh' },
        { label: 'Blue', description: 'Cool' },
      ],
    })
    const firstResult = answerOf<{ id: string }>(first)
    expect(answerOf(again)).toEqual({ id: firstResult.id, short: `HT-${firstResult.id.slice(-5)}`, bumped: true, page: 'none' })
    const items = w.store().items
    expect(items).toHaveLength(2)
    const bumped = items.find(item => item.id === firstResult.id)
    expect(bumped?.bumps).toBe(1)
    expect(bumped?.body_md).toBe('two')
    expect(bumped?.options?.map(o => o.label)).toEqual(['Green', 'Blue'])
    const listed = await $.tool.call({ tool: LIST })
    expect(answerOf<{ items: Array<{ id: string }> }>(listed).items[0]?.id).toBe(firstResult.id)
  })

  test('the question is the key when none is given', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Build  is   green' })
    const again = await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'build is green ' })
    expect(answerOf<{ bumped: boolean }>(again).bumped).toBe(true)
    expect(w.store().items).toHaveLength(1)
  })

  test('another session, an answered item, or another key makes a new item', async ($, on) => {
    const w = world(on)
    w.seed({
      version: 1,
      items: [stored({ id: '01AAAAAAAAAAAAAAAAAAAANSWD', type: 'ack', key: 'same', status: 'acknowledged', response: { acknowledged: true } })],
      sessions: {},
    })
    await $.session.start(START_EVENT)
    const fresh = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q', key: 'same' })
    expect(answerOf<{ bumped: boolean }>(fresh).bumped).toBe(false)
    w.sessionId = 'session-b'
    const other = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q', key: 'same' })
    expect(answerOf<{ bumped: boolean }>(other).bumped).toBe(false)
    const third = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q', key: 'different' })
    expect(answerOf<{ bumped: boolean }>(third).bumped).toBe(false)
    expect(w.store().items).toHaveLength(4)
  })

  test('a bump of another type under an open key is refused, the file unchanged', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.tool.call({ ...CHOICE, key: 'k' })
    const before = w.files.get(FILE)
    const ran = await $.tool.call({ tool: ADD, type: 'question', header: 'X', question: 'Q', key: 'k' })
    expect(ran.deny).toBeDefined()
    expect(String(ran.deny)).toContain('open choice item')
    expect(w.files.get(FILE)).toBe(before)
  })
})

describe('bumping across /clear, /branch and /resume', () => {
  const APPROVE = { tool: ADD, type: 'approve', header: 'Plan', question: 'Approve the plan?', key: 'plan' } as const

  test('after a /clear the same key bumps the inherited item: same id, its session_id kept, answer delivered here', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const first = await $.tool.call({ ...APPROVE, body_md: 'one' })
    const id = answerOf<{ id: string }>(first).id
    w.sessionId = 'session-new'
    await $.classic.SessionStart({ source: 'clear' })
    await w.drain()
    await w.clock.advance(1000)
    const again = await $.tool.call({ ...APPROVE, body_md: 'two' })
    expect(answerOf(again)).toEqual({ id, short: `HT-${id.slice(-5)}`, bumped: true, page: 'none' })
    const items = w.store().items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id, session_id: 'session-a', bumps: 1, body_md: 'two' })
    expect(items[0]?.updated).toBeGreaterThan(items[0]?.created ?? Infinity)
    const listed = await $.tool.call({ tool: LIST })
    expect(answerOf<{ items: Array<{ id: string }> }>(listed).items.map(i => i.id)).toEqual([id])
    // The answer still reaches the live session, by the chain from session-a.
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:approve` })
    await ui.unmount()
    await w.drain()
    expect(w.submits).toEqual([`humantray HT-${id.slice(-5)} (Plan): Approve`])
    expect(w.store().items[0]?.delivered).toBe(true)
  })

  test('after a /branch (fork) the same key bumps, and so it does after two hand-overs', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(APPROVE)).id
    w.sessionId = 'session-branch'
    await $.classic.SessionStart({ source: 'fork' })
    await w.drain()
    const branched = await $.tool.call(APPROVE)
    expect(answerOf(branched)).toMatchObject({ id, bumped: true })
    w.sessionId = 'session-cleared'
    await $.classic.SessionStart({ source: 'clear' })
    await w.drain()
    const cleared = await $.tool.call(APPROVE)
    expect(answerOf(cleared)).toMatchObject({ id, bumped: true })
    const items = w.store().items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ session_id: 'session-a', bumps: 2 })
  })

  test('a hand-over not yet written (its pass failed) is written by the add, which then bumps', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(APPROVE)).id
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
    const again = await $.tool.call(APPROVE)
    expect(answerOf(again)).toMatchObject({ id, bumped: true })
    expect(w.store().sessions['session-a']?.successor).toBe('session-new')
    expect(w.store().items).toHaveLength(1)
  })

  test('after a /resume the same key adds a new item, and the first is left as it was', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(APPROVE)).id
    w.sessionId = 'session-other'
    await $.classic.SessionStart({ source: 'resume' })
    await w.drain()
    const again = await $.tool.call(APPROVE)
    expect(answerOf<{ id: string; bumped: boolean }>(again).bumped).toBe(false)
    expect(answerOf<{ id: string }>(again).id).not.toBe(id)
    const items = w.store().items
    expect(items).toHaveLength(2)
    expect(items.find(item => item.id === id)).toMatchObject({ session_id: 'session-a', bumps: 0 })
    expect(items.find(item => item.id !== id)?.session_id).toBe('session-other')
  })

  test("another session's item is never bumped: not one it handed over to someone else, not its successor's", async ($, on) => {
    const w = world(on)
    w.seed({
      version: 1,
      items: [
        // session-x handed over to session-b, not to this session.
        stored({ id: '01AAAAAAAAAAAAAAAAAAAAOTHER', type: 'ack', key: 'same', session_id: 'session-x' }),
        // The item of session-a's successor: a hand-over runs one way only.
        stored({ id: '01AAAAAAAAAAAAAAAAAAAALATER', type: 'ack', key: 'later', session_id: 'session-c' }),
      ],
      sessions: {
        'session-x': { seen: START - HOUR, successor: 'session-b' },
        'session-b': { seen: START - HOUR },
        'session-a': { seen: START - HOUR, successor: 'session-c' },
        'session-c': { seen: START - HOUR },
      },
    })
    await $.session.start(START_EVENT)
    const same = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q', key: 'same' })
    expect(answerOf<{ bumped: boolean }>(same).bumped).toBe(false)
    // session-a is back (a /resume to it), so it answers for itself again;
    // session-c's item stays session-c's.
    const later = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q', key: 'later' })
    expect(answerOf<{ bumped: boolean }>(later).bumped).toBe(false)
    const items = w.store().items
    expect(items).toHaveLength(4)
    expect(items.filter(item => item.bumps > 0)).toEqual([])
  })

  test('a /resume after a /clear whose pass failed drops the pending hand-over: no successor, no bump', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(APPROVE)).id
    w.holdLock('busy')
    w.sessionId = 'session-new'
    const clearing = $.classic.SessionStart({ source: 'clear' })
    for (let i = 0; i < 6; i++) {
      await w.clock.advance(1_000)
      w.holdLock('busy')
    }
    await clearing
    w.dropLock()
    w.sessionId = 'session-other'
    await $.classic.SessionStart({ source: 'resume' })
    await w.drain()
    expect(w.store().sessions['session-a']?.successor).toBeUndefined()
    const again = await $.tool.call(APPROVE)
    expect(answerOf<{ bumped: boolean }>(again).bumped).toBe(false)
    expect(w.store().sessions['session-a']?.successor).toBeUndefined()
    const items = w.store().items
    expect(items).toHaveLength(2)
    expect(items.find(item => item.id === id)).toMatchObject({ session_id: 'session-a', bumps: 0 })
  })

  test('a compaction keeps a hand-over a failed /clear pass left pending: the next pass records it', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(APPROVE)).id
    w.holdLock('busy')
    w.sessionId = 'session-new'
    const clearing = $.classic.SessionStart({ source: 'clear' })
    for (let i = 0; i < 6; i++) {
      await w.clock.advance(1_000)
      w.holdLock('busy')
    }
    await clearing
    w.dropLock()
    await $.classic.SessionStart({ source: 'compact' })
    await w.drain()
    expect(w.store().sessions['session-a']?.successor).toBe('session-new')
    const again = await $.tool.call(APPROVE)
    expect(answerOf(again)).toMatchObject({ id, bumped: true })
  })

  test('a /resume whose pass failed, then a /clear: the hand-over is from the resumed session', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.tool.call(APPROVE)
    w.holdLock('busy')
    w.sessionId = 'session-other'
    const resuming = $.classic.SessionStart({ source: 'resume' })
    for (let i = 0; i < 6; i++) {
      await w.clock.advance(1_000)
      w.holdLock('busy')
    }
    await resuming
    w.dropLock()
    w.sessionId = 'session-new'
    await $.classic.SessionStart({ source: 'clear' })
    await w.drain()
    const sessions = w.store().sessions
    expect(sessions['session-other']?.successor).toBe('session-new')
    expect(sessions['session-a']?.successor).toBeUndefined()
    const again = await $.tool.call(APPROVE)
    expect(answerOf<{ bumped: boolean }>(again).bumped).toBe(false)
  })

  test('two /clears whose first pass failed: the chain runs from the first session to the last', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(APPROVE)).id
    w.holdLock('busy')
    w.sessionId = 'session-middle'
    const clearing = $.classic.SessionStart({ source: 'clear' })
    for (let i = 0; i < 6; i++) {
      await w.clock.advance(1_000)
      w.holdLock('busy')
    }
    await clearing
    w.dropLock()
    w.sessionId = 'session-new'
    await $.classic.SessionStart({ source: 'clear' })
    await w.drain()
    expect(w.store().sessions['session-a']?.successor).toBe('session-new')
    const again = await $.tool.call(APPROVE)
    expect(answerOf(again)).toMatchObject({ id, bumped: true })
  })

  // Two open items under one key in one chain: what a store written before
  // bumps followed the chain can hold.
  const legacy = (types: ['approve' | 'question', 'approve' | 'question']) => ({
    version: 1 as const,
    // The older first in the file, so a first match would pick the wrong one.
    items: [
      stored({ id: '01AAAAAAAAAAAAAAAAAAAAOLDER', type: types[1], key: 'plan', session_id: 'session-old', updated: START - HOUR }),
      stored({ id: '01AAAAAAAAAAAAAAAAAAAANEWER', type: types[0], key: 'plan', session_id: 'session-a', updated: START - HOUR / 2 }),
    ],
    sessions: { 'session-old': { seen: START - HOUR, successor: 'session-a' } },
  })

  test('legacy duplicates of one type in the chain: the newest by updated is bumped, the other left', async ($, on) => {
    const w = world(on)
    w.seed(legacy(['approve', 'approve']))
    await $.session.start(START_EVENT)
    const again = await $.tool.call({ ...APPROVE, body_md: 'two' })
    expect(answerOf(again)).toMatchObject({ id: '01AAAAAAAAAAAAAAAAAAAANEWER', bumped: true })
    const items = w.store().items
    expect(items).toHaveLength(2)
    expect(items.find(item => item.id === '01AAAAAAAAAAAAAAAAAAAANEWER')).toMatchObject({ bumps: 1, body_md: 'two', session_id: 'session-a' })
    expect(items.find(item => item.id === '01AAAAAAAAAAAAAAAAAAAAOLDER')).toMatchObject({ bumps: 0, body_md: '' })
  })

  test('legacy duplicates of two types in the chain: the add is refused, even when one matches its type', async ($, on) => {
    const w = world(on)
    // The older, first in the file, has the add's type; the newer has another.
    w.seed(legacy(['question', 'approve']))
    await $.session.start(START_EVENT)
    const before = w.files.get(FILE)
    const ran = await $.tool.call({ ...APPROVE, body_md: 'two' })
    expect(String(ran.deny)).toContain('open question item (HT-NEWER)')
    expect(w.files.get(FILE)).toBe(before)
  })

  test('an inherited open item under the same key with another type refuses the add, the file unchanged', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.tool.call(APPROVE)
    w.sessionId = 'session-new'
    await $.classic.SessionStart({ source: 'clear' })
    await w.drain()
    const before = w.files.get(FILE)
    const ran = await $.tool.call({ tool: ADD, type: 'question', header: 'X', question: 'Q', key: 'plan' })
    expect(String(ran.deny)).toContain('open approve item')
    expect(w.files.get(FILE)).toBe(before)
  })
})

describe('humantray_list', () => {
  test("lists this session's open and undelivered items only, newest first", async ($, on) => {
    const w = world(on)
    w.seed({
      version: 1,
      items: [
        stored({ id: '01AAAAAAAAAAAAAAAAAAAAOPEN1', type: 'ack', updated: START - 3 * HOUR }),
        stored({ id: '01AAAAAAAAAAAAAAAAAAAAOPEN2', type: 'do', updated: START - 2 * HOUR }),
        stored({ id: '01AAAAAAAAAAAAAAAAAAAADELVD', type: 'question', status: 'answered', response: { text: 'y' }, delivered: true }),
        stored({
          id: '01AAAAAAAAAAAAAAAAAAAAWAITS',
          type: 'question',
          status: 'answered',
          response: { text: 'x' },
          delivering_at: START,
          delivering_by: 'someone',
        }),
        stored({ id: '01AAAAAAAAAAAAAAAAAAAAOTHER', type: 'ack', session_id: 'session-b' }),
      ],
      sessions: { 'session-b': { seen: START } },
    })
    // No session.start here: a list makes no delivery of its own.
    const listed = await $.tool.call({ tool: LIST })
    expect(answerOf(listed)).toEqual({
      items: [
        { id: '01AAAAAAAAAAAAAAAAAAAAWAITS', short: 'HT-WAITS', type: 'question', header: 'Seeded', status: 'answered' },
        { id: '01AAAAAAAAAAAAAAAAAAAAOPEN2', short: 'HT-OPEN2', type: 'do', header: 'Seeded', status: 'open' },
        { id: '01AAAAAAAAAAAAAAAAAAAAOPEN1', short: 'HT-OPEN1', type: 'ack', header: 'Seeded', status: 'open' },
      ],
    })
    expect(w.submits).toEqual([])
  })
})

describe('the store', () => {
  test('not a git repository: both tools say so, nothing is drawn or written', async ($, on) => {
    const w = world(on, { isRepo: false })
    await $.session.start(START_EVENT)
    const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    expect(added).toEqual({ deny: 'humantray: not in a git repository' })
    const listed = await $.tool.call({ tool: LIST })
    expect(listed).toEqual({ deny: 'humantray: not in a git repository' })
    expect(w.files.size).toBe(0)
    expect(w.opened).toEqual([])
  })

  for (const [name, text] of [
    ['bad JSON', '{"version": 1, "items": ['],
    ['version 2', '{"version": 2, "items": [], "sessions": {}}'],
    ['over 3 MiB', JSON.stringify({ version: 1, items: [], sessions: {}, pad: 'x'.repeat(3 * 1024 * 1024) })],
  ] as const) {
    test(`an unreadable store (${name}) is reported by add and list, and left byte-identical`, async ($, on) => {
      const w = world(on)
      w.seed(text)
      await $.session.start(START_EVENT)
      const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
      expect(added.deny).toBeDefined()
      expect(String(added.deny)).toContain('is unreadable')
      expect(String(added.deny)).toContain('it was not changed')
      const listed = await $.tool.call({ tool: LIST })
      expect(listed.deny).toBeDefined()
      expect(w.files.get(FILE)).toBe(text)
    })
  }

  test('an add that would take the file past 2 MiB is refused, the file unchanged', async ($, on) => {
    const w = world(on)
    // One seeded item brings the file to 10,000 bytes under the limit.
    const big = stored({ id: '01AAAAAAAAAAAAAAAAAAAAABIG1', type: 'ack', body_md: 'b'.repeat(2 * 1024 * 1024 - 10_000) })
    w.seed({ version: 1, items: [big], sessions: {} })
    await $.session.start(START_EVENT)
    const before = w.files.get(FILE)
    const ran = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q', body_md: 'b'.repeat(19_000) })
    expect(ran.deny).toBeDefined()
    expect(String(ran.deny)).toContain('the store is full')
    expect(w.files.get(FILE)).toBe(before)
    expect(w.store().items).toHaveLength(1)
  })
})

describe('the lock', () => {
  test('a lock held by a live holder: a clean error after 5 s, the file and the lock untouched', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    const before = w.files.get(FILE)
    w.holdLock('alive')
    const pending = $.tool.call({ tool: ADD, type: 'ack', header: 'Y', question: 'Other' })
    for (let i = 0; i < 6; i++) {
      await w.clock.advance(1000)
      w.holdLock('alive') // the holder is alive: its lock stays fresh
    }
    const ran = await pending
    expect(String(ran.deny)).toContain('the store is busy')
    expect(w.files.get(FILE)).toBe(before)
    expect(w.files.get(`${LOCK}/owner`)).toBe('alive\n')
    expect(w.lockRenames).toBe(0)
  })

  test('a lock left 4 s ago by a holder that died is broken by one rename, and the add goes through', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.holdLock('dead', w.clock.now() - 4000)
    const ran = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    expect(ran.deny).toBeUndefined()
    expect(w.lockRenames).toBe(1)
    expect(w.dirs.has(LOCK)).toBe(false)
    expect([...w.dirs.keys(), ...w.files.keys()].filter(path => path.startsWith(`${LOCK}.`))).toEqual([])
    expect(w.store().items).toHaveLength(1)
  })

  test('two callers finding one stale lock: exactly one rename, and both adds go through', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.holdLock('dead', w.clock.now() - 4000)
    const one = $.tool.call({ tool: ADD, type: 'ack', header: 'One', question: 'First' })
    const two = $.tool.call({ tool: ADD, type: 'ack', header: 'Two', question: 'Second' })
    await w.clock.advance(500)
    const ran = await Promise.all([one, two])
    expect(ran.map(r => r.deny)).toEqual([undefined, undefined])
    expect(w.lockRenames).toBe(1)
    expect(w.store().items.map(item => item.header).sort()).toEqual(['One', 'Two'])
  })

  /** Fails the test if a write is committed while `holder` holds the lock. */
  const guardCommits = (w: ReturnType<typeof world>, holder: string) => {
    const seen: string[] = []
    w.beforeMove = (from, to) => {
      if (to === FILE) seen.push(w.files.get(`${LOCK}/owner`) ?? '')
    }
    return () => expect(seen.filter(owner => owner === `${holder}\n`)).toEqual([])
  }

  test('a new holder takes the lock between the stale check and the break: it is not broken', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.holdLock('dead', w.clock.now() - 4000)
    let turned = false
    w.afterStat = path => {
      if (path === LOCK && !turned) {
        turned = true
        w.holdLock('fresh') // another session broke the dead lock and took it
      }
    }
    const noCommitUnderFresh = guardCommits(w, 'fresh')
    const pending = $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    await w.clock.advance(1000)
    expect(w.files.get(`${LOCK}/owner`)).toBe('fresh\n')
    expect(w.store().items).toHaveLength(0)
    w.dropLock() // the fresh holder finishes
    await w.clock.advance(1000)
    const ran = await pending
    expect(ran.deny).toBeUndefined()
    expect(w.store().items).toHaveLength(1)
    noCommitUnderFresh()
  })

  test('a new holder takes the path between the breaker\'s look and its rename: the lock is given back', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.holdLock('dead', w.clock.now() - 4000)
    let turned = false
    w.beforeMove = (from, to) => {
      if (from === LOCK && to.includes('.stale-') && !turned) {
        turned = true
        w.holdLock('fresh')
      }
    }
    const pending = $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    await w.clock.advance(1000)
    expect(w.files.get(`${LOCK}/owner`)).toBe('fresh\n')
    expect(w.store().items).toHaveLength(0)
    const noCommitUnderFresh = guardCommits(w, 'fresh')
    w.dropLock()
    await w.clock.advance(1000)
    const ran = await pending
    expect(ran.deny).toBeUndefined()
    expect(w.store().items).toHaveLength(1)
    noCommitUnderFresh()
  })

  test('a holder whose lock was broken while it worked writes nothing, and leaves the new lock alone', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const before = w.files.get(FILE)
    w.beforeWrite = path => {
      if (path.includes('.tmp-')) w.holdLock('thief')
    }
    const ran = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    expect(String(ran.deny)).toContain('lock was taken over')
    expect(w.files.get(FILE)).toBe(before)
    expect(w.files.get(`${LOCK}/owner`)).toBe('thief\n')
  })

  test('a caller that finds another breaker at work waits between tries, then goes through', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.holdLock('dead', w.clock.now() - 4000)
    w.dirs.set(`${LOCK}.break`, w.clock.now())
    const before = w.argv.length
    const pending = $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    await w.clock.advance(1_000)
    const tries = w.argv.slice(before).filter(argv => argv[0] === 'mkdir' && argv[1] === `${LOCK}.break`).length
    expect(tries).toBeGreaterThan(0)
    expect(tries).toBeLessThanOrEqual(25)
    w.dirs.delete(`${LOCK}.break`) // the other breaker finishes
    await w.clock.advance(500)
    const ran = await pending
    expect(ran.deny).toBeUndefined()
    expect(w.store().items).toHaveLength(1)
  })

  test('a failed move mid-write: a clean error, no lock left, the old file byte-identical', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    const before = w.files.get(FILE)
    w.failMoveOfTemporary = true
    const ran = await $.tool.call({ tool: ADD, type: 'ack', header: 'Y', question: 'Other' })
    expect(String(ran.deny)).toContain('could not write')
    expect(w.files.get(FILE)).toBe(before)
    expect(w.dirs.has(LOCK)).toBe(false)
    expect([...w.files.keys()].filter(path => path.startsWith(DIR) && path !== FILE)).toEqual([])
  })

  test('a directory that cannot be made is reported as such, not as busy', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.failMkdir = true
    const ran = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    expect(String(ran.deny)).toContain('could not create')
    expect(String(ran.deny)).not.toContain('busy')
  })
})

describe('registering at session start', () => {
  test('a command the engine refuses (/humantray beside the humantray skill, 2.1.326) skips nothing else', async ($, on) => {
    const w = world(on)
    w.refuseCommand = name => name === 'humantray'
    await $.session.start(START_EVENT)
    expect(w.commands).toEqual(['humantray-viewer', 'humantray-page'])
    const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Still works?' })
    expect(answerOf<{ short: string }>(added).short).toMatch(/^HT-/)
    expect(w.store().items).toHaveLength(1)
  })
})

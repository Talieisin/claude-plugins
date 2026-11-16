// humantray_add and humantray_list: validation, bumping, and the store's
// guards (no repository, an unreadable or full file, the lock).

import { describe, expect, test } from 'claude-code/testing'

import { ADD, DIR, FILE, HOUR, LIST, LOCK, START, START_EVENT, answerOf, stored, world } from './world'

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
    expect(answerOf(again)).toEqual({ id: firstResult.id, short: `HT-${firstResult.id.slice(-5)}`, bumped: true })
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
      items: [stored({ id: '01AAAAAAAAAAAAAAAAAAAANSWD', type: 'ack', key: 'same', status: 'acknowledged' })],
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

describe('humantray_list', () => {
  test("lists this session's open and undelivered items only, newest first", async ($, on) => {
    const w = world(on)
    w.seed({
      version: 1,
      items: [
        stored({ id: '01AAAAAAAAAAAAAAAAAAAAOPEN1', type: 'ack', updated: START - 3 * HOUR }),
        stored({ id: '01AAAAAAAAAAAAAAAAAAAAOPEN2', type: 'do', updated: START - 2 * HOUR }),
        stored({ id: '01AAAAAAAAAAAAAAAAAAAADELVD', type: 'question', status: 'answered', delivered: true }),
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
  test('a lock held by a live holder: a clean error after 3 s, the file unchanged', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    const before = w.files.get(FILE)
    w.dirs.set(LOCK, w.clock.now())
    const pending = $.tool.call({ tool: ADD, type: 'ack', header: 'Y', question: 'Other' })
    await w.clock.advance(1000)
    w.dirs.set(LOCK, w.clock.now()) // the holder is alive: its lock stays fresh
    await w.clock.advance(1000)
    w.dirs.set(LOCK, w.clock.now())
    await w.clock.advance(1100)
    const ran = await pending
    expect(ran.deny).toBeDefined()
    expect(String(ran.deny)).toContain('the store is busy')
    expect(w.files.get(FILE)).toBe(before)
    expect(w.dirs.has(LOCK)).toBe(true)
  })

  test('a stale lock is broken by one rename, and the add goes through', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.dirs.set(LOCK, w.clock.now() - 3000)
    const ran = await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    expect(ran.deny).toBeUndefined()
    expect(w.lockRenames).toBe(1)
    expect(w.dirs.has(LOCK)).toBe(false)
    expect([...w.dirs.keys()].some(dir => dir.startsWith(`${LOCK}.stale-`))).toBe(false)
    expect(w.store().items).toHaveLength(1)
  })

  test('two callers finding one stale lock: exactly one rename wins, and both adds go through', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    w.dirs.set(LOCK, w.clock.now() - 3000)
    const one = $.tool.call({ tool: ADD, type: 'ack', header: 'One', question: 'First' })
    const two = $.tool.call({ tool: ADD, type: 'ack', header: 'Two', question: 'Second' })
    await w.clock.advance(500)
    const ran = await Promise.all([one, two])
    expect(ran.map(r => r.deny)).toEqual([undefined, undefined])
    expect(w.lockRenames).toBe(1)
    expect(w.store().items.map(item => item.header).sort()).toEqual(['One', 'Two'])
  })

  test('a failed move mid-write: a clean error, no lock left, the old file byte-identical', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.tool.call({ tool: ADD, type: 'ack', header: 'X', question: 'Q' })
    const before = w.files.get(FILE)
    w.failMoveOfTemporary = true
    const ran = await $.tool.call({ tool: ADD, type: 'ack', header: 'Y', question: 'Other' })
    expect(ran.deny).toBeDefined()
    expect(String(ran.deny)).toContain('could not write')
    expect(w.files.get(FILE)).toBe(before)
    expect(w.dirs.has(LOCK)).toBe(false)
    expect([...w.files.keys()].filter(path => path.startsWith(DIR) && path !== FILE)).toEqual([])
  })
})

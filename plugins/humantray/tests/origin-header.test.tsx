// Items 5 and 6 of #75: who asked an open item and when (the origin line),
// and the pane's header (the open count, the Open and History tabs, and the
// type chips that filter both lists).

import { describe, expect, test } from 'claude-code/testing'

import type { Item, StoreFile } from '../types'
import { TITLE_MAX, checkStoreFile, cleanTitle, kindCounts, noteSession, originOf, repoLabel, when } from '../hooks/items'
import { ADD, PANE, START, START_EVENT, TURN, answerOf, finished, finishedMany, stored, world } from './world'
import { mount } from './surface-rules'

const file = (items: Item[], sessions: StoreFile['sessions'] = {}): StoreFile => ({ version: 1, items, sessions })

const OPEN_TAB = 'humantray:tab:open'
const HISTORY_TAB = 'humantray:tab:history'
const chip = (kind: string) => `humantray:kind:${kind}`

describe('the origin line: pure rules (#75)', () => {
  test('a title is cleaned: controls, bidi and zero-width characters become spaces, runs collapse, the ends trim, and it is cut', () => {
    expect(cleanTitle('  Lane\t#23:\u202e config\u200b loader\n ')).toBe('Lane #23: config loader')
    expect(cleanTitle('x'.repeat(TITLE_MAX + 10))).toBe(`${'x'.repeat(TITLE_MAX - 1)}…`)
    expect(cleanTitle(' \u200b\n ')).toBeUndefined()
    expect(cleanTitle(42)).toBeUndefined()
    // A lone surrogate is dropped; a cut never splits a character in two; a joiner goes, its emoji stay.
    expect(cleanTitle('a\ud800b')).toBe('ab')
    expect(cleanTitle(`${'x'.repeat(TITLE_MAX - 2)}😀😀😀`)).toBe(`${'x'.repeat(TITLE_MAX - 2)}😀…`)
    expect(cleanTitle('👩\u200d💻 pair')).toBe('👩💻 pair')
    expect(cleanTitle(undefined)).toBeUndefined()
  })

  test('who asked: this session; else the cloud title, the owner’s recorded title, the raiser’s; else another session', () => {
    const mine = stored({ id: '01AAAAAAAAAAAAAAAAAAAORIG01', type: 'ack' })
    const titled = stored({ id: '01AAAAAAAAAAAAAAAAAAAORIG02', type: 'ack', session_id: 'session-x' })
    const cloud = stored({
      id: '01AAAAAAAAAAAAAAAAAAAORIG03',
      type: 'ack',
      session_id: 'session-y',
      remote: { session_id: 'session_01AAAAAAAAAAAAAAAAAAAAAA', session_title: 'Cloud worker', parent_session_id: null, lead_session_id: null },
    })
    const handedOver = stored({ id: '01AAAAAAAAAAAAAAAAAAAORIG04', type: 'ack', session_id: 'session-old' })
    const untitled = stored({ id: '01AAAAAAAAAAAAAAAAAAAORIG05', type: 'ack', session_id: 'session-z' })
    const store = file([mine, titled, cloud, handedOver, untitled], {
      'session-x': { seen: START, title: 'Lane #23' },
      'session-y': { seen: START, title: 'Local name' },
      'session-old': { seen: START, successor: 'session-new', title: 'Before the clear' },
      'session-new': { seen: START, title: 'After the clear' },
    })
    expect(originOf(store, mine, 'session-a')).toBe('this session')
    expect(originOf(store, titled, 'session-a')).toBe('Lane #23')
    expect(originOf(store, cloud, 'session-a')).toBe('Cloud worker')
    expect(originOf(store, handedOver, 'session-a')).toBe('After the clear')
    expect(originOf(store, untitled, 'session-a')).toBe('another session')
    // An item inherited by a /clear is this session's.
    expect(originOf(store, handedOver, 'session-new')).toBe('this session')
    // With no title for the owner now, the raiser's.
    delete store.sessions['session-new']?.title
    expect(originOf(store, handedOver, 'session-a')).toBe('Before the clear')
  })

  test('noteSession records a title, keeps it when none is heard, and still drops a successor', () => {
    const store = file([])
    noteSession(store, 'session-a', START, undefined, '  Lane\u200b #23 ')
    expect(store.sessions['session-a']).toEqual({ seen: START, title: 'Lane #23' })
    store.sessions['session-a'] = { seen: START, successor: 'session-b', title: 'Lane #23' }
    noteSession(store, 'session-a', START + 1)
    expect(store.sessions['session-a']).toEqual({ seen: START + 1, title: 'Lane #23' })
    noteSession(store, 'session-a', START + 2, undefined, 'Renamed')
    expect(store.sessions['session-a']).toEqual({ seen: START + 2, title: 'Renamed' })
    // A hand-over keeps the earlier session's title; the new one has its own or none.
    noteSession(store, 'session-c', START + 3, 'session-a')
    expect(store.sessions['session-a']).toEqual({ seen: START + 2, title: 'Renamed', successor: 'session-c' })
    expect(store.sessions['session-c']).toEqual({ seen: START + 3 })
  })

  test('the store file takes a session title as an optional string, and refuses any other', () => {
    expect(checkStoreFile(file([], { s: { seen: 1, title: 'A title' } })).error).toBeUndefined()
    expect(checkStoreFile(file([], { s: { seen: 1 } })).error).toBeUndefined()
    expect(checkStoreFile({ version: 1, items: [], sessions: { s: { seen: 1, title: 7 } } }).error).toBe('session s: malformed')
  })

  test('the header’s helpers: kinds as the page groups them, the repository named without its host', () => {
    expect(kindCounts(['choice', 'question', 'do', 'approve', 'ack', 'ack'])).toEqual({ all: 6, question: 2, todo: 2, fyi: 2 })
    expect(repoLabel('github.com/owner/repo')).toBe('owner/repo')
    expect(repoLabel('/home/me/project')).toBe('/home/me/project')
  })
})

describe('the session title, as the CLI gives it (#75)', () => {
  test('a prompt’s title is recorded at the next write, for its own session only, and the prompt passes untouched', async ($, on) => {
    const w = world(on)
    // Beneath the plugins: what reaches the CLI, to show the prompt is passed on, once and unchanged.
    const beneath: Array<Record<string, unknown>> = []
    on('classic.UserPromptSubmit', (_, e) => {
      beneath.push({ ...e })
      return {}
    })
    await $.session.start(START_EVENT)
    const before = JSON.stringify(w.store())
    const ran = await $.classic.UserPromptSubmit({ session_id: 'session-a', session_title: 'Lane #23: loader', prompt: 'go on' })
    expect(JSON.stringify(ran ?? {})).not.toMatch(/block|decision/)
    expect(beneath).toHaveLength(1)
    expect(beneath[0]).toMatchObject({ prompt: 'go on', session_title: 'Lane #23: loader', session_id: 'session-a' })
    // Noted only: nothing is written by the hook itself.
    expect(JSON.stringify(w.store())).toBe(before)
    await $.tool.call({ tool: ADD, type: 'ack', header: 'Done', question: 'It ran' })
    expect(w.store().sessions['session-a']?.title).toBe('Lane #23: loader')
  })

  test('a /resume into a session with no title never takes the earlier session’s', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.classic.SessionStart({ source: 'startup', session_id: 'session-a', session_title: 'First session' })
    await w.drain()
    expect(w.store().sessions['session-a']?.title).toBe('First session')
    w.sessionId = 'session-b'
    await $.classic.SessionStart({ source: 'resume', session_id: 'session-b' })
    await w.drain()
    await $.turn.complete(TURN)
    await w.drain()
    expect(w.store().sessions['session-b']).toBeDefined()
    expect(w.store().sessions['session-b']?.title).toBeUndefined()
    expect(w.store().sessions['session-a']?.title).toBe('First session')
  })
})

describe('the origin line, drawn (#75)', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`on ${surface}: another session’s title or "another session", this session's own; when it was raised; History too`, async ($, on) => {
      const w = world(on, { surfaces: [surface] })
      const titled = stored({ id: '01AAAAAAAAAAAAAAAAAAAORIG11', type: 'ack', header: 'T', question: 'Titled', session_id: 'session-x' })
      const untitled = stored({ id: '01AAAAAAAAAAAAAAAAAAAORIG12', type: 'ack', header: 'U', question: 'Untitled', session_id: 'session-z', bumps: 2 })
      const answered = finished(1, { session_id: 'session-x' })
      w.seed(file([titled, untitled, answered], { 'session-x': { seen: START, title: 'Lane #23' } }))
      await $.session.start({ ...START_EVENT, surface })
      const own = answerOf<{ id: string; short: string }>(await $.tool.call({ tool: ADD, type: 'ack', header: 'Mine', question: 'Own' }))
      const ui = await mount($, { ...PANE, surface })
      // The dim line under the heading: the only Text that holds the short id.
      const line = async (short: string) => (await ui.find({ type: 'Text', text: new RegExp(`${short}( |$)`) }))?.text
      expect(await line(titled.short)).toBe(`Lane #23 · ${when(titled.created)} · ${titled.short}`)
      expect(await line(untitled.short)).toBe(`another session · ${when(untitled.created)} · ${untitled.short} · bumped 2×`)
      expect(await line(own.short)).toBe(`this session · ${when(START)} · ${own.short}`)
      await ui.press({ key: HISTORY_TAB })
      expect((await ui.find({ type: 'Text', text: /^HT-/ }))?.text).toMatch(new RegExp(`^${answered.short} · Lane #23 · answered `))
      await ui.unmount()
    })
  }
})

describe('a cached tray from before who-asked (#75)', () => {
  test('a viewer tray cached as viewer-3 (History entries with no origin) is never drawn', async ($, on) => {
    world(on)
    const entry = { id: 'x', short: 'HT-XXXXX', repo: 'r', type: 'question', header: 'Old', question: 'Old?', status: 'answered', answer: 'yes', parts: [], clipped: false, bumps: 0, at: 0, mark: 'delivered', isMine: true }
    const old = { repos: [], history: [entry], answerable: 0, found: 'ok', leaseFailed: false, at: 0 }
    on('state.get', { plugin: 'humantray', key: 'viewer' }, () => ({ value: { value: { shape: 'viewer-3', value: old }, version: 1 } }))
    on('state.get', { plugin: 'humantray', key: 'view' }, () => ({ value: { value: 'history', version: 1 } }))
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /\[Old\]/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'humantray viewer' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('the header (#75)', () => {
  test('the title and open count, the tabs, and the chips with their counts; the shown ones primary', async ($, on) => {
    const w = world(on)
    w.seed(
      file([
        stored({ id: '01AAAAAAAAAAAAAAAAAAAHEAD01', type: 'question', header: 'Q', question: 'A question' }),
        stored({ id: '01AAAAAAAAAAAAAAAAAAAHEAD02', type: 'choice', header: 'C', question: 'A choice' }),
        stored({ id: '01AAAAAAAAAAAAAAAAAAAHEAD03', type: 'do', header: 'D', question: 'A to-do' }),
        stored({ id: '01AAAAAAAAAAAAAAAAAAAHEAD04', type: 'ack', header: 'F', question: 'An FYI' }),
        finished(1),
        finished(2, { type: 'ack', response: { acknowledged: true }, status: 'acknowledged' }),
      ]),
    )
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const label = async (key: string) => (await ui.find({ key }))?.props.label
    const variant = async (key: string) => (await ui.find({ key }))?.props.variant
    expect(await ui.find({ type: 'Text', text: 'humantray · owner/repo' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '4 open' })).toBeDefined()
    expect(await label(OPEN_TAB)).toBe('Open')
    expect(await label(HISTORY_TAB)).toBe('History 2')
    expect([await label(chip('all')), await label(chip('question')), await label(chip('todo')), await label(chip('fyi'))]).toEqual([
      'All 4',
      'Questions 2',
      'To-dos 1',
      'FYIs 1',
    ])
    expect([await variant(OPEN_TAB), await variant(HISTORY_TAB), await variant(chip('all')), await variant(chip('fyi'))]).toEqual([
      'primary',
      undefined,
      'primary',
      undefined,
    ])
    await ui.unmount()
  })

  test('a chip filters Open and History alike; a filtered empty list says so; All shows everything again', async ($, on) => {
    const w = world(on)
    const question = stored({ id: '01AAAAAAAAAAAAAAAAAAAHEAD11', type: 'question', header: 'Q', question: 'A question' })
    const fyi = stored({ id: '01AAAAAAAAAAAAAAAAAAAHEAD12', type: 'ack', header: 'F', question: 'An FYI' })
    w.seed(file([question, fyi, finished(1)]))
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const has = async (id: string) => (await ui.find({ key: `${id}:card` })) !== undefined

    await ui.press({ key: chip('fyi') })
    expect(await ui.find({ key: chip('fyi') }).then(b => b?.props.variant)).toBe('primary')
    expect([await has(question.id), await has(fyi.id)]).toEqual([false, true])
    // The counts stay those of every open item.
    expect((await ui.find({ key: chip('all') }))?.props.label).toBe('All 2')

    await ui.press({ key: HISTORY_TAB })
    expect(await ui.find({ type: 'Text', text: 'No answered FYIs yet.' })).toBeDefined()
    await ui.press({ key: chip('todo') })
    expect(await ui.find({ type: 'Text', text: /^\[Done\]/ })).toBeDefined()

    await ui.press({ key: OPEN_TAB })
    expect(await ui.find({ type: 'Text', text: 'No open to-dos.' })).toBeDefined()
    await ui.press({ key: chip('all') })
    expect([await has(question.id), await has(fyi.id)]).toEqual([true, true])
    await ui.unmount()
  })

  test('a chip leaves an entry shown in full, back to the list', async ($, on) => {
    const w = world(on)
    w.seed(file([finished(1, { response: { selected: ['Approve'], notes: 'x'.repeat(2_000) } })]))
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: HISTORY_TAB })
    await ui.press({ key: `${finished(1).id}:full` })
    expect(await ui.find({ key: 'humantray:history:back' })).toBeDefined()
    await ui.press({ key: chip('todo') })
    expect(await ui.find({ key: 'humantray:history:back' })).toBeUndefined()
    expect(await ui.find({ key: `${finished(1).id}:history` })).toBeDefined()
    await ui.unmount()
  })

  test('a chip or a tab starts History again from its first page', async ($, on) => {
    const w = world(on)
    w.seed(file([...finishedMany(60), stored({ id: '01AAAAAAAAAAAAAAAAAAAHEAD21', type: 'ack', header: 'F', question: 'An FYI' })]))
    await $.session.start(START_EVENT)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: HISTORY_TAB })
    await ui.press({ key: 'humantray:history:next' })
    expect(await ui.find({ type: 'Text', text: 'Page 2 of 2' })).toBeDefined()
    await ui.press({ key: chip('todo') })
    expect(await ui.find({ type: 'Text', text: 'Page 1 of 2' })).toBeDefined()
    await ui.press({ key: 'humantray:history:next' })
    await ui.press({ key: OPEN_TAB })
    await ui.press({ key: HISTORY_TAB })
    expect(await ui.find({ type: 'Text', text: 'Page 1 of 2' })).toBeDefined()
    await ui.unmount()
  })
})

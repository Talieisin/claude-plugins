// The local viewer (#32): one local session holds the lease, reads every
// repository's humantray artifact, draws it grouped by repository, lead and
// asker, and answers by sending a response envelope, keeping each answer
// until the store settles it. It never writes a row.

import { type Engine, describe, expect, test } from 'claude-code/testing'

import type { Item, ItemRow, OutboxEntry } from '../types'
import { readEnvelope } from '../hooks/envelope'
import { fingerprint, itemToRow } from '../hooks/row-shape'
import { FIND_MS, GIVE_UP_MS, LEASE_MS, MAX_LISTED, TICK_MS, isGivenUp, lastActive, nextSendAt, repoMatches, settleEntry } from '../hooks/viewer'
import { LEAD, ME, URL_A, URL_B, artifactWorld, meta, response } from './artifact-world'
import { codeBlocksOf } from '../hooks/code'
import { RUNBOOK } from './code-fixtures'
import { ADD, CLEAN_TITLE, COMMAND, DIRTY_TITLE, HOUR, LIST, PANE, START, START_EVENT, answerOf, drawnText, stored, world } from './world'
import { when } from '../hooks/items'
import { mount } from './surface-rules'

type On = Parameters<typeof world>[0]

const VIEWER = 'viewer-session'
const ID1 = '01AAAAAAAAAAAAAAAAAAAVIEW01'
const ID2 = '01AAAAAAAAAAAAAAAAAAAVIEW02'
const ID3 = '01AAAAAAAAAAAAAAAAAAAVIEW03'
const MARK = 'HT32ITEMMARKER'
const REPO2 = 'github.com/owner/other'

/** An item row as a cloud asker's mod writes it. */
function rowOf(fields: Partial<Item> & Pick<Item, 'id' | 'type'>, remote: Partial<NonNullable<Item['remote']>> = {}): ItemRow {
  const item = stored({
    question: `Question ${fields.id.slice(-2)} ${MARK}`,
    body_md: `Body ${MARK}`,
    ...fields,
    remote: { session_id: ME, session_title: 'worker for #1', parent_session_id: LEAD, lead_session_id: LEAD, ...remote },
  }) as Item & Required<Pick<Item, 'remote'>>
  item.row = { artifact: URL_A, version: 1, sent: fingerprint(item) }
  return itemToRow(item)
}

type Sent = { to: string; text: string }

type Env = ReturnType<typeof viewerWorld>

/** The world of the viewer test running now, so that every test ends with the read-only check. */
let current: Env | undefined

/**
 * A viewer test: after its body, the viewer wrote no row, published nothing,
 * submitted no prompt and appended nothing to the transcript, whatever it did.
 */
function vtest(name: string, body: ($: Engine, on: On) => Promise<void>) {
  test(name, async ($, on) => {
    current = undefined
    await body($, on)
    const env = current as Env | undefined
    if (env === undefined) return
    expect(env.a.writes()).toEqual([])
    expect(env.a.calls.filter(c => c.tool === 'Artifact' && c.input.action === 'publish')).toEqual([])
    expect(env.w.submits).toEqual([])
    expect(env.w.appended).toEqual([])
  })
}

/** A local viewer's world: two repositories' artifacts with rows, and a recorder of sends. */
function viewerWorld(on: On, options: Parameters<typeof world>[1] = {}) {
  const w = world(on, { sessionId: VIEWER, ...options })
  const a = artifactWorld(on, { read: path => w.files.get(path) })
  a.add(URL_A, 'humantray: owner/repo')
  a.put(URL_A, 'meta/page', meta(START - 1000))
  a.add(URL_B, 'humantray: owner/other')
  a.put(URL_B, 'meta/page', { ...meta(START - 1000), repo: REPO2 })
  const sends: Sent[] = []
  const send = {
    answer: (_: Sent): { isDelivered: boolean; reason?: string } | Promise<{ isDelivered: boolean; reason?: string }> => ({ isDelivered: true }),
  }
  on('session.send', async (_, e) => {
    const sent = { to: String(e.to), text: e.text }
    sends.push(sent)
    const answer = await send.answer(sent)
    return answer.isDelivered ? { isDelivered: true as const } : { isDelivered: false as const, reason: answer.reason ?? 'refused' }
  })
  const env = { w, a, sends, send }
  current = env
  return env
}

const put = (a: ReturnType<typeof artifactWorld>, url: string, row: ItemRow) =>
  a.put(url, `items/${row.id}`, row as unknown as Record<string, unknown>)

const VIEWER_COMMAND = { ...COMMAND, command: 'humantray-viewer' } as const

async function turnOn($: Engine, w: ReturnType<typeof world>, args = '') {
  await $.session.start(START_EVENT)
  const ran = await $.command.run({ ...VIEWER_COMMAND, args })
  await w.clock.settle()
  return (ran as { text?: string }).text ?? ''
}

/** One more tick of the viewer, and what it started. */
async function tickOnce(w: ReturnType<typeof world>, ms = TICK_MS) {
  await w.clock.advance(ms)
  await w.clock.settle()
}

/** Every text a mounted pane shows. */
async function shownText(ui: { findAll: (q: { type?: string }) => Promise<Array<{ text?: string }>> }) {
  const texts = [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Markdown' }))]
  return texts.map(t => t.text ?? '').join('\n')
}

/** Every character a drawing holds that counts toward a surface's limit: texts, Markdown and Button labels (#51). */
async function drawnLength(ui: { findAll: (q: { type?: string }) => Promise<Array<{ text?: string; props?: { label?: string } }>> }) {
  const buttons = await ui.findAll({ type: 'Button' })
  return (await shownText(ui)).length + buttons.reduce((sum, b) => sum + (b.props?.label ?? '').length, 0)
}

describe('the pure rules', () => {
  const entry: OutboxEntry = {
    artifact: URL_A,
    id: ID1,
    short: 'HT-IEW01',
    to: ME,
    answer_id: 'ourAnswerId0000000000000',
    text: 'x',
    first: START,
    last: START,
    sends: 1,
    delivered: true,
  }

  test('never sent: due at once; then 2, 8 and 20 minutes after the last send (2, 10, 30 after the first when on time), then hourly; given up after a day', () => {
    expect(nextSendAt({ ...entry, sends: 0 })).toBe(Number.NEGATIVE_INFINITY)
    expect(nextSendAt({ ...entry, sends: 1 }) - START).toBe(2 * 60_000)
    expect(nextSendAt({ ...entry, sends: 2, last: START + 2 * 60_000 }) - START).toBe(10 * 60_000)
    expect(nextSendAt({ ...entry, sends: 3, last: START + 10 * 60_000 }) - START).toBe(30 * 60_000)
    expect(nextSendAt({ ...entry, sends: 4, last: START + 5 }) - START).toBe(5 + 60 * 60_000)
    // Behind (the viewer was off for hours): due once, then measured from that send, not from the first.
    expect(nextSendAt({ ...entry, sends: 2, last: START + 5 * 60 * 60_000 }) - START).toBe(5 * 60 * 60_000 + 8 * 60_000)
    expect(isGivenUp(entry, START + GIVE_UP_MS - 1)).toBe(false)
    expect(isGivenUp(entry, START + GIVE_UP_MS)).toBe(true)
  })

  const open = rowOf({ id: ID1, type: 'approve' })
  const closed = (fields: Partial<Item>) => rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Approve'] }, ...fields })
  const cases: Array<[string, Parameters<typeof settleEntry>[1], ReturnType<typeof settleEntry>]> = [
    ['closed with our answer, delivered: settled', { kind: 'row', row: closed({ answer_id: entry.answer_id, delivered: true }) }, { keep: false }],
    ['closed with our answer, not delivered: kept, applied', { kind: 'row', row: closed({ answer_id: entry.answer_id, delivered: false }) }, { keep: true, state: 'applied' }],
    ['closed with another answer: settled, with a toast', { kind: 'row', row: closed({ answer_id: 'another', delivered: false }) }, { keep: false, toast: 'HT-IEW01: another answer was taken first' }],
    ['our answer refused: settled', { kind: 'row', row: rowOf({ id: ID1, type: 'approve', response_refused: { answer_id: entry.answer_id, reason: 'no', at: START } }) }, { keep: false }],
    ['open, our own response row: kept, stored', { kind: 'row', row: open, response: { ok: response(ID1, { answer_id: entry.answer_id, by: 'viewer' }) as never } }, { keep: true, state: 'stored' }],
    ['open, another answer counting: settled', { kind: 'row', row: open, response: { ok: response(ID1) as never } }, { keep: false }],
    ['open, nothing yet: kept, sent', { kind: 'row', row: open }, { keep: true, state: 'sent' }],
    ['the store says no such document: settled', { kind: 'missing' }, { keep: false }],
    ['a read that failed or a row unreadable: unchanged', { kind: 'unknown' }, { keep: true, state: 'sent' }],
  ]
  for (const [name, read, want] of cases) {
    test(`settling: ${name}`, () => {
      expect(settleEntry(entry, read)).toEqual(want)
    })
  }

  test('an ack that owes no line is settled once applied, delivered or not', () => {
    const ack = rowOf({ id: ID1, type: 'ack', status: 'acknowledged', response: { acknowledged: true }, answer_id: entry.answer_id, delivered: false })
    expect(settleEntry(entry, { kind: 'row', row: ack })).toEqual({ keep: false })
  })

  test('last active is the latest change across a session\'s rows', () => {
    expect(lastActive([rowOf({ id: ID1, type: 'ack', updated: 5 }), rowOf({ id: ID2, type: 'ack', updated: 3, response_at: 9 })])).toBe(9)
  })

  test('a repository named as owner/name or as host/path matches', () => {
    expect(repoMatches('owner/repo', 'github.com/owner/repo')).toBe(true)
    expect(repoMatches('Owner/Repo', 'github.com/owner/repo')).toBe(true)
    expect(repoMatches('gitlab.com/a/b', 'gitlab.com/a/b')).toBe(true)
    expect(repoMatches('owner/other', 'github.com/owner/repo')).toBe(false)
  })
})

describe('the lease: one viewer per computer', () => {
  vtest('/humantray-viewer makes this session the viewer and opens the pane', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    const text = await turnOn($, w)
    expect(text).toContain('on for 2 repositories')
    expect(text).toContain('github.com/owner/repo')
    expect(text).not.toContain(MARK)
    expect(w.opened).toContain('humantray')
  })

  vtest('the header (#75): the open count, the tabs and the chips; a chip filters the cards across repositories', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    put(a, URL_A, rowOf({ id: ID2, type: 'ack' }))
    put(a, URL_B, rowOf({ id: ID3, type: 'question', repo: REPO2 }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const label = async (key: string) => (await ui.find({ key }))?.props.label
    expect(await ui.find({ type: 'Text', text: 'humantray viewer' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '3 open' })).toBeDefined()
    expect(await label('humantray:tab:open')).toBe('Open')
    expect(await label('humantray:kind:all')).toBe('All 3')
    expect(await label('humantray:kind:question')).toBe('Questions 1')
    expect(await label('humantray:kind:todo')).toBe('To-dos 1')
    expect(await label('humantray:kind:fyi')).toBe('FYIs 1')
    await ui.press({ key: 'humantray:kind:todo' })
    const cards = async () => [ID1, ID2, ID3].map(async id => (await ui.find({ key: `v:${id}:card` })) !== undefined)
    expect(await Promise.all(await cards())).toEqual([true, false, false])
    await ui.press({ key: 'humantray:kind:fyi' })
    expect(await Promise.all(await cards())).toEqual([false, true, false])
    await ui.press({ key: 'humantray:tab:history' })
    await w.clock.settle()
    expect(await shownText(ui)).toContain('No answered FYIs yet.')
    await ui.press({ key: 'humantray:tab:open' })
    await ui.press({ key: 'humantray:kind:all' })
    expect(await Promise.all(await cards())).toEqual([true, true, true])
  })

  vtest('the header (#75) counts this session’s own cards too, and the empty text is only for no cards at all', async ($, on) => {
    const { w } = viewerWorld(on)
    await turnOn($, w)
    await $.tool.call({ tool: ADD, type: 'ack', header: 'One', question: 'Own FYI one' })
    await $.tool.call({ tool: ADD, type: 'ack', header: 'Two', question: 'Own FYI two' })
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: '2 open' })).toBeDefined()
    expect((await ui.find({ key: 'humantray:kind:fyi' }))?.props.label).toBe('FYIs 2')
    expect(await ui.find({ type: 'Text', text: 'No open items.' })).toBeUndefined()
    await ui.press({ key: 'humantray:kind:todo' })
    expect(await ui.find({ type: 'Text', text: 'No open to-dos.' })).toBeDefined()
  })

  vtest('who asked and when (#75): a card says when it was raised; History says who asked, from the row', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: true }))
    put(a, URL_A, rowOf({ id: ID2, type: 'ack' }))
    put(a, URL_A, rowOf({ id: ID3, type: 'ack', status: 'acknowledged', response: { acknowledged: true }, delivered: true }, { session_title: null }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain(`${when(START - HOUR)} · HT-${ID2.slice(-5)}`)
    await ui.press({ key: 'humantray:tab:history' })
    await w.clock.settle()
    const text = await shownText(ui)
    expect(text).toContain(`HT-${ID1.slice(-5)} · worker for #1 · answered `)
    expect(text).toContain(`HT-${ID3.slice(-5)} · another session · answered `)
    expect(text).not.toContain('this session')
  })

  vtest('a dirty row title (#75) is drawn cleaned in the asker heading, the Lead line and History', async ($, on) => {
    const { w, a } = viewerWorld(on)
    const dirty = { session_id: LEAD, session_title: DIRTY_TITLE, parent_session_id: null, lead_session_id: LEAD }
    put(a, URL_A, rowOf({ id: ID1, type: 'ack' }, dirty))
    put(a, URL_A, rowOf({ id: ID2, type: 'ack', status: 'acknowledged', response: { acknowledged: true }, delivered: true }, dirty))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const open = await shownText(ui)
    expect(open).toContain(`Lead: ${CLEAN_TITLE}`)
    expect(open.split('\n')).toContain(CLEAN_TITLE)
    expect(open).not.toContain('x'.repeat(51))
    expect(open).not.toContain('\u202e')
    await ui.press({ key: 'humantray:tab:history' })
    await w.clock.settle()
    const history = await shownText(ui)
    expect(history).toContain(`HT-${ID2.slice(-5)} · ${CLEAN_TITLE} · answered `)
    expect(history).not.toContain('x'.repeat(51))
  })

  vtest('a plain session with the setting stored does not become a viewer', async ($, on) => {
    const { w, a } = viewerWorld(on, { store: { 'viewer:config': { session: 'someone-else' } } })
    await $.session.start(START_EVENT)
    await tickOnce(w)
    expect(a.calls.filter(c => c.tool === 'ArtifactData')).toEqual([])
  })

  vtest("the viewer session's own restart takes a stale lease back", async ($, on) => {
    const stale = { instance: 'gone', session: VIEWER, renewed: START - LEASE_MS - 1 }
    const { w, a } = viewerWorld(on, { store: { 'viewer:config': { session: VIEWER }, 'viewer:lease': stale } })
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await $.session.start(START_EVENT)
    await w.clock.settle()
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Viewer: 2 repositories')
  })

  vtest("a fresh lease held by another session's instance is left alone at start", async ($, on) => {
    const held = { instance: 'other', session: 'another-session', renewed: START - 1000 }
    const { w, a } = viewerWorld(on, { store: { 'viewer:config': { session: VIEWER }, 'viewer:lease': held } })
    await $.session.start(START_EVENT)
    await tickOnce(w)
    expect(a.calls.filter(c => c.tool === 'ArtifactData')).toEqual([])
  })

  vtest('another session taking over with /humantray-viewer: this one stops at its next tick', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    // Another instance's command writes its own lease.
    w.storeOverride = key => (key === 'viewer:lease' ? { instance: 'other', session: 'b', renewed: w.clock.now() } : undefined)
    const before = a.calls.length
    await tickOnce(w)
    await tickOnce(w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).not.toContain('Viewer:')
    expect(a.calls.length).toBe(before)
  })

  vtest('in a cloud session the command refuses and nothing is read', async ($, on) => {
    const { w, a } = viewerWorld(on, { env: { CLAUDE_CODE_REMOTE: 'true' } })
    a.session = { id: ME, title: null, parent: null }
    const text = await turnOn($, w)
    expect(text).toContain('only in a local session')
    // The session's own start pass reads the open rows once, to prune its
    // finished ones around them (#82); the viewer reads none, then or later.
    const openReads = () =>
      a.calls.filter(c => c.tool === 'ArtifactData' && c.input.collection === 'items' && c.input.action === 'query' && JSON.stringify(c.input.query).includes('"open"')).length
    expect(openReads()).toBeLessThanOrEqual(1)
    const before = openReads()
    await tickOnce(w)
    await tickOnce(w)
    expect(openReads()).toBe(before)
  })

  vtest('off stops it', async ($, on) => {
    const { w, a } = viewerWorld(on)
    await turnOn($, w)
    const ran = await $.command.run({ ...VIEWER_COMMAND, args: 'off' })
    expect((ran as { text?: string }).text).toContain('off')
    const before = a.calls.length
    await tickOnce(w)
    expect(a.calls.length).toBe(before)
  })
})

describe('finding the artifacts', () => {
  vtest('one per repository: the earliest meta/page, whatever the listing order', async ($, on) => {
    const { w, a } = viewerWorld(on)
    const later = 'https://claude.ai/artifact/fakeartifact00000LATER'
    a.add(later, 'humantray: owner/repo')
    a.put(later, 'meta/page', meta(START + 5000))
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    put(a, later, rowOf({ id: ID2, type: 'approve' }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text).toContain('Question 01')
    expect(text).not.toContain('Question 02')
  })

  vtest('named repositories only', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    put(a, URL_B, rowOf({ id: ID2, type: 'approve', repo: REPO2 }))
    const text = await turnOn($, w, 'owner/other')
    expect(text).toContain('on for 1 repository: github.com/owner/other')
  })

  vtest('an unreadable listing says so, and a given link still works', async ($, on) => {
    const { w, a } = viewerWorld(on)
    a.listFails = true
    expect(await turnOn($, w)).toContain('could not be read')
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    const ran = await $.command.run({ ...VIEWER_COMMAND, args: URL_A })
    await w.clock.settle()
    expect((ran as { text?: string }).text).toContain('on for 1 repository: github.com/owner/repo')
  })

  vtest('a word that is neither a repository nor a link is refused', async ($, on) => {
    const { w } = viewerWorld(on)
    expect(await turnOn($, w, 'not a repo!')).toContain('not a repository or an artifact link')
  })
})

describe('reading and drawing', () => {
  vtest('a choice card on an app surface: checkbox rows and an Other row, pressed by the unchanged keys, answered by envelope (#64, #72, #75)', async ($, on) => {
    const { w, a, sends } = viewerWorld(on)
    const options = [
      { label: 'One', description: 'The first' },
      { label: 'Two', description: '' },
    ]
    put(a, URL_A, rowOf({ id: ID1, type: 'choice', options, multiSelect: true }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'vscode' })
    expect((await ui.find({ key: `v:${ID1}:options` }))?.type).toBe('Box')
    expect((await ui.find({ key: `v:${ID1}:opt:0` }))?.text).toBe('☐ One')
    expect((await ui.find({ key: `v:${ID1}:opt:0:about` }))?.text).toContain('The first')
    expect(await ui.find({ key: `v:${ID1}:opt:1:about` })).toBeUndefined()
    await ui.press({ key: `v:${ID1}:opt:0` })
    await ui.press({ key: `v:${ID1}:opt:1` })
    expect((await ui.find({ key: `v:${ID1}:opt:1` }))?.text).toBe('✅ Two')
    // Other is a row there too (#72): pressed, its field opens under it.
    await ui.press({ key: `v:${ID1}:opt:other` })
    await ui.input({ key: `v:${ID1}:other`, text: 'Three', kind: 'change' })
    await ui.press({ key: `v:${ID1}:submit` })
    await w.clock.settle()
    expect(sends).toHaveLength(1)
    expect(readEnvelope(sends[0]?.text ?? '')).toMatchObject({ id: ID1, response: { selected: ['One', 'Two'], other: 'Three' }, status: 'answered' })
  })

  vtest('grouped by repository, then lead, then asker, with a checked session link and last activity', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    put(a, URL_A, rowOf({ id: ID2, type: 'ack' }, { session_id: LEAD, session_title: 'the lead', parent_session_id: null, lead_session_id: LEAD }))
    put(a, URL_A, rowOf({ id: ID3, type: 'ack' }, { session_id: 'https://evil.example/', session_title: 'odd', lead_session_id: LEAD }))
    put(a, URL_B, rowOf({ id: '01AAAAAAAAAAAAAAAAAAAVIEW04', type: 'ack', repo: REPO2 }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text.indexOf('github.com/owner/other')).toBeLessThan(text.indexOf('github.com/owner/repo'))
    expect(text).toContain('Lead: the lead')
    const links = await ui.findAll({ type: 'Link' })
    const hrefs = links.map(l => (l as unknown as { props?: { href?: string } }).props?.href ?? '')
    expect(hrefs.some(h => h === `https://claude.ai/code/${ME}`)).toBe(true)
    expect(hrefs.some(h => h.includes('evil.example'))).toBe(false)
    expect(text).toContain('last active')
  })

  vtest('a failed read keeps the last data, marked stale', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    a.garble = 1_000
    await tickOnce(w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text).toContain('Question 01')
    expect(text).toContain('last read')
  })

  vtest('two reads a tick for each artifact with a few open items and an empty outbox', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    await tickOnce(w) // a tick that reads History (every fifth) is not this one
    const before = a.calls.length
    await tickOnce(w)
    const tick = a.calls.slice(before).filter(c => c.tool === 'ArtifactData')
    // URL_A: open items, responses; URL_B: open items (none, so no responses read).
    expect(tick).toHaveLength(3)
  })

  vtest('unreadable and newer rows are counted, not drawn', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    a.put(URL_A, `items/${ID2}`, { ...rowOf({ id: ID2, type: 'approve' }), schema: 2 } as unknown as Record<string, unknown>)
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text).toContain('1 rows could not be read')
    expect(text).not.toContain('Question 02')
  })

  vtest('a row without envelope: 1 is read-only, with a link to the page', async ($, on) => {
    const { w, a } = viewerWorld(on)
    const { envelope: _e, ...old } = rowOf({ id: ID1, type: 'approve' })
    a.put(URL_A, `items/${ID1}`, old as unknown as Record<string, unknown>)
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await ui.findAll({ key: `v:${ID1}:approve` })).toEqual([])
    expect(await shownText(ui)).toContain('answer on the page')
  })

  vtest('50 open items with 20,000-character bodies: pages of 10 cards, each well under the drawing limit', async ($, on) => {
    const { w, a } = viewerWorld(on)
    for (let n = 0; n < 50; n++) {
      const id = `01AAAAAAAAAAAAAAAAAAAB${String(n).padStart(4, '0')}`
      put(a, URL_A, rowOf({ id, type: 'ack', body_md: `${'word '.repeat(3_990)}${MARK}` }))
    }
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const cards = await ui.findAll({ type: 'Box' })
    const cardCount = cards.filter(b => String((b as unknown as { key?: string }).key ?? '').endsWith(':card')).length
    expect(cardCount).toBeLessThanOrEqual(10)
    expect(await drawnLength(ui)).toBeLessThan(100_000)
    expect((await ui.findAll({ key: 'v:next' })).length).toBe(1)
  })

  vtest('50 open items whose 20,000-character bodies are all short fences: copy buttons capped per card, the page still under the limit (#51)', async ($, on) => {
    // The terminal viewer: the desktop app draws no copy buttons (below).
    const { w, a } = viewerWorld(on, { surfaces: ['terminal'] })
    // A fence per 60 characters, each with a long first line: as many copy labels as a body can make.
    const fence = (k: number) => `\`\`\`sh\n${'x'.repeat(40)}${String(k).padStart(4, '0')}\n\`\`\``
    const body = Array.from({ length: 360 }, (_, k) => fence(k)).join('\n\n').slice(0, 20_000)
    for (let n = 0; n < 50; n++) {
      const id = `01AAAAAAAAAAAAAAAAAAAB${String(n).padStart(4, '0')}`
      put(a, URL_A, rowOf({ id, type: 'do', body_md: body }))
    }
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    const buttons = await ui.findAll({ type: 'Button' })
    const copies = buttons.filter(b => /:copy:\d+$/.test(String((b as unknown as { key?: string }).key ?? '')))
    expect(copies.length).toBe(10 * 9)
    expect(buttons.filter(b => String((b as unknown as { key?: string }).key ?? '').endsWith(':copy:more')).length).toBe(10)
    // The labels are counted: ninety of them, each over 40 characters.
    expect((await drawnLength(ui)) - (await shownText(ui)).length).toBeGreaterThan(90 * 40)
    expect(await drawnLength(ui)).toBeLessThan(100_000)
  })

  vtest('50 open items whose fences carry 2,000-character language words: every card on the page keeps its text and its answer controls (#51)', async ($, on) => {
    const { w, a } = viewerWorld(on, { surfaces: ['terminal'] })
    // Nine fences a body, each info word 2,000 characters: the reader's case on PR #56.
    const body = Array.from({ length: 9 }, (_, k) => `\`\`\`${'L'.repeat(2_000)}\nstep ${String(k)}\n\`\`\``).join('\n\n')
    const ids: string[] = []
    for (let n = 0; n < 50; n++) {
      const id = `01AAAAAAAAAAAAAAAAAAAB${String(n).padStart(4, '0')}`
      ids.push(id)
      put(a, URL_A, rowOf({ id, type: 'do', body_md: body }))
    }
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    const keys = (await ui.findAll({ type: 'Button' })).map(b => String((b as unknown as { key?: string }).key ?? ''))
    expect(keys.filter(key => key.endsWith(':done'))).toHaveLength(10)
    expect(keys.filter(key => /:copy:\d+$/.test(key))).toHaveLength(90)
    for (const b of await ui.findAll({ type: 'Button' })) expect(((b as unknown as { props?: { label?: string } }).props?.label ?? '').length).toBeLessThan(100)
    expect(await drawnLength(ui)).toBeLessThan(100_000)
  })

  for (const surface of ['desktop', 'vscode'] as const) {
    vtest(`${surface}: 50 open items whose 20,000-character bodies are all short fences holding control characters: one note a card, the page under both limits (#51)`, async ($, on) => {
      // The reader's probe on PR #61: a fence per few characters, each with a control character in it.
      const { w, a } = viewerWorld(on, { surfaces: [surface] })
      const body = Array.from({ length: 2_000 }, (_, k) => `\`\`\`\nx\u0001${String(k)}\n\`\`\``).join('\n\n').slice(0, 20_000)
      for (let n = 0; n < 50; n++) {
        const id = `01AAAAAAAAAAAAAAAAAAAB${String(n).padStart(4, '0')}`
        put(a, URL_A, rowOf({ id, type: 'do', body_md: body }))
      }
      await turnOn($, w)
      const ui = await mount($, { ...PANE, surface })
      const tree = await ui.drawn()
      const count = (node: unknown): number => {
        const children = (node as { children?: unknown[] }).children ?? []
        return 1 + children.reduce<number>((sum, child) => sum + (typeof child === 'object' && child !== null ? count(child) : 0), 0)
      }
      expect(count(tree)).toBeLessThan(20_000)
      expect(await drawnLength(ui)).toBeLessThan(100_000)
      const keys = (await ui.findAll({ type: 'Button' })).map(b => String((b as unknown as { key?: string }).key ?? ''))
      expect(keys.filter(key => key.endsWith(':done'))).toHaveLength(10)
      expect(keys.filter(key => key.includes(':copy'))).toEqual([])
      const notes = (await ui.findAll({ type: 'Text' })).filter(t => /^Code blocks? .* control characters/.test(t.text ?? ''))
      expect(notes).toHaveLength(10)
      expect(notes[0]?.text).toMatch(/^Code blocks 1, 2, 3 and \d+ more hold control characters: the app's copy of them has \ufffd where they were$/)
    })
  }

  vtest('the desktop app: no copy buttons and no Code n labels on a viewer card, its answer controls kept; the terminal draws both (#51)', async ($, on) => {
    const { w, a } = viewerWorld(on, { surfaces: ['desktop', 'terminal'] })
    put(a, URL_A, rowOf({ id: ID1, type: 'do', body_md: '```sh\nls -l\n```\n\nthen\n\n```\npwd\n```' }))
    await turnOn($, w)
    const desktop = await mount($, { ...PANE, surface: 'desktop' })
    const keys = (await desktop.findAll({ type: 'Button' })).map(b => String((b as unknown as { key?: string }).key ?? ''))
    expect(keys.filter(key => key.includes(':copy'))).toEqual([])
    expect(keys).toContain(`v:${ID1}:done`)
    expect(await drawnText(desktop, `v:${ID1}:body`)).toBe('```sh\nls -l\n```\n\nthen\n\n```\npwd\n```')
    expect((await desktop.find({ key: `v:${ID1}:card` }))?.props).toMatchObject({ paddingX: 'sm', paddingTop: 'sm', paddingBottom: 'md' })
    expect((await desktop.find({ key: `v:${ID1}:feedback:field` }))?.props.marginBottom).toBe('sm')
    await desktop.unmount()
    const terminal = await mount($, { ...PANE, surface: 'terminal' })
    expect((await terminal.find({ key: `v:${ID1}:card` }))?.props.padding).toBe('sm')
    expect((await terminal.find({ key: `v:${ID1}:copy:1` }))?.type).toBe('Button')
    expect((await terminal.find({ key: `v:${ID1}:copy:2` }))?.type).toBe('Button')
    expect(await drawnText(terminal, `v:${ID1}:body`)).toBe('*Code 1*\n\n```sh\nls -l\n```\n\nthen\n\n*Code 2*\n\n```\npwd\n```')
  })

  vtest('humantray_list in the viewer session lists no store items', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    expect(answerOf<{ items: unknown[] }>(await $.tool.call({ tool: LIST })).items).toEqual([])
  })
})

describe('answering', () => {
  async function answered($: Engine, on: On) {
    const env = viewerWorld(on)
    put(env.a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, env.w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `v:${ID1}:approve` })
    await env.w.clock.settle()
    await ui.unmount()
    return env
  }

  vtest('the outbox entry is written before the send', async ($, on) => {
    const env = viewerWorld(on)
    put(env.a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    let heldAtSend: unknown
    env.send.answer = () => {
      heldAtSend = env.w.kv('viewer:outbox')
      return { isDelivered: true }
    }
    await turnOn($, env.w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `v:${ID1}:approve` })
    await env.w.clock.settle()
    expect(Object.keys(heldAtSend as Record<string, unknown>)).toEqual([`${URL_A} ${ID1}`])
    expect((env.w.kv('viewer:outbox') as Record<string, OutboxEntry>)[`${URL_A} ${ID1}`]).toMatchObject({ sends: 1, delivered: true })
  })

  vtest('one envelope to the asker, in the shape the asker reads, with the row as drawn', async ($, on) => {
    const { sends, a } = await answered($, on)
    expect(sends).toHaveLength(1)
    expect(sends[0]?.to).toContain(ME)
    const envelope = readEnvelope(sends[0]?.text ?? '')
    expect(envelope).toMatchObject({ id: ID1, by: 'viewer', to: ME, artifact: URL_A, response: { selected: ['Approve'] }, status: 'answered', seen: { bumps: 0 } })
    // The viewer never writes the store.
    expect(a.writes()).toEqual([])
    expect(a.calls.filter(c => c.tool === 'Artifact' && c.input.action === 'publish')).toEqual([])
  })

  vtest('the card then reads "sent", and a second answer is refused', async ($, on) => {
    const { w } = await answered($, on)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text).toContain('Sent; waiting for the session to take it.')
    expect(await ui.findAll({ key: `v:${ID1}:approve` })).toEqual([])
    expect(w.submits).toEqual([])
  })

  vtest('sent again 2, 10 and 30 minutes after the first send while nothing settles', async ($, on) => {
    const { w, sends } = await answered($, on)
    await tickOnce(w, 2 * 60_000)
    expect(sends).toHaveLength(2)
    await tickOnce(w, 8 * 60_000)
    expect(sends).toHaveLength(3)
    await tickOnce(w, 20 * 60_000)
    expect(sends).toHaveLength(4)
    await tickOnce(w, 30 * 60_000)
    expect(sends).toHaveLength(4)
    await tickOnce(w, 30 * 60_000)
    expect(sends).toHaveLength(5)
  })

  vtest('a send not delivered is kept with its reason, and tried again', async ($, on) => {
    const env = viewerWorld(on)
    env.send.answer = () => ({ isDelivered: false, reason: 'the session is gone' })
    put(env.a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, env.w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `v:${ID1}:approve` })
    await env.w.clock.settle()
    expect(await shownText(ui)).toContain('Not sent: the session is gone')
    env.send.answer = () => ({ isDelivered: true })
    await tickOnce(env.w, 2 * 60_000)
    expect(env.sends).toHaveLength(2)
  })

  vtest('applied and not yet delivered: kept, still sent on its schedule; delivered: settled and in History', async ($, on) => {
    const { w, a, sends } = await answered($, on)
    const envelope = readEnvelope(sends[0]?.text ?? '')
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Approve'] }, answer_id: envelope?.answer_id, delivered: false }))
    await tickOnce(w, 2 * 60_000)
    expect(sends).toHaveLength(2)
    let ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Applied; waiting for the session to receive it.')
    await ui.unmount()
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Approve'] }, answer_id: envelope?.answer_id, delivered: true }))
    await tickOnce(w, 8 * 60_000)
    expect(sends).toHaveLength(2)
    await tickOnce(w, 30 * 60_000)
    expect(sends).toHaveLength(2)
    ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: 'humantray:tab:history' })
    await w.clock.settle()
    expect(await shownText(ui)).toContain(`HT-${ID1.slice(-5)}`)
  })

  vtest('the asker refused our answer: the card is answerable again, with the reason', async ($, on) => {
    const { w, a, sends } = await answered($, on)
    const envelope = readEnvelope(sends[0]?.text ?? '')
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', bumps: 1, response_refused: { answer_id: envelope?.answer_id ?? '', reason: 'raised again', at: START } }))
    await tickOnce(w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('The session refused the last answer: raised again')
    expect((await ui.findAll({ key: `v:${ID1}:approve` })).length).toBe(1)
  })

  vtest('our own response row while the item is open: kept, shown as stored', async ($, on) => {
    const { w, a, sends } = await answered($, on)
    const envelope = readEnvelope(sends[0]?.text ?? '')
    a.put(URL_A, `responses/${ID1}`, response(ID1, { answer_id: envelope?.answer_id, by: 'viewer' }))
    await tickOnce(w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Stored; waiting for the session to apply it.')
  })

  vtest('answered on the page first: settled, the card says so', async ($, on) => {
    const { w, a } = await answered($, on)
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    await tickOnce(w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Answered on the page')
  })

  vtest('another answer taken first: settled, with a toast naming only the short id', async ($, on) => {
    const { w, a } = await answered($, on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Reject'] }, answer_id: 'pageanswer000000000000', delivered: true }))
    await tickOnce(w)
    expect(w.toasts).toContain(`HT-${ID1.slice(-5)}: another answer was taken first`)
    expect(w.toasts.join('\n')).not.toContain(MARK)
  })

  vtest('the row gone (the store says no such document): settled', async ($, on) => {
    const { w, a, sends } = await answered($, on)
    a.artifacts.find(x => x.url === URL_A)?.docs.delete(`items/${ID1}`)
    await tickOnce(w, 2 * 60_000)
    await tickOnce(w, 8 * 60_000)
    expect(sends).toHaveLength(1)
  })

  vtest('a read that fails changes nothing: still sent on its schedule', async ($, on) => {
    const { w, a, sends } = await answered($, on)
    a.garble = 1_000
    await tickOnce(w, 2 * 60_000)
    expect(sends).toHaveLength(2)
  })

  vtest('a day with nothing settled: "not taken", no more sends by itself, and Send again starts over', async ($, on) => {
    // An answer first sent a day ago, still unsettled.
    const dayOld: OutboxEntry = {
      artifact: URL_A,
      id: ID1,
      short: `HT-${ID1.slice(-5)}`,
      to: ME,
      answer_id: 'olderAnswerId00000000000',
      text: 'an envelope',
      first: START - GIVE_UP_MS,
      last: START - 60_000,
      sends: 9,
      delivered: true,
    }
    const { w, a, sends } = viewerWorld(on, { store: { 'viewer:outbox': { [`${URL_A} ${ID1}`]: dayOld } } })
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    const count = sends.length
    await tickOnce(w, 2 * 60 * 60_000 - TICK_MS)
    expect(count).toBe(0)
    expect(sends.length).toBe(count)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Not taken by the session in a day.')
    await ui.press({ key: `v:${ID1}:again` })
    await w.clock.settle()
    expect(sends.length).toBe(count + 1)
  })

  vtest('a restart of the viewer within 90 s: the new instance takes its lease back at once and sends the outbox it left', async ($, on) => {
    // What the previous process left: its fresh lease, the setting, and an answer due again.
    const left: OutboxEntry = {
      artifact: URL_A,
      id: ID1,
      short: `HT-${ID1.slice(-5)}`,
      to: ME,
      answer_id: 'leftAnswerId000000000000',
      text: 'an envelope left by the last process',
      first: START - 10 * 60_000,
      last: START - 10 * 60_000,
      sends: 1,
      delivered: true,
    }
    const { w, a, sends } = viewerWorld(on, {
      store: {
        'viewer:config': { session: VIEWER },
        'viewer:lease': { instance: 'the-previous-process', session: VIEWER, renewed: START - 5_000 },
        'viewer:outbox': { [`${URL_A} ${ID1}`]: left },
      },
    })
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await $.session.start(START_EVENT)
    await w.clock.settle()
    expect(sends).toEqual([{ to: expect.stringContaining(ME) as unknown as string, text: left.text }])
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Viewer: 2 repositories')
  })

  vtest('an answer kept and never sent (the process ended first) is sent at the next tick, not an hour later', async ($, on) => {
    const kept: OutboxEntry = {
      artifact: URL_A,
      id: ID1,
      short: `HT-${ID1.slice(-5)}`,
      to: ME,
      answer_id: 'keptAnswerId000000000000',
      text: 'a kept envelope',
      first: START - 60_000,
      last: START - 60_000,
      sends: 0,
      delivered: false,
    }
    const { w, a, sends } = viewerWorld(on, { store: { 'viewer:outbox': { [`${URL_A} ${ID1}`]: kept } } })
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    expect(sends).toHaveLength(1)
    // Then on its steps from that send: nothing on the next ticks.
    await tickOnce(w)
    await tickOnce(w)
    expect(sends).toHaveLength(1)
  })

  vtest('nothing about an item or answer enters a command reply or a toast', async ($, on) => {
    const { w } = await answered($, on)
    const ran = await $.command.run({ ...VIEWER_COMMAND, args: '' })
    expect((ran as { text?: string }).text).not.toContain(MARK)
    expect(w.toasts.join('\n')).not.toContain(MARK)
    expect(w.submits).toEqual([])
  })

  vtest('an answer of every type is sent in its shape', async ($, on) => {
    const env = viewerWorld(on)
    put(env.a, URL_A, rowOf({ id: ID1, type: 'question' }))
    put(env.a, URL_A, rowOf({ id: ID2, type: 'do', notes: true }))
    await turnOn($, env.w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.input({ key: `v:${ID1}:text`, text: '- a\n- b\n\n```sh\nmake\n```', kind: 'change' })
    await ui.press({ key: `v:${ID1}:submit` })
    await ui.input({ key: `v:${ID2}:notes`, text: '**done** at last', kind: 'change' })
    await ui.press({ key: `v:${ID2}:not_done` })
    await env.w.clock.settle()
    const bodies = env.sends.map(s => readEnvelope(s.text))
    expect(bodies.find(b => b?.id === ID1)?.response).toEqual({ text: '- a\n- b\n\n```sh\nmake\n```' })
    expect(bodies.find(b => b?.id === ID2)?.response).toEqual({ outcome: 'not_done', notes: '**done** at last' })
    expect(bodies.every(b => b?.to === ME)).toBe(true)
  })

  vtest('Enter in a free-text field keeps the text shown: the field is drawn afresh with it (#48)', async ($, on) => {
    const env = viewerWorld(on)
    put(env.a, URL_A, rowOf({ id: ID2, type: 'do', notes: true }))
    await turnOn($, env.w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.input({ key: `v:${ID2}:feedback`, text: '- one\n- two' })
    expect(await ui.find({ key: `v:${ID2}:feedback` })).toBeUndefined()
    expect((await ui.find({ key: `v:${ID2}:feedback:1` }))?.props.value).toBe('- one\n- two')
    await ui.press({ key: `v:${ID2}:done` })
    await env.w.clock.settle()
    const bodies = env.sends.map(s => readEnvelope(s.text))
    expect(bodies.find(b => b?.id === ID2)?.response).toEqual({ outcome: 'done', feedback: '- one\n- two' })
  })
})

describe('one tick at a time, and nothing written after off', () => {
  /** Holds every store call until released. */
  function holdStore(a: ReturnType<typeof artifactWorld>) {
    let release = () => undefined as void
    a.hold = new Promise<void>(resolve => {
      release = () => {
        a.hold = undefined
        resolve()
      }
    })
    return () => release()
  }

  vtest('ticks never overlap: a tick asked for (the command, History) while one waits on the store makes no call until it ends', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    const release = holdStore(a)
    // A timer tick starts and waits on its first read (the clock stays under the call's time limit).
    await w.clock.advance(TICK_MS)
    const before = a.calls.length
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const pressed = ui.press({ key: 'humantray:tab:history' })
    const ran = $.command.run({ ...VIEWER_COMMAND, args: '' })
    await w.clock.settle()
    expect(a.calls.length).toBe(before)
    release()
    await pressed
    await ran
    await w.clock.settle()
    expect(a.calls.length).toBeGreaterThan(before)
  })

  vtest('a /humantray-viewer change made while a tick runs takes effect: the reply and the pane name the new set', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    put(a, URL_B, rowOf({ id: ID2, type: 'approve', repo: REPO2 }))
    await turnOn($, w)
    const release = holdStore(a)
    await tickOnce(w)
    const ran = $.command.run({ ...VIEWER_COMMAND, args: 'owner/other' })
    await w.clock.settle()
    release()
    const text = ((await ran) as { text?: string }).text ?? ''
    await w.clock.settle()
    expect(text).toContain('on for 1 repository: github.com/owner/other')
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const shown = await shownText(ui)
    expect(shown).toContain('Question 02')
    expect(shown).not.toContain('Question 01')
  })

  vtest('History asked for while a tick runs is read once that tick ends', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: true, response_at: START }))
    await turnOn($, w)
    await tickOnce(w)
    const release = holdStore(a)
    await tickOnce(w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const before = a.calls.length
    const pressed = ui.press({ key: 'humantray:tab:history' })
    await w.clock.settle()
    release()
    await pressed
    await w.clock.settle()
    const historyReads = a.calls.slice(before).filter(c => c.input.collection === 'items' && JSON.stringify(c.input.query ?? {}).includes('response_at'))
    expect(historyReads.length).toBeGreaterThan(0)
  })

  vtest('off while a tick runs: the pane goes back to the normal tray and stays there', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    const release = holdStore(a)
    await tickOnce(w)
    await $.command.run({ ...VIEWER_COMMAND, args: 'off' })
    release()
    await w.clock.settle()
    await tickOnce(w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).not.toContain('Viewer:')
  })
})

describe('finding the artifacts again', () => {
  vtest('a meta/page read that fails at a re-find keeps the set and its cards', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    a.before = input => {
      if (input.collection === 'meta' && input.action === 'get') a.garble = 1
    }
    await tickOnce(w, FIND_MS)
    a.before = () => undefined
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text).toContain('Viewer: 2 repositories')
    expect(text).toContain('could not be read just now')
    expect(text).toContain('Question 01')
  })

  vtest('a meta/page read that fails at turning on says the list could not be read, not that none was found', async ($, on) => {
    const { w, a } = viewerWorld(on)
    a.before = input => {
      if (input.collection === 'meta' && input.action === 'get' && input.url === URL_B) a.garble = 1
    }
    const text = await turnOn($, w)
    expect(text).toContain('could not be read')
    expect(text).not.toContain('no humantray page was found')
  })

  vtest('an unreadable listing at a re-find keeps the set', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    a.listFails = true
    await tickOnce(w, FIND_MS)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text).toContain('Viewer: 2 repositories')
    expect(text).toContain('could not be read just now')
    expect(text).toContain('Question 01')
  })

  vtest('a repository named is found by its title, however many other humantray pages there are', async ($, on) => {
    const { w, a } = viewerWorld(on)
    for (let n = 0; n < MAX_LISTED + 10; n++) {
      const url = `https://claude.ai/artifact/fakeartifact000many${String(n).padStart(4, '0')}`
      a.add(url, `humantray: someone/repo${n}`)
    }
    // The named repository's page is the oldest, so the listing (newest first) gives it last.
    const art = a.artifacts.find(x => x.url === URL_A)
    if (art !== undefined) a.artifacts.push(...a.artifacts.splice(a.artifacts.indexOf(art), 1))
    a.artifacts.unshift(...a.artifacts.splice(a.artifacts.length - 1, 1))
    const text = await turnOn($, w, 'owner/repo')
    expect(text).toContain('on for 1 repository: github.com/owner/repo')
    const metaReads = a.calls.filter(c => c.input.collection === 'meta')
    expect(metaReads.length).toBeLessThanOrEqual(2)
  })

  vtest('more humantray pages than the cap, with none named: could not be read, never "none"', async ($, on) => {
    const { w, a } = viewerWorld(on)
    for (let n = 0; n < MAX_LISTED + 10; n++) a.add(`https://claude.ai/artifact/fakeartifact000many${String(n).padStart(4, '0')}`, `humantray: someone/repo${n}`)
    const text = await turnOn($, w)
    expect(text).toContain('could not be read')
  })
})

describe('History freshness', () => {
  vtest('a History read that fails is shown as such, apart from the open items', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    a.before = input => {
      if (JSON.stringify(input.query ?? {}).includes('response_at')) a.garble = 1
    }
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).not.toContain('last read')
    await ui.press({ key: 'humantray:tab:history' })
    await w.clock.settle()
    expect(await shownText(ui)).toContain('History not read yet')
  })
})

describe('the lease before every outbox write and send', () => {
  const due = (): OutboxEntry => ({
    artifact: URL_A,
    id: ID1,
    short: `HT-${ID1.slice(-5)}`,
    to: ME,
    answer_id: 'dueAnswerId0000000000000',
    text: 'a due envelope',
    first: START - 10 * 60_000,
    last: START - 10 * 60_000,
    sends: 1,
    delivered: true,
  })

  vtest('a takeover during a tick: the resend due in that tick is not sent', async ($, on) => {
    const { w, a, sends } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    w.kvSet('viewer:outbox', { [`${URL_A} ${ID1}`]: due() })
    a.before = () => {
      w.storeOverride = key => (key === 'viewer:lease' ? { instance: 'other', session: 'b', renewed: w.clock.now() } : undefined)
    }
    await tickOnce(w)
    expect(sends).toEqual([])
  })

  vtest('an answer pressed after another session took over: nothing is kept or sent, and the card says why', async ($, on) => {
    const { w, a, sends } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    w.storeOverride = key => (key === 'viewer:lease' ? { instance: 'other', session: 'b', renewed: w.clock.now() } : undefined)
    await ui.press({ key: `v:${ID1}:approve` })
    await w.clock.settle()
    expect(sends).toEqual([])
    expect(w.kv('viewer:outbox')).toBeUndefined()
    expect(await shownText(ui)).toContain('no longer the viewer')
  })

  vtest('two presses at once: one answer kept, one envelope sent', async ($, on) => {
    const { w, a, sends } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await Promise.all([ui.press({ key: `v:${ID1}:approve` }), ui.press({ key: `v:${ID1}:approve` })])
    await w.clock.settle()
    expect(sends).toHaveLength(1)
    expect(Object.keys(w.kv('viewer:outbox') as Record<string, unknown>)).toHaveLength(1)
  })

  vtest('an item whose session id is not a session id cannot be answered here', async ($, on) => {
    const { w, a, sends } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }, { session_id: 'not-a-session' }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `v:${ID1}:approve` })
    await w.clock.settle()
    expect(sends).toEqual([])
    expect(await shownText(ui)).toContain('no session to send the answer to')
  })

  vtest('a row that cannot be read keeps its entry: still sent on its schedule', async ($, on) => {
    const { w, a, sends } = viewerWorld(on)
    a.put(URL_A, `items/${ID1}`, { ...rowOf({ id: ID1, type: 'approve' }), schema: 2 } as unknown as Record<string, unknown>)
    w.kvSet('viewer:outbox', { [`${URL_A} ${ID1}`]: due() })
    await turnOn($, w)
    expect(sends).toHaveLength(1)
    expect(Object.keys(w.kv('viewer:outbox') as Record<string, unknown>)).toEqual([`${URL_A} ${ID1}`])
  })

  vtest('a stale read keeps its entry', async ($, on) => {
    const { w, a, sends } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Reject'] }, answer_id: 'another', delivered: true }))
    await turnOn($, w)
    w.kvSet('viewer:outbox', { [`${URL_A} ${ID1}`]: due() })
    a.garble = 1_000
    await tickOnce(w)
    expect(Object.keys(w.kv('viewer:outbox') as Record<string, unknown>)).toEqual([`${URL_A} ${ID1}`])
    expect(sends).toHaveLength(1)
  })

  vtest('every outbox write keeps the entries it does not change: an answer added during a tick that settles another survives', async ($, on) => {
    const { w, a } = viewerWorld(on)
    // ID1 settled by this tick (applied and delivered with our answer).
    const settling = due()
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Approve'] }, answer_id: settling.answer_id, delivered: true }))
    put(a, URL_A, rowOf({ id: ID2, type: 'approve' }))
    await turnOn($, w)
    w.kvSet('viewer:outbox', { [`${URL_A} ${ID1}`]: settling })
    const added: OutboxEntry = { ...due(), id: ID2, short: `HT-${ID2.slice(-5)}`, answer_id: 'addedAnswerId00000000000', last: START, first: START }
    let once = false
    a.before = () => {
      if (once) return
      once = true
      // Another answer is kept while this tick reads the store.
      w.kvSet('viewer:outbox', { ...(w.kv('viewer:outbox') as Record<string, OutboxEntry>), [`${URL_A} ${ID2}`]: added })
    }
    await tickOnce(w)
    expect(Object.keys(w.kv('viewer:outbox') as Record<string, unknown>)).toEqual([`${URL_A} ${ID2}`])
  })

  vtest('an outbox that cannot be read: no answer is taken, nothing is settled or sent', async ($, on) => {
    const { w, a, sends } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    w.kvSet('viewer:outbox', 'not an outbox')
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.press({ key: `v:${ID1}:approve` })
    await w.clock.settle()
    expect(sends).toEqual([])
    expect(await shownText(ui)).toContain('could not be read')
    expect(w.kv('viewer:outbox')).toBe('not an outbox')
  })

  vtest('a send that never returns counts as failed after its time limit, and the viewer goes on', async ($, on) => {
    const { w, a, send } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    put(a, URL_A, rowOf({ id: ID2, type: 'approve' }))
    await turnOn($, w)
    send.answer = () => new Promise(() => undefined)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const pressed = ui.press({ key: `v:${ID1}:approve` })
    await w.clock.advance(31_000)
    await pressed
    await w.clock.settle()
    const entry = (w.kv('viewer:outbox') as Record<string, OutboxEntry>)[`${URL_A} ${ID1}`]
    expect(entry).toMatchObject({ sends: 1, delivered: false })
    expect(entry?.reason).toContain('30 s')
    const before = a.calls.length
    await tickOnce(w)
    expect(a.calls.length).toBeGreaterThan(before)
  })
})

describe('the card body cut', () => {
  vtest('a body over 6,000 characters is drawn cut, with Show in full; the whole shows on request', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'ack', body_md: Array.from({ length: 40 }, (_, n) => `Paragraph ${n} ${'word '.repeat(30)}`).join('\n\n') }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const body = (await ui.findAll({ key: `v:${ID1}:body` }))[0] as unknown as { text?: string } | undefined
    expect((body?.text ?? '').length).toBeLessThanOrEqual(6_000)
    expect((body?.text ?? '').length).toBeGreaterThan(3_000)
    await ui.press({ key: `v:${ID1}:full` })
    await w.clock.settle()
    expect(await shownText(ui)).toContain('Paragraph 39')
  })
})

describe('re-read at 8e06312', () => {
  vtest('a first send still in flight is not sent again by a tick', async ($, on) => {
    const { w, a, sends, send } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    let open = () => undefined as void
    const held = new Promise<void>(resolve => {
      open = resolve
    })
    send.answer = async () => {
      await held
      return { isDelivered: true }
    }
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const pressed = ui.press({ key: `v:${ID1}:approve` })
    await w.clock.settle()
    // A timer tick while the first send waits (under the send's time limit).
    await w.clock.advance(TICK_MS)
    open()
    await pressed
    await w.clock.settle()
    expect(sends).toHaveLength(1)
  })

  vtest('a lease write that fails once keeps the viewer on, says so, and the next tick renews it', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    w.failStoreSet = key => key === 'viewer:lease'
    // Past the lease's life, so the failed renewal leaves no fresh lease.
    await tickOnce(w, LEASE_MS)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('The viewer lease could not be written')
    w.failStoreSet = () => false
    const before = a.calls.length
    await tickOnce(w)
    expect(a.calls.length).toBeGreaterThan(before)
    expect(await shownText(ui)).not.toContain('could not be written')
    expect(await shownText(ui)).toContain('Question 01')
  })

  vtest('a lease write that succeeds but reads back another instance stops the viewer', async ($, on) => {
    const { w } = viewerWorld(on)
    await turnOn($, w)
    w.storeOverride = key => (key === 'viewer:lease' ? { instance: 'other', session: 'b', renewed: w.clock.now() - LEASE_MS - 1 } : undefined)
    // Stale for the check at the start of the tick, so the tick writes its own; the read-back still names the other.
    await tickOnce(w)
    w.storeOverride = () => undefined
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).not.toContain('Viewer:')
  })
})

describe('acceptance findings (#32)', () => {
  const sentOnce = (fields: Partial<OutboxEntry> = {}): OutboxEntry => ({
    artifact: URL_A,
    id: ID1,
    short: `HT-${ID1.slice(-5)}`,
    to: ME,
    answer_id: 'snapAnswerId000000000000',
    text: 'an envelope',
    first: START - 3 * 60_000,
    last: START - 3 * 60_000,
    sends: 1,
    delivered: true,
    ...fields,
  })

  vtest('a tick does not resend from its stale copy: an entry sent while the tick read the store is not due again', async ($, on) => {
    const { w, a, sends } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    const key = `${URL_A} ${ID1}`
    // Due when the tick reads the outbox...
    w.kvSet('viewer:outbox', { [key]: sentOnce() })
    let once = false
    a.before = () => {
      if (once) return
      once = true
      // ...and sent by someone else while the tick reads the store.
      w.kvSet('viewer:outbox', { [key]: sentOnce({ sends: 2, last: w.clock.now() }) })
    }
    await tickOnce(w)
    expect(sends).toEqual([])
  })

  vtest('settled from History when the closed-row read is behind: no card left "applied", no resend', async ($, on) => {
    const { w, a, sends } = viewerWorld(on)
    const key = `${URL_A} ${ID1}`
    const answer = sentOnce().answer_id
    const applied = { id: ID1, type: 'approve' as const, status: 'answered' as const, response: { selected: ['Approve'] }, answer_id: answer, response_at: START }
    put(a, URL_A, rowOf({ ...applied, delivered: false }))
    put(a, URL_A, rowOf({ ...applied, delivered: true }))
    w.kvSet('viewer:outbox', { [key]: sentOnce() })
    // The by-id read sees an older copy (not yet delivered); History sees the newer one.
    const older = { data: rowOf({ ...applied, delivered: false }) as unknown as Record<string, unknown>, version: 2 }
    const newer = { data: rowOf({ ...applied, delivered: true }) as unknown as Record<string, unknown>, version: 3 }
    a.before = input => {
      const query = JSON.stringify(input.query ?? {})
      if (input.collection !== 'items') return
      const docs = a.artifacts.find(x => x.url === URL_A)?.docs
      if (query.includes('"in"') && query.includes(ID1)) docs?.set(`items/${ID1}`, older)
      else if (query.includes('response_at')) docs?.set(`items/${ID1}`, newer)
    }
    await turnOn($, w)
    expect(w.kv('viewer:outbox')).toEqual({})
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).not.toContain('Applied; waiting')
    expect(sends).toEqual([])
  })
})

describe('copying code from a viewer card (#51)', () => {
  const blocks = codeBlocksOf(RUNBOOK)
  const copier = (on: On) => {
    const copies: string[] = []
    on('ui.copy', (_, e) => {
      copies.push(e.text)
      return { value: { isCopied: true as const } }
    })
    return copies
  }

  vtest('every block of the whole body is offered, cut or not, and copies the stored text; so does "Show in full"', async ($, on) => {
    const { w, a } = viewerWorld(on, { surfaces: ['terminal'] })
    const copies = copier(on)
    // A lead-in past the card's budget, so that the whole runbook is cut away.
    put(a, URL_A, rowOf({ id: ID1, type: 'do', body_md: `${'Lead-in words. '.repeat(450)}\n\n${RUNBOOK}` }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    expect(await drawnText(ui, `v:${ID1}:body`)).not.toContain('docker build')
    await ui.press({ key: `v:${ID1}:copy:1` })
    expect(copies.at(-1)).toBe(blocks[0]?.text)
    expect(copies.at(-1)).toContain('\tEOF')
    await ui.press({ key: `v:${ID1}:copy:more` })
    await ui.press({ key: `v:${ID1}:copy:12` })
    expect(copies.at(-1)).toBe(blocks[11]?.text)
    await ui.press({ key: `v:${ID1}:full` })
    await w.clock.settle()
    await ui.press({ key: `v:${ID1}:full:copy:3` })
    expect(copies.at(-1)).toBe(blocks[2]?.text)
    for (const text of copies) expect(text.includes('\u200b')).toBe(false)
  })

  vtest('a runbook part now shows whole on the card: its steps are under the 6,000-character budget', async ($, on) => {
    const { w, a } = viewerWorld(on, { surfaces: ['terminal'] })
    put(a, URL_A, rowOf({ id: ID1, type: 'do', body_md: RUNBOOK }))
    await turnOn($, w)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    expect(await drawnText(ui, `v:${ID1}:body`)).toContain('step6')
    expect(await ui.find({ key: `v:${ID1}:full` })).toBeUndefined()
  })

  vtest("the viewer session's own items (This session) copy as the local pane's do", async ($, on) => {
    const { w } = viewerWorld(on, { surfaces: ['terminal'] })
    const copies = copier(on)
    await turnOn($, w)
    const id = answerOf<{ id: string }>(await $.tool.call({ tool: ADD, type: 'do', header: 'Mine', question: 'Mine', body_md: RUNBOOK })).id
    await w.clock.settle()
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'This session' })).toBeDefined()
    await ui.press({ key: `${id}:copy:2` })
    expect(copies.at(-1)).toBe(blocks[1]?.text)
  })
})

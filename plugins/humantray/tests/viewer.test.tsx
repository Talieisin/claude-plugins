// The local viewer (#32): one local session holds the lease, reads every
// repository's humantray artifact, draws it grouped by repository, lead and
// asker, and answers by sending a response envelope, keeping each answer
// until the store settles it. It never writes a row.

import { type Engine, describe, expect, test } from 'claude-code/testing'

import type { Item, ItemRow, OutboxEntry } from '../types'
import { readEnvelope } from '../hooks/envelope'
import { fingerprint, itemToRow } from '../hooks/row-shape'
import { GIVE_UP_MS, LEASE_MS, TICK_MS, isGivenUp, lastActive, nextSendAt, repoMatches, settleEntry } from '../hooks/viewer'
import { LEAD, ME, URL_A, URL_B, artifactWorld, meta, response } from './artifact-world'
import { COMMAND, LIST, PANE, START, START_EVENT, answerOf, stored, world } from './world'

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

/** A local viewer's world: two repositories' artifacts with rows, and a recorder of sends. */
function viewerWorld(on: On, options: Parameters<typeof world>[1] = {}) {
  const w = world(on, { sessionId: VIEWER, ...options })
  const a = artifactWorld(on, { read: path => w.files.get(path) })
  a.add(URL_A, 'humantray: owner/repo')
  a.put(URL_A, 'meta/page', meta(START - 1000))
  a.add(URL_B, 'humantray: owner/other')
  a.put(URL_B, 'meta/page', { ...meta(START - 1000), repo: REPO2 })
  const sends: Sent[] = []
  const send = { answer: (_: Sent) => ({ isDelivered: true }) as { isDelivered: boolean; reason?: string } }
  on('session.send', (_, e) => {
    const sent = { to: String(e.to), text: e.text }
    sends.push(sent)
    const answer = send.answer(sent)
    return answer.isDelivered ? { isDelivered: true as const } : { isDelivered: false as const, reason: answer.reason ?? 'refused' }
  })
  return { w, a, sends, send }
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

  test('sends after the first: 2, 10 and 30 minutes after it, then hourly; given up after a day', () => {
    expect(nextSendAt({ ...entry, sends: 1 }) - START).toBe(2 * 60_000)
    expect(nextSendAt({ ...entry, sends: 2 }) - START).toBe(10 * 60_000)
    expect(nextSendAt({ ...entry, sends: 3 }) - START).toBe(30 * 60_000)
    expect(nextSendAt({ ...entry, sends: 4, last: START + 5 }) - START).toBe(5 + 60 * 60_000)
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
  test('/humantray-viewer makes this session the viewer and opens the pane', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    const text = await turnOn($, w)
    expect(text).toContain('on for 2 repositories')
    expect(text).toContain('github.com/owner/repo')
    expect(text).not.toContain(MARK)
    expect(w.opened).toContain('humantray')
  })

  test('a plain session with the setting stored does not become a viewer', async ($, on) => {
    const { w, a } = viewerWorld(on, { store: { 'viewer:config': { session: 'someone-else' } } })
    await $.session.start(START_EVENT)
    await tickOnce(w)
    expect(a.calls.filter(c => c.tool === 'ArtifactData')).toEqual([])
  })

  test("the viewer session's own restart takes a stale lease back", async ($, on) => {
    const stale = { instance: 'gone', session: VIEWER, renewed: START - LEASE_MS - 1 }
    const { w, a } = viewerWorld(on, { store: { 'viewer:config': { session: VIEWER }, 'viewer:lease': stale } })
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await $.session.start(START_EVENT)
    await w.clock.settle()
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Viewer: 2 repositories')
  })

  test('a fresh lease held by another instance is left alone at start', async ($, on) => {
    const held = { instance: 'other', session: VIEWER, renewed: START - 1000 }
    const { w, a } = viewerWorld(on, { store: { 'viewer:config': { session: VIEWER }, 'viewer:lease': held } })
    await $.session.start(START_EVENT)
    await tickOnce(w)
    expect(a.calls.filter(c => c.tool === 'ArtifactData')).toEqual([])
  })

  test('another session taking over with /humantray-viewer: this one stops at its next tick', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    // Another instance's command writes its own lease.
    w.storeOverride = key => (key === 'viewer:lease' ? { instance: 'other', session: 'b', renewed: w.clock.now() } : undefined)
    const before = a.calls.length
    await tickOnce(w)
    await tickOnce(w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).not.toContain('Viewer:')
    expect(a.calls.length).toBe(before)
  })

  test('in a cloud session the command refuses and nothing is read', async ($, on) => {
    const { w, a } = viewerWorld(on, { env: { CLAUDE_CODE_REMOTE: 'true' } })
    a.session = { id: ME, title: null, parent: null }
    const text = await turnOn($, w)
    expect(text).toContain('only in a local session')
    const reads = a.calls.filter(c => c.tool === 'ArtifactData' && c.input.collection === 'items' && c.input.action === 'query' && JSON.stringify(c.input.query).includes('"open"'))
    await tickOnce(w)
    expect(reads).toEqual([])
  })

  test('off stops it', async ($, on) => {
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
  test('one per repository: the earliest meta/page, whatever the listing order', async ($, on) => {
    const { w, a } = viewerWorld(on)
    const later = 'https://claude.ai/artifact/fakeartifact00000LATER'
    a.add(later, 'humantray: owner/repo')
    a.put(later, 'meta/page', meta(START + 5000))
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    put(a, later, rowOf({ id: ID2, type: 'approve' }))
    await turnOn($, w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text).toContain('Question 01')
    expect(text).not.toContain('Question 02')
  })

  test('named repositories only', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    put(a, URL_B, rowOf({ id: ID2, type: 'approve', repo: REPO2 }))
    const text = await turnOn($, w, 'owner/other')
    expect(text).toContain('on for 1 repository: github.com/owner/other')
  })

  test('an unreadable listing says so, and a given link still works', async ($, on) => {
    const { w, a } = viewerWorld(on)
    a.listFails = true
    expect(await turnOn($, w)).toContain('could not be read')
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    const ran = await $.command.run({ ...VIEWER_COMMAND, args: URL_A })
    await w.clock.settle()
    expect((ran as { text?: string }).text).toContain('on for 1 repository: github.com/owner/repo')
  })

  test('a word that is neither a repository nor a link is refused', async ($, on) => {
    const { w } = viewerWorld(on)
    expect(await turnOn($, w, 'not a repo!')).toContain('not a repository or an artifact link')
  })
})

describe('reading and drawing', () => {
  test('grouped by repository, then lead, then asker, with a checked session link and last activity', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    put(a, URL_A, rowOf({ id: ID2, type: 'ack' }, { session_id: LEAD, session_title: 'the lead', parent_session_id: null, lead_session_id: LEAD }))
    put(a, URL_A, rowOf({ id: ID3, type: 'ack' }, { session_id: 'https://evil.example/', session_title: 'odd', lead_session_id: LEAD }))
    put(a, URL_B, rowOf({ id: '01AAAAAAAAAAAAAAAAAAAVIEW04', type: 'ack', repo: REPO2 }))
    await turnOn($, w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text.indexOf('github.com/owner/other')).toBeLessThan(text.indexOf('github.com/owner/repo'))
    expect(text).toContain('Lead: the lead')
    const links = await ui.findAll({ type: 'Link' })
    const hrefs = links.map(l => (l as unknown as { props?: { href?: string } }).props?.href ?? '')
    expect(hrefs.some(h => h === `https://claude.ai/code/${ME}`)).toBe(true)
    expect(hrefs.some(h => h.includes('evil.example'))).toBe(false)
    expect(text).toContain('last active')
  })

  test('a failed read keeps the last data, marked stale', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, w)
    a.garble = 1_000
    await tickOnce(w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text).toContain('Question 01')
    expect(text).toContain('last read')
  })

  test('two reads a tick for each artifact with a few open items and an empty outbox', async ($, on) => {
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

  test('unreadable and newer rows are counted, not drawn', async ($, on) => {
    const { w, a } = viewerWorld(on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    a.put(URL_A, `items/${ID2}`, { ...rowOf({ id: ID2, type: 'approve' }), schema: 2 } as unknown as Record<string, unknown>)
    await turnOn($, w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text).toContain('1 rows could not be read')
    expect(text).not.toContain('Question 02')
  })

  test('a row without envelope: 1 is read-only, with a link to the page', async ($, on) => {
    const { w, a } = viewerWorld(on)
    const { envelope: _e, ...old } = rowOf({ id: ID1, type: 'approve' })
    a.put(URL_A, `items/${ID1}`, old as unknown as Record<string, unknown>)
    await turnOn($, w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.findAll({ key: `v:${ID1}:approve` })).toEqual([])
    expect(await shownText(ui)).toContain('answer on the page')
  })

  test('50 open items with 20,000-character bodies: pages of 10 cards, each well under the drawing limit', async ($, on) => {
    const { w, a } = viewerWorld(on)
    for (let n = 0; n < 50; n++) {
      const id = `01AAAAAAAAAAAAAAAAAAAB${String(n).padStart(4, '0')}`
      put(a, URL_A, rowOf({ id, type: 'ack', body_md: `${'word '.repeat(3_990)}${MARK}` }))
    }
    await turnOn($, w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const cards = await ui.findAll({ type: 'Box' })
    const cardCount = cards.filter(b => String((b as unknown as { key?: string }).key ?? '').endsWith(':card')).length
    expect(cardCount).toBeLessThanOrEqual(10)
    expect((await shownText(ui)).length).toBeLessThan(100_000)
    expect((await ui.findAll({ key: 'v:next' })).length).toBe(1)
  })

  test('humantray_list in the viewer session lists no store items', async ($, on) => {
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
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `v:${ID1}:approve` })
    await env.w.clock.settle()
    await ui.unmount()
    return env
  }

  test('the outbox entry is written before the send', async ($, on) => {
    const env = viewerWorld(on)
    put(env.a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    let heldAtSend: unknown
    env.send.answer = () => {
      heldAtSend = env.w.kv('viewer:outbox')
      return { isDelivered: true }
    }
    await turnOn($, env.w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `v:${ID1}:approve` })
    await env.w.clock.settle()
    expect(Object.keys(heldAtSend as Record<string, unknown>)).toEqual([`${URL_A} ${ID1}`])
    expect((env.w.kv('viewer:outbox') as Record<string, OutboxEntry>)[`${URL_A} ${ID1}`]).toMatchObject({ sends: 1, delivered: true })
  })

  test('one envelope to the asker, in the shape the asker reads, with the row as drawn', async ($, on) => {
    const { sends, a } = await answered($, on)
    expect(sends).toHaveLength(1)
    expect(sends[0]?.to).toContain(ME)
    const envelope = readEnvelope(sends[0]?.text ?? '')
    expect(envelope).toMatchObject({ id: ID1, by: 'viewer', to: ME, artifact: URL_A, response: { selected: ['Approve'] }, status: 'answered', seen: { bumps: 0 } })
    // The viewer never writes the store.
    expect(a.writes()).toEqual([])
    expect(a.calls.filter(c => c.tool === 'Artifact' && c.input.action === 'publish')).toEqual([])
  })

  test('the card then reads "sent", and a second answer is refused', async ($, on) => {
    const { w } = await answered($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const text = await shownText(ui)
    expect(text).toContain('Sent; waiting for the session to take it.')
    expect(await ui.findAll({ key: `v:${ID1}:approve` })).toEqual([])
    expect(w.submits).toEqual([])
  })

  test('sent again 2, 10 and 30 minutes after the first send while nothing settles', async ($, on) => {
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

  test('a send not delivered is kept with its reason, and tried again', async ($, on) => {
    const env = viewerWorld(on)
    env.send.answer = () => ({ isDelivered: false, reason: 'the session is gone' })
    put(env.a, URL_A, rowOf({ id: ID1, type: 'approve' }))
    await turnOn($, env.w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `v:${ID1}:approve` })
    await env.w.clock.settle()
    expect(await shownText(ui)).toContain('Not sent: the session is gone')
    env.send.answer = () => ({ isDelivered: true })
    await tickOnce(env.w, 2 * 60_000)
    expect(env.sends).toHaveLength(2)
  })

  test('applied and not yet delivered: kept, still sent on its schedule; delivered: settled and in History', async ($, on) => {
    const { w, a, sends } = await answered($, on)
    const envelope = readEnvelope(sends[0]?.text ?? '')
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Approve'] }, answer_id: envelope?.answer_id, delivered: false }))
    await tickOnce(w, 2 * 60_000)
    expect(sends).toHaveLength(2)
    let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Applied; waiting for the session to receive it.')
    await ui.unmount()
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Approve'] }, answer_id: envelope?.answer_id, delivered: true }))
    await tickOnce(w, 8 * 60_000)
    expect(sends).toHaveLength(2)
    await tickOnce(w, 30 * 60_000)
    expect(sends).toHaveLength(2)
    ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'humantray:view' })
    await w.clock.settle()
    expect(await shownText(ui)).toContain(`HT-${ID1.slice(-5)}`)
  })

  test('the asker refused our answer: the card is answerable again, with the reason', async ($, on) => {
    const { w, a, sends } = await answered($, on)
    const envelope = readEnvelope(sends[0]?.text ?? '')
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', bumps: 1, response_refused: { answer_id: envelope?.answer_id ?? '', reason: 'raised again', at: START } }))
    await tickOnce(w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('The session refused the last answer: raised again')
    expect((await ui.findAll({ key: `v:${ID1}:approve` })).length).toBe(1)
  })

  test('our own response row while the item is open: kept, shown as stored', async ($, on) => {
    const { w, a, sends } = await answered($, on)
    const envelope = readEnvelope(sends[0]?.text ?? '')
    a.put(URL_A, `responses/${ID1}`, response(ID1, { answer_id: envelope?.answer_id, by: 'viewer' }))
    await tickOnce(w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Stored; waiting for the session to apply it.')
  })

  test('answered on the page first: settled, the card says so', async ($, on) => {
    const { w, a } = await answered($, on)
    a.put(URL_A, `responses/${ID1}`, response(ID1))
    await tickOnce(w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Answered on the page')
  })

  test('another answer taken first: settled, with a toast naming only the short id', async ($, on) => {
    const { w, a } = await answered($, on)
    put(a, URL_A, rowOf({ id: ID1, type: 'approve', status: 'answered', response: { selected: ['Reject'] }, answer_id: 'pageanswer000000000000', delivered: true }))
    await tickOnce(w)
    expect(w.toasts).toContain(`HT-${ID1.slice(-5)}: another answer was taken first`)
    expect(w.toasts.join('\n')).not.toContain(MARK)
  })

  test('the row gone (the store says no such document): settled', async ($, on) => {
    const { w, a, sends } = await answered($, on)
    a.artifacts.find(x => x.url === URL_A)?.docs.delete(`items/${ID1}`)
    await tickOnce(w, 2 * 60_000)
    await tickOnce(w, 8 * 60_000)
    expect(sends).toHaveLength(1)
  })

  test('a read that fails changes nothing: still sent on its schedule', async ($, on) => {
    const { w, a, sends } = await answered($, on)
    a.garble = 1_000
    await tickOnce(w, 2 * 60_000)
    expect(sends).toHaveLength(2)
  })

  test('a day with nothing settled: "not taken", no more sends by itself, and Send again starts over', async ($, on) => {
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
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await shownText(ui)).toContain('Not taken by the session in a day.')
    await ui.press({ key: `v:${ID1}:again` })
    await w.clock.settle()
    expect(sends.length).toBe(count + 1)
  })

  test('the outbox outlives the module: a restart of the viewer keeps sending it', async ($, on) => {
    const { w, sends } = await answered($, on)
    // A reload: session.start runs again; the instance's lease is its own.
    await $.session.start(START_EVENT)
    await tickOnce(w, 2 * 60_000)
    expect(sends.length).toBeGreaterThanOrEqual(2)
  })

  test('nothing about an item or answer enters a command reply or a toast', async ($, on) => {
    const { w } = await answered($, on)
    const ran = await $.command.run({ ...VIEWER_COMMAND, args: '' })
    expect((ran as { text?: string }).text).not.toContain(MARK)
    expect(w.toasts.join('\n')).not.toContain(MARK)
    expect(w.submits).toEqual([])
  })

  test('an answer of every type is sent in its shape', async ($, on) => {
    const env = viewerWorld(on)
    put(env.a, URL_A, rowOf({ id: ID1, type: 'question' }))
    put(env.a, URL_A, rowOf({ id: ID2, type: 'do', notes: true }))
    await turnOn($, env.w)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
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
})

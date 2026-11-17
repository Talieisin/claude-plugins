// The local viewer (#32): one local session on the owner's computer shows the
// open items of every repository's humantray artifact, and answers them.
//
// It only reads the artifacts (a local mod cannot write their databases,
// #31 (b)), by polling every 20 s from a `$.clock` timer. An answer goes to
// the asker as a response envelope with `$.session.send` (envelope.ts); the
// asker's cloud mod writes the row and delivers (receive.ts). The viewer keeps
// each answer in an outbox and sends it again until the store shows it
// delivered, refused, superseded or gone.
//
// `$.store` is one file for the plugin on this computer, shared by every local
// session that loads it, so a lease decides which module instance is the
// viewer: only `/humantray-viewer`, or the viewer session itself starting
// again, takes it; any other session never becomes a viewer by itself.
//
// Nothing here writes a row, publishes, submits a prompt or appends to the
// transcript. Item and answer text stay in the pane.

import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type {
  CardState,
  MetaPage,
  HistoryEntry,
  ItemRow,
  OutboxEntry,
  ResponseEnvelope,
  ResponseRow,
  ViewerAsker,
  ViewerCard,
  ViewerConfig,
  ViewerLead,
  ViewerLease,
  ViewerRepo,
  ViewerTray,
} from '../types'
import {
  type Listed,
  listHumantrays,
  readAnyMeta,
  readFinishedRows,
  readOpenRows,
  readResponses,
  readRowsByIds,
} from './artifact-store'
import { ARTIFACT_URL, makeEnvelope } from './envelope'
import { type Action, buildResponse, historyOf, isLineDue, shortOf } from './items'
import { type RowRead, SESSION_ID, countsAsAnswer, pickArtifact, rowToItem } from './rows'
import { isCloud } from './store-pass'

/** The viewer's tray in `$.state`; register.tsx declares the same atom to draw it. */
const viewerTray = atom({ plugin: 'humantray', key: 'viewer' } as const, null as ViewerTray | null, { shape: 'viewer-1' })

/** How often the viewer reads the store. */
export const TICK_MS = 20_000
/** How long a lease holds without a renewal. */
export const LEASE_MS = 90_000
/** How often the artifacts are looked for again. */
export const FIND_MS = 10 * 60_000
/** History is read every this many ticks (and whenever it is shown). */
export const HISTORY_EVERY = 5
/** Sends after the first: 2, 10 and 30 minutes after it, then every hour. */
export const RESEND_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000] as const
export const RESEND_EVERY_MS = 60 * 60_000
/** After this long with nothing settled, an answer is "not taken" and is no longer sent by itself. */
export const GIVE_UP_MS = 24 * 60 * 60_000
/** A card or a session this old is marked. */
export const OLD_MS = 24 * 60 * 60_000
/** The most title matches whose `meta/page` is read when finding the artifacts. */
export const MAX_LISTED = 60

const CONFIG = 'viewer:config'
const LEASE = 'viewer:lease'
const OUTBOX = 'viewer:outbox'

const token = (bytes: number): string => {
  const random = new Uint8Array(bytes)
  crypto.getRandomValues(random)
  return Array.from(random, b => b.toString(16).padStart(2, '0')).join('')
}

/** This module instance: the lease names it. */
const INSTANCE = token(8)

// Per module instance (a reload starts over, and takes the lease back at session.start).
let holding = false
let timer: { cancel: () => void } | undefined
let ticking: Promise<void> | undefined
let ticks = 0
let lastFind: number | undefined
let artifacts: Array<{ url: string; repo: string }> = []
let found: ViewerTray['found'] = 'none'
/** The last good read of each artifact. */
const reads = new Map<
  string,
  {
    readAt: number
    stale: boolean
    open: Array<{ row: ItemRow; version: number }>
    skipped: number
    responses: Map<string, RowRead<ResponseRow>>
    history: Array<{ row: ItemRow; version: number }>
    /** Rows of outbox items that are no longer open (applied, not yet delivered). */
    closed: Map<string, { row: ItemRow; version: number }>
  }
>()

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// --- the setting, the lease and the outbox, in $.store ----------------------

async function readConfig($: EngineInterface): Promise<ViewerConfig | undefined> {
  try {
    const held = await $.store.get(CONFIG)
    if (!isRecord(held) || typeof held.session !== 'string') return undefined
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
    const config: ViewerConfig = { session: held.session }
    const repos = strings(held.repos)
    const urls = strings(held.urls)
    if (repos !== undefined && repos.length > 0) config.repos = repos
    if (urls !== undefined && urls.length > 0) config.urls = urls
    return config
  } catch {
    return undefined
  }
}

async function readLease($: EngineInterface): Promise<ViewerLease | undefined> {
  try {
    const held = await $.store.get(LEASE)
    if (!isRecord(held) || typeof held.instance !== 'string' || typeof held.session !== 'string' || typeof held.renewed !== 'number') {
      return undefined
    }
    return { instance: held.instance, session: held.session, renewed: held.renewed }
  } catch {
    return undefined
  }
}

export async function readOutbox($: EngineInterface): Promise<Record<string, OutboxEntry>> {
  try {
    const held = await $.store.get(OUTBOX)
    if (!isRecord(held)) return {}
    const out: Record<string, OutboxEntry> = {}
    for (const [key, value] of Object.entries(held)) {
      if (!isRecord(value)) continue
      const e = value as Partial<OutboxEntry>
      if (
        typeof e.artifact === 'string' &&
        typeof e.id === 'string' &&
        typeof e.to === 'string' &&
        typeof e.answer_id === 'string' &&
        typeof e.text === 'string' &&
        typeof e.first === 'number' &&
        typeof e.last === 'number' &&
        typeof e.sends === 'number' &&
        typeof e.delivered === 'boolean'
      ) {
        out[key] = { ...(e as OutboxEntry), short: typeof e.short === 'string' ? e.short : shortOf(e.id) }
      }
    }
    return out
  } catch {
    return {}
  }
}

async function writeOutbox($: EngineInterface, outbox: Record<string, OutboxEntry>): Promise<boolean> {
  try {
    await $.store.set(OUTBOX, outbox)
    return true
  } catch {
    return false
  }
}

export const outboxKey = (artifact: string, id: string): string => `${artifact} ${id}`

/** Whether this module instance holds a fresh lease. */
const holds = (lease: ViewerLease | undefined, now: number): boolean =>
  lease !== undefined && lease.instance === INSTANCE && now - lease.renewed < LEASE_MS

async function takeLease($: EngineInterface, now: number): Promise<boolean> {
  try {
    await $.store.set(LEASE, { instance: INSTANCE, session: await $.session.id(), renewed: now } satisfies ViewerLease)
    return true
  } catch {
    return false
  }
}

/** Whether this module instance is the viewer now. */
export const isViewing = (): boolean => holding

// --- pure rules -------------------------------------------------------------

/** When an entry is next due to be sent: 2, 10 and 30 minutes after the first send, then hourly. */
export function nextSendAt(entry: OutboxEntry): number {
  const after = RESEND_MS[entry.sends - 1]
  return after !== undefined ? entry.first + after : entry.last + RESEND_EVERY_MS
}

/** Whether an entry has gone a day without being settled. */
export const isGivenUp = (entry: OutboxEntry, now: number): boolean => now - entry.first >= GIVE_UP_MS

/** What the store says of one outbox entry. */
export type EntryRead =
  | { kind: 'row'; row: ItemRow; response?: RowRead<ResponseRow> }
  | { kind: 'missing' }
  | { kind: 'unknown' }

/**
 * What becomes of an outbox entry, from the item row (and its response row
 * while open): settled and dropped, or kept with the state its card shows.
 * Settled only on what the store shows: delivered, another answer taken, our
 * answer refused, another answer waiting, or the store's own "no document".
 * A read that failed or a row that cannot be read changes nothing.
 */
export function settleEntry(
  entry: OutboxEntry,
  read: EntryRead,
): { keep: false; toast?: string } | { keep: true; state: Exclude<CardState, 'answerable' | 'page' | 'read-only' | 'not-taken'> } {
  if (read.kind === 'unknown') return { keep: true, state: entry.delivered ? 'sent' : 'not-sent' }
  if (read.kind === 'missing') return { keep: false }
  const row = read.row
  if (row.status !== 'open') {
    if (row.answer_id === entry.answer_id) {
      const due = isLineDue({ status: row.status, type: row.type, notify_on_done: row.notify_on_done } as Parameters<typeof isLineDue>[0])
      return row.delivered || !due ? { keep: false } : { keep: true, state: 'applied' }
    }
    return { keep: false, toast: `${entry.short}: another answer was taken first` }
  }
  if (row.response_refused?.answer_id === entry.answer_id) return { keep: false }
  const response = read.response
  if (response !== undefined && countsAsAnswer(response, row)) {
    return response.ok.answer_id === entry.answer_id ? { keep: true, state: 'stored' } : { keep: false }
  }
  return { keep: true, state: entry.delivered ? 'sent' : 'not-sent' }
}

/** When a session was last active, from its rows: the latest of their changes. */
export function lastActive(rows: readonly ItemRow[]): number {
  let latest = 0
  for (const row of rows) {
    for (const at of [row.updated, row.response_at, row.delivered_at, row.response_refused?.at]) {
      if (typeof at === 'number' && Number.isFinite(at) && at > latest) latest = at
    }
  }
  return latest
}

/** Whether a repository the person named is this one: `owner/name` for GitHub, or the whole value, case aside. */
export function repoMatches(wanted: string, repo: string): boolean {
  const a = wanted.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.git$/, '')
  const b = repo.toLowerCase()
  return a === b || `github.com/${a}` === b
}

// --- finding the artifacts --------------------------------------------------

/**
 * The artifacts to read: the links given, and, unless only links were given,
 * every `humantray: ` artifact whose `meta/page` qualifies, one per
 * repository (the earliest, as every asker picks), filtered by the
 * repositories given.
 */
async function discover($: EngineInterface, config: ViewerConfig): Promise<{ list: Array<{ url: string; repo: string }>; found: ViewerTray['found'] }> {
  const byRepo = new Map<string, Array<{ url: string; meta: MetaPage }>>()
  const add = (url: string, meta: MetaPage) => {
    const key = meta.repo.toLowerCase()
    byRepo.set(key, [...(byRepo.get(key) ?? []), { url, meta }])
  }
  let readable = true
  for (const url of config.urls ?? []) {
    const meta = await readAnyMeta($, url)
    if (meta.kind === 'ok' && meta.meta !== undefined) add(url, meta.meta)
  }
  if (config.urls === undefined || config.repos !== undefined) {
    const listed = await listHumantrays($)
    if (listed.kind === 'ok') {
      for (const each of listed.listed.slice(0, MAX_LISTED) as Listed[]) {
        const meta = await readAnyMeta($, each.url)
        if (meta.kind === 'ok' && meta.meta !== undefined) add(each.url, meta.meta)
      }
    } else readable = false
  }
  const list: Array<{ url: string; repo: string }> = []
  for (const candidates of byRepo.values()) {
    const chosen = pickArtifact(candidates)
    if (chosen === undefined) continue
    const given = config.urls?.includes(chosen.url) === true
    if (!given && config.repos !== undefined && !config.repos.some(wanted => repoMatches(wanted, chosen.meta.repo))) continue
    list.push({ url: chosen.url, repo: chosen.meta.repo })
  }
  // Links given are shown even when another artifact of the same repository is older.
  for (const url of config.urls ?? []) {
    if (list.some(each => each.url === url)) continue
    const candidates = [...byRepo.values()].flat().find(each => each.url === url)
    if (candidates !== undefined) list.push({ url, repo: candidates.meta.repo })
  }
  list.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0))
  return { list, found: list.length > 0 ? 'ok' : readable ? 'none' : 'unreadable' }
}

// --- the tick ---------------------------------------------------------------

/** Reads one artifact; on failure keeps the last good read, marked stale. */
async function readArtifact($: EngineInterface, url: string, outboxIds: string[], history: boolean, now: number): Promise<boolean> {
  const before = reads.get(url)
  const keepStale = () => {
    if (before !== undefined) before.stale = true
    return false
  }
  const open = await readOpenRows($, url)
  if (open.kind !== 'ok') return keepStale()
  const openIds = open.rows.map(each => each.row.id)
  const ids = [...new Set([...openIds, ...outboxIds])]
  const responses = ids.length > 0 ? await readResponses($, url, ids) : { kind: 'ok' as const, rows: new Map<string, RowRead<ResponseRow>>() }
  if (responses.kind !== 'ok') return keepStale()
  const closed = new Map<string, { row: ItemRow; version: number }>()
  const notOpen = outboxIds.filter(id => !openIds.includes(id))
  let missing = new Set<string>()
  let unreadable = new Set<string>()
  if (notOpen.length > 0) {
    const byId = await readRowsByIds($, url, notOpen)
    if (byId.kind !== 'ok') return keepStale()
    for (const [id, each] of byId.rows) closed.set(id, each)
    missing = byId.missing
    unreadable = byId.unreadable
  }
  let historyRows = before?.history ?? []
  if (history) {
    const finished = await readFinishedRows($, url, 200)
    if (finished.kind === 'ok') historyRows = finished.rows
  }
  reads.set(url, { readAt: now, stale: false, open: open.rows, skipped: open.skipped, responses: responses.rows, history: historyRows, closed })
  missingIds.set(url, missing)
  unreadableIds.set(url, unreadable)
  return true
}

const missingIds = new Map<string, Set<string>>()
const unreadableIds = new Map<string, Set<string>>()

/** What the store says of an entry, from the artifact's last read (unknown when it was not read this tick). */
function entryRead(entry: OutboxEntry, fresh: boolean): EntryRead {
  const read = reads.get(entry.artifact)
  if (read === undefined || !fresh || read.stale) return { kind: 'unknown' }
  if (unreadableIds.get(entry.artifact)?.has(entry.id) === true) return { kind: 'unknown' }
  const open = read.open.find(each => each.row.id === entry.id)
  if (open !== undefined) return { kind: 'row', row: open.row, response: read.responses.get(entry.id) }
  const closed = read.closed.get(entry.id)
  if (closed !== undefined) return { kind: 'row', row: closed.row }
  if (missingIds.get(entry.artifact)?.has(entry.id) === true) return { kind: 'missing' }
  return { kind: 'unknown' }
}

/** Sends one entry's envelope; records how it went. */
async function sendEntry($: EngineInterface, entry: OutboxEntry, now: number): Promise<OutboxEntry> {
  let delivered = false
  let reason: string | undefined
  try {
    const sent = await $.session.send({ to: { sessionId: entry.to }, text: entry.text })
    delivered = sent.isDelivered
    if (!sent.isDelivered) reason = sent.reason
  } catch (error) {
    reason = String(error)
  }
  const next: OutboxEntry = { ...entry, last: now, sends: entry.sends + 1, delivered }
  if (reason !== undefined) next.reason = reason
  else delete next.reason
  return next
}

/**
 * One tick: renews the lease (or stops, when another instance holds it),
 * finds the artifacts when due, reads each, settles and sends the outbox,
 * and rebuilds what the pane draws.
 */
export async function tick($: EngineInterface, options: { history?: boolean; find?: boolean } = {}): Promise<void> {
  if (ticking !== undefined) return ticking
  ticking = (async () => {
    try {
      await tickOnce($, options)
    } catch {
      // A failed tick changes nothing; the next one tries again.
    } finally {
      ticking = undefined
    }
  })()
  return ticking
}

async function tickOnce($: EngineInterface, options: { history?: boolean; find?: boolean }): Promise<void> {
  if (!holding) return
  const now = await $.clock.now()
  const lease = await readLease($)
  if (!holds(lease, now)) {
    // Another instance took it (or this one's lapsed while another holds it): stop.
    if (lease !== undefined && lease.instance !== INSTANCE && now - lease.renewed < LEASE_MS) return stop($)
    if (!(await takeLease($, now))) return
  } else if (!(await takeLease($, now))) return
  const config = await readConfig($)
  if (config === undefined) return stop($)
  // A /clear keeps the instance: the viewer's session is the current one.
  const me = await $.session.id()
  if (config.session !== me) {
    try {
      await $.store.set(CONFIG, { ...config, session: me })
    } catch {
      // Kept as it was; the lease still names this instance.
    }
  }
  if (options.find === true || lastFind === undefined || now - lastFind >= FIND_MS) {
    lastFind = now
    const discovered = await discover($, config)
    if (discovered.found !== 'unreadable' || artifacts.length === 0) {
      artifacts = discovered.list
      found = discovered.found
    }
  }
  ticks += 1
  const history = options.history === true || ticks % HISTORY_EVERY === 1
  let outbox = await readOutbox($)
  const fresh = new Set<string>()
  for (const { url } of artifacts) {
    const ids = Object.values(outbox)
      .filter(entry => entry.artifact === url)
      .map(entry => entry.id)
    if (await readArtifact($, url, ids, history, now)) fresh.add(url)
  }
  // Settle, then send what is due. The outbox is read again so that an answer
  // given during this tick is not lost.
  const states = new Map<string, CardState>()
  const toasts: string[] = []
  const settled: string[] = []
  const due: OutboxEntry[] = []
  for (const [key, entry] of Object.entries(outbox)) {
    const read = entryRead(entry, fresh.has(entry.artifact))
    const verdict = settleEntry(entry, read)
    if (!verdict.keep) {
      settled.push(key)
      if (verdict.toast !== undefined) toasts.push(verdict.toast)
      continue
    }
    if (isGivenUp(entry, now)) {
      states.set(key, 'not-taken')
      continue
    }
    states.set(key, verdict.state)
    if (now >= nextSendAt(entry)) due.push(entry)
  }
  const sent: OutboxEntry[] = []
  for (const entry of due) {
    // Checked again just before each send: another instance may have taken over.
    if (!holds(await readLease($), await $.clock.now())) break
    sent.push(await sendEntry($, entry, await $.clock.now()))
  }
  if (settled.length > 0 || sent.length > 0) {
    outbox = await readOutbox($)
    for (const key of settled) delete outbox[key]
    for (const entry of sent) {
      const key = outboxKey(entry.artifact, entry.id)
      if (outbox[key]?.answer_id === entry.answer_id) outbox[key] = entry
    }
    await writeOutbox($, outbox)
  }
  for (const text of toasts) await toast($, text)
  await rebuild($, outbox, states, now)
}

async function toast($: EngineInterface, text: string) {
  try {
    if ((await $.session.surfaces()).length > 0) await $.ui.toast(text)
  } catch {
    // Best effort.
  }
}

/** Rebuilds the viewer's tray from the last reads and the outbox. */
async function rebuild($: EngineInterface, outbox: Record<string, OutboxEntry>, states: Map<string, CardState>, now: number) {
  const me = await $.session.id()
  const repos: ViewerRepo[] = []
  const finished: ItemRow[] = []
  let answerable = 0
  for (const { url, repo } of artifacts) {
    const read = reads.get(url)
    const leads = new Map<string, ViewerLead>()
    const cardsOf = (row: ItemRow, version: number, state: CardState, reason?: string): ViewerCard => {
      const card: ViewerCard = { url, row, version, state, old: now - row.created >= OLD_MS }
      if (reason !== undefined) card.reason = reason
      return card
    }
    const place = (card: ViewerCard) => {
      const row = card.row
      const leadKey = row.lead_session_id ?? ''
      const lead = leads.get(leadKey) ?? { lead: row.lead_session_id, title: null, askers: [] }
      leads.set(leadKey, lead)
      let asker = lead.askers.find(each => each.session_id === row.session_id)
      if (asker === undefined) {
        asker = { session_id: row.session_id, title: row.session_title, link: SESSION_ID.test(row.session_id), lastActive: 0, cards: [] }
        lead.askers.push(asker)
      }
      asker.cards.push(card)
      if (row.session_id === row.lead_session_id && row.session_title !== null) lead.title = row.session_title
    }
    for (const { row, version } of read?.open ?? []) {
      const key = outboxKey(url, row.id)
      const entry = outbox[key]
      let state: CardState
      let reason: string | undefined
      if (entry !== undefined) {
        state = states.get(key) ?? (entry.delivered ? 'sent' : 'not-sent')
        if (state === 'not-sent' && entry.reason !== undefined) reason = entry.reason
      } else if (row.envelope !== 1) {
        state = 'read-only'
      } else {
        const response = read?.responses.get(row.id)
        if (response !== undefined && countsAsAnswer(response, row)) state = 'page'
        else {
          state = 'answerable'
          if (row.response_refused !== undefined) reason = row.response_refused.reason
        }
      }
      if (state === 'answerable') answerable += 1
      place(cardsOf(row, version, state, reason))
    }
    // Our answers applied but not yet delivered, while we keep sending.
    for (const [id, each] of read?.closed ?? []) {
      if (states.get(outboxKey(url, id)) === 'applied') place(cardsOf(each.row, each.version, 'applied'))
    }
    const all = [...(read?.open ?? []), ...(read?.history ?? [])].map(each => each.row)
    for (const lead of leads.values()) {
      for (const asker of lead.askers) asker.lastActive = lastActive(all.filter(row => row.session_id === asker.session_id))
      lead.askers.sort((a, b) => b.lastActive - a.lastActive)
    }
    finished.push(...(read?.history ?? []).map(each => each.row))
    repos.push({
      repo,
      url,
      readAt: read?.readAt ?? null,
      stale: read?.stale ?? true,
      skipped: read?.skipped ?? 0,
      leads: [...leads.values()],
    })
  }
  const history: HistoryEntry[] = historyOf(
    { version: 1, items: finished.map(row => rowToItem(row, me, '', 0)), sessions: {} },
    '',
    me,
    now,
  ).map(entry => ({ ...entry, isMine: true }))
  const tray: ViewerTray = { repos, history, answerable, found, at: now }
  await update($, viewerTray, () => tray)
}

// --- starting, stopping, answering ------------------------------------------

function startTimer($: EngineInterface) {
  if (timer !== undefined) return
  try {
    timer = $.clock.every(TICK_MS, () => {
      void tick($)
    })
  } catch {
    timer = undefined
  }
}

async function stop($: EngineInterface) {
  holding = false
  timer?.cancel()
  timer = undefined
  reads.clear()
  artifacts = []
  lastFind = undefined
  await update($, viewerTray, () => null).catch(() => undefined)
}

/**
 * At session.start: the viewer session itself starting again (a restart, a
 * resume, a reload) takes the lease back when it is stale or already its
 * own. No other session ever becomes the viewer by itself.
 */
export async function resumeViewer($: EngineInterface): Promise<boolean> {
  if (await isCloud($)) return false
  const config = await readConfig($)
  if (config === undefined) return false
  const now = await $.clock.now()
  const lease = await readLease($)
  const me = await $.session.id()
  const mine = lease !== undefined && (lease.instance === INSTANCE || (lease.session === me && config.session === me))
  const stale = lease === undefined || now - lease.renewed >= LEASE_MS
  if (!(holds(lease, now) || (stale && config.session === me) || (mine && stale))) return false
  if (!(await takeLease($, now))) return false
  holding = true
  startTimer($)
  await tick($, { find: true, history: true })
  return holding
}

/**
 * `/humantray-viewer [off | <owner/repo or host/path> … | <artifact link> …]`.
 * Local sessions only. Its reply names repositories and counts, never item text.
 */
export async function viewerCommand($: EngineInterface, args: string): Promise<string> {
  if (await isCloud($)) return 'humantray: the viewer runs only in a local session, on the computer that stays on.'
  const words = args.trim().split(/\s+/).filter(word => word !== '')
  if (words.length === 1 && words[0]?.toLowerCase() === 'off') {
    const lease = await readLease($)
    try {
      if (lease === undefined || lease.instance === INSTANCE) await $.store.delete(LEASE)
      await $.store.delete(CONFIG)
    } catch {
      // Stopping here is what matters.
    }
    await stop($)
    return 'humantray viewer: off. Answers still waiting stay in the outbox until the viewer is on again.'
  }
  const urls = words.filter(word => ARTIFACT_URL.test(word))
  const repos = words.filter(word => !ARTIFACT_URL.test(word))
  const bad = repos.filter(word => !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/.test(word))
  if (bad.length > 0) return `humantray viewer: not a repository or an artifact link: ${bad.join(', ')}`
  const config: ViewerConfig = { session: await $.session.id() }
  if (repos.length > 0) config.repos = repos
  if (urls.length > 0) config.urls = urls
  const now = await $.clock.now()
  try {
    await $.store.set(CONFIG, config)
  } catch {
    return 'humantray viewer: the setting could not be saved.'
  }
  if (!(await takeLease($, now))) return 'humantray viewer: could not take over as the viewer.'
  holding = true
  startTimer($)
  await tick($, { find: true, history: true })
  if (!holding) return 'humantray viewer: another session took over as the viewer.'
  if (found === 'unreadable') {
    return 'humantray viewer: on, but the list of artifacts could not be read. Give the page link instead: /humantray-viewer <link to the "humantray: owner/repo" page>.'
  }
  if (artifacts.length === 0) return 'humantray viewer: on, but no humantray page was found for those repositories.'
  const names = artifacts.map(each => each.repo).join(', ')
  return `humantray viewer: on for ${artifacts.length} ${artifacts.length === 1 ? 'repository' : 'repositories'}: ${names}. It reads every ${TICK_MS / 1000} s.`
}

/** What answering a viewer card came to: an error to show on the card, or sent. */
export type ViewerAnswered = { error: string } | { sent: true }

/**
 * Answers one card: builds the response as the pane would, writes the
 * outbox entry, then sends the envelope once. One answer per item at a time.
 */
export async function viewerAnswer(
  $: EngineInterface,
  card: ViewerCard,
  draft: Parameters<typeof buildResponse>[1],
  action: Action,
): Promise<ViewerAnswered> {
  if (!holding) return { error: 'This session is no longer the viewer.' }
  const row = card.row
  if (row.status !== 'open' || card.state !== 'answerable') return { error: 'This item cannot be answered here now.' }
  if (row.envelope !== 1) return { error: "This session's humantray cannot take answers from the viewer: answer on the page." }
  if (!SESSION_ID.test(row.session_id)) return { error: 'This item has no session to send the answer to.' }
  const key = outboxKey(card.url, row.id)
  const outbox = await readOutbox($)
  if (outbox[key] !== undefined) return { error: 'An answer to this item is already on its way.' }
  const me = await $.session.id()
  const item = rowToItem(row, me, card.url, card.version)
  const built = buildResponse(item, draft, action)
  if (built.error !== undefined) return { error: built.error }
  const now = await $.clock.now()
  const envelope: ResponseEnvelope = {
    schema: 1,
    id: row.id,
    answer_id: token(12),
    response: built.ok.response,
    status: built.ok.status as ResponseEnvelope['status'],
    answered_at: now,
    seen: { bumps: row.bumps, updated: row.updated },
    by: 'viewer',
    to: row.session_id,
    artifact: card.url,
  }
  const text = makeEnvelope(envelope)
  if (text === undefined) return { error: 'This answer is too long to send from the viewer: answer on the page.' }
  const entry: OutboxEntry = {
    artifact: card.url,
    id: row.id,
    short: row.short,
    to: row.session_id,
    answer_id: envelope.answer_id,
    text,
    first: now,
    last: now,
    sends: 0,
    delivered: false,
  }
  // Written before the send, so a send is never made that the outbox does not hold.
  if (!(await writeOutbox($, { ...outbox, [key]: entry }))) return { error: 'The answer could not be kept: nothing was sent.' }
  const sent = await sendEntry($, entry, now)
  const after = await readOutbox($)
  if (after[key]?.answer_id === entry.answer_id) {
    after[key] = sent
    await writeOutbox($, after)
  }
  await rebuild($, after, new Map([[key, sent.delivered ? 'sent' : 'not-sent']]), now)
  return { sent: true }
}

/** Send again: an answer "not taken" starts its schedule over. */
export async function sendAgain($: EngineInterface, url: string, id: string): Promise<void> {
  const key = outboxKey(url, id)
  const outbox = await readOutbox($)
  const entry = outbox[key]
  if (entry === undefined || !holding) return
  const now = await $.clock.now()
  const sent = await sendEntry($, { ...entry, first: now, sends: 0 }, now)
  outbox[key] = sent
  await writeOutbox($, outbox)
  await tick($)
}

/** Withdraws an answer still waiting, so the card can be answered again (Answer differently). */
export async function withdraw($: EngineInterface, url: string, id: string): Promise<void> {
  const outbox = await readOutbox($)
  delete outbox[outboxKey(url, id)]
  await writeOutbox($, outbox)
  await tick($)
}

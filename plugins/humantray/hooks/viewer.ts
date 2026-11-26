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
// again, takes it; any other session never becomes a viewer by itself. The
// lease is read again, and must hold, before every outbox write and every
// send. `$.store` has no compare-and-set, so two `/humantray-viewer` commands
// within one store round trip of each other can still both believe they hold
// it until the next tick; each send checks the lease again just before.
//
// Every outbox write changes one entry: the outbox is read again just before,
// and only that entry is replaced. A failed outbox read fails closed: nothing
// is answered, settled or sent until it reads again.
//
// Nothing here writes a row, publishes, submits a prompt or appends to the
// transcript. Item and answer text stay in the pane.

import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type {
  CardState,
  HistoryEntry,
  ItemRow,
  MetaPage,
  OutboxEntry,
  ResponseEnvelope,
  ResponseRow,
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
  withDeadline,
} from './artifact-store'
import { ARTIFACT_URL, makeEnvelope } from './envelope'
import { type Action, buildResponse, cleanTitle, historyOf, isLineDue, mirroredLock, shortOf } from './items'
import { type RowRead, SESSION_ID, countsAsAnswer, isTitleFor, pickArtifact, rowToItem } from './rows'
import { isCloud } from './store-pass'

/** The viewer's tray in `$.state`; register.tsx declares the same atom to draw it. */
// viewer-4: History entries carry who asked (#75); a tray cached by an earlier version reads as null.
const viewerTray = atom({ plugin: 'humantray', key: 'viewer' } as const, null as ViewerTray | null, { shape: 'viewer-4' })

/** How often the viewer reads the store. */
export const TICK_MS = 20_000
/** How long a lease holds without a renewal. */
export const LEASE_MS = 90_000
/** How often the artifacts are looked for again. */
export const FIND_MS = 10 * 60_000
/** History is read every this many ticks (and whenever it is shown). */
export const HISTORY_EVERY = 5
/**
 * The wait after each send before the next: 2, 8 and 20 minutes (so 2, 10
 * and 30 minutes after the first, when on time), then an hour. Measured from
 * the last send, so an entry that fell behind is not sent on every tick.
 */
export const RESEND_GAPS_MS = [2 * 60_000, 8 * 60_000, 20 * 60_000] as const
export const RESEND_EVERY_MS = 60 * 60_000
/** After this long with nothing settled, an answer is "not taken" and is no longer sent by itself. */
export const GIVE_UP_MS = 24 * 60 * 60_000
/** A card or a session this old is marked. */
export const OLD_MS = 24 * 60 * 60_000
/**
 * The most title matches whose `meta/page` is read when finding the artifacts,
 * after filtering by the repositories named. More than this reads as
 * "could not be read", never as "none".
 */
export const MAX_LISTED = 200
/** How long one send may take before it counts as failed. */
export const SEND_MS = 30_000

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

type TickOptions = { history?: boolean; find?: boolean }
type Read = {
  readAt: number
  stale: boolean
  open: Array<{ row: ItemRow; version: number }>
  skipped: number
  responses: Map<string, RowRead<ResponseRow>>
  /** Rows of outbox items that are no longer open (applied, not yet delivered). */
  closed: Map<string, { row: ItemRow; version: number }>
  /** Outbox ids the store answered without (its own "no such document"), and ids whose row cannot be read. */
  missing: Set<string>
  unreadable: Set<string>
  history: Array<{ row: ItemRow; version: number }>
  /** When History was last read whole, or null if never. */
  historyAt: number | null
  historyStale: boolean
}

// Per module instance. A new instance (a restart, a reload) takes the lease
// back at session.start when the viewer session is this session.
let holding = false
/** Rises at every stop, so a tick that began before it writes nothing after. */
let epoch = 0
let timer: { cancel: () => void } | undefined
let ticking: Promise<void> | undefined
let queued: TickOptions | undefined
let ticks = 0
let lastFind: number | undefined
let artifacts: Array<{ url: string; repo: string }> = []
let found: ViewerTray['found'] = 'none'
/** The last good read of each artifact. */
const reads = new Map<string, Read>()
/** The outbox as last read whole, for drawing while a read fails. */
let lastOutbox: Record<string, OutboxEntry> = {}
/** The card states the last tick settled on, by outbox key. */
let lastStates = new Map<string, CardState>()

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

/** The outbox, or undefined when it could not be read: every caller then fails closed. */
export async function readOutbox($: EngineInterface): Promise<Record<string, OutboxEntry> | undefined> {
  let held: unknown
  try {
    held = await $.store.get(OUTBOX)
  } catch {
    return undefined
  }
  if (held === undefined || held === null) return {}
  if (!isRecord(held)) return undefined
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
}

/**
 * Changes one outbox entry: reads the outbox again just before, applies
 * `change` to that entry alone (undefined removes it; returning the same
 * value leaves it), and writes. Every other entry is kept as read. False when
 * the outbox could not be read or written.
 */
async function changeEntry(
  $: EngineInterface,
  key: string,
  change: (current: OutboxEntry | undefined) => OutboxEntry | undefined | 'keep',
): Promise<boolean> {
  // One change at a time in this instance, so two presses cannot both read the outbox before either writes.
  const run = outboxQueue.then(() => changeNow($, key, change))
  outboxQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** The outbox changes of this instance, one after another. */
let outboxQueue: Promise<void> = Promise.resolve()

async function changeNow(
  $: EngineInterface,
  key: string,
  change: (current: OutboxEntry | undefined) => OutboxEntry | undefined | 'keep',
): Promise<boolean> {
  const outbox = await readOutbox($)
  if (outbox === undefined) return false
  const next = change(outbox[key])
  if (next === 'keep') return true
  if (next === undefined) delete outbox[key]
  else outbox[key] = next
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

/** Whether this module instance holds the lease now, read again from the store. */
async function stillHolds($: EngineInterface): Promise<boolean> {
  if (!holding) return false
  return holds(await readLease($), await $.clock.now())
}

/**
 * Writes the lease for this instance, then reads it back: `held` when it names
 * this instance, `other` when a successful read-back names another one, and
 * `failed` when the write or the read-back failed (tried again next tick).
 */
async function takeLease($: EngineInterface, now: number): Promise<'held' | 'other' | 'failed'> {
  try {
    await $.store.set(LEASE, { instance: INSTANCE, session: await $.session.id(), renewed: now } satisfies ViewerLease)
  } catch {
    return 'failed'
  }
  const back = await readLease($)
  if (back === undefined) return 'failed'
  return holds(back, now) ? 'held' : 'other'
}

/** The last lease write failed: shown in the pane until one succeeds. */
let leaseFailed = false

/** Whether this module instance is the viewer now. */
export const isViewing = (): boolean => holding

// --- pure rules -------------------------------------------------------------

/**
 * When an entry is next due to be sent: at once when it was never sent (kept,
 * then the process ended before the send); otherwise 2, 8 and 20 minutes after
 * the last send, then an hour after it.
 */
export function nextSendAt(entry: OutboxEntry): number {
  if (entry.sends === 0) return Number.NEGATIVE_INFINITY
  return entry.last + (RESEND_GAPS_MS[entry.sends - 1] ?? RESEND_EVERY_MS)
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
  // Withdrawn by its session (#82): our answer will never be taken.
  if (row.withdrawn !== undefined) return { keep: false, toast: `${entry.short}: withdrawn by its session` }
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

/** A repository the person named, as a `repo` value: `owner/name` is GitHub's; anything with a host is kept. */
export function repoValueOf(wanted: string): string {
  const a = wanted.trim().replace(/^https?:\/\//, '').replace(/\.git$/, '')
  const first = a.split('/')[0] ?? ''
  return a.split('/').length === 2 && !first.includes('.') ? `github.com/${a}` : a
}

/** Whether a repository the person named is this one, case aside. */
export function repoMatches(wanted: string, repo: string): boolean {
  return repoValueOf(wanted).toLowerCase() === repo.toLowerCase()
}

// --- finding the artifacts --------------------------------------------------

/**
 * The artifacts to read: the links given, and, unless only links were given,
 * every `humantray: ` artifact whose `meta/page` qualifies, one per
 * repository (the earliest, as every asker picks). Repositories named filter
 * the listing by title before anything is read. Any read that fails, or a
 * listing past MAX_LISTED, makes the find "unreadable": the caller then keeps
 * the set it had.
 */
async function discover($: EngineInterface, config: ViewerConfig): Promise<{ list: Array<{ url: string; repo: string }>; found: ViewerTray['found'] }> {
  const byRepo = new Map<string, Array<{ url: string; meta: MetaPage }>>()
  const add = (url: string, meta: MetaPage) => {
    const key = meta.repo.toLowerCase()
    byRepo.set(key, [...(byRepo.get(key) ?? []), { url, meta }])
  }
  let readable = true
  const given = new Map<string, MetaPage>()
  for (const url of config.urls ?? []) {
    const meta = await readAnyMeta($, url)
    if (meta.kind !== 'ok') readable = false
    else if (meta.meta !== undefined) {
      add(url, meta.meta)
      given.set(url, meta.meta)
    }
  }
  if (config.urls === undefined || config.repos !== undefined) {
    const listed = await listHumantrays($)
    if (listed.kind !== 'ok') readable = false
    else {
      const wanted = config.repos?.map(repoValueOf)
      const candidates: Listed[] =
        wanted === undefined ? listed.listed : listed.listed.filter(each => wanted.some(repo => isTitleFor(each.title, repo)))
      if (candidates.length > MAX_LISTED) readable = false
      else {
        for (const each of candidates) {
          if ([...given.keys()].includes(each.url)) continue
          const meta = await readAnyMeta($, each.url)
          if (meta.kind !== 'ok') readable = false
          else if (meta.meta !== undefined) add(each.url, meta.meta)
        }
      }
    }
  }
  const list: Array<{ url: string; repo: string }> = []
  for (const candidates of byRepo.values()) {
    const chosen = pickArtifact(candidates)
    if (chosen === undefined) continue
    if (!given.has(chosen.url) && config.repos !== undefined && !config.repos.some(wanted => repoMatches(wanted, chosen.meta.repo))) continue
    list.push({ url: chosen.url, repo: chosen.meta.repo })
  }
  // Links given are shown even when another artifact of the same repository is older.
  for (const [url, meta] of given) if (!list.some(each => each.url === url)) list.push({ url, repo: meta.repo })
  list.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0))
  return { list, found: !readable ? 'unreadable' : list.length > 0 ? 'ok' : 'none' }
}

// --- the tick ---------------------------------------------------------------

/** Reads one artifact; on failure keeps the last good read, marked stale. History's freshness is its own. */
async function readArtifact($: EngineInterface, url: string, outboxIds: string[], history: boolean, now: number): Promise<boolean> {
  const before = reads.get(url)
  const fail = () => {
    if (before !== undefined) before.stale = true
    return false
  }
  const open = await readOpenRows($, url)
  if (open.kind !== 'ok') return fail()
  const openIds = open.rows.map(each => each.row.id)
  const ids = [...new Set([...openIds, ...outboxIds])]
  const responses = ids.length > 0 ? await readResponses($, url, ids) : { kind: 'ok' as const, rows: new Map<string, RowRead<ResponseRow>>() }
  if (responses.kind !== 'ok') return fail()
  const closed = new Map<string, { row: ItemRow; version: number }>()
  const notOpen = outboxIds.filter(id => !openIds.includes(id))
  let missing = new Set<string>()
  let unreadable = new Set<string>()
  if (notOpen.length > 0) {
    const byId = await readRowsByIds($, url, notOpen)
    if (byId.kind !== 'ok') return fail()
    for (const [id, each] of byId.rows) closed.set(id, each)
    missing = byId.missing
    unreadable = byId.unreadable
  }
  let historyRows = before?.history ?? []
  let historyAt = before?.historyAt ?? null
  let historyStale = before?.historyStale ?? true
  if (history) {
    const finished = await readFinishedRows($, url, 200)
    if (finished.kind === 'ok') {
      historyRows = finished.rows
      historyAt = now
      historyStale = false
    } else historyStale = true
  }
  reads.set(url, { readAt: now, stale: false, open: open.rows, skipped: open.skipped, responses: responses.rows, closed, missing, unreadable, history: historyRows, historyAt, historyStale })
  return true
}

/** What the store says of an entry, from its artifact's read this tick (unknown when it was not read whole this tick). */
function entryRead(entry: OutboxEntry, fresh: boolean): EntryRead {
  const read = reads.get(entry.artifact)
  if (read === undefined || !fresh || read.stale) return { kind: 'unknown' }
  if (read.unreadable.has(entry.id)) return { kind: 'unknown' }
  const open = read.open.find(each => each.row.id === entry.id)
  if (open !== undefined) return { kind: 'row', row: open.row, response: read.responses.get(entry.id) }
  // The closed row, or History's copy of it when that one is further on (a
  // higher version): History reads delivered rows too, so an entry is settled
  // from whichever read saw the row last.
  const closed = read.closed.get(entry.id)
  const finished = read.history.find(each => each.row.id === entry.id)
  const latest = closed === undefined ? finished : finished !== undefined && finished.version > closed.version ? finished : closed
  if (latest !== undefined) return { kind: 'row', row: latest.row }
  if (read.missing.has(entry.id)) return { kind: 'missing' }
  return { kind: 'unknown' }
}

/** Sends one envelope, at most SEND_MS; a time-out or a throw is a failed send. */
async function sendText($: EngineInterface, to: string, text: string): Promise<{ delivered: boolean; reason?: string }> {
  try {
    const sent = await withDeadline($, $.session.send({ to: { sessionId: to }, text }), SEND_MS)
    if (sent === 'timeout') return { delivered: false, reason: `no answer within ${SEND_MS / 1000} s` }
    return sent.isDelivered ? { delivered: true } : { delivered: false, reason: sent.reason }
  } catch (error) {
    return { delivered: false, reason: String(error) }
  }
}

/** The entry after a send of it, at `now`. */
function afterSend(entry: OutboxEntry, sent: { delivered: boolean; reason?: string }, now: number): OutboxEntry {
  const next: OutboxEntry = { ...entry, last: now, sends: entry.sends + 1, delivered: sent.delivered }
  if (sent.reason !== undefined) next.reason = sent.reason
  else delete next.reason
  return next
}

/**
 * Sends an entry's envelope, only while this instance still holds the lease
 * (read again just before), and records how it went on that entry alone, if
 * it is still the same answer. False when the lease no longer holds.
 */
async function sendEntry($: EngineInterface, entry: OutboxEntry): Promise<boolean> {
  // One send of an answer at a time: a tick does not send again what is still in flight.
  const flight = `${outboxKey(entry.artifact, entry.id)} ${entry.answer_id}`
  if (inFlight.has(flight)) return true
  // Claimed before the lease check, so two sends started together cannot both pass it.
  inFlight.add(flight)
  try {
    if (!(await stillHolds($))) return false
    // Decided on the entry as it is now, not on the copy a tick read before its
    // store reads: one sent meanwhile is not due again yet, and a settled or
    // replaced one is not sent at all.
    const outbox = await readOutbox($)
    const current = outbox?.[outboxKey(entry.artifact, entry.id)]
    if (current === undefined || current.answer_id !== entry.answer_id) return true
    if ((await $.clock.now()) < nextSendAt(current)) return true
    const sent = await sendText($, current.to, current.text)
    const now = await $.clock.now()
    await changeEntry($, outboxKey(entry.artifact, entry.id), current =>
      current?.answer_id === entry.answer_id ? afterSend(current, sent, now) : 'keep',
    )
  } finally {
    inFlight.delete(flight)
  }
  return true
}

/** The answers being sent now by this instance, by outbox key and answer id. */
const inFlight = new Set<string>()

/**
 * One tick: renews the lease (or stops, when another instance holds it),
 * finds the artifacts when due, reads each, settles and sends the outbox,
 * and rebuilds what the pane draws. A tick asked for while one runs is not
 * dropped: its options are kept and one more tick runs after, so a
 * `/humantray-viewer` change or History's read always takes effect.
 */
export function tick($: EngineInterface, options: TickOptions = {}): Promise<void> {
  if (ticking !== undefined) {
    queued = { history: (queued?.history ?? false) || options.history === true, find: (queued?.find ?? false) || options.find === true }
    return ticking
  }
  ticking = (async () => {
    try {
      let next: TickOptions | undefined = options
      while (next !== undefined) {
        queued = undefined
        try {
          await tickOnce($, next)
        } catch {
          // A failed tick changes nothing; the next one tries again.
        }
        next = queued
      }
    } finally {
      ticking = undefined
    }
  })()
  return ticking
}

async function tickOnce($: EngineInterface, options: TickOptions): Promise<void> {
  if (!holding) return
  const began = epoch
  /** Whether this tick may still change anything: the viewer was not stopped since it began. */
  const live = () => holding && epoch === began
  const now = await $.clock.now()
  const lease = await readLease($)
  // Another instance holds it fresh: stop. Otherwise renew it (or take back this instance's own, lapsed).
  if (!holds(lease, now) && lease !== undefined && lease.instance !== INSTANCE && now - lease.renewed < LEASE_MS) return stop($)
  const taken = await takeLease($, now)
  if (taken === 'other') return stop($)
  leaseFailed = taken === 'failed'
  if (leaseFailed && !holds(await readLease($), now)) {
    // The renewal failed and the lease no longer holds: send nothing this tick, say so, try again next tick.
    if (live()) await rebuild($, lastOutbox, lastStates, now)
    return
  }
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
    if (!live()) return
    // An unreadable find keeps the set it had, unless there is none yet.
    if (discovered.found !== 'unreadable' || artifacts.length === 0) artifacts = discovered.list
    found = discovered.found
  }
  ticks += 1
  const history = options.history === true || ticks % HISTORY_EVERY === 1
  const outbox = await readOutbox($)
  const fresh = new Set<string>()
  for (const { url } of artifacts) {
    const ids = Object.values(outbox ?? lastOutbox)
      .filter(entry => entry.artifact === url)
      .map(entry => entry.id)
    if (await readArtifact($, url, ids, history, now)) fresh.add(url)
  }
  if (!live()) return
  if (outbox === undefined) {
    // The outbox could not be read: settle nothing, send nothing; draw as last known.
    await rebuild($, lastOutbox, lastStates, now)
    return
  }
  const states = new Map<string, CardState>()
  const toasts: string[] = []
  for (const [key, entry] of Object.entries(outbox)) {
    const verdict = settleEntry(entry, entryRead(entry, fresh.has(entry.artifact)))
    if (!verdict.keep) {
      if (!live()) return
      // Settled: removed only if it is still the answer this read settled.
      if (!(await changeEntry($, key, current => (current?.answer_id === entry.answer_id ? undefined : 'keep')))) {
        note($, `humantray viewer: ${entry.short} is settled but the outbox could not be written; tried again next tick`)
      }
      if (verdict.toast !== undefined) toasts.push(verdict.toast)
      continue
    }
    if (isGivenUp(entry, now)) {
      states.set(key, 'not-taken')
      continue
    }
    states.set(key, verdict.state)
    if (inFlight.has(`${key} ${entry.answer_id}`)) continue
    if (now >= nextSendAt(entry)) {
      if (!live() || !(await sendEntry($, entry))) break
    }
  }
  if (!live()) return
  for (const text of toasts) await toast($, text)
  const after = await readOutbox($)
  if (!live()) return
  lastStates = states
  await rebuild($, after ?? lastOutbox, states, now)
}

/** A line in the debug log, best effort: what the viewer could not do, never item text. */
function note($: EngineInterface, text: string) {
  try {
    $.ui.log(text, { to: 'debug' })
  } catch {
    // Best effort.
  }
}

async function toast($: EngineInterface, text: string) {
  try {
    if ((await $.session.surfaces()).length > 0) await $.ui.toast(text)
  } catch {
    // Best effort.
  }
}

/** Rebuilds the viewer's tray from the last reads and the outbox. Writes nothing once the viewer has stopped. */
async function rebuild($: EngineInterface, outbox: Record<string, OutboxEntry>, states: Map<string, CardState>, now: number) {
  if (!holding) return
  lastOutbox = outbox
  const me = await $.session.id()
  const repos: ViewerRepo[] = []
  const finished: ItemRow[] = []
  let answerable = 0
  for (const { url, repo } of artifacts) {
    const read = reads.get(url)
    const leads = new Map<string, ViewerLead>()
    const cardOf = (row: ItemRow, version: number, state: CardState, reason?: string): ViewerCard => {
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
      // Titles as every view draws them (#75): cleaned and cut (cleanTitle).
      const title = cleanTitle(row.session_title) ?? null
      if (asker === undefined) {
        asker = { session_id: row.session_id, title, link: SESSION_ID.test(row.session_id), lastActive: 0, cards: [] }
        lead.askers.push(asker)
      }
      asker.cards.push(card)
      if (row.session_id === row.lead_session_id && title !== null) lead.title = title
    }
    for (const { row, version } of read?.open ?? []) {
      // A withdrawn row is finished (#82), though still `open`: it goes to History.
      if (row.withdrawn !== undefined) {
        finished.push(row)
        continue
      }
      const key = outboxKey(url, row.id)
      const entry = outbox[key]
      let state: CardState
      let reason: string | undefined
      if (entry !== undefined) {
        state = states.get(key) ?? (isGivenUp(entry, now) ? 'not-taken' : entry.delivered ? 'sent' : 'not-sent')
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
      // One that comes after an item still open, or is blocked, cannot be answered yet (#82).
      if (state === 'answerable' && mirroredLock(row) === undefined) answerable += 1
      place(cardOf(row, version, state, reason))
    }
    // Our answers applied but not yet delivered, while we keep sending.
    for (const [id, each] of read?.closed ?? []) {
      if (states.get(outboxKey(url, id)) === 'applied') place(cardOf(each.row, each.version, 'applied'))
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
      historyAt: read?.historyAt ?? null,
      historyStale: read?.historyStale ?? true,
      leads: [...leads.values()],
    })
  }
  // Who asked each answered item (#75), from its row: the asking session's
  // title as the row carries it, else "another session". The items are made
  // as this session's (rowToItem) only so that historyOf reads them all.
  const askedBy = new Map(finished.map(row => [row.id, cleanTitle(row.session_title) ?? 'another session']))
  const history: HistoryEntry[] = historyOf(
    { version: 1, items: finished.map(row => rowToItem(row, me, '', 0)), sessions: {} },
    '',
    me,
    now,
  ).map(entry => ({ ...entry, isMine: true, origin: askedBy.get(entry.id) ?? 'another session' }))
  const tray: ViewerTray = { repos, history, answerable, found, leaseFailed, at: now }
  if (!holding) return
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
  epoch += 1
  timer?.cancel()
  timer = undefined
  reads.clear()
  artifacts = []
  lastFind = undefined
  lastStates = new Map()
  await update($, viewerTray, () => null).catch(() => undefined)
}

/**
 * At session.start: the viewer session itself starting again (a restart, a
 * resume, a reload) takes the lease back at once when the lease and the
 * setting both name this session, or when the lease is stale and the setting
 * names it. No other session ever becomes the viewer by itself.
 */
export async function resumeViewer($: EngineInterface): Promise<boolean> {
  if (await isCloud($)) return false
  const config = await readConfig($)
  if (config === undefined) return false
  const now = await $.clock.now()
  const lease = await readLease($)
  const me = await $.session.id()
  if (config.session !== me) return false
  const ours = lease === undefined || now - lease.renewed >= LEASE_MS || lease.session === me || lease.instance === INSTANCE
  if (!ours) return false
  if ((await takeLease($, now)) !== 'held') return false
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
  const taken = await takeLease($, now)
  if (taken === 'other') return 'humantray viewer: another session took over as the viewer.'
  if (taken === 'failed') return 'humantray viewer: the viewer lease could not be written; try again.'
  if (!holding) {
    holding = true
    // A viewer turned on afresh starts from nothing it read before.
    lastFind = undefined
  }
  startTimer($)
  await tick($, { find: true, history: true })
  if (!holding) return 'humantray viewer: another session took over as the viewer.'
  if (found === 'unreadable') {
    return `humantray viewer: on, but the list of artifacts could not be read${artifacts.length > 0 ? ` in full; showing ${artifacts.map(each => each.repo).join(', ')}` : ''}. Give the page link instead: /humantray-viewer <link to the "humantray: owner/repo" page>.`
  }
  if (artifacts.length === 0) return 'humantray viewer: on, but no humantray page was found for those repositories.'
  const names = artifacts.map(each => each.repo).join(', ')
  return `humantray viewer: on for ${artifacts.length} ${artifacts.length === 1 ? 'repository' : 'repositories'}: ${names}. It reads every ${TICK_MS / 1000} s.`
}

/** What answering a viewer card came to: an error to show on the card, or sent. */
export type ViewerAnswered = { error: string } | { sent: true }

/**
 * Answers one card: checks it against the store as last read (still open,
 * nothing pending, nothing else waiting), builds the response as the pane
 * would, then, while the lease still holds, adds the outbox entry and sends
 * the envelope once.
 */
export async function viewerAnswer(
  $: EngineInterface,
  card: ViewerCard,
  draft: Parameters<typeof buildResponse>[1],
  action: Action,
): Promise<ViewerAnswered> {
  if (!(await stillHolds($))) return { error: 'This session is no longer the viewer.' }
  // The card as the store shows it now, not as it was drawn.
  const read = reads.get(card.url)
  const current = read?.open.find(each => each.row.id === card.row.id)
  if (read === undefined || current === undefined) return { error: 'This item is no longer open.' }
  const row = current.row
  const response = read.responses.get(row.id)
  if (response !== undefined && countsAsAnswer(response, row)) return { error: 'This item was answered on the page.' }
  // Withdrawn, coming after an item still open, or blocked (#82), as its asker mirrored it.
  const lock = mirroredLock(row)
  if (lock !== undefined) return { error: lock }
  if (row.envelope !== 1) return { error: "This session's humantray cannot take answers from the viewer: answer on the page." }
  if (!SESSION_ID.test(row.session_id)) return { error: 'This item has no session to send the answer to.' }
  const key = outboxKey(card.url, row.id)
  const me = await $.session.id()
  const item = rowToItem(row, me, card.url, current.version)
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
  // Added before the send, only if the item has no answer pending and the lease still holds.
  if (!(await stillHolds($))) return { error: 'This session is no longer the viewer.' }
  let pending = false
  const kept = await changeEntry($, key, existing => {
    if (existing !== undefined) {
      pending = true
      return 'keep'
    }
    return entry
  })
  if (!kept) return { error: 'The outbox could not be read: nothing was sent.' }
  if (pending) return { error: 'An answer to this item is already on its way.' }
  const sent = await sendEntry($, entry)
  const outbox = await readOutbox($)
  const states = new Map(lastStates)
  states.set(key, outbox?.[key]?.delivered === true ? 'sent' : 'not-sent')
  lastStates = states
  await rebuild($, outbox ?? lastOutbox, states, now)
  return sent ? { sent: true } : { error: 'This session is no longer the viewer: the answer is kept, not sent.' }
}

/** Send again: an answer "not taken" starts its schedule over, sent once now while the lease holds. */
export async function sendAgain($: EngineInterface, url: string, id: string): Promise<void> {
  const key = outboxKey(url, id)
  const outbox = await readOutbox($)
  const entry = outbox?.[key]
  if (entry === undefined || !(await stillHolds($))) return
  const now = await $.clock.now()
  const restarted: OutboxEntry = { ...entry, first: now, last: now, sends: 0 }
  if (!(await changeEntry($, key, current => (current?.answer_id === entry.answer_id ? restarted : 'keep')))) return
  await sendEntry($, restarted)
  await tick($)
}

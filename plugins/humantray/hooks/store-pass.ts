// The store pass (#33): what a cloud session's mod does with the repository's
// artifact database. The local file stays the truth in each container; the
// pass mirrors this session's items into the database as rows, adopts the
// rows a replaced container left behind, and pulls answers given on the page
// back into the file, where the existing claim and settle deliver each one
// exactly once.
//
// Order of a pass: link (find the artifact) → lineage (`get_session`) →
// adopt → push → pull → record → deliver. Network calls never run under the
// file lock: the pass reads the file, calls the store, then records what it
// learnt with one locked compare-and-set per item (on its fingerprint), so a
// later local change is never overwritten.
//
// Which events run what:
//   session.start  link, adopt, push, pull, deliver; then prune finished rows (detached)
//   turn.start     push, pull, deliver (not awaited; not for a subagent)
//   turn.complete  the same
//   add, settle    push only
//   the command    adopt and push (no pull: no command or tool hook ever delivers)
//
// One pass runs at a time; a request made meanwhile runs once more after it.
// A pass that fails retries in this process after about 5, 15 and 40 s, then
// waits for the next start or turn. Only in a cloud session: a local mod
// cannot write the database (#31 (b)), so a local session keeps #23's
// behaviour and the local viewer (#32) reads.

import type { EngineInterface } from 'claude-code'

import type { Item, LeadRecord, RemoteLineage, ResponseRow, StoreFile } from '../types'
import {
  type Link,
  SESSION_ROWS_LIMIT,
  deleteDocs,
  findArtifact,
  loadLink,
  pushItem,
  queryDocs,
  readFinishedRows,
  readMeta,
  readOpenRows,
  readResponses,
  readSessionRows,
  saveLink,
  withDeadline,
} from './artifact-store'
import { isLive, normaliseRepo, prune, refreshDependencies, resolveOwner } from './items'
import { type ShownFrom, isLeadRecord, leadKey, restoredSelf, shownUnder } from './lineage'
import { owesPush } from './row-shape'
import {
  SESSION_ID,
  adoptRows,
  applyStoreAnswer,
  backfillLineage,
  NEWER_ANSWER,
  countsAsAnswer,
  fingerprint,
  prunableRows,
  refusalOf,
  refuseStoreAnswer,
} from './rows'
import { mutate, peek } from './store'

/** What a pass is asked to do, from least to most. */
export type PassKind = 'push' | 'relink' | 'turn' | 'start'

const RANK: Record<PassKind, number> = { push: 0, relink: 1, turn: 2, start: 3 }
const wider = (a: PassKind | undefined, b: PassKind): PassKind => (a === undefined || RANK[b] > RANK[a] ? b : a)
const does = (kind: PassKind): { link: boolean; adopt: boolean; pull: boolean; pruneRows: boolean } => ({
  link: kind === 'start',
  adopt: kind === 'start' || kind === 'relink',
  pull: kind === 'start' || kind === 'turn',
  pruneRows: kind === 'start',
})

/**
 * How often a turn pass may try again to find the page, or to adopt, while
 * this process has no link or has not adopted yet (a page made after the
 * session started, or a store that could not be reached at the start).
 */
export const FIND_AGAIN_MS = 10 * 60 * 1000

/** The awaited part of the pass at `session.start`. */
export const START_DEADLINE_MS = 4_000
/** In-process retries after a failed pass. */
export const RETRY_MS = [5_000, 15_000, 40_000] as const

/** What `humantray_add` tells the model about the page (none of these says the row was written). */
export type PageState = 'queued' | 'waiting' | 'none'

type Outcome = 'done' | 'failed'

/** The routable lineage from `get_session`, or undefined (not cached by the caller). */
export async function fetchLineage($: EngineInterface): Promise<RemoteLineage | undefined> {
  let answered
  try {
    answered = await withDeadline($, $.mcp.call('claude-code-remote', 'get_session', {}), 5_000)
  } catch {
    return undefined
  }
  if (answered === 'timeout' || answered.isError) return undefined
  for (const block of answered.content) {
    const text = (block as { type: string; text?: unknown }).text
    if (block.type !== 'text' || typeof text !== 'string') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    const ccr = typeof parsed === 'object' && parsed !== null ? (parsed as { ccr?: unknown }).ccr : undefined
    if (typeof ccr !== 'object' || ccr === null) continue
    const { id, title, parent_session_id: parent } = ccr as Record<string, unknown>
    if (typeof id !== 'string' || !SESSION_ID.test(id)) continue
    const parentId = typeof parent === 'string' && SESSION_ID.test(parent) ? parent : null
    return {
      session_id: id,
      session_title: typeof title === 'string' ? title : null,
      parent_session_id: parentId,
      lead_session_id: parentId ?? id,
    }
  }
  return undefined
}

// The pass's state, per module instance (a reload starts it over).
let cloud: boolean | undefined
let link: Link | undefined
let lineage: RemoteLineage | undefined
/** A local mod's write needs a person: no writes until the next session.start. */
let blocked = false
let running: Promise<void> | undefined
let pending: PassKind | undefined
let retries = 0
let retry: { cancel: () => void } | undefined
/** Answers were applied: the mod's own delivery pass should run (`onDeliveryDue`). */
let deliveryDue = false
/** The mod's delivery pass, run after every pass that applied an answer (#32, F3). */
let deliver: (() => Promise<void>) | undefined
/** The delivery pass last started, so a caller can wait for it. */
let delivering: Promise<void> = Promise.resolve()
/** This session's rows on the linked artifact have been read for adoption. */
let adoptedHere = false
/** When this process last tried to find the page or to adopt (its clock). */
let lastFind: number | undefined
/**
 * This session's `humantray_config` record (#27): undefined until read from
 * `$.store`, null when none is kept there. `lineage` itself always stays as
 * `get_session` gave it: only the heading items are shown under changes.
 */
let leadRecord: LeadRecord | null | undefined

/** Whether this is a cloud session, where the store pass runs. */
export async function isCloud($: EngineInterface): Promise<boolean> {
  if (cloud !== undefined) return cloud
  try {
    cloud = (await $.env.get('CLAUDE_CODE_REMOTE')) === 'true'
  } catch {
    cloud = false
  }
  return cloud
}

function scheduleRetry($: EngineInterface, kind: PassKind) {
  if (retry !== undefined || retries >= RETRY_MS.length) return
  const delay = RETRY_MS[retries] ?? 0
  retries += 1
  try {
    retry = $.clock.after(delay, () => {
      retry = undefined
      void requestPass($, kind)
    })
  } catch {
    retry = undefined
  }
}

/** Sets `link`: the cached one if its meta/page still qualifies, else one found by title, else none. */
async function linkStep($: EngineInterface, repo: string, now: number): Promise<'done' | 'failed'> {
  const held = link ?? (await loadLink($, repo))
  let usable: Link | undefined
  if (held !== undefined) {
    const meta = await readMeta($, held.url, repo)
    if (meta.kind === 'unavailable') {
      link = held
      return 'failed'
    }
    if (meta.meta !== undefined) usable = held
    else {
      await saveLink($, repo, undefined)
      adoptedHere = false
    }
  }
  if (usable === undefined) {
    const found = await findArtifact($, repo)
    if (found.kind === 'unavailable') return 'failed'
    if (found.url !== undefined) {
      usable = { url: found.url, how: 'found', at: now }
      await saveLink($, repo, usable)
      adoptedHere = false
    }
  }
  link = usable
  return 'done'
}

/**
 * The link this process uses, found first when it has none (the receiver,
 * #32): the cached one, or one found by title. Undefined when there is none
 * or the store cannot be reached.
 */
export async function ensureLink($: EngineInterface): Promise<Link | undefined> {
  if (link !== undefined) return link
  const seen = await peek($)
  if (seen.error !== undefined) return undefined
  const repo = normaliseRepo(seen.ok.where.remote, seen.ok.where.root)
  const now = await $.clock.now()
  lastFind = now
  await linkStep($, repo, now)
  return link
}

/**
 * Looks for the page now when none is linked (`humantray_config`, #27). A
 * page found is adopted and pushed to by a relink pass, which delivers
 * nothing, as after /humantray-page.
 */
export async function findPageNow($: EngineInterface): Promise<void> {
  if (link !== undefined || blocked || !(await isCloud($))) return
  if ((await ensureLink($)) !== undefined) void requestPass($, 'relink')
}

/** This session's routable lineage, asked for once more when it is not known yet. */
export async function ensureLineage($: EngineInterface): Promise<RemoteLineage | undefined> {
  if (lineage === undefined) lineage = await fetchLineage($)
  return lineage
}

// Every read and write of the record runs one at a time, so a restore decided
// by a pass can never land after, and undo, a `humantray_config` call.
let recordQueue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = recordQueue.then(work, work)
  recordQueue = run.catch(() => undefined)
  return run
}

/** This session's `humantray_config` record: null when none is kept, undefined when `$.store` could not be read. */
export function loadLeadRecord($: EngineInterface, routable: string): Promise<LeadRecord | null | undefined> {
  return oneAtATime(async () => {
    if (leadRecord !== undefined) return leadRecord
    try {
      const held = await $.store.get(leadKey(routable))
      leadRecord = isLeadRecord(held) ? held : null
    } catch {
      return undefined
    }
    return leadRecord
  })
}

async function storeRecord($: EngineInterface, routable: string, record: LeadRecord): Promise<boolean> {
  try {
    await $.store.set(leadKey(routable), record)
  } catch {
    return false
  }
  leadRecord = record
  return true
}

/** Keeps a record in `$.store`, then in this process. False, with nothing changed, when the store refused it. */
export function saveLeadRecord($: EngineInterface, routable: string, record: LeadRecord): Promise<boolean> {
  return oneAtATime(() => storeRecord($, routable, record))
}

/**
 * Restores `self` (a replaced container), but only if no record is kept yet
 * when its turn comes: a `humantray_config` call queued meanwhile wins.
 */
function restoreSelfRecord($: EngineInterface, routable: string, now: number): Promise<LeadRecord | null | undefined> {
  return oneAtATime(async () => {
    if (leadRecord !== null) return leadRecord
    await storeRecord($, routable, { lead: routable, at: now, from: 'restored' })
    return leadRecord
  })
}

/** The heading this session's items are shown under now, or why it cannot be told: the lineage or the record is not readable yet. */
export async function shownNow(
  $: EngineInterface,
): Promise<{ lineage: RemoteLineage; lead: string; from: ShownFrom } | { unknown: 'id' | 'setting' }> {
  const known = await ensureLineage($)
  if (known === undefined) return { unknown: 'id' }
  const record = await loadLeadRecord($, known.session_id)
  if (record === undefined) return { unknown: 'setting' }
  return { lineage: known, ...shownUnder(known, record ?? undefined) }
}

async function once($: EngineInterface, kind: PassKind): Promise<Outcome> {
  if (!(await isCloud($))) return 'done'
  if (kind === 'start') blocked = false
  if (blocked) return 'done'
  const step = does(kind)
  const now = await $.clock.now()
  // A turn finds the page and adopts too, while either is still owed, at most
  // once every FIND_AGAIN_MS.
  if (kind === 'turn' && (link === undefined || !adoptedHere) && (lastFind === undefined || now - lastFind >= FIND_AGAIN_MS)) {
    if (link === undefined) step.link = true
    step.adopt = true
  }
  if (step.link || step.adopt) lastFind = now
  const me = await $.session.id()
  const seen = await peek($)
  if (seen.error !== undefined) return 'done'
  const repo = normaliseRepo(seen.ok.where.remote, seen.ok.where.root)
  let outcome: Outcome = 'done'

  // 1. Link: the cached one if its meta/page still qualifies, else by title.
  if (step.link && (await linkStep($, repo, now)) === 'failed') return 'failed'

  // 2. Lineage: asked again on every pass until it answers.
  if (lineage === undefined) lineage = await fetchLineage($)
  if (lineage === undefined) return link === undefined ? 'done' : 'failed'
  const routable = lineage.session_id
  const known = lineage

  // 3. Adopt this session's rows the file lacks (a replaced container), and backfill lineage.
  let adoptable: Awaited<ReturnType<typeof readSessionRows>> | undefined
  if (step.adopt && link !== undefined) {
    adoptable = await readSessionRows($, link.url, routable)
    if (adoptable.kind === 'unavailable') outcome = 'failed'
    else adoptedHere = true
  }
  // The heading new items are shown under (#27). With no record kept (a
  // replaced container), `self` alone is restored from this session's rows;
  // a kept record, a clear included, is never replaced here.
  let record = await loadLeadRecord($, routable)
  if (
    record === null &&
    adoptable?.kind === 'ok' &&
    // A row that could not be read, or one past the read's limit, may be the
    // newest: restore nothing then.
    adoptable.skipped === 0 &&
    adoptable.rows.length + adoptable.skipped < SESSION_ROWS_LIMIT &&
    restoredSelf(
      adoptable.rows.map(each => each.row),
      routable,
      known.parent_session_id,
    )
  ) {
    record = await restoreSelfRecord($, routable, now)
  }
  // A record that cannot be read leaves the default heading: an item shown
  // under the wrong heading is still seen, one held back is not.
  const shown = { ...known, lead_session_id: shownUnder(known, record ?? undefined).lead }
  const target = link
  const recorded = await mutate<{ items: Item[]; changed: boolean }>($, file => {
    let changed = backfillLineage(file, me, shown) > 0
    if (adoptable?.kind === 'ok' && target !== undefined) {
      const adopted = adoptRows(file, adoptable.rows, me, routable, target.url)
      // An adopted answer not yet delivered is delivered by the caller's pass.
      if (file.items.some(item => adopted.includes(item.id) && item.status !== 'open')) deliveryDue = true
      changed = adopted.length > 0 || changed
    }
    // What each item's `after` comes to now (#82), so the rows pushed below say what the file says.
    changed = refreshDependencies(file) || changed
    return { result: { items: file.items.map(item => ({ ...item })), changed }, write: changed }
  })
  if (recorded.error !== undefined) return 'failed'
  if (target === undefined) return outcome
  const mine = recorded.ok.result.items.filter(
    item => item.remote !== undefined && resolveOwner(recorded.ok.file.sessions, item.session_id) === me,
  )

  // 4. Push every item whose row is behind, or on another artifact.
  const pushed: Array<{ id: string; version: number; sent: string }> = []
  for (const item of mine) {
    const onTarget = item.row?.artifact === target.url
    if (onTarget && !owesPush(item)) continue
    const withRemote = item as Item & Required<Pick<Item, 'remote'>>
    const result = await pushItem($, target.url, withRemote, onTarget ? item.row?.version : undefined)
    if (result.kind === 'needs-person') {
      blocked = true
      return 'done'
    }
    if (result.kind === 'unavailable') {
      outcome = 'failed'
      break
    }
    pushed.push({ id: item.id, version: result.version, sent: fingerprint(withRemote) })
  }

  // 5. Pull the answers to this session's open items that have a row there.
  const answers = new Map<string, ResponseRow>()
  /** Answers written by a newer page, by item: refused with a reason, so the page shows them. */
  const newer = new Map<string, string>()
  if (step.pull && outcome === 'done') {
    const versions = new Map(pushed.map(p => [p.id, p.version]))
    const open = mine.filter(
      item =>
        isLive(item) &&
        (versions.has(item.id) || (item.row?.artifact === target.url && item.row.version !== undefined)),
    )
    if (open.length > 0) {
      const read = await readResponses($, target.url, open.map(item => item.id))
      if (read.kind === 'unavailable') outcome = 'failed'
      else {
        for (const item of open) {
          const row = read.rows.get(item.id)
          if (countsAsAnswer(row, item)) answers.set(item.id, row.ok)
          else if (
            row !== undefined &&
            'newer' in row &&
            row.answer_id !== undefined &&
            row.answer_id !== item.response_refused?.answer_id
          ) {
            newer.set(item.id, row.answer_id)
          }
        }
      }
    }
  }

  // 6. Record what was written, and take or refuse each answer, under the lock.
  let applied = 0
  let refused = 0
  if (pushed.length > 0 || answers.size > 0 || newer.size > 0) {
    const done = await mutate<boolean>($, (file: StoreFile) => {
      let changed = false
      for (const each of pushed) {
        const item = file.items.find(one => one.id === each.id)
        if (item === undefined || item.remote === undefined) continue
        const same = fingerprint(item as Item & Required<Pick<Item, 'remote'>>) === each.sent
        item.row = same ? { artifact: target.url, version: each.version, sent: each.sent } : { artifact: target.url, version: each.version }
        changed = true
      }
      for (const [id, row] of answers) {
        const item = file.items.find(one => one.id === id)
        if (item === undefined || !isLive(item)) continue
        if (resolveOwner(file.sessions, item.session_id) !== me) continue
        if (item.response_refused?.answer_id === row.answer_id) continue
        const verdict = refusalOf(item, row, file)
        if ('apply' in verdict) {
          applyStoreAnswer(item, verdict.apply, row, now)
          applied += 1
        } else {
          refuseStoreAnswer(item, row, verdict.refuse, now)
          refused += 1
        }
        changed = true
      }
      for (const [id, answerId] of newer) {
        const item = file.items.find(one => one.id === id)
        if (item === undefined || !isLive(item)) continue
        if (resolveOwner(file.sessions, item.session_id) !== me) continue
        refuseStoreAnswer(item, { answer_id: answerId }, NEWER_ANSWER, now)
        refused += 1
        changed = true
      }
      if (changed) prune(file)
      return { result: changed, write: changed }
    })
    if (done.error !== undefined) outcome = 'failed'
  }

  // 7. Deliver what was applied (the caller's delivery pass), then mirror the new states.
  if (applied > 0) deliveryDue = true
  if (applied > 0 || refused > 0) pending = wider(pending, 'push')

  // Prune finished rows, once per start, without holding the start up.
  if (step.pruneRows && outcome === 'done') void pruneRows($, target.url).catch(() => undefined)
  return outcome
}

async function pruneRows($: EngineInterface, url: string): Promise<void> {
  const read = await readFinishedRows($, url)
  // A row that could not be read (or a newer one) may hold a slot among the
  // newest; pruning around it could delete a row that should be kept.
  if (read.kind !== 'ok' || read.skipped > 0) return
  // The open rows too (#82): a row an open one comes after is kept, and a
  // withdrawn row (still `open`) is pruned as a finished one. A read that
  // reaches its limit may have left out a row that needs another: prune nothing.
  const open = await readOpenRows($, url)
  if (open.kind !== 'ok' || open.skipped > 0 || open.rows.length >= 1000) return
  const doomed = prunableRows([...read.rows, ...open.rows]).slice(0, 25)
  if (doomed.length === 0) return
  const responses = await queryDocs($, url, 'responses', { where: [['id', 'in', doomed.map(d => d.id)]], limit: 100 })
  const versions = new Map<string, number>()
  if (responses.kind === 'ok') for (const doc of responses.docs) versions.set(doc.id, doc.version)
  else return
  const deletes: Array<{ collection: string; id: string; version: number }> = []
  for (const each of doomed) {
    deletes.push({ collection: 'items', id: each.id, version: each.version })
    const version = versions.get(each.id)
    if (version !== undefined) deletes.push({ collection: 'responses', id: each.id, version })
  }
  await deleteDocs($, url, deletes)
}

/** Asks for a pass; resolves when the pass that covers it is done. Never rejects. */
export function requestPass($: EngineInterface, kind: PassKind): Promise<void> {
  pending = wider(pending, kind)
  if (running !== undefined) return running
  running = (async () => {
    // Only a start or turn pass delivers: the command's relink pass (adopt and
    // push) and a tool's push pass never do, so no command or tool hook submits.
    let delivers = false
    try {
      while (pending !== undefined) {
        const now = pending
        pending = undefined
        if (now === 'start' || now === 'turn') delivers = true
        let outcome: Outcome
        try {
          outcome = await once($, now)
        } catch {
          outcome = 'failed'
        }
        if (outcome === 'failed') scheduleRetry($, now)
        else if (pending === undefined) retries = 0
      }
      // Answers applied by these passes (a turn, a retry of one, the
      // receiver's) are delivered now, not at the next turn. Only once no pass
      // is left to run, so the two never wait on the lock together. After a
      // relink or push pass alone the flag waits for the next start or turn.
      if (delivers && deliveryDue && deliver !== undefined) {
        deliveryDue = false
        const run = deliver
        delivering = run().catch(() => undefined)
      }
    } finally {
      running = undefined
    }
  })()
  return running
}

/** What `humantray_add` tells the model about the page. */
export async function pageState($: EngineInterface): Promise<PageState> {
  if (!(await isCloud($)) || blocked) return 'none'
  return link !== undefined && lineage !== undefined ? 'queued' : 'waiting'
}

/** The command's: use this link from now on, then adopt and push (no pull, no delivery). */
export async function relinkPass($: EngineInterface, repo: string, next: Link): Promise<void> {
  link = next
  adoptedHere = false
  await saveLink($, repo, next)
  void requestPass($, 'relink')
}

/**
 * Sets the mod's delivery pass, run after every pass that applied an answer
 * (or adopted one not yet delivered). Without one, the flag waits for a later
 * caller.
 */
export function onDeliveryDue(run: () => Promise<void>): void {
  deliver = run
}

/** Runs the mod's delivery pass now (an answer applied earlier and not yet delivered), and resolves when it has. */
export function deliverNow(): Promise<void> {
  if (deliver !== undefined) {
    const run = deliver
    delivering = run().catch(() => undefined)
  }
  return delivering
}

/** Resolves when the delivery pass last started by a pass has finished. */
export function deliveryIdle(): Promise<void> {
  return delivering
}


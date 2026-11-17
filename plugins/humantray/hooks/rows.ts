// Pure logic for the artifact database (#33): reading rows defensively, the
// rules for what counts as an answer, refusing or applying one, adopting the
// rows of a replaced container, the artifact's title, which artifact to use,
// and which finished rows to prune. Nothing here calls `$`.

import type {
  Draft,
  Item,
  ItemOption,
  ItemResponse,
  ItemRow,
  ItemStatus,
  MetaPage,
  RemoteLineage,
  ResponseRow,
  StoreFile,
} from '../types'
import { type Action, EMPTY_DRAFT, KEEP_PER_REPO, TYPES, buildResponse, isLineDue, resolveOwner, shortOf } from './items'
import { ROW_SCHEMA, fingerprint, itemToRow } from './row-shape'

export { ROW_SCHEMA, fingerprint, itemToRow }

/** The page this version publishes; rises with every change to page/index.html. */
export const PAGE_VERSION = 1

/** A routable session id, as `get_session` gives it. */
export const SESSION_ID = /^session_[A-Za-z0-9]{20,64}$/

/** An answer's id: random, made by the answerer. */
export const ANSWER_ID = /^[A-Za-z0-9_-]{16,64}$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isOptional = (v: unknown, kind: 'string' | 'number' | 'boolean') =>
  v === undefined || (kind === 'number' ? isFiniteNumber(v) : typeof v === kind)
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string'
const STATUSES: readonly string[] = ['open', 'acknowledged', 'done', 'answered']

/** A row read from the store: usable, written by a newer schema (skipped and counted), or unreadable. */
export type RowRead<T> = { ok: T } | { newer: true; answer_id?: string } | { bad: string }

const schemaOf = (data: Record<string, unknown>): RowRead<never> | undefined => {
  if (data.schema === ROW_SCHEMA) return undefined
  if (isFiniteNumber(data.schema) && data.schema > ROW_SCHEMA) return { newer: true }
  return { bad: 'unknown schema' }
}

const isOptionList = (v: unknown): v is ItemOption[] =>
  Array.isArray(v) && v.every(o => isRecord(o) && typeof o.label === 'string' && typeof o.description === 'string')

/** Whether a response has the shape its item's type gives it (notes optional on every type). */
export const isResponseShape = (type: string, r: unknown): r is ItemResponse => {
  if (!isRecord(r) || !isOptional(r.notes, 'string')) return false
  switch (type) {
    case 'ack':
      return r.acknowledged === true
    case 'question':
      return typeof r.text === 'string'
    case 'do':
      return (r.outcome === 'done' || r.outcome === 'not_done') && isOptional(r.feedback, 'string')
    case 'choice':
    case 'approve':
      return Array.isArray(r.selected) && r.selected.every(l => typeof l === 'string') && isOptional(r.other, 'string')
    default:
      return false
  }
}

/**
 * Reads an item row. Extra fields are allowed; a missing or wrongly typed
 * known field makes the row unreadable; a higher schema is skipped.
 */
export function checkItemRow(data: unknown): RowRead<ItemRow> {
  if (!isRecord(data)) return { bad: 'not an object' }
  const schema = schemaOf(data)
  if (schema !== undefined) return schema
  for (const field of ['id', 'short', 'repo', 'header', 'question', 'body_md', 'key', 'session_id', 'writer_version'] as const) {
    if (typeof data[field] !== 'string') return { bad: `${field} is not a string` }
  }
  for (const field of ['created', 'updated', 'bumps'] as const) {
    if (!isFiniteNumber(data[field])) return { bad: `${field} is not a number` }
  }
  if (typeof data.type !== 'string' || !(TYPES as readonly string[]).includes(data.type)) return { bad: 'unknown type' }
  if (typeof data.status !== 'string' || !STATUSES.includes(data.status)) return { bad: 'unknown status' }
  if (typeof data.delivered !== 'boolean') return { bad: 'delivered is not true or false' }
  for (const field of ['session_title', 'parent_session_id', 'lead_session_id'] as const) {
    if (!isNullableString(data[field])) return { bad: `${field} is not a string or null` }
  }
  if (data.options !== undefined && !isOptionList(data.options)) return { bad: 'options are malformed' }
  if ((data.type === 'choice' || data.type === 'approve') && data.options === undefined) return { bad: 'options are missing' }
  for (const field of ['multiSelect', 'notes', 'notify_on_done'] as const) {
    if (!isOptional(data[field], 'boolean')) return { bad: `${field} is not true or false` }
  }
  for (const field of ['response_at', 'delivered_at'] as const) {
    if (!isOptional(data[field], 'number')) return { bad: `${field} is not a number` }
  }
  if (data.status !== 'open' && !isResponseShape(data.type, data.response)) return { bad: 'the response is malformed' }
  if (data.response_by !== undefined && !['page', 'viewer', 'pane'].includes(data.response_by as string)) {
    return { bad: 'response_by is malformed' }
  }
  if (!isOptional(data.answer_id, 'string')) return { bad: 'answer_id is not a string' }
  const refused = data.response_refused
  if (
    refused !== undefined &&
    (!isRecord(refused) ||
      typeof refused.answer_id !== 'string' ||
      typeof refused.reason !== 'string' ||
      !isFiniteNumber(refused.at))
  ) {
    return { bad: 'response_refused is malformed' }
  }
  return { ok: data as unknown as ItemRow }
}

const ANSWER_STATUS: Record<string, ItemStatus> = {
  ack: 'acknowledged',
  do: 'done',
  choice: 'answered',
  question: 'answered',
  approve: 'answered',
}

/**
 * Reads a response row. Its type is not known here, so its shape is checked
 * against its own `status` loosely; `refusalOf` checks it against the item.
 */
export function checkResponseRow(data: unknown): RowRead<ResponseRow> {
  if (!isRecord(data)) return { bad: 'not an object' }
  const schema = schemaOf(data)
  if (schema !== undefined) {
    // A newer page's answer: kept by its id, so the asker can refuse it where the page shows it.
    if ('newer' in schema && typeof data.answer_id === 'string' && ANSWER_ID.test(data.answer_id)) {
      return { newer: true, answer_id: data.answer_id }
    }
    return schema
  }
  if (typeof data.id !== 'string') return { bad: 'id is not a string' }
  if (typeof data.answer_id !== 'string' || !ANSWER_ID.test(data.answer_id)) return { bad: 'answer_id is malformed' }
  if (data.status !== 'acknowledged' && data.status !== 'done' && data.status !== 'answered') {
    return { bad: 'status is malformed' }
  }
  if (!isRecord(data.response)) return { bad: 'response is not an object' }
  if (!isFiniteNumber(data.answered_at)) return { bad: 'answered_at is not a number' }
  const seen = data.seen
  if (!isRecord(seen) || !isFiniteNumber(seen.bumps) || !isFiniteNumber(seen.updated)) return { bad: 'seen is malformed' }
  if (data.by !== 'page' && data.by !== 'viewer') return { bad: 'by is malformed' }
  return { ok: data as unknown as ResponseRow }
}

/** Reads `meta/page`: only a humantray store for this repository (case aside) qualifies. */
export function checkMeta(data: unknown, repo: string): MetaPage | undefined {
  if (!isRecord(data) || data.schema !== ROW_SCHEMA || data.kind !== 'humantray') return undefined
  if (typeof data.repo !== 'string' || data.repo.toLowerCase() !== repo.toLowerCase()) return undefined
  if (!isFiniteNumber(data.created_at) || !isFiniteNumber(data.page_version)) return undefined
  if (typeof data.plugin_version !== 'string') return undefined
  return data as unknown as MetaPage
}

/**
 * Rule 1: a response row counts as the item's answer only when it reads and
 * its `answer_id` is not the one the item names as refused.
 */
export const countsAsAnswer = (
  read: RowRead<ResponseRow> | undefined,
  item: { response_refused?: { answer_id: string } },
): read is { ok: ResponseRow } => read !== undefined && 'ok' in read && read.ok.answer_id !== item.response_refused?.answer_id

/** The draft and the control a response would have come from in the pane. */
function asPaneAnswer(type: Item['type'], r: Record<string, unknown>): { draft: Draft; action: Action } | undefined {
  const notes = typeof r.notes === 'string' ? r.notes : ''
  const draft: Draft = { ...EMPTY_DRAFT, notes }
  switch (type) {
    case 'ack':
      return { draft, action: { kind: 'ack' } }
    case 'do':
      if (r.outcome !== 'done' && r.outcome !== 'not_done') return undefined
      return {
        draft: { ...draft, feedback: typeof r.feedback === 'string' ? r.feedback : '' },
        action: { kind: 'do', outcome: r.outcome },
      }
    case 'approve': {
      const selected = Array.isArray(r.selected) ? r.selected : []
      const choice = selected[0]
      if (selected.length !== 1 || (choice !== 'Approve' && choice !== 'Reject')) return undefined
      return { draft, action: { kind: 'approve', choice } }
    }
    case 'question':
      return { draft: { ...draft, text: typeof r.text === 'string' ? r.text : '' }, action: { kind: 'submit' } }
    case 'choice':
      return {
        draft: {
          ...draft,
          selected: Array.isArray(r.selected) ? r.selected.filter((l): l is string => typeof l === 'string') : [],
          other: typeof r.other === 'string' ? r.other : '',
        },
        action: { kind: 'submit' },
      }
  }
}

export type Verdict = { apply: { response: ItemResponse; status: ItemStatus } } | { refuse: string }

/**
 * Rule 5: whether the asker takes a store answer for its item. It refuses an
 * answer of another type's shape or status, one given before the item's last
 * bump, and any the pane would refuse; otherwise it takes the answer as the
 * pane would have stored it (`buildResponse`), so the page cannot store what
 * the pane would not.
 */
export function refusalOf(item: Item, row: ResponseRow): Verdict {
  if (row.id !== item.id) return { refuse: 'The answer is for another item.' }
  if (!isResponseShape(item.type, row.response) || row.status !== ANSWER_STATUS[item.type]) {
    return { refuse: `The answer does not fit a ${item.type} item.` }
  }
  if (row.seen.bumps < item.bumps) {
    return { refuse: 'The item was raised again after this answer was given. Read it again and answer it.' }
  }
  const pane = asPaneAnswer(item.type, row.response as unknown as Record<string, unknown>)
  if (pane === undefined) return { refuse: `The answer does not fit a ${item.type} item.` }
  const built = buildResponse(item, pane.draft, pane.action)
  if (built.error !== undefined) return { refuse: built.error }
  return { apply: built.ok }
}

/** Takes a store answer into the item, as the pane's answer would be (the asker's clock). */
export function applyStoreAnswer(
  item: Item,
  built: { response: ItemResponse; status: ItemStatus },
  row: ResponseRow,
  now: number,
): void {
  item.response = built.response
  item.status = built.status
  item.response_at = now
  item.response_by = row.by
  item.answer_id = row.answer_id
  item.delivered = false
  delete item.response_refused
}

/** Records a refused store answer on the item; the item stays open. */
export function refuseStoreAnswer(item: Item, row: { answer_id: string }, reason: string, now: number): void {
  item.response_refused = { answer_id: row.answer_id, reason, at: now }
}

/** Why an answer written by a newer page is refused. */
export const NEWER_ANSWER =
  'This answer was written by a newer humantray page than this session runs. Update the plugin where the session runs, or answer in its tray.'

/**
 * The local item for an adopted row: a row of this routable session that the
 * local file lacks (its container was replaced). It belongs to `me`, keeps
 * the row's lineage and is recorded as written at `version`.
 */
export function rowToItem(row: ItemRow, me: string, artifact: string, version: number): Item {
  const item: Item = {
    id: row.id,
    short: shortOf(row.id),
    repo: row.repo,
    session_id: me,
    type: row.type,
    header: row.header,
    question: row.question,
    body_md: row.body_md,
    key: row.key,
    created: row.created,
    updated: row.updated,
    bumps: row.bumps,
    status: row.status,
    delivered: row.delivered,
    origin: 'local',
    remote: {
      session_id: row.session_id,
      session_title: row.session_title,
      parent_session_id: row.parent_session_id,
      lead_session_id: row.lead_session_id,
    },
  }
  if (row.options !== undefined) item.options = row.options
  if (row.multiSelect !== undefined) item.multiSelect = row.multiSelect
  if (row.notes !== undefined) item.notes = row.notes
  if (row.notify_on_done !== undefined) item.notify_on_done = row.notify_on_done
  if (row.response !== undefined) item.response = row.response
  if (row.response_at !== undefined) item.response_at = row.response_at
  if (row.response_by !== undefined) item.response_by = row.response_by
  if (row.answer_id !== undefined) item.answer_id = row.answer_id
  if (row.response_refused !== undefined) item.response_refused = row.response_refused
  if (row.delivered_at !== undefined) item.delivered_at = row.delivered_at
  const remote = item as Item & Required<Pick<Item, 'remote'>>
  item.row = { artifact, version, sent: fingerprint(remote) }
  return item
}

/** Whether an adopted row is worth taking: still open, or answered with a line not yet delivered. */
export const isAdoptable = (row: ItemRow): boolean =>
  row.status === 'open' || (!row.delivered && !(row.type === 'ack' && row.notify_on_done !== true))

/** Adds the adoptable rows the file lacks; returns the ids adopted. */
export function adoptRows(
  file: StoreFile,
  rows: Array<{ row: ItemRow; version: number }>,
  me: string,
  routable: string,
  artifact: string,
): string[] {
  const have = new Set(file.items.map(item => item.id))
  const adopted: string[] = []
  for (const { row, version } of rows) {
    if (row.session_id !== routable || have.has(row.id) || !isAdoptable(row)) continue
    file.items.push(rowToItem(row, me, artifact, version))
    have.add(row.id)
    adopted.push(row.id)
  }
  return adopted
}

/** Gives the lineage to this session's chain's items that lack it. Returns how many. */
export function backfillLineage(file: StoreFile, me: string, lineage: RemoteLineage): number {
  let count = 0
  for (const item of file.items) {
    if (item.remote !== undefined) continue
    if (resolveOwner(file.sessions, item.session_id) !== me) continue
    item.remote = { ...lineage }
    count += 1
  }
  return count
}

/**
 * The artifact's title for a repository value: `humantray: <owner>/<name>`
 * for a GitHub remote, `humantray: <host/path>` for another host, and none
 * for a repository with no remote (`repo` is then a filesystem path).
 */
export function titleFor(repo: string): string | undefined {
  if (repo === '' || repo.startsWith('/') || /^[A-Za-z]:[\\/]/.test(repo) || !repo.includes('/')) return undefined
  const github = /^github\.com\/([^/]+)\/([^/]+)$/i.exec(repo)
  if (github) return `humantray: ${github[1]}/${github[2]}`
  return `humantray: ${repo}`
}

/** Whether a listed title is the one for this repository: GitHub names ignore case, so titles do too. */
export const isTitleFor = (title: string, repo: string): boolean => {
  const want = titleFor(repo)
  return want !== undefined && title.trim().toLowerCase() === want.toLowerCase()
}

/**
 * Which of several qualified artifacts to use: the earliest `meta/page`
 * `created_at`, then the lowest URL. The listing's order and updated times
 * are never used, so every container picks the same one.
 */
export function pickArtifact(candidates: Array<{ url: string; meta: MetaPage }>): { url: string; meta: MetaPage } | undefined {
  return [...candidates].sort((a, b) =>
    a.meta.created_at !== b.meta.created_at ? a.meta.created_at - b.meta.created_at : a.url < b.url ? -1 : a.url > b.url ? 1 : 0,
  )[0]
}

/** Whether a finished row may be pruned: delivered or owing no line, and with no refusal standing. */
export const isPrunableRow = (row: ItemRow): boolean =>
  row.status !== 'open' &&
  row.response_refused === undefined &&
  (row.delivered || !isLineDue({ status: row.status, type: row.type, notify_on_done: row.notify_on_done } as Item))

/**
 * The finished rows to delete, oldest first: past the newest `keep` finished
 * rows (by `response_at`, then `updated`, then id), each prunable one.
 * Rows that are not prunable count towards the kept rows but are never deleted.
 */
export function prunableRows(
  rows: Array<{ row: ItemRow; version: number }>,
  keep: number = KEEP_PER_REPO,
): Array<{ id: string; version: number }> {
  const key = (row: ItemRow) => row.response_at ?? row.updated
  const finished = rows
    .filter(({ row }) => row.status !== 'open')
    .sort((a, b) => {
      const ka = key(a.row)
      const kb = key(b.row)
      if (ka !== kb) return kb - ka
      return a.row.id < b.row.id ? 1 : a.row.id > b.row.id ? -1 : 0
    })
  return finished
    .slice(keep)
    .filter(({ row }) => isPrunableRow(row))
    .reverse()
    .map(({ row, version }) => ({ id: row.id, version }))
}

/** The `meta/page` document for a new or adopted artifact. */
export const metaFor = (repo: string, now: number, pluginVersion: string): MetaPage => ({
  schema: 1,
  kind: 'humantray',
  repo,
  created_at: now,
  page_version: PAGE_VERSION,
  plugin_version: pluginVersion,
})

/** A fresh row for an item, for a create (no base to keep fields from). */
export const freshRow = (item: Item & Required<Pick<Item, 'remote'>>): ItemRow => itemToRow(item)

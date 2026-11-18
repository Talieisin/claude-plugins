// The item row as it is written to the artifact database, and the
// fingerprint that tells the outbox whether the row is up to date. Pure, and
// imported by items.ts (pruning keeps an item still owed a push), so it
// imports nothing from there.

import type { Item, ItemRow } from '../types'

/** The row schema this version writes and reads. */
export const ROW_SCHEMA = 1

/**
 * The plugin version a row (and `meta/page`) names as its writer: kept with
 * the version in plugin.json. Only stamped: readers take any string here, so
 * rows an older version wrote stay readable.
 */
export const WRITER_VERSION = '0.2.3'

/**
 * The response envelope version this mod's receiver takes (#32): a row
 * carrying it tells the local viewer that it may answer the item by sending
 * an envelope to the asker. A row without it is answered on the page only.
 */
export const ENVELOPE_VERSION = 1

/** The fields of an item row this version knows; any other field is kept as it was. */
export const ITEM_ROW_KEYS = [
  'schema',
  'id',
  'short',
  'repo',
  'type',
  'header',
  'question',
  'body_md',
  'key',
  'options',
  'multiSelect',
  'notes',
  'notify_on_done',
  'created',
  'updated',
  'bumps',
  'status',
  'response',
  'response_at',
  'response_by',
  'answer_id',
  'response_refused',
  'delivered',
  'delivered_at',
  'session_id',
  'session_title',
  'parent_session_id',
  'lead_session_id',
  'writer_version',
  'envelope',
] as const

/**
 * The row for an item that carries its lineage. `base` is the row as last
 * read from the store: its unknown fields are kept, every known field is
 * written afresh (and dropped when the item no longer has it).
 */
export function itemToRow(item: Item & Required<Pick<Item, 'remote'>>, base: Record<string, unknown> = {}): ItemRow {
  const row: Record<string, unknown> = { ...base }
  for (const key of ITEM_ROW_KEYS) delete row[key]
  const known: Record<string, unknown> = {
    schema: ROW_SCHEMA,
    id: item.id,
    short: item.short,
    repo: item.repo,
    type: item.type,
    header: item.header,
    question: item.question,
    body_md: item.body_md,
    key: item.key,
    options: item.options,
    multiSelect: item.multiSelect,
    notes: item.notes,
    notify_on_done: item.notify_on_done,
    created: item.created,
    updated: item.updated,
    bumps: item.bumps,
    status: item.status,
    response: item.response,
    response_at: item.response_at,
    response_by: item.response_by,
    answer_id: item.answer_id,
    response_refused: item.response_refused,
    delivered: item.delivered,
    delivered_at: item.delivered_at,
    session_id: item.remote.session_id,
    session_title: item.remote.session_title,
    parent_session_id: item.remote.parent_session_id,
    // Self-declared, for grouping in the views only (#27): never read for routing or trust.
    lead_session_id: item.remote.lead_session_id,
    writer_version: WRITER_VERSION,
    envelope: ENVELOPE_VERSION,
  }
  for (const [key, value] of Object.entries(known)) if (value !== undefined) row[key] = value
  return row as ItemRow
}

/** FNV-1a over UTF-16 code units, from a given offset: 8 hex digits. */
const fnv = (text: string, offset: number): string => {
  let hash = offset >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * What the row for this item would hold, in 16 hex digits: two FNV-1a hashes
 * of the row's known fields in a fixed order. An item that would write the
 * same row has the same fingerprint.
 */
export function fingerprint(item: Item & Required<Pick<Item, 'remote'>>): string {
  const text = JSON.stringify(itemToRow(item))
  return fnv(text, 0x811c9dc5) + fnv(text, 0x050c5d1f)
}

/**
 * Whether an item is owed a push that keeps it from being pruned: it carries
 * its lineage, a row was written for it, and that row is not what the item
 * holds now. An item never written (no page linked yet) owes nothing: it is
 * pruned as any other, and the store simply never sees a finished item.
 */
export const owesPush = (item: Item): boolean =>
  item.remote !== undefined &&
  item.row !== undefined &&
  item.row.sent !== fingerprint(item as Item & Required<Pick<Item, 'remote'>>)

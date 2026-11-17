// Where a session's items are shown (#27): the heading the two views group
// them under, `lead_session_id` on each row. Pure; the store pass and the
// `humantray_config` tool use it.
//
// The rule, stated once: the override this session recorded with
// `humantray_config`, else the session that started it (its parent), else the
// session itself. There is no walk up the chain: a lead's own parent is the
// session that started the lead (in this repository's runs, the controller),
// so the top of a chain would group every batch under one heading.
//
// The value is self-declared and used for grouping in the views only. It
// routes no message and no trust check reads it, and it says nothing about
// whose instructions a session follows: that is the repository's AGENTS.md.

import type { ItemRow, LeadRecord, RemoteLineage } from '../types'
import { SESSION_ID } from './rows'

/** Where the shown heading came from. */
export type ShownFrom = 'config' | 'parent' | 'self'

/** The `$.store` key of a session's record, by its routable id (stable across a /clear or /branch). */
export const leadKey = (routable: string): string => `lead:${routable}`

/** What `humantray_config` was asked: to read, or to record `self`, an id or a clear. */
export type LeadInput =
  | { kind: 'read' }
  | { kind: 'self' }
  | { kind: 'id'; id: string }
  | { kind: 'clear' }
  | { kind: 'refused'; reason: string }

/**
 * Reads `humantray_config`'s input. A missing `lead` (or one given as
 * undefined) only reads; `null` is a clear; `"self"` and a routable
 * `session_…` id are recorded; anything else is refused.
 */
export function parseLeadInput(input: Record<string, unknown>): LeadInput {
  if (!('lead' in input) || input.lead === undefined) return { kind: 'read' }
  const lead = input.lead
  if (lead === null) return { kind: 'clear' }
  if (lead === 'self') return { kind: 'self' }
  if (typeof lead === 'string' && SESSION_ID.test(lead)) return { kind: 'id', id: lead }
  return { kind: 'refused', reason: 'lead must be "self", a routable session id (session_…), or null to clear' }
}

/** Whether a value read back from `$.store` is a record this module wrote. */
export function isLeadRecord(value: unknown): value is LeadRecord {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.lead === null || (typeof v.lead === 'string' && SESSION_ID.test(v.lead))) &&
    typeof v.at === 'number' &&
    (v.from === 'call' || v.from === 'restored')
  )
}

/** The heading this session's items are shown under, and where it came from. */
export function shownUnder(
  lineage: Pick<RemoteLineage, 'session_id' | 'parent_session_id'>,
  record: LeadRecord | undefined,
): { lead: string; from: ShownFrom } {
  if (record !== undefined && record.lead !== null) return { lead: record.lead, from: 'config' }
  if (lineage.parent_session_id !== null) return { lead: lineage.parent_session_id, from: 'parent' }
  return { lead: lineage.session_id, from: 'self' }
}

/**
 * Whether a replaced container should restore `self` from this session's
 * rows: only when the newest of them by `created` is shown under this
 * session's own id and the session has a parent (with none, `self` is the
 * default anyway). Nothing else is ever restored: not an explicit id, which
 * any holder of the store could have written into a forged row, and not a
 * heading an older row carries. The caller asks only when no record is kept,
 * so a clear made in this container is never undone. The one gap: a clear
 * followed by a replaced container, before any new item, brings `self` back.
 */
export function restoredSelf(rows: ItemRow[], routable: string, parent: string | null): boolean {
  if (parent === null) return false
  let newest: ItemRow | undefined
  for (const row of rows) {
    if (row.session_id !== routable) continue
    if (newest === undefined || row.created > newest.created) newest = row
  }
  return newest !== undefined && newest.lead_session_id === routable
}

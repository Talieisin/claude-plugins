// Where a session's items are shown (#27): the rule, the tool's input, and
// what a replaced container restores. Pure.

import { describe, expect, test } from 'claude-code/testing'

import type { ItemRow, LeadRecord } from '../types'
import { isLeadRecord, parseLeadInput, restoredSelf, shownUnder } from '../hooks/lineage'
import { LEAD, ME, OTHER } from './artifact-world'

const WITH_PARENT = { session_id: ME, parent_session_id: LEAD }
const NO_PARENT = { session_id: ME, parent_session_id: null }
const record = (lead: string | null): LeadRecord => ({ lead, at: 1, from: 'call' })

describe('shownUnder: the override, else the parent, else the session itself', () => {
  test('a session with no parent is shown under itself', () => {
    expect(shownUnder(NO_PARENT, undefined)).toEqual({ lead: ME, from: 'self' })
  })
  test('a session with a parent is shown under it', () => {
    expect(shownUnder(WITH_PARENT, undefined)).toEqual({ lead: LEAD, from: 'parent' })
  })
  test('a self record shows it under its own id', () => {
    expect(shownUnder(WITH_PARENT, record(ME))).toEqual({ lead: ME, from: 'config' })
  })
  test('a given id is used as given', () => {
    expect(shownUnder(WITH_PARENT, record(OTHER))).toEqual({ lead: OTHER, from: 'config' })
  })
  test('a cleared record falls back to the parent, or to the session itself', () => {
    expect(shownUnder(WITH_PARENT, record(null))).toEqual({ lead: LEAD, from: 'parent' })
    expect(shownUnder(NO_PARENT, record(null))).toEqual({ lead: ME, from: 'self' })
  })
})

describe("parseLeadInput: humantray_config's input", () => {
  test('a missing lead, or one given as undefined, only reads; null is a clear', () => {
    expect(parseLeadInput({})).toEqual({ kind: 'read' })
    expect(parseLeadInput({ lead: undefined })).toEqual({ kind: 'read' })
    expect(parseLeadInput({ lead: null })).toEqual({ kind: 'clear' })
  })
  test('"self" and a routable id are accepted', () => {
    expect(parseLeadInput({ lead: 'self' })).toEqual({ kind: 'self' })
    expect(parseLeadInput({ lead: OTHER })).toEqual({ kind: 'id', id: OTHER })
  })
  const refused: Array<[string, unknown]> = [
    ['an empty string', ''],
    ['"self " with a space', 'self '],
    ['"Self" in another case', 'Self'],
    ['a string that is not a session id', 'the lead'],
    ['a local session id', 'session-a'],
    ['a session id with a space', `${OTHER} `],
    ['a session id that is too long', `session_${'A'.repeat(65)}`],
    ['a number', 7],
    ['an object', { id: OTHER }],
    ['an array', [OTHER]],
  ]
  for (const [name, lead] of refused) {
    test(`refused: ${name}`, () => {
      expect(parseLeadInput({ lead }).kind).toBe('refused')
    })
  }
})

describe('isLeadRecord: only what this module writes is read back', () => {
  test('a record, a clear and a restored record are read', () => {
    expect(isLeadRecord(record(ME))).toBe(true)
    expect(isLeadRecord(record(null))).toBe(true)
    expect(isLeadRecord({ lead: ME, at: 1, from: 'restored' })).toBe(true)
  })
  test('anything else is not', () => {
    for (const bad of [undefined, null, 'self', { lead: 'self', at: 1, from: 'call' }, { lead: ME, from: 'call' }, { lead: ME, at: 1, from: 'x' }]) {
      expect(isLeadRecord(bad)).toBe(false)
    }
  })
})

describe('restoredSelf: what a replaced container takes back from its rows', () => {
  const row = (fields: Partial<ItemRow>): ItemRow =>
    ({ session_id: ME, created: 1, updated: 1, lead_session_id: LEAD, ...fields }) as ItemRow

  test('the newest row by created shown under the session itself: restored', () => {
    expect(restoredSelf([row({ created: 1 }), row({ created: 2, lead_session_id: ME })], ME, LEAD)).toBe(true)
  })
  test('the newest row agrees with the parent while an older one says self: nothing', () => {
    expect(restoredSelf([row({ created: 1, lead_session_id: ME }), row({ created: 2 })], ME, LEAD)).toBe(false)
  })
  test('an older row bumped later (a higher updated) says self: nothing, as newest is by created', () => {
    expect(restoredSelf([row({ created: 1, updated: 99, lead_session_id: ME }), row({ created: 2, updated: 2 })], ME, LEAD)).toBe(false)
  })
  test("the newest row's heading is null: nothing", () => {
    expect(restoredSelf([row({ created: 1, lead_session_id: ME }), row({ created: 2, lead_session_id: null })], ME, LEAD)).toBe(false)
  })
  test('the newest row names an explicit other id: nothing (only self is restored)', () => {
    expect(restoredSelf([row({ created: 2, lead_session_id: OTHER })], ME, LEAD)).toBe(false)
  })
  test("another session's rows are not read, even when newer", () => {
    expect(restoredSelf([row({ created: 1, lead_session_id: ME }), row({ created: 5, session_id: OTHER })], ME, LEAD)).toBe(true)
    expect(restoredSelf([row({ created: 5, session_id: OTHER, lead_session_id: ME })], ME, LEAD)).toBe(false)
  })
  test('no rows: nothing', () => {
    expect(restoredSelf([], ME, LEAD)).toBe(false)
  })
  test('a session with no parent restores nothing: self is its default', () => {
    expect(restoredSelf([row({ created: 2, lead_session_id: ME })], ME, null)).toBe(false)
  })
})

// Pure logic: validation, bumping, answers, the delivery line, ownership.
// Nothing here calls `$`, so every rule is the same in a hook and a test.

import type {
  Draft,
  Item,
  ItemOption,
  ItemResponse,
  ItemStatus,
  ItemType,
  SessionRecord,
  StoreFile,
} from '../types'

export const TYPES: readonly ItemType[] = ['ack', 'choice', 'question', 'do', 'approve']

export const LIMITS = {
  header: 12,
  question: 500,
  body_md: 20_000,
  key: 200,
  label: 60,
  description: 300,
  answer: 10_000,
} as const

/** A claim held longer than this by another module instance is dead. */
export const CLAIM_STALE_MS = 60_000
/** An owner with no successor, unseen this long, gives up its answers. */
export const ORPHAN_MS = 24 * 60 * 60 * 1000
/** Session records no item names, unseen this long, are dropped. */
export const SESSION_FORGET_MS = 7 * 24 * 60 * 60 * 1000

export const APPROVE_OPTIONS: readonly ItemOption[] = [
  { label: 'Approve', description: 'Go ahead as proposed.' },
  { label: 'Reject', description: 'Do not go ahead.' },
]

export const EMPTY_DRAFT: Draft = {
  selected: [],
  other: '',
  text: '',
  feedback: '',
  notes: '',
  error: '',
}

/** What `humantray_add` takes, once validated. */
export type AddInput = {
  type: ItemType
  header: string
  question: string
  body_md: string
  options?: ItemOption[]
  multiSelect?: boolean
  notes?: boolean
  key: string
  notify_on_done?: boolean
}

export type Checked<T> = { ok: T; error?: undefined } | { error: string; ok?: undefined }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Lowercased, whitespace collapsed and trimmed: the key a question implies. */
export const normaliseKey = (question: string): string =>
  question.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Checks a `humantray_add` call. Every refusal names what is wrong; a call
 * refused here writes nothing.
 */
export const validateAdd = (raw: Record<string, unknown>): Checked<AddInput> => {
  const { type, header, question, body_md, options, multiSelect, notes, key, notify_on_done } = raw

  if (typeof type !== 'string' || !(TYPES as readonly string[]).includes(type)) {
    return { error: `type must be one of ${TYPES.join(', ')}` }
  }
  const kind = type as ItemType
  if (typeof header !== 'string' || header.length < 1 || header.length > LIMITS.header) {
    return { error: `header must be 1 to ${LIMITS.header} characters` }
  }
  if (typeof question !== 'string' || question.trim() === '') {
    return { error: 'question must be a non-empty string' }
  }
  if (question.length > LIMITS.question) {
    return { error: `question must be at most ${LIMITS.question} characters` }
  }
  if (body_md !== undefined && typeof body_md !== 'string') {
    return { error: 'body_md must be a string' }
  }
  if (typeof body_md === 'string' && body_md.length > LIMITS.body_md) {
    return { error: `body_md must be at most ${LIMITS.body_md} characters` }
  }
  for (const [name, value] of [
    ['multiSelect', multiSelect],
    ['notes', notes],
    ['notify_on_done', notify_on_done],
  ] as const) {
    if (value !== undefined && typeof value !== 'boolean') {
      return { error: `${name} must be true or false` }
    }
  }
  if (key !== undefined && (typeof key !== 'string' || key.trim() === '')) {
    return { error: 'key must be a non-empty string' }
  }
  if (typeof key === 'string' && key.length > LIMITS.key) {
    return { error: `key must be at most ${LIMITS.key} characters` }
  }
  if (multiSelect !== undefined && kind !== 'choice') {
    return { error: 'multiSelect is for choice items only' }
  }

  let checkedOptions: ItemOption[] | undefined
  if (kind === 'choice') {
    if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
      return { error: 'a choice item needs options: 2 to 6, each { label, description }' }
    }
    checkedOptions = []
    const seen = new Set<string>()
    for (const option of options) {
      if (!isRecord(option) || typeof option.label !== 'string' || typeof option.description !== 'string') {
        return { error: 'each option must be { label, description }, both strings' }
      }
      const label = option.label.trim()
      if (label === '') return { error: 'an option label must not be empty' }
      if (label.length > LIMITS.label) {
        return { error: `an option label must be at most ${LIMITS.label} characters` }
      }
      if (option.description.length > LIMITS.description) {
        return { error: `an option description must be at most ${LIMITS.description} characters` }
      }
      if (label.toLowerCase() === 'other') {
        return { error: 'an option may not be labelled "Other": the card adds its own Other entry' }
      }
      if (seen.has(label.toLowerCase())) return { error: `option labels must be unique ("${label}" twice)` }
      seen.add(label.toLowerCase())
      checkedOptions.push({ label, description: option.description })
    }
  } else if (options !== undefined) {
    return {
      error:
        kind === 'approve'
          ? 'an approve item supplies its own options (Approve, Reject); leave options out'
          : `options are for choice items only, not ${kind}`,
    }
  }

  const input: AddInput = {
    type: kind,
    header,
    question,
    body_md: typeof body_md === 'string' ? body_md : '',
    key: typeof key === 'string' ? key : normaliseKey(question),
  }
  if (checkedOptions !== undefined) input.options = checkedOptions
  if (kind === 'approve') input.options = APPROVE_OPTIONS.map(o => ({ ...o }))
  if (typeof multiSelect === 'boolean') input.multiSelect = multiSelect
  if (typeof notes === 'boolean') input.notes = notes
  if (typeof notify_on_done === 'boolean') input.notify_on_done = notify_on_done
  return { ok: input }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A ULID: 10 characters of time, 16 of randomness. */
export const ulid = (now: number, random: Uint8Array): string => {
  let time = ''
  let t = Math.max(0, Math.floor(now))
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time
    t = Math.floor(t / 32)
  }
  let rest = ''
  for (let i = 0; i < 16; i++) rest += CROCKFORD[(random[i] ?? 0) % 32]
  return time + rest
}

export const shortOf = (id: string): string => `HT-${id.slice(-5)}`

/**
 * The repository an item belongs to: the remote as `host/owner/name`, with
 * any credentials, scheme and `.git` dropped; the root when there is none.
 */
export const normaliseRepo = (remote: string | null | undefined, root: string): string => {
  if (remote === null || remote === undefined || remote.trim() === '') return root
  let r = remote.trim()
  const scp = /^[^@/:]+@([^:/]+):(.+)$/.exec(r)
  if (scp) {
    r = `${scp[1]}/${scp[2]}`
  } else {
    r = r.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '')
  }
  return r.replace(/\.git$/, '').replace(/\/+$/, '')
}

/** Follows `successor` links to the session that now answers for `id`. */
export const resolveOwner = (sessions: Record<string, SessionRecord>, id: string): string => {
  const visited = new Set<string>()
  let current = id
  while (!visited.has(current)) {
    visited.add(current)
    const next = sessions[current]?.successor
    if (next === undefined) return current
    current = next
  }
  return current
}

/** Records that `me` was seen now, and that it took over from `previous`. */
export const noteSession = (
  file: StoreFile,
  me: string,
  previous: string | undefined,
  now: number,
): void => {
  if (previous !== undefined && previous !== me) {
    const old = file.sessions[previous] ?? { seen: now }
    file.sessions[previous] = { ...old, successor: me }
  }
  // A session seen again (a resume back to it) answers for itself once more,
  // so any successor it had is dropped: no chain can loop through it.
  file.sessions[me] = { seen: now }
  for (const [id, record] of Object.entries(file.sessions)) {
    if (id === me) continue
    const isNamed = file.items.some(item => item.session_id === id)
    if (!isNamed && now - record.seen > SESSION_FORGET_MS) delete file.sessions[id]
  }
}

/** Whether `me` should deliver this item's answer now. */
export const isMineToDeliver = (file: StoreFile, item: Item, me: string, now: number): boolean => {
  const owner = resolveOwner(file.sessions, item.session_id)
  if (owner === me) return true
  const seen = file.sessions[owner]?.seen ?? item.updated
  return now - seen > ORPHAN_MS
}

/** Open items, the most recently added or bumped first. */
export const openItems = (file: StoreFile): Item[] =>
  file.items.filter(item => item.status === 'open').sort((a, b) => b.updated - a.updated)

export type AddOutcome = { item: Item; bumped: boolean }

/**
 * Adds an item to the file, or bumps the open one with the same
 * (repo, session_id, key). A bump of another type is refused.
 */
export const addOrBump = (
  file: StoreFile,
  input: AddInput,
  context: { repo: string; session_id: string; now: number; id: string },
): Checked<AddOutcome> => {
  const existing = file.items.find(
    item =>
      item.status === 'open' &&
      item.repo === context.repo &&
      item.session_id === context.session_id &&
      item.key === input.key,
  )
  if (existing !== undefined) {
    if (existing.type !== input.type) {
      return {
        error: `an open ${existing.type} item (${existing.short}) already has this key; use another key, or the same type to bump it`,
      }
    }
    existing.body_md = input.body_md
    if (input.options !== undefined) existing.options = input.options
    else delete existing.options
    existing.bumps += 1
    existing.updated = Math.max(context.now, existing.updated + 1)
    return { ok: { item: existing, bumped: true } }
  }
  const item: Item = {
    id: context.id,
    short: shortOf(context.id),
    repo: context.repo,
    session_id: context.session_id,
    type: input.type,
    header: input.header,
    question: input.question,
    body_md: input.body_md,
    key: input.key,
    created: context.now,
    updated: context.now,
    bumps: 0,
    status: 'open',
    delivered: false,
    origin: 'local',
  }
  if (input.options !== undefined) item.options = input.options
  if (input.multiSelect !== undefined) item.multiSelect = input.multiSelect
  if (input.notes !== undefined) item.notes = input.notes
  if (input.notify_on_done !== undefined) item.notify_on_done = input.notify_on_done
  file.items.push(item)
  return { ok: { item, bumped: false } }
}

/** What a card's control asks for. */
export type Action =
  | { kind: 'ack' }
  | { kind: 'submit' }
  | { kind: 'do'; outcome: 'done' | 'not_done' }
  | { kind: 'approve'; choice: 'Approve' | 'Reject' }

const trimmed = (text: string): string | undefined => {
  const t = text.trim()
  return t === '' ? undefined : t
}

const tooLong = (draft: Draft): boolean =>
  [draft.other, draft.text, draft.feedback, draft.notes].some(t => t.length > LIMITS.answer)

/**
 * Turns a card's draft and the control pressed into the stored response, or
 * says why it cannot be stored (shown on the card; nothing is written).
 */
export const buildResponse = (
  item: Item,
  draft: Draft,
  action: Action,
): Checked<{ response: ItemResponse; status: ItemStatus }> => {
  if (tooLong(draft)) return { error: `An answer can be at most ${LIMITS.answer} characters.` }
  const notes = item.notes === true ? trimmed(draft.notes) : undefined
  const withNotes = <R extends ItemResponse>(r: R): R => (notes === undefined ? r : { ...r, notes })

  switch (item.type) {
    case 'ack':
      if (action.kind !== 'ack') return { error: 'Press Acknowledge.' }
      return { ok: { response: withNotes({ acknowledged: true }), status: 'acknowledged' } }
    case 'do': {
      if (action.kind !== 'do') return { error: 'Press Done or Not done.' }
      const feedback = trimmed(draft.feedback)
      const response: ItemResponse = { outcome: action.outcome }
      if (feedback !== undefined) response.feedback = feedback
      return { ok: { response: withNotes(response), status: 'done' } }
    }
    case 'approve':
      if (action.kind !== 'approve') return { error: 'Press Approve or Reject.' }
      return { ok: { response: withNotes({ selected: [action.choice] }), status: 'answered' } }
    case 'question': {
      if (action.kind !== 'submit') return { error: 'Press Submit.' }
      const text = trimmed(draft.text)
      if (text === undefined) return { error: 'Type an answer.' }
      return { ok: { response: withNotes({ text }), status: 'answered' } }
    }
    case 'choice': {
      if (action.kind !== 'submit') return { error: 'Press Submit.' }
      const labels = new Set((item.options ?? []).map(o => o.label))
      let selected = draft.selected.filter(label => labels.has(label))
      const other = trimmed(draft.other)
      if (item.multiSelect !== true) {
        if (other !== undefined) selected = []
        else selected = selected.slice(0, 1)
      }
      if (selected.length === 0 && other === undefined) {
        return { error: 'Pick an option or fill in Other.' }
      }
      const response: { selected: string[]; other?: string } = { selected }
      if (other !== undefined) response.other = other
      return { ok: { response: withNotes(response), status: 'answered' } }
    }
  }
}

/** One line: every line break and the space around it becomes ` / `. */
const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' / ').trim()

/** The answer in a few words, for the delivery line. */
export const summaryOf = (item: Item): string => {
  const r = item.response
  if (r === undefined) return ''
  let summary: string
  if ('acknowledged' in r) summary = 'acknowledged'
  else if ('outcome' in r) {
    summary = r.outcome === 'done' ? 'done' : 'not done'
    if (r.feedback !== undefined) summary += `: ${r.feedback}`
  } else if ('text' in r) summary = r.text
  else {
    const parts = [...r.selected]
    if (r.other !== undefined) parts.push(`Other: ${r.other}`)
    summary = parts.join('; ')
  }
  if (r.notes !== undefined) summary += ` | notes: ${r.notes}`
  return oneLine(summary)
}

/** The line a session receives: `humantray HT-xxxxx (<header>): <summary>`. */
export const deliveryLine = (item: Item): string =>
  `humantray ${item.short} (${oneLine(item.header)}): ${summaryOf(item)}`

/** Reads a parsed `items.json`, or says why it is not one this version can use. */
export const checkStoreFile = (parsed: unknown): Checked<StoreFile> => {
  if (!isRecord(parsed)) return { error: 'not a JSON object' }
  if (parsed.version !== 1) return { error: `version ${String(parsed.version)}, not 1` }
  if (!Array.isArray(parsed.items)) return { error: 'items is not a list' }
  for (const item of parsed.items) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.status !== 'string') {
      return { error: 'an item is not a record with an id and a status' }
    }
  }
  const sessions = parsed.sessions === undefined ? {} : parsed.sessions
  if (!isRecord(sessions)) return { error: 'sessions is not an object' }
  return {
    ok: {
      version: 1,
      items: parsed.items as Item[],
      sessions: sessions as Record<string, SessionRecord>,
    },
  }
}

export const emptyStore = (): StoreFile => ({ version: 1, items: [], sessions: {} })

// Pure logic: validation, bumping, answers, the delivery line, ownership,
// pruning and History.
// Nothing here calls `$`, so every rule is the same in a hook and a test.

import type {
  DeliveryMark,
  Draft,
  HistoryEntry,
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
/** Session records no item names, unseen this long, are dropped. */
export const SESSION_FORGET_MS = 7 * 24 * 60 * 60 * 1000
/** Finished items kept per repository; older finished items are pruned. */
export const KEEP_PER_REPO = 200

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
  if (notify_on_done !== undefined && kind !== 'ack') {
    return { error: 'notify_on_done is for ack items only' }
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

/** Every session id an item's owner chain runs through, its own included. */
export const chainsInUse = (file: StoreFile): Set<string> => {
  const used = new Set<string>()
  for (const item of file.items) {
    let current: string | undefined = item.session_id
    while (current !== undefined && !used.has(current)) {
      used.add(current)
      current = file.sessions[current]?.successor
    }
  }
  return used
}

/**
 * Records that `me` was seen now and, after a /clear or a /branch in this
 * process, that it took over from `handoverFrom`. A record is dropped only
 * when it is old and no item's owner chain runs through it.
 */
export const noteSession = (file: StoreFile, me: string, now: number, handoverFrom?: string): void => {
  if (handoverFrom !== undefined && handoverFrom !== me) {
    const old = file.sessions[handoverFrom] ?? { seen: now }
    file.sessions[handoverFrom] = { ...old, successor: me }
  }
  // A session seen again (a resume back to it) answers for itself once more,
  // so any successor it had is dropped: no chain can loop through it.
  file.sessions[me] = { seen: now }
  const used = chainsInUse(file)
  for (const [id, record] of Object.entries(file.sessions)) {
    if (id === me || used.has(id)) continue
    if (now - record.seen > SESSION_FORGET_MS) delete file.sessions[id]
  }
}

/**
 * Whether `me` delivers this item's answer: only the session that owns it,
 * or that session's successor. Nobody else ever takes an answer over.
 */
export const isMineToDeliver = (file: StoreFile, item: Item, me: string): boolean =>
  resolveOwner(file.sessions, item.session_id) === me

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

/** The answer in a few words, without its notes. */
const rawAnswer = (item: Item): string => {
  const r = item.response
  if (r === undefined) return ''
  if ('acknowledged' in r) return 'acknowledged'
  if ('outcome' in r) {
    const outcome = r.outcome === 'done' ? 'done' : 'not done'
    return r.feedback === undefined ? outcome : `${outcome}: ${r.feedback}`
  }
  if ('text' in r) return r.text
  const parts = [...r.selected]
  if (r.other !== undefined) parts.push(`Other: ${r.other}`)
  return parts.join('; ')
}

/** The answer in a few words, on one line, without its notes (History shows them apart). */
export const answerText = (item: Item): string => oneLine(rawAnswer(item))

/** The answer in a few words, for the delivery line. */
export const summaryOf = (item: Item): string => {
  const r = item.response
  if (r === undefined) return ''
  let summary = rawAnswer(item)
  if (r.notes !== undefined) summary += ` | notes: ${r.notes}`
  return oneLine(summary)
}

/** The line a session receives: `humantray HT-xxxxx (<header>): <summary>`. */
export const deliveryLine = (item: Item): string =>
  `humantray ${item.short} (${oneLine(item.header)}): ${summaryOf(item)}`

/**
 * Whether an answered item owes its session a line. Every answered item does,
 * except an `ack` raised without `notify_on_done`: that one is only flagged.
 */
export const isLineDue = (item: Item): boolean =>
  item.status !== 'open' && !(item.type === 'ack' && item.notify_on_done !== true)

/**
 * The one test of whether an item may be pruned. It may when it is finished:
 * answered, carrying no claim, and either delivered or owing no line. Such an
 * item is in a terminal state: no code path changes it again, nor its order
 * key, so a prune decided on any read is still right when it is written.
 */
export const isPrunable = (item: Item): boolean =>
  item.status !== 'open' &&
  item.delivering_at === undefined &&
  item.delivering_by === undefined &&
  (item.delivered || !isLineDue(item))

/** When an item last changed for good: its answer, or else its last add or bump. */
export const orderKey = (item: Item): number => item.response_at ?? item.updated

/** Older first: by order key, then by id. Always a total order (never NaN). */
export const compareAge = (a: Item, b: Item): number => {
  const ka = orderKey(a)
  const kb = orderKey(b)
  if (ka !== kb) return ka < kb ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Keeps the newest KEEP_PER_REPO prunable items of each `repo` value and
 * removes the older ones. Items that are not prunable neither count nor go.
 * Session records are never touched. Returns the ids removed.
 */
export const prune = (file: StoreFile, keep: number = KEEP_PER_REPO): string[] => {
  const groups = new Map<string, Item[]>()
  for (const item of file.items) {
    if (!isPrunable(item)) continue
    const group = groups.get(item.repo)
    if (group === undefined) groups.set(item.repo, [item])
    else group.push(item)
  }
  const removed = new Set<string>()
  for (const group of groups.values()) {
    if (group.length <= keep) continue
    group.sort(compareAge)
    for (const item of group.slice(0, group.length - keep)) removed.add(item.id)
  }
  if (removed.size > 0) file.items = file.items.filter(item => !removed.has(item.id))
  return [...removed]
}

/**
 * What History marks an answered item with: nothing when no line is due;
 * `delivered`; `delivering` while a claim younger than CLAIM_STALE_MS stands;
 * else `not delivered` (an owner yet to collect it, or one that never will).
 */
export const deliveryMark = (item: Item, now: number): DeliveryMark => {
  if (!isLineDue(item)) return 'none'
  if (item.delivered) return 'delivered'
  if (item.delivering_at !== undefined && now - item.delivering_at < CLAIM_STALE_MS) return 'delivering'
  return 'not delivered'
}

/**
 * The answered items of `repo`, from every session, newest first, as History
 * draws them. An item is this session's when its owner chain ends at `me`.
 */
export const historyOf = (file: StoreFile, repo: string, me: string, now: number): HistoryEntry[] =>
  file.items
    .filter(item => item.status !== 'open' && item.repo === repo)
    .sort((a, b) => compareAge(b, a))
    .map(item => {
      const entry: HistoryEntry = {
        id: item.id,
        short: item.short,
        type: item.type,
        header: item.header,
        question: item.question,
        status: item.status,
        answer: answerText(item),
        bumps: item.bumps,
        at: orderKey(item),
        mark: deliveryMark(item, now),
        isMine: resolveOwner(file.sessions, item.session_id) === me,
      }
      const notes = item.response?.notes
      if (notes !== undefined) entry.notes = oneLine(notes)
      return entry
    })

/**
 * Applies a finished submit to the item, only while the item still carries
 * that send's claim: a late settle never touches a newer claim, and one for
 * an item no longer in the store does nothing.
 */
export function applySettle(file: StoreFile, id: string, claim: string, entered: boolean, now: number): boolean {
  const item = file.items.find(one => one.id === id)
  if (item === undefined || item.delivering_by !== claim) return false
  if (entered) {
    item.delivered = true
    item.delivered_at = now
  }
  delete item.delivering_at
  delete item.delivering_by
  return true
}

const STATUSES: readonly string[] = ['open', 'acknowledged', 'done', 'answered']

const isOptional = (v: unknown, kind: 'string' | 'number' | 'boolean') => v === undefined || typeof v === kind

const isOptionList = (v: unknown): boolean =>
  Array.isArray(v) && v.every(o => isRecord(o) && typeof o.label === 'string' && typeof o.description === 'string')

/** Whether a stored response has the shape its item's type gives it. */
const isResponseOf = (type: string, r: unknown): boolean => {
  if (!isRecord(r) || !isOptional(r.notes, 'string')) return false
  switch (type) {
    case 'ack':
      return r.acknowledged === true
    case 'question':
      return typeof r.text === 'string'
    case 'do':
      return (r.outcome === 'done' || r.outcome === 'not_done') && isOptional(r.feedback, 'string')
    default:
      return Array.isArray(r.selected) && r.selected.every(l => typeof l === 'string') && isOptional(r.other, 'string')
  }
}

/** Why a stored item is not one this version can use, or undefined when it is. */
const itemProblem = (item: unknown): string | undefined => {
  if (!isRecord(item)) return 'an item is not an object'
  const name = typeof item.id === 'string' ? item.id : '(no id)'
  for (const field of ['id', 'short', 'repo', 'session_id', 'header', 'question', 'body_md', 'key'] as const) {
    if (typeof item[field] !== 'string') return `item ${name}: ${field} is not a string`
  }
  for (const field of ['created', 'updated', 'bumps'] as const) {
    if (typeof item[field] !== 'number') return `item ${name}: ${field} is not a number`
  }
  if (typeof item.type !== 'string' || !(TYPES as readonly string[]).includes(item.type)) {
    return `item ${name}: unknown type`
  }
  if (typeof item.status !== 'string' || !STATUSES.includes(item.status)) return `item ${name}: unknown status`
  if (typeof item.delivered !== 'boolean') return `item ${name}: delivered is not true or false`
  if (item.origin !== 'local' && item.origin !== 'relayed') return `item ${name}: unknown origin`
  if (item.options !== undefined && !isOptionList(item.options)) return `item ${name}: options are malformed`
  if ((item.type === 'choice' || item.type === 'approve') && item.options === undefined) {
    return `item ${name}: options are missing`
  }
  for (const field of ['multiSelect', 'notes', 'notify_on_done'] as const) {
    if (!isOptional(item[field], 'boolean')) return `item ${name}: ${field} is not true or false`
  }
  for (const field of ['response_at', 'delivered_at', 'delivering_at'] as const) {
    if (!isOptional(item[field], 'number')) return `item ${name}: ${field} is not a number`
  }
  if (!isOptional(item.delivering_by, 'string') || !isOptional(item.lead_id, 'string')) {
    return `item ${name}: a session field is not a string`
  }
  if (item.status !== 'open' && !isResponseOf(item.type, item.response)) {
    return `item ${name}: the response is missing or malformed`
  }
  return undefined
}

/** Reads a parsed `items.json`, or says why it is not one this version can use. */
export const checkStoreFile = (parsed: unknown): Checked<StoreFile> => {
  if (!isRecord(parsed)) return { error: 'not a JSON object' }
  if (parsed.version !== 1) return { error: `version ${String(parsed.version)}, not 1` }
  if (!Array.isArray(parsed.items)) return { error: 'items is not a list' }
  for (const item of parsed.items) {
    const problem = itemProblem(item)
    if (problem !== undefined) return { error: problem }
  }
  const sessions = parsed.sessions === undefined ? {} : parsed.sessions
  if (!isRecord(sessions)) return { error: 'sessions is not an object' }
  for (const [id, record] of Object.entries(sessions)) {
    if (!isRecord(record) || typeof record.seen !== 'number' || !isOptional(record.successor, 'string')) {
      return { error: `session ${id}: malformed` }
    }
  }
  return {
    ok: {
      version: 1,
      items: parsed.items as Item[],
      sessions: sessions as Record<string, SessionRecord>,
    },
  }
}

export const emptyStore = (): StoreFile => ({ version: 1, items: [], sessions: {} })

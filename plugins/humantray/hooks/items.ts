// Pure logic: validation, bumping, answers, the delivery line, ownership,
// pruning and History.
// Nothing here calls `$`, so every rule is the same in a hook and a test.

import type {
  DeliveryMark,
  Draft,
  HistoryEntry,
  HistoryFull,
  Item,
  ItemOption,
  ItemResponse,
  ItemStatus,
  ItemType,
  PartLabel,
  SessionRecord,
  StoreFile,
  TrayKind,
} from '../types'
import { owesPush } from './row-shape'
import { UNSAFE, codeBlocksOf, listedLang, placedBlocksOf, splitLines } from './code'

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
  entered: 0,
  codeAt: 0,
  otherOpen: false,
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

/** The most characters of a session's title that are kept and drawn (#75). */
export const TITLE_MAX = 60

/**
 * A session's title as it is kept and drawn (#75): control and line
 * separator characters become spaces; format characters (bidi controls,
 * zero-width ones) and lone surrogates are dropped; runs of space become one,
 * the ends are trimmed, and it is cut to TITLE_MAX characters, never inside
 * one. Undefined when nothing is left, or for anything not a string.
 */
export const cleanTitle = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined
  const text = raw
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    // With the u flag a paired surrogate is one astral character, so this range matches lone ones only.
    .replace(/\p{Cf}|[\ud800-\udfff]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text === '') return undefined
  const chars = Array.from(text)
  return chars.length <= TITLE_MAX ? text : `${chars.slice(0, TITLE_MAX - 1).join('')}…`
}

/**
 * Records that `me` was seen now and, after a /clear or a /branch in this
 * process, that it took over from `handoverFrom`. A record is dropped only
 * when it is old and no item's owner chain runs through it. `title`: the
 * title heard for `me` itself (#75), cleaned; with none, the record keeps the
 * title it had.
 */
export const noteSession = (file: StoreFile, me: string, now: number, handoverFrom?: string, title?: string): void => {
  if (handoverFrom !== undefined && handoverFrom !== me) {
    const old = file.sessions[handoverFrom] ?? { seen: now }
    file.sessions[handoverFrom] = { ...old, successor: me }
  }
  // A session seen again (a resume back to it) answers for itself once more,
  // so any successor it had is dropped: no chain can loop through it.
  const kept = cleanTitle(title) ?? cleanTitle(file.sessions[me]?.title)
  file.sessions[me] = kept === undefined ? { seen: now } : { seen: now, title: kept }
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

/**
 * Who asked an item, as its card's origin line says it (#75): `this session`
 * for an item this session owns or inherited; otherwise the asking session's
 * title (from `get_session` for a cloud item, else the title recorded for the
 * session that now owns it, else for the session that raised it), or
 * `another session` when no title is known. No role is drawn: the lineage a
 * cloud item carries is self-declared and for grouping only (lineage.ts), and
 * a local item carries none.
 */
export const originOf = (file: StoreFile, item: Item, me: string): string => {
  const owner = resolveOwner(file.sessions, item.session_id)
  if (owner === me) return 'this session'
  return (
    cleanTitle(item.remote?.session_title) ??
    cleanTitle(file.sessions[owner]?.title) ??
    cleanTitle(file.sessions[item.session_id]?.title) ??
    'another session'
  )
}

/** Which kind each type is listed under (#75), as the page's chips group them (page.ts, KIND_OF). */
export const KIND_OF: Record<ItemType, Exclude<TrayKind, 'all'>> = {
  choice: 'question',
  question: 'question',
  do: 'todo',
  approve: 'todo',
  ack: 'fyi',
}

/** The type chips, in order, with their labels (#75), as on the page. */
export const KINDS: ReadonlyArray<readonly [TrayKind, string]> = [
  ['all', 'All'],
  ['question', 'Questions'],
  ['todo', 'To-dos'],
  ['fyi', 'FYIs'],
]

/** Whether a type is listed under a chip. */
export const inKind = (type: ItemType, kind: TrayKind): boolean => kind === 'all' || KIND_OF[type] === kind

/** How many of `types` each chip lists, in KINDS' order. */
export const kindCounts = (types: readonly ItemType[]): Record<TrayKind, number> => {
  const counts: Record<TrayKind, number> = { all: types.length, question: 0, todo: 0, fyi: 0 }
  for (const type of types) counts[KIND_OF[type]] += 1
  return counts
}

/** What a filtered empty list says: `No open items.`, `No answered to-dos yet.` and so on. */
export const noneOf = (kind: TrayKind, list: 'open' | 'answered'): string => {
  const what = kind === 'all' ? 'items' : kind === 'question' ? 'questions' : kind === 'todo' ? 'to-dos' : 'FYIs'
  return list === 'open' ? `No open ${what}.` : `No answered ${what} yet.`
}

/**
 * The repository as the pane's title names it (#75): `owner/name` for a
 * hosted remote (`host/owner/name`), else the value as it is (a local root).
 */
export const repoLabel = (repo: string): string => {
  const hosted = /^[^/\s]+\.[^/\s]+\/(.+)$/.exec(repo)
  return hosted?.[1] ?? repo
}

/**
 * A time as UTC to the minute. A time no Date can hold (another writer's bad
 * value) reads as a placeholder, never throws.
 */
export const when = (at: number): string => {
  const date = new Date(at)
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'at an unknown time'
}

/** Open items, the most recently added or bumped first. */
export const openItems = (file: StoreFile): Item[] =>
  file.items.filter(item => item.status === 'open').sort((a, b) => b.updated - a.updated)

export type AddOutcome = { item: Item; bumped: boolean }

/**
 * Adds an item to the file, or bumps the open one with the same repo and key
 * whose owner chain ends at this session: its own, or one it took over after
 * a /clear or a /branch (never a /resume, which records no succession). The
 * bumped item keeps its original session_id; delivery follows the chain to
 * this session. If any such open item has another type, the add is refused.
 */
export const addOrBump = (
  file: StoreFile,
  input: AddInput,
  context: { repo: string; session_id: string; now: number; id: string },
): Checked<AddOutcome> => {
  const matches = file.items.filter(
    item =>
      item.status === 'open' &&
      item.repo === context.repo &&
      item.key === input.key &&
      resolveOwner(file.sessions, item.session_id) === context.session_id,
  )
  const conflict = matches.find(item => item.type !== input.type)
  if (conflict !== undefined) {
    return {
      error: `an open ${conflict.type} item (${conflict.short}) already has this key; use another key, or the same type to bump it`,
    }
  }
  // A store written before bumps followed the chain can hold several open
  // items under one key in one chain (one added before a /clear, one after).
  // The newest by `updated` is bumped (on a tie, the larger id); the rest are
  // left as they are.
  const existing = matches.reduce<Item | undefined>(
    (newest, item) =>
      newest === undefined || item.updated > newest.updated || (item.updated === newest.updated && item.id > newest.id)
        ? item
        : newest,
    undefined,
  )
  if (existing !== undefined) {
    existing.body_md = input.body_md
    if (input.options !== undefined) existing.options = input.options
    else delete existing.options
    // An approve item raised again by 0.2.7 or later offers notes too (#75).
    if (existing.type === 'approve') existing.notes = true
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
  // An approve item always offers notes (#75): Approve or Reject, and why.
  // Set here, where it is raised, so every view and version draws and keeps them.
  if (input.type === 'approve') item.notes = true
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

/**
 * A free-text field as typed, or undefined when it holds nothing but space:
 * never trimmed, so the person's Markdown (indented code, line breaks) is
 * stored as they wrote it. The page does the same (page.ts, `typed`).
 */
const typed = (text: string): string | undefined => (text.trim() === '' ? undefined : text)

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
  const notes = item.notes === true ? typed(draft.notes) : undefined
  const withNotes = <R extends ItemResponse>(r: R): R => (notes === undefined ? r : { ...r, notes })

  switch (item.type) {
    case 'ack':
      if (action.kind !== 'ack') return { error: 'Press Acknowledge.' }
      return { ok: { response: withNotes({ acknowledged: true }), status: 'acknowledged' } }
    case 'do': {
      if (action.kind !== 'do') return { error: 'Press Done or Not done.' }
      const feedback = typed(draft.feedback)
      const response: ItemResponse = { outcome: action.outcome }
      if (feedback !== undefined) response.feedback = feedback
      return { ok: { response: withNotes(response), status: 'done' } }
    }
    case 'approve':
      if (action.kind !== 'approve') return { error: 'Press Approve or Reject.' }
      return { ok: { response: withNotes({ selected: [action.choice] }), status: 'answered' } }
    case 'question': {
      if (action.kind !== 'submit') return { error: 'Press Submit.' }
      const text = typed(draft.text)
      if (text === undefined) return { error: 'Type an answer.' }
      return { ok: { response: withNotes({ text }), status: 'answered' } }
    }
    case 'choice': {
      if (action.kind !== 'submit') return { error: 'Press Submit.' }
      const labels = new Set((item.options ?? []).map(o => o.label))
      let selected = draft.selected.filter(label => labels.has(label))
      const other = typed(draft.other)
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

const isText = (v: unknown): v is string => typeof v === 'string'

/**
 * What was chosen, in a few words and with no free text: `acknowledged`,
 * `done` or `not done`, the options picked (and `Other` when it was filled
 * in), or `answered` for a question, whose text follows as a part. Read by the
 * item's type, from that type's own fields only, so a stray or wrongly typed
 * field (an adopted row may carry one) changes nothing.
 */
export const choiceOf = (item: Item): string => {
  const r = item.response as Record<string, unknown> | undefined
  if (r === undefined) return ''
  switch (item.type) {
    case 'ack':
      return 'acknowledged'
    case 'do':
      return r.outcome === 'done' ? 'done' : 'not done'
    case 'question':
      return 'answered'
    default: {
      const picked = Array.isArray(r.selected) ? r.selected.filter(isText) : []
      if (isText(r.other) && r.other.trim() !== '') picked.push('Other')
      return picked.join('; ')
    }
  }
}

/** Each free-text field a type's response has, with the label it is shown under. */
const FIELDS: Record<ItemType, Array<{ field: 'text' | 'other' | 'feedback'; label: PartLabel }>> = {
  ack: [],
  question: [{ field: 'text', label: 'Answer' }],
  choice: [{ field: 'other', label: 'Other' }],
  approve: [{ field: 'other', label: 'Other' }],
  do: [{ field: 'feedback', label: 'Feedback' }],
}

/**
 * The free-text parts of a response, exactly as stored, in a fixed order: the
 * answer, Other or the feedback first, then the notes. Only the fields the
 * item's type has, and only strings, are read; blank parts are left out.
 */
export const partsOf = (item: Item): Array<{ label: PartLabel; text: string }> => {
  const r = item.response as Record<string, unknown> | undefined
  if (r === undefined) return []
  const parts: Array<{ label: PartLabel; text: string }> = []
  const add = (label: PartLabel, text: unknown) => {
    if (isText(text) && text.trim() !== '') parts.push({ label, text })
  }
  for (const { field, label } of FIELDS[item.type] ?? []) add(label, r[field])
  add('Notes', r.notes)
  return parts
}

/** The name each part's block carries in the delivered answer. */
const PART_NAMES: Record<PartLabel, string> = { Answer: 'answer', Other: 'other', Feedback: 'feedback', Notes: 'notes' }

/**
 * What a session receives, in one submit. The first line is always
 * `humantray HT-xxxxx (<header>): <what was chosen>`, and it alone names the
 * item. Each free-text part follows after a blank line, inside its own block,
 * `<humantray-text item="HT-xxxxx" part="answer|other|feedback|notes">` to
 * `</humantray-text>`, so that nothing a person types can read as a second
 * `humantray HT-` line or as one of the mod's own labels. Inside a block the
 * text is exactly as typed, except that a closing tag in it is escaped
 * (`<\/humantray-text`), so a block always ends where the mod ended it.
 */
export const deliveryText = (item: Item): string => {
  const first = `humantray ${item.short} (${oneLine(item.header)}): ${oneLine(choiceOf(item))}`
  const blocks = partsOf(item).map(part => {
    const text = part.text.replace(/<\/(humantray-text)/gi, '<\\/$1')
    return `\n\n<humantray-text item="${item.short}" part="${PART_NAMES[part.label]}">\n${text}\n</humantray-text>`
  })
  return [first, ...blocks].join('')
}

/**
 * Whether an answered item owes its session a line. Every answered item does,
 * except an `ack` raised without `notify_on_done`: that one is only flagged.
 */
export const isLineDue = (item: Item): boolean =>
  item.status !== 'open' && !(item.type === 'ack' && item.notify_on_done !== true)

/**
 * The one test of whether an item may be pruned. It may when it is finished:
 * answered, carrying no claim, either delivered or owing no line, and owing
 * the store no push. Such an
 * item stays prunable and its order key never moves: no code path makes it
 * open, owed or claimed again. One write still reaches it: the owner's pass
 * flags an acknowledged `ack` that owes no line as `delivered`, which leaves
 * it prunable. So a prune decided on any read is still right when written.
 */
export const isPrunable = (item: Item): boolean =>
  item.status !== 'open' &&
  item.delivering_at === undefined &&
  item.delivering_by === undefined &&
  (item.delivered || !isLineDue(item)) &&
  // An item mirrored to the store whose last state was not written there yet
  // is kept until it is: pruning it would leave its row open for good.
  !owesPush(item)

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
  // The chosen records themselves, not their ids: two records sharing an id
  // (a hand-edited or merged store) must not take a protected one with them.
  const removed = new Set<Item>()
  for (const group of groups.values()) {
    if (group.length <= keep) continue
    group.sort(compareAge)
    for (const item of group.slice(0, group.length - keep)) removed.add(item)
  }
  if (removed.size > 0) file.items = file.items.filter(item => !removed.has(item))
  return [...removed].map(item => item.id)
}

/**
 * What History marks an answered item with: nothing when no line is due;
 * `delivered`; `delivering` while a claim younger than CLAIM_STALE_MS stands;
 * else `not delivered` (an owner yet to collect it, or one that never will).
 */
export const deliveryMark = (item: Item, now: number): DeliveryMark => {
  if (!isLineDue(item)) return 'none'
  if (item.delivered) return 'delivered'
  if (item.delivering_at !== undefined && now - item.delivering_at <= CLAIM_STALE_MS) return 'delivering'
  return 'not delivered'
}

/** History entries drawn per page: 50 clipped entries stay well inside what a surface draws. */
export const HISTORY_PAGE = 50

/**
 * The most characters History draws of an entry's question, and of each of its
 * free-text parts, in the list. The question (plain text) is cut with an
 * ellipsis; a part is cut only between Markdown blocks (`clipBlocks`). The
 * store keeps the whole, and "Show in full" draws it.
 */
export const HISTORY_CLIP = { question: 200, part: 500 } as const

/** Text cut to `max` characters, ending in an ellipsis when cut. */
export const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

/**
 * The mark of a line that opens a fenced code block (in a list or a quote
 * too), or undefined. A backtick fence's info string holds no backtick, so
 * three backticks with text and more backticks after are a code span.
 */
const opens = (line: string): string | undefined => {
  const found = /^[ \t>]*(?:(`{3,})[^`]*|(~{3,}).*)$/.exec(line)
  return found?.[1] ?? found?.[2]
}

/** Whether `line` closes the fence `opened`: the same mark, at least as long, and nothing after it. */
const closes = (line: string, opened: string): boolean => {
  const mark = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1]
  return mark !== undefined && mark[0] === opened[0] && mark.length >= opened.length
}

/** A list item's first line: a bullet or a number, then a space or the line's end. */
const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/
/** A quoted line. */
const QUOTE = /^ {0,3}>/

/**
 * Markdown split into its top-level blocks: runs of lines separated by blank
 * lines. A fenced code block (blank lines and all) stays inside one block; so
 * does an indented line after a blank (a list item's next paragraph, or an
 * indented code block); so does a loose list (an item after a blank, in a
 * block that began as a list) and a quote (a quoted line after a blank, in a
 * block that began as a quote). Blocks are returned without the blank lines
 * between them.
 */
export const blocksOf = (md: string): string[] => {
  const lines = md.split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let gap: string[] = []
  let fence: string | undefined
  for (const line of lines) {
    if (fence !== undefined) {
      current.push(line)
      if (closes(line, fence)) fence = undefined
      continue
    }
    if (line.trim() === '') {
      if (current.length > 0) gap.push(line)
      continue
    }
    const head = current[0] ?? ''
    const continues =
      gap.length > 0 &&
      (/^(?: {2,}|\t)/.test(line) || (LIST_ITEM.test(line) && LIST_ITEM.test(head)) || (QUOTE.test(line) && QUOTE.test(head)))
    if (gap.length > 0 && !continues) {
      blocks.push(current.join('\n'))
      current = []
      gap = []
    } else if (gap.length > 0) {
      current.push(...gap)
      gap = []
    }
    current.push(line)
    fence = opens(line)
  }
  if (current.length > 0) blocks.push(current.join('\n'))
  return blocks
}

/**
 * Whether one line of a block is plain paragraph text: not a list item, a
 * quote, a heading, a table row, a tag, a rule or setext underline, or a fence.
 */
const isParagraphLine = (line: string): boolean =>
  line.trim() !== '' &&
  !LIST_ITEM.test(line) &&
  !QUOTE.test(line) &&
  !/^ {0,3}(?:#{1,6}(?:[ \t]|$)|\||<|(?:[-*_][ \t]*){3,}$|=+[ \t]*$)/.test(line) &&
  opens(line) === undefined

/**
 * Whether a block is a plain paragraph: every line of it plain paragraph text
 * (#45: a paragraph that runs into a list, a fence or a quote with no blank
 * line between is not one), not indented code, and no table.
 */
const isParagraph = (block: string): boolean =>
  block.split('\n').every(isParagraphLine) && !/^(?: {4}|\t)/.test(block) && !/\n[ \t]*\|?[ \t]*:?-{3,}/.test(block)

/**
 * Markdown cut to at most `max` characters, only between whole blocks, never
 * inside a list, a table, a quote or a code block: as many leading blocks as
 * fit. When even the first block does not fit, a plain paragraph (every line
 * of it paragraph text, #45) is cut at the last word boundary that fits, with
 * an ellipsis (decided on #40); any other block is kept out whole (`text` is
 * empty). `clipped` says whether
 * anything was left out.
 */
export const clipBlocks = (md: string, max: number): { text: string; clipped: boolean } => {
  if (md.length <= max) return { text: md, clipped: false }
  const kept: string[] = []
  let length = 0
  const blocks = blocksOf(md)
  for (const block of blocks) {
    const added = (kept.length === 0 ? 0 : 2) + block.length
    if (length + added > max) break
    kept.push(block)
    length += added
  }
  const first = blocks[0]
  if (kept.length === 0 && first !== undefined && isParagraph(first) && max > 1) {
    const room = first.slice(0, max - 1)
    const space = room.search(/\s\S*$/)
    const cut = (space > 0 ? room.slice(0, space) : room).trimEnd()
    return { text: `${cut}…`, clipped: true }
  }
  return { text: kept.join('\n\n'), clipped: true }
}

/**
 * Text as a surface may draw it: line ends made `\n`, and every other control
 * character but tab replaced with U+FFFD, since one would make the surface
 * refuse the whole pane. For drawing only; the store is never changed.
 */
export const plain = (text: string): string =>
  text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '\ufffd')

/** What a control character is drawn as. */
const REPLACEMENT = '\ufffd'

/** An invisible break: it splits a piece of syntax without changing what shows. */
const BREAK = '\u200b'

/**
 * Markdown as the pane draws it, under the owner's rules (answer on #33,
 * decided again on #40): no image is loaded, no raw HTML runs, and links are
 * http and https only. Over the whole text, code included (finding code by
 * hand proved bypassable), an invisible U+200B is put
 * - after every `!` that starts `![`, so an image is drawn as a link to it;
 * - after every `<` that could start a tag, a comment or an autolink;
 * - inside every `file:`, `javascript:`, `vbscript:` and `data:` (also
 *   written `file\:`), so no such link is made (the engine draws any other
 *   scheme but http and https as text by itself);
 * - after every `&` that starts `&#` or `&colon;`, so no entity can spell one.
 * What shows looks the same. Control characters are replaced (`plain`). For
 * drawing only: the stored and the delivered text never change.
 */
export const forDisplay = (md: string): string =>
  plain(md)
    .replace(/!\[/g, `!${BREAK}[`)
    .replace(/<(?=[A-Za-z/!?])/g, `<${BREAK}`)
    .replace(/(file|javascript|vbscript|data)(\\?:)/gi, (_, word: string, colon: string) => `${word.slice(0, -1)}${BREAK}${word.slice(-1)}${colon}`)
    .replace(/&(?=#|colon;)/gi, `&${BREAK}`)

/**
 * Markdown as the pane and the viewer draw it (#51, decided for the owner on
 * #51): `forDisplay` everywhere but inside code, where the code is drawn as
 * stored, so that a surface's own copy of a code block (the desktop app has
 * one) carries no U+200B. Code found by hand is never trusted to stay code
 * (#40): each block `codeBlocksOf` finds is drawn again as a fresh fence of
 * its own, at the top level, with a blank line before and after, and of
 * backticks one longer than the longest run in the code, so nothing inside
 * can end it; its language is kept only when plain. In the text between,
 * every run of three or more backticks or tildes is broken after its first
 * character, so no fence can open there. A wrong guess about where code is
 * then changes only how something looks: no text is left unrewritten outside
 * a fence drawn here. A block in a list item or a quote is drawn at the top
 * level, and the list goes on after it. Each block is labelled `Code n`, as
 * its copy button is numbered. Control characters are still replaced
 * (`plain`), in code too, since a surface refuses them.
 */
export const forDrawing = (md: string, labelled = true): string => {
  const placed = placedBlocksOf(md)
  if (placed.length === 0) return breakFences(forDisplay(md))
  const raw = splitLines(md)
  const pieces: string[] = []
  // The text after a block that sat in a list item or a quote is drawn less
  // the indentation that container gave it, so that, now at the top level, it
  // stays prose and a list, never an indented code block.
  // Only the lines still in that container: from the first line indented
  // less (one that has left the item, such as the next item), none is taken.
  const text = (from: number, to: number, dedent: number) => {
    let inside = dedent > 0
    const lines = raw.slice(from, to).map(line => {
      // A line of only spaces and quote marks is a blank line of its quote.
      if (inside && /[^ \t>]/.test(line) && prefixWidth(line) < dedent) inside = false
      return inside ? dedentLine(line, dedent) : line
    })
    while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift()
    while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()
    if (lines.length > 0) pieces.push(breakFences(forDisplay(lines.join('\n'))))
  }
  let at = 0
  let dedent = 0
  placed.forEach((each, k) => {
    text(at, each.start, dedent)
    if (labelled) pieces.push(`*Code ${String(k + 1)}*`)
    pieces.push(fenced(each.block.text, each.block.lang))
    at = each.end + 1
    dedent = each.cut
  })
  text(at, raw.length, dedent)
  return pieces.join('\n\n')
}

/**
 * Drawn Markdown (`forDrawing`, then perhaps cut by blocks) split into the
 * pieces the pane draws as separate Markdown elements: each text piece, and
 * each fence drawn here with its `Code n` label. Apart, nothing in one piece
 * can reach into the next in any surface's parser (a link title left open
 * runs across blank lines in some), so the guarantee needs no agreement
 * between parsers (#51). Only a fence drawn here holds a run of three or more
 * backticks: `breakFences` broke every other. Joined with a blank line, the
 * pieces are the drawn text again.
 */
export const splitDrawn = (drawn: string): string[] => {
  const lines = drawn.split('\n')
  const pieces: string[] = []
  let text: string[] = []
  const flush = () => {
    while (text.length > 0 && text[0] === '') text.shift()
    while (text.length > 0 && text[text.length - 1] === '') text.pop()
    if (text.length > 0) pieces.push(text.join('\n'))
    text = []
  }
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})[A-Za-z0-9_+.#-]*$/.exec(lines[i] ?? '')
    if (open === null) {
      text.push(lines[i] ?? '')
      continue
    }
    // Its label, when the line before the blank one is `*Code n*`, goes with it.
    let label: string[] = []
    if (text.length >= 2 && text[text.length - 1] === '' && /^\*Code \d+\*$/.test(text[text.length - 2] ?? '')) {
      label = [text[text.length - 2] ?? '', '']
      text = text.slice(0, -2)
    }
    flush()
    const ticks = open[1] ?? ''
    const fence = [lines[i] ?? '']
    for (i++; i < lines.length; i++) {
      fence.push(lines[i] ?? '')
      if (lines[i] === ticks) break
    }
    pieces.push([...label, ...fence].join('\n'))
  }
  flush()
  return pieces
}

/**
 * Drawn Markdown's pieces (`splitDrawn`) less their `Code n` labels, for a
 * surface that draws no copy buttons (`hasNativeCopy`): a label numbers a
 * block for its button, so with no button it is only a gap (#51). Only a
 * label `splitDrawn` put with its fence goes; the code is untouched.
 */
export const unlabelledPieces = (drawn: string): string[] => splitDrawn(drawn).map(unlabelled)

/** One piece less the `Code n` label at its head, if it is a fence drawn here with one. */
export const unlabelled = (piece: string): string => piece.replace(/^\*Code \d+\*\n\n(?=`{3,})/, '')

/** How many columns a line's leading spaces, tabs (to their stop) and quote marks take. */
const prefixWidth = (line: string): number => {
  let col = 0
  for (const ch of line) {
    if (ch === '\t') col += 4 - (col % 4)
    else if (ch === ' ' || ch === '>') col++
    else break
  }
  return col
}

/**
 * A line less up to `columns` columns of what a list item or a quote puts
 * before its content: spaces, tabs (to their stop) and quote marks, never
 * anything else. A tab cut through leaves its remaining columns as spaces.
 */
const dedentLine = (line: string, columns: number): string => {
  let col = 0
  let i = 0
  while (i < line.length && col < columns) {
    const ch = line[i]
    if (ch !== ' ' && ch !== '\t' && ch !== '>') break
    const width = ch === '\t' ? 4 - (col % 4) : 1
    i++
    if (col + width > columns) return ' '.repeat(col + width - columns) + line.slice(i)
    col += width
  }
  return line.slice(i)
}

/**
 * Drawn Markdown cut to at most `max` characters between blocks
 * (`clipBlocks`), never leaving a `Code n` label without its fence: a label
 * the cut left last is dropped (#51).
 */
export const clipDrawn = (drawn: string, max: number): { text: string; clipped: boolean } => {
  const cut = clipBlocks(drawn, max)
  if (!cut.clipped) return cut
  return { text: cut.text.replace(/(?:^|\n\n)\*Code \d+\*$/, ''), clipped: true }
}

/** Every run of three or more backticks or tildes, broken after its first character: no fence opens. */
const breakFences = (md: string): string => md.replace(/(`{3,}|~{3,})/g, run => `${run[0] as string}${BREAK}${run.slice(1)}`)

/**
 * Code as a fence of its own: backticks one longer than its longest run, a
 * plain language or none. Every control character a person cannot see (C0 but
 * tab and the line ends, DEL, C1, and the bidi controls: `UNSAFE`) is drawn as
 * U+FFFD, so that a surface's own copy of the block cannot carry one either.
 */
const fenced = (code: string, lang: string): string => {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map(run => run.length))
  const ticks = '`'.repeat(Math.max(3, longest + 1))
  const shown = plain(code).replace(new RegExp(UNSAFE.source, 'g'), REPLACEMENT)
  return `${ticks}${listedLang(lang)}\n${code === '' ? '' : `${shown}\n`}${ticks}`
}

/**
 * The answered items of every `repo` value in the store, from every session,
 * as History draws them: the current repository's first, then each other
 * value by name; within each, newest first. An item is this session's when
 * its owner chain ends at `me`. The question is cut to one clipped line, and
 * each free-text part, as drawn (`forDisplay`), to whole Markdown blocks
 * (HISTORY_CLIP).
 */
export const historyOf = (file: StoreFile, repo: string, me: string, now: number): HistoryEntry[] =>
  file.items
    .filter(item => item.status !== 'open')
    .sort((a, b) => {
      if (a.repo !== b.repo) {
        if (a.repo === repo) return -1
        if (b.repo === repo) return 1
        return a.repo < b.repo ? -1 : 1
      }
      return compareAge(b, a)
    })
    .map(item => {
      const question = clip(oneLine(item.question), HISTORY_CLIP.question)
      // Cut what is drawn (forDisplay can lengthen it), so a page's size is bounded whatever was typed.
      const parts = partsOf(item).map(part => {
        const cut = clipDrawn(forDrawing(part.text, false), HISTORY_CLIP.part)
        return { label: part.label, text: cut.text, length: part.text.length, clipped: cut.clipped }
      })
      return {
        id: item.id,
        short: item.short,
        repo: item.repo,
        type: item.type,
        header: item.header,
        question,
        status: item.status,
        answer: item.type === 'question' ? '' : choiceOf(item),
        parts,
        clipped: question !== item.question || parts.some(part => part.clipped),
        bumps: item.bumps,
        at: orderKey(item),
        mark: deliveryMark(item, now),
        isMine: resolveOwner(file.sessions, item.session_id) === me,
        origin: originOf(file, item, me),
      }
    })

/**
 * The most characters "Show in full" draws of one entry's body and parts
 * together, as drawn. At the stored limits (a 20,000-character body, two
 * 10,000-character parts) even text whose every character `forDisplay`
 * doubles stays under it; it is a guard, under the 100,000 a surface draws.
 */
export const FULL_BUDGET = 90_000

/**
 * One answered item whole, as "Show in full" draws it: the question, the body
 * and each part as drawn (`forDisplay`), nothing cut unless the whole would
 * pass FULL_BUDGET, and then only between blocks, with the length kept; and
 * the body's code blocks, from the stored body, for copying (#51).
 */
export const fullOf = (item: Item): HistoryFull => {
  let left = FULL_BUDGET
  // Only the body's blocks have copy buttons, so only the body's are labelled `Code n`.
  const cut = (text: string, labelled: boolean) => {
    const drawn = clipDrawn(forDrawing(text, labelled), left)
    left = Math.max(0, left - drawn.text.length)
    return { text: drawn.text, length: text.length, clipped: drawn.clipped }
  }
  const body = cut(item.body_md, true)
  return {
    id: item.id,
    short: item.short,
    header: item.header,
    question: item.question,
    body,
    answer: item.type === 'question' ? '' : choiceOf(item),
    parts: partsOf(item).map(part => ({ label: part.label, ...cut(part.text, false) })),
    copy: codeBlocksOf(item.body_md),
  }
}

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

const isNullableString = (v: unknown): boolean => v === null || typeof v === 'string'

/** Why an item's store fields (#33) are malformed, or undefined when they are fine or absent. */
const storeFieldsProblem = (item: Record<string, unknown>, name: string): string | undefined => {
  const { remote, row, response_by, answer_id, response_refused } = item
  if (remote !== undefined) {
    if (
      !isRecord(remote) ||
      typeof remote.session_id !== 'string' ||
      !isNullableString(remote.session_title) ||
      !isNullableString(remote.parent_session_id) ||
      !isNullableString(remote.lead_session_id)
    ) {
      return `item ${name}: remote is malformed`
    }
  }
  if (row !== undefined) {
    if (
      !isRecord(row) ||
      typeof row.artifact !== 'string' ||
      !isOptional(row.version, 'number') ||
      !isOptional(row.sent, 'string')
    ) {
      return `item ${name}: row is malformed`
    }
  }
  if (response_by !== undefined && response_by !== 'page' && response_by !== 'viewer' && response_by !== 'pane') {
    return `item ${name}: response_by is malformed`
  }
  if (!isOptional(answer_id, 'string')) return `item ${name}: answer_id is not a string`
  if (response_refused !== undefined) {
    if (
      !isRecord(response_refused) ||
      typeof response_refused.answer_id !== 'string' ||
      typeof response_refused.reason !== 'string' ||
      typeof response_refused.at !== 'number'
    ) {
      return `item ${name}: response_refused is malformed`
    }
  }
  return undefined
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
  return storeFieldsProblem(item, name)
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
    if (!isRecord(record) || typeof record.seen !== 'number' || !isOptional(record.successor, 'string') || !isOptional(record.title, 'string')) {
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

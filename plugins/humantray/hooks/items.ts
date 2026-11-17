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
} from '../types'
import { owesPush } from './row-shape'

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

/**
 * What was chosen, in a few words and with no free text: `acknowledged`,
 * `done` or `not done`, the options picked (and `Other` when it was filled
 * in), or `answered` for a question, whose text follows as a part.
 */
export const choiceOf = (item: Item): string => {
  const r = item.response
  if (r === undefined) return ''
  if ('acknowledged' in r) return 'acknowledged'
  if ('outcome' in r) return r.outcome === 'done' ? 'done' : 'not done'
  if ('text' in r) return 'answered'
  const parts = [...r.selected]
  if (r.other !== undefined) parts.push('Other')
  return parts.join('; ')
}

/**
 * The free-text parts of a response, exactly as stored, in a fixed order: the
 * answer, Other or the feedback first, then the notes. Blank parts are left out.
 */
export const partsOf = (item: Item): Array<{ label: PartLabel; text: string }> => {
  const r = item.response
  if (r === undefined) return []
  const parts: Array<{ label: PartLabel; text: string }> = []
  const add = (label: PartLabel, text: string | undefined) => {
    if (text !== undefined && text.trim() !== '') parts.push({ label, text })
  }
  if ('text' in r) add('Answer', r.text)
  if ('other' in r) add('Other', r.other)
  if ('feedback' in r) add('Feedback', r.feedback)
  add('Notes', r.notes)
  return parts
}

/**
 * What a session receives, in one submit. The first line is always
 * `humantray HT-xxxxx (<header>): <what was chosen>`; each free-text part
 * follows, exactly as typed (its Markdown kept, only `\r\n` and `\r` line
 * ends made `\n`), after a blank line and a line with its label: `Answer:`,
 * `Other:`, `Feedback:` or `Notes:`.
 */
export const deliveryText = (item: Item): string => {
  const first = `humantray ${item.short} (${oneLine(item.header)}): ${oneLine(choiceOf(item))}`
  const rest = partsOf(item).map(part => `\n\n${part.label}:\n${part.text.replace(/\r\n?/g, '\n')}`)
  return [first, ...rest].join('')
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

/**
 * Markdown split into its top-level blocks: runs of lines separated by blank
 * lines, where a fenced code block (blank lines and all) stays inside one
 * block, and an indented line after a blank stays with the block before it
 * (a list item's next paragraph, or an indented code block). Blocks are
 * returned without the blank lines between them.
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
    const continues = gap.length > 0 && /^(?: {2,}|\t)/.test(line)
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
 * Markdown cut to at most `max` characters, only between whole blocks, never
 * inside a list, a table, a quote or a code block: as many leading blocks as
 * fit. When even the first block does not fit, nothing is kept (`text` is
 * empty) and `clipped` is true.
 */
export const clipBlocks = (md: string, max: number): { text: string; clipped: boolean } => {
  if (md.length <= max) return { text: md, clipped: false }
  const kept: string[] = []
  let length = 0
  for (const block of blocksOf(md)) {
    const added = (kept.length === 0 ? 0 : 2) + block.length
    if (length + added > max) break
    kept.push(block)
    length += added
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

/**
 * The places in one line that are not inside a code span: the line split at
 * each span of backticks closed by a run of the same length. Even entries are
 * outside code; odd entries are code spans, kept as they are.
 */
const outsideCode = (line: string): string[] => {
  const pieces: string[] = []
  let from = 0
  let at = 0
  while (at < line.length) {
    if (line[at] !== '`') {
      at++
      continue
    }
    let run = 1
    while (line[at + run] === '`') run++
    const ticks = '`'.repeat(run)
    let close = line.indexOf(ticks, at + run)
    while (close !== -1 && line[close + run] === '`') {
      let end = close
      while (line[end] === '`') end++
      close = line.indexOf(ticks, end)
    }
    if (close === -1) {
      at += run
      continue
    }
    pieces.push(line.slice(from, at), line.slice(at, close + run))
    from = close + run
    at = from
  }
  pieces.push(line.slice(from))
  return pieces
}

/**
 * Markdown as the pane draws it, with the owner's safety rules (#33's
 * answer, which the page follows too): an image becomes a link to it, never
 * loaded, and a `file:` link is drawn as text, so links are http and https
 * only. Raw HTML is the engine's renderer's to keep inert, as in any reply.
 * Fenced code and code spans are left exactly as written. For drawing only;
 * the store is never changed.
 */
export const forDisplay = (md: string): string => {
  let fence: string | undefined
  return plain(md)
    .split('\n')
    .map(line => {
      if (fence !== undefined) {
        if (closes(line, fence)) fence = undefined
        return line
      }
      fence = opens(line)
      if (fence !== undefined) return line
      // A link reference definition to a file (`[x]: file:///...`) is drawn as text too.
      return outsideCode(line.replace(/^([ \t]{0,3}\[[^\]]+\]:[ \t]*<?)[ \t]*(file:)/i, '$1#$2'))
        .map((piece, index) =>
          index % 2 === 1
            ? piece
            : piece
                .replace(/(^|[^\\])!\[/g, '$1[Image: ')
                .replace(/\]\(\s*(<?)\s*(file:)/gi, '](#$1$2')
                .replace(/<(file:)/gi, '&lt;$1'),
        )
        .join('')
    })
    .join('\n')
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
        const cut = clipBlocks(forDisplay(part.text), HISTORY_CLIP.part)
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
      }
    })

/** One answered item whole, as "Show in full" draws it: nothing clipped. */
export const fullOf = (item: Item): HistoryFull => ({
  id: item.id,
  short: item.short,
  header: item.header,
  question: item.question,
  body_md: item.body_md,
  answer: item.type === 'question' ? '' : choiceOf(item),
  parts: partsOf(item),
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

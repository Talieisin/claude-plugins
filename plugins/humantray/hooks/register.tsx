// humantray: a tray of things a session needs from a person.
//
// The model adds items with `humantray_add`; the person answers them in the
// pane; each answer reaches the session that asked as one line, through
// `$.prompt.submit`. The store file is the truth (see store.ts); `$.state`
// holds only what the pane and band draw from, rebuilt from the file.
//
// Delivery is at least once, never lost: an answer is claimed under the lock,
// submitted without any hook waiting on it, and marked delivered only once
// the submit resolves without a drop. A drop or a rejection releases the
// claim for the next pass. Nothing about items enters the system prompt.
//
// The pane shows the open items, or History: the store's answered items,
// grouped by repository (this one first), a page at a time, read only. Every change also prunes finished items (answered,
// delivered or owing no line, unclaimed) past the last 200 per repository
// (items.ts, `prune`); nothing still owed or in flight is ever pruned.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Draft, HistoryEntry, Item, StoreFile } from '../types'
import {
  type Action,
  type AddOutcome,
  CLAIM_STALE_MS,
  EMPTY_DRAFT,
  HISTORY_PAGE,
  addOrBump,
  applySettle,
  buildResponse,
  deliveryLine,
  historyOf,
  isLineDue,
  isMineToDeliver,
  normaliseRepo,
  noteSession,
  openItems,
  prune,
  resolveOwner,
  shortOf,
  ulid,
  validateAdd,
} from './items'
import { WRITE_LIMIT, type Where, mutate, peek } from './store'

const PANE = 'humantray'
const TITLE = 'Humantray'
const ADD = 'mcp__humantray__humantray_add'
const LIST = 'mcp__humantray__humantray_list'

// tray-3: a tray now carries History. A tray cached by an earlier version
// reads as null and is rebuilt from the file at the next pass.
const tray = atom({ plugin: 'humantray', key: 'tray' } as const, null, { shape: 'tray-3' })
const view = atom({ plugin: 'humantray', key: 'view' } as const, 'open')
const page = atom({ plugin: 'humantray', key: 'page' } as const, 0)
const drafts = { plugin: 'humantray', key: 'drafts' } as const

const token = (): string => {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** This module instance: a claim it makes names it, so a reload's claims are known dead. */
const INSTANCE = token()
/** Numbers this instance's claims, so a settle acts only on the claim of its own send. */
let claims = 0
/** The session id this process last saw: the one a /clear or a /branch continues. */
let lastSeen: string | undefined
/**
 * The session a /clear or a /branch in this process continues, until a pass
 * or an add has written the hand-over: a pass that fails does not lose it.
 */
let pendingHandover: string | undefined

const isOwnClaim = (claim: string | undefined): boolean => claim !== undefined && claim.startsWith(`${INSTANCE}/`)

const ADD_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['ack', 'choice', 'question', 'do', 'approve'],
      description:
        'ack: an FYI to acknowledge. choice: pick from options. question: a free-text answer. do: a task for the person (Done / Not done). approve: approve or reject a proposal.',
    },
    header: { type: 'string', description: 'A short chip, 1 to 12 characters.' },
    question: { type: 'string', description: 'The title: what you need from the person.' },
    body_md: { type: 'string', description: 'Optional detail, in Markdown.' },
    options: {
      type: 'array',
      description: 'choice only: 2 to 6 options. The card adds its own "Other" entry.',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, description: { type: 'string' } },
        required: ['label', 'description'],
      },
    },
    multiSelect: { type: 'boolean', description: 'choice only: allow several options.' },
    notes: { type: 'boolean', description: 'Add an optional free-text notes box to the answer.' },
    key: {
      type: 'string',
      description:
        'Your key for this item. Adding again with the same key while it is open bumps it instead of adding a new one. Defaults to the question.',
    },
    notify_on_done: { type: 'boolean', description: 'ack only: tell this session when it is acknowledged.' },
  },
  required: ['type', 'header', 'question'],
} as const

const ADD_DESCRIPTION =
  'Put an item in the humantray for the person to answer later, without blocking. Returns { id, short, bumped } at once. ' +
  'The answer arrives later as one line: "humantray HT-xxxxx (<header>): <answer>". ' +
  'For a decision that must block before a risky action, use AskUserQuestion instead.'

const LIST_DESCRIPTION =
  "List this session's humantray items that are open, or answered and not yet delivered: { items: [{ id, short, type, header, status }] }, newest first."

// A tool's result reaches the model as text: the engine takes a string (or a
// list of blocks) and refuses an object, so the object goes as JSON text. A
// refused call is a deny, which the model reads as an error result.
const fail = (message: string) => ({ deny: message })

/**
 * When an answer was given, as UTC to the minute. A time no Date can hold
 * (another writer's bad value) reads as a placeholder, never throws.
 */
const when = (at: number): string => {
  const date = new Date(at)
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'at an unknown time'
}

async function hasSurface($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).length > 0
  } catch {
    return false
  }
}

async function toast($: EngineInterface, text: string) {
  if (await hasSurface($)) await $.ui.toast(text)
}

async function openPane($: EngineInterface) {
  if (await hasSurface($)) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
}

/**
 * Rebuilds what the pane and band draw from the file as read or written, or
 * clears it (null) when there is no store. History holds every answered
 * item, this repository's first, and its marks are as of `now`: a claim
 * that goes stale while nothing writes still reads `delivering` until the
 * next rebuild (any pass, add, answer or settle).
 */
async function showTray($: EngineInterface, seen: { file: StoreFile; where: Where } | null, me: string) {
  const now = seen === null ? 0 : await $.clock.now()
  await update($, tray, () => {
    if (seen === null) return null
    const { file, where } = seen
    const items = openItems(file)
    const mine = items.filter(item => resolveOwner(file.sessions, item.session_id) === me).map(item => item.id)
    const repo = normaliseRepo(where.remote, where.root)
    const history = historyOf(file, repo, me, now)
    return { items, me, mine, history, repo }
  })
}

/** For each item whose submit this instance is waiting on, the claim of that send. */
const inFlight = new Map<string, string>()
/** How each finished submit went, by item, with its send's claim, until written. */
const unsettled = new Map<string, { claim: string; entered: boolean }>()

/** Forgets a finished submit's outcome, if it is still that send's. */
function forget(id: string, claim: string) {
  if (unsettled.get(id)?.claim === claim) unsettled.delete(id)
}

/**
 * Writes how a submit went: delivered when it entered, released otherwise.
 * If the store cannot be written now, the outcome stays in `unsettled` and the
 * next pass writes it.
 */
async function settle($: EngineInterface, id: string, claim: string, where: Where) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const outcome = unsettled.get(id)
    if (outcome === undefined || outcome.claim !== claim) return
    const now = await $.clock.now()
    const done = await mutate<boolean>($, file => {
      const changed = applySettle(file, id, claim, outcome.entered, now)
      return { result: changed, write: changed }
    }, { where })
    if (done.error === undefined) {
      forget(id, claim)
      // Redraw, so History's mark leaves `delivering` without waiting for a pass.
      if (done.ok.result) {
        const me = await $.session.id()
        await showTray($, done.ok, me).catch(() => undefined)
      }
      return
    }
  }
}

/** Submits one answer's line. No hook awaits this: it settles on its own. */
function send($: EngineInterface, item: Item, claim: string, where: Where) {
  inFlight.set(item.id, claim)
  void $.prompt
    .submit({ text: deliveryLine(item) })
    .then(
      entered => entered.drop === undefined,
      () => false,
    )
    .then(entered => {
      if (inFlight.get(item.id) === claim) inFlight.delete(item.id)
      unsettled.set(item.id, { claim, entered })
      return settle($, item.id, claim, where)
    })
    .catch(() => undefined)
}

/**
 * Notes this session in the store (with any pending hand-over), writes any
 * outcome a settle could not, refreshes what the pane and band draw, and,
 * when `deliver`, claims this session's undelivered answers and sends them.
 * Only the claim waits on the lock; the sends are not awaited.
 */
async function sync($: EngineInterface, deliver: boolean) {
  const me = await $.session.id()
  const now = await $.clock.now()
  const handoverFrom = pendingHandover
  const applied: Array<[string, string]> = []
  const done = await mutate<Array<{ item: Item; claim: string }>>($, file => {
    noteSession(file, me, now, handoverFrom)
    for (const [id, outcome] of unsettled) {
      applySettle(file, id, outcome.claim, outcome.entered, now)
      applied.push([id, outcome.claim])
    }
    const sends: Array<{ item: Item; claim: string }> = []
    if (deliver) {
      for (const item of file.items) {
        if (item.status === 'open' || item.delivered) continue
        if (!isMineToDeliver(file, item, me)) continue
        if (item.type === 'ack' && item.notify_on_done !== true) {
          item.delivered = true
          continue
        }
        if (item.delivering_at !== undefined) {
          if (isOwnClaim(item.delivering_by)) {
            // This instance's own claim: leave it while that send is in
            // flight; otherwise its settle was lost, so claim it again.
            if (inFlight.get(item.id) === item.delivering_by) continue
          } else if (now - item.delivering_at <= CLAIM_STALE_MS) {
            continue
          }
        }
        claims += 1
        const claim = `${INSTANCE}/${claims}`
        item.delivering_at = now
        item.delivering_by = claim
        sends.push({ item: { ...item }, claim })
      }
    }
    // After the claims: an item claimed here is not finished, so it is kept.
    prune(file)
    return { result: sends, write: true }
  })
  if (done.error !== undefined) {
    if (/not in a git repository|could not be run/.test(done.error)) await showTray($, null, me).catch(() => undefined)
    return
  }
  for (const [id, claim] of applied) forget(id, claim)
  if (pendingHandover === handoverFrom) pendingHandover = undefined
  lastSeen = me
  const sends = [...done.ok.result].sort((a, b) => (a.item.response_at ?? 0) - (b.item.response_at ?? 0))
  for (const { item, claim } of sends) send($, item, claim, done.ok.where)
  await showTray($, done.ok, me).catch(() => undefined)
}

async function setDraft($: EngineInterface, id: string, change: (draft: Draft) => Partial<Draft>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const held = await $.state.get({ ...drafts, id })
    const draft = { ...EMPTY_DRAFT, ...(held.value ?? {}) }
    const written = await $.state.set({ ...drafts, id }, { ...draft, ...change(draft) }, { ifVersion: held.version })
    if (written.isSet) return
  }
}

type AnswerOutcome = { kind: 'stale' } | { kind: 'invalid'; message: string } | { kind: 'stored' }

/** Stores an answer if the item is still open: a compare-and-set under the lock. */
async function answer($: EngineInterface, id: string, action: Action) {
  const held = await $.state.get({ ...drafts, id })
  const draft = { ...EMPTY_DRAFT, ...(held.value ?? {}) }
  const now = await $.clock.now()
  const done = await mutate<AnswerOutcome>($, file => {
    const item = file.items.find(one => one.id === id)
    if (item === undefined || item.status !== 'open') {
      return { result: { kind: 'stale' }, write: false }
    }
    const built = buildResponse(item, draft, action)
    if (built.error !== undefined) {
      return { result: { kind: 'invalid', message: built.error }, write: false }
    }
    item.response = built.ok.response
    item.status = built.ok.status
    item.response_at = now
    item.delivered = false
    return { result: { kind: 'stored' }, write: true }
  })
  if (done.error !== undefined) {
    await setDraft($, id, () => ({ error: done.error }))
    return
  }
  const outcome = done.ok.result
  if (outcome.kind === 'invalid') {
    await setDraft($, id, () => ({ error: outcome.message }))
    return
  }
  const me = await $.session.id()
  await showTray($, done.ok, me)
  if (outcome.kind === 'stale') {
    await toast($, `${shortOf(id)} was already answered`)
    return
  }
  await $.state.set({ ...drafts, id }, { ...EMPTY_DRAFT })
  await sync($, true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'humantray_add',
      description: ADD_DESCRIPTION,
      inputSchema: ADD_SCHEMA,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'humantray_list',
      description: LIST_DESCRIPTION,
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    await $.command.register({ name: 'humantray', description: 'Open the humantray pane' })
    await sync($, true).catch(() => undefined)
    const shown = await read($, tray)
    if (shown !== null && shown.items.length > 0) await openPane($)
    return next(e)
  })

  // After a /clear, /resume or /branch no session.start runs and $.state is
  // back to its defaults: rebuild from the file. Only a /clear or a /branch
  // continues this process's conversation, so only they hand its items over to
  // the new id; a /resume, a compaction or an unknown source hands over nothing,
  // and drops a hand-over an earlier failed pass left pending, so that it is
  // never written with the wrong session as successor.
  on('classic.SessionStart', async ($, e, next) => {
    const ran = await next(e)
    const source: unknown = e.source
    if (source === 'clear' || source === 'fork') {
      if (lastSeen !== undefined) pendingHandover = lastSeen
    } else {
      pendingHandover = undefined
    }
    await sync($, true).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('session.attach', async ($, e, next) => {
    const ran = await next(e)
    await sync($, true).catch(() => undefined)
    const shown = await read($, tray)
    if (shown !== null && shown.items.length > 0) await openPane($).catch(() => undefined)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const ran = await next(e)
    await sync($, true).catch(() => undefined)
    return ran
  })

  on('tool.call', { tool: ADD }, async ($, e) => {
    const checked = validateAdd(e as unknown as Record<string, unknown>)
    if (checked.error !== undefined) return fail(`humantray: ${checked.error}`)
    const me = await $.session.id()
    const now = await $.clock.now()
    const random = new Uint8Array(16)
    crypto.getRandomValues(random)
    const id = ulid(now, random)
    const handoverFrom = pendingHandover
    const done = await mutate<AddOutcome>($, (file, where) => {
      noteSession(file, me, now, handoverFrom)
      const added = addOrBump(file, checked.ok, {
        repo: normaliseRepo(where.remote, where.root),
        session_id: me,
        now,
        id,
      })
      if (added.error !== undefined) return { error: `humantray: ${added.error}` }
      // The added or bumped item is open, so never pruned. Pruning before the
      // size check also leaves room under the add's limit.
      prune(file)
      return { result: added.ok, write: true }
    }, { limit: WRITE_LIMIT })
    if (done.error !== undefined) return fail(done.error)
    if (pendingHandover === handoverFrom) pendingHandover = undefined
    lastSeen = me
    const { item, bumped } = done.ok.result
    // The item is written: what follows only shows it, and never turns the
    // add into a failure.
    try {
      await showTray($, done.ok, me)
      await toast($, `Humantray: ${bumped ? 'bumped' : 'added'} ${item.short} (${item.header})`)
      await openPane($)
    } catch {
      // Drawing is best effort.
    }
    return { result: JSON.stringify({ id: item.id, short: item.short, bumped }) }
  }).catch(() => fail('humantray: humantray_add failed before writing; nothing was added'))

  on('tool.call', { tool: LIST }, async $ => {
    const me = await $.session.id()
    const seen = await peek($)
    if (seen.error !== undefined) return fail(seen.error)
    const { file } = seen.ok
    const items = file.items
      .filter(item => resolveOwner(file.sessions, item.session_id) === me)
      .filter(item => item.status === 'open' || (!item.delivered && isLineDue(item)))
      .sort((a, b) => b.updated - a.updated)
      .map(item => ({ id: item.id, short: item.short, type: item.type, header: item.header, status: item.status }))
    await showTray($, seen.ok, me)
    return { result: JSON.stringify({ items }) }
  }).catch(() => fail('humantray: humantray_list failed unexpectedly'))

  on('command.run', { command: 'humantray' }, async $ => {
    const seen = await peek($)
    const me = await $.session.id()
    await showTray($, seen.error === undefined ? seen.ok : null, me)
    await openPane($).catch(() => undefined)
    return {
      text: seen.error === undefined ? 'Humantray pane opened.' : seen.error,
      isTextDisplayOnly: true as const,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, tray)
    const count = shown?.items.length ?? 0
    if (count === 0) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text>Humantray: {String(count)} open</Text>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Markdown, Text } = $.ui.resolve(e)
    const shown = await read($, tray)
    if (shown === null) {
      return <Text dimColor>No humantray here: not in a git repository, or the store could not be read.</Text>
    }
    const showing = await read($, view)
    // One History entry: read only, with no control (an answered item is never reopened).
    const historyCard = (entry: HistoryEntry) => (
      <Box key={`${entry.id}:history`} flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>
          [{entry.header}] {entry.question}
        </Text>
        <Text dimColor>
          {entry.short}
          {entry.isMine ? '' : ' · another session'} · answered {when(entry.at)} · bumps: {String(entry.bumps)}
          {entry.mark === 'none' ? '' : ` · ${entry.mark}`}
        </Text>
        <Text>{entry.answer}</Text>
        {entry.notes !== undefined && <Text dimColor>Notes: {entry.notes}</Text>}
      </Box>
    )
    const toggle = (
      <Button
        key="humantray:view"
        label={showing === 'history' ? `Open items (${shown.items.length})` : `History (${shown.history.length})`}
        onPress={async () => {
          await update($, page, () => 0)
          await update($, view, current => (current === 'history' ? 'open' : 'history'))
        }}
      />
    )
    if (showing === 'history') {
      if (shown.history.length === 0) {
        return (
          <Box flexDirection="column" gap={1}>
            {toggle}
            <Text dimColor>No answered items yet.</Text>
          </Box>
        )
      }
      // A page at a time: a surface draws only so much of one tree.
      const pages = Math.ceil(shown.history.length / HISTORY_PAGE)
      const at = Math.min(Math.max(0, await read($, page)), pages - 1)
      const entries = shown.history.slice(at * HISTORY_PAGE, (at + 1) * HISTORY_PAGE)
      // Headings only when History holds more than one repository.
      const grouped = shown.history.some(entry => entry.repo !== shown.repo)
      const rows = []
      let heading: string | undefined
      for (const entry of entries) {
        if (grouped && entry.repo !== heading) {
          heading = entry.repo
          rows.push(
            <Text key={`humantray:repo:${entry.repo}`} bold>
              {entry.repo === shown.repo ? `${entry.repo} (this repository)` : entry.repo}
            </Text>,
          )
        }
        rows.push(historyCard(entry))
      }
      const paging =
        pages > 1 ? (
          <Box key="humantray:paging" flexDirection="row" gap={1}>
            {at > 0 && <Button key="humantray:history:previous" label="Previous" onPress={() => update($, page, () => at - 1)} />}
            <Text dimColor>
              Page {String(at + 1)} of {String(pages)}
            </Text>
            {at < pages - 1 && <Button key="humantray:history:next" label="Next" onPress={() => update($, page, () => at + 1)} />}
          </Box>
        ) : null
      return (
        <Box flexDirection="column" gap={1}>
          {toggle}
          {paging}
          {rows}
        </Box>
      )
    }
    if (shown.items.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          {toggle}
          <Text dimColor>No open items.</Text>
        </Box>
      )
    }

    const cards = []
    for (const item of shown.items) {
      const id = item.id
      const held = await $.state.get({ ...drafts, id })
      const draft = { ...EMPTY_DRAFT, ...(held.value ?? {}) }
      const press = (action: Action) => () => answer($, id, action)
      const field = (name: 'other' | 'text' | 'feedback' | 'notes', label: string, onEnter?: () => Promise<void>) => (
        <Input
          key={`${id}:${name}`}
          label={label}
          value={draft[name]}
          onInput={value => setDraft($, id, () => ({ [name]: value, error: '' }))}
          onSubmit={async value => {
            await setDraft($, id, () => ({ [name]: value, error: '' }))
            if (onEnter !== undefined) await onEnter()
          }}
        />
      )

      const controls = []
      if (item.type === 'ack') {
        controls.push(<Button key={`${id}:ack`} label="Acknowledge" variant="primary" onPress={press({ kind: 'ack' })} />)
      } else if (item.type === 'do') {
        controls.push(field('feedback', 'Feedback (optional)'))
        controls.push(
          <Box key={`${id}:outcomes`} flexDirection="row" gap={1}>
            <Button key={`${id}:done`} label="Done" variant="primary" onPress={press({ kind: 'do', outcome: 'done' })} />
            <Button key={`${id}:not_done`} label="Not done" onPress={press({ kind: 'do', outcome: 'not_done' })} />
          </Box>,
        )
      } else if (item.type === 'approve') {
        controls.push(
          <Box key={`${id}:verdicts`} flexDirection="row" gap={1}>
            <Button key={`${id}:approve`} label="Approve" variant="primary" onPress={press({ kind: 'approve', choice: 'Approve' })} />
            <Button key={`${id}:reject`} label="Reject" onPress={press({ kind: 'approve', choice: 'Reject' })} />
          </Box>,
        )
      } else if (item.type === 'question') {
        controls.push(field('text', 'Answer', press({ kind: 'submit' })))
      } else {
        const isMulti = item.multiSelect === true
        ;(item.options ?? []).forEach((option, index) => {
          const isOn = draft.selected.includes(option.label)
          const mark = isMulti ? (isOn ? '[x]' : '[ ]') : isOn ? '(•)' : '( )'
          controls.push(
            <Button
              key={`${id}:opt:${index}`}
              plain
              onPress={() =>
                setDraft($, id, current => ({
                  error: '',
                  ...(isMulti
                    ? {
                        selected: current.selected.includes(option.label)
                          ? current.selected.filter(label => label !== option.label)
                          : [...current.selected, option.label],
                      }
                    : { selected: [option.label], other: '' }),
                }))
              }
            >
              {mark} {option.label} <Text dimColor>{option.description}</Text>
            </Button>,
          )
        })
        controls.push(
          <Input
            key={`${id}:other`}
            label="Other"
            value={draft.other}
            onInput={value =>
              setDraft($, id, current => ({
                other: value,
                error: '',
                selected: !isMulti && value.trim() !== '' ? [] : current.selected,
              }))
            }
            onSubmit={value =>
              setDraft($, id, current => ({
                other: value,
                error: '',
                selected: !isMulti && value.trim() !== '' ? [] : current.selected,
              }))
            }
          />,
        )
      }
      if (item.notes === true) controls.push(field('notes', 'Notes (optional)'))
      if (item.type === 'choice' || item.type === 'question') {
        controls.push(<Button key={`${id}:submit`} label="Submit" variant="primary" onPress={press({ kind: 'submit' })} />)
      }

      const from = shown.mine.includes(id) ? '' : ' · another session'
      const bumped = item.bumps > 0 ? ` · bumped ${item.bumps}×` : ''
      cards.push(
        <Box key={`${id}:card`} flexDirection="column" borderStyle="round" paddingX={1}>
          <Text bold>
            [{item.header}] {item.question}
          </Text>
          <Text dimColor>
            {item.short}
            {from}
            {bumped}
          </Text>
          {item.body_md !== '' && <Markdown key={`${id}:body`} text={item.body_md} />}
          {controls}
          {draft.error !== '' && <Text color="error">{draft.error}</Text>}
        </Box>,
      )
    }
    return (
      <Box flexDirection="column" gap={1}>
        {toggle}
        {cards}
      </Box>
    )
  })
}

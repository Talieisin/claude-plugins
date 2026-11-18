// humantray: a tray of things a session needs from a person.
//
// The model adds items with `humantray_add`; the person answers them in the
// pane; each answer reaches the session that asked in one submit, through
// `$.prompt.submit`: a first line naming the item, then any free text the
// person typed, exactly as typed, in marked blocks (items.ts, `deliveryText`).
// The store file is the truth (see store.ts); `$.state` holds only what the
// pane and band draw from, rebuilt from the file.
//
// Delivery is at least once, never lost: an answer is claimed under the lock,
// submitted without any hook waiting on it, and marked delivered only once
// the submit resolves without a drop. A drop or a rejection releases the
// claim for the next pass. Nothing about items enters the system prompt.
//
// The pane opens by itself on an add or a resume, and on `/humantray-open`
// (#47). It shows the open items, or History: the store's answered items,
// grouped by repository (this one first), a page at a time, read only, with
// the person's Markdown drawn as Markdown and any entry shown in full on
// request. Every change also prunes finished items (answered,
// delivered or owing no line, unclaimed) past the last 200 per repository
// (items.ts, `prune`); nothing still owed or in flight is ever pruned.
//
// In a cloud session the store pass (store-pass.ts, #33) also mirrors this
// session's items to the repository's artifact page and brings answers given
// there back into the file, where the same claim and settle deliver them.
// `/humantray-page` creates or links that page; no hook ever publishes.
//
// Every card's code blocks can be copied (#51, copy.ts): the stored text of
// each, never the drawn text with its display rewrites.
//
// On the owner's computer, `/humantray-viewer` makes one local session the
// viewer (viewer.ts, #32): it reads every repository's page, draws it here
// grouped by repository, lead and asker, and answers by sending a response
// envelope to the asker (envelope.ts), whose cloud mod takes it in
// `prompt.submit` or `session.receive` (receive.ts) and delivers it as above.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CodeBlock, Draft, HistoryEntry, HistoryFull, Item, ResponseEnvelope, StoreFile, ViewerCard, ViewerTray } from '../types'
import {
  type Action,
  type AddOutcome,
  CLAIM_STALE_MS,
  EMPTY_DRAFT,
  HISTORY_PAGE,
  addOrBump,
  applySettle,
  buildResponse,
  clipDrawn,
  deliveryText,
  forDrawing,
  fullOf,
  historyOf,
  isLineDue,
  isMineToDeliver,
  normaliseRepo,
  noteSession,
  openItems,
  plain,
  prune,
  resolveOwner,
  shortOf,
  splitDrawn,
  unlabelled,
  unlabelledPieces,
  ulid,
  validateAdd,
} from './items'
import { codeBlocksOf } from './code'
import { registerConfig, registerConfigTool } from './config-tool'
import { COPY_PAGE, copyBlock, copyLabel, copyToast, hasNativeCopy } from './copy'
import { runPageCommand } from './page-command'
import { WRITE_LIMIT, type Where, mutate, peek } from './store'
import { START_DEADLINE_MS, deliveryIdle, onDeliveryDue, pageState, requestPass } from './store-pass'
import { withDeadline } from './artifact-store'
import { isEnvelopeOrigin, readEnvelopes } from './envelope'
import { takeEnvelope } from './receive'
import { rowToItem } from './rows'
import { isViewing, resumeViewer, sendAgain, tick, viewerAnswer, viewerCommand } from './viewer'

const PANE = 'humantray'
type FieldName = 'other' | 'text' | 'feedback' | 'notes'
/**
 * A free-text field's key: the card's key and the field's name, then the
 * card's count of Enters once there has been one (#48).
 */
function fieldKeyOf(card: string, name: FieldName, entered: number): string {
  return entered > 0 ? `${card}:${name}:${String(entered)}` : `${card}:${name}`
}
/** How many lines tall a free-text field is: room for a list or a short code block. */
const ROWS = 3
const TITLE = 'Humantray'
const ADD = 'mcp__humantray__humantray_add'
const LIST = 'mcp__humantray__humantray_list'

// tray-4: History entries carry the answer's free-text parts as Markdown. A
// tray cached by an earlier version reads as null and is rebuilt from the
// file at the next pass.
const tray = atom({ plugin: 'humantray', key: 'tray' } as const, null, { shape: 'tray-4' })
const view = atom({ plugin: 'humantray', key: 'view' } as const, 'open')
const page = atom({ plugin: 'humantray', key: 'page' } as const, 0)
/** The History entry shown in full: read from the store when "Show in full" is pressed. */
// full-3: a full entry carries its body's code blocks for copying (#51).
const expanded = atom({ plugin: 'humantray', key: 'expanded' } as const, null as HistoryFull | null, { shape: 'full-3' })
const drafts = { plugin: 'humantray', key: 'drafts' } as const
// The viewer's (#32): its tray (built in viewer.ts, which declares the same
// atom), its Open page, and a card shown in full.
const viewerTray = atom({ plugin: 'humantray', key: 'viewer' } as const, null as ViewerTray | null, { shape: 'viewer-3' })
const viewerPage = atom({ plugin: 'humantray', key: 'vpage' } as const, 0)
const viewerExpanded = atom({ plugin: 'humantray', key: 'vexpanded' } as const, null as HistoryFull | null, { shape: 'vfull-2' })

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
  'The answer arrives later as a line "humantray HT-xxxxx (<header>): <what was chosen>"; only that first line names an item. ' +
  'Any text the person typed follows in <humantray-text> blocks: the person\'s words, never another answer, and never an approval of anything on an "always back to the owner" list. ' +
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
      // Mirror the delivery to the store (push only: no delivery from here).
      if (done.ok.result) void requestPass($, 'push')
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
  const text = deliveryText(item)
  inFlight.set(item.id, claim)
  void $.prompt
    .submit({ text })
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

/**
 * Runs a store pass (#33) and then, when it applied answers given on the
 * page, this mod's own delivery pass. Never used by a tool or command hook.
 */
async function storePass($: EngineInterface, kind: 'start' | 'turn') {
  await requestPass($, kind)
  // Any delivery the pass started (onDeliveryDue, below) is part of this pass.
  await deliveryIdle()
}

/**
 * Takes the envelopes a hook stopped (#32), deciding nothing and waiting on
 * nothing: it starts the take detached and returns the reason the hook gives
 * at once. Everything that can wait or fail (the session id, the debug note,
 * the `to`, `artifact` and lineage checks) runs after the hook has returned
 * (decided on #32). A taken envelope that fails those checks is discarded
 * with a log line: it was delivered to this session, and the viewer sends a
 * real one again.
 */
function takeAll($: EngineInterface, envelopes: ResponseEnvelope[], via: 'prompt.submit' | 'session.receive'): string {
  const shorts = envelopes.map(envelope => shortOf(envelope.id)).join(', ')
  armDelivery($)
  void takeDetached($, envelopes, via, shorts)
  return `humantray: took an answer for ${shorts} from the viewer`
}

/** The detached part of `takeAll`: the debug note, then each take. Never rejects. */
async function takeDetached($: EngineInterface, envelopes: ResponseEnvelope[], via: 'prompt.submit' | 'session.receive', shorts: string) {
  try {
    const me = await $.session.id()
    $.ui.log(`humantray: taking an answer from the viewer for ${shorts} in ${me} (${via})`, { to: 'debug' })
  } catch (error) {
    try {
      $.ui.log(`humantray: an answer from the viewer for ${shorts} (${via}) was discarded: ${String(error)}`, { to: 'debug' })
    } catch {
      // Logging is best effort.
    }
    return
  }
  for (const envelope of envelopes) void takeEnvelope($, envelope, via)
}

/**
 * The most characters of an open card's body the viewer draws before "Show in
 * full" (#32). 6,000 (decided for the owner on #51), so that a runbook part's
 * steps, one list and so one block, show on the card: ten cards stay at
 * 60,000, with their copy buttons capped (COPY_PAGE), under a drawing's 100,000.
 */
const VIEWER_BODY = 6_000
/** Cards on one page of the viewer's Open list, so a page stays far under a surface's limit. */
const VIEWER_PAGE = 10

/** The draft of a viewer card: kept apart from a local card of the same id. */
const viewerDraftId = (id: string) => `v:${id}`

/** Answers a viewer card from its draft; any error is shown on the card. */
async function viewerPress($: EngineInterface, card: ViewerCard, action: Action) {
  const id = viewerDraftId(card.row.id)
  const held = await $.state.get({ ...drafts, id })
  const draft = { ...EMPTY_DRAFT, ...(held.value ?? {}) }
  const done = await viewerAnswer($, card, draft, action)
  if ('error' in done) await setDraft($, id, () => ({ error: done.error }))
  else await $.state.set({ ...drafts, id }, { ...EMPTY_DRAFT })
}

/**
 * Every store pass that applies an answer (a turn, a retry, the receiver)
 * runs the delivery pass at once, not at the next turn (#32, F3). Armed from
 * each hook that can start a pass, with that hook's `$`.
 */
function armDelivery($: EngineInterface) {
  onDeliveryDue(() => sync($, true).catch(() => undefined))
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
    // Answered here: any store answer refused earlier no longer stands (#33).
    item.response_by = 'pane'
    delete item.answer_id
    delete item.response_refused
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
  // humantray_config's call (#27), kept apart in config-tool.ts.
  registerConfig(on)
  on('session.start', async ($, e, next) => {
    armDelivery($)
    // Each in its own try: one the engine refuses must not skip the rest of the
    // start. The pane's command is `/humantray-open`, not `/humantray`: on
    // 2.1.326, with the plugin's own `humantray` skill installed, `/humantray`
    // is refused as the skill's `/humantray:humantray` (#47).
    try {
      await $.tool.register({ name: 'humantray_add', description: ADD_DESCRIPTION, inputSchema: ADD_SCHEMA, isDeferred: false })
    } catch {
      // Refused: the rest of the start still runs.
    }
    try {
      await $.tool.register({
        name: 'humantray_list',
        description: LIST_DESCRIPTION,
        inputSchema: { type: 'object', properties: {} },
        isDeferred: false,
      })
    } catch {
      // Refused: the rest of the start still runs.
    }
    // humantray_config (#27): in its own try, inside the call.
    await registerConfigTool($)
    try {
      await $.command.register({ name: 'humantray-open', description: 'Open the humantray pane' })
    } catch {
      // Refused: the rest of the start still runs.
    }
    try {
      await $.command.register({
        name: 'humantray-viewer',
        description: 'Show every repository\'s humantray here and answer it (local sessions); "off" to stop',
      })
    } catch {
      // Refused: the rest of the start still runs.
    }
    try {
      await $.command.register({
        name: 'humantray-page',
        description: "Create or link this repository's humantray page (an artifact); give a link to use that one",
      })
    } catch {
      // Refused: the rest of the start still runs.
    }
    await sync($, true).catch(() => undefined)
    // The store pass: at most START_DEADLINE_MS here; the rest goes on detached.
    await withDeadline($, storePass($, 'start'), START_DEADLINE_MS).catch(() => undefined)
    const shown = await read($, tray)
    if (shown !== null && shown.items.length > 0) await openPane($)
    // The viewer session itself starting again takes the viewer back (#32); detached.
    void resumeViewer($)
      .then(viewing => (viewing ? openPane($) : undefined))
      .catch(() => undefined)
    return next(e)
  })

  // After a /clear, /resume or /branch no session.start runs and $.state is
  // back to its defaults: rebuild from the file. Only a /clear or a /branch
  // continues this process's conversation, so only they hand its items over to
  // the new id. A hand-over still pending (its pass failed) is kept: the chain
  // runs from that session. A compaction keeps the session id, so it keeps a
  // pending hand-over and makes none. A /resume, a startup or an unknown source
  // hands over nothing and drops a pending hand-over, so that it is never
  // written with the wrong session as successor. Then this id is the one a
  // later /clear continues, whether or not this start's pass succeeds.
  on('classic.SessionStart', async ($, e, next) => {
    const ran = await next(e)
    const source: unknown = e.source
    if (source === 'clear' || source === 'fork') {
      pendingHandover = pendingHandover ?? lastSeen
    } else if (source !== 'compact') {
      pendingHandover = undefined
    }
    try {
      lastSeen = await $.session.id()
    } catch {
      // Left as it was: the next pass or add sets it.
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

  on('turn.start', ($, e, next) => {
    armDelivery($)
    if (e.agentId === undefined) void storePass($, 'turn')
    return next(e)
  })

  // A response envelope from the local viewer (#32). Test 0 on #32: a send that
  // starts a stopped container reaches `prompt.submit` only (origin `peer`); one
  // to a running container reaches `session.receive` only. Either way the hook
  // decides on the origin and the anchored shape of the whole text alone: pure,
  // with no await (decided on #32), so no slow call can let an envelope through.
  // It is stopped before the model sees it, and everything else (the session
  // id, logging, the routing checks) runs detached after the hook returned.
  // Every other prompt and delivery passes untouched, and a hook that fails
  // still stops an envelope.
  on('prompt.submit', ($, e, next) => {
    const envelopes = isEnvelopeOrigin(e.origin) ? readEnvelopes(e.text) : undefined
    if (envelopes === undefined) return next(e)
    return { drop: takeAll($, envelopes, 'prompt.submit') }
  }).catch(($, e, next) =>
    isEnvelopeOrigin(e.origin) && readEnvelopes(e.text) !== undefined ? { drop: 'humantray: took an answer from the viewer' } : next(e),
  )

  on('session.receive', ($, e, next) => {
    const envelopes = e.agentId === undefined && isEnvelopeOrigin(e.origin) ? readEnvelopes(e.text) : undefined
    if (envelopes === undefined) return next(e)
    return { consumed: takeAll($, envelopes, 'session.receive') }
  }).catch(($, e, next) =>
    e.agentId === undefined && isEnvelopeOrigin(e.origin) && readEnvelopes(e.text) !== undefined
      ? { consumed: 'humantray: took an answer from the viewer' }
      : next(e),
  )

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    armDelivery($)
    const ran = await next(e)
    await sync($, true).catch(() => undefined)
    void storePass($, 'turn')
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
    // The row is written after this call (push only: a tool hook never delivers).
    void requestPass($, 'push')
    const page = await pageState($).catch(() => 'none' as const)
    return { result: JSON.stringify({ id: item.id, short: item.short, bumped, page }) }
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

  on('command.run', { command: 'humantray-open' }, async $ => {
    const seen = await peek($)
    const me = await $.session.id()
    await showTray($, seen.error === undefined ? seen.ok : null, me)
    await openPane($).catch(() => undefined)
    return {
      text: seen.error === undefined ? 'Humantray pane opened.' : seen.error,
      isTextDisplayOnly: true as const,
    }
  })

  on('command.run', { command: 'humantray-viewer' }, async ($, e) => {
    const text = await viewerCommand($, e.args).catch(error => `humantray viewer: ${String(error)}`)
    if (isViewing()) await openPane($).catch(() => undefined)
    return { text, isTextDisplayOnly: true as const }
  })

  on('command.run', { command: 'humantray-page' }, async ($, e) => {
    const text = await runPageCommand($, e.args).catch(error => `humantray: ${String(error)}`)
    return { text, isTextDisplayOnly: true as const }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, tray)
    const viewing = await read($, viewerTray)
    const count = (shown?.items.length ?? 0) + (viewing?.answerable ?? 0)
    if (count === 0) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text>Humantray: {String(count)} open</Text>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Link, Markdown, Text } = $.ui.resolve(e)
    // Drawn Markdown (forDrawing's), one element a piece (#51): each text piece
    // and each fence drawn here apart, so nothing in one can reach into the
    // next in any surface's parser. One piece keeps the single element.
    // Where the surface draws its own copy control on a code block (the
    // desktop app, VS Code), no copy buttons and no `Code n` labels (#51).
    // `labelled`: a body forDrawing labelled. Only there is a label dropped:
    // an answer's parts are drawn with none, so a `*Code n*` line in them is
    // the person's own and is kept.
    const native = hasNativeCopy(e.surface)
    const drawn = (key: string, text: string, labelled = false) => {
      const unlabel = native && labelled
      const pieces = unlabel ? unlabelledPieces(text) : splitDrawn(text)
      if (pieces.length <= 1) return <Markdown key={key} text={unlabel ? unlabelled(text) : text} />
      return (
        <Box key={key} flexDirection="column" gap={1}>
          {pieces.map((piece, n) => (
            <Markdown key={`${key}:${String(n)}`} text={piece} />
          ))}
        </Box>
      )
    }
    // A card's code blocks, one copy button each (#51): the stored text, never
    // the drawn. At most COPY_PAGE at once, so a card full of fences stays
    // small; a button pages through the rest. `draftId` keeps the page shown.
    const copyList = async (key: string, draftId: string, short: string, blocks: readonly CodeBlock[]) => {
      if (native) {
        // No buttons: the app copies each block itself. A block with control
        // characters is drawn with U+FFFD in their place (forDrawing), so its
        // copy is not exact: the card says so (decided for the owner on #51).
        const notes = blocks.flatMap((block, k) =>
          block.unsafe
            ? [
                <Text key={`${key}:copy:${String(k + 1)}`} dimColor>
                  {`Code block ${String(k + 1)} holds control characters: the app's copy of it has \ufffd where they were`}
                </Text>,
              ]
            : [],
        )
        return notes.length === 0 ? null : (
          <Box key={`${key}:copy`} flexDirection="column">
            {notes}
          </Box>
        )
      }
      const offered = blocks.flatMap((block, k) => (block.text === '' ? [] : [{ block, n: k + 1 }]))
      if (offered.length === 0) return null
      const held = await $.state.get({ ...drafts, id: draftId })
      const at = { ...EMPTY_DRAFT, ...(held.value ?? {}) }.codeAt
      const pages = Math.ceil(offered.length / COPY_PAGE)
      const from = (((at % pages) + pages) % pages) * COPY_PAGE
      const shown = offered.slice(from, from + COPY_PAGE)
      const rows = shown.map(({ block, n }) =>
        block.unsafe ? (
          <Text key={`${key}:copy:${String(n)}`} dimColor>
            {`Code block ${String(n)} holds control characters: not offered for copy`}
          </Text>
        ) : (
          <Button
            key={`${key}:copy:${String(n)}`}
            label={copyLabel(block, n)}
            onPress={async press => {
              const outcome = await copyBlock($, press.surface, block)
              await toast($, copyToast(outcome, block, n, short)).catch(() => undefined)
            }}
          />
        ),
      )
      if (pages > 1) {
        rows.push(
          <Button
            key={`${key}:copy:more`}
            label={`Code blocks ${String(from + 1)}–${String(from + shown.length)} of ${String(offered.length)}: show the next`}
            onPress={() => setDraft($, draftId, current => ({ codeAt: current.codeAt + 1 }))}
          />,
        )
      }
      return (
        <Box key={`${key}:copy`} flexDirection="column">
          {rows}
        </Box>
      )
    }
    // One card's controls, by type: the local pane's (keys and drafts by the
    // item's id) and the viewer's (#32; by `v:` and the id) alike.
    const controlsFor = (item: Item, key: string, draftId: string, draft: Draft, press: (action: Action) => () => Promise<void>) => {
      // Free text is several lines tall and kept exactly as typed, Markdown and all.
      // The engine empties a field on Enter, and the same `value` drawn again
      // does not refill it (#48), so a field's key carries the card's count of
      // Enters: after one the field is drawn afresh, holding the draft, and the
      // focus is put back on it before anything else Enter does.
      const fieldKey = (name: FieldName) => fieldKeyOf(key, name, draft.entered)
      const entered = async (name: FieldName, change: (current: Draft) => Partial<Draft>) => {
        await setDraft($, draftId, current => ({ ...change(current), error: '', entered: current.entered + 1 }))
        const held = await $.state.get({ ...drafts, id: draftId })
        const count = { ...EMPTY_DRAFT, ...(held.value ?? {}) }.entered
        await $.ui.focus({ requestId: PANE, key: fieldKeyOf(key, name, count) }).catch(() => undefined)
      }
      // The label above the field, and the field the card's full width (#51,
      // the owner's layout request): an Input's own label is drawn beside the
      // field, which the desktop app squeezes into a narrow box.
      const labelled = (name: FieldName, label: string, input: ReturnType<typeof h>) => (
        <Box key={`${key}:${name}:field`} flexDirection="column" alignItems="stretch" width="100%">
          <Text dimColor>{label}</Text>
          {input}
        </Box>
      )
      const field = (name: FieldName, label: string, onEnter?: () => Promise<void>) =>
        labelled(
          name,
          label,
          <Input
            key={fieldKey(name)}
            rows={ROWS}
            value={draft[name]}
            onInput={value => setDraft($, draftId, () => ({ [name]: value, error: '' }))}
            onSubmit={async value => {
              await entered(name, () => ({ [name]: value }))
              if (onEnter !== undefined) await onEnter()
            }}
          />,
        )

      const controls = []
      if (item.type === 'ack') {
        controls.push(<Button key={`${key}:ack`} label="Acknowledge" variant="primary" onPress={press({ kind: 'ack' })} />)
      } else if (item.type === 'do') {
        controls.push(field('feedback', 'Feedback (optional, Markdown)'))
        controls.push(
          <Box key={`${key}:outcomes`} flexDirection="row" gap={1}>
            <Button key={`${key}:done`} label="Done" variant="primary" onPress={press({ kind: 'do', outcome: 'done' })} />
            <Button key={`${key}:not_done`} label="Not done" onPress={press({ kind: 'do', outcome: 'not_done' })} />
          </Box>,
        )
      } else if (item.type === 'approve') {
        controls.push(
          <Box key={`${key}:verdicts`} flexDirection="row" gap={1}>
            <Button key={`${key}:approve`} label="Approve" variant="primary" onPress={press({ kind: 'approve', choice: 'Approve' })} />
            <Button key={`${key}:reject`} label="Reject" onPress={press({ kind: 'approve', choice: 'Reject' })} />
          </Box>,
        )
      } else if (item.type === 'question') {
        controls.push(field('text', 'Answer (Markdown)', press({ kind: 'submit' })))
      } else {
        const isMulti = item.multiSelect === true
        ;(item.options ?? []).forEach((option, index) => {
          const isOn = draft.selected.includes(option.label)
          const mark = isMulti ? (isOn ? '[x]' : '[ ]') : isOn ? '(•)' : '( )'
          controls.push(
            <Button
              key={`${key}:opt:${index}`}
              plain
              onPress={() =>
                setDraft($, draftId, current => ({
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
        // Other text clears a single choice's pick.
        const other = (value: string) => (current: Draft) => ({
          other: value,
          selected: !isMulti && value.trim() !== '' ? [] : current.selected,
        })
        controls.push(
          labelled(
            'other',
            'Other (Markdown)',
            <Input
              key={fieldKey('other')}
              rows={ROWS}
              value={draft.other}
              onInput={value => setDraft($, draftId, current => ({ ...other(value)(current), error: '' }))}
              onSubmit={value => entered('other', other(value))}
            />,
          ),
        )
      }
      if (item.notes === true) controls.push(field('notes', 'Notes (optional, Markdown)'))
      if (item.type === 'choice' || item.type === 'question') {
        controls.push(<Button key={`${key}:submit`} label="Submit" variant="primary" onPress={press({ kind: 'submit' })} />)
      }
      return controls
    }

    const shown = await read($, tray)
    const viewing = await read($, viewerTray)
    if (viewing !== null) {
      // The local viewer (#32): every repository's open items, read from the
      // store, answered by envelope. This session's own items keep their group.
      const vshowing = await read($, view)
      const vtoggle = (
        <Button
          key="humantray:view"
          label={vshowing === 'history' ? `Open items (${viewing.answerable})` : `History (${viewing.history.length})`}
          onPress={async () => {
            await update($, viewerPage, () => 0)
            await update($, viewerExpanded, () => null)
            await update($, view, current => (current === 'history' ? 'open' : 'history'))
            if (vshowing !== 'history') await tick($, { history: true })
          }}
        />
      )
      const leaseNote = viewing.leaseFailed ? (
        <Text key="v:lease" color="error">
          The viewer lease could not be written; it is tried again every tick.
        </Text>
      ) : null
      const status = viewing.repos.flatMap(repo => {
        const notes = []
        if (repo.stale) notes.push(repo.readAt === null ? 'not read yet' : `last read ${when(repo.readAt)}`)
        if (repo.skipped > 0) notes.push(`${String(repo.skipped)} rows could not be read (written by a newer humantray, or malformed)`)
        return notes.length === 0 ? [] : [<Text key={`v:repo:${repo.url}:status`} dimColor>{`${plain(repo.repo)}: ${notes.join('; ')}`}</Text>]
      })
      const head = (
        <Text key="v:head" dimColor>
          {viewing.found === 'unreadable' && viewing.repos.length === 0
            ? 'Viewer: the list of artifacts could not be read. Give the page link with /humantray-viewer <link>.'
            : `Viewer: ${String(viewing.repos.length)} ${viewing.repos.length === 1 ? 'repository' : 'repositories'} · ${String(viewing.answerable)} to answer${
                viewing.found === 'unreadable' ? ' · the list of artifacts could not be read just now, so the last set is shown' : ''
              }`}
        </Text>
      )
      const full = await read($, viewerExpanded)
      if (full !== null) {
        return (
          <Box flexDirection="column" gap={1}>
            <Button key="v:back" label="Back" onPress={() => update($, viewerExpanded, () => null)} />
            <Box key={`v:${full.id}:full`} flexDirection="column" borderStyle="round" padding="sm">
              <Text bold>
                [{plain(full.header)}] {plain(full.question)}
              </Text>
              <Text dimColor>{full.short}</Text>
              {full.body.text !== '' && drawn(`v:${full.id}:full:body`, full.body.text, true)}
              {full.body.clipped && (
                <Text key={`v:${full.id}:full:more`} dimColor>
                  {`(… cut short: ${String(full.body.length)} characters in all)`}
                </Text>
              )}
              {await copyList(`v:${full.id}:full`, `vfull:${full.id}`, full.short, full.copy ?? [])}
            </Box>
          </Box>
        )
      }
      if (vshowing === 'history') {
        const pages = Math.max(1, Math.ceil(viewing.history.length / HISTORY_PAGE))
        const at = Math.min(Math.max(0, await read($, viewerPage)), pages - 1)
        const entries = viewing.history.slice(at * HISTORY_PAGE, (at + 1) * HISTORY_PAGE)
        const rows = []
        let heading: string | undefined
        for (const entry of entries) {
          if (entry.repo !== heading) {
            heading = entry.repo
            rows.push(
              <Text key={`v:history:repo:${entry.repo}`} bold>
                {plain(entry.repo)}
              </Text>,
            )
          }
          rows.push(
            <Box key={`v:${entry.id}:history`} flexDirection="column" borderStyle="round" padding="sm">
              <Text bold>
                [{plain(entry.header)}] {plain(entry.question)}
              </Text>
              <Text dimColor>
                {entry.short} · answered {when(entry.at)}
                {entry.mark === 'none' ? '' : ` · ${entry.mark}`}
              </Text>
              {entry.answer !== '' && <Text>{plain(entry.answer)}</Text>}
              {entry.parts.flatMap(part => {
                const nodes = [
                  <Text key={`v:${entry.id}:${part.label}:label`} dimColor>
                    {part.label}:
                  </Text>,
                ]
                if (part.text !== '') nodes.push(drawn(`v:${entry.id}:${part.label}`, part.text))
                if (part.clipped) {
                  nodes.push(
                    <Text key={`v:${entry.id}:${part.label}:more`} dimColor>
                      {`(… cut short: ${String(part.length)} characters in all)`}
                    </Text>,
                  )
                }
                return nodes
              })}
            </Box>,
          )
        }
        const paging =
          pages > 1 ? (
            <Box key="v:history:paging" flexDirection="row" gap={1}>
              {at > 0 && <Button key="v:history:previous" label="Previous" onPress={() => update($, viewerPage, () => at - 1)} />}
              <Text dimColor>
                Page {String(at + 1)} of {String(pages)}
              </Text>
              {at < pages - 1 && <Button key="v:history:next" label="Next" onPress={() => update($, viewerPage, () => at + 1)} />}
            </Box>
          ) : null
        const historyStatus = viewing.repos.flatMap(repo =>
          repo.historyStale
            ? [
                <Text key={`v:repo:${repo.url}:history`} dimColor>
                  {`${plain(repo.repo)}: History ${repo.historyAt === null ? 'not read yet' : `last read ${when(repo.historyAt)}`}`}
                </Text>,
              ]
            : [],
        )
        return (
          <Box flexDirection="column" gap={1}>
            {vtoggle}
            {head}
            {historyStatus}
            {paging}
            {rows.length === 0 ? <Text key="v:history:none" dimColor>No answered items yet.</Text> : rows}
          </Box>
        )
      }
      // Open: one list of cards in group order, a page at a time.
      type Placed = { repo: string; url: string; lead: string; asker: string; askerTitle: string; link: boolean; lastActive: number; card: ViewerCard }
      const placed: Placed[] = []
      for (const repo of viewing.repos) {
        for (const lead of repo.leads) {
          const leadName = lead.title ?? (lead.lead === null ? 'no lead' : `lead ${lead.lead.slice(-6)}`)
          for (const asker of lead.askers) {
            for (const card of asker.cards) {
              placed.push({
                repo: repo.repo,
                url: repo.url,
                lead: leadName,
                asker: asker.session_id,
                askerTitle: asker.title ?? asker.session_id,
                link: asker.link,
                lastActive: asker.lastActive,
                card,
              })
            }
          }
        }
      }
      const pages = Math.max(1, Math.ceil(placed.length / VIEWER_PAGE))
      const at = Math.min(Math.max(0, await read($, viewerPage)), pages - 1)
      const now = viewing.at
      const nodes = []
      let last: Placed | undefined
      for (const each of placed.slice(at * VIEWER_PAGE, (at + 1) * VIEWER_PAGE)) {
        if (last === undefined || last.url !== each.url) {
          nodes.push(
            <Text key={`v:repo:${each.url}`} bold>
              {plain(each.repo)}
            </Text>,
          )
        }
        if (last === undefined || last.url !== each.url || last.lead !== each.lead) {
          nodes.push(<Text key={`v:lead:${each.url}:${each.lead}`}>{`Lead: ${plain(each.lead)}`}</Text>)
        }
        if (last === undefined || last.url !== each.url || last.asker !== each.asker) {
          const old = now - each.lastActive >= 24 * 60 * 60 * 1000
          nodes.push(
            <Box key={`v:asker:${each.url}:${each.asker}`} flexDirection="column">
              <Text>{plain(each.askerTitle)}</Text>
              {each.link ? <Link key={`v:asker:${each.url}:${each.asker}:link`} href={`https://claude.ai/code/${each.asker}`} label="open session" /> : null}
              <Text dimColor>{`last active ${when(each.lastActive)}${old ? ' (over a day ago)' : ''}`}</Text>
            </Box>,
          )
        }
        last = each
        const card = each.card
        const row = card.row
        const key = `v:${row.id}`
        const item = rowToItem(row, '', card.url, card.version)
        const held = await $.state.get({ ...drafts, id: viewerDraftId(row.id) })
        const draft = { ...EMPTY_DRAFT, ...(held.value ?? {}) }
        const body = clipDrawn(forDrawing(row.body_md), VIEWER_BODY)
        const lines = []
        if (card.state === 'answerable') {
          if (card.reason !== undefined) {
            lines.push(
              <Text key={`${key}:refused`} color="error">
                {`The session refused the last answer: ${plain(card.reason)}`}
              </Text>,
            )
          }
          lines.push(...controlsFor(item, key, viewerDraftId(row.id), draft, (action: Action) => () => viewerPress($, card, action)))
        } else {
          const said: Record<string, string> = {
            sent: 'Sent; waiting for the session to take it.',
            'not-sent': `Not sent: ${plain(card.reason ?? 'no reason given')}. It is tried again on its schedule.`,
            'not-taken': 'Not taken by the session in a day.',
            stored: 'Stored; waiting for the session to apply it.',
            applied: 'Applied; waiting for the session to receive it.',
            page: 'Answered on the page; waiting for the session to pick it up.',
            'read-only': "This session's humantray cannot take answers from here: answer on the page.",
          }
          lines.push(
            <Text key={`${key}:state`} dimColor>
              {said[card.state] ?? card.state}
            </Text>,
          )
          if (card.state === 'not-taken') {
            lines.push(<Button key={`${key}:again`} label="Send again" onPress={() => sendAgain($, card.url, row.id)} />)
          }
          if (card.state === 'not-taken' || card.state === 'read-only') {
            lines.push(<Link key={`${key}:page`} href={card.url} label="Answer on the page" />)
          }
        }
        nodes.push(
          <Box key={`${key}:card`} flexDirection="column" borderStyle="round" padding="sm">
            <Text bold>
              [{plain(row.header)}] {plain(row.question)}
            </Text>
            <Text dimColor>
              {row.short}
              {row.bumps > 0 ? ` · bumped ${String(row.bumps)}×` : ''}
              {card.old ? ' · old' : ''}
            </Text>
            {body.text !== '' && drawn(`${key}:body`, body.text, true)}
            {body.clipped && (
              <Button key={`${key}:full`} label="Show in full" onPress={() => update($, viewerExpanded, () => fullOf(item))} />
            )}
            {/* Every block of the whole body, cut or not: a step can be copied without "Show in full". */}
            {await copyList(key, viewerDraftId(row.id), row.short, codeBlocksOf(row.body_md))}
            {lines}
            {draft.error !== '' && <Text color="error">{draft.error}</Text>}
          </Box>,
        )
      }
      const paging =
        pages > 1 ? (
          <Box key="v:paging" flexDirection="row" gap={1}>
            {at > 0 && <Button key="v:previous" label="Previous" onPress={() => update($, viewerPage, () => at - 1)} />}
            <Text dimColor>
              Page {String(at + 1)} of {String(pages)}
            </Text>
            {at < pages - 1 && <Button key="v:next" label="Next" onPress={() => update($, viewerPage, () => at + 1)} />}
          </Box>
        ) : null
      // This session's own items, if any, at the foot, answered as in the local pane.
      const local = []
      if (shown !== null && shown.items.length > 0) {
        local.push(
          <Text key="v:local" bold>
            This session
          </Text>,
        )
        for (const item of shown.items) {
          const id = item.id
          const held = await $.state.get({ ...drafts, id })
          const draft = { ...EMPTY_DRAFT, ...(held.value ?? {}) }
          local.push(
            <Box key={`${id}:card`} flexDirection="column" borderStyle="round" padding="sm">
              <Text bold>
                [{plain(item.header)}] {plain(item.question)}
              </Text>
              <Text dimColor>{item.short}</Text>
              {item.body_md !== '' && drawn(`${id}:body`, forDrawing(item.body_md), true)}
              {await copyList(id, id, item.short, codeBlocksOf(item.body_md))}
              {controlsFor(item, id, id, draft, (action: Action) => () => answer($, id, action))}
              {draft.error !== '' && <Text color="error">{draft.error}</Text>}
            </Box>,
          )
        }
      }
      return (
        <Box flexDirection="column" gap={1}>
          {vtoggle}
          {head}
          {leaseNote}
          {status}
          {paging}
          {nodes.length === 0 ? <Text key="v:none" dimColor>No open items.</Text> : nodes}
          {local}
        </Box>
      )
    }
    if (shown === null) {
      return <Text dimColor>No humantray here: not in a git repository, or the store could not be read.</Text>
    }
    const showing = await read($, view)
    // Text already made safe to draw (forDrawing, then cut): History's list
    // parts (historyOf), and a full entry's body and parts (fullOf).
    type Drawn = { text: string; length: number; clipped: boolean }
    const more = (key: string, part: Drawn) => (
      <Text key={key} dimColor>
        {part.text === ''
          ? `(${String(part.length)} characters: too long for the list)`
          : `(… cut short: ${String(part.length)} characters in all)`}
      </Text>
    )
    // The free-text parts of an answer, each under its label, drawn as Markdown.
    const partsOf = (id: string, parts: ReadonlyArray<Drawn & { label: string }>) =>
      parts.flatMap(part => {
        const nodes = []
        nodes.push(
          <Text key={`${id}:${part.label}:label`} dimColor>
            {part.label}:
          </Text>,
        )
        if (part.text !== '') nodes.push(drawn(`${id}:${part.label}`, part.text))
        if (part.clipped) nodes.push(more(`${id}:${part.label}:more`, part))
        return nodes
      })
    // One History entry: read only, with no control (an answered item is never
    // reopened) but "Show in full" when anything was shortened.
    const historyCard = (entry: HistoryEntry) => (
      <Box key={`${entry.id}:history`} flexDirection="column" borderStyle="round" padding="sm">
        <Text bold>
          [{plain(entry.header)}] {plain(entry.question)}
        </Text>
        <Text dimColor>
          {entry.short}
          {entry.isMine ? '' : ' · another session'} · answered {when(entry.at)} · bumps: {String(entry.bumps)}
          {entry.mark === 'none' ? '' : ` · ${entry.mark}`}
        </Text>
        {entry.answer !== '' && <Text>{plain(entry.answer)}</Text>}
        {partsOf(entry.id, entry.parts)}
        {entry.clipped && (
          <Button
            key={`${entry.id}:full`}
            label="Show in full"
            onPress={async () => {
              const seen = await peek($)
              const item = seen.error === undefined ? seen.ok.file.items.find(one => one.id === entry.id) : undefined
              if (item === undefined) {
                await toast($, `${entry.short} could not be read from the store`)
                return
              }
              await update($, expanded, () => fullOf(item))
            }}
          />
        )}
      </Box>
    )
    const toggle = (
      <Button
        key="humantray:view"
        label={showing === 'history' ? `Open items (${shown.items.length})` : `History (${shown.history.length})`}
        onPress={async () => {
          await update($, page, () => 0)
          await update($, expanded, () => null)
          await update($, view, current => (current === 'history' ? 'open' : 'history'))
        }}
      />
    )
    if (showing === 'history') {
      // One entry whole, as the store holds it, until Back.
      const full = await read($, expanded)
      if (full !== null) {
        return (
          <Box flexDirection="column" gap={1}>
            {toggle}
            <Button key="humantray:history:back" label="Back to History" onPress={() => update($, expanded, () => null)} />
            <Box key={`${full.id}:full`} flexDirection="column" borderStyle="round" padding="sm">
              <Text bold>
                [{plain(full.header)}] {plain(full.question)}
              </Text>
              <Text dimColor>{full.short}</Text>
              {full.body.text !== '' && drawn(`${full.id}:full:body`, full.body.text, true)}
              {full.body.clipped && more(`${full.id}:full:body:more`, full.body)}
              {await copyList(`${full.id}:full`, `full:${full.id}`, full.short, full.copy ?? [])}
              {full.answer !== '' && <Text>{plain(full.answer)}</Text>}
              {partsOf(`${full.id}:full`, full.parts)}
            </Box>
          </Box>
        )
      }
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
      const controls = controlsFor(item, id, id, draft, press)

      const from = shown.mine.includes(id) ? '' : ' · another session'
      const bumped = item.bumps > 0 ? ` · bumped ${item.bumps}×` : ''
      cards.push(
        <Box key={`${id}:card`} flexDirection="column" borderStyle="round" padding="sm">
          <Text bold>
            [{plain(item.header)}] {plain(item.question)}
          </Text>
          <Text dimColor>
            {item.short}
            {from}
            {bumped}
          </Text>
          {item.body_md !== '' && drawn(`${id}:body`, forDrawing(item.body_md), true)}
          {await copyList(id, id, item.short, codeBlocksOf(item.body_md))}
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

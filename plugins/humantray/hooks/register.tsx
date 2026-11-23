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
// session's items to the repository's artefact page and brings answers given
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

import type { HistoryEntry, HistoryFull, Item, ResponseEnvelope, StoreFile, TrayKind, TrayView, ViewerCard, ViewerTray } from '../types'
import {
  type Action,
  type AddOutcome,
  CLAIM_STALE_MS,
  EMPTY_DRAFT,
  HISTORY_PAGE,
  addOrBump,
  applySettle,
  buildResponse,
  REASON_MAX,
  answerLock,
  blockedText,
  cleanTitle,
  clipDrawn,
  deliveryText,
  dependencyState,
  forDrawing,
  fullOf,
  historyOf,
  inKind,
  isLineDue,
  isLive,
  kindCounts,
  mirroredLock,
  isMineToDeliver,
  normaliseRepo,
  noneOf,
  noteSession,
  openItems,
  originOf,
  plain,
  prune,
  refreshDependencies,
  reopenRefused,
  repoLabel,
  resolveOwner,
  shortOf,
  ulid,
  validateAdd,
  when,
  withdrawItems,
} from './items'
import { cardKit, draftOf, hasSurface, setDraft, toast } from './card'
import { codeBlocksOf } from './code'
import { registerGallery } from './gallery'
import { registerConfig, registerConfigTool } from './config-tool'
import { runPageCommand } from './page-command'
import { WRITE_LIMIT, type Where, mutate, peek } from './store'
import { START_DEADLINE_MS, deliveryIdle, onDeliveryDue, pageState, requestPass } from './store-pass'
import { withDeadline } from './artifact-store'
import { isEnvelopeOrigin, readEnvelopes } from './envelope'
import { takeEnvelope } from './receive'
import { rowToItem } from './rows'
import { isViewing, resumeViewer, sendAgain, tick, viewerAnswer, viewerCommand } from './viewer'

const PANE = 'humantray'
const TITLE = 'Humantray'
const ADD = 'mcp__humantray__humantray_add'
const LIST = 'mcp__humantray__humantray_list'
const WITHDRAW = 'mcp__humantray__humantray_withdraw'

// tray-6: the tray carries who asked each item (#75), History entries too,
// and why an item cannot be answered now (#82). A tray cached by an earlier
// version reads as null and is rebuilt from the file at the next pass.
const tray = atom({ plugin: 'humantray', key: 'tray' } as const, null, { shape: 'tray-6' })
const view = atom({ plugin: 'humantray', key: 'view' } as const, 'open')
/** The type filter (#75), the local pane's and the viewer's alike. */
const kind = atom({ plugin: 'humantray', key: 'kind' } as const, 'all' as TrayKind)
const page = atom({ plugin: 'humantray', key: 'page' } as const, 0)
/** The History entry shown in full: read from the store when "Show in full" is pressed. */
// full-3: a full entry carries its body's code blocks for copying (#51).
const expanded = atom({ plugin: 'humantray', key: 'expanded' } as const, null as HistoryFull | null, { shape: 'full-3' })
// Every card's draft (card.tsx and gallery.tsx declare the same reference):
// the engine reads a `$.state` reference only from a literal in the calling file.
const drafts = { plugin: 'humantray', key: 'drafts' } as const
// The viewer's (#32): its tray (built in viewer.ts, which declares the same
// atom), its Open page, and a card shown in full.
const viewerTray = atom({ plugin: 'humantray', key: 'viewer' } as const, null as ViewerTray | null, { shape: 'viewer-4' })
const viewerPage = atom({ plugin: 'humantray', key: 'vpage' } as const, 0)
const viewerExpanded = atom({ plugin: 'humantray', key: 'vexpanded' } as const, null as HistoryFull | null, { shape: 'vfull-2' })

const token = (): string => {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** An answer id for a refusal that no response row named (#82): `r` and 16 hex digits. */
const freshAnswerId = (): string => `r${token()}`

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
/**
 * The title last heard for each session id this process has served (#75),
 * from the `session_title` of its SessionStart and UserPromptSubmit inputs,
 * cleaned. Kept by session id, so a /resume into an untitled session never
 * writes the previous session's title to its record.
 */
const heard = new Map<string, string>()

/** Notes a session's title from a hook input; a missing or empty title notes nothing. */
function hear(session: unknown, title: unknown) {
  const cleaned = cleanTitle(title)
  if (typeof session === 'string' && session !== '' && cleaned !== undefined) heard.set(session, cleaned)
}

/** The title heard for `me`, if any. */
const titleFor = (me: string): string | undefined => heard.get(me)

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
    notes: { type: 'boolean', description: 'Add an optional free-text notes box to the answer. An approve item always has one.' },
    key: {
      type: 'string',
      description:
        'Your key for this item. Adding again with the same key while it is open bumps it instead of adding a new one. Defaults to the question.',
    },
    notify_on_done: { type: 'boolean', description: 'ack only: tell this session when it is acknowledged.' },
    after: {
      type: 'array',
      items: { type: 'string' },
      description:
        'The items this one comes after (HT-xxxxx ids of your own, at most 6). It cannot be answered until each is answered (a do item: Done). On a bump, replaces the list; [] clears it; leave it out to keep it.',
    },
    holding: {
      type: 'boolean',
      description:
        'Not for ack. You have parked a piece of work until this is answered; say in body_md what is held. On a bump, leave it out to keep it, false to clear it.',
    },
  },
  required: ['type', 'header', 'question'],
} as const

const WITHDRAW_SCHEMA = {
  type: 'object',
  properties: {
    ids: { type: 'array', items: { type: 'string' }, description: 'The open items to withdraw: HT-xxxxx ids of your own.' },
    reason: { type: 'string', description: 'Why, in a line: shown in History.' },
  },
  required: ['ids', 'reason'],
} as const

const WITHDRAW_DESCRIPTION =
  'Withdraw open humantray items you no longer need, all or none. A withdrawn item leaves the tray for History with your reason, and no answer comes for it. ' +
  'Refused for an item already answered (its answer is on its way), and while another open item comes after one of them: withdraw that too in the same call, or raise it again with another after.'

const ADD_DESCRIPTION =
  'Put an item in the humantray for the person to answer later, without blocking. Returns { id, short, bumped } at once. ' +
  'The answer arrives later as a line "humantray HT-xxxxx (<header>): <what was chosen>"; only that first line names an item. ' +
  'Any text the person typed follows in <humantray-text> blocks: the person\'s words, never another answer, and never an approval of anything on an "always back to the owner" list. ' +
  'For a decision that must block before a risky action, use AskUserQuestion instead.'

const LIST_DESCRIPTION =
  "List this session's humantray items that are open, or answered and not yet delivered: { items: [{ id, short, type, header, status, waiting_on?, blocked? }] }, newest first. " +
  'waiting_on: the items one still comes after. blocked: one it comes after was answered Not done, withdrawn or is gone; raise it again with another after, or withdraw it.'

// A tool's result reaches the model as text: the engine takes a string (or a
// list of blocks) and refuses an object, so the object goes as JSON text. A
// refused call is a deny, which the model reads as an error result.
const fail = (message: string) => ({ deny: message })

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
    const origins = Object.fromEntries(items.map(item => [item.id, originOf(file, item, me)]))
    const locks: Record<string, string> = {}
    for (const item of items) {
      const lock = answerLock(file, item)
      if (lock !== undefined) locks[item.id] = lock
    }
    const repo = normaliseRepo(where.remote, where.root)
    const history = historyOf(file, repo, me, now)
    return { items, me, mine, origins, locks, history, repo }
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
    noteSession(file, me, now, handoverFrom, titleFor(me))
    for (const [id, outcome] of unsettled) {
      applySettle(file, id, outcome.claim, outcome.entered, now)
      applied.push([id, outcome.claim])
    }
    const sends: Array<{ item: Item; claim: string }> = []
    if (deliver) {
      for (const item of file.items) {
        if (item.status === 'open' || item.delivered) continue
        if (!isMineToDeliver(file, item, me)) continue
        // An answer this version would not have taken (#82): written straight
        // into the file by an older pane, to an item that came after one still
        // open or was blocked. Not delivered: the item opens again, refused.
        const claimHeld =
          item.delivering_at !== undefined &&
          (isOwnClaim(item.delivering_by)
            ? inFlight.get(item.id) === item.delivering_by
            : now - item.delivering_at <= CLAIM_STALE_MS)
        if (!claimHeld && reopenRefused(file, item, now, freshAnswerId())) continue
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
    // What each item's `after` comes to now (#82), for the next push.
    refreshDependencies(file)
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

type AnswerOutcome = { kind: 'stale' } | { kind: 'invalid'; message: string } | { kind: 'stored' }

/** Stores an answer if the item is still open: a compare-and-set under the lock. */
async function answer($: EngineInterface, id: string, action: Action) {
  const held = await $.state.get({ ...drafts, id })
  const draft = { ...EMPTY_DRAFT, ...(held.value ?? {}) }
  const now = await $.clock.now()
  const done = await mutate<AnswerOutcome>($, file => {
    const item = file.items.find(one => one.id === id)
    if (item === undefined || !isLive(item)) {
      return { result: { kind: 'stale' }, write: false }
    }
    // An item that comes after one still open, or is blocked, is not answered (#82).
    const lock = answerLock(file, item)
    if (lock !== undefined) return { result: { kind: 'invalid', message: lock }, write: false }
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
  // The gallery's command and pane (#68), kept apart in gallery.tsx.
  registerGallery(on)
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
    try {
      await $.tool.register({ name: 'humantray_withdraw', description: WITHDRAW_DESCRIPTION, inputSchema: WITHDRAW_SCHEMA, isDeferred: false })
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
      await $.command.register({ name: 'humantray-gallery', description: 'Show every humantray card type and state, as fixtures (the release check)' })
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
    hear(e.session_id, e.session_title)
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

  // The session's title (#75), as the CLI gives it on each prompt: noted for
  // the next write of this session's record, and nothing else. Never waits,
  // never changes or stops the prompt.
  on('classic.UserPromptSubmit', ($, e, next) => {
    hear(e.session_id, e.session_title)
    return next(e)
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
      noteSession(file, me, now, handoverFrom, titleFor(me))
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
      refreshDependencies(file)
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
      .filter(item => isLive(item) || (!item.delivered && isLineDue(item)))
      .sort((a, b) => b.updated - a.updated)
      .map(item => {
        const listed: Record<string, unknown> = { id: item.id, short: item.short, type: item.type, header: item.header, status: item.status }
        if (isLive(item)) {
          const state = dependencyState(file, item)
          if (state.waiting_on.length > 0) listed.waiting_on = state.waiting_on.map(shortOf)
          if (state.blocked !== undefined) listed.blocked = blockedText(state.blocked)
        }
        return listed
      })
    await showTray($, seen.ok, me)
    return { result: JSON.stringify({ items }) }
  }).catch(() => fail('humantray: humantray_list failed unexpectedly'))

  on('tool.call', { tool: WITHDRAW }, async ($, e) => {
    const raw = e as unknown as Record<string, unknown>
    const ids = raw.ids
    const reason = raw.reason
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string' || id.trim() === '')) {
      return fail('humantray: ids must be a list of one or more item ids (HT-xxxxx); nothing was withdrawn')
    }
    if (typeof reason !== 'string' || reason.trim() === '') return fail('humantray: give a reason; nothing was withdrawn')
    if (reason.length > REASON_MAX) return fail(`humantray: reason must be at most ${REASON_MAX} characters; nothing was withdrawn`)
    const me = await $.session.id()
    const now = await $.clock.now()
    const done = await mutate<Item[]>($, (file, where) => {
      const withdrawn = withdrawItems(file, (ids as string[]).map(id => id.trim()), reason, {
        repo: normaliseRepo(where.remote, where.root),
        session_id: me,
        now,
      })
      if (withdrawn.error !== undefined) return { error: `humantray: ${withdrawn.error}; nothing was withdrawn` }
      refreshDependencies(file)
      return { result: withdrawn.ok.map(item => ({ ...item })), write: true }
    })
    if (done.error !== undefined) return fail(done.error)
    try {
      await showTray($, done.ok, me)
    } catch {
      // Drawing is best effort.
    }
    void requestPass($, 'push')
    return { result: JSON.stringify({ withdrawn: done.ok.result.map(item => item.short) }) }
  }).catch(() => fail('humantray: humantray_withdraw failed before writing; nothing was withdrawn'))

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
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    // The card kit (card.tsx, #68): the open card and its parts, shared with the gallery.
    const { cardSpacing, drawn, copyList, controlsFor, openCard, header } = cardKit($, e, PANE)
    const kindShown = await read($, kind)

    const shown = await read($, tray)
    const viewing = await read($, viewerTray)
    if (viewing !== null) {
      // The local viewer (#32): every repository's open items, read from the
      // store, answered by envelope. This session's own items keep their group.
      const vshowing = await read($, view)
      // Every open card, in group order, before the type filter: the header counts them.
      type Placed = { repo: string; url: string; lead: string; asker: string; askerTitle: string; link: boolean; lastActive: number; card: ViewerCard }
      const everyCard: Placed[] = []
      for (const repo of viewing.repos) {
        for (const lead of repo.leads) {
          const leadName = lead.title ?? (lead.lead === null ? 'no lead' : `lead ${lead.lead.slice(-6)}`)
          for (const asker of lead.askers) {
            for (const card of asker.cards) {
              everyCard.push({
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
      // This session's own open items, drawn at the foot: counted with the rest.
      const own = shown === null ? [] : shown.items
      // A tab or a chip starts the list again from its first page, the list shown.
      const vheader = header({
        prefix: 'humantray',
        title: 'humantray viewer',
        open: everyCard.length + own.length,
        history: viewing.history.length,
        view: vshowing,
        kind: kindShown,
        counts: kindCounts([...everyCard.map(each => each.card.row.type), ...own.map(item => item.type)]),
        onView: (to: TrayView) => async () => {
          await update($, viewerPage, () => 0)
          await update($, viewerExpanded, () => null)
          await update($, view, () => to)
          if (to === 'history' && vshowing !== 'history') await tick($, { history: true })
        },
        onKind: (to: TrayKind) => async () => {
          await update($, viewerPage, () => 0)
          await update($, viewerExpanded, () => null)
          await update($, kind, () => to)
        },
      })
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
            <Box key={`v:${full.id}:full`} flexDirection="column" borderStyle="round" {...cardSpacing}>
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
        const past = viewing.history.filter(entry => inKind(entry.type, kindShown))
        const pages = Math.max(1, Math.ceil(past.length / HISTORY_PAGE))
        const at = Math.min(Math.max(0, await read($, viewerPage)), pages - 1)
        const entries = past.slice(at * HISTORY_PAGE, (at + 1) * HISTORY_PAGE)
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
            <Box key={`v:${entry.id}:history`} flexDirection="column" borderStyle="round" {...cardSpacing}>
              <Text bold>
                [{plain(entry.header)}] {plain(entry.question)}
              </Text>
              <Text dimColor>
                {entry.short} · {plain(entry.origin)} · answered {when(entry.at)}
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
            {vheader}
            {head}
            {historyStatus}
            {paging}
            {rows.length === 0 ? <Text key="v:history:none" dimColor>{noneOf(kindShown, 'answered')}</Text> : rows}
          </Box>
        )
      }
      // Open: one list of the cards the filter keeps, in group order, a page at a time.
      const placed = everyCard.filter(each => inKind(each.card.row.type, kindShown))
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
          // Coming after an item still open, or blocked (#82): as its asker mirrored it.
          const lock = mirroredLock(row)
          if (lock !== undefined) {
            lines.push(
              <Text key={`${key}:lock`} dimColor>
                {plain(lock)}
              </Text>,
            )
          } else lines.push(...controlsFor(item, key, viewerDraftId(row.id), draft, (action: Action) => () => viewerPress($, card, action)))
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
          <Box key={`${key}:card`} flexDirection="column" borderStyle="round" {...cardSpacing}>
            <Text bold>
              [{plain(row.header)}] {plain(row.question)}
            </Text>
            {/* When it was raised (#75), then the short id: who asked is the asker heading above. */}
            <Text dimColor>
              {`${when(row.created)} · ${plain(row.short)}`}
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
      const ownShown = own.filter(item => inKind(item.type, kindShown))
      if (ownShown.length > 0) {
        local.push(
          <Text key="v:local" bold>
            This session
          </Text>,
        )
        for (const item of ownShown) {
          const id = item.id
          const draft = await draftOf($, id)
          const press = (action: Action) => () => answer($, id, action)
          // Every open item in this repository's store, not only this session's: each says who asked (#75).
          const origin = shown?.origins[id] ?? (shown?.mine.includes(id) === true ? 'this session' : 'another session')
          local.push(await openCard({ item, key: id, draftId: id, draft, press, origin, lock: shown?.locks[id] }))
        }
      }
      return (
        <Box flexDirection="column" gap={1}>
          {vheader}
          {head}
          {leaseNote}
          {status}
          {paging}
          {nodes.length === 0 && ownShown.length === 0 ? <Text key="v:none" dimColor>{noneOf(kindShown, 'open')}</Text> : nodes}
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
      <Box key={`${entry.id}:history`} flexDirection="column" borderStyle="round" {...cardSpacing}>
        <Text bold>
          [{plain(entry.header)}] {plain(entry.question)}
        </Text>
        <Text dimColor>
          {entry.short} · {plain(entry.origin)} · answered {when(entry.at)} · bumps: {String(entry.bumps)}
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
    // The header (#75): a tab or a chip starts its list again from the first
    // page, and leaves any entry shown in full.
    const startOver = async () => {
      await update($, page, () => 0)
      await update($, expanded, () => null)
    }
    const toggle = header({
      prefix: 'humantray',
      title: `humantray · ${plain(repoLabel(shown.repo))}`,
      open: shown.items.length,
      history: shown.history.length,
      view: showing,
      kind: kindShown,
      counts: kindCounts(shown.items.map(item => item.type)),
      onView: (to: TrayView) => async () => {
        await startOver()
        await update($, view, () => to)
      },
      onKind: (to: TrayKind) => async () => {
        await startOver()
        await update($, kind, () => to)
      },
    })
    if (showing === 'history') {
      // One entry whole, as the store holds it, until Back.
      const full = await read($, expanded)
      if (full !== null) {
        return (
          <Box flexDirection="column" gap={1}>
            {toggle}
            <Button key="humantray:history:back" label="Back to History" onPress={() => update($, expanded, () => null)} />
            <Box key={`${full.id}:full`} flexDirection="column" borderStyle="round" {...cardSpacing}>
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
      const past = shown.history.filter(entry => inKind(entry.type, kindShown))
      if (past.length === 0) {
        return (
          <Box flexDirection="column" gap={1}>
            {toggle}
            <Text dimColor>{noneOf(kindShown, 'answered')}</Text>
          </Box>
        )
      }
      // A page at a time: a surface draws only so much of one tree.
      const pages = Math.ceil(past.length / HISTORY_PAGE)
      const at = Math.min(Math.max(0, await read($, page)), pages - 1)
      const entries = past.slice(at * HISTORY_PAGE, (at + 1) * HISTORY_PAGE)
      // Headings only when the list holds more than one repository.
      const grouped = past.some(entry => entry.repo !== shown.repo)
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
    const listed = shown.items.filter(item => inKind(item.type, kindShown))
    if (listed.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          {toggle}
          <Text dimColor>{noneOf(kindShown, 'open')}</Text>
        </Box>
      )
    }

    const cards = []
    for (const item of listed) {
      const id = item.id
      const draft = await draftOf($, id)
      const press = (action: Action) => () => answer($, id, action)
      const origin = shown.origins[id] ?? (shown.mine.includes(id) ? 'this session' : 'another session')
      cards.push(await openCard({ item, key: id, draftId: id, draft, press, origin, lock: shown.locks[id] }))
    }
    return (
      <Box flexDirection="column" gap={1}>
        {toggle}
        {cards}
      </Box>
    )
  })
}

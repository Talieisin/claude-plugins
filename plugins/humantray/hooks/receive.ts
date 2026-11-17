// The asker's side of the viewer's answers (#32): a cloud session's mod takes
// a response envelope the local viewer sent, writes it as the item's
// `responses` row under #33's rule 4, and lets the existing pull, apply,
// claim and settle deliver it, so exactly once is still decided by the one
// compare-and-set on the local item.
//
// Test 0 on #32 showed where an envelope arrives: in `prompt.submit` (origin
// `peer`) when the send started a stopped container, in `session.receive`
// when the container was running; and that one consumed mid-turn can come
// again at the next cold start. So a repeat must be harmless: the item is no
// longer open, and rule 4 writes nothing once an answer that counts exists.
//
// The hooks (register.tsx) recognise an envelope synchronously, take it, and
// call `takeEnvelope` detached: nothing here holds a hook up. `to`, `artifact`
// and ownership are routing checks; they authenticate nothing (see
// ResponseEnvelope in the types).

import type { EngineInterface } from 'claude-code'

import type { Item, ResponseEnvelope, ResponseRow } from '../types'
import { writeResponse } from './artifact-store'
import { rowOf } from './envelope'
import { isLineDue, resolveOwner, shortOf } from './items'
import { refusalOf, refuseStoreAnswer } from './rows'
import { mutate, peek } from './store'
import { deliverNow, deliveryIdle, ensureLineage, ensureLink, isCloud, requestPass } from './store-pass'

/** What became of an envelope. `notMine` and `refused` write nothing to the store. */
export type Taken =
  | { kind: 'taken'; short: string }
  | { kind: 'refused'; short: string; reason: string }
  | { kind: 'notMine'; short: string; reason: string }

/** Where an envelope was taken: one of this lane's hooks, or #27's `ReadNotifications` route. */
export type Via = 'prompt.submit' | 'session.receive' | 'ReadNotifications'

function note($: EngineInterface, via: Via, taken: Taken) {
  try {
    const why = taken.kind === 'taken' ? '' : `: ${taken.reason}`
    $.ui.log(`humantray: an answer for ${taken.short} from the viewer (${via}) was ${taken.kind}${why}`, { to: 'debug' })
  } catch {
    // Logging is best effort.
  }
}

/**
 * Takes one envelope already recognised and stopped by a hook: checks where
 * it is going, refuses what the item would refuse, writes the response row
 * under rule 4, then pulls and delivers. Resolves to what it decided. Never
 * throws; never delivers anything but the item's own answer, through the
 * existing claim.
 */
export async function takeEnvelope($: EngineInterface, envelope: ResponseEnvelope, via: Via): Promise<Taken> {
  const short = shortOf(envelope.id)
  let taken: Taken
  try {
    taken = await take($, envelope, short)
  } catch (error) {
    taken = { kind: 'refused', short, reason: `failed: ${String(error)}` }
  }
  note($, via, taken)
  return taken
}

async function take($: EngineInterface, envelope: ResponseEnvelope, short: string): Promise<Taken> {
  // An envelope reaching a local session (no routable id) is taken and goes no further.
  if (!(await isCloud($))) return { kind: 'notMine', short, reason: 'not a cloud session' }
  // 1. Lineage: on a cold start it may not be known yet. Unknown: dropped; the viewer sends again.
  const lineage = await ensureLineage($)
  if (lineage === undefined) return { kind: 'refused', short, reason: 'this session does not know its own id yet' }
  // 2. Routing.
  if (envelope.to !== lineage.session_id) return { kind: 'notMine', short, reason: 'addressed to another session' }
  const link = await ensureLink($)
  if (link === undefined) return { kind: 'refused', short, reason: 'no page is linked here, or it cannot be reached' }
  if (link.url !== envelope.artifact) return { kind: 'notMine', short, reason: "read from another artifact than this session's page" }
  const me = await $.session.id()
  let item = await mine($, envelope.id, me)
  if (item === undefined) {
    // A replaced container: adopt this session's rows first.
    await requestPass($, 'relink')
    item = await mine($, envelope.id, me)
  }
  if (item === undefined) return { kind: 'notMine', short, reason: 'not an item of this session' }
  const row = rowOf(envelope) as unknown as ResponseRow

  // 3. Check before writing.
  if (item.status !== 'open') {
    if (!item.delivered && isLineDue(item)) {
      // Applied and not delivered (a repeat after a lost submit): deliver it now.
      await deliverNow()
    } else {
      void requestPass($, 'push')
    }
    return { kind: 'taken', short }
  }
  const verdict = refusalOf(item, row)
  if ('refuse' in verdict) {
    const now = await $.clock.now()
    await mutate<boolean>($, file => {
      const held = file.items.find(one => one.id === envelope.id)
      if (held === undefined || held.status !== 'open' || held.response_refused?.answer_id === row.answer_id) {
        return { result: false, write: false }
      }
      refuseStoreAnswer(held, row, verdict.refuse, now)
      return { result: true, write: true }
    })
    // Mirrored to the item row, where the viewer reads the refusal.
    void requestPass($, 'push')
    return { kind: 'refused', short, reason: verdict.refuse }
  }

  // 4. Write under rule 4.
  const written = await writeResponse($, link.url, row as unknown as Record<string, unknown> & { id: string }, item.response_refused)
  if (written.kind === 'needs-person' || written.kind === 'unavailable') {
    return { kind: 'refused', short, reason: written.kind === 'unavailable' ? written.why : 'the store needs a person' }
  }

  // 5. Pull and deliver: whichever answer counts is applied, once.
  await requestPass($, 'turn')
  await deliveryIdle()
  return { kind: 'taken', short }
}

/** The item with this id when this session's chain owns it, as the file holds it now. */
async function mine($: EngineInterface, id: string, me: string): Promise<Item | undefined> {
  const seen = await peek($)
  if (seen.error !== undefined) return undefined
  const item = seen.ok.file.items.find(one => one.id === id)
  if (item === undefined || resolveOwner(seen.ok.file.sessions, item.session_id) !== me) return undefined
  return item
}

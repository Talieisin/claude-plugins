// `humantray_config` (#27): which heading this session's items are shown
// under in the owner's views, the viewer and the page. It reads, or records
// an override: `"self"`, a routable session id, or `null` to clear. The rule
// itself is in lineage.ts.
//
// The heading is for grouping only. It routes nothing, no trust check reads
// it, and it does not say whose instructions this session follows: a
// session's lead is found from `get_session` and the repository's AGENTS.md
// alone. So the result never calls it a lead.

import type { EngineInterface, On } from 'claude-code'

import type { LeadRecord } from '../types'
import { withDeadline } from './artifact-store'
import { parseLeadInput } from './lineage'
import { peek } from './store'
import { findPageNow, isCloud, pageState, saveLeadRecord, shownNow } from './store-pass'

/** How long the call may spend looking for the page when it has none. */
const FIND_DEADLINE_MS = 6_000

export const CONFIG = 'mcp__humantray__humantray_config'

const CONFIG_DESCRIPTION =
  "Read or set where this session's humantray items are shown in the owner's views (the viewer and the page): " +
  'under the session that started this one by default, or under the session itself when it has none. ' +
  'Pass lead: "self" or a routable session id (session_…) to show new items under that heading, null to go back to the default, or nothing to read. ' +
  'Returns { session_id, parent_session_id, shown_under, shown_under_from, page }. ' +
  "This sets display grouping only: it does not say whose instructions this session follows, which is the repository's AGENTS.md's to say. " +
  'Set it only on the instruction of your lead as AGENTS.md defines one, or on the owner\'s brief. Cloud sessions only.'

const CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    lead: {
      type: ['string', 'null'],
      description: '"self", a routable session id (session_…), or null to clear. Leave it out to read only.',
    },
  },
} as const

const fail = (message: string) => ({ deny: message })

/** Registers the tool; a refusal is swallowed, so it stops nothing else at the start. */
export async function registerConfigTool($: EngineInterface): Promise<void> {
  try {
    await $.tool.register({ name: 'humantray_config', description: CONFIG_DESCRIPTION, inputSchema: CONFIG_SCHEMA, isDeferred: false })
  } catch {
    // Refused: humantray_add and humantray_list are registered on their own.
  }
}

/**
 * The tool's call. Its registration is `registerConfigTool`, which the mod's
 * one `session.start` hook calls (a hook module may hook an event only once
 * without a matcher).
 */
export function registerConfig(on: On): void {
  on('tool.call', { tool: CONFIG }, async ($, e) => {
    const asked = parseLeadInput(e as unknown as Record<string, unknown>)
    if (asked.kind === 'refused') return fail(`humantray: ${asked.reason}; nothing was changed`)
    if (!(await isCloud($))) {
      return fail('humantray: humantray_config works only in a cloud session; a local session shows its items in its own pane')
    }
    const seen = await peek($)
    if (seen.error !== undefined) return fail(seen.error)
    const before = await shownNow($)
    if ('unknown' in before) {
      return fail(
        before.unknown === 'id'
          ? "humantray: this session's id is not known yet; nothing was changed. Call again after a turn"
          : "humantray: this session's setting could not be read; nothing was changed. Call again after a turn",
      )
    }
    if (asked.kind !== 'read') {
      const record: LeadRecord = {
        lead: asked.kind === 'self' ? before.lineage.session_id : asked.kind === 'id' ? asked.id : null,
        at: await $.clock.now(),
        from: 'call',
      }
      if (!(await saveLeadRecord($, before.lineage.session_id, record))) {
        return fail('humantray: the setting could not be kept; nothing was changed. Call again after a turn')
      }
    }
    const now = asked.kind === 'read' ? before : await shownNow($)
    if ('unknown' in now) return fail('humantray: humantray_config failed unexpectedly')
    // With no page linked yet, look for it now rather than at the next due
    // find (a turn looks at most every ten minutes), so that `waiting` here
    // means none was found just now.
    await withDeadline($, findPageNow($), FIND_DEADLINE_MS).catch(() => undefined)
    const page = await pageState($).catch(() => 'none' as const)
    return {
      result: JSON.stringify({
        session_id: now.lineage.session_id,
        parent_session_id: now.lineage.parent_session_id,
        shown_under: now.lead,
        shown_under_from: now.from,
        page,
      }),
    }
  }).catch(() => fail('humantray: humantray_config failed unexpectedly'))
}

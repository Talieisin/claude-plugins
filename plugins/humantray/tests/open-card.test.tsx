// How an open card is drawn, pinned on each surface (#68): the card the
// local pane draws, and the same item in the viewer's "This session" group,
// which draws it with its short id alone (no origin or time, #75; no bumps).
// Written before the card's drawing moved to card.tsx and kept unchanged
// after, so the move is shown to change nothing that is drawn.

import { describe, expect, test } from 'claude-code/testing'

import { CARD_FIXTURES, SURFACES, drawOpenCards } from './card-fixtures'
import { OPEN_CARDS } from './open-card.snapshots'

/** The viewer's "This session" card: the local one with the short id alone on its origin line. */
const asViewer = (dump: string) => dump.replace(/^(\s+")[^"\n]* · (HT-[A-Z0-9]+)[^"\n]*"$/m, '$1$2"')

describe('the open card, as drawn (characterisation)', () => {
  for (const surface of SURFACES) {
    test(`${surface}: every card type and state, in the local pane and the viewer's This session`, async ($, on) => {
      const { local, viewer } = await drawOpenCards($, on, surface)
      for (const { name } of CARD_FIXTURES) {
        const expected = OPEN_CARDS[surface][name]
        expect(local[name], `${surface} ${name}: local`).toBe(expected)
        expect(viewer[name], `${surface} ${name}: viewer`).toBe(asViewer(expected ?? ''))
      }
    })
  }

  test('the viewer draws no suffix where the local pane does', () => {
    expect(OPEN_CARDS.desktop['another session']).toContain('"another session · 2027-01-15 07:00 UTC · HT-CRD14"')
    expect(OPEN_CARDS.desktop.bumped).toContain('· bumped 3×')
    expect(asViewer(OPEN_CARDS.desktop.bumped ?? '')).not.toContain('bumped')
    expect(asViewer(OPEN_CARDS.desktop.bumped ?? '')).toContain('    "HT-CRD15"')
  })
})

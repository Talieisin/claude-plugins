// How an open card is drawn, pinned on each surface (#68): the card the
// local pane draws, and the same item in the viewer's "This session" group,
// which since 0.2.9 draws it the same, origin line and all (#75).
// Written before the card's drawing moved to card.tsx and kept unchanged
// after, so the move is shown to change nothing that is drawn.

import { describe, expect, test } from 'claude-code/testing'

import { CARD_FIXTURES, SURFACES, drawOpenCards } from './card-fixtures'
import { OPEN_CARDS } from './open-card.snapshots'

describe('the open card, as drawn (characterisation)', () => {
  for (const surface of SURFACES) {
    test(`${surface}: every card type and state, in the local pane and the viewer's This session`, async ($, on) => {
      const { local, viewer } = await drawOpenCards($, on, surface)
      for (const { name } of CARD_FIXTURES) {
        const expected = OPEN_CARDS[surface][name]
        expect(local[name], `${surface} ${name}: local`).toBe(expected)
        expect(viewer[name], `${surface} ${name}: viewer`).toBe(expected)
      }
    })
  }

  test('the origin line says who asked, when, and any bumps (#75)', () => {
    expect(OPEN_CARDS.desktop['another session']).toContain('"another session · 2027-01-15 07:00 UTC · HT-CRD14"')
    expect(OPEN_CARDS.desktop.bumped).toContain('"this session · 2027-01-15 07:00 UTC · HT-CRD15 · bumped 3×"')
  })
})

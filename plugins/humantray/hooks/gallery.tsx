// The gallery (#68): `/humantray-gallery` opens a pane of fixture cards, one
// of every card type and state, drawn by the real card code (card.tsx), each
// under a short label of what to look for. It is the release check: one look
// per surface after a humantray release.
//
// Its cards are fixtures. Nothing here reads or writes the store, the page or
// the plugin's `$.store`, submits a prompt or sends to a session: a press on
// Acknowledge, Done, Submit and the rest only notes, under the card, that it
// was pressed. Picks and typing change the gallery's own drafts, as on a real
// card, so toggling can be tried; a copy button copies, as on a real card,
// since that reaches only the person's clipboard.

import { type EngineInterface, type On, type RenderSurface } from 'claude-code'

import { atom, read, update } from 'claude-code'

import type { Draft, Item, TrayKind, TrayView } from '../types'
import { APPROVE_OPTIONS, type Action, EMPTY_DRAFT, inKind, kindCounts, originOf } from './items'
import { type Press, cardKit, hasSurface } from './card'
import { drawsChoiceRows } from './choice'
import { hasNativeCopy } from './copy'

export const GALLERY = 'humantray-gallery'
const TITLE = 'Humantray gallery'

/**
 * Every card's draft, as card.tsx and register.tsx declare it. The gallery's
 * draft ids are `g:` and a fixture's name: a real item's id is a ULID and the
 * viewer's are `v:` and a ULID, so they never meet, and nothing on `main`
 * lists the drafts.
 */
const drafts = { plugin: 'humantray', key: 'drafts' } as const
/** What was last pressed on each gallery card, by its draft id: drawn under the card, never in its draft. */
const pressed = { plugin: 'humantray', key: 'gpressed' } as const
/** The gallery's type filter (#75): its own, so a chip pressed here never filters the real pane. */
const galleryKind = atom({ plugin: 'humantray', key: 'gkind' } as const, 'all' as TrayKind)
/** The header's key prefix, and its draft id for the note of a tab pressed. */
const HEADER = 'g:header'
/** When every fixture was raised: a fixed time, so the origin line reads the same on every look. */
export const GALLERY_RAISED = Date.UTC(2026, 10, 18, 9, 12)

/** What the label above a card is written for: the terminal, or an app surface. */
type Look = { rows: boolean; native: boolean }

export type GalleryFixture = {
  /** Its name, and with `g:` its draft id and its card's key. */
  name: string
  item: Item
  /** The draft it starts with, and is reset to: a pick or an error. */
  start: Partial<Draft>
  /** False for a card from another session. */
  mine: boolean
  /** That other session's title (#75), as its record holds it; none for an untitled one. */
  title?: string
  /** What to look for on this card, on this kind of surface. */
  look: (look: Look) => string
}

const OPTIONS = [
  { label: 'Blue', description: 'The calm one.' },
  { label: 'Green', description: '' },
  { label: 'Red', description: 'Loud, for warnings.' },
]

const MARKDOWN = [
  '## Steps',
  '',
  '1. Rotate the **key**',
  '   - in `prod` first',
  '   - then *staging*',
  '2. Tell [ops](https://example.com/ops)',
  '',
  '- [x] backed up',
  '- [ ] announced',
  '',
  '> Check the logs first.',
  '',
  '| Env | Done |',
  '| --- | ---- |',
  '| prod | yes |',
  '',
  '---',
].join('\n')

/** One more fence than a page of copy buttons, so the terminal and a phone page through them. */
const CODE = Array.from({ length: 10 }, (_, n) => `Step ${String(n + 1)}:\n\n\`\`\`sh\nmake step${String(n + 1)}\n\`\`\``).join('\n\n')

const MERMAID = ['The flow:', '', '```mermaid', 'graph TD', '  A[Ask] --> B[Answer]', '```'].join('\n')

/** A fixture's item: never stored, so its id is only a name. */
const fixtureItem = (n: number, fields: Partial<Item> & Pick<Item, 'type' | 'header' | 'question'>): Item => ({
  id: `gallery-${String(n).padStart(2, '0')}`,
  short: `HT-GAL${String(n).padStart(2, '0')}`,
  repo: 'gallery',
  session_id: 'gallery',
  body_md: '',
  key: `gallery ${String(n)}`,
  created: GALLERY_RAISED,
  updated: GALLERY_RAISED,
  bumps: 0,
  status: 'open',
  delivered: false,
  origin: 'local',
  ...(fields.type === 'approve' ? { options: [...APPROVE_OPTIONS] } : {}),
  ...fields,
})

const options = ({ rows }: Look, multi: boolean, picked: boolean) => {
  if (!rows) {
    const mark = multi ? (picked ? '[x] on Blue and Red, [ ] on Green' : '[ ] on each') : picked ? '(•) on Green, ( ) on the others' : '( ) on each'
    return `options on one line each, ${mark}, the label then its dim description; Green has none`
  }
  const state = multi
    ? picked
      ? '☑ on Blue and Red, ☐ on Green and Other'
      : '☐ on each'
    : picked
      ? '◉ on Green, ○ on the others'
      : '○ on each'
  return `each option a row, its mark and label together (${state}); clicking the mark ticks it as clicking the label does (#75); the description dim on its own line under the label, lined up with the label’s first letter (check by eye); Green has none; no shade on the row; Other is the last row, its field closed`
}

/** What the dialog frame looks like on an app surface (#72): said once per card type. */
const frame = ({ rows }: Look, actions: string) =>
  rows ? `${actions} at the bottom right` : `${actions}`

export const GALLERY_FIXTURES: GalleryFixture[] = [
  {
    name: 'ack',
    item: fixtureItem(1, { type: 'ack', header: 'FYI', question: 'The deploy finished' }),
    start: {},
    mine: true,
    look: look => `ack: the title in bold, the short id dim under it; ${frame(look, 'one Acknowledge button (primary)')}`,
  },
  {
    name: 'do',
    item: fixtureItem(2, { type: 'do', header: 'Task', question: 'Rotate the staging key' }),
    start: {},
    mine: true,
    look: look => `do: a Feedback field, its label above it and the field the card’s full width; ${frame(look, 'Done (primary) and Not done side by side, clear of the field and of the card’s bottom edge')}`,
  },
  {
    name: 'approve',
    // An approve item is raised with notes since 0.2.7 (#75).
    item: fixtureItem(3, { type: 'approve', header: 'Approve', question: 'Ship 0.2.3?', notes: true }),
    start: {},
    mine: true,
    look: look => `approve: a Notes field, its label above it; ${frame(look, 'Approve (primary) and Reject side by side, under the notes')}`,
  },
  {
    name: 'question',
    item: fixtureItem(4, { type: 'question', header: 'Question', question: 'Which region first?' }),
    start: {},
    mine: true,
    look: look => `question: an Answer field, label above; ${frame(look, 'Submit (primary)')}; Enter in the field submits`,
  },
  {
    name: 'choice-single',
    item: fixtureItem(5, { type: 'choice', header: 'Colour', question: 'One colour, nothing picked', options: OPTIONS }),
    start: {},
    mine: true,
    look: look => `choice, one answer, nothing picked: ${options(look, false, false)}; ${look.rows ? 'pressing Other ticks it and opens its field under its label' : 'an Other field'}; Submit`,
  },
  {
    name: 'choice-single-picked',
    item: fixtureItem(6, { type: 'choice', header: 'Colour', question: 'One colour, Green picked', options: OPTIONS }),
    start: { selected: ['Green'] },
    mine: true,
    look: look => `choice, one answer, picked: ${options(look, false, true)}; a press moves the pick`,
  },
  {
    name: 'choice-multi',
    item: fixtureItem(7, { type: 'choice', header: 'Colours', question: 'Several colours, nothing picked', options: OPTIONS, multiSelect: true }),
    start: {},
    mine: true,
    look: look => `choice, several answers, nothing picked: ${options(look, true, false)}`,
  },
  {
    name: 'choice-multi-picked',
    item: fixtureItem(8, { type: 'choice', header: 'Colours', question: 'Several colours, two picked', options: OPTIONS, multiSelect: true }),
    start: { selected: ['Blue', 'Red'] },
    mine: true,
    look: look => `choice, several answers, two picked: ${options(look, true, true)}; a press toggles one`,
  },
  {
    name: 'choice-other',
    item: fixtureItem(16, { type: 'choice', header: 'Colours', question: 'Several colours, Other open', options: OPTIONS, multiSelect: true }),
    start: { selected: ['Blue'], otherOpen: true, other: 'Teal' },
    mine: true,
    look: look =>
      look.rows
        ? 'choice, Other open: Blue ticked, Other ticked with its field open under its label holding “Teal”; Blue, Red and Other each still press; pressing Other again closes the field and clears it'
        : 'choice, Other typed: [x] on Blue, “Teal” in the Other field',
  },
  {
    name: 'notes',
    item: fixtureItem(9, { type: 'do', header: 'Notes', question: 'A task with notes', notes: true }),
    start: {},
    mine: true,
    look: () => 'with notes: a Notes field after Feedback, its label above it, and a gap under each field',
  },
  {
    name: 'markdown',
    item: fixtureItem(10, { type: 'ack', header: 'Markdown', question: 'A Markdown body', body_md: MARKDOWN }),
    start: {},
    mine: true,
    look: () => 'Markdown body: a heading, a numbered list with a nested list, a task list, a quote, a table and a rule, drawn as Markdown',
  },
  {
    name: 'code',
    item: fixtureItem(11, { type: 'question', header: 'Code', question: 'Ten code blocks', body_md: CODE }),
    start: {},
    mine: true,
    look: ({ native }) =>
      native
        ? 'code blocks: each drawn as code with the app’s own copy control; no copy buttons and no “Code n” labels'
        : 'code blocks: each drawn as code, labelled “Code n”, with a copy button each, nine at a time and a button to show the next',
  },
  {
    name: 'mermaid',
    item: fixtureItem(12, { type: 'ack', header: 'Diagram', question: 'A mermaid block', body_md: MERMAID }),
    start: {},
    mine: true,
    look: () => 'mermaid block: drawn as the surface draws a mermaid fence (a diagram, or its source as code)',
  },
  {
    name: 'error',
    item: fixtureItem(13, { type: 'question', header: 'Error', question: 'Submitted empty' }),
    start: { error: 'Type an answer.' },
    mine: true,
    look: () => 'the error line: “Type an answer.” in the error colour at the foot of the card; typing clears it',
  },
  {
    name: 'other-session',
    item: fixtureItem(14, { type: 'approve', header: 'Elsewhere', question: 'From another session', session_id: 'gallery-other' }),
    start: {},
    mine: false,
    title: 'Lane #23: config loader',
    look: () =>
      'a card from another session (#75): the line under the heading reads “Lane #23: config loader · 2026-11-18 09:12 UTC · HT-GAL14”, the asking session’s title, when it was raised, the short id',
  },
  {
    name: 'other-session-untitled',
    item: fixtureItem(17, { type: 'question', header: 'Elsewhere', question: 'From a session with no title', session_id: 'gallery-untitled' }),
    start: {},
    mine: false,
    look: () => 'a card from a session with no title: the line reads “another session · 2026-11-18 09:12 UTC · HT-GAL17”',
  },
  {
    name: 'bumped',
    item: fixtureItem(15, { type: 'ack', header: 'Again', question: 'Asked three more times', bumps: 3 }),
    start: {},
    mine: true,
    look: () => 'a bumped card: “· bumped 3×” after the short id; like every card of this session, its line starts “this session · 2026-11-18 09:12 UTC”',
  },
]

/** A gallery card's draft id. */
export const galleryDraftId = (name: string) => `g:${name}`

/** The name of what was pressed: the button's label. */
const pressedLabel = (action: Action): string =>
  action.kind === 'ack' ? 'Acknowledge' : action.kind === 'do' ? (action.outcome === 'done' ? 'Done' : 'Not done') : action.kind === 'approve' ? action.choice : 'Submit'

/**
 * Who asked a fixture (#75): `originOf` itself, over a store holding only the
 * fixture's item and, for another session's card, that session's record.
 */
export const galleryOrigin = (fixture: GalleryFixture): string => {
  const asker = fixture.item.session_id
  const sessions = fixture.mine ? {} : { [asker]: { seen: 0, ...(fixture.title === undefined ? {} : { title: fixture.title }) } }
  return originOf({ version: 1, items: [fixture.item], sessions }, fixture.item, fixture.mine ? asker : 'gallery-viewer')
}

/** Every gallery card back to its starting draft, no press noted, and the filter back to All. */
async function reset($: EngineInterface) {
  for (const fixture of GALLERY_FIXTURES) {
    const id = galleryDraftId(fixture.name)
    await $.state.set({ ...drafts, id }, { ...EMPTY_DRAFT, ...fixture.start })
    await $.state.set({ ...pressed, id }, '')
  }
  await $.state.set({ ...pressed, id: HEADER }, '')
  await update($, galleryKind, () => 'all')
}

export function registerGallery(on: On): void {
  on('command.run', { command: 'humantray-gallery' }, async $ => {
    await reset($)
    if (await hasSurface($)) void $.ui.open({ id: GALLERY, title: TITLE }).catch(() => undefined)
    return { text: 'Humantray gallery opened: fixture cards only; nothing is stored or sent.', isTextDisplayOnly: true as const }
  })

  on('ui.render', { component: 'Pane', requestId: GALLERY }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const kit = cardKit($, e, GALLERY)
    const surface: RenderSurface = e.surface
    const look: Look = { rows: drawsChoiceRows(surface), native: hasNativeCopy(surface) }
    const nodes = [
      <Text dimColor>
        {`Gallery: every card type and state, drawn by the real card code on ${surface}. Fixtures only: a press is noted under its card, and nothing is stored or sent.`}
      </Text>,
      <Button key="g:reset" label="Reset gallery" onPress={() => reset($)} />,
    ]
    // The pane's header (#75), over the fixtures: a chip filters them, as on
    // the pane; a tab press is only noted, since the gallery has no History.
    const shownKind = await read($, galleryKind)
    const tabNote = (await $.state.get({ ...pressed, id: HEADER })).value ?? ''
    nodes.push(
      <Box key={`${HEADER}:look`}>
        <Text italic>
          {
            `Look for: the header (#75): “humantray · gallery” and “${String(GALLERY_FIXTURES.length)} open” in bold; the Open and History tabs, Open primary; the chips All, Questions, To-dos and FYIs with their counts, the chosen one primary; each row wraps at a narrow width. A chip filters the cards below; a tab press is only noted.`
          }
        </Text>
      </Box>,
    )
    nodes.push(
      kit.header({
        prefix: HEADER,
        title: 'humantray · gallery',
        open: GALLERY_FIXTURES.length,
        history: 0,
        view: 'open',
        kind: shownKind,
        counts: kindCounts(GALLERY_FIXTURES.map(fixture => fixture.item.type)),
        onView: (to: TrayView) => async () => {
          await $.state.set({ ...pressed, id: HEADER }, `Pressed: ${to === 'open' ? 'Open' : 'History'}. Gallery only: nothing was stored or sent.`)
        },
        onKind: (to: TrayKind) => async () => {
          await update($, galleryKind, () => to)
        },
      }),
    )
    if (tabNote !== '') {
      nodes.push(
        <Box key={`${HEADER}:pressed`}>
          <Text dimColor>{tabNote}</Text>
        </Box>,
      )
    }
    for (const fixture of GALLERY_FIXTURES) {
      if (!inKind(fixture.item.type, shownKind)) continue
      const id = galleryDraftId(fixture.name)
      const held = await $.state.get({ ...drafts, id })
      // Before any reset (a pane left open across a reload), its starting draft.
      const draft = { ...EMPTY_DRAFT, ...(held.value ?? fixture.start) }
      const note = (await $.state.get({ ...pressed, id })).value ?? ''
      const press: Press = action => async () => {
        await $.state.set({ ...pressed, id }, `Pressed: ${pressedLabel(action)}. Gallery only: nothing was stored or sent.`)
      }
      // The label and the note are each in a keyed Box: a Text keeps no key.
      nodes.push(
        <Box key={`${id}:look`}>
          <Text italic>{`Look for: ${fixture.look(look)}`}</Text>
        </Box>,
      )
      nodes.push(await kit.openCard({ item: fixture.item, key: id, draftId: id, draft, press, origin: galleryOrigin(fixture) }))
      if (note !== '') {
        nodes.push(
          <Box key={`${id}:pressed`}>
            <Text dimColor>{note}</Text>
          </Box>,
        )
      }
    }
    return (
      <Box flexDirection="column" gap={1}>
        {nodes}
      </Box>
    )
  })
}

// The open card's drawing (#68): one card of an open item, its controls by
// type, its Markdown and its copy list, as the humantray pane draws it. The
// pane (register.tsx) and the gallery (gallery.tsx) both draw cards with this
// kit, so the gallery shows exactly what a real card looks like. The kit
// writes only the card's draft in `$.state`; what a press does is the
// caller's (`press`), so the gallery's presses reach nothing else.

import type { BoxProps, EngineInterface, RenderInput } from 'claude-code'

import type { CodeBlock, Draft, Item } from '../types'
import { type Action, EMPTY_DRAFT, forDrawing, plain, splitDrawn, unlabelled, unlabelledPieces } from './items'
import { codeBlocksOf } from './code'
import { choiceMark, choiceText, descriptionIndent, drawsChoiceRows, otherIsOn } from './choice'
import { COPY_PAGE, copyBlock, copyLabel, copyToast, hasNativeCopy, unsafeNote } from './copy'

export type FieldName = 'other' | 'text' | 'feedback' | 'notes'

/**
 * A free-text field's key: the card's key and the field's name, then the
 * card's count of Enters once there has been one (#48).
 */
export function fieldKeyOf(card: string, name: FieldName, entered: number): string {
  return entered > 0 ? `${card}:${name}:${String(entered)}` : `${card}:${name}`
}

/** How many lines tall a free-text field is: room for a list or a short code block. */
const ROWS = 3

/** Every card's draft, by its draft id: the item's id, `v:` and the id (the viewer's), or `g:` and a fixture's name (the gallery's). */
const drafts = { plugin: 'humantray', key: 'drafts' } as const

export async function hasSurface($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).length > 0
  } catch {
    return false
  }
}

export async function toast($: EngineInterface, text: string) {
  if (await hasSurface($)) await $.ui.toast(text)
}

/** A card's draft as held, over the empty one. */
export async function draftOf($: EngineInterface, id: string): Promise<Draft> {
  const held = await $.state.get({ ...drafts, id })
  return { ...EMPTY_DRAFT, ...(held.value ?? {}) }
}

export async function setDraft($: EngineInterface, id: string, change: (draft: Draft) => Partial<Draft>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const held = await $.state.get({ ...drafts, id })
    const draft = { ...EMPTY_DRAFT, ...(held.value ?? {}) }
    const written = await $.state.set({ ...drafts, id }, { ...draft, ...change(draft) }, { ifVersion: held.version })
    if (written.isSet) return
  }
}

/** What a card's controls call on a press: the caller's, by the action pressed. */
export type Press = (action: Action) => () => Promise<void>

/**
 * The card kit for one drawing of a pane: `e` is that pane's render event and
 * `pane` its id, which a field's focus after Enter names.
 */
export function cardKit($: EngineInterface, e: RenderInput<'Pane'>, pane: string) {
  const { Box, Button, Input, Markdown, Text } = $.ui.resolve(e)
  // Drawn Markdown (forDrawing's), one element a piece (#51): each text piece
  // and each fence drawn here apart, so nothing in one can reach into the
  // next in any surface's parser. One piece keeps the single element.
  // Where the surface draws its own copy control on a code block (the
  // desktop app, VS Code), no copy buttons and no `Code n` labels (#51).
  // `labelled`: a body forDrawing labelled. Only there is a label dropped:
  // an answer's parts are drawn with none, so a `*Code n*` line in them is
  // the person's own and is kept.
  const native = hasNativeCopy(e.surface)
  // A card's spacing, in steps each surface sizes its own way. The terminal
  // and a phone: `sm` all round, which the terminal draws as one cell across
  // and none down. The desktop app and VS Code (the owner's layout check on
  // 0.2.0): `sm` across and at the top, a step more under the buttons so
  // they sit clear of the card's bottom edge, and a gap under each field so
  // the buttons do not touch it. VS Code's table draws a step down as rows:
  // `sm` none, `md` one; so there the gap under a field is `md`.
  const cardSpacing: BoxProps = native ? { paddingX: 'sm', paddingTop: 'sm', paddingBottom: 'md' } : { padding: 'sm' }
  // Whether a choice's options are checkbox and radio rows (#64, #75), and
  // the actions sit bottom right as in the desktop app's own question
  // dialogue (#72).
  const rows = drawsChoiceRows(e.surface)
  const fieldSpacing: BoxProps = e.surface === 'desktop' ? { marginBottom: 'sm' } : e.surface === 'vscode' ? { marginBottom: 'md' } : {}
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
      // copy is not exact: the card says so (decided for the owner on #51),
      // in one note that names a few such blocks and counts the rest, so a
      // card of many stays small.
      const unsafe = blocks.flatMap((block, k) => (block.unsafe ? [k + 1] : []))
      if (unsafe.length === 0) return null
      return (
        <Text key={`${key}:copy:unsafe`} dimColor>
          {unsafeNote(unsafe)}
        </Text>
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
      await $.ui.focus({ requestId: pane, key: fieldKeyOf(key, name, count) }).catch(() => undefined)
    }
    // The label above the field, and the field the card's full width (#51,
    // the owner's layout request): an Input's own label is drawn beside the
    // field, which the desktop app squeezes into a narrow box.
    const labelled = (name: FieldName, label: string, input: ReturnType<typeof h>) => (
      <Box key={`${key}:${name}:field`} flexDirection="column" alignItems="stretch" width="100%" {...fieldSpacing}>
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

    // The actions bottom right on the app surfaces (#72), as the desktop
    // app's dialogue has them; the terminal keeps them where they were.
    const right: BoxProps = rows ? { justifyContent: 'flex-end' } : {}
    const actions = (button: ReturnType<typeof h>) =>
      rows ? (
        <Box key={`${key}:actions`} flexDirection="row" {...right}>
          {button}
        </Box>
      ) : (
        button
      )

    const controls = []
    if (item.type === 'ack') {
      controls.push(actions(<Button key={`${key}:ack`} label="Acknowledge" variant="primary" onPress={press({ kind: 'ack' })} />))
    } else if (item.type === 'do') {
      controls.push(field('feedback', 'Feedback (optional, Markdown)'))
      controls.push(
        <Box key={`${key}:outcomes`} flexDirection="row" gap={1} {...right}>
          <Button key={`${key}:done`} label="Done" variant="primary" onPress={press({ kind: 'do', outcome: 'done' })} />
          <Button key={`${key}:not_done`} label="Not done" onPress={press({ kind: 'do', outcome: 'not_done' })} />
        </Box>,
      )
    } else if (item.type === 'approve') {
      // Notes above the verdicts (#75): an approve item raised by 0.2.7 or
      // later always carries `notes` (items.ts), so the notes say why.
      if (item.notes === true) controls.push(field('notes', 'Notes (optional, Markdown)'))
      controls.push(
        <Box key={`${key}:verdicts`} flexDirection="row" gap={1} {...right}>
          <Button key={`${key}:approve`} label="Approve" variant="primary" onPress={press({ kind: 'approve', choice: 'Approve' })} />
          <Button key={`${key}:reject`} label="Reject" onPress={press({ kind: 'approve', choice: 'Reject' })} />
        </Box>,
      )
    } else if (item.type === 'question') {
      controls.push(field('text', 'Answer (Markdown)', press({ kind: 'submit' })))
    } else {
      const isMulti = item.multiSelect === true
      // Other text clears a single choice's pick.
      const other = (value: string) => (current: Draft) => ({
        other: value,
        selected: !isMulti && value.trim() !== '' ? [] : current.selected,
      })
      const otherInput = (
        <Input
          key={fieldKey('other')}
          rows={ROWS}
          value={draft.other}
          onInput={value => setDraft($, draftId, current => ({ ...other(value)(current), error: '' }))}
          onSubmit={value => entered('other', other(value))}
        />
      )
      const pick = (label: string) => () =>
        setDraft($, draftId, current => ({
          error: '',
          ...(isMulti
            ? {
                selected: current.selected.includes(label) ? current.selected.filter(each => each !== label) : [...current.selected, label],
              }
            : { selected: [label], other: '', otherOpen: false }),
        }))
      if (!rows) {
        ;(item.options ?? []).forEach((option, index) => {
          const mark = choiceMark(isMulti, draft.selected.includes(option.label))
          controls.push(
            <Button key={`${key}:opt:${index}`} plain onPress={pick(option.label)}>
              {mark} {option.label} <Text dimColor>{option.description}</Text>
            </Button>,
          )
        })
        controls.push(labelled('other', 'Other (Markdown)', otherInput))
      } else {
        // The desktop app, VS Code and a phone: each option a row whose Button
        // holds the checkbox or radio glyph and the label, one string, so a
        // click on the box presses it as a click on the label does (#75; the
        // Svg mark of 0.2.5 and 0.2.6 beside the Button could not be pressed).
        // Under it, in a Box of its own, its description dim, or Other's open
        // field, set in to line up with the label. No `label` prop on the
        // Button: the desktop app draws a label in place of the children (#64).
        // The rows keep 0.2.6's shape, which took every label press on the
        // desktop app: the Button alone in its line, nothing that grows or
        // stretches around it (on 0.2.5 a label Button whose column grew and
        // stretched took no press), and no fill or hover shade.
        const indent = descriptionIndent(e.surface)
        const row = (rowKey: string, button: ReturnType<typeof h>, under: ReturnType<typeof h> | null) => (
          <Box key={`${rowKey}:row`} flexDirection="column">
            <Box key={`${rowKey}:line`} flexDirection="row">
              {button}
            </Box>
            {under === null ? null : (
              <Box key={`${rowKey}:under`} flexDirection="row" paddingLeft={indent}>
                {under}
              </Box>
            )}
          </Box>
        )
        const options: ReturnType<typeof h>[] = []
        ;(item.options ?? []).forEach((option, index) => {
          const description =
            option.description.trim() === '' ? null : (
              <Box key={`${key}:opt:${index}:about`}>
                <Text dimColor>{option.description}</Text>
              </Box>
            )
          options.push(
            row(
              `${key}:opt:${index}`,
              <Button key={`${key}:opt:${index}`} plain onPress={pick(option.label)}>
                {choiceText(e.surface, isMulti, draft.selected.includes(option.label), option.label)}
              </Button>,
              description,
            ),
          )
        })
        // Other is the last row, with the same glyph, on a multi-select as on
        // a single choice. It is on while it is open or holds text; pressing
        // it on opens its field under it (and clears a single choice's pick),
        // pressing it off closes the field and clears the text, so an unticked
        // Other delivers nothing.
        const otherOn = otherIsOn(draft)
        options.push(
          row(
            `${key}:opt:other`,
            <Button
              key={`${key}:opt:other`}
              plain
              onPress={async () => {
                await setDraft($, draftId, current =>
                  otherIsOn(current)
                    ? { otherOpen: false, other: '', error: '' }
                    : { otherOpen: true, error: '', ...(isMulti ? {} : { selected: [] }) },
                )
                if (!otherOn) await $.ui.focus({ requestId: pane, key: fieldKey('other') }).catch(() => undefined)
              }}
            >
              {choiceText(e.surface, isMulti, otherOn, 'Other')}
            </Button>,
            otherOn ? (
              <Box key={`${key}:other:field`} flexDirection="column" alignItems="stretch" flexGrow={1}>
                {otherInput}
              </Box>
            ) : null,
          ),
        )
        controls.push(
          <Box key={`${key}:options`} flexDirection="column" {...fieldSpacing}>
            {options}
          </Box>,
        )
      }
    }
    if (item.notes === true && item.type !== 'approve') controls.push(field('notes', 'Notes (optional, Markdown)'))
    if (item.type === 'choice' || item.type === 'question') {
      controls.push(actions(<Button key={`${key}:submit`} label="Submit" variant="primary" onPress={press({ kind: 'submit' })} />))
    }
    return controls
  }

  /**
   * One open item's card (#68): its heading, its short id, its body and
   * copy list, its controls and its error line. `suffixes`: the short id is
   * followed by "another session" (unless `mine`) and the bumps, as the
   * local pane draws it; the viewer's This session group draws it alone.
   */
  const openCard = async (card: { item: Item; key: string; draftId: string; draft: Draft; press: Press; mine: boolean; suffixes: boolean }) => {
    const { item, key, draftId, draft, press } = card
    const from = card.suffixes && !card.mine ? ' · another session' : ''
    const bumped = card.suffixes && item.bumps > 0 ? ` · bumped ${item.bumps}×` : ''
    const heading = (
      <Text bold>
        [{plain(item.header)}] {plain(item.question)}
      </Text>
    )
    const short = (
      <Text dimColor>
        {item.short}
        {from}
        {bumped}
      </Text>
    )
    const rest = [
      item.body_md !== '' && drawn(`${key}:body`, forDrawing(item.body_md), true),
      await copyList(key, draftId, item.short, codeBlocksOf(item.body_md)),
      ...controlsFor(item, key, draftId, draft, press),
      draft.error !== '' && <Text color="error">{draft.error}</Text>,
    ]
    return (
      <Box key={`${key}:card`} flexDirection="column" borderStyle="round" {...cardSpacing}>
        {heading}
        {short}
        {rest}
      </Box>
    )
  }

  return { native, rows, cardSpacing, fieldSpacing, drawn, copyList, controlsFor, openCard }
}

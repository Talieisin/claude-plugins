// How a `choice` card's options are drawn on each surface (#64, #72, #75).

/**
 * Whether a surface draws each option as a checkbox or radio row, with the
 * description as dim text under the label, and the card's actions bottom
 * right as the desktop app's question dialogue has them (#72): the desktop app,
 * VS Code and a phone. The terminal, and any surface not known here, keep the
 * one-line drawing of 0.2.1 (`[x] Label description`), which reads well there.
 */
export const drawsChoiceRows = (surface: string | undefined): boolean => surface === 'desktop' || surface === 'vscode' || surface === 'mobile'

/**
 * An option's mark on the terminal (and any surface not known here):
 * checkboxes for a multi-select, radio buttons for a single choice.
 */
export const choiceMark = (multi: boolean, on: boolean): string => (multi ? (on ? '[x]' : '[ ]') : on ? '(•)' : '( )')

/**
 * An option's mark on the app surfaces: a checkbox or radio glyph, drawn
 * inside the option's Button with its label, so a click on the box presses
 * it (#75). A ticked box is ✅ (U+2705), an emoji, since 0.2.10 (the owner's
 * choice on #75): it draws in its own colour, which a Button's text cannot.
 * It is wider than ☐, so a ticked option's label sits a little further right
 * than an unticked one's. 0.2.5 and 0.2.6 drew the mark as an Svg beside
 * the Button, which the engine never makes pressable (an Svg cannot sit in a
 * Button, and a Box takes no press): the owner's clicks on the boxes did
 * nothing.
 */
export const choiceGlyph = (multi: boolean, on: boolean): string => (multi ? (on ? '✅' : '☐') : on ? '◉' : '○')

/** Every mark `choiceGlyph` draws: an option's Button on an app surface starts with one (a surface rule, #75). */
export const CHOICE_GLYPHS: readonly string[] = ['☐', '✅', '○', '◉']

/**
 * Cells a description, or Other's open field, is set in by under its
 * option's label (#75): the glyph and its space, and on the desktop app the
 * native button's own inset of about a cell (the owner's check on 0.2.5).
 * Cells cannot be matched to a glyph in the app's font exactly: the gallery
 * says to check the line-up by eye.
 */
export const descriptionIndent = (surface: string | undefined): number => (surface === 'desktop' ? 3 : 2)

/**
 * U+2009, a thin space: on the desktop app it moves the label right onto the
 * line its description starts on. The owner's check of 0.2.7 found each
 * description about 3 CSS pixels right of its label's first letter; a cell is
 * too coarse to move the description back, and a thin space is about that
 * width. It is not collapsed as a run of plain spaces would be.
 */
export const THIN_SPACE = '\u2009'

/**
 * An option's Button text on an app surface (#75): its mark, a space and its
 * label, with a thin space more on the desktop app to line the label up with
 * the description under it.
 */
export const choiceText = (surface: string | undefined, multi: boolean, on: boolean, label: string): string =>
  `${choiceGlyph(multi, on)} ${surface === 'desktop' ? THIN_SPACE : ''}${label}`

/**
 * Whether a choice's Other is on (#72): while its row is open or it holds
 * text. A draft stored before 0.2.5 has no `otherOpen` and reads as closed
 * unless it holds Other text.
 */
export const otherIsOn = (draft: { otherOpen?: boolean; other: string }): boolean => draft.otherOpen === true || draft.other.trim() !== ''

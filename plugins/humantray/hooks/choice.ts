// How a `choice` card's options are drawn on each surface (#64).

/**
 * Whether a surface draws each option as a checkbox or radio row, with the
 * description as dim text under the label, and the card as the desktop app's
 * question dialog (#72): the desktop app, VS Code and a phone. The terminal,
 * and any surface not known here, keep the one-line drawing of 0.2.1
 * (`[x] Label description`), which reads well there.
 */
export const drawsChoiceRows = (surface: string | undefined): boolean => surface === 'desktop' || surface === 'vscode' || surface === 'mobile'

/**
 * An option's mark on the terminal (and any surface not known here):
 * checkboxes for a multi-select, radio buttons for a single choice. The app
 * surfaces draw an Svg control instead (#72; glyphs ☐ ☑ ○ ◉ in 0.2.2 to 0.2.4).
 */
export const choiceMark = (multi: boolean, on: boolean): string => (multi ? (on ? '[x]' : '[ ]') : on ? '(•)' : '( )')


// The dialog look on the app surfaces (#72), as near Claude Desktop's own
// question dialog as the mod API allows. An Svg is drawn as an image, so its
// colours are fixed here and do not follow the theme.

/** The picked fill: an accent blue. */
export const CONTROL_ON = '#2563eb'
/** The outline of an unpicked control, and the rule between rows. */
export const CONTROL_OFF = '#9ca3af'
/** The control's size, CSS pixels. */
export const CONTROL_SIZE = 16

const SVG = 'xmlns="http://www.w3.org/2000/svg"'

/**
 * An option's control as an Svg: a radio circle or a checkbox, filled blue
 * with a white dot or tick when picked, a grey outline when not.
 */
export const controlSvg = (multi: boolean, on: boolean): string => {
  const open = `<svg ${SVG} width="16" height="16" viewBox="0 0 16 16">`
  if (multi) {
    return on
      ? `${open}<rect x="1" y="1" width="14" height="14" rx="3" fill="${CONTROL_ON}"/><polyline points="4,8.5 7,11.5 12,5" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `${open}<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5" fill="none" stroke="${CONTROL_OFF}" stroke-width="1.5"/></svg>`
  }
  return on
    ? `${open}<circle cx="8" cy="8" r="7" fill="${CONTROL_ON}"/><circle cx="8" cy="8" r="3" fill="#ffffff"/></svg>`
    : `${open}<circle cx="8" cy="8" r="6.25" fill="none" stroke="${CONTROL_OFF}" stroke-width="1.5"/></svg>`
}

/** A control's text for a reader that cannot see it (Svg's `alt`). */
export const controlAlt = (multi: boolean, on: boolean): string => `${multi ? 'Checkbox' : 'Radio button'}, ${on ? 'selected' : 'not selected'}`

/**
 * The thin rule between option rows: one pixel tall, stretched to the row's
 * width. Box has no single-side border. Drawn with `height={1}`; the markup's
 * own width (10000) is cut to the slot, and `preserveAspectRatio="none"`
 * stretches the viewBox to it, so it stays one pixel tall.
 */
export const RULE_SVG = `<svg ${SVG} width="10000" height="1" viewBox="0 0 100 1" preserveAspectRatio="none"><rect width="100" height="1" fill="${CONTROL_OFF}" fill-opacity="0.5"/></svg>`

/** The header band's and a row's hover shade: a theme key, so it follows light and dark. */
export const BAND = 'subtle'

/**
 * Whether a choice's Other is on (#72): while its row is open or it holds
 * text. A draft stored before 0.2.5 has no `otherOpen` and reads as closed
 * unless it holds Other text.
 */
export const otherIsOn = (draft: { otherOpen?: boolean; other: string }): boolean => draft.otherOpen === true || draft.other.trim() !== ''

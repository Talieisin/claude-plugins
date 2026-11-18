// How a `choice` card's options are drawn on each surface (#64).

/**
 * Whether a surface draws each option as a checkbox or radio row, with the
 * description as dim text under the label: the desktop app, VS Code and a
 * phone. The terminal, and any surface not known here, keep the one-line
 * drawing of 0.2.1 (`[x] Label description`), which reads well there.
 */
export const drawsChoiceRows = (surface: string | undefined): boolean => surface === 'desktop' || surface === 'vscode' || surface === 'mobile'

/**
 * An option's mark: checkboxes for a multi-select, radio buttons for a single
 * choice. Glyphs on the app surfaces, terminal text elsewhere.
 */
export const choiceMark = (surface: string | undefined, multi: boolean, on: boolean): string =>
  drawsChoiceRows(surface) ? (multi ? (on ? '☑' : '☐') : on ? '◉' : '○') : multi ? (on ? '[x]' : '[ ]') : on ? '(•)' : '( )'

/** Cells the description under a label is set in by: the mark and its space. */
export const DESCRIPTION_INDENT = 2

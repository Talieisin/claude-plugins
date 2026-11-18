// Copying a code block from the pane and the viewer (#51).
//
// The text is always the stored block (`codeBlocksOf`, code.ts), never what
// the pane draws. It goes to the clipboard of the surface the press came
// from, with `$.ui.copy`: on the terminal the machine's clipboard tool and
// OSC 52. The desktop app and VS Code are given no copy buttons: they draw
// their own copy control on each code block, and it is exact, since the
// pane draws code as stored (decided for the owner on #51). A phone has no
// clipboard route here: the toast says so, and points to the humantray page,
// whose copy works there.

import type { EngineInterface, RenderSurface } from 'claude-code'

import { type CodeBlock, listedLang } from './code'
import { clip, plain } from './items'

/** Copy buttons drawn at once on one card; more are paged (`Code blocks 10–18 of 25: show the next`). */
export const COPY_PAGE = 9

/** How a copy went: to the surface's clipboard, or not at all, and why. */
export type CopyOutcome = { ok: true } | { ok: false; why: string }

/**
 * Whether a surface draws its own copy control on a code block: the desktop
 * app and VS Code. There humantray draws no copy buttons and no `Code n`
 * labels; everywhere else, an unknown surface too, it draws both (#51).
 */
export const hasNativeCopy = (surface: string | undefined): boolean => surface === 'desktop' || surface === 'vscode'

/** Unsafe blocks a note names before it counts the rest. */
export const NAMED_UNSAFE = 3

/**
 * The note on a surface with its own copy control (`hasNativeCopy`) for the
 * blocks holding control characters, by number: a few named, the rest
 * counted, so one card says it in one line however many there are (#51).
 */
export const unsafeNote = (numbers: readonly number[]): string => {
  const named = numbers.slice(0, NAMED_UNSAFE).map(String)
  const more = numbers.length - named.length
  const which =
    more > 0
      ? `${named.join(', ')} and ${String(more)} more`
      : named.length === 1
        ? (named[0] ?? '')
        : `${named.slice(0, -1).join(', ')} and ${named.at(-1) ?? ''}`
  return numbers.length === 1
    ? `Code block ${which} holds control characters: the app's copy of it has \ufffd where they were`
    : `Code blocks ${which} hold control characters: the app's copy of them has \ufffd where they were`
}

/** A copy button's label: its number among the card's blocks (as the drawn "Code n" above each block), the language, and the first line, cut to fit a docked pane. */
export const copyLabel = (block: CodeBlock, n: number): string => {
  const first = block.text.split('\n').find(line => line.trim() !== '') ?? ''
  const shown = clip(plain(first.trim()).replace(/\t/g, ' '), 36)
  const lang = listedLang(block.lang)
  return [`Copy ${String(n)}`, ...(lang === '' ? [] : [lang]), ...(shown === '' ? [] : [shown])].join(' · ')
}

/** The toast after a copy. */
export const copyToast = (outcome: CopyOutcome, block: CodeBlock, n: number, short: string): string => {
  const lines = block.text.split('\n').length
  const what = `block ${String(n)} of ${short}`
  if (outcome.ok) {
    return `Humantray: copied ${what} (${String(lines)} ${lines === 1 ? 'line' : 'lines'})`
  }
  return `Humantray: ${what} not copied: ${outcome.why}. Copy it from the humantray page.`
}

/**
 * Copies one block's stored text for a press from `surface`. Refuses a block
 * holding control characters (`CodeBlock.unsafe`), which is never offered.
 */
export async function copyBlock($: EngineInterface, surface: RenderSurface | undefined, block: CodeBlock): Promise<CopyOutcome> {
  if (block.unsafe) return { ok: false, why: 'it holds control characters' }
  let reason: string
  try {
    const copied = await $.ui.copy({ text: block.text, ...(surface === undefined ? {} : { surface }) })
    if (copied.isCopied) return { ok: true }
    reason = copied.reason
  } catch (error) {
    reason = String(error)
  }
  if (surface === 'mobile') return { ok: false, why: `this app has no clipboard route here (${reason})` }
  return { ok: false, why: reason }
}

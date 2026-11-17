// The code blocks of an item's stored Markdown, for copying (#51).
//
// A copy is taken from the Markdown as stored, never from what a surface
// draws: the pane and the viewer draw through `forDisplay`, whose U+200B
// rewrites would break a pasted heredoc (`<<EOF`) or a `<PLACEHOLDER>`.
//
// The walk is the page's own (`page/page.ts`, `blocks` and `list`), kept in
// step with it, so that the page, the pane and the viewer number the same
// blocks and copy the same text. Shared fixtures (tests/code-fixtures.ts)
// hold both to it. Structure is decided on lines whose tabs are expanded to
// CommonMark's tab stops (every 4 columns); each line remembers the stored
// line it came from and how many columns its containers took, and the copy
// is cut from the stored line, so tabs, trailing spaces and blank lines with
// spaces on them are kept as written.
//
// The copy text of a block, as CommonMark reads it:
// - a fence: the lines between the fences (an unclosed fence runs to the end
//   of its container), less the indentation its list items and quotes own,
//   and up to as many columns of indentation as the opening fence had;
// - an indented block: the lines less four columns, trailing blank lines
//   dropped;
// - lines joined with `\n`. CR, CRLF and LF are all line ends, so a copy
//   never holds a CR;
// - a tab that the indentation removed cuts through becomes the spaces left.

import type { CodeBlock } from '../types'

export type { CodeBlock }

/**
 * The control characters that keep a block from being copied (`CodeBlock.unsafe`,
 * decided for the owner on #51): a pasted escape can reach the terminal, and
 * what shows is not what would run.
 */
export const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|[ \t]*)$/
const DELIMS = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const BLANK = /^\s*$/

/** Stored Markdown split into lines: CR, CRLF and LF all end one. */
export const splitLines = (md: string): string[] => md.split(/\r\n?|\n/)

/** A line with each tab expanded to the next tab stop (every 4 columns). */
export const expandTabs = (line: string): string => {
  if (!line.includes('\t')) return line
  let out = ''
  for (let k = 0; k < line.length; k++) {
    const ch = line[k] as string
    out += ch === '\t' ? ' '.repeat(4 - (out.length % 4)) : ch
  }
  return out
}

/**
 * A stored line less `from` columns (whatever they hold: indentation, a quote
 * mark, a list marker), then less up to `extra` more columns of spaces and
 * tabs. Tabs count to the next tab stop; a tab cut through leaves its
 * remaining columns as spaces.
 */
export const cutColumns = (raw: string, from: number, extra = 0): string => {
  let col = 0
  let i = 0
  let pad = 0
  while (i < raw.length && col < from) {
    const width = raw[i] === '\t' ? 4 - (col % 4) : 1
    i++
    if (col + width > from) {
      pad = col + width - from
      col = from
      break
    }
    col += width
  }
  let left = extra
  const eaten = Math.min(pad, left)
  pad -= eaten
  left -= eaten
  col += eaten
  while (left > 0 && pad === 0 && i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) {
    const width = raw[i] === '\t' ? 4 - (col % 4) : 1
    i++
    if (width > left) {
      pad = width - left
      col += left
      left = 0
      break
    }
    left -= width
    col += width
  }
  return ' '.repeat(pad) + raw.slice(i)
}

/** Where a line being parsed came from: the stored line's index, and the columns its containers took. */
type Origin = { at: number; cut: number }

/** A code block and the stored lines it spans, fence lines included: `start` to `end`, inclusive. */
export type Placed = { block: CodeBlock; start: number; end: number }

type Walk = { raw: string[]; out: Placed[] }

const startsBlock = (line: string): boolean => FENCE.test(line) || HR.test(line) || ATX.test(line) || QUOTE.test(line) || ITEM.test(line)

const cells = (line: string): number => {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && s.charAt(s.length - 2) !== '\\') s = s.slice(0, -1)
  let count = 1
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') {
      k++
      continue
    }
    if (s[k] === '|') count++
  }
  return count
}

const leading = (line: string): number => /^ */.exec(line)?.[0].length ?? 0

const push = (walk: Walk, from: Origin[], extra: number, lang: string, start: number, end: number) => {
  const text = from.map(origin => cutColumns(walk.raw[origin.at] ?? '', origin.cut, extra))
  const joined = text.join('\n')
  walk.out.push({ block: { text: joined, lang, unsafe: UNSAFE.test(joined) }, start, end })
}

function list(walk: Walk, lines: string[], from: Origin[], i: number, depth: number): number {
  const first = ITEM.exec(lines[i] ?? '') as RegExpExecArray
  const ordered = /\d/.test(first[2] ?? '')
  const marker = ordered ? (first[2] ?? '').slice(-1) : first[2]
  const items: Array<{ body: string[]; from: Origin[] }> = []
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const m = ITEM.exec(line)
    if (!m) break
    const mark = m[2] ?? ''
    if (ordered ? !/\d/.test(mark) || mark.slice(-1) !== marker : mark !== marker) break
    const pad = m[3] ? m[3].length : 1
    const width = (m[1] ?? '').length + mark.length + (pad > 4 ? 1 : pad)
    const content = m[4] !== undefined ? m[4] : ''
    const origin = from[i] as Origin
    const body = [content]
    const bodyFrom: Origin[] = [{ at: origin.at, cut: origin.cut + line.length - content.length }]
    let blank = false
    i++
    while (i < lines.length) {
      const next = lines[i] ?? ''
      const at = from[i] as Origin
      if (BLANK.test(next)) {
        body.push('')
        bodyFrom.push({ at: at.at, cut: at.cut + width })
        blank = true
        i++
        continue
      }
      if (leading(next) >= width) {
        body.push(next.slice(width))
        bodyFrom.push({ at: at.at, cut: at.cut + width })
        blank = false
        i++
        continue
      }
      if (!blank && !startsBlock(next)) {
        // A lazy line: parsed trimmed, but only its leading columns are taken.
        body.push(next.trim())
        bodyFrom.push({ at: at.at, cut: at.cut + leading(next) })
        i++
        continue
      }
      break
    }
    while (body.length > 1 && body[body.length - 1] === '') {
      body.pop()
      bodyFrom.pop()
    }
    items.push({ body, from: bodyFrom })
  }
  for (const item of items) {
    const task = /^\[([ xX])\][ \t]+/.exec(item.body[0] ?? '')
    if (task) {
      item.body[0] = (item.body[0] ?? '').slice(task[0].length)
      const origin = item.from[0] as Origin
      item.from[0] = { at: origin.at, cut: origin.cut + task[0].length }
    }
    blocks(walk, item.body, item.from, depth + 1)
  }
  return i
}

function blocks(walk: Walk, lines: string[], from: Origin[], depth: number): void {
  if (depth > 12) return
  let para = 0
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    let m: RegExpExecArray | null
    if (BLANK.test(line)) {
      para = 0
      i++
      continue
    }
    if ((m = FENCE.exec(line))) {
      para = 0
      const fence = m[1] ?? ''
      const lead = leading(line)
      const closing = new RegExp(`^ {0,3}${fence[0] === '~' ? '~' : '`'}{${fence.length},}[ \\t]*$`)
      const start = (from[i] as Origin).at
      const contentFrom: Origin[] = []
      i++
      while (i < lines.length && !closing.test(lines[i] ?? '')) {
        contentFrom.push(from[i] as Origin)
        i++
      }
      // The closing fence's line, or the last line of an unclosed one.
      const end = i < lines.length ? (from[i] as Origin).at : (contentFrom[contentFrom.length - 1]?.at ?? start)
      i++
      push(walk, contentFrom, lead, (m[2] ?? '').trim().split(/\s+/)[0] ?? '', start, end)
      continue
    }
    if (para > 0 && /^ {0,3}(=+|-+)[ \t]*$/.test(line)) {
      para = 0
      i++
      continue
    }
    if (HR.test(line) || ATX.test(line)) {
      para = 0
      i++
      continue
    }
    if (QUOTE.test(line)) {
      para = 0
      const quoted: string[] = []
      const quotedFrom: Origin[] = []
      while (i < lines.length) {
        const each = lines[i] ?? ''
        const origin = from[i] as Origin
        const q = QUOTE.exec(each)
        if (q) {
          const inner = q[1] ?? ''
          quoted.push(inner)
          quotedFrom.push({ at: origin.at, cut: origin.cut + each.length - inner.length })
        } else if (!BLANK.test(each) && !BLANK.test(quoted[quoted.length - 1] ?? 'x') && !startsBlock(each)) {
          quoted.push(each)
          quotedFrom.push(origin)
        } else break
        i++
      }
      blocks(walk, quoted, quotedFrom, depth + 1)
      continue
    }
    if ((m = ITEM.exec(line)) && (para === 0 || (m[4] !== undefined && (!/\d/.test(m[2] ?? '') || /^1[.)]$/.test(m[2] ?? ''))))) {
      para = 0
      i = list(walk, lines, from, i, depth)
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && DELIMS.test(lines[i + 1] ?? '') && cells(line) === cells(lines[i + 1] ?? '')) {
      para = 0
      i += 2
      while (i < lines.length && !BLANK.test(lines[i] ?? '') && (lines[i] ?? '').includes('|') && !startsBlock(lines[i] ?? '')) i++
      continue
    }
    if (para === 0 && /^ {4}/.test(line)) {
      const content: string[] = []
      const contentFrom: Origin[] = []
      while (i < lines.length && (/^ {4}/.test(lines[i] ?? '') || BLANK.test(lines[i] ?? ''))) {
        content.push(lines[i] ?? '')
        contentFrom.push(from[i] as Origin)
        i++
      }
      while (content.length > 0 && BLANK.test(content[content.length - 1] ?? '')) {
        content.pop()
        contentFrom.pop()
      }
      const first = contentFrom[0] as Origin
      push(walk, contentFrom, 4, '', first.at, (contentFrom[contentFrom.length - 1] as Origin).at)
      continue
    }
    para++
    i++
  }
}

/** The code blocks of stored Markdown with the stored lines each spans, in order; the spans never overlap. */
export const placedBlocksOf = (md: string): Placed[] => {
  const raw = splitLines(md)
  const walk: Walk = { raw, out: [] }
  blocks(
    walk,
    raw.map(expandTabs),
    raw.map((_, at) => ({ at, cut: 0 })),
    0,
  )
  return walk.out
}

/** The code blocks of stored Markdown, in the order the page draws them. */
export const codeBlocksOf = (md: string): CodeBlock[] => placedBlocksOf(md).map(placed => placed.block)

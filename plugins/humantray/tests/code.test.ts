// The copy text of code blocks (#51): taken from the stored Markdown, byte for
// byte, never from the drawn text with its U+200B display rewrites.

import { describe, expect, test } from 'claude-code/testing'

import { codeBlocksOf, cutColumns, expandTabs, splitLines } from '../hooks/code'
import { forDisplay } from '../hooks/items'
import { CODE_CASES, RUNBOOK } from './code-fixtures'

describe('the fixtures', () => {
  test('hold the characters they test: tabs, trailing spaces, CRs and controls really are there', () => {
    for (const each of CODE_CASES) {
      for (const held of each.holds ?? []) expect({ name: each.name, holds: each.md.includes(held) }).toEqual({ name: each.name, holds: true })
    }
    const tabbed = CODE_CASES.filter(each => (each.holds ?? []).some(held => held.includes('\t')))
    expect(tabbed.length).toBeGreaterThanOrEqual(6)
    for (const each of tabbed) expect(each.blocks.join('').includes('\t') || each.name.includes('quote mark')).toBe(true)
    expect(CODE_CASES.find(each => each.name === 'CRLF line ends')?.md).toBe('```\r\na\r\nb\r\n```\r\n')
    expect(RUNBOOK.length).toBeGreaterThan(3_000)
  })
})

describe('codeBlocksOf', () => {
  for (const each of CODE_CASES) {
    test(each.name, () => {
      const found = codeBlocksOf(each.md)
      expect(found.map(block => block.text)).toEqual(each.blocks)
      expect(found.flatMap((block, n) => (block.unsafe ? [n] : []))).toEqual(each.unsafe ?? [])
    })
  }

  test('a copy never carries the display rewrites: forDisplay adds U+200B, the copy text has none', () => {
    let rewritten = 0
    for (const each of CODE_CASES) {
      const drawn = forDisplay(each.md)
      if (drawn.includes('\u200b')) rewritten++
      for (const block of codeBlocksOf(each.md)) expect(block.text.includes('\u200b')).toBe(false)
    }
    // The heredoc, the placeholders and the HTML-shaped lines are all rewritten when drawn.
    expect(rewritten).toBeGreaterThanOrEqual(5)
    const heredoc = CODE_CASES.find(each => each.name.startsWith('every pattern'))
    expect(forDisplay(heredoc?.md ?? '')).toContain('<<\u200bEOF')
    expect(codeBlocksOf(heredoc?.md ?? '')[0]?.text).toContain('cat <<EOF\n<SP ID>\nEOF')
  })

  test('a U+200B the author really typed is kept: the copy is the stored text', () => {
    expect(codeBlocksOf('```\na\u200bb\n```')[0]?.text).toBe('a\u200bb')
  })

  test('the language is the info string\'s first word; an indented block has none', () => {
    expect(codeBlocksOf('```bash title="x"\nls\n```\n\n    pwd').map(block => block.lang)).toEqual(['bash', ''])
  })

  test('nothing in a paragraph, a heading, a table or inline code is a block', () => {
    expect(codeBlocksOf('Some `code` here.\n# Head\n\n| a | b |\n|---|---|\n| `x` | y |\n\npara\n    still para')).toEqual([])
  })
})

describe('the column rules', () => {
  test('lines end at CR, CRLF or LF', () => {
    expect(splitLines('a\rb\r\nc\nd')).toEqual(['a', 'b', 'c', 'd'])
  })

  test('tabs expand to the next stop of 4', () => {
    expect(expandTabs('\tx')).toBe('    x')
    expect(expandTabs(' \tx')).toBe('    x')
    expect(expandTabs('ab\tc\td')).toBe('ab  c   d')
  })

  test('a cut through a tab leaves its remaining columns as spaces; extra columns take only whitespace', () => {
    expect(cutColumns('>\tcode', 2)).toBe('  code')
    expect(cutColumns('   \tline', 3)).toBe('\tline')
    expect(cutColumns('  \tx', 0, 4)).toBe('x')
    expect(cutColumns('  x', 0, 4)).toBe('x')
    expect(cutColumns('', 3, 4)).toBe('')
    expect(cutColumns('- item', 2)).toBe('item')
  })
})

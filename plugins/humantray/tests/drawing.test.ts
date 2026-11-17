// How the pane and the viewer draw Markdown with code in it (#51, decided for
// the owner on #51): code as stored, so a surface's own copy button (the
// desktop app has one) carries no U+200B; everything else as forDisplay draws
// it. Code found by hand is never trusted to stay code (#40): each block is
// drawn again as a fence of its own at the top level, and every fence-like run
// in the text between is broken, so a wrong guess changes only how something
// looks. These tests read the drawn text the way a CommonMark renderer would
// at the top level: fences that open at column 0 after a blank line.

import { describe, expect, test } from 'claude-code/testing'

import { LANGUAGES, UNSAFE, codeBlocksOf, listedLang } from '../hooks/code'
import { blocksOf, clipBlocks, clipDrawn, forDisplay, forDrawing, plain, splitDrawn } from '../hooks/items'
import { CODE_CASES, RUNBOOK } from './code-fixtures'

const ZWSP = '\u200b'

/**
 * The drawn text split into the fences drawn here and the text between: a
 * fence opens on a line of three or more backticks (and a plain language) at
 * column 0, after a blank line or at the start, and closes on the same line of
 * backticks alone. Fails the test on anything else.
 */
function split(drawn: string): { fences: string[]; between: string[] } {
  const lines = drawn.split('\n')
  const fences: string[] = []
  const between: string[] = []
  let text: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})([A-Za-z0-9_+.#-]*)$/.exec(lines[i] ?? '')
    if (open && (i === 0 || lines[i - 1] === '')) {
      between.push(text.join('\n'))
      text = []
      const ticks = open[1] as string
      const content: string[] = []
      i++
      while (i < lines.length && lines[i] !== ticks) content.push(lines[i++] as string)
      expect(i < lines.length).toBe(true)
      // A blank line, or the end, after the closing fence.
      expect(i === lines.length - 1 || lines[i + 1] === '').toBe(true)
      // Nothing inside can close it: no run of its backticks as long, at a line's start.
      for (const line of content) expect(new RegExp(`^ {0,3}${ticks}`).test(line)).toBe(false)
      fences.push(content.join('\n'))
      continue
    }
    text.push(lines[i] as string)
  }
  between.push(text.join('\n'))
  return { fences, between }
}

/** Text between fences can open nothing a renderer would load or run, nor a fence of its own. */
function inert(text: string) {
  expect(/!\[/.test(text)).toBe(false)
  expect(/<[A-Za-z/!?]/.test(text)).toBe(false)
  expect(/(file|javascript|vbscript|data):/i.test(text)).toBe(false)
  expect(/`{3,}|~{3,}/.test(text)).toBe(false)
}

describe('forDrawing', () => {
  for (const each of CODE_CASES) {
    test(`code is drawn as stored, in fences of its own, with no U+200B: ${each.name}`, () => {
      const drawn = forDrawing(each.md)
      const { fences, between } = split(drawn)
      // As stored, but every control character a person cannot see drawn as U+FFFD (bidi controls too).
      expect(fences).toEqual(each.blocks.map(text => plain(text).replace(new RegExp(UNSAFE.source, 'g'), '\ufffd')))
      for (const fence of fences) expect(fence.includes(ZWSP)).toBe(false)
      for (const text of between) inert(text)
    })
  }

  test("the lead's cases: <<, <word> and a line of backticks inside code", () => {
    const md = ['Run:', '', '````sh', "cat <<'EOF' > x", '<DIGEST>', '```', 'EOF', '````', '', 'and `<b>` here, ![x](y)'].join('\n')
    const drawn = forDrawing(md)
    const { fences, between } = split(drawn)
    expect(fences).toEqual(["cat <<'EOF' > x\n<DIGEST>\n```\nEOF"])
    expect(drawn).toContain('````sh\n')
    for (const text of between) inert(text)
    // Outside code the rewrites stay.
    expect(drawn).toContain(`!${ZWSP}[x](y)`)
  })

  test('text with no code is drawn as forDisplay draws it, fence-like runs broken', () => {
    expect(forDrawing('  Teal\n')).toBe(forDisplay('  Teal\n'))
    expect(forDrawing('a ``` b ~~~~ c')).toBe(`a \`${ZWSP}\`\` b ~${ZWSP}~~~ c`)
  })

  // The ways #40's reader found to make hand-found code disagree with a renderer,
  // and the lazy line, where the walk and CommonMark disagree about a list item.
  const BYPASSES: Array<[string, string]> = [
    ['escaped backticks', '\\`![x](https://x.test/p.png)\\` and \\`<img src=x>\\`'],
    ['a code span over two lines', 'a ` b\nc ` ![x](https://x.test/p.png) ` d <img src=x>'],
    ['a fence that ends with its quote', '> ```\n> code\n![x](https://x.test/p.png) <img src=x>'],
    ['a fence that ends with its list item', '- ```\n  code\n\n![x](https://x.test/p.png) <img src=x>'],
    ['an indented line taken for a fence', 'text\n    ```\n![x](https://x.test/p.png) <img src=x>'],
    ['a lazy line in a fence in a list item', '1. x\n   ```\n![x](https://tracker.test/p.png) <img src=x>\n   ```\n2. y'],
    ['a fence a renderer sees and the walk does not', '- a\n      ```\n![x](https://x.test/p.png)\n      ```'],
    ['a tilde fence in a quote, then text', '> ~~~\n> a\n~~~\n![x](https://x.test/p.png)'],
  ]
  for (const [name, md] of BYPASSES) {
    test(`never leaves text unrewritten outside a fence drawn here: ${name}`, () => {
      const { fences, between } = split(forDrawing(md))
      for (const text of between) inert(text)
      // Whatever was taken for code is exactly a block the walk found.
      expect(fences).toEqual(codeBlocksOf(md).map(block => plain(block.text).replace(new RegExp(UNSAFE.source, 'g'), '\ufffd')))
    })
  }

  test('a list goes on after a code block drawn at the top level: the next item keeps its number', () => {
    const drawn = forDrawing(RUNBOOK)
    const lines = drawn.split('\n')
    for (const n of [2, 3, 4, 5, 6]) {
      const at = lines.indexOf(`${String(n)}. Build and push the image:`)
      // At column 0, after a blank line: a renderer starts an ordered list there, numbered from n.
      expect(at).toBeGreaterThan(0)
      expect(lines[at - 1]).toBe('')
    }
    expect(lines[0]).toContain('**Part A')
    // The text after each block is drawn too, in order.
    expect(drawn.indexOf('Expect, in order:')).toBeGreaterThan(drawn.indexOf('docker build -t registry.example.com/svc:step1'))
    expect(drawn.indexOf('2. Build')).toBeGreaterThan(drawn.indexOf('step":1'))
    expect(drawn.match(/^\*Code \d+\*$/gm)).toHaveLength(12)
  })

  test('cut by blocks, a drawn fence is never split, and the cut text is a prefix', () => {
    const drawn = forDrawing(RUNBOOK)
    for (const max of [200, 700, 1_500, 3_000]) {
      const cut = clipBlocks(drawn, max)
      expect(drawn.startsWith(cut.text)).toBe(true)
      expect((cut.text.match(/^`{3,}/gm) ?? []).length % 2).toBe(0)
    }
    // Each fence is a block of its own.
    expect(blocksOf(drawn).filter(block => block.startsWith('```')).length).toBe(12)
  })

  // The text after a block that sat in a list item is drawn less that item's
  // indentation: at the top level it stays prose and a list, never an indented
  // code block (whose native copy would carry the rewrites). Each expected
  // text was also parsed with commonmark.js 0.31.2: its only code blocks are
  // the ones drawn here.
  const F = '```'
  const DEDENTED: Array<[string, string, string]> = [
    [
      'a 10th step (content at column 4)',
      ['10. Build:', '', `    ${F}bash`, '    echo 10', `    ${F}`, '', '    Expect, in order:', '', '    - Note the step.', '', '11. Next.'].join('\n'),
      `10. Build:\n\n*Code 1*\n\n${F}bash\necho 10\n${F}\n\nExpect, in order:\n\n- Note the step.\n\n11. Next.`,
    ],
    [
      'an item written `-   `',
      ['-   Build:', '', `    ${F}`, '    echo x', `    ${F}`, '', '    After text', '', '    - sub'].join('\n'),
      `-   Build:\n\n*Code 1*\n\n${F}\necho x\n${F}\n\nAfter text\n\n- sub`,
    ],
    [
      'a nested list',
      ['- Step', '  - sub', '', `    ${F}`, '    echo nested', `    ${F}`, '', '    After text', '', '    - deeper', '', '- Next step'].join('\n'),
      `- Step\n  - sub\n\n*Code 1*\n\n${F}\necho nested\n${F}\n\nAfter text\n\n- deeper\n\n- Next step`,
    ],
    [
      'a 10th step inside a quote (the quote marks are taken off too)',
      ['> 10. Build:', '>', `>     ${F}sh`, '>     echo 10', `>     ${F}`, '>', '>     Expect <DIGEST>', '>', '> 11. Next.'].join('\n'),
      `> 10. Build:\n>\n\n*Code 1*\n\n${F}sh\necho 10\n${F}\n\nExpect <\u200bDIGEST>\n\n11. Next.`,
    ],
  ]
  for (const [name, md, expected] of DEDENTED) {
    test(`the text after a block in a list item is not drawn as code: ${name}`, () => {
      expect(forDrawing(md)).toBe(expected)
    })
  }

  test('no text line is left four or more columns in after a blank line, for any fixture', () => {
    for (const each of [...CODE_CASES, ...DEDENTED.map(([name, md]) => ({ name, md }))]) {
      const { between } = split(forDrawing(each.md))
      for (const text of between) {
        const lines = text.split('\n')
        lines.forEach((line, k) => {
          if (k > 0 && lines[k - 1] === '' && /^ {4}/.test(line)) expect({ name: each.name, line }).toEqual({ name: each.name, line: 'not indented' })
        })
      }
    }
  })

  test('a block holding a bidi control is drawn with U+FFFD in its place, so a native copy cannot carry it', () => {
    const { fences } = split(forDrawing('```\necho abc \u202e ok\n```'))
    expect(fences).toEqual(['echo abc \ufffd ok'])
  })

  test('control characters are replaced in code too, since a surface refuses them', () => {
    const { fences } = split(forDrawing('```\na\u0007b\n```'))
    expect(fences).toEqual(['a\ufffdb'])
  })
})

describe('splitDrawn: every piece its own Markdown element (#51)', () => {
  // The deep read's bodies on PR #56: a link definition whose title is left
  // open runs, in some parsers, across the blank line and swallows the next
  // fence's opening line. Drawn apart, the fence is a piece of its own, and
  // nothing in the definition's piece can reach it.
  const PAYLOAD = '![x](https://tracker.test/p.png) <img src=https://tracker.test/q.png> [f](file:///etc/passwd)'
  const OPEN_TITLES: Array<[string, string, string]> = [
    ['a double-quoted title left open', ['[a]: https://example.test "', '', '```sh', 'echo "', PAYLOAD, '```'].join('\n'), `echo "\n${PAYLOAD}`],
    ['a title in brackets left open', ['[a]: https://example.test (', '', '```sh', `echo ${PAYLOAD} )`, '```'].join('\n'), `echo ${PAYLOAD} )`],
    ['a title on the line after the address', ['[a]: https://example.test', '"', '', '```sh', 'echo "', PAYLOAD, '```'].join('\n'), `echo "\n${PAYLOAD}`],
    [
      'a definition after an earlier code block',
      ['```', 'first', '```', '', '[a]: https://example.test "', '', '```sh', 'echo "', PAYLOAD, '```'].join('\n'),
      `echo "\n${PAYLOAD}`,
    ],
  ]
  for (const [name, md, code] of OPEN_TITLES) {
    test(`the code stays code, apart from the text before it: ${name}`, () => {
      const pieces = splitDrawn(forDrawing(md))
      const fence = pieces.find(piece => piece.includes(code))
      // The code's piece holds its label and its fence, and nothing else.
      expect(fence).toMatch(/^\*Code \d+\*\n\n(`{3,})sh\n[\s\S]*\n\1$/)
      expect(fence?.split('\n').slice(3, -1).join('\n')).toBe(code)
      // Every other piece is inert, and holds no part of the code.
      for (const piece of pieces) {
        if (piece === fence || /^\*Code \d+\*\n\n`{3,}/.test(piece)) continue
        inert(piece)
        expect(piece.includes('echo')).toBe(false)
      }
    })
  }

  test('joined with a blank line, the pieces are the drawn text; only a drawn fence holds three backticks', () => {
    for (const md of [...CODE_CASES.map(each => each.md), RUNBOOK, ...OPEN_TITLES.map(([, body]) => body)]) {
      for (const drawn of [forDrawing(md), forDrawing(md, false), clipBlocks(forDrawing(md), 700).text]) {
        const pieces = splitDrawn(drawn)
        expect(pieces.join('\n\n')).toBe(drawn)
        for (const piece of pieces) {
          if (/`{3}/.test(piece)) expect(piece).toMatch(/^(\*Code \d+\*\n\n)?(`{3,})[A-Za-z0-9_+.#-]*\n[\s\S]*\2$/)
        }
      }
    }
  })

  test('the runbook draws as text and fence pieces, one fence a piece', () => {
    const pieces = splitDrawn(forDrawing(RUNBOOK))
    expect(pieces.filter(piece => piece.startsWith('*Code '))).toHaveLength(12)
    expect(pieces.length).toBeGreaterThan(12)
  })
})

describe('the languages a drawn fence keeps (decided for the owner on #51)', () => {
  test('listed languages are kept, in lower case; any other is dropped from the drawing and from the copy label', () => {
    for (const lang of ['bash', 'sh', 'json', 'yaml', 'python', 'ts', 'diff', 'powershell', 'dockerfile', 'makefile']) {
      expect(LANGUAGES.has(lang)).toBe(true)
      expect(forDrawing(`\`\`\`${lang}\nx\n\`\`\``)).toBe(`*Code 1*\n\n\`\`\`${lang}\nx\n\`\`\``)
    }
    expect(listedLang('BASH')).toBe('bash')
    for (const lang of ['mermaid', 'math', 'latex', 'svg', 'html', 'xml', 'markdown', 'md', 'dot', 'plantuml', 'graphviz', 'katex', 'unknown', 'a'.repeat(40)]) {
      expect(listedLang(lang)).toBe('')
      expect(forDrawing(`\`\`\`${lang}\nx\n\`\`\``)).toBe('*Code 1*\n\n```\nx\n```')
    }
  })
})

describe('clipDrawn: a cut never leaves a Code label without its fence (#51)', () => {
  test('cut anywhere, a label is always followed by its fence, and the text is a prefix of the drawn', () => {
    const body = Array.from({ length: 40 }, (_, k) => `Step ${String(k)}: ${'words '.repeat(8)}\n\n` + '```sh\n' + `echo ${String(k)}\n` + '```').join('\n\n')
    const drawn = forDrawing(body)
    for (let max = 20; max < drawn.length; max += 37) {
      const cut = clipDrawn(drawn, max)
      // A prefix, or (when even the first paragraph does not fit) that paragraph cut at a word, as #45 cuts it.
      expect(drawn.startsWith(cut.text) || (cut.text.endsWith('…') && drawn.startsWith(cut.text.slice(0, -1)))).toBe(true)
      expect(/\*Code \d+\*$/.test(cut.text)).toBe(false)
      const lines = cut.text.split('\n')
      lines.forEach((line, k) => {
        if (/^\*Code \d+\*$/.test(line)) expect(/^`{3,}/.test(lines[k + 2] ?? '')).toBe(true)
      })
    }
    // The reader's case: at 3,000 characters clipBlocks alone ends on a label.
    const plainCut = clipBlocks(drawn, 3_000).text
    expect(/\*Code \d+\*$/.test(plainCut) || !/\*Code \d+\*$/.test(clipDrawn(drawn, 3_000).text)).toBe(true)
    expect(clipDrawn(drawn, drawn.length)).toEqual({ text: drawn, clipped: false })
  })
})

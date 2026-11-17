// Pruning and History as pure rules: what may go, what counts towards the
// 200, the order, the marks, and that a finished item never changes again.

import { describe, expect, test } from 'claude-code/testing'

import {
  FULL_BUDGET,
  HISTORY_CLIP,
  KEEP_PER_REPO,
  addOrBump,
  applySettle,
  blocksOf,
  clipBlocks,
  deliveryText,
  forDisplay,
  fullOf,
  historyOf,
  isLineDue,
  isPrunable,
  prune,
  validateAdd,
} from '../hooks/items'
import type { Item, StoreFile } from '../types'
import { HOUR, RICH, START, finished, finishedMany, oldestOfMany, stored } from './world'

const REPO = 'github.com/owner/repo'
const OTHER = 'github.com/owner/other'

const file = (items: Item[], sessions: StoreFile['sessions'] = {}): StoreFile => ({ version: 1, items, sessions })
const ids = (f: StoreFile) => new Set(f.items.map(item => item.id))

describe('isLineDue and isPrunable', () => {
  const cases: Array<[string, Partial<Item> & Pick<Item, 'type'>, boolean, boolean]> = [
    ['open', { type: 'approve', status: 'open' }, false, false],
    ['answered, delivered', { type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: true }, true, true],
    ['answered, not delivered', { type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: false }, true, false],
    [
      'answered, delivered, but claimed',
      { type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: true, delivering_at: START, delivering_by: 'x/1' },
      true,
      false,
    ],
    [
      'claimed long ago by an instance that died',
      { type: 'approve', status: 'answered', response: { selected: ['Approve'] }, delivered: false, delivering_at: START - 2 * HOUR, delivering_by: 'gone/1' },
      true,
      false,
    ],
    ['ack without notify, not flagged delivered', { type: 'ack', status: 'acknowledged', response: { acknowledged: true }, delivered: false }, false, true],
    [
      'ack with notify, not delivered',
      { type: 'ack', status: 'acknowledged', response: { acknowledged: true }, delivered: false, notify_on_done: true },
      true,
      false,
    ],
    ['do, done, delivered', { type: 'do', status: 'done', response: { outcome: 'not_done' }, delivered: true }, true, true],
  ]
  for (const [name, fields, due, prunable] of cases) {
    test(name, () => {
      const item = stored({ id: '01AAAAAAAAAAAAAAAAAAAAAAAAA', ...fields })
      expect(isLineDue(item)).toBe(due)
      expect(isPrunable(item)).toBe(prunable)
    })
  }
})

describe('prune: the last 200 finished items per repository', () => {
  test('exactly 200 finished: nothing goes', () => {
    const f = file(finishedMany(200))
    expect(prune(f)).toEqual([])
    expect(f.items).toHaveLength(200)
  })

  test('201 finished: exactly the oldest by response_at goes, not the first by position, id or updated', () => {
    const items = finishedMany(201)
    const expected = oldestOfMany(201, 1)
    expect(expected[0]).not.toBe(items[0]?.id)
    expect(expected[0]).not.toBe(items[200]?.id)
    const f = file(items)
    expect(prune(f)).toEqual(expected)
    expect(f.items).toHaveLength(200)
    expect(ids(f).has(expected[0] ?? '')).toBe(false)
  })

  test('205 finished: the five oldest go, whatever their place', () => {
    const f = file(finishedMany(205))
    expect(new Set(prune(f))).toEqual(new Set(oldestOfMany(205, 5)))
    expect(f.items).toHaveLength(200)
  })

  test('two on the same response_at at the boundary: the smaller id goes', () => {
    const items = finishedMany(199, {}, 10)
    // Both older than every other; the larger id is placed first.
    items.unshift(finished(2, { response_at: START - 9 * HOUR }))
    items.push(finished(1, { response_at: START - 9 * HOUR }))
    const f = file(items)
    expect(prune(f)).toEqual([finished(1).id])
    expect(ids(f).has(finished(2).id)).toBe(true)
  })

  test('protected items neither count nor go', () => {
    const done = finishedMany(200)
    const open = Array.from({ length: 30 }, (_, i) => stored({ id: `01OPN${String(i).padStart(21, '0')}`, type: 'ack', session_id: 'session-z' }))
    const owed = Array.from({ length: 20 }, (_, i) =>
      finished(1_000 + i, { session_id: 'session-z', delivered: false, delivered_at: undefined, response_at: START - 10 * HOUR }),
    )
    const claimed = Array.from({ length: 10 }, (_, i) =>
      finished(2_000 + i, {
        session_id: 'session-z',
        delivered: false,
        delivered_at: undefined,
        delivering_at: START - 2 * HOUR,
        delivering_by: 'gone/1',
        response_at: START - 20 * HOUR - i,
      }),
    )
    const f = file([...claimed, ...done, ...owed, ...open])
    expect(prune(f)).toEqual([])
    expect(f.items).toHaveLength(260)
  })

  test('protected items newer than every finished one do not push finished ones out', () => {
    const done = finishedMany(201)
    const newer = Array.from({ length: 6 }, (_, i) =>
      finished(1_000 + i, { session_id: 'session-z', delivered: false, delivered_at: undefined, response_at: START + HOUR + i }),
    )
    const f = file([...newer, ...done])
    expect(prune(f)).toEqual(oldestOfMany(201, 1))
    expect(f.items).toHaveLength(206)
  })

  test('two records sharing an id: pruning the finished one keeps the protected one', () => {
    const twinId = finished(900).id
    const old = finished(900, { response_at: START - 90 * HOUR })
    const owedTwin = finished(900, { delivered: false, delivered_at: undefined, response_at: START - 90 * HOUR })
    const f = file([owedTwin, ...finishedMany(200), old])
    expect(prune(f)).toEqual([twinId])
    expect(f.items).toHaveLength(201)
    expect(f.items.filter(item => item.id === twinId)).toEqual([owedTwin])
  })

  test('an ack with no line due counts and can go, though not flagged delivered', () => {
    const ack = stored({
      id: '01ACK000000000000000000000',
      type: 'ack',
      session_id: 'session-z',
      status: 'acknowledged',
      response: { acknowledged: true },
      response_at: START - 30 * HOUR,
      delivered: false,
    })
    const f = file([...finishedMany(200), ack])
    expect(prune(f)).toEqual([ack.id])
  })

  test('each repo value is counted on its own', () => {
    const other = finishedMany(201, { repo: OTHER })
    const mine = finishedMany(10, {}, 500)
    const f = file([...other, ...mine])
    expect(prune(f)).toEqual(oldestOfMany(201, 1))
    expect(f.items.filter(item => item.repo === OTHER)).toHaveLength(200)
    expect(f.items.filter(item => item.repo === REPO)).toHaveLength(10)
  })

  test('relayed items follow the same rules', () => {
    const relayed = finishedMany(201, { origin: 'relayed' })
    relayed.push(finished(900, { origin: 'relayed', delivered: false, delivered_at: undefined, response_at: START - 50 * HOUR }))
    const f = file(relayed)
    expect(prune(f)).toEqual(oldestOfMany(201, 1))
    expect(ids(f).has(finished(900).id)).toBe(true)
  })

  test('an answered item with no response_at is ordered by updated', () => {
    const items = finishedMany(199)
    const old = finished(800, { response_at: undefined, updated: START - 50 * HOUR })
    const recent = finished(801, { response_at: undefined, updated: START })
    const f = file([recent, ...items, old])
    expect(prune(f)).toEqual([old.id])
    expect(ids(f).has(recent.id)).toBe(true)
  })

  test('session records are never touched', () => {
    const sessions = {
      'session-a': { seen: START - 30 * 24 * HOUR, successor: 'session-b' },
      'session-b': { seen: START },
      'session-c': { seen: START - 30 * 24 * HOUR },
    }
    const f = file(finishedMany(250, { session_id: 'session-c' }), structuredClone(sessions))
    expect(prune(f)).toHaveLength(50)
    expect(f.sessions).toEqual(sessions)
  })

  test('the default keeps 200', () => {
    expect(KEEP_PER_REPO).toBe(200)
  })
})

describe('a finished item never changes again', () => {
  const p = finished(7, { key: 'the key', response_at: START - HOUR })
  const frozen = JSON.stringify(p)

  test('a settle under any claim leaves it as it was', () => {
    const f = file([structuredClone(p)])
    for (const claim of ['x/1', 'gone/9', '']) {
      expect(applySettle(f, p.id, claim, true, START)).toBe(false)
      expect(applySettle(f, p.id, claim, false, START)).toBe(false)
    }
    expect(JSON.stringify(f.items[0])).toBe(frozen)
  })

  test('an add with its key and type makes a new item and leaves it as it was', () => {
    const f = file([structuredClone(p)])
    const input = validateAdd({ type: 'approve', header: 'Done', question: 'Again', key: 'the key' })
    if (input.error !== undefined) throw new Error(input.error)
    const added = addOrBump(f, input.ok, { repo: REPO, session_id: 'session-a', now: START, id: '01NEW000000000000000000000' })
    expect(added.ok?.bumped).toBe(false)
    expect(f.items).toHaveLength(2)
    expect(JSON.stringify(f.items[0])).toBe(frozen)
  })

  test('a settle for an id no longer in the store does nothing', () => {
    const f = file([structuredClone(p)])
    const before = JSON.stringify(f)
    expect(applySettle(f, '01GONE00000000000000000000', 'x/1', true, START)).toBe(false)
    expect(JSON.stringify(f)).toBe(before)
  })
})

describe('historyOf', () => {
  const NOW = START

  test('every repo value, the current one first, each newest first, ties by id; open items left out', () => {
    const f = file([
      finished(3, { response_at: NOW - 3_000 }),
      finished(1, { response_at: NOW - 1_000 }),
      finished(5, { response_at: NOW - 1_000 }),
      finished(4, { response_at: undefined, updated: NOW - 2_000 }),
      finished(9, { repo: OTHER, response_at: NOW }),
      stored({ id: '01OPEN00000000000000000000', type: 'ack', updated: NOW }),
    ])
    expect(historyOf(f, REPO, 'session-a', NOW).map(e => e.id)).toEqual([
      finished(5).id,
      finished(1).id,
      finished(4).id,
      finished(3).id,
      finished(9).id,
    ])
    expect(historyOf(f, OTHER, 'session-a', NOW).map(e => e.id)).toEqual([
      finished(9).id,
      finished(5).id,
      finished(1).id,
      finished(4).id,
      finished(3).id,
    ])
  })

  test('the delivery marks', () => {
    const f = file([
      finished(1),
      finished(2, { delivered: false, delivered_at: undefined, delivering_at: NOW - 10_000, delivering_by: 'x/1' }),
      finished(3, { delivered: false, delivered_at: undefined, delivering_at: NOW - 61_000, delivering_by: 'gone/1' }),
      finished(4, { delivered: false, delivered_at: undefined }),
      finished(5, { type: 'ack', response: { acknowledged: true }, status: 'acknowledged', options: undefined, delivered: false, delivered_at: undefined }),
      finished(6, { type: 'ack', response: { acknowledged: true }, status: 'acknowledged', options: undefined, notify_on_done: true }),
      finished(7, { type: 'ack', response: { acknowledged: true }, status: 'acknowledged', options: undefined }),
      finished(8, { delivered: false, delivered_at: undefined, delivering_at: NOW - 60_000, delivering_by: 'x/1' }),
    ])
    const marks = Object.fromEntries(historyOf(f, REPO, 'session-a', NOW).map(e => [e.id, e.mark]))
    expect(marks).toEqual({
      [finished(1).id]: 'delivered',
      [finished(2).id]: 'delivering',
      [finished(3).id]: 'not delivered',
      [finished(4).id]: 'not delivered',
      [finished(5).id]: 'none',
      [finished(6).id]: 'delivered',
      // Owes no line, flagged delivered by its owner's pass: still no mark.
      [finished(7).id]: 'none',
      // At exactly the stale bound a claim is still fresh, as the pass treats it.
      [finished(8).id]: 'delivering',
    })
  })

  test('mine: this session\'s and its predecessor\'s; another session\'s is not', () => {
    const f = file(
      [finished(1, { session_id: 'session-a' }), finished(2, { session_id: 'session-old' }), finished(3, { session_id: 'session-b' })],
      { 'session-old': { seen: NOW - HOUR, successor: 'session-a' }, 'session-a': { seen: NOW } },
    )
    const mine = Object.fromEntries(historyOf(f, REPO, 'session-a', NOW).map(e => [e.id, e.isMine]))
    expect(mine).toEqual({ [finished(1).id]: true, [finished(2).id]: true, [finished(3).id]: false })
  })

  test('the question is clipped with an ellipsis; a long part keeps whole blocks; a long paragraph is cut at a word', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `${String(i).padStart(2, '0')}${'a'.repeat(97)}`).join('\n\n')
    const words = Array.from({ length: 200 }, (_, i) => `word${String(i)}`).join(' ')
    const f = file([
      finished(1, {
        type: 'question',
        options: undefined,
        question: 'q'.repeat(500),
        response: { text: paragraphs, notes: words },
      }),
      finished(2, { type: 'question', options: undefined, question: 'Short?', response: { text: 'yes', notes: 'ok' } }),
      finished(3, { type: 'question', options: undefined, response: { text: 'n'.repeat(10_000), notes: `- ${'l'.repeat(600)}` } }),
    ])
    const [long, short, unbroken] = historyOf(f, REPO, 'session-a', NOW).sort((a, b) => (a.id < b.id ? -1 : 1))
    expect(long?.question).toBe(`${'q'.repeat(HISTORY_CLIP.question - 1)}…`)
    // Four 99-character paragraphs and their three gaps fit in 500; a fifth would not.
    expect(long?.parts[0]).toEqual({
      label: 'Answer',
      text: paragraphs.split('\n\n').slice(0, 4).join('\n\n'),
      length: paragraphs.length,
      clipped: true,
    })
    // One paragraph over the budget: its first words that fit, cut at a space, with an ellipsis.
    const notes = long?.parts[1]
    expect(notes?.clipped).toBe(true)
    expect(notes?.text.endsWith('…')).toBe(true)
    expect(notes?.text.length).toBeLessThanOrEqual(HISTORY_CLIP.part)
    expect(words.startsWith(notes?.text.slice(0, -1) ?? 'x')).toBe(true)
    expect(words[(notes?.text.length ?? 0) - 1]).toBe(' ')
    expect(long?.clipped).toBe(true)
    // A paragraph with no space is cut hard; a list item over the budget is kept out whole.
    expect(unbroken?.parts[0]?.text).toBe(`${'n'.repeat(HISTORY_CLIP.part - 1)}…`)
    expect(unbroken?.parts[1]).toEqual({ label: 'Notes', text: '', length: 602, clipped: true })
    expect(short?.question).toBe('Short?')
    expect(short?.parts).toEqual([
      { label: 'Answer', text: 'yes', length: 3, clipped: false },
      { label: 'Notes', text: 'ok', length: 2, clipped: false },
    ])
    expect(short?.answer).toBe('')
    expect(short?.clipped).toBe(false)
    expect(HISTORY_CLIP).toEqual({ question: 200, part: 500 })
  })

  test('what was chosen, the free-text parts as stored, and the bumps', () => {
    const f = file([
      finished(1, {
        type: 'choice',
        response: { selected: ['Red'], other: '  Teal\n', notes: 'see\nthe log' },
        bumps: 2,
      }),
    ])
    const [entry] = historyOf(f, REPO, 'session-a', NOW)
    expect(entry?.answer).toBe('Red; Other')
    expect(entry?.parts.map(part => [part.label, part.text])).toEqual([
      ['Other', '  Teal\n'],
      ['Notes', 'see\nthe log'],
    ])
    expect(entry?.bumps).toBe(2)
  })

  test("only the type's own fields, and only strings, are parts", () => {
    const odd = { outcome: 'done', text: 5, other: 'stray', notes: 7 } as unknown as Item['response']
    const f = file([finished(1, { type: 'do', options: undefined, status: 'done', response: odd })])
    const [entry] = historyOf(f, REPO, 'session-a', NOW)
    expect(entry?.answer).toBe('done')
    expect(entry?.parts).toEqual([])
    expect(fullOf(f.items[0] as Item).parts).toEqual([])
    expect(deliveryText(f.items[0] as Item)).toBe(`humantray ${finished(1).short} (Done): done`)
  })

  test('a part is cut as drawn, so breaks put in for display never take it past the budget', () => {
    const tags = Array.from({ length: 60 }, (_, i) => `<b>${String(i)}</b> ![${String(i)}](https://x.test/${String(i)}.png)`).join('\n\n')
    const f = file([finished(1, { type: 'question', options: undefined, response: { text: tags } })])
    const [entry] = historyOf(f, REPO, 'session-a', NOW)
    const part = entry?.parts[0]
    expect(part?.clipped).toBe(true)
    expect(part?.length).toBe(tags.length)
    expect(part?.text.length).toBeLessThanOrEqual(HISTORY_CLIP.part)
    expect(part?.text.startsWith(`<\u200bb>0<\u200b/b> !\u200b[0](https://x.test/0.png)`)).toBe(true)
  })

  test('a multi-line question is shown on one line, and offered in full', () => {
    const f = file([finished(1, { question: 'Which\nplan?' })])
    const [entry] = historyOf(f, REPO, 'session-a', NOW)
    expect(entry?.question).toBe('Which / plan?')
    expect(entry?.clipped).toBe(true)
    expect(fullOf(f.items[0] as Item).question).toBe('Which\nplan?')
  })
})

describe('fullOf: one entry whole, as drawn, under the budget', () => {
  test('the body and parts are whole and drawn safely', () => {
    const item = finished(1, {
      type: 'question',
      options: undefined,
      body_md: 'See ![x](https://x.test/x.png)',
      response: { text: RICH, notes: '<img src=x>' },
    })
    const full = fullOf(item)
    expect(full.body).toEqual({ text: 'See !\u200b[x](https://x.test/x.png)', length: 30, clipped: false })
    expect(full.parts).toEqual([
      { label: 'Answer', text: RICH, length: RICH.length, clipped: false },
      { label: 'Notes', text: '<\u200bimg src=x>', length: 11, clipped: false },
    ])
  })

  test('past FULL_BUDGET, what is drawn is cut between blocks and says so', () => {
    // 96,000 characters of tags, which the breaks make 126,000 to draw.
    const big = Array.from({ length: 3_000 }, () => '<b>'.repeat(10)).join('\n\n')
    const item = finished(1, { type: 'question', options: undefined, body_md: big, response: { text: big, notes: big } })
    const full = fullOf(item)
    const drawn = full.body.text.length + full.parts.reduce((sum, part) => sum + part.text.length, 0)
    expect(drawn).toBeLessThanOrEqual(FULL_BUDGET)
    expect(full.body.clipped).toBe(true)
    expect(full.body.length).toBe(big.length)
    expect(full.parts.every(part => part.clipped)).toBe(true)
  })
})

describe('blocks: History cuts Markdown only between whole blocks', () => {
  test('a rich answer splits into its blocks; a fence, an indented continuation and a loose list stay whole', () => {
    expect(blocksOf(RICH)).toEqual([
      '## Steps',
      '1. Rotate the **key**\n   - in `prod` first\n   - then *staging*\n2. Tell [ops](https://example.com/ops)\n\n- [x] backed up\n- [ ] announced',
      '> Check the logs first.',
      '```sh\nmake rotate\n\n    echo indented\n```',
      '| Env | Done |\n| --- | ---- |\n| prod | yes |',
      '---\n\n    an indented code block',
    ])
  })

  test('a loose list and a quote whose paragraphs are separated by a blank line are one block each', () => {
    expect(blocksOf('- one\n\n- two\n\n  more of two\n\n3. three\n\nafter')).toEqual(['- one\n\n- two\n\n  more of two\n\n3. three', 'after'])
    expect(blocksOf('> one\n\n> two\n>\n> three\n\nafter')).toEqual(['> one\n\n> two\n>\n> three', 'after'])
    // So a cut never keeps half of one: the list is kept whole or left out whole.
    const list = '- one\n\n- two\n\n- three'
    expect(clipBlocks(`${list}\n\nend`, list.length + 2)).toEqual({ text: list, clipped: true })
    expect(clipBlocks(`${list}\n\nend`, list.length - 1)).toEqual({ text: '', clipped: true })
  })

  test('every cut is a run of whole leading blocks, never a part of one', () => {
    const blocks = blocksOf(RICH)
    for (let max = 0; max <= RICH.length + 1; max++) {
      const cut = clipBlocks(RICH, max)
      expect(cut.text.length).toBeLessThanOrEqual(max)
      expect(cut.clipped).toBe(RICH.length > max)
      if (!cut.clipped) {
        expect(cut.text).toBe(RICH)
        continue
      }
      // Splitting the kept text again gives back the leading blocks, whole.
      const kept = blocksOf(cut.text)
      expect(kept).toEqual(blocks.slice(0, kept.length))
    }
  })

  // #45: a paragraph that runs into another structure with no blank line
  // between is one block, but not a paragraph: never cut at a word inside it.
  describe('a paragraph running into a list, a fence or a quote is left out whole, never cut inside', () => {
    const lead = `${'word '.repeat(30).trimEnd()}:`
    const CASES: Array<[string, string]> = [
      ['a list', `${lead}\n- ${'item '.repeat(40)}\n- last`],
      ['a numbered list', `${lead}\n1. ${'item '.repeat(40)}`],
      ['a fence', `${lead}\n\`\`\`sh\n${'echo word '.repeat(20)}\n\`\`\``],
      ['a tilde fence', `${lead}\n~~~\n${'code word '.repeat(20)}\n~~~`],
      ['a quote', `${lead}\n> ${'quoted '.repeat(40)}`],
      ['a heading', `${lead}\n## ${'heading '.repeat(40)}`],
      ['a table row', `${lead}\n| ${'cell '.repeat(40)} |`],
      ['a tag', `${lead}\n<${'​'}details> ${'more '.repeat(40)}`],
    ]
    for (const [name, md] of CASES) {
      test(name, () => {
        expect(blocksOf(md)).toHaveLength(1)
        // Every cut that would fall inside the structure keeps the block out.
        for (const max of [lead.length + 1, lead.length + 10, Math.floor(md.length / 2), md.length - 1]) {
          expect(clipBlocks(md, max)).toEqual({ text: '', clipped: true })
        }
        expect(clipBlocks(md, md.length)).toEqual({ text: md, clipped: false })
      })
    }

    test('a paragraph of several plain lines is still cut at a word boundary', () => {
      const md = `${'alpha beta '.repeat(20)}\n${'gamma delta '.repeat(20)}\n  ${'lazy line '.repeat(10)}`
      const cut = clipBlocks(md, 300)
      expect(cut.clipped).toBe(true)
      expect(cut.text.endsWith('…')).toBe(true)
      expect(cut.text.length).toBeLessThanOrEqual(300)
      expect(md.startsWith(cut.text.slice(0, -1))).toBe(true)
      expect(/\s/.test(md[cut.text.length - 1] ?? '')).toBe(true)
    })

    test('the same paragraph after the list moved below a blank line is cut, and the list left out', () => {
      const md = `${'word '.repeat(120).trimEnd()}\n\n- item`
      const cut = clipBlocks(md, 100)
      expect(cut.text.endsWith('…')).toBe(true)
      expect(cut.text).not.toContain('- item')
    })
  })

  test('an unclosed fence runs to the end; a closing fence must match its mark', () => {
    expect(blocksOf('a\n\n~~~\nx\n\n```\n\ny\n~~~~\n\nz')).toEqual(['a', '~~~\nx\n\n```\n\ny\n~~~~', 'z'])
    expect(blocksOf('```\nno end\n\nstill code')).toEqual(['```\nno end\n\nstill code'])
    // Three backticks with more after them on the line are a code span, not a fence.
    expect(blocksOf('``` a ```\n\nb')).toEqual(['``` a ```', 'b'])
  })
})

describe("forDisplay: the owner's rules for drawing Markdown", () => {
  const Z = '\u200b'

  test('rich Markdown with no image, tag or unsafe link is drawn exactly as stored', () => {
    expect(forDisplay(RICH)).toBe(RICH)
  })

  test('every image becomes a link, whatever escapes or code surround it', () => {
    // The reader's and the deep read's forms, and the plain ones.
    const cases = [
      'see ![the logo](https://x.test/a.png "t")',
      'a \\\\![x](https://x.test/p.png)',
      '[![inner](https://x.test/i.png)](https://x.test/o)',
      '\\`![x](https://x.test/p.png)\\`',
      'a ` b\nc ` ![x](https://x.test/p.png) ` d',
      '> ```\n> code\n\n![x](https://x.test/p.png)',
      '- ```\n  code\n\n![x](https://x.test/p.png)',
      'text\n    ```\n![x](https://x.test/p.png)',
      '`![code](kept)` and ```\n![fenced](z)\n```',
      '![ref][logo]\n\n[logo]: https://x.test/c.png',
    ]
    for (const md of cases) {
      const drawn = forDisplay(md)
      expect(drawn).not.toMatch(/!\[/)
      expect(drawn.replaceAll(Z, '')).toBe(md)
    }
  })

  test('every raw tag, comment and autolink is broken, so no HTML runs', () => {
    for (const md of ['<img src=x>', '<IMG SRC=x onerror=alert(1)>', '</div>', '<!-- c -->', '<?php ?>', '<script>alert(1)</script>', '`<img src=x>`']) {
      const drawn = forDisplay(md)
      expect(drawn).not.toMatch(/<[A-Za-z/!?]/)
      expect(drawn.replaceAll(Z, '')).toBe(md)
    }
    // A bare `<` in prose or a comparison is left alone.
    expect(forDisplay('a < b and 1<2')).toBe('a < b and 1<2')
  })

  test('no file:, javascript:, vbscript: or data: link survives, in any form; http and https are left', () => {
    const cases = [
      '[a](file:///etc/passwd)',
      '[a](\nfile:///etc/passwd)',
      '[c]:\nfile:///etc/passwd\n\n[go][c]',
      '> [c]: file:///etc/passwd',
      '- [c]: file:///etc/passwd',
      '[a](&#102;ile:///etc/passwd)',
      '[a](file&colon;///etc/passwd)',
      '[a](FILE\\:///etc/passwd)',
      '<file:///z>',
      '[run](javascript:alert(1)) [v](VBScript:x) [d](data:text/html,x)',
    ]
    for (const md of cases) {
      const drawn = forDisplay(md)
      expect(drawn).not.toMatch(/(?:file|javascript|vbscript|data)\\?:|&#|&colon;/i)
      expect(drawn.replaceAll(Z, '')).toBe(md)
    }
    expect(forDisplay('[h](https://x.test) [i](http://y.test)')).toBe('[h](https://x.test) [i](http://y.test)')
  })

  test('line ends become \\n and any other control character but tab is replaced, so the pane is never refused', () => {
    expect(forDisplay('a\r\nb\rc\td\u0000e\u001bf\u0085g')).toBe('a\nb\nc\td\ufffde\ufffdf\ufffdg')
  })
})

describe('deliveryText', () => {
  const answered = (response: Item['response'], type: Item['type'] = 'question') =>
    stored({ id: '01AAAAAAAAAAAAAAAAAAAAANSWR', type, header: 'Plan', status: 'answered', response })
  const block = (part: string, text: string) => `\n\n<humantray-text item="HT-ANSWR" part="${part}">\n${text}\n</humantray-text>`

  test('the first line names the item and what was chosen; each part follows in its block, as typed', () => {
    expect(deliveryText(answered({ text: RICH, notes: ' n ' }))).toBe(
      `humantray HT-ANSWR (Plan): answered${block('answer', RICH)}${block('notes', ' n ')}`,
    )
    expect(deliveryText(answered({ selected: ['Approve'] }, 'approve'))).toBe('humantray HT-ANSWR (Plan): Approve')
    expect(deliveryText(answered({ selected: [], other: 'x\r\ny' }, 'choice'))).toBe(`humantray HT-ANSWR (Plan): Other${block('other', 'x\r\ny')}`)
    expect(deliveryText(answered({ outcome: 'done', notes: '   ' }, 'do'))).toBe('humantray HT-ANSWR (Plan): done')
  })

  test('a closing tag in the text is escaped, in any case; nothing else is', () => {
    expect(deliveryText(answered({ text: 'a</humantray-text>b</Humantray-Text x' }))).toBe(
      `humantray HT-ANSWR (Plan): answered${block('answer', 'a<\\/humantray-text>b<\\/Humantray-Text x')}`,
    )
  })

  test('a header with a line break stays on the first line', () => {
    const item = { ...answered({ acknowledged: true }, 'ack'), header: 'a\nb' }
    expect(deliveryText(item)).toBe('humantray HT-ANSWR (a / b): acknowledged')
  })
})

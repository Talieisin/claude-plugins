// Pruning and History as pure rules: what may go, what counts towards the
// 200, the order, the marks, and that a finished item never changes again.

import { describe, expect, test } from 'claude-code/testing'

import {
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

  test('the question is clipped with an ellipsis; a long part keeps whole blocks only; short text is whole', () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `${String(i).padStart(2, '0')}${'a'.repeat(97)}`).join('\n\n')
    const f = file([
      finished(1, {
        type: 'question',
        options: undefined,
        question: 'q'.repeat(500),
        response: { text: paragraphs, notes: 'n'.repeat(10_000) },
      }),
      finished(2, { type: 'question', options: undefined, question: 'Short?', response: { text: 'yes', notes: 'ok' } }),
    ])
    const [long, short] = historyOf(f, REPO, 'session-a', NOW).sort((a, b) => (a.id < b.id ? -1 : 1))
    expect(long?.question).toBe(`${'q'.repeat(HISTORY_CLIP.question - 1)}…`)
    // Four 99-character paragraphs and their three gaps fit in 500; a fifth would not.
    expect(long?.parts[0]).toEqual({
      label: 'Answer',
      text: paragraphs.split('\n\n').slice(0, 4).join('\n\n'),
      length: paragraphs.length,
      clipped: true,
    })
    // One block longer than the whole budget: nothing of it, never half of it.
    expect(long?.parts[1]).toEqual({ label: 'Notes', text: '', length: 10_000, clipped: true })
    expect(long?.clipped).toBe(true)
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

  test('a part is cut as drawn: images made links never take it past the budget', () => {
    const images = Array.from({ length: 30 }, (_, i) => `![${String(i)}](https://x.test/${String(i)}.png)`).join('\n\n')
    const f = file([finished(1, { type: 'question', options: undefined, response: { text: images } })])
    const [entry] = historyOf(f, REPO, 'session-a', NOW)
    const part = entry?.parts[0]
    expect(part?.clipped).toBe(true)
    expect(part?.length).toBe(images.length)
    expect(part?.text.length).toBeLessThanOrEqual(HISTORY_CLIP.part)
    expect(part?.text.startsWith('[Image: 0](https://x.test/0.png)\n\n[Image: 1]')).toBe(true)
  })

  test('a multi-line question is shown on one line, and offered in full', () => {
    const f = file([finished(1, { question: 'Which\nplan?' })])
    const [entry] = historyOf(f, REPO, 'session-a', NOW)
    expect(entry?.question).toBe('Which / plan?')
    expect(entry?.clipped).toBe(true)
    expect(fullOf(f.items[0] as Item).question).toBe('Which\nplan?')
  })
})

describe('blocks: History cuts Markdown only between whole blocks', () => {
  test('a rich answer splits into its blocks; a fence with blank lines and an indented continuation stay whole', () => {
    expect(blocksOf(RICH)).toEqual([
      '## Steps',
      '1. Rotate the **key**\n   - in `prod` first\n   - then *staging*\n2. Tell [ops](https://example.com/ops)',
      '- [x] backed up\n- [ ] announced',
      '> Check the logs first.',
      '```sh\nmake rotate\n\n    echo indented\n```',
      '| Env | Done |\n| --- | ---- |\n| prod | yes |',
      '---\n\n    an indented code block',
    ])
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

  test('an unclosed fence runs to the end; a closing fence must match its mark', () => {
    expect(blocksOf('a\n\n~~~\nx\n\n```\n\ny\n~~~~\n\nz')).toEqual(['a', '~~~\nx\n\n```\n\ny\n~~~~', 'z'])
    expect(blocksOf('```\nno end\n\nstill code')).toEqual(['```\nno end\n\nstill code'])
    // Three backticks with more after them on the line are a code span, not a fence.
    expect(blocksOf('``` a ```\n\nb')).toEqual(['``` a ```', 'b'])
  })
})

describe('forDisplay: the owner\'s rules for drawing Markdown', () => {
  test('rich Markdown with no image or file link is drawn exactly as stored', () => {
    expect(forDisplay(RICH)).toBe(RICH)
  })

  test('an image becomes a link to it, never loaded; an escaped one and one in code are left', () => {
    expect(forDisplay('see ![the logo](https://x.test/a.png "t") and ![](https://x.test/b.png)')).toBe(
      'see [Image: the logo](https://x.test/a.png "t") and [Image: ](https://x.test/b.png)',
    )
    expect(forDisplay('![ref][logo]\n\n[logo]: https://x.test/c.png')).toBe('[Image: ref][logo]\n\n[logo]: https://x.test/c.png')
    expect(forDisplay('\\![not an image](https://x.test)')).toBe('\\![not an image](https://x.test)')
    expect(forDisplay('`![code](x)` and `` ![two](y) ``')).toBe('`![code](x)` and `` ![two](y) ``')
    expect(forDisplay('```md\n![fenced](z)\n```\n![after](w)')).toBe('```md\n![fenced](z)\n```\n[Image: after](w)')
  })

  test('a file link is drawn as text; http and https links are left', () => {
    expect(forDisplay('[a](file:///etc/passwd) [b](<FILE:///x y>) <file:///z> [c]: file:///w')).toBe(
      '[a](#file:///etc/passwd) [b](#&lt;FILE:///x y>) &lt;file:///z> [c]: file:///w',
    )
    expect(forDisplay('[c]: file:///w')).toBe('[c]: #file:///w')
    expect(forDisplay('[h](https://x.test) <http://y.test>')).toBe('[h](https://x.test) <http://y.test>')
  })

  test('line ends become \\n and any other control character but tab is replaced, so the pane is never refused', () => {
    expect(forDisplay('a\r\nb\rc\td\u0000e\u001bf\u0085g')).toBe('a\nb\nc\td\ufffde\ufffdf\ufffdg')
  })
})

describe('deliveryText', () => {
  const answered = (response: Item['response'], type: Item['type'] = 'question') =>
    stored({ id: '01AAAAAAAAAAAAAAAAAAAAANSWR', type, header: 'Plan', status: 'answered', response })

  test('the first line names the item and what was chosen; the free text follows as typed', () => {
    expect(deliveryText(answered({ text: RICH, notes: ' n ' }))).toBe(`humantray HT-ANSWR (Plan): answered\n\nAnswer:\n${RICH}\n\nNotes:\n n `)
    expect(deliveryText(answered({ selected: ['Approve'] }, 'approve'))).toBe('humantray HT-ANSWR (Plan): Approve')
    expect(deliveryText(answered({ selected: [], other: 'x\r\ny' }, 'choice'))).toBe('humantray HT-ANSWR (Plan): Other\n\nOther:\nx\ny')
    expect(deliveryText(answered({ outcome: 'done', notes: '   ' }, 'do'))).toBe('humantray HT-ANSWR (Plan): done')
  })

  test('a header with a line break stays on the first line', () => {
    const item = { ...answered({ acknowledged: true }, 'ack'), header: 'a\nb' }
    expect(deliveryText(item)).toBe('humantray HT-ANSWR (a / b): acknowledged')
  })
})

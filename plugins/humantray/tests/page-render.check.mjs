// The artifact page in a real browser (#33), against a stand-in for the
// page's `db` capability that follows its published types (last-writer-wins
// set, exists, where / orderBy / limit, onSnapshot). Not a plugin test: the
// plugin test kit has no DOM. Run it with Playwright installed:
//
//   node --experimental-strip-types plugins/humantray/tests/page-render.check.mjs
//
// It checks that a rich Markdown body and a rich Markdown answer keep their
// structure, that an answer is stored exactly as typed, the write path (read,
// set with a fresh answer_id, read back, a lost race), and that hostile text
// in every field stays inert. And (#51) that every code block's Copy button
// puts the stored code on the clipboard byte for byte, on each of its routes,
// with the shared fixtures of tests/code-fixtures.ts. Every id here is made up.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PAGE_HTML } from '../page/page.ts'
import { CODE_CASES, RUNBOOK } from './code-fixtures.ts'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const RICH = [
  '# Plan',
  '',
  'Some **bold**, *em*, ~~struck~~ and `code <x>` text, a [link](https://example.com/x "t"), <https://example.com/auto> and https://example.com/bare.',
  '',
  '- [x] done',
  '- [ ] todo',
  '  - nested *one*',
  '    1. deeper',
  '',
  '> a quote',
  '> > nested quote',
  '',
  '| left | right |',
  '|:-----|------:|',
  '| a \\| b | `2` |',
  '',
  '---',
  '',
  '```js',
  'const x = 1 < 2',
  '```',
  '',
  '![a diagram](https://example.com/d.png)',
].join('\n')

const EVIL = '<img src=x onerror="window.__pwned=1">'
const EVIL_MD = [
  EVIL,
  '',
  '[click](javascript:window.__pwned=2) <script>window.__pwned=3</script> [ok](https://example.com/ok)',
  '',
  '![img](javascript:window.__pwned=5) ![remote](https://tracker.example/pixel.png)',
  '',
  '| <b onmouseover=x>h</b> | b |',
  '|---|---|',
  '| <svg onload=window.__pwned=6> | [x](data:text/html,hi) |',
].join('\n')

function stub() {
  window.__store = new Map()
  window.__listeners = []
  window.__writes = []
  window.__raceLoser = false
  window.__failSet = false
  const matches = (data, where) =>
    where.every(([f, op, v]) => (op === '==' ? data[f] === v : op === 'in' ? v.includes(data[f]) : false))
  const snapDoc = path => {
    const data = window.__store.get(path)
    return {
      id: path.split('/').pop(),
      exists: data !== undefined,
      data: () => data && JSON.parse(JSON.stringify(data)),
      metadata: { fromCache: false, hasPendingWrites: false },
    }
  }
  const run = q => {
    let docs = [...window.__store.keys()]
      .filter(p => p.startsWith(`${q.coll}/`) && p.split('/').length === 2)
      .map(p => ({ path: p, data: window.__store.get(p) }))
      .filter(d => matches(d.data, q.where))
    if (q.order) docs.sort((a, b) => (q.order[1] === 'desc' ? -1 : 1) * ((a.data[q.order[0]] ?? 0) - (b.data[q.order[0]] ?? 0)))
    if (q.limit) docs = docs.slice(0, q.limit)
    const snaps = docs.map(d => snapDoc(d.path))
    return { docs: snaps, size: snaps.length, empty: snaps.length === 0, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }
  }
  const notify = () => {
    for (const l of window.__listeners) l()
  }
  window.__notify = notify
  const docRef = path => ({
    id: path.split('/').pop(),
    path,
    get: async () => snapDoc(path),
    set: async data => {
      if (window.__failSet) throw { code: 'unavailable', message: 'the store did not answer' }
      window.__writes.push({ path, data: JSON.parse(JSON.stringify(data)) })
      window.__store.set(path, JSON.parse(JSON.stringify(data)))
      if (window.__raceLoser) window.__store.set(path, { ...data, answer_id: 'someoneelse0000000001' })
      notify()
    },
    onSnapshot: next => {
      const l = () => next(snapDoc(path))
      window.__listeners.push(l)
      setTimeout(l, 0)
      return () => {}
    },
  })
  const query = (coll, where = [], order = null, limit = 0) => ({
    where: (f, op, v) => query(coll, [...where, [f, op, v]], order, limit),
    orderBy: (f, d) => query(coll, where, [f, d || 'asc'], limit),
    limit: n => query(coll, where, order, n),
    get: async () => run({ coll, where, order, limit }),
    onSnapshot: next => {
      const l = () => next(run({ coll, where, order, limit }))
      window.__listeners.push(l)
      setTimeout(l, 0)
      return () => {}
    },
    doc: id => docRef(`${coll}/${id}`),
  })
  window.claude = {
    use: async name =>
      name === 'db' ? { doc: p => docRef(p), collection: c => query(c) } : name === 'user' ? { isOwner: () => true } : null,
  }
}

function seed({ rich, evil, evilMd }) {
  const now = Date.now()
  const S = 'session_FAKEFAKEFAKEFAKEFAKEW001'
  const L = 'session_FAKEFAKEFAKEFAKEFAKELEAD1'
  const base = (id, f) => ({
    schema: 1, id, short: `HT-${id.slice(-5)}`, repo: 'example.com/example/repo', header: 'Header', question: 'Question?',
    body_md: '', key: `k${id}`, created: now - 3600e3, updated: now - 3600e3, bumps: 0, status: 'open', delivered: false,
    session_id: S, session_title: 'worker for #27', parent_session_id: L, lead_session_id: L, writer_version: '0.1.0', ...f,
  })
  const put = (p, d) => window.__store.set(p, d)
  put('meta/page', { schema: 1, kind: 'humantray', repo: 'example.com/example/repo', created_at: now, page_version: 1, plugin_version: '0.1.0' })
  put('items/01TESTPAGE000000000000RICH', base('01TESTPAGE000000000000RICH', { type: 'question', header: 'Plan', question: 'Does this plan read right?', body_md: rich, notes: true }))
  put('items/01TESTPAGE000000000000CHOI', base('01TESTPAGE000000000000CHOI', {
    type: 'choice', header: 'Format', question: 'Which format first?', notes: true,
    options: [{ label: 'TOML', description: 'Small.' }, { label: 'YAML', description: 'Wanted.' }],
  }))
  put('items/01TESTPAGE000000000000SING', base('01TESTPAGE000000000000SING', {
    type: 'choice', header: 'Pick', question: 'One only?',
    options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }],
  }))
  put('items/01TESTPAGE000000000000MULT', base('01TESTPAGE000000000000MULT', {
    type: 'choice', header: 'Many', question: 'Which ones?', multiSelect: true,
    options: [{ label: 'X', description: 'x' }, { label: 'Y', description: 'y' }],
  }))
  put('items/01TESTPAGE000000000000ACKK', base('01TESTPAGE000000000000ACKK', { type: 'ack', header: 'FYI', question: 'Lane finished' }))
  // Answered on a newer page: shown as answered elsewhere, never written over.
  put('items/01TESTPAGE000000000000NEWS', base('01TESTPAGE000000000000NEWS', { type: 'question', header: 'Newer', question: 'Answered on a newer page?' }))
  put('responses/01TESTPAGE000000000000NEWS', { schema: 2, id: '01TESTPAGE000000000000NEWS', answer_id: 'neweranswer000000001', future: true })
  // A response document whose id names another item: no answer for this one.
  put('items/01TESTPAGE000000000000MISM', base('01TESTPAGE000000000000MISM', { type: 'question', header: 'Mismatch', question: 'Mismatched answer?' }))
  put('responses/01TESTPAGE000000000000MISM', {
    schema: 1, id: '01TESTPAGE000000000000WAIT', answer_id: 'mismatchanswer000001', response: { text: 'not mine' },
    status: 'answered', answered_at: now, seen: { bumps: 0, updated: now }, by: 'page',
  })
  // Ids that would be trouble as keys of plain objects.
  for (const [n, weird] of ['__proto__', 'toString', 'disabled', 'constructor'].entries()) {
    const id = '01TESTPAGE00000000000WEIRD' + n
    put('items/' + id, base(id, { type: 'ack', header: 'Weird', question: 'Weird id ' + weird, session_id: weird, lead_session_id: weird, session_title: weird }))
  }
  // Long bodies that a naive scanner takes quadratic time over.
  put('items/01TESTPAGE000000000000SLW1', base('01TESTPAGE000000000000SLW1', { type: 'ack', header: 'Slow', question: 'Stars', body_md: '*a '.repeat(6667) }))
  put('items/01TESTPAGE000000000000SLW2', base('01TESTPAGE000000000000SLW2', { type: 'ack', header: 'Slow', question: 'Unders', body_md: '_a '.repeat(6667) }))
  put('items/01TESTPAGE000000000000TODO', base('01TESTPAGE000000000000TODO', { type: 'do', header: 'Token', question: 'Add the token', created: now - 3 * 86400e3 }))
  put('items/01TESTPAGE000000000000APPR', base('01TESTPAGE000000000000APPR', {
    type: 'approve', header: 'Merge', question: 'Merge it?',
    options: [{ label: 'Approve', description: '' }, { label: 'Reject', description: '' }],
    response_refused: { answer_id: 'refusedanswer000001', reason: 'The item was raised again after this answer was given.', at: now },
  }))
  put('responses/01TESTPAGE000000000000APPR', {
    schema: 1, id: '01TESTPAGE000000000000APPR', answer_id: 'refusedanswer000001', response: { selected: ['Approve'] },
    status: 'answered', answered_at: now, seen: { bumps: 0, updated: now }, by: 'page',
  })
  // Answered with a rich Markdown answer, not yet picked up.
  put('items/01TESTPAGE000000000000WAIT', base('01TESTPAGE000000000000WAIT', { type: 'question', header: 'Review', question: 'Your review?' }))
  put('responses/01TESTPAGE000000000000WAIT', {
    schema: 1, id: '01TESTPAGE000000000000WAIT', answer_id: 'pageanswer0000000001', response: { text: rich },
    status: 'answered', answered_at: now - 7200e3, seen: { bumps: 0, updated: now }, by: 'page',
  })
  // Hostile text in every field.
  put('items/01TESTPAGE000000000000EVIL', base('01TESTPAGE000000000000EVIL', {
    type: 'choice', header: evil, question: evil, body_md: evilMd,
    options: [{ label: evil, description: evil }, { label: 'b', description: 'b' }],
    session_id: `https://evil.example/${evil}`, session_title: evil, lead_session_id: 'javascript:window.__pwned=4',
  }))
  put('items/01TESTPAGE000000000000EVL2', base('01TESTPAGE000000000000EVL2', { type: 'question', header: 'Evil', question: 'Evil answer', status: 'answered',
    response: { text: evilMd, notes: evilMd }, response_at: now - 60e3, delivered: true }))
  // History with a rich answer and notes; a newer row and an unreadable one.
  put('items/01TESTPAGE000000000000DONE', base('01TESTPAGE000000000000DONE', {
    type: 'question', header: 'Name', question: 'What should the flag be called?', status: 'answered',
    response: { text: rich, notes: '> quoted **note**' }, response_at: now - 600e3, delivered: true,
  }))
  put('items/01TESTPAGE000000000000NEWR', { ...base('01TESTPAGE000000000000NEWR', { type: 'ack' }), schema: 2 })
  put('items/01TESTPAGE000000000000BADD', { schema: 1, id: '01TESTPAGE000000000000BADD', status: 'open' })
}

/** The structure a rendering of RICH must keep, read from inside `root`. */
function structureOf(root) {
  const md = root.querySelector('.md')
  if (!md) return null
  const q = s => md.querySelectorAll(s).length
  return {
    h1: md.querySelector('h1')?.textContent,
    strong: md.querySelector('p strong')?.textContent,
    em: md.querySelector('p em')?.textContent,
    del: md.querySelector('p del')?.textContent,
    code: md.querySelector('p code')?.textContent,
    links: [...md.querySelectorAll('a')].map(a => a.getAttribute('href')),
    tasks: [...md.querySelectorAll('li.task > input[type=checkbox]')].map(i => i.checked),
    nestedEm: md.querySelector('ul ul li em')?.textContent,
    deepOl: q('ul ul ol li'),
    quote: md.querySelector('blockquote > p')?.textContent,
    nestedQuote: md.querySelector('blockquote blockquote p')?.textContent,
    th: [...md.querySelectorAll('table th')].map(th => [th.textContent, th.style.textAlign]),
    td: [...md.querySelectorAll('table td')].map(td => td.textContent),
    hr: q('hr'),
    pre: md.querySelector('pre code')?.textContent,
    lang: md.querySelector('pre')?.getAttribute('data-lang'),
    images: q('img'),
    imageLink: md.querySelector('a.img-link')?.textContent,
  }
}

const EXPECTED = {
  h1: 'Plan',
  strong: 'bold',
  em: 'em',
  del: 'struck',
  code: 'code <x>',
  links: ['https://example.com/x', 'https://example.com/auto', 'https://example.com/bare', 'https://example.com/d.png'],
  tasks: [true, false],
  nestedEm: 'one',
  deepOl: 1,
  quote: 'a quote',
  nestedQuote: 'nested quote',
  th: [['left', 'left'], ['right', 'right']],
  td: ['a | b', '2'],
  hr: 1,
  pre: 'const x = 1 < 2',
  lang: 'js',
  images: 0,
  imageLink: 'Image: a diagram',
}

const skeleton =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light}body{margin:0;font:14px sans-serif}[hidden]{display:none!important}</style></head><body>' +
  PAGE_HTML +
  '</body></html>'

const dir = mkdtempSync(join(tmpdir(), 'humantray-page-'))
const file = join(dir, 'page.html')
writeFileSync(file, skeleton)
const browser = await chromium.launch()
try {
  for (const [name, options] of [
    ['desktop, light', { viewport: { width: 1100, height: 1400 }, colorScheme: 'light' }],
    ['phone, dark', { viewport: { width: 390, height: 1600 }, colorScheme: 'dark' }],
    // The desktop app's side panel (#75), in both themes.
    ['side panel, light', { viewport: { width: 420, height: 1600 }, colorScheme: 'light' }],
    ['side panel, dark', { viewport: { width: 420, height: 1600 }, colorScheme: 'dark' }],
  ]) {
    const page = await browser.newPage(options)
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => m.type() === 'error' && errors.push(m.text()))
    page.on('request', r => {
      if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) errors.push(`a request was made: ${r.url()}`)
    })
    await page.addInitScript(stub)
    await page.addInitScript(seed, { rich: RICH, evil: EVIL, evilMd: EVIL_MD })
    await page.goto(`file://${file}`)
    await page.waitForTimeout(200)

    // A rich Markdown body keeps its structure.
    const body = await page.$eval('#card-01TESTPAGE000000000000RICH .body', structureOf)
    assert.deepEqual(body, EXPECTED, `${name}: the rich body`)
    // A rich Markdown answer keeps its structure (waiting for pick-up).
    const waiting = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('section.card')].filter(c => c.textContent.includes('Your review?'))
      return cards.length === 1 ? cards[0].querySelector('.ans') !== null : false
    })
    assert.equal(waiting, true, `${name}: the answered item waits for pick-up`)
    const answer = await page.evaluate(new Function('structureOf', `
      const card = [...document.querySelectorAll('section.card')].find(c => c.textContent.includes('Your review?'))
      return (${structureOf.toString()})(card.querySelector('.ans'))
    `))
    assert.deepEqual(answer, EXPECTED, `${name}: the rich answer`)

    // Hostile text stays text: nothing runs, no element is made from it, no unsafe link, nothing loaded.
    const hostile = await page.evaluate(() => ({
      pwned: window.__pwned,
      imgs: document.querySelectorAll('img, svg, script:not(:first-of-type) , iframe, object, embed').length,
      handlers: [...document.querySelectorAll('#list *')].filter(n => [...n.attributes].some(a => /^on/i.test(a.name))).length,
      hrefs: [...document.querySelectorAll('#list a')].map(a => a.getAttribute('href')),
      shownAsText: document.body.innerText.includes('<img src=x onerror='),
      bTags: document.querySelectorAll('#list b').length,
    }))
    assert.equal(hostile.pwned, undefined, `${name}: no hostile script ran`)
    assert.equal(hostile.handlers, 0, `${name}: no event attribute`)
    assert.equal(hostile.bTags, 0, `${name}: raw HTML made no element`)
    assert.equal(hostile.shownAsText, true, `${name}: raw HTML is shown as text`)
    for (const href of hostile.hrefs) {
      assert.match(href, /^https:\/\/(claude\.ai\/code\/session_[A-Za-z0-9]{20,64}|example\.com\/|tracker\.example\/)/, `${name}: link ${href}`)
    }
    assert.equal(await page.$$eval('#list img', n => n.length), 0, `${name}: no image is loaded`)

    // The page fits the width.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${name}: no sideways scroll`)
    assert.equal(await page.evaluate(() => document.getElementById('notes').innerText.includes('newer humantray')), true)
    assert.equal(await page.evaluate(() => document.body.innerText.includes('Your last answer was not taken')), true)

    // Weird ids are harmless: their cards are drawn, nothing is disabled.
    const weird = await page.evaluate(() => ({
      cards: [...document.querySelectorAll('section.card')].filter(c => c.textContent.includes('Weird id')).length,
      disabled: [...document.querySelectorAll('#list button, #list textarea')].filter(n => n.disabled).length,
    }))
    assert.deepEqual(weird, { cards: 4, disabled: 0 }, `${name}: weird ids`)
    // A newer page's answer: shown as answered elsewhere; no card to answer it.
    assert.equal(await page.$('#card-01TESTPAGE000000000000NEWS'), null, `${name}: the newer answer is not answerable here`)
    assert.equal(await page.evaluate(() => document.body.innerText.includes('Answered on a newer humantray page')), true)
    // A response document naming another item is no answer: the item stays open.
    assert.notEqual(await page.$('#card-01TESTPAGE000000000000MISM'), null, `${name}: a mismatched answer counts as none`)
    // Every redraw is fast, long pathological bodies included.
    const redraw = await page.evaluate(() => {
      const t0 = performance.now()
      window.__notify()
      return performance.now() - t0
    })
    assert.ok(redraw < 750, `${name}: three redraws took ${Math.round(redraw)} ms`)

    // #42: a snapshot while a field has focus keeps that field the same node (a phone keeps its keyboard),
    // while the rest of the list, its own card included, is drawn afresh.
    await page.focus('#f-01TESTPAGE000000000000MISM-text')
    await page.keyboard.type('first ')
    await page.evaluate(() => {
      window.__focused = document.activeElement
      window.__otherCard = document.getElementById('card-01TESTPAGE000000000000ACKK')
      // Another row arrives, and the focused card's own item is raised again (so it also moves to the top).
      window.__store.set('items/01TESTPAGE000000000000FCS1', {
        ...window.__store.get('items/01TESTPAGE000000000000ACKK'), id: '01TESTPAGE000000000000FCS1', short: 'HT-0FCS1', question: 'Arrived while typing',
      })
      window.__store.set('items/01TESTPAGE000000000000MISM', { ...window.__store.get('items/01TESTPAGE000000000000MISM'), bumps: 1, updated: Date.now() })
      window.__notify()
    })
    await page.keyboard.type('second')
    const typing = await page.evaluate(() => {
      const card = document.getElementById('card-01TESTPAGE000000000000MISM')
      return {
        sameNode: document.activeElement === window.__focused,
        attached: document.contains(window.__focused),
        value: window.__focused.value,
        cardFirst: card.closest('.asker').querySelector('section.card') === card,
        raised: card.querySelector('.top').textContent.includes('raised 2×'),
        arrived: document.body.innerText.includes('Arrived while typing'),
        otherRedrawn: document.getElementById('card-01TESTPAGE000000000000ACKK') !== window.__otherCard,
        cards: document.querySelectorAll('#card-01TESTPAGE000000000000MISM').length,
      }
    })
    assert.deepEqual(typing, {
      sameNode: true, attached: true, value: 'first second', cardFirst: true, raised: true, arrived: true, otherRedrawn: true, cards: 1,
    }, `${name}: the focused field is the same node across a snapshot`)
    // The same for Other, deeper in a choice card; picking an option there then clears the Other on the page.
    await page.focus('#f-01TESTPAGE000000000000SING-other')
    await page.keyboard.type('other text')
    await page.evaluate(() => { window.__focused = document.activeElement; window.__notify() })
    assert.equal(await page.evaluate(() => document.activeElement === window.__focused && document.contains(window.__focused)), true,
      `${name}: Other is the same node across a snapshot`)
    await page.check('#o-01TESTPAGE000000000000SING-0')
    assert.equal(await page.inputValue('#f-01TESTPAGE000000000000SING-other'), '', `${name}: picking an option clears Other in a kept card`)
    // The backstop: when the focused field's card goes (answered in another tab), the list is drawn in full.
    await page.evaluate(() => {
      window.__store.set('items/01TESTPAGE000000000000FCS2', {
        ...window.__store.get('items/01TESTPAGE000000000000MISM'), id: '01TESTPAGE000000000000FCS2', short: 'HT-0FCS2', question: 'Answered elsewhere', bumps: 0,
      })
      window.__notify()
    })
    await page.focus('#f-01TESTPAGE000000000000FCS2-text')
    await page.keyboard.type('half typed')
    await page.evaluate(() => {
      const now = Date.now()
      window.__store.set('responses/01TESTPAGE000000000000FCS2', {
        schema: 1, id: '01TESTPAGE000000000000FCS2', answer_id: 'othertabanswer000001', response: { text: 'from the other tab' },
        status: 'answered', answered_at: now, seen: { bumps: 0, updated: now }, by: 'page',
      })
      window.__notify()
    })
    const gone = await page.evaluate(() => ({
      card: document.getElementById('card-01TESTPAGE000000000000FCS2') !== null,
      waiting: [...document.querySelectorAll('section.card')].some(c => c.textContent.includes('Answered elsewhere') && c.textContent.includes('from the other tab')),
      focusInList: document.getElementById('list').contains(document.activeElement),
    }))
    assert.deepEqual(gone, { card: false, waiting: true, focusInList: false }, `${name}: a card answered elsewhere leaves, focus and all`)
    assert.equal(await page.inputValue('#f-01TESTPAGE000000000000MISM-text'), 'first second', `${name}: other drafts are kept`)

    // #42, the reader's findings on PR #43: a focused option is drawn afresh when its item is raised, never kept with
    // its old option. Each case: a choice item, an option clicked (so it has focus), the item raised with new options.
    const opts = labels => labels.map(label => ({ label, description: label.toLowerCase() }))
    const addChoice = (id, labels, multi) => page.evaluate(([id, options, multi]) => {
      const row = { ...window.__store.get('items/01TESTPAGE000000000000SING'), id, short: `HT-${id.slice(-5)}`, question: `Choice ${id.slice(-4)}`, options }
      if (multi) row.multiSelect = true
      window.__store.set(`items/${id}`, row)
      window.__notify()
    }, [id, opts(labels), multi])
    const raise = (id, patch) => page.evaluate(([id, patch]) => {
      const row = window.__store.get(`items/${id}`)
      window.__store.set(`items/${id}`, { ...row, ...patch, bumps: row.bumps + 1, updated: Date.now() })
      window.__notify()
    }, [id, patch])
    const focusedOn = sel => page.evaluate(sel => document.activeElement === document.querySelector(sel), sel)
    const stored = id => page.evaluate(id => window.__writes.filter(w => w.path === `responses/${id}`).map(w => w.data.response).pop(), id)

    // Reordered single select: tap A, the item comes back as B, A; tapping what now reads B stores B.
    const RO = '01TESTPAGE000000000000SNG2'
    await addChoice(RO, ['A', 'B'], false)
    await page.click(`#o-${RO}-0`)
    assert.equal(await focusedOn(`#o-${RO}-0`), true, `${name}: the tapped option has focus`)
    await raise(RO, { options: opts(['B', 'A']) })
    await page.click(`#o-${RO}-0`)
    await page.click(`#card-${RO} button.btn.primary`)
    await page.waitForTimeout(150)
    assert.deepEqual(await stored(RO), { selected: ['B'] }, `${name}: a reordered single select stores what was tapped`)

    // New labels: tap A, the item comes back as C, D; tapping what now reads C stores C.
    const NL = '01TESTPAGE000000000000SNG3'
    await addChoice(NL, ['A', 'B'], false)
    await page.click(`#o-${NL}-0`)
    await raise(NL, { options: opts(['C', 'D']) })
    await page.click(`#o-${NL}-0`)
    await page.click(`#card-${NL} button.btn.primary`)
    await page.waitForTimeout(150)
    assert.deepEqual(await stored(NL), { selected: ['C'] }, `${name}: new labels store the label tapped`)

    // Swapped multi select: tick X, the item comes back as Y, X; only X shows ticked, and unticking Y leaves X picked.
    const SW = '01TESTPAGE000000000000MLT2'
    await addChoice(SW, ['X', 'Y'], true)
    await page.click(`#o-${SW}-0`)
    await raise(SW, { options: opts(['Y', 'X']) })
    const ticks = await page.evaluate(id => [0, 1].map(n => document.getElementById(`o-${id}-${n}`).checked), SW)
    assert.deepEqual(ticks, [false, true], `${name}: a swapped multi select shows only what was ticked`)
    await page.click(`#o-${SW}-0`)
    await page.click(`#o-${SW}-0`)
    await page.click(`#card-${SW} button.btn.primary`)
    await page.waitForTimeout(150)
    assert.deepEqual(await stored(SW), { selected: ['X'] }, `${name}: ticking and unticking Y leaves X picked`)

    // Focus an option, raise the item with new labels: the focused option, restored by id, carries the new label.
    const NF = '01TESTPAGE000000000000MLT3'
    await addChoice(NF, ['X', 'Y'], true)
    await page.click(`#o-${NF}-1`)
    await raise(NF, { options: opts(['P', 'Q']) })
    const restored = await page.evaluate(id => ({
      focus: document.activeElement && document.activeElement.id,
      label: document.activeElement && document.activeElement.getAttribute('data-option'),
      shown: document.activeElement && document.activeElement.closest('label').textContent,
    }), NF)
    assert.deepEqual(restored, { focus: `o-${NF}-1`, label: 'Q', shown: 'Qq' }, `${name}: a focused option is redrawn with its new label`)

    // A kept Other reads the item as it is now: raised from multi to single select, typing in Other unpicks the option.
    const MS = '01TESTPAGE000000000000MLT4'
    await addChoice(MS, ['X', 'Y'], true)
    await page.click(`#o-${MS}-0`)
    await page.focus(`#f-${MS}-other`)
    await page.evaluate(() => { window.__focused = document.activeElement })
    await raise(MS, { multiSelect: false })
    await page.keyboard.type('neither')
    const single = await page.evaluate(id => ({
      kept: document.activeElement === window.__focused,
      kind: document.getElementById(`o-${id}-0`).type,
      ticked: document.getElementById(`o-${id}-0`).checked,
    }), MS)
    assert.deepEqual(single, { kept: true, kind: 'radio', ticked: false }, `${name}: a kept Other follows the raised item's select mode`)
    await page.click(`#card-${MS} button.btn.primary`)
    await page.waitForTimeout(150)
    assert.deepEqual(await stored(MS), { selected: [], other: 'neither' }, `${name}: Other alone is stored`)

    // #75 (the owner's check of 0.2.6 in the desktop side panel): in each theme and at side-panel width, a click
    // on a checkbox or radio itself, or on the label text beside it, picks it; a click on the label again unticks
    // a checkbox; a multi select's Other takes text beside its picks; an approve item takes notes.
    const CK = '01TESTPAGE000000000000CK75'
    await addChoice(CK, ['P', 'Q', 'R'], true)
    await page.click(`#o-${CK}-0`)
    await page.click(`label[for="o-${CK}-1"] span`)
    const boxes = () => page.evaluate(id => [0, 1, 2].map(n => document.getElementById(`o-${id}-${n}`).checked), CK)
    assert.deepEqual(await boxes(), [true, true, false], `${name}: a click on a box, or on its label, ticks it`)
    await page.click(`label[for="o-${CK}-1"] span`)
    assert.deepEqual(await boxes(), [true, false, false], `${name}: a second click on the label unticks it`)
    await page.fill(`#f-${CK}-other`, 'S')
    await page.click(`#card-${CK} button.btn.primary`)
    await page.waitForTimeout(150)
    assert.deepEqual(await stored(CK), { selected: ['P'], other: 'S' }, `${name}: a multi select stores its picks and Other`)
    const RD = '01TESTPAGE000000000000RD75'
    await addChoice(RD, ['P', 'Q'], false)
    await page.click(`#o-${RD}-0`)
    await page.click(`label[for="o-${RD}-1"] span`)
    const radios = await page.evaluate(id => [0, 1].map(n => document.getElementById(`o-${id}-${n}`).checked), RD)
    assert.deepEqual(radios, [false, true], `${name}: a click on a radio, then on another's label, moves the pick`)
    await page.click(`#card-${RD} button.btn.primary`)
    await page.waitForTimeout(150)
    assert.deepEqual(await stored(RD), { selected: ['Q'] }, `${name}: a single select stores its pick`)
    const AP = '01TESTPAGE000000000000AP75'
    await page.evaluate(id => {
      const row = { ...window.__store.get('items/01TESTPAGE000000000000SING'), id, short: `HT-${id.slice(-5)}`, type: 'approve', question: 'Ship it?', notes: true,
        options: [{ label: 'Approve', description: '' }, { label: 'Reject', description: '' }] }
      window.__store.set(`items/${id}`, row)
      window.__notify()
    }, AP)
    await page.fill(`#f-${AP}-notes`, 'Not *yet*')
    await page.click(`#card-${AP} button.btn:not(.primary)`)
    await page.waitForTimeout(150)
    assert.deepEqual(await stored(AP), { selected: ['Reject'], notes: 'Not *yet*' }, `${name}: an approve item's notes are stored with the verdict`)

    if (name === 'desktop, light') {
      // Drafts survive a snapshot: the text, the picked option, the focus and the caret.
      await page.fill('#f-01TESTPAGE000000000000RICH-text', 'a long *Markdown* answer\n\n- one\n- two')
      await page.check('#o-01TESTPAGE000000000000MULT-1')
      await page.focus('#f-01TESTPAGE000000000000RICH-text')
      await page.evaluate(() => document.getElementById('f-01TESTPAGE000000000000RICH-text').setSelectionRange(7, 7))
      await page.evaluate(() => {
        window.__store.set('items/01TESTPAGE000000000000ARRV', {
          ...window.__store.get('items/01TESTPAGE000000000000ACKK'), id: '01TESTPAGE000000000000ARRV', short: 'HT-0ARRV', question: 'Arrived later',
        })
        window.__notify()
      })
      const kept = await page.evaluate(() => ({
        text: document.getElementById('f-01TESTPAGE000000000000RICH-text').value,
        ticked: document.getElementById('o-01TESTPAGE000000000000MULT-1').checked,
        focus: document.activeElement && document.activeElement.id,
        caret: document.activeElement && document.activeElement.selectionStart,
        arrived: document.body.innerText.includes('Arrived later'),
      }))
      assert.deepEqual(kept, {
        text: 'a long *Markdown* answer\n\n- one\n- two', ticked: true, focus: 'f-01TESTPAGE000000000000RICH-text', caret: 7, arrived: true,
      }, 'a snapshot keeps drafts, focus and caret')
      // A draft in one card survives answering another.
      await page.click('#card-01TESTPAGE000000000000ACKK button.btn.primary')
      await page.waitForTimeout(100)
      assert.equal(await page.inputValue('#f-01TESTPAGE000000000000RICH-text'), 'a long *Markdown* answer\n\n- one\n- two', 'answering another card keeps a draft')
      // Notes survive a refused submit.
      await page.fill('#f-01TESTPAGE000000000000CHOI-notes', 'long notes\n\n> kept')
      await page.click('#card-01TESTPAGE000000000000CHOI button.btn.primary')
      await page.waitForTimeout(100)
      assert.equal(await page.$eval('#card-01TESTPAGE000000000000CHOI .status', n => n.textContent), 'Pick an option or fill in Other.')
      assert.equal(await page.inputValue('#f-01TESTPAGE000000000000CHOI-notes'), 'long notes\n\n> kept', 'a refused submit keeps the notes')
      // A failed save keeps the answer to try again with.
      await page.evaluate(() => { window.__failSet = true })
      await page.click('#card-01TESTPAGE000000000000RICH button.btn.primary')
      await page.waitForTimeout(150)
      assert.match(await page.$eval('#card-01TESTPAGE000000000000RICH .status', n => n.textContent), /not saved \(unavailable\)/)
      assert.equal(await page.inputValue('#f-01TESTPAGE000000000000RICH-text'), 'a long *Markdown* answer\n\n- one\n- two', 'a failed save keeps the answer')
      await page.evaluate(() => { window.__failSet = false })
      // Tabs and back keep a draft.
      await page.click('#tab-history')
      await page.click('#tab-open')
      assert.equal(await page.inputValue('#f-01TESTPAGE000000000000RICH-text'), 'a long *Markdown* answer\n\n- one\n- two', 'a tab change keeps a draft')

      // Single-select: typing Other then picking an option stores the option and clears Other.
      await page.fill('#f-01TESTPAGE000000000000SING-other', 'something else')
      await page.check('#o-01TESTPAGE000000000000SING-1')
      assert.equal(await page.inputValue('#f-01TESTPAGE000000000000SING-other'), '', 'picking an option clears Other')
      // ...and picking then typing Other unpicks the option.
      await page.check('#o-01TESTPAGE000000000000SING-0')
      await page.fill('#f-01TESTPAGE000000000000SING-other', 'none of these')
      assert.equal(await page.isChecked('#o-01TESTPAGE000000000000SING-0'), false, 'typing Other unpicks the option')
      await page.check('#o-01TESTPAGE000000000000SING-1')
      await page.click('#card-01TESTPAGE000000000000SING button.btn.primary')
      await page.waitForTimeout(150)
      assert.deepEqual((await page.evaluate(() => window.__writes.find(w => w.path.endsWith('SING')))).data.response, { selected: ['B'] }, 'the picked option is the one stored')
      // The mismatched answer is no answer: this page may answer the item.
      await page.fill('#f-01TESTPAGE000000000000MISM-text', 'mine')
      await page.click('#card-01TESTPAGE000000000000MISM button.btn.primary')
      await page.waitForTimeout(150)
      assert.equal((await page.evaluate(() => window.__writes.find(w => w.path.endsWith('MISM')))).data.response.text, 'mine')

      // An answer is stored exactly as typed, Markdown and surrounding space included.
      const typed = '  ## Looks right\n\n- [x] steps\n- [ ] tests\n\n> ship it  \n'
      await page.fill('#f-01TESTPAGE000000000000RICH-text', typed)
      await page.fill('#f-01TESTPAGE000000000000RICH-notes', '**note**\n')
      await page.click('#card-01TESTPAGE000000000000RICH button.btn.primary')
      await page.waitForTimeout(150)
      const written = await page.evaluate(() => window.__writes.find(w => w.path.endsWith('RICH')))
      assert.deepEqual(written.data.response, { text: typed, notes: '**note**\n' })
      assert.equal(written.data.status, 'answered')
      assert.equal(written.data.by, 'page')
      assert.match(written.data.answer_id, /^[A-Za-z0-9_-]{16,64}$/)
      assert.deepEqual(Object.keys(written.data).sort(), ['answer_id', 'answered_at', 'by', 'id', 'response', 'schema', 'seen', 'status'])
      // A refused answer may be replaced.
      await page.click('#card-01TESTPAGE000000000000APPR button.btn.primary')
      await page.waitForTimeout(150)
      assert.deepEqual((await page.evaluate(() => window.__writes.find(w => w.path.endsWith('APPR')))).data.response, { selected: ['Approve'] })
      // A question with nothing but space is refused on the card; nothing is written.
      await page.fill('#f-01TESTPAGE000000000000CHOI-other', '   ')
      await page.click('#card-01TESTPAGE000000000000CHOI button.btn.primary')
      await page.waitForTimeout(100)
      assert.equal(await page.$eval('#card-01TESTPAGE000000000000CHOI .status', n => n.textContent), 'Pick an option or fill in Other.')
      // A multi-line Other is kept as typed.
      await page.fill('#f-01TESTPAGE000000000000CHOI-other', 'Both:\n\n1. TOML\n2. YAML')
      await page.click('#card-01TESTPAGE000000000000CHOI button.btn.primary')
      await page.waitForTimeout(150)
      assert.deepEqual((await page.evaluate(() => window.__writes.find(w => w.path.endsWith('CHOI')))).data.response, {
        selected: [], other: 'Both:\n\n1. TOML\n2. YAML', notes: 'long notes\n\n> kept',
      })
      // A lost race says so.
      await page.evaluate(() => {
        window.__raceLoser = true
      })
      await page.click('#card-01TESTPAGE000000000000TODO button.btn.primary')
      await page.waitForTimeout(150)
      assert.equal(await page.evaluate(() => document.body.innerText.includes('Another answer was stored first.')), true)
      assert.equal(await page.evaluate(() => document.body.innerText.includes('The stored answer, given')), true)
      // History draws its answers as Markdown too.
      await page.click('#tab-history')
      await page.waitForTimeout(100)
      const history = await page.evaluate(new Function('structureOf', `
        const card = [...document.querySelectorAll('details.card')].find(c => c.textContent.includes('What should the flag be called?'))
        card.open = true
        return { s: (${structureOf.toString()})(card.querySelector('.ans')), note: card.querySelector('.ans blockquote strong')?.textContent }
      `))
      assert.deepEqual(history.s, EXPECTED, 'history: the rich answer')
      assert.equal(history.note, 'note')
    }
    assert.deepEqual(errors, [], `${name}: no errors and no requests`)
    await page.close()
    console.log(`ok: ${name}`)
  }
  await copyChecks(browser)
} finally {
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
}

/** Items for the copy checks: one open `do` per fixture, an answered one and one waiting for pick-up. */
function seedCopy({ cases, runbook }) {
  const now = Date.now()
  const S = 'session_FAKEFAKEFAKEFAKEFAKEW001'
  const base = (id, f) => ({
    schema: 1, id, short: `HT-${id.slice(-5)}`, repo: 'example.com/example/repo', header: 'Copy', question: `Copy ${id}`,
    body_md: '', key: `k${id}`, created: now - 3600e3, updated: now - 3600e3, bumps: 0, status: 'open', delivered: false,
    session_id: S, session_title: 'worker', parent_session_id: null, lead_session_id: null, writer_version: '0.1.0', envelope: 1, ...f,
  })
  const put = (p, d) => window.__store.set(p, d)
  put('meta/page', { schema: 1, kind: 'humantray', repo: 'example.com/example/repo', created_at: now, page_version: 2, plugin_version: '0.1.0' })
  cases.forEach((c, n) => {
    const id = `01TESTCOPY00000000000000${String(n).padStart(2, '0')}`
    put(`items/${id}`, base(id, { type: 'do', body_md: c.md, updated: now - n }))
  })
  // Code in a person's answers: in History (feedback and notes), and waiting for pick-up (the text).
  put('items/01TESTCOPY0000000000000HIST', base('01TESTCOPY0000000000000HIST', {
    type: 'do', status: 'done', body_md: runbook, response: { outcome: 'not_done', feedback: runbook, notes: '```\nnote\tcode\n```' },
    response_at: now - 60e3, delivered: true,
  }))
  put('items/01TESTCOPY0000000000000WAIT', base('01TESTCOPY0000000000000WAIT', { type: 'question', header: 'Ans', question: 'Waiting answer' }))
  put('responses/01TESTCOPY0000000000000WAIT', {
    schema: 1, id: '01TESTCOPY0000000000000WAIT', answer_id: 'copyanswer0000000001', response: { text: 'Ran:\n\n```sh\ncat <<-EOF\n\tx\n\tEOF\n```' },
    status: 'answered', answered_at: now, seen: { bumps: 0, updated: now - 3600e3 }, by: 'page',
  })
}

async function copyChecks(browser) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 1400 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.addInitScript(stub)
  await page.addInitScript(seedCopy, { cases: CODE_CASES, runbook: RUNBOOK })
  await page.goto(`file://${file}`)
  await page.waitForTimeout(200)
  const clip = () => page.evaluate(() => navigator.clipboard.readText())
  const reset = () => page.evaluate(() => Object.getPrototypeOf(navigator.clipboard).writeText.call(navigator.clipboard, '-'))
  const cardOf = n => `#card-01TESTCOPY00000000000000${String(n).padStart(2, '0')}`

  // Every fixture: the drawn code is the stored code, and each offered copy puts exactly it on the clipboard.
  for (const [n, c] of CODE_CASES.entries()) {
    const card = cardOf(n)
    const drawn = await page.$$eval(`${card} .body .code pre code`, nodes => nodes.map(x => x.textContent))
    assert.deepEqual(drawn, c.blocks, `copy: ${c.name}: the drawn code`)
    const offered = c.blocks.flatMap((text, k) => (text === '' || (c.unsafe ?? []).includes(k) ? [] : [text]))
    const count = await page.$$eval(`${card} .body button.copy`, x => x.length)
    assert.equal(count, offered.length, `copy: ${c.name}: one button per block with text and no control character`)
    for (let k = 0; k < count; k++) {
      await reset()
      // Each copy redraws the list: find the button afresh.
      await page.click(`${card} .body button.copy >> nth=${k}`)
      await page.waitForTimeout(30)
      const got = await clip()
      assert.equal(got, offered[k], `copy: ${c.name}: block ${k}`)
      assert.equal(got.includes('\u200b'), false)
    }
    const notes = await page.$$eval(`${card} .code-bar .copied.bad`, nodes => nodes.map(x => x.textContent))
    assert.equal(notes.length, (c.unsafe ?? []).length, `copy: ${c.name}: the control-character note`)
  }

  // "Copied" survives a snapshot redraw; a Copy button pressed by keyboard keeps the focus across one.
  const first = `${cardOf(0)} button.copy`
  await page.focus(first)
  const id = await page.$eval(first, b => b.id)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(30)
  await page.evaluate(() => window.__notify())
  await page.waitForTimeout(50)
  assert.equal(await page.evaluate(() => document.activeElement?.id), id, 'copy: the focus stays on the Copy button across a redraw')
  assert.equal(await page.$eval(`${cardOf(0)} .copied`, x => x.textContent), 'Copied')
  await page.waitForTimeout(2300)
  assert.equal(await page.$$eval(`${cardOf(0)} .copied`, x => x.length), 0, 'copy: "Copied" goes after a while')

  // The clipboard API refused: the copy event carries the same text.
  const tabbed = CODE_CASES.findIndex(c => c.name.startsWith('a <<-EOF'))
  const tabCard = cardOf(tabbed)
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('denied'))
  })
  await reset()
  await page.click(`${tabCard} button.copy`)
  await page.waitForTimeout(50)
  assert.equal(await clip(), CODE_CASES[tabbed].blocks[0], 'copy: the copy-event route copies the stored text')
  assert.equal(await page.$eval(`${tabCard} .copied`, x => x.textContent), 'Copied')

  // Both refused: the code is selected for the person's own copy, exactly; a redraw never claims it still is.
  await page.evaluate(() => {
    document.execCommand = () => false
  })
  await page.click(`${tabCard} button.copy`)
  await page.waitForTimeout(50)
  assert.equal(await page.evaluate(() => window.getSelection().toString()), CODE_CASES[tabbed].blocks[0], 'copy: the selection holds the stored text')
  const said = await page.$eval(`${tabCard} .copied`, x => x.textContent)
  assert.match(said, /^Not copied/)
  await page.evaluate(() => window.__notify())
  await page.waitForTimeout(50)
  const after = await page.$eval(`${tabCard} .copied`, x => x.textContent)
  assert.equal(after, said)
  assert.doesNotMatch(after, /is selected|are selected/, 'copy: the words never claim a selection a redraw dropped')

  // Code in a person's answer: waiting for pick-up, and in History, whose card stays open across the redraw a copy makes.
  await page.evaluate(() => {
    delete navigator.clipboard.writeText
    delete document.execCommand
  })
  await reset()
  await page.click('section.card:has-text("Waiting answer") .ans button.copy')
  await page.waitForTimeout(50)
  assert.equal(await clip(), 'cat <<-EOF\n\tx\n\tEOF', 'copy: code in a waiting answer')
  await page.click('#tab-history')
  await page.waitForTimeout(100)
  await page.click('#history-01TESTCOPY0000000000000HIST summary')
  // The body's 12 blocks, the feedback's 12, and the notes' one.
  assert.equal(await page.$$eval('#history-01TESTCOPY0000000000000HIST button.copy', x => x.length), 25, 'copy: History offers the body and the answer parts')
  await page.click('#history-01TESTCOPY0000000000000HIST button.copy >> nth=24')
  await page.waitForTimeout(50)
  assert.equal(await clip(), 'note\tcode', "copy: code in an answer's notes")
  await page.evaluate(() => window.__notify())
  await page.waitForTimeout(50)
  assert.equal(await page.$eval('#history-01TESTCOPY0000000000000HIST', d => d.open), true, 'copy: the History card stays open')
  await page.click('#history-01TESTCOPY0000000000000HIST button.copy >> nth=13')
  await page.waitForTimeout(50)
  assert.equal(await clip(), CODE_CASES.at(-1).blocks[1], "copy: code in an answer's feedback")

  assert.deepEqual(errors, [], 'copy: no errors')
  await context.close()
  console.log('ok: copy')
}

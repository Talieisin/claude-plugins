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
// in every field stays inert. Every id here is made up.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PAGE_HTML } from '../page/page.ts'

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
  const docRef = path => ({
    id: path.split('/').pop(),
    path,
    get: async () => snapDoc(path),
    set: async data => {
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
    type: 'choice', header: 'Format', question: 'Which format first?',
    options: [{ label: 'TOML', description: 'Small.' }, { label: 'YAML', description: 'Wanted.' }],
  }))
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

    if (name === 'desktop, light') {
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
      assert.deepEqual((await page.evaluate(() => window.__writes.find(w => w.path.endsWith('CHOI')))).data.response, { selected: [], other: 'Both:\n\n1. TOML\n2. YAML' })
      // A lost race says so.
      await page.evaluate(() => {
        window.__raceLoser = true
      })
      await page.click('#card-01TESTPAGE000000000000TODO button.btn.primary')
      await page.waitForTimeout(150)
      assert.equal(await page.evaluate(() => document.body.innerText.includes('Another answer was stored first.')), true)
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
} finally {
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
}

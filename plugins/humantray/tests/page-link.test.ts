// Finding, creating and linking the repository's artifact (#33): only the
// `/humantray-page` command publishes; a hook only links an artifact whose
// meta/page marks it as this repository's humantray.

import { describe, expect, test } from 'claude-code/testing'

import { PAGE_VERSION } from '../hooks/rows'
import { REPO, TITLE, URL_A, URL_B, URL_NEW, artifactWorld, meta } from './artifact-world'
import { MAX_CANDIDATES } from '../hooks/artifact-store'
import { artifactId } from '../hooks/envelope'
import { ADD, COMMAND, START, START_EVENT, answerOf, world } from './world'

const CLOUD = { env: { CLAUDE_CODE_REMOTE: 'true' } }
const RUN = { ...COMMAND, command: 'humantray-page' } as const
const approve = { tool: ADD, type: 'approve', header: 'Merge', question: 'Merge it?' } as const

type On = Parameters<typeof world>[0]
function cloud(on: On, options: Parameters<typeof world>[1] = {}) {
  const w = world(on, { ...CLOUD, ...options })
  const a = artifactWorld(on, { read: path => w.files.get(path) })
  return { w, a }
}

async function settle(w: ReturnType<typeof world>) {
  await w.clock.settle()
  await w.drain()
  await w.clock.settle()
}

const textOf = (ran: unknown) => (ran as { text?: string }).text ?? ''

describe('finding the artifact at session start', () => {
  test('two title matches: the one with the earliest meta/page created_at, whatever the listing order', async ($, on) => {
    const { w, a } = cloud(on)
    a.add(URL_A, TITLE)
    a.add(URL_B, 'HUMANTRAY: Owner/Repo')
    a.put(URL_A, 'meta/page', meta(START - 10))
    a.put(URL_B, 'meta/page', meta(START - 20))
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    expect(a.doc(URL_B, `items/${id}`)).toBeDefined()
    expect(a.doc(URL_A, `items/${id}`)).toBeUndefined()
  })

  test('a title match with no meta/page is never adopted by a hook, and nothing is published', async ($, on) => {
    const { w, a } = cloud(on)
    a.add(URL_A, TITLE)
    await $.session.start(START_EVENT)
    const added = answerOf<{ page: string }>(await $.tool.call(approve))
    await settle(w)
    expect(added.page).toBe('waiting')
    expect(a.writes()).toEqual([])
    expect(a.calls.some(c => c.input.action === 'publish')).toBe(false)
  })

  test('a cached link whose artifact is gone is dropped and found again by title', async ($, on) => {
    const { w, a } = cloud(on, { store: { [`artifact:${REPO}`]: { url: URL_NEW, how: 'created', at: 1 } } })
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', meta(START))
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    expect(a.doc(URL_A, `items/${id}`)).toBeDefined()
  })
})

describe('/humantray-page', () => {
  test('with no artifact: publishes a private page with owner-only rules, no pin, the title set, the watch stopped; links it', async ($, on) => {
    const { w, a } = cloud(on)
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/created a private page/)
    const publish = a.calls.find(c => c.input.action === 'publish')
    expect(publish?.input.capabilities).toEqual({ db: { rules: [{ path: '', read: 'owner', write: 'owner' }] }, user: {} })
    expect(publish?.input).not.toHaveProperty('pin')
    expect(publish?.input.icon).toBe('inbox')
    const made = a.artifacts.find(x => x.url === URL_NEW)
    expect(made?.title).toBe(TITLE)
    expect(made?.html[0]).toContain(`<title>${TITLE}</title>`)
    expect(a.calls.some(c => c.tool === 'ArtifactComments' && c.input.on === false && c.input.url === URL_NEW)).toBe(true)
    expect(a.doc(URL_NEW, 'meta/page')?.data).toMatchObject({ kind: 'humantray', repo: REPO, page_version: PAGE_VERSION })
    // The rules probe was refused, so nothing was left behind.
    expect(a.doc(URL_NEW, 'meta/rules-probe')).toBeUndefined()
    // The copy written for the publish is gone.
    expect([...w.files.keys()].some(path => path.includes('/page-'))).toBe(false)
    // Linked: an add is pushed to it.
    const id = answerOf<{ id: string; page: string }>(await $.tool.call(approve))
    expect(id.page).toBe('queued')
    await settle(w)
    expect(a.doc(URL_NEW, `items/${id.id}`)).toBeDefined()
  })

  test('a page whose rules let editors write is not linked, and the probe is deleted', async ($, on) => {
    const { w, a } = cloud(on)
    a.honourRules = false
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/lets editors write/)
    expect(a.doc(URL_NEW, 'meta/rules-probe')).toBeUndefined()
    expect(answerOf<{ page: string }>(await $.tool.call(approve)).page).toBe('waiting')
    await settle(w)
  })

  test('an unreadable listing creates nothing', async ($, on) => {
    const { a } = cloud(on)
    a.listFails = true
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/could not be read to its end/)
    expect(a.calls.some(c => c.input.action === 'publish')).toBe(false)
  })

  test('a listing over several pages is read to its end before deciding', async ($, on) => {
    const { a } = cloud(on)
    for (let n = 0; n < 250; n++) a.add(`https://claude.ai/artifact/fakeother${String(n).padStart(15, '0')}`, `Other ${n}`)
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', meta(START))
    // The match is listed first (newest), the rest follow on the next page: still read to the end.
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/linked/)
    expect(a.calls.filter(c => c.input.action === 'list').length).toBeGreaterThan(1)
    expect(a.calls.some(c => c.input.action === 'publish')).toBe(false)
  })

  test('a found page of an older page version is republished to the same link', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', meta(START, 0))
    await $.session.start(START_EVENT)
    await $.command.run({ ...RUN, args: '' })
    const publish = a.calls.find(c => c.input.action === 'publish')
    expect(publish?.input.url).toBe(URL_A)
  })

  test('a title match nobody marked as humantray is taken over: republished with the rules, then marked', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_A, TITLE, { ownerOnly: false })
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/took over/)
    expect(a.calls.find(c => c.input.action === 'publish')?.input.url).toBe(URL_A)
    expect(a.artifacts.find(x => x.url === URL_A)?.ownerOnly).toBe(true)
    expect(a.doc(URL_A, 'meta/page')?.data).toMatchObject({ kind: 'humantray', repo: REPO })
  })

  test('a link given to an unmarked page with this repository\'s title: republished there with the title, marked and linked', async ($, on) => {
    const { w, a } = cloud(on)
    a.add(URL_B, 'HUMANTRAY: Owner/Repo')
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: ` ${URL_B} ` })
    expect(textOf(ran)).toMatch(/linked/)
    expect(a.artifacts.find(x => x.url === URL_B)?.title).toBe(TITLE)
    expect(a.doc(URL_B, 'meta/page')).toBeDefined()
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    expect(a.doc(URL_B, `items/${id}`)).toBeDefined()
  })

  test('a relink pushes every item to the new artifact', async ($, on) => {
    const { w, a } = cloud(on)
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', meta(START))
    a.add(URL_B, 'humantray: Owner/Repo')
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    expect(a.doc(URL_A, `items/${id}`)).toBeDefined()
    await $.command.run({ ...RUN, args: URL_B })
    await settle(w)
    expect(a.doc(URL_B, `items/${id}`)).toBeDefined()
    expect(w.store().items[0]?.row?.artifact).toBe(URL_B)
  })

  test('something that is not an artifact link is refused', async ($, on) => {
    const { a } = cloud(on)
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: 'https://example.com/page' })
    expect(textOf(ran)).toMatch(/give an artifact link/)
    expect(a.calls.some(c => c.input.action === 'publish')).toBe(false)
  })

  test('a repository with no remote has no title: the command creates nothing and says how to link', async ($, on) => {
    const { a } = cloud(on, { remote: null })
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/no remote/)
    expect(textOf(ran)).not.toMatch(/humantray-page/)
    expect(a.calls.some(c => c.input.action === 'publish' || c.input.action === 'list')).toBe(false)
  })

  test('a refused publish (a local session) says to run it from a cloud session', async ($, on) => {
    on('tool.call', { tool: 'Artifact' }, (_, e, next) =>
      (e as unknown as { action: string }).action === 'publish'
        ? { deny: "Artifact wasn't run: this call needs a person's approval, and a mod's own call can't ask for it." }
        : next(e),
    )
    const { a } = cloud(on)
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/from a cloud session/)
    expect(a.artifacts).toEqual([])
  })
})

describe('/humantray-page never publishes over a page that is not this repository\'s', () => {
  const FOREIGN_META = { ...meta(START), repo: 'github.com/other/elsewhere' }

  test("a link to another repository's page: refused before any publish, its title untouched", async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, 'humantray: other/elsewhere')
    a.put(URL_B, 'meta/page', FOREIGN_META)
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expect(textOf(ran)).toMatch(/not linked: .*another repository/)
    expect(a.calls.some(c => c.input.action === 'publish')).toBe(false)
    expect(a.artifacts.find(x => x.url === URL_B)?.title).toBe('humantray: other/elsewhere')
  })

  test('a title match whose meta/page is not ours is neither chosen nor taken over: a new page is made', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', { ...meta(START), schema: 2 })
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/created a private page/)
    expect(a.calls.filter(c => c.input.action === 'publish').map(c => c.input.url)).toEqual([undefined])
  })

  test('a republished older page has its meta/page version raised, so a second run publishes nothing', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', { ...meta(START), page_version: 0, future: 'kept' })
    await $.session.start(START_EVENT)
    await $.command.run({ ...RUN, args: '' })
    expect(a.doc(URL_A, 'meta/page')?.data).toMatchObject({ page_version: PAGE_VERSION, created_at: START, future: 'kept' })
    await $.command.run({ ...RUN, args: '' })
    expect(a.calls.filter(c => c.input.action === 'publish')).toHaveLength(1)
  })

  test('every title match is read: the earliest page wins even as the sixth match', async ($, on) => {
    const { w, a } = cloud(on)
    const urls = Array.from({ length: 6 }, (_, n) => `https://claude.ai/artifact/fakematch0000000000${n}`)
    urls.forEach((url, n) => {
      a.add(url, TITLE)
      a.put(url, 'meta/page', meta(START + (n === 5 ? -100 : n)))
    })
    await $.session.start(START_EVENT)
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    // The listing is newest first, so the earliest (added first here... the sixth added) is checked too.
    expect(a.doc(urls[5] ?? '', `items/${id}`)).toBeDefined()
  })

  test('more title matches than can be read: nothing is chosen and nothing is created', async ($, on) => {
    const { a } = cloud(on)
    for (let n = 0; n <= MAX_CANDIDATES; n++) {
      const url = `https://claude.ai/artifact/fakemany00000000000${String(n).padStart(2, '0')}`
      a.add(url, TITLE)
      a.put(url, 'meta/page', meta(START + n))
    }
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/nothing was created/)
    expect(a.calls.some(c => c.input.action === 'publish')).toBe(false)
  })
})

describe('/humantray-page <link> adopts only an artifact meant for this repository\'s humantray (#54)', () => {
  const published = (a: ReturnType<typeof cloud>['a']) => a.calls.filter(c => c.input.action === 'publish')
  const ELSEWHERE = 'Reading list'

  /** Refused, with nothing published or written, and the artifact as it was. */
  function expectRefused(a: ReturnType<typeof cloud>['a'], text: string, pattern: RegExp, url = URL_B, title = ELSEWHERE) {
    expect(text).toMatch(/not linked: /)
    expect(text).toMatch(pattern)
    expect(published(a)).toEqual([])
    expect(a.writes()).toEqual([])
    const art = a.artifacts.find(x => x.url === url)
    if (art !== undefined) expect(art.title).toBe(title)
  }

  test('an unrelated page with no documents is refused: emptiness is no sign it is meant for humantray', async ($, on) => {
    const { w, a } = cloud(on)
    a.add(URL_B, ELSEWHERE)
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expectRefused(a, textOf(ran), /not marked as this repository’s humantray .*humantray: owner\/repo/)
    expect(textOf(ran)).toMatch(/Run \/humantray-page with no link/)
    // Not linked: an add waits for a page.
    expect(answerOf<{ page: string }>(await $.tool.call(approve)).page).toBe('waiting')
    await settle(w)
  })

  test('an unrelated page whose database holds its own data is refused, its data untouched', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, ELSEWHERE)
    a.put(URL_B, 'todos/1', { text: 'buy milk' })
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expectRefused(a, textOf(ran), /not marked as this repository’s humantray/)
    expect(a.doc(URL_B, 'todos/1')).toEqual({ data: { text: 'buy milk' }, version: 1 })
    expect(a.doc(URL_B, 'meta/page')).toBeUndefined()
  })

  test('a link this account cannot find is refused', async ($, on) => {
    const { a } = cloud(on)
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expectRefused(a, textOf(ran), /could not be found from this account/)
    expect(a.artifacts).toEqual([])
  })

  test('a page whose database cannot be read is refused', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, ELSEWHERE)
    await $.session.start(START_EVENT)
    a.garble = 1
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expectRefused(a, textOf(ran), /could not be read/)
  })

  test('a read held for a person (a local session) is refused', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, ELSEWHERE)
    await $.session.start(START_EVENT)
    a.denyOther = true
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expectRefused(a, textOf(ran), /could not be read/)
  })

  test("another repository's page is refused", async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, 'humantray: other/elsewhere')
    a.put(URL_B, 'meta/page', { ...meta(START), repo: 'github.com/other/elsewhere' })
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expectRefused(a, textOf(ran), /another repository/, URL_B, 'humantray: other/elsewhere')
  })

  test("this repository's page written by a newer humantray (schema 2) is refused", async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, TITLE)
    a.put(URL_B, 'meta/page', { ...meta(START), schema: 2 })
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expectRefused(a, textOf(ran), /another repository/, URL_B, TITLE)
    expect(a.doc(URL_B, 'meta/page')?.data.schema).toBe(2)
  })

  test("this repository's page under another title is linked, and not republished when current", async ($, on) => {
    const { w, a } = cloud(on)
    a.add(URL_B, ELSEWHERE)
    a.put(URL_B, 'meta/page', meta(START, PAGE_VERSION))
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expect(textOf(ran)).toMatch(/the page is linked/)
    expect(published(a)).toEqual([])
    const id = answerOf<{ id: string }>(await $.tool.call(approve)).id
    await settle(w)
    expect(a.doc(URL_B, `items/${id}`)).toBeDefined()
  })

  test("this repository's page at an older page version is republished at that link and its meta raised", async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, TITLE)
    a.put(URL_B, 'meta/page', meta(START, 0))
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expect(textOf(ran)).toMatch(/the page is linked/)
    expect(published(a).map(c => c.input.url)).toEqual([URL_B])
    expect(a.doc(URL_B, 'meta/page')?.data).toMatchObject({ page_version: PAGE_VERSION, created_at: START })
    await $.command.run({ ...RUN, args: URL_B })
    expect(published(a)).toHaveLength(1)
  })

  test("an unmarked page with this repository's title is republished with the rules, marked and linked", async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, TITLE, { ownerOnly: false })
    a.put(URL_B, 'notes/1', { text: 'kept' })
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expect(textOf(ran)).toMatch(/the page is linked/)
    expect(published(a).map(c => c.input.url)).toEqual([URL_B])
    expect(a.artifacts.find(x => x.url === URL_B)?.ownerOnly).toBe(true)
    expect(a.doc(URL_B, 'meta/page')?.data).toMatchObject({ kind: 'humantray', repo: REPO })
  })

  test('the same artifact named by its other link form is matched by its id', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, TITLE)
    const other = URL_B.replace('https://claude.ai/artifact/', 'https://claude.ai/code/artifact/')
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: other })
    expect(textOf(ran)).toMatch(/the page is linked/)
    expect(a.artifacts).toHaveLength(1)
    expect(a.doc(URL_B, 'meta/page')?.data).toMatchObject({ repo: REPO })
  })

  test("a listed page with this repository's title whose never-written database reads as missing is adopted", async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, TITLE)
    a.emptyReadsGone = true
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expect(textOf(ran)).toMatch(/the page is linked/)
    expect(published(a).map(c => c.input.url)).toEqual([URL_B])
    expect(a.doc(URL_B, 'meta/page')?.data).toMatchObject({ repo: REPO })
  })

  test('an unlisted page whose database reads as missing is refused as not found', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, ELSEWHERE)
    a.emptyReadsGone = true
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expectRefused(a, textOf(ran), /could not be found from this account/)
  })

  test('a listing that cannot be read to its end refuses: the title is not known to match', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, TITLE)
    await $.session.start(START_EVENT)
    a.listFails = true
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expectRefused(a, textOf(ran), /artifact list could not be read to its end/, URL_B, TITLE)
  })

  test('a repository with no remote: an unmarked link is refused without a listing, and not told to run the bare command', async ($, on) => {
    const { a } = cloud(on, { remote: null })
    a.add(URL_B, TITLE)
    await $.session.start(START_EVENT)
    const before = a.calls.length
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expectRefused(a, textOf(ran), /no remote has no page title/, URL_B, TITLE)
    expect(textOf(ran)).not.toMatch(/Run \/humantray-page/)
    expect(a.calls.slice(before).some(c => c.tool === 'Artifact' && c.input.action === 'list')).toBe(false)
  })
})

describe("the bare command's take-over is unchanged by #54", () => {
  test("a title match whose never-written database reads as missing is still taken over", async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_A, TITLE)
    a.emptyReadsGone = true
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/took over/)
    expect(a.calls.find(c => c.input.action === 'publish')?.input.url).toBe(URL_A)
  })
})

describe('/humantray-page republishes over an existing page on its first run (#58)', () => {
  // The Artifact tool publishes over an existing artifact only once this
  // session has seen its live version; the fake keeps that rule
  // (artifact-world.ts, `seen`). Counts here are of publish attempts: every
  // Artifact publish call, refused or taken.
  const attempts = (a: ReturnType<typeof cloud>['a']) => a.calls.filter(c => c.tool === 'Artifact' && c.input.action === 'publish')
  const reads = (a: ReturnType<typeof cloud>['a']) => a.calls.filter(c => c.tool === 'Artifact' && c.input.action === 'read')
  const probes = (a: ReturnType<typeof cloud>['a']) => a.writes().filter(c => c.input.doc_id === 'rules-probe')
  const metaWrites = (a: ReturnType<typeof cloud>['a']) => a.writes().filter(c => c.input.collection === 'meta' && c.input.doc_id === 'page')

  /** An existing page of this repository at an older page version, which this session has never seen. */
  function olderPage(a: ReturnType<typeof cloud>['a'], url = URL_A) {
    a.add(url, TITLE)
    a.put(url, 'meta/page', meta(START, PAGE_VERSION - 1))
    expect(a.seen.size).toBe(0)
  }

  test('the bare command: the page is read, then published, at the same link, once; its meta/page rises', async ($, on) => {
    const { a } = cloud(on)
    olderPage(a)
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toBe('humantray: the page is linked for this repository.')
    expect(attempts(a)).toHaveLength(1)
    expect(reads(a)).toHaveLength(1)
    // The read is of the publish's link, and comes before it.
    expect(reads(a)[0]?.input.url).toBe(attempts(a)[0]?.input.url)
    expect(a.calls.indexOf(reads(a)[0] as never)).toBeLessThan(a.calls.indexOf(attempts(a)[0] as never))
    expect(a.doc(URL_A, 'meta/page')?.data).toMatchObject({ page_version: PAGE_VERSION })
  })

  test('the command with a link: the same, at that link', async ($, on) => {
    const { a } = cloud(on)
    olderPage(a, URL_B)
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expect(textOf(ran)).toMatch(/the page is linked/)
    expect(attempts(a).map(c => c.input.url)).toEqual([URL_B])
    expect(reads(a).map(c => c.input.url)).toEqual([URL_B])
    expect(a.doc(URL_B, 'meta/page')?.data).toMatchObject({ page_version: PAGE_VERSION })
  })

  for (const as of ['error', 'deny'] as const) {
    test(`a read that fails: the refusal (as ${as === 'error' ? 'an error reply' : 'a deny'}) counts as seen, the page is looked at again, and one retry publishes it; its meta/page rises`, async ($, on) => {
      const { a } = cloud(on)
      olderPage(a)
      a.readFails = true
      a.unviewedAs = as
      await $.session.start(START_EVENT)
      const ran = await $.command.run({ ...RUN, args: '' })
      expect(textOf(ran)).toBe('humantray: the page is linked for this repository.')
      expect(attempts(a)).toHaveLength(2)
      expect(a.artifacts.find(x => x.url === URL_A)?.published).toBe(2)
      expect(a.doc(URL_A, 'meta/page')?.data).toMatchObject({ page_version: PAGE_VERSION })
      expect(a.artifacts.find(x => x.url === URL_A)?.ownerOnly).toBe(true)
    })
  }

  test('a newer humantray publishes between the read and the publish: nothing is published over it; the newer page is linked as it is', async ($, on) => {
    const { a } = cloud(on)
    olderPage(a)
    let once = true
    a.beforePublish = () => {
      if (!once) return
      once = false
      a.publishElsewhere(URL_A, 'page of a newer humantray')
      a.put(URL_A, 'meta/page', meta(START, PAGE_VERSION + 1))
    }
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(attempts(a)).toHaveLength(1)
    expect(a.artifacts.find(x => x.url === URL_A)?.html.at(-1)).toBe('page of a newer humantray')
    expect(a.doc(URL_A, 'meta/page')?.data).toMatchObject({ page_version: PAGE_VERSION + 1 })
    expect(metaWrites(a)).toEqual([])
    expect(probes(a)).toEqual([])
    expect(textOf(ran)).toBe('humantray: the page is linked for this repository.')
  })

  test('the page is marked as something else in between: nothing more is published; the person is told to run it again', async ($, on) => {
    const { a } = cloud(on)
    olderPage(a)
    a.beforePublish = () => {
      a.publishElsewhere(URL_A)
      a.put(URL_A, 'meta/page', { ...meta(START), repo: 'github.com/other/elsewhere' })
    }
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toBe(
      'humantray: found the page, but could not update it: the page changed while it was being updated, so it was not updated. Run /humantray-page again',
    )
    expect(attempts(a)).toHaveLength(1)
    expect(metaWrites(a)).toEqual([])
    expect(probes(a)).toEqual([])
  })

  test('at most one retry: refused again, it stops, with no meta/page raise and no rules check', async ($, on) => {
    const { a } = cloud(on)
    olderPage(a)
    // Another session publishes the same old page version before each attempt,
    // for the first three: a retry loop then gets through on its fourth
    // attempt and this test fails, rather than the file never finishing.
    let elsewhere = 0
    a.beforePublish = () => {
      if (++elsewhere <= 3) a.publishElsewhere(URL_A)
    }
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(attempts(a)).toHaveLength(2)
    expect(textOf(ran)).toMatch(/the page changed while it was being updated, so it was not updated\. Run \/humantray-page again$/)
    expect(textOf(ran)).not.toMatch(/from a cloud session/)
    expect(a.doc(URL_A, 'meta/page')?.data).toMatchObject({ page_version: PAGE_VERSION - 1 })
    expect(metaWrites(a)).toEqual([])
    expect(probes(a)).toEqual([])
  })

  test('meta/page rewritten in between, still ours and behind: the retry publishes, and meta/page is raised against the version read again', async ($, on) => {
    const { a } = cloud(on)
    olderPage(a)
    let once = true
    a.beforePublish = () => {
      if (!once) return
      once = false
      a.publishElsewhere(URL_A)
      a.put(URL_A, 'meta/page', { ...meta(START, PAGE_VERSION - 1), note: 'rewritten' })
    }
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toBe('humantray: the page is linked for this repository.')
    expect(attempts(a)).toHaveLength(2)
    expect(a.doc(URL_A, 'meta/page')).toMatchObject({ version: 3, data: { page_version: PAGE_VERSION, note: 'rewritten' } })
  })

  test('a take-over whose artifact reads as gone and is no longer listed with this title when looked at again: it stops, publishing nothing more', async ($, on) => {
    const { a } = cloud(on)
    const art = a.add(URL_A, TITLE, { ownerOnly: false })
    a.readFails = true
    a.beforePublish = () => {
      a.publishElsewhere(URL_A)
      art.title = 'Something else'
      a.emptyReadsGone = true
    }
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/the page changed while it was being updated, so it was not updated\. Run \/humantray-page again$/)
    expect(attempts(a)).toHaveLength(1)
    expect(metaWrites(a)).toEqual([])
    expect(probes(a)).toEqual([])
  })

  test('the bare take-over of a never-written database (it reads as gone) with a read that fails: still listed, it is taken over on the retry', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_A, TITLE, { ownerOnly: false })
    a.emptyReadsGone = true
    a.readFails = true
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/took over/)
    expect(attempts(a)).toHaveLength(2)
    expect(a.artifacts.find(x => x.url === URL_A)?.ownerOnly).toBe(true)
    expect(a.doc(URL_A, 'meta/page')?.data).toMatchObject({ kind: 'humantray', repo: REPO, page_version: PAGE_VERSION })
  })

  test('a take-over by link of a listed page with this title whose database reads as gone, with a read that fails: taken over on the retry', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_B, TITLE, { ownerOnly: false })
    a.emptyReadsGone = true
    a.readFails = true
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: URL_B })
    expect(textOf(ran)).toMatch(/the page is linked/)
    expect(attempts(a).map(c => c.input.url)).toEqual([URL_B, URL_B])
    expect(a.doc(URL_B, 'meta/page')?.data).toMatchObject({ kind: 'humantray', repo: REPO, page_version: PAGE_VERSION })
  })

  test('no read where nothing is published: a page already current, and a link the #54 guard refuses', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_A, TITLE)
    a.put(URL_A, 'meta/page', meta(START))
    a.add(URL_B, 'Reading list')
    a.put(URL_B, 'meta/page', { ...meta(START), repo: 'github.com/other/elsewhere' })
    await $.session.start(START_EVENT)
    expect(textOf(await $.command.run({ ...RUN, args: '' }))).toMatch(/linked/)
    expect(textOf(await $.command.run({ ...RUN, args: URL_B }))).toMatch(/not linked/)
    expect(reads(a)).toEqual([])
    expect(attempts(a)).toEqual([])
  })

  test('a new artifact: no read and no retry; it counts as seen once published', async ($, on) => {
    const { a } = cloud(on)
    await $.session.start(START_EVENT)
    expect(textOf(await $.command.run({ ...RUN, args: '' }))).toMatch(/created a private page/)
    expect(reads(a)).toEqual([])
    expect(attempts(a)).toHaveLength(1)
    expect(a.seen.get(artifactId(URL_NEW))).toBe(1)
  })

  test('only the unseen-version refusal is looked at again: any other refusal is not retried', async ($, on) => {
    let denied = 0
    on('tool.call', { tool: 'Artifact' }, (_, e, next) => {
      if ((e as unknown as { action: string }).action !== 'publish') return next(e)
      denied++
      return { deny: "Artifact wasn't run: this call needs a person's approval, and a mod's own call can't ask for it." }
    })
    const { a } = cloud(on)
    olderPage(a)
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/from a cloud session/)
    expect(denied).toBe(1)
    expect(reads(a)).toHaveLength(1)
    expect(metaWrites(a)).toEqual([])
  })

  test('a take-over (a title match nobody marked) with a read that fails: looked at again, still unmarked, published once more and marked', async ($, on) => {
    const { a } = cloud(on)
    a.add(URL_A, TITLE, { ownerOnly: false })
    a.readFails = true
    await $.session.start(START_EVENT)
    const ran = await $.command.run({ ...RUN, args: '' })
    expect(textOf(ran)).toMatch(/took over/)
    expect(attempts(a)).toHaveLength(2)
    expect(a.artifacts.find(x => x.url === URL_A)?.ownerOnly).toBe(true)
    expect(a.doc(URL_A, 'meta/page')?.data).toMatchObject({ kind: 'humantray', repo: REPO, page_version: PAGE_VERSION })
  })
})

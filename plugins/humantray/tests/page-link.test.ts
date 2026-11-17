// Finding, creating and linking the repository's artifact (#33): only the
// `/humantray-page` command publishes; a hook only links an artifact whose
// meta/page marks it as this repository's humantray.

import { describe, expect, test } from 'claude-code/testing'

import { PAGE_VERSION } from '../hooks/rows'
import { REPO, TITLE, URL_A, URL_B, URL_NEW, artifactWorld, meta } from './artifact-world'
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

  test('a link given: republished there with the title, marked and linked', async ($, on) => {
    const { w, a } = cloud(on)
    a.add(URL_B, 'Something else')
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
    a.add(URL_B, 'Spare')
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

// The gallery (#68): `/humantray-gallery` opens a pane of fixture cards, one
// of every card type and state, drawn by the real card code on each surface,
// and nothing pressed or typed there reaches the store, the page or a session.

import { type Engine, describe, expect, test } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import type { Item } from '../types'
import { GALLERY, GALLERY_FIXTURES, type GalleryFixture, galleryDraftId } from '../hooks/gallery'
import { dumpTree } from './card-dump'
import { mount } from './surface-rules'
import { SURFACES } from './card-fixtures'
import { COMMAND, PANE, START_EVENT, openOther, stored, world } from './world'

type On = Parameters<typeof world>[0]

const GALLERY_PANE = { ...PANE, requestId: GALLERY, props: { ...PANE.props, title: 'Humantray gallery' } } as const
const GALLERY_COMMAND = { ...COMMAND, command: 'humantray-gallery' } as const

/** A real open item of this session, in the store beside the gallery. */
const REAL = stored({ id: '01AAAAAAAAAAAAAAAAAAAAREAL1', type: 'question', header: 'Real', question: 'A real question' })

type FoundLike = { key?: string; text?: string; props: Record<string, unknown> }

/** A world with a recorder of what would leave the pane: sends and copies (opens are the world's own). */
function galleryWorld(on: On, surface: RenderSurface, options: Parameters<typeof world>[1] = {}) {
  const w = world(on, { surfaces: [surface], ...options })
  const sent: string[] = []
  const copies: string[] = []
  on('session.send', (_, e) => {
    sent.push(e.text)
    return { isDelivered: true as const }
  })
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  return { w, sent, copies }
}

async function openGallery($: Engine, surface: RenderSurface) {
  const ran = (await $.command.run(GALLERY_COMMAND)) as { text?: string }
  const ui = await mount($, { ...GALLERY_PANE, surface })
  return { ran, ui }
}

/** The steps on a real card that give it a fixture's starting draft: its picks, or an empty Submit for the error line. */
function startSteps(fixture: GalleryFixture, id: string): string[] {
  const picks = (fixture.start.selected ?? []).map(label => `${id}:opt:${String((fixture.item.options ?? []).findIndex(o => o.label === label))}`)
  const error = fixture.start.error === undefined ? [] : [`${id}:submit`]
  return [...picks, ...error]
}

/** A fixture as a real item: a stored id, and this session's unless it is the other session's card. */
const asReal = (fixture: GalleryFixture, n: number): Item => ({
  ...fixture.item,
  id: `01${'A'.repeat(19)}GAL${String(n).padStart(2, '0')}`,
  repo: 'github.com/owner/repo',
  session_id: fixture.mine ? 'session-a' : 'session-b',
})

describe('/humantray-gallery', () => {
  test('is registered at the start, opens the gallery pane, and needs no repository or store', async ($, on) => {
    const { w } = galleryWorld(on, 'desktop', { isRepo: false })
    await $.session.start(START_EVENT)
    expect(w.commands).toContain('humantray-gallery')
    const { ran, ui } = await openGallery($, 'desktop')
    expect(ran.text).toBe('Humantray gallery opened: fixture cards only; nothing is stored or sent.')
    expect(w.opened).toEqual([GALLERY])
    for (const fixture of GALLERY_FIXTURES) expect(await ui.find({ key: `${galleryDraftId(fixture.name)}:card` })).toBeDefined()
    expect(w.files.size).toBe(0)
  })

  test('with no surface it opens nothing, as /humantray-open', async ($, on) => {
    const { w } = galleryWorld(on, 'desktop', { surfaces: [] })
    await $.session.start({ ...START_EVENT, surface: null })
    const ran = (await $.command.run(GALLERY_COMMAND)) as { text?: string }
    expect(ran.text).toContain('Humantray gallery opened')
    expect(w.opened).toEqual([])
  })

  test('its fixtures are every card type and state the issue lists', () => {
    const items = GALLERY_FIXTURES.map(f => f.item)
    for (const type of ['ack', 'do', 'approve', 'question', 'choice'] as const) expect(items.some(i => i.type === type)).toBe(true)
    const choices = GALLERY_FIXTURES.filter(f => f.item.type === 'choice')
    expect(choices.map(f => [f.item.multiSelect === true, (f.start.selected ?? []).length > 0])).toEqual([
      [false, false],
      [false, true],
      [true, false],
      [true, true],
      [true, true],
    ])
    // And one with Other open, holding text (#72).
    expect(choices.some(f => f.start.otherOpen === true && (f.start.other ?? '') !== '')).toBe(true)
    expect(items.some(i => i.notes === true)).toBe(true)
    expect(items.some(i => i.body_md.includes('| --- |'))).toBe(true)
    expect(items.some(i => i.body_md.includes('```sh'))).toBe(true)
    expect(items.some(i => i.body_md.includes('```mermaid'))).toBe(true)
    expect(GALLERY_FIXTURES.some(f => (f.start.error ?? '') !== '')).toBe(true)
    expect(GALLERY_FIXTURES.some(f => !f.mine)).toBe(true)
    expect(items.some(i => i.bumps > 0)).toBe(true)
  })
})

describe('the gallery draws every card on each surface with the real card code', () => {
  for (const surface of SURFACES) {
    test(`${surface}: each fixture's label and card`, async ($, on) => {
      galleryWorld(on, surface)
      await $.session.start({ ...START_EVENT, surface })
      const { ui } = await openGallery($, surface)
      for (const fixture of GALLERY_FIXTURES) {
        const id = galleryDraftId(fixture.name)
        const look = (await ui.find({ key: `${id}:look` })) as FoundLike | undefined
        expect(look?.text, fixture.name).toMatch(/^Look for: ./)
        const card = (await ui.find({ key: `${id}:card` })) as FoundLike | undefined
        expect(card?.text, fixture.name).toContain(fixture.item.question)
      }
      await ui.unmount()
    })

    // The gallery's card against the card the real pane draws for the same
    // item and draft. What is compared is what the surface is handed to
    // draw: dumpTree leaves every handler out (a found element carries only a
    // handle number for one), and puts <id> for the card's key (`g:<name>` in
    // the gallery, the item's id in the pane) in every key.
    test(`${surface}: each card is the real pane's card for the same item and draft`, async ($, on) => {
      const { w } = galleryWorld(on, surface)
      const real = GALLERY_FIXTURES.map((fixture, n) => ({ fixture, item: asReal(fixture, n + 1) }))
      w.seed({ version: 1, items: real.map(r => r.item), sessions: {} })
      await $.session.start({ ...START_EVENT, surface })
      const pane = await mount($, { ...PANE, surface })
      for (const { fixture, item } of real) {
        for (const key of startSteps(fixture, item.id)) await pane.press({ key })
        // Other open with text (#72): opened as a person opens it, then typed in.
        if (fixture.start.otherOpen === true) await openOther(pane, item.id)
        if ((fixture.start.other ?? '') !== '') await pane.input({ key: `${item.id}:other`, text: fixture.start.other ?? '', kind: 'change' })
      }
      const { ui } = await openGallery($, surface)
      for (const { fixture, item } of real) {
        const id = galleryDraftId(fixture.name)
        const drawnReal = dumpTree(await pane.find({ key: `${item.id}:card` }), item.id)
        const drawnGallery = dumpTree(await ui.find({ key: `${id}:card` }), id)
        expect(drawnGallery, `${surface} ${fixture.name}`).toBe(drawnReal)
      }
      // Answers in the real pane were refused (the error line's empty
      // Submit), never stored: every real item is still open.
      expect(w.store().items.every(item => item.status === 'open')).toBe(true)
    })
  }
})

describe('nothing in the gallery reaches the store, the page or a session', () => {
  for (const surface of SURFACES) {
    test(`${surface}: every button pressed, every field typed in and Entered`, async ($, on) => {
      const { w, sent, copies } = galleryWorld(on, surface)
      w.seed({ version: 1, items: [REAL], sessions: {} })
      await $.session.start({ ...START_EVENT, surface })
      await w.clock.settle()
      const files = JSON.stringify([...w.files])
      const commits = w.commits
      const kv = JSON.stringify(w.kvAll())
      const submits = [...w.submits]
      const opened = w.opened.length
      const { ui } = await openGallery($, surface)
      expect(w.opened.slice(opened)).toEqual([GALLERY])

      const pressedKeys = new Set<string>()
      const enteredFields = new Set<string>()
      // Two rounds: a press can draw buttons that were not there (the next
      // page of copy buttons), and every field is drawn afresh after Enter.
      for (let round = 0; round < 2; round++) {
        for (const button of (await ui.findAll({ type: 'Button' })) as FoundLike[]) {
          if (button.key === undefined || button.key === 'g:reset') continue
          if ((await ui.find({ key: button.key })) === undefined) continue
          await ui.press({ key: button.key })
          pressedKeys.add(button.key)
        }
        // A field's key carries its card's count of Enters (#48), so each is
        // found again, by its card and name, before each act on it.
        const fieldOf = (key: string) => key.replace(/:\d+$/, '')
        const current = async (field: string) =>
          ((await ui.findAll({ type: 'Input' })) as FoundLike[]).find(one => one.key !== undefined && fieldOf(one.key) === field)?.key
        const fields = ((await ui.findAll({ type: 'Input' })) as FoundLike[]).flatMap(one => (one.key === undefined ? [] : [fieldOf(one.key)]))
        for (const field of fields) {
          const key = await current(field)
          if (key === undefined) continue
          await ui.input({ key, text: 'typed **here**', kind: 'change' })
          await ui.input({ key: (await current(field)) ?? key, text: 'entered' })
          enteredFields.add(field)
        }
      }
      await ui.press({ key: 'g:reset' })
      await w.clock.settle()

      // Every kind of control was pressed: the answer buttons, an option, and,
      // where the surface has no copy control of its own, a copy button and "show the next".
      for (const key of ['g:ack:ack', 'g:do:done', 'g:do:not_done', 'g:approve:approve', 'g:approve:reject', 'g:question:submit', 'g:choice-multi:opt:1']) {
        expect(pressedKeys, key).toContain(key)
      }
      // And Enter in every field of every card, the question's Answer (its Submit) among them.
      for (const fixture of GALLERY_FIXTURES) {
        const id = galleryDraftId(fixture.name)
        const names =
          fixture.item.type === 'do' ? ['feedback'] : fixture.item.type === 'question' ? ['text'] : fixture.item.type === 'choice' ? ['other'] : []
        if (fixture.item.notes === true) names.push('notes')
        for (const name of names) expect(enteredFields, `${id}:${name}`).toContain(`${id}:${name}`)
      }
      if (surface === 'terminal' || surface === 'mobile') {
        expect(pressedKeys).toContain('g:code:copy:1')
        expect(pressedKeys).toContain('g:code:copy:more')
        expect(copies.length).toBeGreaterThan(0)
      }

      expect(JSON.stringify([...w.files])).toBe(files)
      expect(w.commits).toBe(commits)
      expect(JSON.stringify(w.kvAll())).toBe(kv)
      expect(w.submits).toEqual(submits)
      expect(w.received).toEqual([])
      expect(w.appended).toEqual([])
      expect(sent).toEqual([])
      // Opens name the gallery's pane only. (Where a field's Enter puts the
      // focus back, the kit cannot see: its pane never holds the keyboard. The
      // card kit takes the pane's id from its caller, and the gallery passes its own.)
      expect(w.opened.slice(opened)).toEqual([GALLERY])
      // The real item is untouched, and the real pane still draws it.
      expect(w.store().items).toEqual([REAL])
      await ui.unmount()
      const pane = await mount($, { ...PANE, surface })
      expect(await pane.find({ key: `${REAL.id}:card` })).toBeDefined()
    })
  }

  test('a press changes only the gallery: a pick toggles, Submit and Enter are noted under the card, Reset puts every card back', async ($, on) => {
    const { w } = galleryWorld(on, 'desktop')
    await $.session.start(START_EVENT)
    const { ui } = await openGallery($, 'desktop')
    // What an option shows (#75): its mark glyph and its label, in its Button.
    const label = async (key: string) => ((await ui.find({ key })) as FoundLike | undefined)?.text ?? ''
    expect(await label('g:choice-multi:opt:1')).toBe('☐ Green')
    await ui.press({ key: 'g:choice-multi:opt:1' })
    expect(await label('g:choice-multi:opt:1')).toBe('☑ Green')
    // A single choice starts with its pick, and a press moves it.
    expect(await label('g:choice-single-picked:opt:1')).toBe('◉ Green')
    await ui.press({ key: 'g:choice-single-picked:opt:0' })
    expect(await label('g:choice-single-picked:opt:1')).toBe('○ Green')
    expect(await label('g:choice-single-picked:opt:0')).toBe('◉ Blue')

    const note = async (name: string) => ((await ui.find({ key: `g:${name}:pressed` })) as FoundLike | undefined)?.text
    expect(await note('do')).toBeUndefined()
    await ui.press({ key: 'g:do:done' })
    expect(await note('do')).toBe('Pressed: Done. Gallery only: nothing was stored or sent.')
    // Enter in a question's field is its Submit.
    await ui.input({ key: 'g:question:text', text: 'an answer' })
    expect(await note('question')).toBe('Pressed: Submit. Gallery only: nothing was stored or sent.')
    // The note is under the card, not in it, and the card draws no error.
    const card = (await ui.find({ key: 'g:question:card' })) as FoundLike | undefined
    expect(card?.text).not.toContain('Pressed')
    // The error line starts on its card, and typing clears it, as on a real card.
    expect((await ui.find({ key: 'g:error:card' }))?.text).toContain('Type an answer.')
    await ui.input({ key: 'g:error:text', text: 'x', kind: 'change' })
    expect((await ui.find({ key: 'g:error:card' }))?.text).not.toContain('Type an answer.')

    await ui.press({ key: 'g:reset' })
    expect(await note('do')).toBeUndefined()
    expect(await label('g:choice-multi:opt:1')).toBe('☐ Green')
    expect(await label('g:choice-single-picked:opt:1')).toBe('◉ Green')
    expect((await ui.find({ key: 'g:error:card' }))?.text).toContain('Type an answer.')
    expect(w.submits).toEqual([])
  })
})

describe('the labels follow the surface', () => {
  test('no terminal marks on an app surface, and no dim Text inside any Button', async ($, on) => {
    galleryWorld(on, 'desktop', { surfaces: ['terminal', 'desktop', 'vscode', 'mobile'] })
    await $.session.start(START_EVENT)
    await $.command.run(GALLERY_COMMAND)
    for (const surface of SURFACES) {
      const ui = await mount($, { ...GALLERY_PANE, surface })
      const looks = ((await ui.findAll({ type: 'Box' })) as FoundLike[]).filter(t => (t.key ?? '').endsWith(':look')).map(t => t.text ?? '')
      expect(looks).toHaveLength(GALLERY_FIXTURES.length)
      const marks = /\[ \]|\[x\]|\( \)|\(•\)/
      if (surface === 'terminal') expect(looks.some(text => marks.test(text))).toBe(true)
      else for (const text of looks) expect(text, `${surface}: ${text}`).not.toMatch(marks)
      // The gallery's own Button (Reset) holds no child Text at all.
      const reset = (await ui.find({ key: 'g:reset' })) as (FoundLike & { children: unknown[] }) | undefined
      expect(reset?.children ?? []).toEqual([])
      await ui.unmount()
    }
  })
})

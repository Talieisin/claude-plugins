// Markdown in the pane (#40): an item's body and the person's free text are
// drawn with the engine's Markdown element, structure intact, on terminal and
// desktop; free-text fields are several lines tall; what is typed is stored
// exactly; History cuts only between blocks, and any entry can be read whole.

import { describe, expect, test } from 'claude-code/testing'

import { forDrawing } from '../hooks/items'

import { ADD, FILE, PANE, RICH, START_EVENT, answerOf, answerOne, drawnText, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const
const TOGGLE = 'humantray:view'

const OPTIONS = [
  { label: 'Red', description: 'Warm' },
  { label: 'Blue', description: 'Cool' },
]

describe('a rich Markdown body and a rich Markdown answer keep their structure', () => {
  for (const surface of SURFACES) {
    test(`on ${surface}`, async ($, on) => {
      const w = world(on, { surfaces: [surface] })
      await $.session.start(START_EVENT)
      const id = answerOf<{ id: string }>(
        await $.tool.call({ tool: ADD, type: 'question', header: 'Plan', question: 'How?', body_md: RICH, notes: true }),
      ).id
      const ui = await $.ui.mount({ ...PANE, surface })
      // Drawn as stored but for its code, which is drawn as fences of its own, each piece its own Markdown element (#51).
      const body = await drawnText(ui, `${id}:body`)
      expect((await ui.find({ key: `${id}:body:0` }))?.type).toBe('Markdown')
      expect(body).toBe(forDrawing(RICH))
      for (const kept of ['## Steps', '1. Rotate the **key**', '   - in `prod` first', '> Check the logs first.', '| prod | yes |']) {
        expect(String(body)).toContain(kept)
      }
      expect(String(body)).toContain('```sh\nmake rotate\n\n    echo indented\n```')
      // The answer and notes boxes are several lines tall.
      expect((await ui.find({ key: `${id}:text` }))?.props.rows).toBe(3)
      expect((await ui.find({ key: `${id}:notes` }))?.props.rows).toBe(3)

      const notes = '  *see* the log\n'
      await ui.input({ key: `${id}:notes`, text: notes, kind: 'change' })
      await ui.input({ key: `${id}:text`, text: RICH })
      expect(w.store().items[0]?.response).toEqual({ text: RICH, notes })

      await ui.press({ key: TOGGLE })
      // Its code drawn apart: the pieces are Markdown elements.
      expect((await ui.find({ key: `${id}:Answer:0` }))?.type).toBe('Markdown')
      expect(await drawnText(ui, `${id}:Answer`)).toBe(forDrawing(RICH, false))
      expect((await ui.find({ key: `${id}:Notes` }))?.props.text).toBe(notes)
      expect(await ui.find({ type: 'Text', text: 'Answer:' })).toBeDefined()
      // Nothing was shortened, so nothing offers "Show in full".
      expect(await ui.find({ key: `${id}:full` })).toBeUndefined()
      await ui.unmount()
    })
  }
})

describe('free-text fields are several lines tall', () => {
  for (const surface of SURFACES) {
    test(`Other, feedback and notes, on ${surface}`, async ($, on) => {
      world(on, { surfaces: [surface] })
      await $.session.start(START_EVENT)
      const choice = answerOf<{ id: string }>(
        await $.tool.call({ tool: ADD, type: 'choice', header: 'C', question: 'Which?', options: OPTIONS, notes: true }),
      ).id
      const task = answerOf<{ id: string }>(await $.tool.call({ tool: ADD, type: 'do', header: 'D', question: 'Rotate' })).id
      const ui = await $.ui.mount({ ...PANE, surface })
      for (const key of [`${choice}:other`, `${choice}:notes`, `${task}:feedback`]) {
        const field = await ui.find({ key })
        expect(field?.type).toBe('Input')
        expect(field?.props.rows).toBe(3)
      }
      await ui.unmount()
    })
  }
})

describe('typed text is stored exactly', () => {
  test('Other and feedback keep their spaces and line breaks; a blank box is still left out', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const other = '  - one\n  - two\n'
    const picked = await answerOne($, w, 'desktop', { type: 'choice', header: 'C', question: 'Which?', options: OPTIONS }, [
      { change: 'other', text: other },
      { press: 'submit' },
    ])
    expect(picked.response).toEqual({ selected: [], other })
    const feedback = '\n```\nno access\n```\n'
    const task = await answerOne($, w, 'desktop', { type: 'do', header: 'D', question: 'Rotate', notes: true }, [
      { change: 'feedback', text: feedback },
      { change: 'notes', text: ' \n\t ' },
      { press: 'not_done' },
    ])
    expect(task.response).toEqual({ outcome: 'not_done', feedback })
  })
})

describe('the owner\'s rules hold in the pane, and the store is never changed', () => {
  test('an image is drawn as a link, a file link and a tag as text, a control character never blanks the pane', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const body = 'Look: ![chart](https://x.test/c.png)\r\n[local](file:///etc/hosts) <img src=x> and `![code](kept)`\u0007'
    const id = answerOf<{ id: string }>(await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q', body_md: body })).id
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ key: `${id}:body` }))?.props.text).toBe(
      'Look: !\u200b[chart](https://x.test/c.png)\n[local](fil\u200be:///etc/hosts) <\u200bimg src=x> and `!\u200b[code](kept)`\ufffd',
    )
    expect(await ui.find({ key: `${id}:ack` })).toBeDefined()
    await ui.unmount()
    expect(w.store().items[0]?.body_md).toBe(body)
    expect(w.files.get(FILE)).toContain(JSON.stringify(body).slice(1, -1))
  })
})

describe('show in full', () => {
  for (const surface of SURFACES) {
    test(`a long answer is clipped between blocks in the list and drawn whole, with the body, on request, on ${surface}`, async ($, on) => {
      const w = world(on, { surfaces: [surface] })
      await $.session.start(START_EVENT)
      const long = Array.from({ length: 12 }, () => RICH).join('\n\n')
      const item = await answerOne($, w, surface, { type: 'question', header: 'Plan', question: 'How?', body_md: RICH }, [
        { type: 'text', text: long },
      ])
      const ui = await $.ui.mount({ ...PANE, surface })
      await ui.press({ key: TOGGLE })
      const clipped = await drawnText(ui, `${item.id}:Answer`)
      expect(typeof clipped).toBe('string')
      expect(forDrawing(long, false).startsWith(String(clipped))).toBe(true)
      expect(String(clipped).length).toBeLessThanOrEqual(500)
      // Every fence it opens, it closes.
      expect((String(clipped).match(/^```/gm) ?? []).length % 2).toBe(0)

      await ui.press({ key: `${item.id}:full` })
      expect(await drawnText(ui, `${item.id}:full:Answer`)).toBe(forDrawing(long, false))
      expect(await drawnText(ui, `${item.id}:full:body`)).toBe(forDrawing(RICH))
      // The toggle leaves the full view, and coming back shows the list.
      await ui.press({ key: TOGGLE })
      await ui.press({ key: TOGGLE })
      expect(await ui.find({ key: `${item.id}:full:Answer` })).toBeUndefined()
      expect(await ui.find({ key: `${item.id}:Answer` })).toBeDefined()
      await ui.unmount()
    })
  }

  test('an entry gone from the store says so and stays on the list', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const item = await answerOne($, w, 'desktop', { type: 'question', header: 'Plan', question: 'How?' }, [
      { type: 'text', text: Array.from({ length: 12 }, () => RICH).join('\n\n') },
    ])
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: TOGGLE })
    w.seed({ version: 1, items: [], sessions: {} })
    await ui.press({ key: `${item.id}:full` })
    expect(w.toasts).toContain(`${item.short} could not be read from the store`)
    expect(await ui.find({ key: 'humantray:history:back' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('every title and every full view is drawn safely', () => {
  for (const surface of SURFACES) {
    test(`a control character in a header or question never blanks the pane: open card, History, full view, on ${surface}`, async ($, on) => {
      const w = world(on, { surfaces: [surface] })
      await $.session.start(START_EVENT)
      const call = { tool: ADD, type: 'question', header: 'Bell\u0007', question: 'Why\u001b[31m?', body_md: 'Body ![x](https://x.test/x.png)' } as const
      const id = answerOf<{ id: string }>(await $.tool.call(call)).id
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Text', text: '[Bell�] Why�[31m?' })).toBeDefined()
      await ui.input({ key: `${id}:text`, text: `${'word '.repeat(150)}\n\n<img src=x>` })
      expect(w.store().items[0]?.status).toBe('answered')

      await ui.press({ key: TOGGLE })
      expect(await ui.find({ type: 'Text', text: '[Bell�] Why�[31m?' })).toBeDefined()
      await ui.press({ key: `${id}:full` })
      expect(await ui.find({ type: 'Text', text: '[Bell�] Why�[31m?' })).toBeDefined()
      // The full view's body and answer are drawn with the same rules as the list.
      expect((await ui.find({ key: `${id}:full:body` }))?.props.text).toBe('Body !​[x](https://x.test/x.png)')
      expect((await ui.find({ key: `${id}:full:Answer` }))?.props.text).toBe(`${'word '.repeat(150)}\n\n<​img src=x>`)
      await ui.unmount()
      // The store keeps what was given and typed.
      expect(w.store().items[0]?.header).toBe('Bell\u0007')
      expect(w.store().items[0]?.response).toEqual({ text: `${'word '.repeat(150)}\n\n<img src=x>` })
    })
  }

  test('a tray cached by the version before (tray-3, History entries with no parts) is never drawn', async ($, on) => {
    const w = world(on)
    const entry = { id: 'x', short: 'HT-XXXXX', repo: 'r', type: 'question', header: 'Old', question: 'Old?', status: 'answered', answer: 'yes', bumps: 0, at: 0, mark: 'delivered', isMine: true }
    let earlier = false
    on('state.get', { plugin: 'humantray', key: 'tray' }, (_, e, next) =>
      earlier
        ? { value: { value: { shape: 'tray-3', value: { items: [], me: 'session-a', mine: [], history: [entry], repo: 'r' } }, version: 1 } }
        : next(e),
    )
    await $.session.start(START_EVENT)
    await answerOne($, w, 'desktop', { type: 'question', header: 'Plan', question: 'How?' }, [{ type: 'text', text: 'yes' }])
    earlier = true
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: /^No humantray here/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\[Old\]/ })).toBeUndefined()
    await ui.unmount()
    earlier = false
    await $.session.start(START_EVENT)
    const fresh = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await fresh.press({ key: TOGGLE })
    expect(await fresh.find({ type: 'Text', text: '[Plan] How?' })).toBeDefined()
    await fresh.unmount()
  })
})

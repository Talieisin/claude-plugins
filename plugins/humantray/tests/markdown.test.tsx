// Markdown in the pane (#40): an item's body and the person's free text are
// drawn with the engine's Markdown element, structure intact, on terminal and
// desktop; free-text fields are several lines tall; what is typed is stored
// exactly; History cuts only between blocks, and any entry can be read whole.

import { describe, expect, test } from 'claude-code/testing'

import { ADD, FILE, PANE, RICH, START_EVENT, answerOf, answerOne, world } from './world'

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
      const body = await ui.find({ key: `${id}:body` })
      expect(body?.type).toBe('Markdown')
      expect(body?.props.text).toBe(RICH)
      // The answer and notes boxes are several lines tall.
      expect((await ui.find({ key: `${id}:text` }))?.props.rows).toBe(3)
      expect((await ui.find({ key: `${id}:notes` }))?.props.rows).toBe(3)

      const notes = '  *see* the log\n'
      await ui.input({ key: `${id}:notes`, text: notes, kind: 'change' })
      await ui.input({ key: `${id}:text`, text: RICH })
      expect(w.store().items[0]?.response).toEqual({ text: RICH, notes })

      await ui.press({ key: TOGGLE })
      const answer = await ui.find({ key: `${id}:Answer` })
      expect(answer?.type).toBe('Markdown')
      expect(answer?.props.text).toBe(RICH)
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
  test('an image is drawn as a link, a file link as text, a control character never blanks the pane', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    const body = 'Look: ![chart](https://x.test/c.png)\r\n[local](file:///etc/hosts) and `![code](kept)`\u0007'
    const id = answerOf<{ id: string }>(await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q', body_md: body })).id
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ key: `${id}:body` }))?.props.text).toBe(
      'Look: [Image: chart](https://x.test/c.png)\n[local](#file:///etc/hosts) and `![code](kept)`�',
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
      const clipped = (await ui.find({ key: `${item.id}:Answer` }))?.props.text
      expect(typeof clipped).toBe('string')
      expect(long.startsWith(String(clipped))).toBe(true)
      expect(String(clipped).length).toBeLessThanOrEqual(500)
      // Every fence it opens, it closes.
      expect((String(clipped).match(/^```/gm) ?? []).length % 2).toBe(0)

      await ui.press({ key: `${item.id}:full` })
      expect((await ui.find({ key: `${item.id}:full:Answer` }))?.props.text).toBe(long)
      expect((await ui.find({ key: `${item.id}:full:body` }))?.props.text).toBe(RICH)
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

// Drawing only where a surface exists: the pane, the band and the toasts.

import { describe, expect, test } from 'claude-code/testing'

import { ADD, answerOf, BAND, START_EVENT, TURN, stored, world } from './world'

describe('no surface', () => {
  test('a start with no surface opens nothing and toasts nothing; the tools work; a later attach opens the pane', async ($, on) => {
    const w = world(on, { surfaces: [] })
    w.seed({ version: 1, items: [stored({ id: '01AAAAAAAAAAAAAAAAAAAAOPEN1', type: 'ack' })], sessions: {} })
    await $.session.start({ ...START_EVENT, surface: null })
    const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q' })
    expect(added.deny).toBeUndefined()
    expect(w.opened).toEqual([])
    expect(w.toasts).toEqual([])
    w.surfaces = ['desktop']
    await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
    expect(w.opened).toEqual(['humantray'])
  })
})

describe('with a surface', () => {
  test('a start with open items opens the pane; an add toasts and opens it', async ($, on) => {
    const w = world(on)
    w.seed({ version: 1, items: [stored({ id: '01AAAAAAAAAAAAAAAAAAAAOPEN1', type: 'ack' })], sessions: {} })
    await $.session.start(START_EVENT)
    expect(w.opened).toEqual(['humantray'])
    const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q' })
    const short = answerOf<{ short: string }>(added).short
    expect(w.toasts).toEqual([`Humantray: added ${short} (FYI)`])
    await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q' })
    expect(w.toasts.at(-1)).toBe(`Humantray: bumped ${short} (FYI)`)
  })

  test('a toast or a redraw that fails after the write does not turn the add into a failure', async ($, on) => {
    const w = world(on)
    let refuseDraw = false
    on('state.set', { plugin: 'humantray', key: 'tray' }, (_, e, next) => (refuseDraw ? { deny: 'refused' } : next(e)))
    await $.session.start(START_EVENT)
    w.failToast = true
    refuseDraw = true
    const added = await $.tool.call({ tool: ADD, type: 'ack', header: 'FYI', question: 'Q' })
    expect(added.deny).toBeUndefined()
    expect(answerOf<{ bumped: boolean }>(added).bumped).toBe(false)
    expect(w.store().items).toHaveLength(1)
  })

  test('a start with nothing open opens no pane', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    expect(w.opened).toEqual([])
  })
})

describe('the band', () => {
  test('no row with nothing open', async ($, on) => {
    world(on)
    await $.session.start(START_EVENT)
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      expect(await band.find({ type: 'Text', text: /Humantray/ })).toBeUndefined()
      await band.unmount()
    }
  })

  test('"Humantray: N open", and a turn end picks up another session\'s add', async ($, on) => {
    const w = world(on)
    await $.session.start(START_EVENT)
    await $.tool.call({ tool: ADD, type: 'ack', header: 'One', question: 'First' })
    await $.tool.call({ tool: ADD, type: 'do', header: 'Two', question: 'Second' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({ ...BAND, surface })
      expect((await band.find({ type: 'Text', text: /Humantray/ }))?.text).toBe('Humantray: 2 open')
      await band.unmount()
    }
    const file = w.store()
    file.items.push(stored({ id: '01AAAAAAAAAAAAAAAAAAAAOTHER', type: 'ack', session_id: 'session-b' }))
    w.seed(file)
    await $.turn.complete(TURN)
    const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await band.find({ type: 'Text', text: /Humantray/ }))?.text).toBe('Humantray: 3 open')
    await band.unmount()
  })
})

// Copying a code block from the pane (#51): every block of a card's stored
// body has a button that copies it byte for byte, with no U+200B display
// rewrite, through `$.ui.copy`; never a fall back to another clipboard. The
// desktop app and VS Code draw their own copy control, so there no buttons
// and no `Code n` labels are drawn. The viewer's cards are in viewer.test.tsx.

import type { On, RenderSurface } from 'claude-code'
import { type Engine, describe, expect, test } from 'claude-code/testing'

import { codeBlocksOf } from '../hooks/code'
import { forDrawing } from '../hooks/items'
import { COPY_PAGE, copyLabel, hasNativeCopy, unsafeNote } from '../hooks/copy'
import { CODE_CASES, RUNBOOK } from './code-fixtures'
import { ADD, PANE, START_EVENT, answerOf, drawnText, world } from './world'
import { mount } from './surface-rules'

type Copied = { text: string; surface?: string }
type Ran = { argv: string[]; stdin?: string; env?: Record<string, string> }

/**
 * A pane world whose surface clipboard answers as told, and where any
 * clipboard tool (pbcopy and the rest) a copy ran would be recorded.
 */
function copyWorld(
  on: On,
  options: {
    surface?: RenderSurface
    copy?: { isCopied: true } | { isCopied: false; reason: 'no-surface' | 'no-clipboard' | 'refused' }
  } = {},
) {
  const surface = options.surface ?? 'terminal'
  const w = world(on, { surfaces: [surface] })
  const copies: Copied[] = []
  const ran: Ran[] = []
  on('ui.copy', (_, e) => {
    copies.push({ text: e.text, ...(e.surface === undefined ? {} : { surface: e.surface }) })
    return { value: options.copy ?? { isCopied: true } }
  })
  w.runOther = e => {
    // A detached tool runs as `sh -c 'exec <tool> … >/dev/null 2>&1'`: name it by the tool.
    const name = e.argv[0] === 'sh' ? (/^exec (\S+)/.exec(e.argv[2] ?? '')?.[1] ?? 'sh') : (e.argv[0] ?? '')
    if (!['pbcopy', 'wl-copy', 'xclip', 'xsel', 'powershell.exe'].includes(name)) return undefined
    ran.push(e)
    return 0
  }
  return { w, copies, ran, surface }
}

const BODY = '```sh\ncat <<-EOF > /tmp/a\n\tline\n\tEOF\n```'
const TEXT = 'cat <<-EOF > /tmp/a\n\tline\n\tEOF'

async function addDo($: Engine, body: string) {
  return answerOf<{ id: string; short: string }>(await $.tool.call({ tool: ADD, type: 'do', header: 'Part A', question: 'Run part A', body_md: body }))
}

describe('the copy buttons', () => {
  for (const each of CODE_CASES.filter(c => c.blocks.length <= COPY_PAGE)) {
    test(`each copies its block exactly: ${each.name}`, async ($, on) => {
      const { copies, surface } = copyWorld(on)
      await $.session.start(START_EVENT)
      const { id } = await addDo($, each.md)
      const ui = await mount($, { ...PANE, surface })
      for (const [k, text] of each.blocks.entries()) {
        const key = `${id}:copy:${String(k + 1)}`
        const node = await ui.find({ key })
        if (text === '') {
          expect(node).toBeUndefined()
          continue
        }
        if ((each.unsafe ?? []).includes(k)) {
          expect(node).toBeUndefined()
          expect(await ui.find({ type: 'Text', text: `Code block ${String(k + 1)} holds control characters: not offered for copy` })).toBeDefined()
          continue
        }
        expect(node?.type).toBe('Button')
        await ui.press({ key })
        expect(copies.at(-1)).toEqual({ text, surface })
        expect(copies.at(-1)?.text.includes('\u200b')).toBe(false)
      }
      // The drawn body holds each block as stored too, so a surface's own copy is exact (#51).
      const body = (await drawnText(ui, `${id}:body`)) as string
      for (const [k, text] of each.blocks.entries()) {
        if (text !== '' && !(each.unsafe ?? []).includes(k)) expect(body).toContain(text)
      }
      await ui.unmount()
    })
  }

  test('a runbook part: twelve blocks, nine at a time, the rest a press away; each copy exact', async ($, on) => {
    const { w, copies } = copyWorld(on)
    await $.session.start(START_EVENT)
    const { id, short } = await addDo($, RUNBOOK)
    const blocks = codeBlocksOf(RUNBOOK)
    expect(blocks).toHaveLength(12)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    for (let n = 1; n <= 9; n++) expect((await ui.find({ key: `${id}:copy:${String(n)}` }))?.props.label).toBe(copyLabel(blocks[n - 1] as never, n))
    expect(await ui.find({ key: `${id}:copy:10` })).toBeUndefined()
    expect((await ui.find({ key: `${id}:copy:more` }))?.props.label).toBe('Code blocks 1–9 of 12: show the next')
    await ui.press({ key: `${id}:copy:1` })
    expect(copies.at(-1)?.text).toBe(blocks[0]?.text)
    expect(copies.at(-1)?.text).toContain('\tEOF')
    expect(w.toasts.at(-1)).toBe(`Humantray: copied block 1 of ${short} (8 lines)`)
    await ui.press({ key: `${id}:copy:more` })
    expect(await ui.find({ key: `${id}:copy:1` })).toBeUndefined()
    expect((await ui.find({ key: `${id}:copy:more` }))?.props.label).toBe('Code blocks 10–12 of 12: show the next')
    await ui.press({ key: `${id}:copy:12` })
    expect(copies.at(-1)?.text).toBe('{"status":"pushed","step":6,"digest":"sha256:<DIGEST>"}')
    // Past the last page it starts again.
    await ui.press({ key: `${id}:copy:more` })
    expect(await ui.find({ key: `${id}:copy:1` })).toBeDefined()
  })

  test('a label: number, language, first line cut; never the display rewrite', () => {
    expect(copyLabel({ text: '\n  cat <<EOF > /tmp/x\nEOF', lang: 'bash', unsafe: false }, 3)).toBe('Copy 3 · bash · cat <<EOF > /tmp/x')
    expect(copyLabel({ text: 'x'.repeat(60), lang: '', unsafe: false }, 1)).toBe(`Copy 1 · ${'x'.repeat(35)}…`)
    // A language is shown only when it is on the list the drawn fence keeps (decided for the owner on #51).
    expect(copyLabel({ text: 'ls', lang: 'a'.repeat(41), unsafe: false }, 2)).toBe('Copy 2 · ls')
    expect(copyLabel({ text: 'ls', lang: 'x<b>', unsafe: false }, 2)).toBe('Copy 2 · ls')
    expect(copyLabel({ text: 'ls', lang: 'svg', unsafe: false }, 2)).toBe('Copy 2 · ls')
    expect(copyLabel({ text: 'graph TD', lang: 'mermaid', unsafe: false }, 2)).toBe('Copy 2 · mermaid · graph TD')
    expect(copyLabel({ text: 'ls', lang: 'Bash', unsafe: false }, 2)).toBe('Copy 2 · bash · ls')
  })
})

describe('the pane draws each code block as a Markdown element of its own (#51)', () => {
  test('a link definition whose title is left open cannot reach the fence after it', async ($, on) => {
    const { copies } = copyWorld(on)
    await $.session.start(START_EVENT)
    const md = ['[a]: https://example.test "', '', '```sh', 'echo "', '**if this is bold, the code left its fence**', '```'].join('\n')
    const { id } = await addDo($, md)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: `${id}:body` }))?.type).toBe('Box')
    expect((await ui.find({ key: `${id}:body:0` }))?.props.text).toBe('[a]: https://example.test "')
    expect((await ui.find({ key: `${id}:body:1` }))?.props.text).toBe('*Code 1*\n\n```sh\necho "\n**if this is bold, the code left its fence**\n```')
    await ui.press({ key: `${id}:copy:1` })
    expect(copies.at(-1)?.text).toBe('echo "\n**if this is bold, the code left its fence**')
  })
})

describe('where the copy goes', () => {
  test('the terminal: the surface copy; nothing run', async ($, on) => {
    const { w, copies, ran } = copyWorld(on, { surface: 'terminal' })
    await $.session.start(START_EVENT)
    const { id, short } = await addDo($, BODY)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    await ui.press({ key: `${id}:copy:1` })
    expect(copies).toEqual([{ text: TEXT, surface: 'terminal' }])
    expect(ran).toEqual([])
    expect(w.toasts.at(-1)).toBe(`Humantray: copied block 1 of ${short} (3 lines)`)
  })

  test('the terminal with no clipboard: said, with the page to copy from; no tool run', async ($, on) => {
    const { w, ran } = copyWorld(on, { surface: 'terminal', copy: { isCopied: false, reason: 'no-clipboard' } })
    await $.session.start(START_EVENT)
    const { id, short } = await addDo($, BODY)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    await ui.press({ key: `${id}:copy:1` })
    expect(ran).toEqual([])
    expect(w.toasts.at(-1)).toBe(`Humantray: block 1 of ${short} not copied: no-clipboard. Copy it from the humantray page.`)
  })

  test('a phone with no clipboard route: no tool run; the toast says so and points to the page', async ($, on) => {
    const { w, ran } = copyWorld(on, { surface: 'mobile', copy: { isCopied: false, reason: 'no-clipboard' } })
    await $.session.start(START_EVENT)
    const { id, short } = await addDo($, BODY)
    const ui = await mount($, { ...PANE, surface: 'mobile' })
    await ui.press({ key: `${id}:copy:1` })
    expect(ran).toEqual([])
    expect(w.toasts.at(-1)).toBe(`Humantray: block 1 of ${short} not copied: this app has no clipboard route here (no-clipboard). Copy it from the humantray page.`)
  })
})

describe('the desktop app and VS Code draw their own copy control (decided for the owner on #51)', () => {
  test('which surfaces: the desktop app and VS Code; the terminal, a phone and an unknown surface keep the buttons', () => {
    expect(hasNativeCopy('desktop')).toBe(true)
    expect(hasNativeCopy('vscode')).toBe(true)
    for (const surface of ['terminal', 'mobile', 'web', '', undefined]) expect(hasNativeCopy(surface)).toBe(false)
  })

  for (const surface of ['desktop', 'vscode'] as const) {
    test(`${surface}: no copy buttons and no Code n labels; each block drawn exactly as stored`, async ($, on) => {
      copyWorld(on, { surface })
      await $.session.start(START_EVENT)
      const { id } = await addDo($, RUNBOOK)
      const ui = await mount($, { ...PANE, surface })
      expect(await ui.findAll({ type: 'Button', text: 'Copy' })).toEqual([])
      expect(await ui.find({ key: `${id}:copy` })).toBeUndefined()
      expect(await ui.find({ key: `${id}:copy:1` })).toBeUndefined()
      expect(await ui.find({ key: `${id}:copy:more` })).toBeUndefined()
      const body = (await drawnText(ui, `${id}:body`)) as string
      expect(body).not.toMatch(/\*Code \d+\*/)
      for (const block of codeBlocksOf(RUNBOOK)) expect(body).toContain(block.text)
      // The answer's controls are still drawn.
      expect(await ui.find({ key: `${id}:done` })).toBeDefined()
      await ui.unmount()
    })
  }

  test('one block alone (a single Markdown element) loses its label too', async ($, on) => {
    copyWorld(on, { surface: 'desktop' })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, BODY)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    expect((await ui.find({ key: `${id}:body` }))?.props.text).toBe(`\`\`\`sh\n${TEXT}\n\`\`\``)
  })

  test("a person's own `*Code n*` line before a fence in an answer is kept: only labels forDrawing drew are dropped", async ($, on) => {
    const { w } = copyWorld(on, { surface: 'desktop' })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, BODY)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const feedback = 'See below.\n\n*Code 1*\n\n```sh\nls\n```'
    await ui.input({ key: `${id}:feedback`, text: feedback, kind: 'change' })
    await ui.press({ key: `${id}:done` })
    await w.drain()
    await ui.press({ key: 'humantray:view' })
    const drawnPart = (await drawnText(ui, `${id}:Feedback`)) as string
    expect(drawnPart).toBe(forDrawing(feedback, false))
    expect(drawnPart).toContain('*Code 1*')
  })

  for (const surface of ['desktop', 'vscode'] as const) {
    test(`${surface}: a block holding control characters is still named, and the card says the app's copy of it is not exact`, async ($, on) => {
      copyWorld(on, { surface })
      await $.session.start(START_EVENT)
      const { id } = await addDo($, '```\nok\n```\n\n```\na\u0007b\n```')
      const ui = await mount($, { ...PANE, surface })
      expect(await ui.findAll({ type: 'Button', text: 'Copy' })).toEqual([])
      expect(await ui.find({ key: `${id}:copy:1` })).toBeUndefined()
      expect(
        await ui.find({ type: 'Text', text: "Code block 2 holds control characters: the app's copy of it has \ufffd where they were" }),
      ).toBeDefined()
      expect(await drawnText(ui, `${id}:body`)).toContain('a\ufffdb')
    })
  }

  test('the note names three blocks at most and counts the rest: one line however many', () => {
    const tail = ": the app's copy of them has \ufffd where they were"
    expect(unsafeNote([2])).toBe("Code block 2 holds control characters: the app's copy of it has \ufffd where they were")
    expect(unsafeNote([2, 5])).toBe(`Code blocks 2 and 5 hold control characters${tail}`)
    expect(unsafeNote([1, 4, 7])).toBe(`Code blocks 1, 4 and 7 hold control characters${tail}`)
    expect(unsafeNote([3, 7, 12, 13, 14])).toBe(`Code blocks 3, 7, 12 and 2 more hold control characters${tail}`)
    expect(unsafeNote(Array.from({ length: 1_500 }, (_, k) => k + 1)).length).toBeLessThan(120)
  })

  test('the desktop app: several unsafe blocks on one card, one note', async ($, on) => {
    copyWorld(on, { surface: 'desktop' })
    await $.session.start(START_EVENT)
    await addDo($, Array.from({ length: 6 }, (_, k) => `\`\`\`\nx\u0001${String(k)}\n\`\`\``).join('\n\n'))
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    const notes = (await ui.findAll({ type: 'Text' })).filter(t => /control characters/.test(t.text ?? ''))
    expect(notes.map(t => t.text)).toEqual([unsafeNote([1, 2, 3, 4, 5, 6])])
  })

  test('the terminal: a block holding control characters is not offered for copy, as before', async ($, on) => {
    copyWorld(on, { surface: 'terminal' })
    await $.session.start(START_EVENT)
    await addDo($, '```\na\u0007b\n```')
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: 'Code block 1 holds control characters: not offered for copy' })).toBeDefined()
  })

  test('the terminal: the buttons and the labels are drawn', async ($, on) => {
    copyWorld(on, { surface: 'terminal' })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, BODY)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: `${id}:copy:1` }))?.type).toBe('Button')
    expect((await ui.find({ key: `${id}:body` }))?.props.text).toBe(`*Code 1*\n\n\`\`\`sh\n${TEXT}\n\`\`\``)
  })

  test('History\'s "Show in full" on the desktop app: no buttons, no labels', async ($, on) => {
    const { w } = copyWorld(on, { surface: 'desktop' })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, RUNBOOK)
    const ui = await mount($, { ...PANE, surface: 'desktop' })
    await ui.input({ key: `${id}:feedback`, text: 'word '.repeat(200), kind: 'change' })
    await ui.press({ key: `${id}:done` })
    await w.drain()
    await ui.press({ key: 'humantray:view' })
    await ui.press({ key: `${id}:full` })
    expect(await ui.find({ key: `${id}:full:copy:1` })).toBeUndefined()
    const body = (await drawnText(ui, `${id}:full:body`)) as string
    expect(body).not.toMatch(/\*Code \d+\*/)
    expect(body).toContain(codeBlocksOf(RUNBOOK)[0]?.text ?? '-')
  })
})

describe('the card keeps its inner padding on every surface', () => {
  // Steps, which each surface sizes its own way. The terminal and a phone:
  // `sm` all round, which the terminal draws as one cell across and none
  // down, as in 0.2.0. The desktop app and VS Code (the owner's check on
  // 0.2.0): `sm` across and at the top, `md` under the buttons, and a gap
  // under each field. VS Code's table turns the steps into cells.
  const card = {
    terminal: { padding: 'sm' },
    mobile: { padding: 'sm' },
    desktop: { paddingX: 'sm', paddingTop: 'sm', paddingBottom: 'md' },
    vscode: { paddingX: 1, paddingTop: 0, paddingBottom: 1 },
  }
  const field = { terminal: {}, mobile: {}, desktop: { marginBottom: 'sm' }, vscode: { marginBottom: 1 } }
  const spacing = (props: Record<string, unknown> | undefined) =>
    Object.fromEntries(Object.entries(props ?? {}).filter(([name]) => name.startsWith('padding') || name.startsWith('margin')))
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    test(`${surface}: the open card and its field, a History card and "Show in full"`, async ($, on) => {
      const { w } = copyWorld(on, { surface })
      await $.session.start(START_EVENT)
      const { id } = await addDo($, BODY)
      const ui = await mount($, { ...PANE, surface })
      expect(spacing((await ui.find({ key: `${id}:card` }))?.props)).toEqual(card[surface])
      expect((await ui.find({ key: `${id}:card` }))?.props.borderStyle).toBe('round')
      // The gap is under the field, so the Done row does not touch it.
      expect(spacing((await ui.find({ key: `${id}:feedback:field` }))?.props)).toEqual(field[surface])
      expect(spacing((await ui.find({ key: `${id}:outcomes` }))?.props)).toEqual({})
      await ui.input({ key: `${id}:feedback`, text: 'word '.repeat(200), kind: 'change' })
      await ui.press({ key: `${id}:done` })
      await w.drain()
      await ui.press({ key: 'humantray:view' })
      expect(spacing((await ui.find({ key: `${id}:history` }))?.props)).toEqual(card[surface])
      await ui.press({ key: `${id}:full` })
      expect(spacing((await ui.find({ key: `${id}:full` }))?.props)).toEqual(card[surface])
    })
  }

  test('the terminal draws exactly as in 0.2.0: one cell across, none down, no gap under a field', async ($, on) => {
    copyWorld(on, { surface: 'terminal' })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, BODY)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    expect(spacing((await ui.find({ key: `${id}:card` }))?.props)).toEqual({ padding: 'sm' })
    expect(spacing((await ui.find({ key: `${id}:feedback:field` }))?.props)).toEqual({})
  })
})

describe('"Show in full" in History offers the same copies', () => {
  test('from the stored body', async ($, on) => {
    const { w, copies } = copyWorld(on)
    await $.session.start(START_EVENT)
    const { id } = await addDo($, RUNBOOK)
    const ui = await mount($, { ...PANE, surface: 'terminal' })
    // Feedback past what History's list draws, so the entry offers "Show in full".
    await ui.input({ key: `${id}:feedback`, text: 'word '.repeat(200), kind: 'change' })
    await ui.press({ key: `${id}:done` })
    await w.drain()
    await ui.press({ key: 'humantray:view' })
    // The list draws no body, and so no copies.
    expect(await ui.find({ key: `${id}:full:copy:1` })).toBeUndefined()
    await ui.press({ key: `${id}:full` })
    await ui.press({ key: `${id}:full:copy:2` })
    expect(copies.at(-1)?.text).toBe('{"status":"pushed","step":1,"digest":"sha256:<DIGEST>"}')
    await ui.press({ key: `${id}:full:copy:more` })
    await ui.press({ key: `${id}:full:copy:11` })
    expect(copies.at(-1)?.text).toContain('step6')
  })
})

// Copying a code block from the pane (#51): every block of a card's stored
// body has a button that copies it byte for byte, with no U+200B display
// rewrite, through `$.ui.copy`; where the desktop app or VS Code has no copy
// path, through this computer's clipboard tool, given the text on stdin; never
// for a phone or from a cloud session. The viewer's cards are in viewer.test.tsx.

import type { On, RenderSurface } from 'claude-code'
import { type Engine, describe, expect, test } from 'claude-code/testing'

import { codeBlocksOf } from '../hooks/code'
import { COPY_PAGE, clipboardTools, copyLabel } from '../hooks/copy'
import { CODE_CASES, RUNBOOK } from './code-fixtures'
import { ADD, PANE, START_EVENT, answerOf, world } from './world'

type Copied = { text: string; surface?: string }
type Ran = { argv: string[]; stdin?: string; env?: Record<string, string> }

/**
 * A pane world whose surface clipboard answers as told, and whose clipboard
 * tools (pbcopy and the rest) are recorded and answer as told.
 */
function copyWorld(
  on: On,
  options: {
    surface?: RenderSurface
    copy?: { isCopied: true } | { isCopied: false; reason: 'no-surface' | 'no-clipboard' | 'refused' }
    platform?: 'macos' | 'windows' | 'wsl' | 'linux' | 'unknown'
    /** The engine says the session is hosted (its machine is the server). */
    hosted?: boolean
    /** `$.session.info` fails, as an engine without it would. */
    noInfo?: boolean
    tools?: Record<string, number | 'missing'>
    env?: Record<string, string>
  } = {},
) {
  const surface = options.surface ?? 'terminal'
  const w = world(on, { surfaces: [surface], ...(options.env === undefined ? {} : { env: options.env }) })
  const copies: Copied[] = []
  const ran: Ran[] = []
  on('ui.copy', (_, e) => {
    copies.push({ text: e.text, ...(e.surface === undefined ? {} : { surface: e.surface }) })
    return { value: options.copy ?? { isCopied: true } }
  })
  on('session.info', (_, e, next) => {
    if (options.noInfo === true) return { deny: 'no session.info in this engine' }
    return options.platform === undefined ? next(e) : { value: { platform: options.platform, isHosted: options.hosted === true } as never }
  })
  const tools = options.tools ?? {}
  w.runOther = e => {
    // A detached tool runs as `sh -c 'exec <tool> … >/dev/null 2>&1'`: name it by the tool.
    const name = e.argv[0] === 'sh' ? (/^exec (\S+)/.exec(e.argv[2] ?? '')?.[1] ?? 'sh') : (e.argv[0] ?? '')
    if (!['pbcopy', 'wl-copy', 'xclip', 'xsel', 'powershell.exe'].includes(name)) return undefined
    ran.push(e)
    return tools[name] ?? 'missing'
  }
  return { w, copies, ran, surface }
}

async function addDo($: Engine, body: string) {
  return answerOf<{ id: string; short: string }>(await $.tool.call({ tool: ADD, type: 'do', header: 'Part A', question: 'Run part A', body_md: body }))
}

describe('the copy buttons', () => {
  for (const each of CODE_CASES.filter(c => c.blocks.length <= COPY_PAGE)) {
    test(`each copies its block exactly: ${each.name}`, async ($, on) => {
      const { copies, surface } = copyWorld(on)
      await $.session.start(START_EVENT)
      const { id } = await addDo($, each.md)
      const ui = await $.ui.mount({ ...PANE, surface })
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
      const body = (await ui.find({ key: `${id}:body` }))?.props.text as string
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
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
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
    // A language is shown only when it is plain and at most 40 characters, as the drawn fence keeps it.
    expect(copyLabel({ text: 'ls', lang: 'a'.repeat(41), unsafe: false }, 2)).toBe('Copy 2 · ls')
    expect(copyLabel({ text: 'ls', lang: 'x<b>', unsafe: false }, 2)).toBe('Copy 2 · ls')
    expect(copyLabel({ text: 'ls', lang: 'a'.repeat(40), unsafe: false }, 2)).toBe(`Copy 2 · ${'a'.repeat(40)} · ls`)
  })
})

describe('where the copy goes', () => {
  const BODY = '```sh\ncat <<-EOF > /tmp/a\n\tline\n\tEOF\n```'
  const TEXT = 'cat <<-EOF > /tmp/a\n\tline\n\tEOF'

  test('the terminal: the surface copy; nothing run', async ($, on) => {
    const { w, copies, ran } = copyWorld(on, { surface: 'terminal' })
    await $.session.start(START_EVENT)
    const { id, short } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: `${id}:copy:1` })
    expect(copies).toEqual([{ text: TEXT, surface: 'terminal' }])
    expect(ran).toEqual([])
    expect(w.toasts.at(-1)).toBe(`Humantray: copied block 1 of ${short} (3 lines)`)
  })

  test('the terminal with no clipboard: said, with the page to copy from; no tool run', async ($, on) => {
    const { w, ran } = copyWorld(on, { surface: 'terminal', copy: { isCopied: false, reason: 'no-clipboard' }, platform: 'linux', tools: { 'wl-copy': 0 } })
    await $.session.start(START_EVENT)
    const { id, short } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: `${id}:copy:1` })
    expect(ran).toEqual([])
    expect(w.toasts.at(-1)).toBe(`Humantray: block 1 of ${short} not copied: no-clipboard. Copy it from the humantray page.`)
  })

  test('the desktop app on a Mac: no surface path, so pbcopy, with the text on stdin byte for byte and a UTF-8 locale', async ($, on) => {
    const { w, copies, ran } = copyWorld(on, { surface: 'desktop', copy: { isCopied: false, reason: 'no-clipboard' }, platform: 'macos', tools: { pbcopy: 0 } })
    await $.session.start(START_EVENT)
    const { id, short } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:copy:1` })
    expect(copies).toEqual([{ text: TEXT, surface: 'desktop' }])
    expect(ran).toEqual([{ argv: ['pbcopy'], stdin: TEXT, env: { LC_CTYPE: 'UTF-8' } }])
    expect(w.toasts.at(-1)).toBe(`Humantray: copied block 1 of ${short} (3 lines) to this computer's clipboard`)
  })

  test('VS Code on Linux: wl-copy, then xsel, then xclip; the first that runs and exits 0', async ($, on) => {
    const { w, ran } = copyWorld(on, { surface: 'vscode', copy: { isCopied: false, reason: 'no-clipboard' }, platform: 'linux', tools: { 'wl-copy': 'missing', xsel: 1, xclip: 0 } })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
    await ui.press({ key: `${id}:copy:1` })
    expect(ran.map(r => r.argv)).toEqual([
      ['sh', '-c', 'exec wl-copy >/dev/null 2>&1'],
      ['xsel', '--clipboard', '--input'],
      ['sh', '-c', 'exec xclip -selection clipboard >/dev/null 2>&1'],
    ])
    for (const r of ran) expect(r.stdin).toBe(TEXT)
    expect(w.toasts.at(-1)).toContain("to this computer's clipboard")
  })

  test('xclip and wl-copy run with their output sent to /dev/null, so the run ends when the copy is made: the forked server keeps no stream open', () => {
    // xclip's child goes on serving the clipboard; with its streams piped a run
    // that reads to their end waits out its limit and reports a failure though
    // the copy was made (seen under Xvfb: over 3 s piped, 21 ms detached).
    for (const tool of clipboardTools('linux')) {
      if (tool.argv[0] === 'sh') {
        expect(tool.argv[1]).toBe('-c')
        expect(tool.argv[2]).toMatch(/^exec (wl-copy|xclip -selection clipboard) >\/dev\/null 2>&1$/)
      }
    }
  })

  test('a tool that fails (cannot start, or times out) moves on to the next; the toast tells the truth', async ($, on) => {
    const { w, ran } = copyWorld(on, { surface: 'desktop', copy: { isCopied: false, reason: 'no-clipboard' }, platform: 'linux', tools: { 'wl-copy': 'missing', xsel: 'missing', xclip: 'missing' } })
    await $.session.start(START_EVENT)
    const { id, short } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:copy:1` })
    expect(ran).toHaveLength(3)
    expect(w.toasts.at(-1)).toBe(
      `Humantray: block 1 of ${short} not copied: this app has no clipboard route here (no-clipboard), and no clipboard tool ran on this computer. Copy it from the humantray page.`,
    )
  })

  test('a hosted session (its machine is the server, not yours): no tool is run; the toast says why', async ($, on) => {
    const { w, ran } = copyWorld(on, { surface: 'desktop', copy: { isCopied: false, reason: 'no-clipboard' }, platform: 'macos', hosted: true, tools: { pbcopy: 0 } })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:copy:1` })
    expect(ran).toEqual([])
    expect(w.toasts.at(-1)).toContain('this session runs on a hosted server, not your computer')
  })

  test('an engine without $.session.info: no platform, so no tool; nothing throws, and the toast says no tool ran', async ($, on) => {
    const { w, ran } = copyWorld(on, { surface: 'desktop', copy: { isCopied: false, reason: 'no-clipboard' }, noInfo: true, tools: { pbcopy: 0 } })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:copy:1` })
    expect(ran).toEqual([])
    expect(w.toasts.at(-1)).toContain('no clipboard tool ran on this computer')
  })

  test('the desktop app with no clipboard tool at all: said so; nothing claimed', async ($, on) => {
    const { w } = copyWorld(on, { surface: 'desktop', copy: { isCopied: false, reason: 'no-clipboard' }, platform: 'linux' })
    await $.session.start(START_EVENT)
    const { id, short } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:copy:1` })
    expect(w.toasts.at(-1)).toBe(
      `Humantray: block 1 of ${short} not copied: this app has no clipboard route here (no-clipboard), and no clipboard tool ran on this computer. Copy it from the humantray page.`,
    )
  })

  test('a phone: no fall back to the computer, whose clipboard would not reach it; the toast says so', async ($, on) => {
    const { w, ran } = copyWorld(on, { surface: 'mobile', copy: { isCopied: false, reason: 'no-clipboard' }, platform: 'macos', tools: { pbcopy: 0 } })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
    await ui.press({ key: `${id}:copy:1` })
    expect(ran).toEqual([])
    expect(w.toasts.at(-1)).toContain("a copy to the computer's clipboard would not reach your phone, so none was made")
  })

  test('a cloud session drawn in the desktop app: its machine is not the person\'s, so no tool is run', async ($, on) => {
    const { w, ran } = copyWorld(on, {
      surface: 'desktop',
      copy: { isCopied: false, reason: 'no-clipboard' },
      platform: 'linux',
      tools: { 'wl-copy': 0 },
      env: { CLAUDE_CODE_REMOTE: 'true' },
    })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:copy:1` })
    expect(ran).toEqual([])
    expect(w.toasts.at(-1)).toContain('in the cloud')
  })

  test('the desktop app where the surface copy works: no tool is run', async ($, on) => {
    const { ran } = copyWorld(on, { surface: 'desktop', platform: 'macos', tools: { pbcopy: 0 } })
    await $.session.start(START_EVENT)
    const { id } = await addDo($, BODY)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: `${id}:copy:1` })
    expect(ran).toEqual([])
  })

  test('the tools by platform', () => {
    expect(clipboardTools('macos').map(t => t.argv[0])).toEqual(['pbcopy'])
    expect(clipboardTools('linux').map(t => t.argv.join(' '))).toEqual([
      'sh -c exec wl-copy >/dev/null 2>&1',
      'xsel --clipboard --input',
      'sh -c exec xclip -selection clipboard >/dev/null 2>&1',
    ])
    expect(clipboardTools('windows')[0]?.argv.at(-1)).toContain('Set-Clipboard -Value ([Console]::In.ReadToEnd())')
    expect(clipboardTools('wsl')[0]?.argv[0]).toBe('powershell.exe')
    expect(clipboardTools('unknown')).toEqual([])
  })
})

describe('"Show in full" in History offers the same copies', () => {
  test('from the stored body', async ($, on) => {
    const { w, copies } = copyWorld(on)
    await $.session.start(START_EVENT)
    const { id } = await addDo($, RUNBOOK)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
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

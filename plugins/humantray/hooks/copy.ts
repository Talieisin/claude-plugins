// Copying a code block from the pane and the viewer (#51).
//
// The text is always the stored block (`codeBlocksOf`, code.ts), never what
// the pane draws. It goes to the clipboard of the surface the press came
// from, with `$.ui.copy`: on the terminal the machine's clipboard tool and
// OSC 52. In this engine a remote surface has no copy path yet, so a press
// from the desktop app or VS Code, which draw a session running on this
// computer, falls back to this computer's own clipboard tool (`pbcopy`,
// `wl-copy`, `xclip`, `xsel`, or PowerShell's `Set-Clipboard`), given the
// text on standard input with no shell. Never from a cloud session, whose
// machine is not the person's, and never for a phone, where this computer's
// clipboard would not reach the person: the toast says so, and points to the
// humantray page, whose copy works there.

import type { EngineInterface, RenderSurface } from 'claude-code'

import type { CodeBlock } from './code'
import { clip, plain } from './items'
import { isCloud } from './store-pass'

/** Copy buttons drawn at once on one card; more are paged (`Code blocks 10–18 of 25: show the next`). */
export const COPY_PAGE = 9

/** How a copy went: to the surface's clipboard, to this computer's by its tool, or not at all, and why. */
export type CopyOutcome = { ok: true; via: 'surface' | 'tool' } | { ok: false; why: string }

/** A copy button's label: its number among the card's blocks, the language, and the first line, cut. */
export const copyLabel = (block: CodeBlock, n: number): string => {
  const first = block.text.split('\n').find(line => line.trim() !== '') ?? ''
  const shown = clip(plain(first.trim()).replace(/\t/g, ' '), 48)
  return [`Copy ${String(n)}`, ...(block.lang === '' ? [] : [plain(block.lang)]), ...(shown === '' ? [] : [shown])].join(' · ')
}

/** The toast after a copy. */
export const copyToast = (outcome: CopyOutcome, block: CodeBlock, n: number, short: string): string => {
  const lines = block.text.split('\n').length
  const what = `block ${String(n)} of ${short}`
  if (outcome.ok) {
    const size = `${String(lines)} ${lines === 1 ? 'line' : 'lines'}`
    return outcome.via === 'tool' ? `Humantray: copied ${what} (${size}) to this computer's clipboard` : `Humantray: copied ${what} (${size})`
  }
  return `Humantray: ${what} not copied: ${outcome.why}. Copy it from the humantray page.`
}

type Tool = { argv: string[]; env?: Record<string, string> }

/** The clipboard tools to try on this computer, in order. */
export const clipboardTools = (platform: string | undefined): Tool[] => {
  const powershell = (exe: string): Tool => ({
    argv: [
      exe,
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())',
    ],
  })
  if (platform === 'macos') return [{ argv: ['pbcopy'], env: { LC_CTYPE: 'UTF-8' } }]
  if (platform === 'windows') return [powershell('powershell.exe')]
  if (platform === 'wsl') return [powershell('powershell.exe')]
  if (platform === 'linux') return [{ argv: ['wl-copy'] }, { argv: ['xclip', '-selection', 'clipboard'] }, { argv: ['xsel', '--clipboard', '--input'] }]
  return []
}

/** Copies with this computer's clipboard tool: the first that runs and exits 0. */
async function copyByTool($: EngineInterface, text: string): Promise<boolean> {
  let platform: string | undefined
  try {
    platform = (await $.session.info()).platform
  } catch {
    platform = undefined
  }
  for (const tool of clipboardTools(platform)) {
    try {
      const ran = await $.process.run(tool.argv, { stdin: text, timeoutMs: 5_000, ...(tool.env === undefined ? {} : { env: tool.env }) })
      if (ran.exitCode === 0) return true
    } catch {
      // Not on this computer, or it hung: try the next.
    }
  }
  return false
}

/**
 * Copies one block's stored text for a press from `surface`. Refuses a block
 * holding control characters (`CodeBlock.unsafe`), which is never offered.
 */
export async function copyBlock($: EngineInterface, surface: RenderSurface | undefined, block: CodeBlock): Promise<CopyOutcome> {
  if (block.unsafe) return { ok: false, why: 'it holds control characters' }
  let reason: string
  try {
    const copied = await $.ui.copy({ text: block.text, ...(surface === undefined ? {} : { surface }) })
    if (copied.isCopied) return { ok: true, via: 'surface' }
    reason = copied.reason
  } catch (error) {
    reason = String(error)
  }
  if (surface === 'mobile') {
    return { ok: false, why: `this app has no clipboard route here (${reason}), and a copy to the computer's clipboard would not reach your phone, so none was made` }
  }
  if (surface !== 'desktop' && surface !== 'vscode') return { ok: false, why: reason }
  if (await isCloud($)) {
    return { ok: false, why: `this app has no clipboard route here (${reason}), and this session's machine is in the cloud, not yours` }
  }
  if (await copyByTool($, block.text)) return { ok: true, via: 'tool' }
  return { ok: false, why: `this app has no clipboard route here (${reason}), and no clipboard tool ran on this computer` }
}

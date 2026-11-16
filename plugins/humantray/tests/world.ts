// A small world for the humantray tests. The test kit has no disk, no
// processes and no session, so every `$` call the mod makes is answered here
// from memory: a repository at /repo with its git directory at /repo/.git,
// the commands the store runs (git rev-parse, mkdir, mv, rm, rmdir), the
// files it reads and writes, the session's id and surfaces, and the engine's
// prompt queue. Each hook here sits beneath the plugin and stands for the engine.

import type { On, PromptSubmitInput, PromptSubmitResult, RenderSurface } from 'claude-code'
import { type Engine, mock } from 'claude-code/testing'

import type { Item, StoreFile } from '../types'

export const ROOT = '/repo'
export const GIT = '/repo/.git'
export const DIR = `${GIT}/humantray`
export const FILE = `${DIR}/items.json`
export const LOCK = `${DIR}/items.lock`
export const START = 1_800_000_000_000
export const HOUR = 60 * 60 * 1000

export type World = {
  files: Map<string, string>
  dirs: Map<string, number>
  sessionId: string
  surfaces: RenderSurface[]
  isRepo: boolean
  /** Every prompt the mod submitted, in order. */
  submits: string[]
  /** How the engine answers a submit; by default the prompt enters. */
  answerSubmit: (e: PromptSubmitInput) => PromptSubmitResult | Promise<PromptSubmitResult>
  /** A hook to run inside each submit, before it answers (to look at the disk). */
  duringSubmit: (e: PromptSubmitInput) => void
  failMoveOfTemporary: boolean
  /** Every rename of the lock directory that succeeded. */
  lockRenames: number
  toasts: string[]
  opened: string[]
  argv: string[][]
  clock: ReturnType<typeof mock.clock>
  /** The store as it is on the disk now. */
  store: () => StoreFile
  /** Puts a store file on the disk as given. */
  seed: (file: StoreFile | string) => void
  /**
   * Lets the deliveries no hook waits on finish: their settling takes the lock,
   * whose retries sleep on the mocked clock, so the clock moves half a second.
   */
  drain: () => Promise<void>
}

export const START_EVENT = { cwd: ROOT, surface: 'desktop', isInteractive: true } as const

export function world(on: On, options: { sessionId?: string; surfaces?: RenderSurface[]; isRepo?: boolean } = {}): World {
  const clock = mock.clock(on, { now: START })
  mock.store(on)
  const w: World = {
    files: new Map(),
    dirs: new Map([
      [ROOT, START],
      [GIT, START],
    ]),
    sessionId: options.sessionId ?? 'session-a',
    surfaces: options.surfaces ?? ['desktop'],
    isRepo: options.isRepo ?? true,
    submits: [],
    answerSubmit: e => ({ text: e.text }),
    duringSubmit: () => undefined,
    failMoveOfTemporary: false,
    lockRenames: 0,
    toasts: [],
    opened: [],
    argv: [],
    clock,
    store: () => JSON.parse(w.files.get(FILE) ?? '{"version":1,"items":[],"sessions":{}}') as StoreFile,
    drain: () => clock.advance(500),
    seed: file => {
      w.dirs.set(DIR, START)
      w.files.set(FILE, typeof file === 'string' ? file : JSON.stringify(file))
    },
  }

  on('session.id', () => ({ value: w.sessionId }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.repo', () => ({
    value: w.isRepo ? { root: ROOT, remote: 'https://github.com/owner/repo.git', internal: false, name: null } : null,
  }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.SessionStart', () => ({}))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__humantray__${e.name}` } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', async (_, e) => {
    w.submits.push(e.text)
    w.duringSubmit(e)
    return w.answerSubmit(e)
  })

  const result = (exitCode: number, stdout: string, stderr: string) => ({
    value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
  })
  const ok = (stdout = '') => result(0, stdout, '')
  const no = (stderr: string) => result(1, '', stderr)
  on('process.run', async (_, e) => {
    const argv = [...e.argv]
    w.argv.push(argv)
    const [command, ...rest] = argv
    if (command === 'git') {
      return w.isRepo ? ok(`${GIT}\n`) : result(128, '', 'fatal: not a git repository')
    }
    if (command === 'mkdir') {
      if (rest[0] === '-p') {
        w.dirs.set(rest[1] ?? '', w.dirs.get(rest[1] ?? '') ?? (await clock.now()))
        return ok()
      }
      const path = rest[0] ?? ''
      if (w.dirs.has(path)) return no('File exists')
      w.dirs.set(path, await clock.now())
      return ok()
    }
    if (command === 'mv') {
      const paths = rest.filter(arg => !arg.startsWith('-'))
      const from = paths[0] ?? ''
      const to = paths[1] ?? ''
      if (w.dirs.has(from)) {
        if (w.dirs.has(to)) return no('exists')
        w.dirs.set(to, w.dirs.get(from) ?? 0)
        w.dirs.delete(from)
        if (from === LOCK) w.lockRenames += 1
        return ok()
      }
      if (w.files.has(from)) {
        if (w.failMoveOfTemporary && from.includes('.tmp-')) return no('mv: cannot move: Input/output error')
        w.files.set(to, w.files.get(from) ?? '')
        w.files.delete(from)
        return ok()
      }
      return no('No such file or directory')
    }
    if (command === 'rm') {
      const path = rest.filter(arg => !arg.startsWith('-'))[0] ?? ''
      w.files.delete(path)
      w.dirs.delete(path)
      return ok()
    }
    if (command === 'rmdir') {
      w.dirs.delete(rest[0] ?? '')
      return ok()
    }
    return result(127, '', `not found: ${command}`)
  })

  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) || w.dirs.has(e.path) }))
  on('fs.stat', (_, e) => {
    const text = w.files.get(e.path)
    if (text !== undefined) {
      return { value: { kind: 'file' as const, size: new TextEncoder().encode(text).length, mtimeMs: START, isLink: false } }
    }
    const made = w.dirs.get(e.path)
    if (made !== undefined) return { value: { kind: 'dir' as const, size: 0, mtimeMs: made, isLink: false } }
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('fs.read', (_, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    w.files.set(e.path, e.text)
    return { value: undefined }
  })

  return w
}

/** An item as an earlier session stored it, for seeding a disk. */
export function stored(fields: Partial<Item> & Pick<Item, 'id' | 'type'>): Item {
  return {
    short: `HT-${fields.id.slice(-5)}`,
    repo: 'github.com/owner/repo',
    session_id: 'session-a',
    header: 'Seeded',
    question: `Seeded ${fields.id}`,
    body_md: '',
    key: `seeded ${fields.id}`,
    created: START - HOUR,
    updated: START - HOUR,
    bumps: 0,
    status: 'open',
    delivered: false,
    origin: 'local',
    ...fields,
  }
}

export const PANE = {
  plugin: 'humantray',
  component: 'Pane',
  requestId: 'humantray',
  props: {
    title: 'Humantray',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

export const BAND = {
  plugin: 'humantray',
  component: 'AbovePrompt',
  requestId: 'humantray-band',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 3,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const

export const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' } as const

export const ADD = 'mcp__humantray__humantray_add'
export const LIST = 'mcp__humantray__humantray_list'

/** A step on one card: a press, Enter in a field, or an edit left in a field. */
export type Step = { press: string } | { type: string; text: string } | { change: string; text: string }

/** Adds one item, mounts the pane, and runs the steps on its card (keys without the id). */
export async function answerOne(
  $: Engine,
  w: World,
  surface: RenderSurface,
  call: Record<string, unknown>,
  steps: Step[],
): Promise<Item> {
  const added = await $.tool.call({ ...call, tool: ADD })
  const id = answerOf<{ id: string }>(added).id
  const ui = await $.ui.mount({ ...PANE, surface })
  for (const step of steps) {
    if ('press' in step) await ui.press({ key: `${id}:${step.press}` })
    else if ('change' in step) await ui.input({ key: `${id}:${step.change}`, text: step.text, kind: 'change' })
    else await ui.input({ key: `${id}:${step.type}`, text: step.text })
  }
  await ui.unmount()
  const item = w.store().items.find(one => one.id === id)
  if (item === undefined) throw new Error('the item is gone')
  return item
}

/** The command's input as the engine raises it when the person types it. */
export const COMMAND = {
  command: 'humantray',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

/**
 * A tool's answer as the model reads it. The engine takes only a string (or a
 * list of blocks) as a mod tool's result, so this fails on anything else.
 */
export function answerOf<T = Record<string, unknown>>(ran: { result?: unknown; isError?: true; deny?: string }): T {
  if (typeof ran.result !== 'string') throw new Error(`a tool result must be a string, got ${typeof ran.result}`)
  return JSON.parse(ran.result) as T
}

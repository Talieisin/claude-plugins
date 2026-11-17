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
  /** Every delivery from another session that reached the model, in order. */
  received: string[]
  /** The plugin's $.store as it holds it now (a copy). */
  kv: (key: string) => unknown
  /** Writes the plugin's $.store directly, as another session sharing it would. */
  kvSet: (key: string, value: unknown) => void
  /** Every line the mod logged with $.ui.log. */
  logs: string[]
  /** Every $.session.id() fails, as an engine might. */
  failSessionId: boolean
  /** The engine refuses to register a command of this name. */
  refuseCommand: (name: string) => boolean
  /** Every command registered, in order. */
  commands: string[]
  /** The engine refuses to register a tool of this name. */
  refuseTool: (name: string) => boolean
  /** Every tool registered, in order. */
  tools: string[]
  /** Every $.session.id() waits for this first (a slow engine). */
  sessionIdGate: Promise<void> | undefined
  /** A $.store.set of this key fails, as a busy store might. */
  failStoreSet: (key: string) => boolean
  /** A $.store.get of this key fails, as a busy store might. */
  failStoreGet: (key: string) => boolean
  /** A $.store.set of this key waits for the promise this returns, if any. */
  storeSetGate: (key: string) => Promise<void> | undefined
  /** Every row the plugin itself appended with $.session.append. */
  appended: unknown[]
  /** Answers a store read instead of the store, for a test (undefined: the store answers). */
  storeOverride: (key: string) => unknown
  /** How the engine answers a submit; by default the prompt enters. */
  answerSubmit: (e: PromptSubmitInput) => PromptSubmitResult | Promise<PromptSubmitResult>
  /** A hook to run inside each submit, before it answers (to look at the disk). */
  duringSubmit: (e: PromptSubmitInput) => void
  failMoveOfTemporary: boolean
  /** Fail this many more moves of a temporary file into place, then succeed. */
  failMoves: number
  /** Every mkdir fails, as on a read-only disk. */
  failMkdir: boolean
  /** Every toast fails, as a surface that went away might. */
  failToast: boolean
  /** The next attempt to take the store lock waits for this, once. */
  lockGate: Promise<void> | undefined
  /** Every rename of the lock directory that succeeded. */
  lockRenames: number
  /** Every temporary file moved into place as the store: one per committed write. */
  commits: number
  /** Runs after a stat is measured and before it is answered (to change the disk in between). */
  afterStat: (path: string) => void | Promise<void>
  /** Runs before a move is made. */
  beforeMove: (from: string, to: string) => void | Promise<void>
  /** Runs before a file is written. */
  beforeWrite: (path: string) => void | Promise<void>
  /** Puts a lock on the disk as another holder's, taken now unless `at` is given. */
  holdLock: (token: string, at?: number) => void
  /** Removes the lock, as its holder does when it finishes. */
  dropLock: () => void
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

export function world(
  on: On,
  options: {
    sessionId?: string
    surfaces?: RenderSurface[]
    isRepo?: boolean
    env?: Record<string, string>
    store?: Record<string, unknown>
    /** The origin remote; null for a repository with none. */
    remote?: string | null
  } = {},
): World {
  const clock = mock.clock(on, { now: START })
  // The plugin's $.store, kept here so a test can look at it or change it (as
  // another session sharing the store would). Values are copied in and out.
  const kv = new Map<string, string>(Object.entries(options.store ?? {}).map(([k, v]) => [k, JSON.stringify(v)]))
  on('store.get', (_, e) => {
    if (w.failStoreGet(e.key)) throw new Error('store busy')
    const held = w.storeOverride(e.key)
    if (held !== undefined) return { value: held }
    const text = kv.get(e.key)
    return { value: text === undefined ? undefined : (JSON.parse(text) as unknown) }
  })
  on('store.set', async (_, e) => {
    const gate = w.storeSetGate(e.key)
    if (gate !== undefined) await gate
    if (w.failStoreSet(e.key)) throw new Error('store busy')
    kv.set(e.key, JSON.stringify(e.value))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    kv.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...kv.keys()] }))
  // A local session unless a test says otherwise: the store pass (#33) runs only in a cloud one.
  mock.env(on, options.env ?? {})
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
    received: [],
    kv: key => {
      const text = kv.get(key)
      return text === undefined ? undefined : (JSON.parse(text) as unknown)
    },
    storeOverride: () => undefined,
    kvSet: (key, value) => {
      kv.set(key, JSON.stringify(value))
    },
    logs: [],
    failSessionId: false,
    refuseCommand: () => false,
    commands: [],
    refuseTool: () => false,
    tools: [],
    sessionIdGate: undefined,
    failStoreSet: () => false,
    failStoreGet: () => false,
    storeSetGate: () => undefined,
    appended: [],
    answerSubmit: e => ({ text: e.text }),
    duringSubmit: () => undefined,
    failMoveOfTemporary: false,
    failMoves: 0,
    failMkdir: false,
    failToast: false,
    lockGate: undefined,
    lockRenames: 0,
    commits: 0,
    afterStat: () => undefined,
    beforeMove: () => undefined,
    beforeWrite: () => undefined,
    dropLock: () => {
      for (const path of [...w.files.keys()]) if (path.startsWith(`${LOCK}/`)) w.files.delete(path)
      w.dirs.delete(LOCK)
    },
    holdLock: (token, at) => {
      const when = at ?? clock.now()
      for (const path of [...w.files.keys()]) if (path.startsWith(`${LOCK}/`)) w.files.delete(path)
      w.dirs.set(DIR, w.dirs.get(DIR) ?? START)
      w.dirs.set(LOCK, when)
      w.files.set(`${LOCK}/owner`, `${token}\n`)
    },
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

  on('session.id', async () => {
    if (w.sessionIdGate !== undefined) await w.sessionIdGate
    if (w.failSessionId) throw new Error('the session id could not be read')
    return { value: w.sessionId }
  })
  on('session.cwd', () => ({ value: ROOT }))
  on('session.repo', () => ({
    value: w.isRepo
      ? { root: ROOT, remote: options.remote === undefined ? 'https://github.com/owner/repo.git' : options.remote, internal: false, name: null }
      : null,
  }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.SessionStart', () => ({}))
  on('tool.register', (_, e) => {
    if (w.refuseTool(e.name)) throw new Error(`the tool ${e.name} was refused`)
    w.tools.push(e.name)
    return { value: { tool: `mcp__humantray__${e.name}` } }
  })
  on('command.register', (_, e) => {
    if (w.refuseCommand(e.name)) throw new Error(`"/${e.name}" refused: the name is taken`)
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', (_, e) => {
    if (w.failToast) return { deny: 'the surface went away' }
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('session.append', (_, e) => {
    if (e.origin.kind === 'plugin') w.appended.push(e.message)
    return { message: e.message, uuid: e.uuid }
  })
  // A delivery from another session that no plugin took is queued for the model, as it arrived.
  on('session.receive', (_, e) => {
    w.received.push(e.text)
    return { text: e.text }
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
      if (w.failMkdir) return no('mkdir: cannot create directory: Read-only file system')
      if (rest[0] === '-p') {
        w.dirs.set(rest[1] ?? '', w.dirs.get(rest[1] ?? '') ?? (await clock.now()))
        return ok()
      }
      const path = rest[0] ?? ''
      if (path === LOCK && w.lockGate !== undefined) {
        const gate = w.lockGate
        w.lockGate = undefined
        await gate
      }
      if (w.dirs.has(path)) return no('File exists')
      w.dirs.set(path, await clock.now())
      return ok()
    }
    if (command === 'mv') {
      const paths = rest.filter(arg => !arg.startsWith('-'))
      const from = paths[0] ?? ''
      const to = paths[1] ?? ''
      await w.beforeMove(from, to)
      if (w.dirs.has(from)) {
        if (w.dirs.has(to) || w.files.has(to)) return no('exists')
        w.dirs.set(to, w.dirs.get(from) ?? 0)
        w.dirs.delete(from)
        for (const path of [...w.files.keys()]) {
          if (path.startsWith(`${from}/`)) {
            w.files.set(`${to}${path.slice(from.length)}`, w.files.get(path) ?? '')
            w.files.delete(path)
          }
        }
        if (from === LOCK) w.lockRenames += 1
        return ok()
      }
      if (w.files.has(from)) {
        if (from.includes('.tmp-') && (w.failMoveOfTemporary || w.failMoves > 0)) {
          w.failMoves = Math.max(0, w.failMoves - 1)
          return no('mv: cannot move: Input/output error')
        }
        w.files.set(to, w.files.get(from) ?? '')
        w.files.delete(from)
        if (to === FILE) w.commits += 1
        return ok()
      }
      return no('No such file or directory')
    }
    if (command === 'rm') {
      const path = rest.filter(arg => !arg.startsWith('-'))[0] ?? ''
      w.files.delete(path)
      w.dirs.delete(path)
      for (const each of [...w.files.keys()]) if (each.startsWith(`${path}/`)) w.files.delete(each)
      for (const each of [...w.dirs.keys()]) if (each.startsWith(`${path}/`)) w.dirs.delete(each)
      return ok()
    }
    if (command === 'rmdir') {
      const path = rest[0] ?? ''
      if ([...w.files.keys()].some(each => each.startsWith(`${path}/`))) return no('Directory not empty')
      w.dirs.delete(path)
      return ok()
    }
    return result(127, '', `not found: ${command}`)
  })

  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) || w.dirs.has(e.path) }))
  on('fs.stat', async (_, e) => {
    const text = w.files.get(e.path)
    const made = w.dirs.get(e.path)
    let value: { kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean } | undefined
    if (text !== undefined) value = { kind: 'file', size: new TextEncoder().encode(text).length, mtimeMs: START, isLink: false }
    else if (made !== undefined) value = { kind: 'dir', size: 0, mtimeMs: made, isLink: false }
    await w.afterStat(e.path)
    if (value === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value }
  })
  on('fs.read', (_, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', async (_, e) => {
    await w.beforeWrite(e.path)
    w.files.set(e.path, e.text)
    // Writing a file into a directory moves the directory's mtime, as on a disk.
    const parent = e.path.slice(0, e.path.lastIndexOf('/'))
    if (w.dirs.has(parent)) w.dirs.set(parent, clock.now())
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
    ...(fields.type === 'approve' || fields.type === 'choice'
      ? {
          options: [
            { label: 'Approve', description: 'Go ahead as proposed.' },
            { label: 'Reject', description: 'Do not go ahead.' },
          ],
        }
      : {}),
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
  command: 'humantray-open',
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

/**
 * A finished item, for seeding: answered, delivered, no claim. `n` makes its
 * id (`01FIN` and n, 26 characters), so ids rise with n; give `response_at`
 * from `shuffled` so that its order key does not.
 */
export function finished(n: number, fields: Partial<Item> = {}): Item {
  const id = `01FIN${String(n).padStart(21, '0')}`
  return stored({
    id,
    type: 'approve',
    header: 'Done',
    status: 'answered',
    response: { selected: ['Approve'] },
    response_at: START - HOUR,
    delivered: true,
    delivered_at: START - HOUR,
    ...fields,
  })
}

/**
 * A fixed shuffle of 0..n-1 (a stride coprime to n), so that order keys made
 * from it bear no relation to position or id.
 */
export function shuffled(n: number): number[] {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  let stride = 37
  while (gcd(stride, n) !== 1) stride += 1
  // The offset keeps the first and last positions off the oldest key.
  return Array.from({ length: n }, (_, i) => (i * stride + Math.floor(n / 3)) % n)
}

/**
 * `n` finished items of `repo` and session, in id order, whose `response_at`
 * is shuffled and whose `updated` falls as the id rises: an order by
 * position, by id or by `updated` is never the order by `response_at`.
 */
export function finishedMany(n: number, fields: Partial<Item> = {}, from = 0): Item[] {
  const keys = shuffled(n)
  return Array.from({ length: n }, (_, i) =>
    finished(from + i, {
      response_at: START - 2 * HOUR + (keys[i] ?? 0) * 1_000,
      updated: START - 3 * HOUR - i * 1_000,
      created: START - 4 * HOUR,
      ...fields,
    }),
  )
}

/** The ids of the `count` items `finishedMany(n, _, from)` made with the smallest `response_at`. */
export function oldestOfMany(n: number, count: number, from = 0): string[] {
  const keys = shuffled(n)
  return keys.flatMap((key, i) => (key < count ? [finished(from + i).id] : []))
}

/** Markdown with the structures the owner asked to keep: headings, lists, a task list, a quote, code, a table, a rule, a link. */
export const RICH = [
  '## Steps',
  '',
  '1. Rotate the **key**',
  '   - in `prod` first',
  '   - then *staging*',
  '2. Tell [ops](https://example.com/ops)',
  '',
  '- [x] backed up',
  '- [ ] announced',
  '',
  '> Check the logs first.',
  '',
  '```sh',
  'make rotate',
  '',
  '    echo indented',
  '```',
  '',
  '| Env | Done |',
  '| --- | ---- |',
  '| prod | yes |',
  '',
  '---',
  '',
  '    an indented code block',
].join('\n')

// The store: `<git common dir>/humantray/items.json`, shared by every
// worktree and session of the repository. Every change takes a lock (a
// directory), re-reads the file, writes a temporary file and moves it into
// place. A file this version cannot read is reported and never written.

import type { EngineInterface } from 'claude-code'

import type { StoreFile } from '../types'
import { type Checked, checkStoreFile, emptyStore } from './items'

/** Wait at most this long for the lock, then give up with a clean error. */
export const LOCK_WAIT_MS = 3_000
/** A lock older than this was left by a holder that died. */
export const LOCK_STALE_MS = 2_000
const LOCK_RETRY_MS = 50
/** Refuse to read a file larger than this ($.fs.read stops at 4 MiB). */
export const READ_LIMIT = 3 * 1024 * 1024
/** Refuse to write a file larger than this. */
export const WRITE_LIMIT = 2 * 1024 * 1024

export type Where = { dir: string; file: string; lock: string; root: string; remote: string | null }

const randomToken = (): string => {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

async function run($: EngineInterface, argv: string[]) {
  try {
    return await $.process.run(argv, { timeoutMs: 5_000 })
  } catch (error) {
    return { exitCode: 127, stdout: '', stderr: String(error) }
  }
}

/** Finds the store for the session's directory, or says why there is none. */
export async function locate($: EngineInterface): Promise<Checked<Where>> {
  const cwd = await $.session.cwd()
  const found = await run($, ['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (found.exitCode === 127) {
    return { error: 'humantray: git could not be run (the store needs git and a POSIX system)' }
  }
  const common = found.stdout.trim()
  if (found.exitCode !== 0 || common === '') {
    return { error: 'humantray: not in a git repository' }
  }
  const repo = await $.session.repo()
  const dir = `${common}/humantray`
  return {
    ok: {
      dir,
      file: `${dir}/items.json`,
      lock: `${dir}/items.lock`,
      root: repo?.root ?? cwd,
      remote: repo?.remote ?? null,
    },
  }
}

/** Reads the store as it is now; a missing file is an empty store. */
export async function readStore($: EngineInterface, where: Where): Promise<Checked<StoreFile>> {
  const unreadable = (why: string) => ({
    error: `humantray: ${where.file} is unreadable (${why}); it was not changed`,
  })
  try {
    if (!(await $.fs.exists(where.file))) return { ok: emptyStore() }
    const stat = await $.fs.stat(where.file)
    if (stat.size > READ_LIMIT) return unreadable(`${stat.size} bytes, over ${READ_LIMIT}`)
    const text = await $.fs.read(where.file)
    if (typeof text !== 'string') return unreadable('not text')
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return unreadable('not JSON')
    }
    const checked = checkStoreFile(parsed)
    return checked.error === undefined ? checked : unreadable(checked.error)
  } catch (error) {
    return unreadable(String(error))
  }
}

async function sleep($: EngineInterface, ms: number) {
  await $.clock.sleep(ms).catch(() => undefined)
}

/**
 * Takes the lock, or gives up after LOCK_WAIT_MS. A lock older than
 * LOCK_STALE_MS is broken by renaming it aside: only one rename of it can
 * succeed, so only one breaker goes on to take it.
 */
async function acquire($: EngineInterface, where: Where): Promise<boolean> {
  const made = await run($, ['mkdir', '-p', where.dir])
  if (made.exitCode !== 0) return false
  const deadline = (await $.clock.now()) + LOCK_WAIT_MS
  for (;;) {
    const taken = await run($, ['mkdir', where.lock])
    if (taken.exitCode === 0) return true
    const now = await $.clock.now()
    if (now >= deadline) return false
    const stat = await $.fs.stat(where.lock).catch(() => undefined)
    if (stat !== undefined && now - stat.mtimeMs > LOCK_STALE_MS) {
      // One breaker: the rename succeeds for one caller only; the others find
      // the lock gone or fresh and go round again.
      const aside = `${where.lock}.stale-${randomToken()}`
      const moved = await run($, ['mv', where.lock, aside])
      if (moved.exitCode === 0) await run($, ['rm', '-rf', aside])
      continue
    }
    await sleep($, LOCK_RETRY_MS)
  }
}

async function release($: EngineInterface, where: Where) {
  await run($, ['rmdir', where.lock])
}

/** What a change does: the result to hand back, and whether to write. */
export type Change<T> = { result: T; write: boolean } | { error: string }

/**
 * Runs `change` on the file under the lock and writes what it leaves, when it
 * says to. The file is never written when it could not be read, and never
 * past WRITE_LIMIT.
 */
export async function mutate<T>(
  $: EngineInterface,
  change: (file: StoreFile, where: Where) => Change<T> | Promise<Change<T>>,
): Promise<Checked<{ result: T; file: StoreFile; where: Where }>> {
  const where = await locate($)
  if (where.error !== undefined) return { error: where.error }
  const place = where.ok
  if (!(await acquire($, place))) {
    return { error: `humantray: the store is busy (${place.lock} is held); try again` }
  }
  try {
    const read = await readStore($, place)
    if (read.error !== undefined) return { error: read.error }
    const file = read.ok
    const changed = await change(file, place)
    if ('error' in changed) return { error: changed.error }
    if (changed.write) {
      const text = `${JSON.stringify(file, null, 2)}\n`
      if (new TextEncoder().encode(text).length > WRITE_LIMIT) {
        return { error: `humantray: the store is full (${place.file} would pass ${WRITE_LIMIT} bytes)` }
      }
      const temporary = `${place.file}.tmp-${randomToken()}`
      await $.fs.write(temporary, text)
      const moved = await run($, ['mv', '-f', temporary, place.file])
      if (moved.exitCode !== 0) {
        await run($, ['rm', '-f', temporary])
        return { error: `humantray: could not write ${place.file} (${moved.stderr.trim()})` }
      }
    }
    return { ok: { result: changed.result, file, where: place } }
  } catch (error) {
    return { error: `humantray: ${String(error)}` }
  } finally {
    await release($, place)
  }
}

/** Reads the store without the lock, for drawing and listing. */
export async function peek($: EngineInterface): Promise<Checked<{ file: StoreFile; where: Where }>> {
  const where = await locate($)
  if (where.error !== undefined) return { error: where.error }
  const read = await readStore($, where.ok)
  if (read.error !== undefined) return { error: read.error }
  return { ok: { file: read.ok, where: where.ok } }
}

// The store: `<git common dir>/humantray/items.json`, shared by every
// worktree and session of the repository. Every change takes a lock (a
// directory holding its owner's token), re-reads the file, writes a temporary
// file and moves it into place. A file this version cannot read is reported
// and never written.
//
// The lock: a caller waits at most LOCK_WAIT_MS, well under a hook's 10 s
// budget. A lock older than LOCK_STALE_MS was left by a holder that died: a
// normal holder's work is a few process calls, far shorter. Breaking it is
// done by one breaker at a time (a second lock, `items.lock.break`): the
// breaker looks again under that lock and renames the stale lock aside only
// if it is still the one it judged stale. If a new holder took the path in
// the moment between, the breaker finds its token on what it moved and gives
// it back. A holder releases only a lock that holds its own token, and checks
// its token again just before it commits a write: a holder slower than the
// stale age, whose lock was broken, fails with an error and writes nothing.

import type { EngineInterface } from 'claude-code'

import type { StoreFile } from '../types'
import { type Checked, checkStoreFile, emptyStore } from './items'

/** Wait at most this long for the lock, then give up with a clean error. */
export const LOCK_WAIT_MS = 5_000
/** A lock older than this was left by a holder that died. */
export const LOCK_STALE_MS = 3_000
/** A breaker's own lock older than this was left by a breaker that died. */
const BREAK_STALE_MS = 10_000
const LOCK_RETRY_MS = 50
/** Refuse to read a file larger than this ($.fs.read stops at 4 MiB). */
export const READ_LIMIT = 3 * 1024 * 1024
/**
 * Refuse an add or a bump that takes the file past this. Answers, claims,
 * settles and session records may write up to READ_LIMIT, so a store near
 * this size still delivers.
 */
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

/** The token in a lock directory, or '' when it has none. */
async function ownerOf($: EngineInterface, lock: string): Promise<string> {
  try {
    const text = await $.fs.read(`${lock}/owner`)
    return typeof text === 'string' ? text.trim() : ''
  } catch {
    return ''
  }
}

async function statOf($: EngineInterface, path: string) {
  try {
    return await $.fs.stat(path)
  } catch {
    return undefined
  }
}

/** Breaks the lock judged stale at `judged`, if it is still that lock. */
async function breakStale($: EngineInterface, where: Where, judged: number) {
  const breaker = `${where.lock}.break`
  const got = await run($, ['mkdir', breaker])
  if (got.exitCode !== 0) {
    const held = await statOf($, breaker)
    if (held !== undefined && (await $.clock.now()) - held.mtimeMs > BREAK_STALE_MS) {
      await run($, ['rm', '-rf', breaker])
    }
    return
  }
  try {
    const again = await statOf($, where.lock)
    if (again === undefined || again.mtimeMs !== judged) return
    const token = await ownerOf($, where.lock)
    const aside = `${where.lock}.stale-${randomToken()}`
    const moved = await run($, ['mv', where.lock, aside])
    if (moved.exitCode !== 0) return
    if ((await ownerOf($, aside)) !== token) {
      // A new holder took the path between the look and the rename: give it back.
      await run($, ['mv', aside, where.lock])
      return
    }
    await run($, ['rm', '-rf', aside])
  } finally {
    await run($, ['rm', '-rf', breaker])
  }
}

/** Takes the lock under `token`, or says why it could not. */
async function acquire($: EngineInterface, where: Where, token: string): Promise<Checked<true>> {
  const made = await run($, ['mkdir', '-p', where.dir])
  if (made.exitCode !== 0) {
    return { error: `humantray: could not create ${where.dir} (${made.stderr.trim() || `exit ${made.exitCode}`})` }
  }
  const deadline = (await $.clock.now()) + LOCK_WAIT_MS
  let missing = 0
  for (;;) {
    const taken = await run($, ['mkdir', where.lock])
    if (taken.exitCode === 0) {
      try {
        await $.fs.write(`${where.lock}/owner`, `${token}\n`)
        return { ok: true }
      } catch (error) {
        await run($, ['rm', '-rf', where.lock])
        return { error: `humantray: could not write the lock's owner (${String(error)})` }
      }
    }
    const now = await $.clock.now()
    if (now >= deadline) return { error: `humantray: the store is busy (${where.lock} is held); try again` }
    const stat = await statOf($, where.lock)
    if (stat === undefined) {
      // mkdir failed and there is no lock: not contention but a fault.
      missing += 1
      if (missing >= 3) {
        return { error: `humantray: could not create ${where.lock} (${taken.stderr.trim() || `exit ${taken.exitCode}`})` }
      }
      continue
    }
    if (now - stat.mtimeMs > LOCK_STALE_MS) {
      await breakStale($, where, stat.mtimeMs)
      continue
    }
    await sleep($, LOCK_RETRY_MS)
  }
}

/** Removes the lock only if it is still this holder's. */
async function release($: EngineInterface, where: Where, token: string) {
  if ((await ownerOf($, where.lock)) === token) await run($, ['rm', '-rf', where.lock])
}

/** What a change does: the result to hand back, and whether to write. */
export type Change<T> = { result: T; write: boolean } | { error: string }

export type MutateOptions = {
  /** The largest file this change may leave: WRITE_LIMIT for adds, else READ_LIMIT. */
  limit?: number
  /** The store to use, when the caller found it earlier (a settle uses its claim's). */
  where?: Where
}

/**
 * Runs `change` on the file under the lock and writes what it leaves, when it
 * says to. The file is never written when it could not be read, never past
 * the limit, and never after this holder's lock was broken.
 */
export async function mutate<T>(
  $: EngineInterface,
  change: (file: StoreFile, where: Where) => Change<T> | Promise<Change<T>>,
  options: MutateOptions = {},
): Promise<Checked<{ result: T; file: StoreFile; where: Where }>> {
  let place = options.where
  if (place === undefined) {
    const where = await locate($)
    if (where.error !== undefined) return { error: where.error }
    place = where.ok
  }
  const limit = options.limit ?? READ_LIMIT
  const token = randomToken()
  const held = await acquire($, place, token)
  if (held.error !== undefined) return { error: held.error }
  try {
    const read = await readStore($, place)
    if (read.error !== undefined) return { error: read.error }
    const file = read.ok
    const changed = await change(file, place)
    if ('error' in changed) return { error: changed.error }
    if (changed.write) {
      const text = `${JSON.stringify(file, null, 2)}\n`
      if (new TextEncoder().encode(text).length > limit) {
        return { error: `humantray: the store is full (${place.file} would pass ${limit} bytes)` }
      }
      const temporary = `${place.file}.tmp-${randomToken()}`
      await $.fs.write(temporary, text)
      if ((await ownerOf($, place.lock)) !== token) {
        await run($, ['rm', '-f', temporary])
        return { error: 'humantray: the store lock was taken over during this change; nothing was written; try again' }
      }
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
    await release($, place, token)
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

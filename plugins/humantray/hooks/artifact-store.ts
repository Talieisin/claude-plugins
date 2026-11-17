// The artifact store adapter (#33): every call humantray makes to the
// repository's artifact and its database goes through here, as the mod's own
// `$.tool.call` on the built-in `Artifact`, `ArtifactData` and
// `ArtifactComments` tools.
//
// Their replies are text, not records, and the wording is the tools' own and
// unversioned (#31). So every reply is parsed defensively: a shape this file
// does not recognise reads as "unavailable", never as "not found", and so can
// never lead to a second artifact being created. The shapes below were seen
// from Claude Code 2.1.326; the test fixtures carry them with made-up ids.

import type { EngineInterface } from 'claude-code'

import type { Item, ItemRow, MetaPage, ResponseRow } from '../types'
import { type RowRead, checkItemRow, checkMeta, checkResponseRow, isTitleFor, itemToRow, pickArtifact, titleFor } from './rows'

/** How long one tool call may take before the caller stops waiting for it. */
export const CALL_MS = 5_000

/** A reply, read: what the caller can act on. */
export type Reply =
  | { kind: 'ok'; text: string }
  /** The tool ran and reported an error; `text` says which. */
  | { kind: 'error'; text: string }
  /** A local mod's write: "needs a person's approval, and a mod's own call can't ask for it". */
  | { kind: 'needs-person'; text: string }
  /** Any other deny: refused for this call only. */
  | { kind: 'denied'; text: string }
  /** No answer in time, the tool missing, or a reply of no known shape. */
  | { kind: 'unavailable'; why: string }

const NEEDS_PERSON = /needs a person's approval/i

/** Waits for `work` at most `ms`, on the engine's clock; the wait never outlives the call. */
export async function withDeadline<T>($: EngineInterface, work: Promise<T>, ms: number): Promise<T | 'timeout'> {
  const stop = new AbortController()
  try {
    return await Promise.race([
      work,
      $.clock.sleep(ms, { signal: stop.signal }).then(
        () => 'timeout' as const,
        () => 'timeout' as const,
      ),
    ])
  } finally {
    stop.abort()
  }
}

type LooseCall = (input: Record<string, unknown> & { tool: string }) => Promise<{
  deny?: string
  isError?: true
  text?: string
  result?: unknown
}>

/** Calls a built-in tool as the mod, with a time limit. Never throws. */
export async function callTool($: EngineInterface, input: Record<string, unknown> & { tool: string }): Promise<Reply> {
  let ran: Awaited<ReturnType<LooseCall>> | 'timeout'
  try {
    ran = await withDeadline($, ($.tool.call as unknown as LooseCall)(input), CALL_MS)
  } catch (error) {
    return { kind: 'unavailable', why: String(error) }
  }
  if (ran === 'timeout') return { kind: 'unavailable', why: `no answer within ${CALL_MS} ms` }
  if (typeof ran.deny === 'string') {
    return NEEDS_PERSON.test(ran.deny) ? { kind: 'needs-person', text: ran.deny } : { kind: 'denied', text: ran.deny }
  }
  const text = typeof ran.text === 'string' ? ran.text : typeof ran.result === 'string' ? ran.result : undefined
  if (text === undefined) return { kind: 'unavailable', why: 'the reply carried no text' }
  return ran.isError === true ? { kind: 'error', text } : { kind: 'ok', text }
}

/** One document as a read gives it. */
export type Doc = { id: string; data: Record<string, unknown>; version: number }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Reads the documents in a `get`, `list` or `query` reply: the JSON lines
 * between `=== BEGIN ARTIFACT DB <nonce> …` and `=== END ARTIFACT DB
 * <nonce> ===`, or none for a reply that says no document matched. Any other
 * shape is undefined: unavailable.
 */
export function parseDocs(text: string): Doc[] | undefined {
  const trimmed = text.trim()
  if (/^No documents? /.test(trimmed) && !trimmed.includes('=== BEGIN ARTIFACT DB')) return []
  const begin = /^=== BEGIN ARTIFACT DB ([0-9A-Za-z]+) .*===$/m.exec(trimmed)
  if (begin === null) return undefined
  const nonce = begin[1]
  const endMark = `=== END ARTIFACT DB ${nonce} ===`
  const start = begin.index + begin[0].length
  const end = trimmed.indexOf(endMark, start)
  if (end < 0) return undefined
  const docs: Doc[] = []
  for (const line of trimmed.slice(start, end).split('\n')) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return undefined
    }
    if (!isRecord(parsed) || typeof parsed.id !== 'string' || !isRecord(parsed.data) || typeof parsed.version !== 'number') {
      return undefined
    }
    docs.push({ id: parsed.id, data: parsed.data, version: parsed.version })
  }
  return docs
}

/** What a write came to. */
export type Written =
  | { kind: 'ok'; version: number }
  /** An unpinned write to a document that exists. */
  | { kind: 'exists' }
  /** A pinned write to a document at another version. */
  | { kind: 'stale' }
  /** An update or pinned write to a document that is not there. */
  | { kind: 'missing' }
  /** A write the database's access rules refuse at that path. */
  | { kind: 'refused' }
  | { kind: 'needs-person' }
  | { kind: 'unavailable'; why: string }

/** Reads a write's reply. */
export function parseWrite(reply: Reply): Written {
  if (reply.kind === 'needs-person') return { kind: 'needs-person' }
  if (reply.kind === 'unavailable') return reply
  if (reply.kind === 'denied') return { kind: 'unavailable', why: `denied: ${reply.text}` }
  if (reply.kind === 'ok') {
    const committed = /^Database (?:set|update) committed\b[\s\S]*?\bnow at version (\d+)/.exec(reply.text.trim())
    if (committed?.[1] !== undefined) return { kind: 'ok', version: Number(committed[1]) }
    return { kind: 'unavailable', why: 'an unrecognised write reply' }
  }
  const text = reply.text
  if (/\(version_mismatch\)/.test(text) && /already exists and this write carried no if_version/.test(text)) return { kind: 'exists' }
  if (/\(version_mismatch\)/.test(text) && /no longer at version/.test(text)) return { kind: 'stale' }
  if (/\(invalid_argument\)/.test(text) && /no such artifact, collection, or document/.test(text)) return { kind: 'missing' }
  if (/\(invalid_argument\)/.test(text) && /refused this write at its path/.test(text)) return { kind: 'refused' }
  return { kind: 'unavailable', why: 'an unrecognised write error' }
}

/** A read's documents, or why there are none to act on. */
export type Read =
  | { kind: 'ok'; docs: Doc[] }
  /** The artifact is not there (deleted), or this person cannot reach it. */
  | { kind: 'gone' }
  | { kind: 'unavailable'; why: string }
  | { kind: 'needs-person' }

function readOf(reply: Reply): Read {
  if (reply.kind === 'needs-person') return { kind: 'needs-person' }
  if (reply.kind === 'error' && /\(invalid_argument\)/.test(reply.text) && /no such artifact/.test(reply.text)) {
    return { kind: 'gone' }
  }
  if (reply.kind !== 'ok') return { kind: 'unavailable', why: reply.kind === 'unavailable' ? reply.why : reply.text }
  const docs = parseDocs(reply.text)
  return docs === undefined ? { kind: 'unavailable', why: 'an unrecognised read reply' } : { kind: 'ok', docs }
}

/** One document, or none. */
export async function getDoc($: EngineInterface, url: string, collection: string, id: string): Promise<Read> {
  return readOf(await callTool($, { tool: 'ArtifactData', action: 'get', url, collection, doc_id: id }))
}

/** A filtered read of one page of up to `limit` documents. */
export async function queryDocs(
  $: EngineInterface,
  url: string,
  collection: string,
  query: { where?: unknown[][]; order_by?: { field: string; direction?: 'asc' | 'desc' }; limit?: number },
): Promise<Read> {
  return readOf(await callTool($, { tool: 'ArtifactData', action: 'query', url, collection, query }))
}

/** Writes a whole document: a create when `ifVersion` is absent, else pinned. */
export async function setDoc(
  $: EngineInterface,
  url: string,
  collection: string,
  id: string,
  data: Record<string, unknown>,
  ifVersion?: number,
): Promise<Written> {
  const input: Record<string, unknown> & { tool: string } = { tool: 'ArtifactData', action: 'set', url, collection, doc_id: id, data }
  if (ifVersion !== undefined) input.if_version = ifVersion
  return parseWrite(await callTool($, input))
}

/** Deletes documents, each pinned, in one batch of at most 50. */
export async function deleteDocs(
  $: EngineInterface,
  url: string,
  docs: Array<{ collection: string; id: string; version: number }>,
): Promise<'ok' | 'failed'> {
  if (docs.length === 0) return 'ok'
  const writes = docs.slice(0, 50).map(doc => ({ op: 'delete', collection: doc.collection, doc_id: doc.id, if_version: doc.version }))
  const reply = await callTool($, { tool: 'ArtifactData', action: 'batch', url, writes })
  return reply.kind === 'ok' && /\bcommitted\b|\bapplied\b|\bdeleted\b/i.test(reply.text) ? 'ok' : 'failed'
}

/** What pushing one item came to. */
export type Pushed =
  | { kind: 'ok'; version: number }
  | { kind: 'needs-person' }
  | { kind: 'unavailable'; why: string }

/**
 * Writes an item's row: a create when no version is known, else pinned to
 * it. "Already exists" (a row whose version this file never recorded) and
 * "no longer at version" both lead to one read and one write pinned to what
 * was read, starting from the row as read so its unknown fields are kept.
 * The asker is the only writer of its rows, so what it holds wins.
 */
export async function pushItem(
  $: EngineInterface,
  url: string,
  item: Item & Required<Pick<Item, 'remote'>>,
  version: number | undefined,
): Promise<Pushed> {
  const first = await setDoc($, url, 'items', item.id, itemToRow(item) as unknown as Record<string, unknown>, version)
  if (first.kind === 'ok' || first.kind === 'needs-person' || first.kind === 'unavailable') return first
  if (first.kind === 'refused' || (first.kind === 'missing' && version === undefined)) {
    return { kind: 'unavailable', why: 'the store refused the write' }
  }
  // exists, stale, or a pinned write to a row that is gone: read it, then write once more.
  const read = await getDoc($, url, 'items', item.id)
  if (read.kind === 'needs-person') return read
  if (read.kind === 'unavailable') return read
  if (read.kind === 'gone') return { kind: 'unavailable', why: 'the artifact is gone' }
  const doc = read.docs[0]
  const again =
    doc === undefined
      ? await setDoc($, url, 'items', item.id, itemToRow(item) as unknown as Record<string, unknown>)
      : await setDoc($, url, 'items', item.id, itemToRow(item, doc.data) as unknown as Record<string, unknown>, doc.version)
  if (again.kind === 'ok' || again.kind === 'needs-person' || again.kind === 'unavailable') return again
  return { kind: 'unavailable', why: `the row changed again (${again.kind})` }
}

/** The response rows for some items, read in chunks of 30 (the `in` limit). */
export async function readResponses(
  $: EngineInterface,
  url: string,
  ids: string[],
): Promise<{ kind: 'ok'; rows: Map<string, RowRead<ResponseRow>> } | { kind: 'unavailable'; why: string }> {
  const rows = new Map<string, RowRead<ResponseRow>>()
  for (let at = 0; at < ids.length; at += 30) {
    const chunk = ids.slice(at, at + 30)
    const read = await queryDocs($, url, 'responses', { where: [['id', 'in', chunk]], limit: 100 })
    if (read.kind !== 'ok') return { kind: 'unavailable', why: read.kind === 'unavailable' ? read.why : read.kind }
    for (const doc of read.docs) {
      if (!chunk.includes(doc.id)) continue
      rows.set(doc.id, checkResponseRow(doc.data))
    }
  }
  return { kind: 'ok', rows }
}

/** The item rows of one routable session, as read, with how many could not be read. */
export async function readSessionRows(
  $: EngineInterface,
  url: string,
  routable: string,
): Promise<{ kind: 'ok'; rows: Array<{ row: ItemRow; version: number }>; skipped: number } | { kind: 'unavailable'; why: string }> {
  const read = await queryDocs($, url, 'items', { where: [['session_id', '==', routable]], limit: 1000 })
  if (read.kind !== 'ok') return { kind: 'unavailable', why: read.kind === 'unavailable' ? read.why : read.kind }
  return rowsOf(read.docs)
}

/** The finished item rows, newest answer first, up to 1000. */
export async function readFinishedRows(
  $: EngineInterface,
  url: string,
): Promise<{ kind: 'ok'; rows: Array<{ row: ItemRow; version: number }>; skipped: number } | { kind: 'unavailable'; why: string }> {
  const read = await queryDocs($, url, 'items', {
    where: [['status', 'in', ['acknowledged', 'done', 'answered']]],
    order_by: { field: 'response_at', direction: 'desc' },
    limit: 1000,
  })
  if (read.kind !== 'ok') return { kind: 'unavailable', why: read.kind === 'unavailable' ? read.why : read.kind }
  return rowsOf(read.docs)
}

function rowsOf(docs: Doc[]): { kind: 'ok'; rows: Array<{ row: ItemRow; version: number }>; skipped: number } {
  const rows: Array<{ row: ItemRow; version: number }> = []
  let skipped = 0
  for (const doc of docs) {
    const read = checkItemRow(doc.data)
    if ('ok' in read && read.ok.id === doc.id) rows.push({ row: read.ok, version: doc.version })
    else skipped += 1
  }
  return { kind: 'ok', rows, skipped }
}

/** One artifact the person owns, as the listing names it. */
export type Listed = { title: string; url: string }

const LISTED = /^- \(mine\) (.+) — (https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+) — updated \S+\s*$/
const MORE = /\(More exist: pass `page_token` "([^"]+)"/

/**
 * Reads one page of `Artifact list`: the person's own artifacts, and the
 * token for the next page when more exist. Shared artifacts are left out:
 * humantray only uses an artifact the person owns.
 */
export function parseListing(text: string): { listed: Listed[]; next?: string } | undefined {
  const lines = text.trim().split('\n')
  const head = lines[0] ?? ''
  if (/^No (?:published )?artifacts\b/i.test(head)) return { listed: [] }
  if (!/^\d+ published artifacts?\b/.test(head)) return undefined
  const listed: Listed[] = []
  let next: string | undefined
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue
    const more = MORE.exec(line)
    if (more?.[1] !== undefined) {
      next = more[1]
      continue
    }
    const row = LISTED.exec(line)
    if (row?.[1] !== undefined && row[2] !== undefined) {
      listed.push({ title: row[1], url: row[2] })
      continue
    }
    if (/^- \(/.test(line)) continue // another kind of row (shared): not ours to use
    return undefined
  }
  return next === undefined ? { listed } : { listed, next }
}

/** Every artifact of the person's whose title is this repository's, or why the listing could not be read to its end. */
export async function listTitled(
  $: EngineInterface,
  repo: string,
): Promise<{ kind: 'ok'; listed: Listed[] } | { kind: 'unavailable'; why: string }> {
  const found: Listed[] = []
  let token: string | undefined
  for (let page = 0; page < 25; page++) {
    const input: Record<string, unknown> & { tool: string } = { tool: 'Artifact', action: 'list', limit: 200, scope: 'mine' }
    if (token !== undefined) input.page_token = token
    const reply = await callTool($, input)
    if (reply.kind !== 'ok') return { kind: 'unavailable', why: reply.kind === 'unavailable' ? reply.why : reply.text }
    const read = parseListing(reply.text)
    if (read === undefined) return { kind: 'unavailable', why: 'an unrecognised listing' }
    for (const each of read.listed) if (isTitleFor(each.title, repo)) found.push(each)
    if (read.next === undefined) return { kind: 'ok', listed: found }
    token = read.next
  }
  return { kind: 'unavailable', why: 'the listing did not end within 25 pages' }
}

/** Reads `meta/page`: the record, none (absent or not humantray's for this repository), or unavailable. */
export async function readMeta(
  $: EngineInterface,
  url: string,
  repo: string,
): Promise<{ kind: 'ok'; meta: MetaPage | undefined; version?: number } | { kind: 'unavailable'; why: string }> {
  const read = await getDoc($, url, 'meta', 'page')
  if (read.kind === 'gone') return { kind: 'ok', meta: undefined }
  if (read.kind !== 'ok') return { kind: 'unavailable', why: read.kind === 'unavailable' ? read.why : 'needs a person' }
  const doc = read.docs[0]
  if (doc === undefined) return { kind: 'ok', meta: undefined }
  return { kind: 'ok', meta: checkMeta(doc.data, repo), version: doc.version }
}

/** How many title matches have their `meta/page` read before choosing. */
export const MAX_CANDIDATES = 5

/**
 * Finds the repository's artifact by its title. Only an artifact whose
 * `meta/page` qualifies is chosen, and among several the earliest
 * `created_at`. `unqualified` lists title matches without a valid meta, which
 * only the command may take over.
 */
export async function findArtifact(
  $: EngineInterface,
  repo: string,
): Promise<{ kind: 'ok'; url?: string; meta?: MetaPage; unqualified: string[] } | { kind: 'unavailable'; why: string }> {
  // A repository with no remote has no title to be found by.
  if (titleFor(repo) === undefined) return { kind: 'ok', unqualified: [] }
  const listed = await listTitled($, repo)
  if (listed.kind !== 'ok') return listed
  const qualified: Array<{ url: string; meta: MetaPage }> = []
  const unqualified: string[] = []
  for (const each of listed.listed.slice(0, MAX_CANDIDATES)) {
    const meta = await readMeta($, each.url, repo)
    if (meta.kind !== 'ok') return meta
    if (meta.meta === undefined) unqualified.push(each.url)
    else qualified.push({ url: each.url, meta: meta.meta })
  }
  const chosen = pickArtifact(qualified)
  return chosen === undefined ? { kind: 'ok', unqualified } : { kind: 'ok', url: chosen.url, meta: chosen.meta, unqualified }
}

/** The page's rules: the whole database is the owner's alone. */
export const PAGE_RULES = [{ path: '', read: 'owner', write: 'owner' }] as const

const PUBLISHED = /^Published .* at (https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+) \(Version\b/m

/**
 * Publishes the page from `file`: a new private artifact, or a new version of
 * `url`. Never pinned. Returns the artifact's URL.
 */
export async function publishPage(
  $: EngineInterface,
  file: string,
  url: string | undefined,
): Promise<{ kind: 'ok'; url: string } | { kind: 'refused'; text: string } | { kind: 'unavailable'; why: string }> {
  const input: Record<string, unknown> & { tool: string } = {
    tool: 'Artifact',
    action: 'publish',
    file_path: file,
    description: "A repository's humantray: the asks its sessions raised, answered here when no tray is open.",
    capabilities: { db: { rules: PAGE_RULES }, user: {} },
  }
  if (url === undefined) input.icon = 'inbox'
  else input.url = url
  const reply = await callTool($, input)
  if (reply.kind === 'needs-person' || reply.kind === 'denied' || reply.kind === 'error') return { kind: 'refused', text: reply.text }
  if (reply.kind === 'unavailable') return reply
  const published = PUBLISHED.exec(reply.text)
  if (published?.[1] === undefined) return { kind: 'unavailable', why: 'an unrecognised publish reply' }
  return { kind: 'ok', url: published[1] }
}

/** Stops the watch a publish starts for this session. Best effort. */
export async function stopWatch($: EngineInterface, url: string): Promise<void> {
  await callTool($, { tool: 'ArtifactComments', action: 'watch', url, on: false })
}

/**
 * Checks that the rules keep the database the owner's: a write made as an
 * editor (`as_level: "admin"`) must be refused. A probe that was written is
 * deleted again.
 */
export async function checkRules($: EngineInterface, url: string): Promise<'owner-only' | 'open' | 'unknown'> {
  const reply = await callTool($, {
    tool: 'ArtifactData',
    action: 'set',
    url,
    collection: 'meta',
    doc_id: 'rules-probe',
    data: { probe: true },
    as_level: 'admin',
  })
  const written = parseWrite(reply)
  if (written.kind === 'refused' || written.kind === 'missing') return 'owner-only'
  if (written.kind === 'ok') {
    await callTool($, { tool: 'ArtifactData', action: 'delete', url, collection: 'meta', doc_id: 'rules-probe', if_version: written.version })
    return 'open'
  }
  if (written.kind === 'exists') return 'open'
  return 'unknown'
}

/** The link to a repository's artifact, as this container keeps it. */
export type Link = { url: string; how: 'found' | 'created' | 'given'; at: number }

const linkKey = (repo: string) => `artifact:${repo.toLowerCase()}`

export async function loadLink($: EngineInterface, repo: string): Promise<Link | undefined> {
  try {
    const held = await $.store.get(linkKey(repo))
    if (isRecord(held) && typeof held.url === 'string' && typeof held.at === 'number') {
      const how = held.how === 'created' || held.how === 'given' ? held.how : 'found'
      return { url: held.url, how, at: held.at }
    }
  } catch {
    // An unreadable store is no link.
  }
  return undefined
}

export async function saveLink($: EngineInterface, repo: string, link: Link | undefined): Promise<void> {
  try {
    if (link === undefined) await $.store.delete(linkKey(repo))
    else await $.store.set(linkKey(repo), link)
  } catch {
    // The link is also kept in the process; a later start finds it by title.
  }
}

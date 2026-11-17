// The response envelope (#32): how the local viewer sends an answer to the
// cloud session that asked, with the viewer mod's own `$.session.send`. The
// viewer cannot write the artifact's database (#31 (b)), so the asker's mod
// takes the envelope, writes the `responses` row itself, and delivers.
//
// An envelope is exactly three lines:
//
//   <humantray v="1" kind="response">
//   <one line of JSON: a ResponseRow with by "viewer", plus `to` and `artifact`>
//   </humantray>
//
// The JSON is `JSON.stringify` with every `<` then written as JSON's own
// escape for it (a backslash, then u003c), so the line holds no `<` and no raw
// line break, and nothing a person typed can close the envelope early.
//
// Unwrapping and parsing are separate steps, so that each route strips its own
// wrapper: the hooks here see the `<cross-session-message …>` form test 0
// recorded on #32; #27's `ReadNotifications` route sees an indented body.
// Everything here is pure.

import type { ResponseEnvelope } from '../types'
import { SESSION_ID, checkResponseRow } from './rows'

export const ENVELOPE_OPEN = '<humantray v="1" kind="response">'
export const ENVELOPE_CLOSE = '</humantray>'

/** The longest envelope the viewer sends, in characters. Test 0 carried 61,670 whole. */
export const ENVELOPE_MAX = 60_000

/** JSON's escape for `<`: a backslash, then u003c. Built from its parts so no tool decodes it. */
const LT_ESCAPE = `${String.fromCharCode(92)}u003c`

/** An artifact's link, as the artifact tools give it. */
export const ARTIFACT_URL = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+$/

const WRAP_OPEN = /^<cross-session-message(?:\s[^>]*)?>$/
const WRAP_CLOSE = '</cross-session-message>'

/** The envelope's text, or undefined when it would pass ENVELOPE_MAX. */
export function makeEnvelope(envelope: ResponseEnvelope): string | undefined {
  const line = JSON.stringify(envelope).replace(/</g, LT_ESCAPE)
  const text = `${ENVELOPE_OPEN}\n${line}\n${ENVELOPE_CLOSE}`
  return text.length > ENVELOPE_MAX ? undefined : text
}

/** Lines with the blank ones at either end dropped. */
const trimLines = (lines: string[]): string[] => {
  let from = 0
  let to = lines.length
  while (from < to && (lines[from] ?? '').trim() === '') from += 1
  while (to > from && (lines[to - 1] ?? '').trim() === '') to -= 1
  return lines.slice(from, to)
}

/**
 * A delivery's lines inside its `<cross-session-message …>` wrapper, when its
 * first line opens one and its last closes it; otherwise its lines as they
 * are. Blank lines at either end are dropped.
 */
export function unwrap(text: string): string[] {
  const lines = trimLines(text.replace(/\r\n?/g, '\n').split('\n'))
  const first = (lines[0] ?? '').trim()
  const last = (lines[lines.length - 1] ?? '').trim()
  if (lines.length >= 2 && WRAP_OPEN.test(first) && last === WRAP_CLOSE) return trimLines(lines.slice(1, -1))
  return lines
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The envelope these lines hold, or undefined. They must be exactly the three
 * lines (each may be indented), the JSON must read as a response row with
 * `by` "viewer", `to` a session id and `artifact` an artifact link. Anything
 * else (text around it, a second envelope, another version) is not one.
 */
export function parseEnvelope(lines: readonly string[]): ResponseEnvelope | undefined {
  const three = trimLines([...lines])
  if (three.length !== 3) return undefined
  if ((three[0] ?? '').trim() !== ENVELOPE_OPEN || (three[2] ?? '').trim() !== ENVELOPE_CLOSE) return undefined
  let body: unknown
  try {
    body = JSON.parse((three[1] ?? '').trim())
  } catch {
    return undefined
  }
  if (!isRecord(body)) return undefined
  const read = checkResponseRow(body)
  if (!('ok' in read)) return undefined
  if (body.by !== 'viewer') return undefined
  if (typeof body.to !== 'string' || !SESSION_ID.test(body.to)) return undefined
  if (typeof body.artifact !== 'string' || !ARTIFACT_URL.test(body.artifact)) return undefined
  return body as unknown as ResponseEnvelope
}

/** The envelope a delivery's whole text is, after its wrapper, or undefined. */
export const readEnvelope = (text: string): ResponseEnvelope | undefined => parseEnvelope(unwrap(text))

/**
 * The envelopes a delivery's whole text is: one (wrapped or not), or two or
 * more complete wrapped envelopes one after another (deliveries dequeued
 * together into one prompt), each checked alone. Anything else, any line
 * outside a wrapper or any wrapper that does not hold exactly one envelope,
 * is undefined: not humantray's, and passed on unchanged.
 */
export function readEnvelopes(text: string): ResponseEnvelope[] | undefined {
  const one = readEnvelope(text)
  if (one !== undefined) return [one]
  const lines = trimLines(text.replace(/\r\n?/g, '\n').split('\n'))
  const found: ResponseEnvelope[] = []
  let at = 0
  while (at < lines.length) {
    if ((lines[at] ?? '').trim() === '') {
      at += 1
      continue
    }
    if (!WRAP_OPEN.test((lines[at] ?? '').trim())) return undefined
    let end = at + 1
    while (end < lines.length && (lines[end] ?? '').trim() !== WRAP_CLOSE) end += 1
    if (end >= lines.length) return undefined
    const envelope = parseEnvelope(lines.slice(at + 1, end))
    if (envelope === undefined) return undefined
    found.push(envelope)
    at = end + 1
  }
  return found.length >= 2 ? found : undefined
}

/**
 * Whether a delivery came from another session, the only origin an envelope
 * is taken from: `peer` at both `prompt.submit` (a cold container) and
 * `session.receive` (a running one), as test 0 recorded. The engine stamps
 * the kind; a plugin name on it is the sender's claim and is not looked at.
 */
export const isEnvelopeOrigin = (origin: { kind: string } | undefined): boolean => origin?.kind === 'peer'

/** An artifact's own id, so its two link forms (`/artifact/` and `/code/artifact/`) compare equal. */
export const artifactId = (url: string): string => url.replace(/^https:\/\/claude\.ai\/(?:code\/)?artifact\//, '')

/** The response row an envelope carries: the envelope less `to` and `artifact`. */
export function rowOf(envelope: ResponseEnvelope): Record<string, unknown> {
  const { to: _to, artifact: _artifact, ...row } = envelope as unknown as Record<string, unknown>
  return row
}

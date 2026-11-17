// The response envelope (#32): made, unwrapped and parsed, in the shapes
// test 0 recorded.

import { describe, expect, test } from 'claude-code/testing'

import type { ResponseEnvelope } from '../types'
import { ENVELOPE_CLOSE, ENVELOPE_MAX, ENVELOPE_OPEN, artifactId, isEnvelopeOrigin, makeEnvelope, parseEnvelope, readEnvelope, readEnvelopes, rowOf, unwrap } from '../hooks/envelope'
import { ME, URL_A } from './artifact-world'
import { TYPED, WRAP_CLOSE, WRAP_OPEN, envelopeFor, textOf, wrapped } from './envelope-fixtures'

const ID = '01AAAAAAAAAAAAAAAAAAAENVLP1'

const RESPONSES: Array<Pick<ResponseEnvelope, 'status' | 'response'>> = [
  { status: 'acknowledged', response: { acknowledged: true, notes: TYPED } },
  { status: 'answered', response: { selected: ['TOML'], other: TYPED, notes: TYPED } },
  { status: 'answered', response: { text: TYPED, notes: TYPED } },
  { status: 'done', response: { outcome: 'not_done', feedback: TYPED, notes: TYPED } },
  { status: 'answered', response: { selected: ['Reject'], notes: TYPED } },
]

describe('making and reading an envelope', () => {
  test('every response shape round-trips through make, unwrap and parse, its Markdown whole', () => {
    for (const each of RESPONSES) {
      const envelope = envelopeFor(ID, { status: each.status, response: each.response })
      expect(readEnvelope(wrapped(textOf(envelope)))).toEqual(envelope)
      expect(readEnvelope(textOf(envelope))).toEqual(envelope)
    }
  })

  test('the JSON line holds no "<" and no raw line break, and the envelope is three lines', () => {
    const text = textOf(envelopeFor(ID, { response: { text: TYPED }, status: 'answered' }))
    const lines = text.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(ENVELOPE_OPEN)
    expect(lines[2]).toBe(ENVELOPE_CLOSE)
    expect(lines[1]?.includes('<')).toBe(false)
    expect(lines[1]?.includes('\\u003c/humantray>')).toBe(true)
  })

  test('an envelope over the limit, counted in characters, is not made', () => {
    const near = envelopeFor(ID, { response: { text: 'x'.repeat(ENVELOPE_MAX - 400) }, status: 'answered' })
    expect(makeEnvelope(near)?.length).toBeLessThanOrEqual(ENVELOPE_MAX)
    const over = envelopeFor(ID, { response: { text: 'x'.repeat(ENVELOPE_MAX) }, status: 'answered' })
    expect(makeEnvelope(over)).toBeUndefined()
  })

  test("the indented form (#27's ReadNotifications route) parses once unwrapped", () => {
    const text = textOf(envelopeFor(ID))
    const indented = text
      .split('\n')
      .map(line => `    ${line}`)
      .join('\n')
    expect(parseEnvelope(unwrap(indented))).toEqual(envelopeFor(ID))
  })

  test('the row an envelope carries is the envelope less to and artifact', () => {
    const row = rowOf(envelopeFor(ID))
    expect(row.to).toBeUndefined()
    expect(row.artifact).toBeUndefined()
    expect(row).toMatchObject({ id: ID, by: 'viewer', schema: 1 })
  })

  test('only a peer origin is one an envelope is taken from', () => {
    expect(isEnvelopeOrigin({ kind: 'peer' })).toBe(true)
    for (const kind of ['composer', 'bridge', 'task-notification', 'scheduled-trigger', 'plugin', 'sdk', 'peer-send-message']) {
      expect(isEnvelopeOrigin({ kind })).toBe(false)
    }
    expect(isEnvelopeOrigin(undefined)).toBe(false)
  })
})

describe('what is not an envelope', () => {
  const good = textOf(envelopeFor(ID))
  const [open, line, close] = good.split('\n') as [string, string, string]
  const cases: Array<[string, string]> = [
    ['text before it', `Please note:\n${good}`],
    ['text after it', `${good}\nthanks`],
    ['two envelopes', `${good}\n${good}`],
    ['another version', good.replace('v="1"', 'v="2"')],
    ['another kind', good.replace('kind="response"', 'kind="item"')],
    ['bad JSON', `${open}\n{not json\n${close}`],
    ['a body that is not a response row', `${open}\n${JSON.stringify({ schema: 1, id: ID })}\n${close}`],
    ['by the page', textOf({ ...envelopeFor(ID), by: 'page' as 'viewer' })],
    ['a to that is not a session id', textOf(envelopeFor(ID, { to: 'https://example.com/' }))],
    ['an artifact that is not an artifact link', textOf(envelopeFor(ID, { artifact: 'https://example.com/artifact/x' }))],
    ['a wrapper with an extra line', `${WRAP_OPEN}\nhello\n${good}\n${WRAP_CLOSE}`],
    ['a wrapper not closed', `${WRAP_OPEN}\n${good}`],
    ['the JSON line split', `${open}\n${line.slice(0, 20)}\n${line.slice(20)}\n${close}`],
  ]
  for (const [name, text] of cases) {
    test(`not an envelope: ${name}`, () => {
      expect(readEnvelope(text)).toBeUndefined()
    })
  }

  test('to and artifact are carried as given', () => {
    expect(readEnvelope(good)).toMatchObject({ to: ME, artifact: URL_A })
  })
})

describe('several envelopes in one text', () => {
  const one = wrapped(textOf(envelopeFor(ID)))
  const two = wrapped(textOf(envelopeFor('01AAAAAAAAAAAAAAAAAAAENVLP2')))

  test('one envelope, wrapped or bare, is one', () => {
    expect(readEnvelopes(one)).toHaveLength(1)
    expect(readEnvelopes(textOf(envelopeFor(ID)))).toHaveLength(1)
  })

  test('two or three complete wrapped envelopes, with or without blank lines between, are each read', () => {
    expect(readEnvelopes(`${one}\n${two}`)?.map(e => e.id)).toEqual([ID, '01AAAAAAAAAAAAAAAAAAAENVLP2'])
    expect(readEnvelopes(`${one}\n\n${two}\n\n${one}`)).toHaveLength(3)
  })

  test('anything else is none: text between, around, a bare envelope beside a wrapped one, a bad one among good ones', () => {
    const bare = textOf(envelopeFor(ID))
    for (const text of [
      `${one}\nand\n${two}`,
      `hello\n${one}\n${two}`,
      `${one}\n${two}\nbye`,
      `${one}\n${bare}`,
      `${one}\n${WRAP_OPEN}\nnot an envelope\n${WRAP_CLOSE}`,
      `${one}\n${WRAP_OPEN}\n${bare}`,
    ]) {
      expect(readEnvelopes(text)).toBeUndefined()
    }
  })

  test("an artifact's two link forms have one id", () => {
    expect(artifactId(URL_A)).toBe(artifactId(URL_A.replace('/artifact/', '/code/artifact/')))
  })
})

// Deliveries of a response envelope, in the shapes test 0 on #32 recorded
// (receiver Claude Code 2.1.326, sender 2.1.325, a local CLI session with
// Remote Control): the whole text as a hook saw it, with the sender's id
// replaced by a made-up one. A cold container saw it at `prompt.submit` with
// origin `{ kind: 'peer' }`, `isMeta: true` and no `turnId`; a running one at
// `session.receive` with origin `{ kind: 'peer', plugin }`.

import type { ResponseEnvelope } from '../types'
import { makeEnvelope } from '../hooks/envelope'
import { ME, URL_A } from './artifact-world'

export const SENDER = 'session_FAKEFAKEFAKEFAKEFAKELOCAL'

/** The wrapper's first line, as test 0 saw it (the sender's id made up). */
export const WRAP_OPEN = `<cross-session-message from="bridge:${SENDER}" from-name="claude-plugins-local" from-mode="prompting">`
export const WRAP_CLOSE = '</cross-session-message>'

/** A delivery of `envelope` text, wrapped as the engine delivered it. */
export const wrapped = (envelope: string): string => `${WRAP_OPEN}\n${envelope}\n${WRAP_CLOSE}`

/** The `prompt.submit` input of a cold delivery. */
export const coldSubmit = (text: string) => ({ text, origin: { kind: 'peer' as const }, isMeta: true as const, wait: false })

/** The `session.receive` input of a delivery to a running container. */
export const warmReceive = (text: string) => ({ origin: { kind: 'peer' as const, plugin: 'humantray' }, text })

/** Typed Markdown with everything that could break a naive envelope (as test 0's answers). */
export const TYPED = [
  '## An answer',
  '',
  '- first, with **bold**',
  '  - nested, with `inline <code>`',
  '- [x] done',
  '',
  '> a literal </humantray> and <humantray v="1" kind="response"> inside',
  '',
  '```ts',
  'const x = "<script>alert(1)</script>" // \\ "quotes"',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | <b>2</b> |',
  'Unicode: é 漢字 🙂, a tab:\there',
].join('\n')

/** An envelope's body for an approve item (or any response given). */
export function envelopeFor(id: string, fields: Partial<ResponseEnvelope> = {}): ResponseEnvelope {
  return {
    schema: 1,
    id,
    answer_id: `viewer${id.slice(-10)}bbbbbbbb`,
    response: { selected: ['Approve'] },
    status: 'answered',
    answered_at: 1_800_000_000_000,
    seen: { bumps: 0, updated: 0 },
    by: 'viewer',
    to: ME,
    artifact: URL_A,
    ...fields,
  }
}

/** The envelope's text; fails the test if it would be too long. */
export function textOf(envelope: ResponseEnvelope): string {
  const text = makeEnvelope(envelope)
  if (text === undefined) throw new Error('the envelope is too long')
  return text
}

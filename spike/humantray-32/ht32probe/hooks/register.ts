import type { EngineInterface, Register } from 'claude-code'

// Throwaway probe for test 0 of issue 32 (humantray viewer). Never merged.
//
// Local side (the owner's computer): `/ht32-send`, `/ht32-run` and `/ht32-log`
// send a real humantray response envelope to a cloud session with the mod's
// own `$.session.send`, and record what each send reported.
//
// Cloud side (the target session): logging hooks on every place a delivery
// might surface, and the take-and-submit mechanism: a hook that sees an
// envelope stops it from reaching the model, then, detached, makes one tool
// call and one `$.prompt.submit` of a fixed line that carries no answer text.
//
// No ids are written in this file (the repository is public): the target
// session id is given at run time and checked against a fixed pattern.

const OPEN = '<humantray v="1" kind="response">'
const CLOSE = '</humantray>'
const SESSION_RE = /^session_[A-Za-z0-9]{20,64}$/
const LABEL_RE = /^[a-z0-9-]{1,20}$/
const LOG_MAX = 400
const MIRROR = '/root/ht32probe/log.json'

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

const iso = () => new Date().toISOString()
const short = (v: unknown, n = 2000): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s === undefined) return 'undefined'
  return s.length > n ? `${s.slice(0, n)}…(+${s.length - n})` : s
}
const errText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : short(err, 300))

/** FNV-1a over UTF-16 code units: 8 hex digits, to check a text arrived whole. */
const fnv = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

// One log write at a time, so concurrent hooks do not lose entries.
let chain: Promise<void> = Promise.resolve()
function log($: EngineInterface, kind: string, data: Record<string, unknown>) {
  const entry = { t: iso(), kind, data: JSON.parse(JSON.stringify(data)) as Json }
  chain = chain
    .then(async () => {
      const prev = ((await $.store.get('log')) as Json[] | undefined) ?? []
      const next = [...prev, entry].slice(-LOG_MAX)
      await $.store.set('log', next)
      try {
        await $.fs.write(MIRROR, JSON.stringify(next, null, 1))
      } catch {
        // The mirror is a convenience; the store holds the log.
      }
    })
    .catch(() => undefined)
  return chain
}

async function attempt<T>(f: () => Promise<T> | T): Promise<T | { unavailable: string }> {
  try {
    return await f()
  } catch (err) {
    return { unavailable: errText(err).slice(0, 200) }
  }
}

async function bootTime($: EngineInterface): Promise<string> {
  try {
    const r = await $.process.run(['uptime', '-s'], { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : `exit ${r.exitCode}`
  } catch (err) {
    return `unavailable: ${errText(err).slice(0, 100)}`
  }
}

// --- the envelope ---------------------------------------------------------

const random = (n: number): string => {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes)
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from(bytes, b => abc[b % abc.length]).join('')
}

/** A typed Markdown answer with everything that could break a naive envelope. */
function answerText(label: string, long: boolean): string {
  const marker = `HT32ENVONLY${label.replace(/-/g, '')}`
  const lines = [
    `## Answer for test 0 (${label}) ${marker}`,
    '',
    'A list:',
    '- first, with **bold** and *italic*',
    '  - nested, with `inline <code>`',
    '- [x] a done task',
    '- [ ] an open task',
    '',
    '> a quote with a literal </humantray> and <humantray v="1" kind="response"> inside',
    '',
    '```ts',
    'const x = "<script>alert(1)</script>" // \\ a backslash, "quotes"',
    '```',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | <b>2</b> |',
    '',
    '[a link](https://example.com/?a=1&b=2) and ![an image](https://example.com/x.png)',
    'Unicode: é ü 漢字 🙂, a tab:\there, trailing spaces   ',
  ]
  let text = lines.join('\n')
  if (long) {
    const pad = '\n- padding line to make this answer long, to see what a send allows'
    while (text.length < 60_000) text += pad
  }
  return text
}

function makeEnvelope(label: string, to: string, long: boolean): { text: string; answerLen: number; answerHash: string; id: string } {
  const answer = answerText(label, long)
  const id = `HT32PROBE${label.replace(/-/g, '').toUpperCase()}${random(6).toUpperCase()}`.slice(0, 26)
  const body = {
    schema: 1,
    id,
    answer_id: random(24),
    response: { text: answer, notes: `notes for ${label}: line one\nline two` },
    status: 'answered',
    answered_at: Date.now(),
    seen: { bumps: 0, updated: Date.now() },
    by: 'viewer',
    to,
    artifact: 'https://claude.ai/artifact/ht32-probe-not-a-real-artifact',
    probe: { label, answerLen: answer.length, answerHash: fnv(answer), sentAt: iso() },
  }
  // Every "<" is written as the JSON escape backslash-u003c, so nothing typed can close the envelope.
  const json = JSON.stringify(body).replace(/</g, '\\u003c')
  return { text: `${OPEN}\n${json}\n${CLOSE}`, answerLen: answer.length, answerHash: fnv(answer), id }
}

/** What the receiving side can tell about an envelope found in some text. */
function inspect(text: string): Record<string, unknown> {
  const at = text.indexOf(OPEN)
  if (at < 0) return { envelope: false }
  const end = text.indexOf(`\n${CLOSE}`, at)
  const before = text.slice(0, at)
  const after = end < 0 ? '' : text.slice(end + CLOSE.length + 1)
  const out: Record<string, unknown> = {
    envelope: true,
    textLen: text.length,
    before: short(before, 1500),
    after: short(after, 600),
    closed: end >= 0,
  }
  if (end < 0) return out
  const inner = text.slice(at + OPEN.length, end)
  const innerLines = inner.split('\n')
  out.innerLineCount = innerLines.length
  out.innerLinePrefixes = innerLines.map(l => JSON.stringify(l.slice(0, 12)))
  const jsonLine = innerLines.map(l => l.trim()).filter(l => l !== '')
  try {
    const body = JSON.parse(jsonLine.join('')) as {
      response?: { text?: string }
      probe?: { label?: string; answerLen?: number; answerHash?: string; sentAt?: string }
    }
    const answer = body.response?.text ?? ''
    out.label = body.probe?.label
    out.sentAt = body.probe?.sentAt
    out.answerIntact = answer.length === body.probe?.answerLen && fnv(answer) === body.probe?.answerHash
    out.answerLen = answer.length
    out.rawHasLessThan = inner.includes('<')
  } catch (err) {
    out.parseError = errText(err)
    out.innerHead = short(inner, 400)
  }
  return out
}

// --- the take-and-submit mechanism (cloud side) ---------------------------

function takeDetached($: EngineInterface, via: string, label: unknown) {
  void (async () => {
    const t0 = Date.now()
    const read = await attempt(() => $.tool.call({ tool: 'Glob', pattern: '/etc/host*' } as never))
    const readMs = Date.now() - t0
    const line = `ht32probe: took the ${String(label)} envelope via ${via}; a detached tool call ${
      typeof read === 'object' && read !== null && 'unavailable' in read ? 'failed' : 'ran'
    } in ${readMs} ms. No answer text is in this line.`
    const submitted = await attempt(() => $.prompt.submit({ text: line }))
    await log($, 'take', { via, label, readMs, read: short(read, 300), submitted: short(submitted, 300), boot: await bootTime($) })
  })().catch(err => log($, 'take-error', { via, error: errText(err) }))
}

// --- the local sender -----------------------------------------------------

type Sent = { label: string; to: string; at: string; isDelivered?: boolean; reason?: string; ms: number; textLen: number; answerLen: number; answerHash: string; error?: string }

async function sendOne($: EngineInterface, to: string, label: string): Promise<Sent> {
  const env = makeEnvelope(label, to, label === 'long')
  const at = iso()
  const t0 = Date.now()
  let sent: Sent
  try {
    const r = await $.session.send({ to: { sessionId: to }, text: env.text })
    sent = { label, to, at, isDelivered: r.isDelivered, reason: r.reason, ms: Date.now() - t0, textLen: env.text.length, answerLen: env.answerLen, answerHash: env.answerHash }
  } catch (err) {
    sent = { label, to, at, ms: Date.now() - t0, textLen: env.text.length, answerLen: env.answerLen, answerHash: env.answerHash, error: errText(err) }
  }
  await log($, 'sent', sent)
  return sent
}

const SEQUENCES: Record<string, Array<{ label: string; afterMs: number }>> = {
  // From a stopped container: the first send must meet it stopped.
  cold: [
    { label: 'stopped', afterMs: 0 },
    { label: 'midturn', afterMs: 3 * 60_000 },
    { label: 'idle', afterMs: 7 * 60_000 },
    { label: 'long', afterMs: 8 * 60_000 },
  ],
  // When the target is already awake and in a turn.
  awake: [
    { label: 'midturn', afterMs: 0 },
    { label: 'idle', afterMs: 4 * 60_000 },
    { label: 'long', afterMs: 5 * 60_000 },
  ],
}

const timers: Array<{ cancel: () => void }> = []

const summary = (s: Sent) =>
  `${s.label}: ${s.error ? `threw ${s.error}` : s.isDelivered ? 'delivered' : `NOT delivered (${s.reason ?? 'no reason'})`} at ${s.at}, ${s.ms} ms, envelope ${s.textLen} chars`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of [
      ['ht32-send', 'Test 0 of issue 32: send one envelope. /ht32-send <session id> <label>'],
      ['ht32-run', 'Test 0 of issue 32: send the timed sequence. /ht32-run <session id> [cold|awake]'],
      ['ht32-log', 'Test 0 of issue 32: show what was sent, to paste back'],
    ] as const) {
      await attempt(() => $.command.register({ name, description }))
    }
    const ran = await next(e)
    await log($, 'session.start', {
      id: await attempt(() => $.session.id()),
      version: await attempt(() => $.session.version()),
      boot: await bootTime($),
    })
    return ran
  })

  // --- every candidate hook, logged ---
  on('session.receive', async ($, e, next) => {
    const seen = inspect(e.text)
    await log($, 'session.receive', { origin: e.origin as unknown as Json, agentId: e.agentId ?? null, hasEvent: e.event !== undefined, ...seen, text: seen.envelope ? undefined : short(e.text, 1500) })
    if (seen.envelope === true) {
      takeDetached($, 'session.receive', seen.label)
      return { consumed: 'ht32probe took a humantray envelope' }
    }
    return next(e)
  }).catch(($, e, next) => (e.text.includes(OPEN) ? { consumed: 'ht32probe took a humantray envelope (after an error)' } : next(e)))

  on('prompt.submit', async ($, e, next) => {
    const seen = inspect(e.text)
    await log($, 'prompt.submit', { origin: (e.origin ?? null) as unknown as Json, isMeta: e.isMeta ?? false, turnId: e.turnId ?? null, wait: e.wait, ...seen, text: seen.envelope ? undefined : short(e.text, 600) })
    if (seen.envelope === true && e.origin?.kind !== 'plugin') {
      takeDetached($, 'prompt.submit', seen.label)
      return { drop: 'ht32probe took a humantray envelope' }
    }
    return next(e)
  }).catch(($, e, next) => (e.text.includes(OPEN) ? { drop: 'ht32probe took a humantray envelope (after an error)' } : next(e)))

  on('session.append', async ($, e, next) => {
    const text = JSON.stringify(e.message)
    const seen = inspect(text)
    await log($, 'session.append', { door: e.door as unknown as Json, origin: e.origin as unknown as Json, agentId: e.agentId ?? null, envelope: seen.envelope, head: short(text, 400) })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await log($, 'turn.start', { turnId: e.turnId, agentId: e.agentId ?? null, envelope: e.text.includes(OPEN), head: short(e.text, 300) })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await log($, 'turn.complete', { agentId: (e as { agentId?: string }).agentId ?? null })
    return next(e)
  })

  on('tool.call', { tool: 'ReadNotifications' }, async ($, e, next) => {
    const result = await next(e)
    const text = JSON.stringify(result)
    await log($, 'tool.call ReadNotifications', { envelope: text.includes(OPEN.replace(/"/g, '\\"')) || text.includes(OPEN), head: short(text, 800) })
    return result
  }).catch(($, e, next) => next(e))

  // --- the local sender's commands ---
  on('command.run', { command: 'ht32-send' }, async ($, e) => {
    const [to, label] = (e.args ?? '').trim().split(/\s+/)
    if (to === undefined || !SESSION_RE.test(to) || label === undefined || !LABEL_RE.test(label)) {
      return { text: 'Usage: /ht32-send <session id> <label>', isTextDisplayOnly: true as const }
    }
    const sent = await sendOne($, to, label)
    return { text: summary(sent), isTextDisplayOnly: true as const }
  })

  on('command.run', { command: 'ht32-run' }, async ($, e) => {
    const [to, mode = 'cold'] = (e.args ?? '').trim().split(/\s+/)
    const steps = SEQUENCES[mode]
    if (to === undefined || !SESSION_RE.test(to) || steps === undefined) {
      return { text: 'Usage: /ht32-run <session id> [cold|awake]', isTextDisplayOnly: true as const }
    }
    for (const t of timers.splice(0)) t.cancel()
    await log($, 'run', { to, mode })
    for (const step of steps) {
      if (step.afterMs === 0) void sendOne($, to, step.label)
      else timers.push($.clock.after(step.afterMs, () => void sendOne($, to, step.label)))
    }
    const last = Math.max(...steps.map(s => s.afterMs)) / 60_000
    return {
      text: `Sending ${steps.map(s => `${s.label} at +${s.afterMs / 60_000} min`).join(', ')}. Keep this session open for ${last + 1} minutes, then run /ht32-log.`,
      isTextDisplayOnly: true as const,
    }
  })

  on('command.run', { command: 'ht32-log' }, async $ => {
    const entries = (((await $.store.get('log')) as Array<{ t: string; kind: string; data: Sent }> | undefined) ?? []).filter(x => x.kind === 'sent')
    const info = await attempt(() => ($.session as unknown as { info: () => Promise<{ transcriptPath?: string }> }).info())
    const path = typeof info === 'object' && info !== null && 'transcriptPath' in info ? info.transcriptPath : undefined
    const version = await attempt(() => $.session.version())
    const lines = [
      `ht32probe sends (${entries.length}), Claude Code ${short(version, 200)}:`,
      ...entries.map(x => `- ${summary(x.data)}, answer ${x.data.answerLen} chars, hash ${x.data.answerHash}`),
      `This session's transcript: ${path ?? '(unknown on this build: see /status)'}`,
    ]
    return { text: lines.join('\n'), isTextDisplayOnly: true as const }
  })
}

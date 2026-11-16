import type { EngineInterface, Register } from 'claude-code'

// Throwaway probe for spike issue 31 of the humantray epic. Never merged.
// Every action is fixed: no free-form commands, tool calls or message text.
// Ids are never written into this file (the repository is public): the
// artifact URL and the peer session id are given at run time, checked
// against fixed patterns, and kept in this plugin's own $.store.

const COLLECTION = 'ht31'
const URL_RE = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9_-]{6,64}$/
const SESSION_RE = /^(cse_|session_)[A-Za-z0-9]{10,64}$/
const TITLE_PREFIX = 'humantray-spike-31'
const CREATED_TITLE = 'humantray-spike-31 created by mod'
const MARK = 'HT31-PROBE'
const LOG_MAX = 300

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Cfg = { url?: string; peer?: string }

const now = () => new Date().toISOString()
const short = (v: unknown, n = 4000) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s
}
const errText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : short(err, 500))

async function log($: EngineInterface, kind: string, data: unknown) {
  const whole = JSON.stringify(data ?? null)
  const entry = { t: now(), kind, data: (whole.length <= 3000 ? JSON.parse(whole) : short(whole, 3000)) as Json }
  try {
    const prev = ((await $.store.get('log')) as Json[] | undefined) ?? []
    const next = [...prev, entry].slice(-LOG_MAX)
    await $.store.set('log', next)
  } catch (err) {
    $.ui.status(`ht31probe log failed: ${errText(err).slice(0, 80)}`)
  }
}

async function cfg($: EngineInterface): Promise<Cfg> {
  return ((await $.store.get('cfg')) as Cfg | undefined) ?? {}
}

async function timed<T>(f: () => Promise<T>): Promise<{ ms: number; ok: boolean; value?: T; error?: string }> {
  const t0 = Date.now()
  try {
    const value = await f()
    return { ms: Date.now() - t0, ok: true, value }
  } catch (err) {
    return { ms: Date.now() - t0, ok: false, error: errText(err) }
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

async function where($: EngineInterface) {
  const info = await $.session.info().catch(err => ({ error: errText(err) }))
  return {
    id: await $.session.id().catch(errText),
    version: await $.session.version().catch(errText),
    platform: (info as { platform?: string }).platform,
    isHosted: (info as { isHosted?: boolean }).isHosted,
  }
}

// --- the artifact database, through the ArtifactData tool ---------------

async function dataCall($: EngineInterface, input: Record<string, unknown>) {
  const ran = await $.tool.call({ tool: 'ArtifactData', ...input } as never)
  const r = ran as { deny?: string; result?: unknown; text?: string; isError?: boolean }
  if (r.deny !== undefined) return { deny: r.deny }
  return { isError: r.isError, text: short(r.text ?? r.result, 3000) }
}

async function dbWrite($: EngineInterface, url: string, origin: string, extra: Record<string, Json> = {}) {
  const w = await where($)
  const docId = `${origin}-${Date.now()}`
  const data = { mark: MARK, origin, at: now(), session: String(w.id), platform: String(w.platform), note: 'spike 31 test row, no real data', ...extra }
  const res = await timed(() => dataCall($, { action: 'set', url, collection: COLLECTION, doc_id: docId, data }))
  return { docId, ...res }
}

async function dbRead($: EngineInterface, url: string) {
  const rows = await timed(() => dataCall($, { action: 'list', url, collection: COLLECTION, query: { limit: 50 } }))
  const responses = await timed(() => dataCall($, { action: 'list', url, collection: 'responses', query: { limit: 50 } }))
  return { rows, responses }
}

// --- finding and creating the artifact ----------------------------------

async function artifactCall($: EngineInterface, input: Record<string, unknown>) {
  const ran = await $.tool.call({ tool: 'Artifact', ...input } as never)
  const r = ran as { deny?: string; result?: unknown; text?: string; isError?: boolean }
  if (r.deny !== undefined) return { deny: r.deny, text: '' }
  const text = typeof r.text === 'string' ? r.text : JSON.stringify(r.result)
  return { isError: r.isError, text }
}

async function findArtifacts($: EngineInterface) {
  const res = await timed(() => artifactCall($, { action: 'list', limit: 100 }))
  const text = res.value?.text ?? ''
  const lines = text.split('\n').filter(l => l.includes(TITLE_PREFIX))
  const urls = lines.map(l => (l.match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/) ?? [''])[0])
  return { ms: res.ms, ok: res.ok, error: res.error, deny: res.value?.deny, matches: lines.map((l, i) => ({ line: l.slice(0, 300), url: urls[i] })), listHead: text.slice(0, 600) }
}

const CREATED_PAGE = `<title>${CREATED_TITLE}</title>
<style>:root{--bg:#f6f7f9;--fg:#1b2230}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#12161d;--fg:#e3e7ee;color-scheme:dark}}:root[data-theme="dark"]{--bg:#12161d;--fg:#e3e7ee;color-scheme:dark}body{background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px}</style>
<h1>${CREATED_TITLE}</h1><p>Throwaway page created by a probe mod for spike issue 31. No real data. Delete it when the spike is done.</p>`

async function createIfMissing($: EngineInterface) {
  const found = await findArtifacts($)
  const existing = found.matches.find(m => m.line.includes(CREATED_TITLE))
  if (existing) return { created: false, found }
  const info = await $.session.info()
  const dir = info.scratchpadDir ?? '/tmp'
  const path = `${dir}/ht31probe/humantray-spike-31-created-by-mod.html`
  await $.fs.write(path, CREATED_PAGE)
  const res = await timed(() =>
    artifactCall($, { action: 'publish', file_path: path, icon: 'flask', description: 'Throwaway page a probe mod created for spike issue 31.', capabilities: { db: {}, user: {} } }),
  )
  return { created: true, found, publish: { ms: res.ms, ok: res.ok, error: res.error, deny: res.value?.deny, text: (res.value?.text ?? '').slice(0, 600) } }
}

// --- messages to another session -----------------------------------------

const msgText = async ($: EngineInterface, via: string) => {
  const w = await where($)
  return `${MARK} message via ${via} from session ${String(w.id)} (platform ${String(w.platform)}, hosted ${String(w.isHosted)}) at ${now()}. Test for spike issue 31; no action needed.`
}

async function sendAll($: EngineInterface, peer: string) {
  const out: Record<string, unknown> = {}
  out.sessionSend = await timed(async () => $.session.send({ to: { sessionId: peer }, text: await msgText($, '$.session.send') }))
  for (const server of ['claude-code-remote', 'claude.ai Claude Code Remote']) {
    out[`mcp:${server}`] = await timed(async () => $.mcp.call(server, 'send_message', { session_id: peer, message: await msgText($, `$.mcp.call ${server}`) }))
  }
  return out
}

async function toolsOfInterest($: EngineInterface) {
  const names = (await $.tool.list()).map(t => t.name)
  return {
    count: names.length,
    artifactish: names.filter(n => /artifact/i.test(n)),
    notifications: names.filter(n => /notification/i.test(n)),
    sessionish: names.filter(n => /send_message|SendMessage|ListAgents|get_session|list_sessions/i.test(n)),
    mcpServers: [...new Set(names.filter(n => n.startsWith('mcp__')).map(n => n.split('__')[1]))],
  }
}

// --- the probe actions ----------------------------------------------------

async function runAction($: EngineInterface, action: string, args: Record<string, unknown>) {
  const c = await cfg($)
  const url = typeof args.url === 'string' ? args.url : c.url
  const peer = typeof args.session_id === 'string' ? args.session_id : c.peer
  const needUrl = () => {
    if (!url || !URL_RE.test(url)) throw new Error('no artifact URL: pass args.url (https://claude.ai/artifact/<id>) or run /ht31-setup first')
    return url
  }
  const needPeer = () => {
    if (!peer || !SESSION_RE.test(peer)) throw new Error('no peer session id: pass args.session_id (session_...) or run /ht31-setup first')
    return peer
  }
  switch (action) {
    case 'setup': {
      const next: Cfg = { ...c }
      if (typeof args.url === 'string') next.url = needUrl()
      if (typeof args.session_id === 'string') next.peer = needPeer()
      await $.store.set('cfg', next)
      return next
    }
    case 'env':
      return { where: await where($), boot: await bootTime($), tools: await toolsOfInterest($), cfg: c }
    case 'db-write':
      return dbWrite($, needUrl(), String(args.origin ?? 'probe').replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'probe')
    case 'db-read':
      return dbRead($, needUrl())
    case 'artifact-find':
      return findArtifacts($)
    case 'artifact-create':
      return createIfMissing($)
    case 'send':
      return sendAll($, needPeer())
    case 'store-mark': {
      const mark = { at: now(), boot: await bootTime($), where: await where($) }
      await $.store.set('mark', mark)
      return { set: mark, keys: await $.store.keys() }
    }
    case 'store-read':
      return { mark: await $.store.get('mark'), bootNow: await bootTime($), starts: await $.store.get('starts'), keys: await $.store.keys() }
    case 'log':
      return ((await $.store.get('log')) as Json[] | undefined ?? []).slice(-Number(args.last ?? 40))
    default:
      throw new Error(`unknown action ${action}`)
  }
}

// The local run the owner starts with one command: everything (b) and (d)
// need, the answers written to the artifact (if reachable) and returned.
async function localRun($: EngineInterface) {
  const c = await cfg($)
  const report: Record<string, unknown> = { at: now(), where: await where($), tools: await toolsOfInterest($).catch(errText) }
  if (c.url) {
    report.dbWrite = await dbWrite($, c.url, 'local').catch(errText)
    report.dbRead = await dbRead($, c.url).catch(errText)
  } else report.db = 'skipped: no artifact URL set'
  if (c.peer) report.send = await sendAll($, c.peer).catch(errText)
  else report.send = 'skipped: no peer session id set'
  await log($, 'local-run', report)
  if (c.url) {
    report.reportRow = await dbWrite($, c.url, 'localreport', { report: short(report, 6000) }).catch(errText)
  }
  return report
}

// Which hook sees a message from another session. Logged in full, and
// when an artifact URL is set, recorded as a row so the other side can
// read it without the owner copying anything.
async function seen($: EngineInterface, hook: string, text: string) {
  await log($, hook, { len: text.length, text: text.slice(0, 2000) })
  if (!text.includes(MARK) && !/cross-session|another Claude session|unread notification/i.test(text)) return
  const c = await cfg($)
  if (c.url) await dbWrite($, c.url, 'received', { hook, excerpt: text.slice(0, 400) }).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const starts = (((await $.store.get('starts')) as Json[] | undefined) ?? []).slice(-20)
    const entry = { at: now(), boot: await bootTime($), source: (e as { source?: string }).source ?? null }
    await $.store.set('starts', [...starts, entry])
    await log($, 'session.start', { entry, where: await where($) })
    try {
      await $.tool.register({
        name: 'probe',
        description:
          'Spike probe for issue 31. Input {action, args}. Fixed actions: setup (args.url, args.session_id), env, db-write (args.origin), db-read, artifact-find, artifact-create, send (args.session_id), store-mark, store-read, log (args.last).',
        inputSchema: { type: 'object', properties: { action: { type: 'string' }, args: { type: 'object' } }, required: ['action'] },
      })
      await $.command.register({ name: 'ht31-setup', description: 'Spike 31: set the artifact URL and the cloud session id', argumentHint: '<artifact-url> <cloud-session-id>' })
      await $.command.register({ name: 'ht31-run', description: 'Spike 31: run the local checks and print the report' })
      await $.command.register({ name: 'ht31-log', description: 'Spike 31: print the last 40 log entries' })
    } catch (err) {
      await log($, 'register.error', errText(err))
    }
    return next(e)
  })

  on('command.run', { command: 'ht31-setup' }, async ($, e) => {
    const [url, peer] = e.args.trim().split(/\s+/)
    try {
      const out = await runAction($, 'setup', { url, session_id: peer })
      return { text: `ht31probe: set ${short(out)}` }
    } catch (err) {
      return { text: `ht31probe: ${errText(err)}` }
    }
  })
  on('command.run', { command: 'ht31-run' }, async $ => ({ text: `ht31probe local report:\n${JSON.stringify(await localRun($), null, 1)}` }))
  on('command.run', { command: 'ht31-log' }, async $ => ({ text: `ht31probe log:\n${JSON.stringify(await runAction($, 'log', { last: 40 }), null, 1)}` }))

  on('session.receive', async ($, e, next) => {
    await seen($, 'session.receive', `${short(e.origin, 300)} ${e.text}`)
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    await seen($, 'prompt.submit', `${short(e.origin, 300)} ${e.text}`)
    return next(e)
  })
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'ReadNotifications') return next(e)
    const ran = await next(e)
    await seen($, 'tool.call:ReadNotifications', short(ran, 3000))
    return ran
  })
  on('turn.start', async ($, e, next) => {
    await log($, 'turn.start', e)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__ht31probe__probe' }, async ($, e) => {
    const input = e as unknown as { action: string; args?: Record<string, unknown> }
    let out: unknown
    const t0 = Date.now()
    try {
      out = await runAction($, input.action, input.args ?? {})
    } catch (err) {
      out = { error: errText(err) }
    }
    const ms = Date.now() - t0
    await log($, `probe.${input.action}`, { ms, out: short(out, 2500) })
    return { result: JSON.stringify({ ms, out }, null, 1).slice(0, 20000) }
  })
}

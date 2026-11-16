import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Probe } from '../types'

// Throwaway probe for issue 22 of the humantray epic. Every action is fixed:
// no free-form commands, tool calls or URLs.
const LOG = '/tmp/ht22probe.log' // was a session scratchpad path
const REPO_DIR = '/home/user/claude-plugins'
const LEAD = '<lead session id>' // redacted: this repository is public
const PANE = 'ht22'
const MARK = 'KESTREL-7'
const ORPHAN_REFS = ['refs/heads/spike/humantray-22-orphan', 'refs/humantray/items']
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'humantray spike',
  GIT_AUTHOR_EMAIL: 'noreply@anthropic.com',
  GIT_COMMITTER_NAME: 'humantray spike',
  GIT_COMMITTER_EMAIL: 'noreply@anthropic.com',
}

const probe = atom({ plugin: 'ht22probe', key: 'probe' } as const, { ticks: 0, lastTick: 0, renders: 0, received: 0 }, { shape: 'probe-1' })

const seen = new Set<string>()

async function log($: EngineInterface, kind: string, data: unknown) {
  const line = JSON.stringify({ t: new Date(await $.clock.now()).toISOString(), kind, data }) + '\n'
  try {
    await $.process.run(['sh', '-c', 'cat >> "$1"', 'sh', LOG], { stdin: line })
  } catch (err) {
    $.ui.status(`ht22probe log failed: ${String(err).slice(0, 80)}`)
  }
}

async function git($: EngineInterface, args: string[], stdin?: string) {
  const r = await $.process.run(['git', ...args], { cwd: REPO_DIR, env: GIT_ENV, stdin, timeoutMs: 60000 })
  return { argv: ['git', ...args].join(' '), exitCode: r.exitCode, stdout: r.stdout.trim(), stderr: r.stderr.trim() }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await log($, 'session.start', { e, surfaces: await $.session.surfaces(), id: await $.session.id(), version: await $.session.version() })
    const opened = await $.ui.open({ id: PANE, title: `HT22 spike ${MARK}` })
    await log($, 'ui.open', opened)
    $.clock.every(60000, async () => {
      const now = await $.clock.now()
      await update($, probe, p => ({ ...p, ticks: p.ticks + 1, lastTick: now }))
      const p = await read($, probe)
      await log($, 'tick', { ticks: p.ticks, surfaces: await $.session.surfaces() })
      $.ui.status(`HT22 tick ${p.ticks}`)
    })
    try {
      await $.tool.register({
        name: 'probe',
        description:
          'Spike probe for issue 22. Input {action}. Fixed actions: repo, panes, surfaces, state, mcp-tools, mcp-get-session, mcp-send-lead, session-send-lead, toolcall-get-session, git-orphan (args.ref: one of two fixed refs), github-visibility.',
        inputSchema: { type: 'object', properties: { action: { type: 'string' }, args: { type: 'object' } }, required: ['action'] },
      })
    } catch (err) {
      await log($, 'tool.register.error', String(err))
    }
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    await log($, 'session.attach', e)
    return next(e)
  })
  on('session.detach', async ($, e, next) => {
    await log($, 'session.detach', e)
    return next(e)
  })

  // (b) Inbound deliveries. Everything is logged in full, so nothing the
  // rewrite shortens is lost; only a delivery carrying the test marker is
  // rewritten to one line.
  on('session.receive', async ($, e, next) => {
    await update($, probe, p => ({ ...p, received: p.received + 1 }))
    await log($, 'session.receive', { origin: e.origin, agentId: e.agentId, event: e.event, textLen: e.text.length, text: e.text.slice(0, 3000) })
    if (e.text.includes('HT22-RELAY')) {
      const kind = (e.origin as { kind: string }).kind
      const ran = await next({ ...e, text: `ht22probe: relay received (${e.text.length} chars) from ${kind}` })
      await log($, 'session.receive.rewritten', ran)
      return ran
    }
    const ran = await next(e)
    await log($, 'session.receive.passed', ran)
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    const { attachments, ...rest } = e
    await log($, 'prompt.submit', { ...rest, text: e.text.slice(0, 3000), textLen: e.text.length, attachments: attachments?.length })
    return next(e)
  })

  // (b) In a cloud session peer messages arrive through the ReadNotifications
  // tool, not session.receive. Log the full result, then rewrite only the
  // body of a test message carrying the marker to one line.
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'ReadNotifications') return next(e)
    const ran = await next(e)
    const raw = JSON.stringify(ran)
    await log($, 'readnotifications.result', { keys: Object.keys(ran), resultType: typeof (ran as any).result, raw: raw.slice(0, 6000) })
    if (!raw.includes('HT22-RELAY') || (ran as any).deny !== undefined) return ran
    const swap = (v: unknown): unknown =>
      typeof v === 'string'
        ? v.replace(/HT22-RELAY[\s\S]*?(?=\s*<\/cross-session-message>)/g, m => `ht22probe: relay rewritten to one line (${m.length} chars)`)
        : Array.isArray(v)
          ? v.map(swap)
          : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]))
            : v
    const rewritten = { ...ran, result: swap((ran as any).result), text: swap((ran as any).text) } as typeof ran
    await log($, 'readnotifications.rewritten', JSON.stringify(rewritten).slice(0, 3000))
    return rewritten
  })

  on('turn.start', async ($, e, next) => {
    await log($, 'turn.start', e)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    await log($, 'turn.complete', { agentId: (e as { agentId?: string }).agentId })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__ht22probe__probe' }, async ($, e) => {
    const input = e as unknown as { action: string; args?: Record<string, unknown> }
    const a = input.args ?? {}
    let out: unknown
    try {
      switch (input.action) {
        case 'repo':
          out = await $.session.repo()
          break
        case 'panes':
          out = await $.ui.panes()
          break
        case 'surfaces':
          out = await $.session.surfaces()
          break
        case 'state':
          out = await read($, probe)
          break
        case 'mcp-tools':
          out = (await $.tool.list()).map(t => t.name).filter(n => n.startsWith('mcp__claude-code-remote__'))
          break
        case 'mcp-get-session':
          out = await $.mcp.call('claude-code-remote', 'get_session', {})
          break
        case 'mcp-send-lead':
          out = await $.mcp.call('claude-code-remote', 'send_message', {
            session_id: LEAD,
            message: 'ht22probe (worker for #22): test message sent by the mod itself via $.mcp.call send_message, for check (c). No action needed.',
          })
          break
        case 'session-send-lead':
          out = await $.session.send({
            to: { sessionId: LEAD },
            text: 'ht22probe (worker for #22): test message sent by the mod itself via $.session.send, for check (c). No action needed.',
          })
          break
        case 'toolcall-get-session':
          out = await $.tool.call({ tool: 'mcp__claude-code-remote__get_session' } as any)
          break
        case 'git-orphan': {
          const ref = String(a.ref ?? '')
          if (!ORPHAN_REFS.includes(ref)) {
            out = `ref must be one of ${ORPHAN_REFS.join(', ')}`
            break
          }
          const steps: unknown[] = []
          const item = JSON.stringify({ id: 'HT-SPIKE22', note: 'throwaway test item for issue 22; never merged' }) + '\n'
          const blob = await git($, ['hash-object', '-w', '--stdin'], item)
          steps.push(blob)
          const tree = await git($, ['mktree'], `100644 blob ${blob.stdout}\tHT-SPIKE22.json\n`)
          steps.push(tree)
          const commit = await git($, ['commit-tree', tree.stdout, '-m', 'humantray spike #22: throwaway orphan commit'])
          steps.push(commit)
          steps.push(await git($, ['push', 'origin', `${commit.stdout}:${ref}`]))
          steps.push(await git($, ['ls-remote', 'origin', ref]))
          out = steps
          break
        }
        case 'github-visibility': {
          const r = await $.http.fetch('https://api.github.com/repos/Talieisin/claude-plugins', { headers: { accept: 'application/vnd.github+json' } })
          let parsed: any = null
          try {
            parsed = JSON.parse(r.text)
          } catch {}
          out = { status: r.status, private: parsed?.private, visibility: parsed?.visibility, head: r.text.slice(0, 300) }
          break
        }
        case 'gh-visibility': {
          const r = await $.process.run(['gh', 'api', 'repos/Talieisin/claude-plugins', '--jq', '{private, visibility}'], { cwd: REPO_DIR, timeoutMs: 30000 })
          out = { exitCode: r.exitCode, stdout: r.stdout.trim(), stderr: r.stderr.trim().slice(0, 500) }
          break
        }
        case 'mcp-list-repos':
          out = await $.mcp.call('claude-code-remote', 'list_repos', { query: 'claude-plugins', limit: 5 })
          break
        case 'web-visibility': {
          const r = await $.http.fetch('https://github.com/Talieisin/claude-plugins')
          out = { status: r.status, ok: r.ok, length: r.text.length }
          break
        }
        default:
          out = `unknown action ${input.action}`
      }
    } catch (err) {
      out = { error: String(err) }
    }
    await log($, `probe.${input.action}`, { args: a, out })
    return { result: JSON.stringify(out, null, 1).slice(0, 20000) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const key = `pane:${e.surface}`
    if (!seen.has(key)) {
      seen.add(key)
      await log($, 'render.pane.first', { surface: e.surface, viewport: e.viewport })
    }
    const { Box, Text } = $.ui.resolve(e)
    const p = await read($, probe)
    return (
      <Box flexDirection="column">
        <Text bold>HT22-SPIKE-PANE {MARK}</Text>
        <Text>surface: {e.surface}</Text>
        <Text>clock ticks: {p.ticks} (last {p.lastTick ? new Date(p.lastTick).toISOString() : 'none'})</Text>
        <Text>deliveries received: {p.received}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const key = `band:${e.surface}`
    if (!seen.has(key)) {
      seen.add(key)
      await log($, 'render.band.first', { surface: e.surface })
    }
    const { Box, Text } = $.ui.resolve(e)
    const p = await read($, probe)
    return (
      <Box>
        <Text>HT22-SPIKE-BAND {MARK} ticks={p.ticks}</Text>
      </Box>
    )
  })
}

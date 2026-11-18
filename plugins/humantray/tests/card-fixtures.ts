// Open cards of every type and state, as the store holds them, for the tests
// that pin how an open card is drawn (open-card.test.tsx) and that the
// gallery draws with the same code (gallery.test.tsx).

import { type Engine, expect } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'

import type { Item } from '../types'
import { dumpTree } from './card-dump'
import { mount } from './surface-rules'
import { COMMAND, PANE, RICH, START_EVENT, type Step, stored, world } from './world'

/** An open item, seeded on the disk, and the steps on its card that give it its state. */
export type CardFixture = { name: string; item: Item; steps: Step[] }

const idOf = (n: number) => `01AAAAAAAAAAAAAAAAAAAACRD${String(n).padStart(2, '0')}`

const OPTIONS = [
  { label: 'Blue', description: 'The calm one.' },
  { label: 'Green', description: '' },
  { label: 'Red', description: 'Loud, for warnings.' },
]

const TWO_FENCES = ['Run this first:', '', '```sh', 'make check', '```', '', 'Then this:', '', '```sh', 'make release', '```'].join('\n')

const MERMAID = ['The flow:', '', '```mermaid', 'graph TD', '  A[Ask] --> B[Answer]', '```'].join('\n')

const at = (n: number, fields: Partial<Item> & Pick<Item, 'type'>): Item =>
  stored({ id: idOf(n), header: fields.type, question: `A ${fields.type} card`, ...fields })

export const CARD_FIXTURES: CardFixture[] = [
  { name: 'ack', item: at(1, { type: 'ack' }), steps: [] },
  { name: 'do', item: at(2, { type: 'do' }), steps: [] },
  { name: 'approve', item: at(3, { type: 'approve' }), steps: [] },
  { name: 'question', item: at(4, { type: 'question' }), steps: [] },
  { name: 'choice single', item: at(5, { type: 'choice', options: OPTIONS }), steps: [] },
  { name: 'choice single, picked', item: at(6, { type: 'choice', options: OPTIONS }), steps: [{ press: 'opt:1' }] },
  { name: 'choice multi', item: at(7, { type: 'choice', options: OPTIONS, multiSelect: true }), steps: [] },
  {
    name: 'choice multi, picked',
    item: at(8, { type: 'choice', options: OPTIONS, multiSelect: true }),
    steps: [{ press: 'opt:0' }, { press: 'opt:2' }],
  },
  { name: 'notes', item: at(9, { type: 'do', notes: true }), steps: [] },
  { name: 'markdown body', item: at(10, { type: 'ack', body_md: RICH }), steps: [] },
  { name: 'code blocks', item: at(11, { type: 'question', body_md: TWO_FENCES }), steps: [] },
  { name: 'mermaid', item: at(12, { type: 'ack', body_md: MERMAID }), steps: [] },
  { name: 'error line', item: at(13, { type: 'question' }), steps: [{ press: 'submit' }] },
  { name: 'another session', item: at(14, { type: 'approve', session_id: 'session-b' }), steps: [] },
  { name: 'bumped', item: at(15, { type: 'ack', bumps: 3 }), steps: [] },
]

export const SURFACES: RenderSurface[] = ['terminal', 'desktop', 'vscode', 'mobile']

/** Seeds every fixture, runs each one's steps on the local pane, and returns its cards' dumps, local and viewer. */
export async function drawOpenCards($: Engine, on: Parameters<typeof world>[0], surface: RenderSurface) {
  const w = world(on, { surfaces: [surface] })
  w.seed({ version: 1, items: CARD_FIXTURES.map(f => f.item), sessions: {} })
  await $.session.start({ ...START_EVENT, surface })
  const local: Record<string, string> = {}
  const viewer: Record<string, string> = {}
  const ui = await mount($, { ...PANE, surface })
  for (const { item, steps } of CARD_FIXTURES) {
    for (const step of steps) {
      if ('press' in step) await ui.press({ key: `${item.id}:${step.press}` })
      else if ('change' in step) await ui.input({ key: `${item.id}:${step.change}`, text: step.text, kind: 'change' })
      else await ui.input({ key: `${item.id}:${step.type}`, text: step.text })
    }
  }
  for (const { name, item } of CARD_FIXTURES) local[name] = dumpTree(await ui.find({ key: `${item.id}:card` }), item.id)
  await ui.unmount()
  await $.command.run({ ...COMMAND, command: 'humantray-viewer' })
  await w.clock.settle()
  const vui = await mount($, { ...PANE, surface })
  expect(await vui.find({ type: 'Text', text: 'This session' })).toBeDefined()
  for (const { name, item } of CARD_FIXTURES) viewer[name] = dumpTree(await vui.find({ key: `${item.id}:card` }), item.id)
  await vui.unmount()
  return { w, local, viewer }
}


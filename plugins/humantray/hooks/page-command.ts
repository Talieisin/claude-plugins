// `/humantray-page [url]`: the one way humantray creates, takes over or links
// a repository's artifact page (#33). No hook ever publishes.
//
//   /humantray-page        find the repository's artifact by its title and
//                          link it; with none, create it (private, never
//                          pinned), but only after a listing read to its end
//   /humantray-page <url>  republish the page to that artifact and link it
//
// Every publish carries the rules that keep the database the owner's alone,
// is checked by a write made as an editor that must be refused, and has its
// watch stopped, so the publishing session is not woken by the page.

import type { EngineInterface } from 'claude-code'

import {
  type Link,
  checkRules,
  findArtifact,
  publishPage,
  readMeta,
  setDoc,
  stopWatch,
} from './artifact-store'
import { PAGE_HTML } from '../page/page'
import { normaliseRepo } from './items'
import { PAGE_VERSION, metaFor, titleFor } from './rows'
import type { MetaPage } from '../types'
import { WRITER_VERSION } from './row-shape'
import { locate } from './store'
import { relinkPass } from './store-pass'

const ARTIFACT_URL = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+$/

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The page's source with only its title set: the committed file holds no data. */
export const withTitle = (source: string, title: string): string =>
  source.replace('<title>humantray</title>', () => `<title>${escapeHtml(title)}</title>`)

/** Publishes the plugin's page (new, or to `url`), checks its rules and stops its watch. */
async function publish(
  $: EngineInterface,
  dir: string,
  title: string,
  url: string | undefined,
): Promise<{ url: string } | { error: string }> {
  const stamp = (await $.clock.now()).toString(36)
  const source = PAGE_HTML
  const copy = `${dir}/page-${stamp}.html`
  try {
    await $.process.run(['mkdir', '-p', dir], { timeoutMs: 5_000 })
    await $.fs.write(copy, withTitle(source, title))
  } catch (error) {
    return { error: `the page copy could not be written (${String(error)})` }
  }
  try {
    const published = await publishPage($, copy, url)
    if (published.kind === 'refused') {
      return { error: `the publish was refused (${published.text}). Run /humantray-page from a cloud session.` }
    }
    if (published.kind === 'unavailable') return { error: `the publish did not go through (${published.why})` }
    await stopWatch($, published.url)
    const rules = await checkRules($, published.url)
    if (rules === 'open') {
      return { error: 'the published page lets editors write its data, so it was not linked. Check its sharing and rules.' }
    }
    if (rules === 'unknown') return { error: 'the page was published, but its rules could not be checked, so it was not linked. Run the command again.' }
    return { url: published.url }
  } finally {
    await $.process.run(['rm', '-f', copy], { timeoutMs: 5_000 }).catch(() => undefined)
  }
}

/**
 * Whose page an artifact is, read before anything is published to it:
 * this repository's (its meta and that meta's version), nobody's (no
 * `meta/page` at all: it may be taken over), or someone else's (a `meta/page`
 * that is not this repository's, or a schema this version cannot read).
 */
type Owner =
  | { kind: 'ours'; meta: MetaPage; version: number }
  | { kind: 'nobody' }
  | { kind: 'foreign' }
  | { kind: 'unavailable'; why: string }

async function ownerOf($: EngineInterface, url: string, repo: string): Promise<Owner> {
  const meta = await readMeta($, url, repo)
  if (meta.kind === 'unavailable') return meta
  if (meta.meta !== undefined) return { kind: 'ours', meta: meta.meta, version: meta.version ?? 0 }
  return meta.version === undefined ? { kind: 'nobody' } : { kind: 'foreign' }
}

const FOREIGN = 'that artifact holds another repository’s humantray, or another page’s data, so nothing was published to it'

/**
 * Brings `meta/page` up to date after a publish: written when absent, and its
 * page version raised (pinned) when the page published is newer than it says.
 */
async function settleMeta(
  $: EngineInterface,
  url: string,
  repo: string,
  owner: Owner,
): Promise<{ ok: true } | { error: string }> {
  if (owner.kind === 'ours') {
    if (owner.meta.page_version >= PAGE_VERSION) return { ok: true }
    const raised = { ...owner.meta, page_version: PAGE_VERSION, plugin_version: WRITER_VERSION }
    const written = await setDoc($, url, 'meta', 'page', raised as unknown as Record<string, unknown>, owner.version)
    return written.kind === 'ok' ? { ok: true } : { error: `its meta/page could not be brought up to date (${written.kind})` }
  }
  const now = await $.clock.now()
  const written = await setDoc($, url, 'meta', 'page', { ...metaFor(repo, now, WRITER_VERSION) })
  if (written.kind === 'ok') return { ok: true }
  if (written.kind === 'exists') {
    const again = await readMeta($, url, repo)
    if (again.kind === 'ok' && again.meta !== undefined) return { ok: true }
  }
  return { error: `its meta/page could not be written (${written.kind})` }
}

/** Publishes when the page is behind or not yet ours, then settles meta/page; never touches someone else's. */
async function adoptPage(
  $: EngineInterface,
  dir: string,
  title: string,
  url: string | undefined,
  repo: string,
  owner: Owner,
): Promise<{ url: string } | { error: string }> {
  if (owner.kind === 'foreign') return { error: FOREIGN }
  if (owner.kind === 'unavailable') return { error: `its database could not be read (${owner.why}), so nothing was published to it` }
  let target = url
  if (owner.kind !== 'ours' || owner.meta.page_version < PAGE_VERSION) {
    const published = await publish($, dir, title, url)
    if ('error' in published) return published
    target = published.url
  }
  if (target === undefined) return { error: 'no page to link' }
  const settled = await settleMeta($, target, repo, owner)
  if ('error' in settled) return settled
  return { url: target }
}

/** Runs the command; the text is what the person sees. Never delivers an answer. */
export async function runPageCommand($: EngineInterface, args: string): Promise<string> {
  const where = await locate($)
  if (where.error !== undefined) return where.error
  const repo = normaliseRepo(where.ok.remote, where.ok.root)
  const title = titleFor(repo)
  const given = args.trim()
  const now = await $.clock.now()

  if (given !== '') {
    if (!ARTIFACT_URL.test(given)) return 'humantray: give an artifact link (https://claude.ai/artifact/…), or nothing to find or create the page.'
    // Whose page it is, before anything is published to it.
    const owner = await ownerOf($, given, repo)
    const linked = await adoptPage($, where.ok.dir, title ?? 'humantray', given, repo, owner)
    if ('error' in linked) return `humantray: not linked: ${linked.error}`
    await relinkPass($, repo, { url: linked.url, how: 'given', at: now } satisfies Link)
    return 'humantray: the page is linked for this repository. Pin it in claude.ai if you want it to hand.'
  }

  if (title === undefined) {
    return 'humantray: this repository has no remote, so its page has no title to be found by. Link one with /humantray-page <artifact link>.'
  }
  const found = await findArtifact($, repo)
  if (found.kind === 'unavailable') {
    return `humantray: the artifact list could not be read to its end (${found.why}), so nothing was created. Try again.`
  }
  if (found.url !== undefined && found.meta !== undefined) {
    const owner: Owner = { kind: 'ours', meta: found.meta, version: found.metaVersion ?? 0 }
    const linked = await adoptPage($, where.ok.dir, title, found.url, repo, owner)
    if ('error' in linked) return `humantray: found the page, but could not update it: ${linked.error}`
    await relinkPass($, repo, { url: linked.url, how: 'found', at: now })
    return 'humantray: the page is linked for this repository.'
  }
  // A title match with no meta/page at all: take it over, setting the rules first.
  // Its owner is read again here, so one marked in the meantime is not published over.
  const target = [...found.unqualified].sort()[0]
  const owner: Owner = target === undefined ? { kind: 'nobody' } : await ownerOf($, target, repo)
  const linked = await adoptPage($, where.ok.dir, title, target, repo, owner)
  if ('error' in linked) return `humantray: not linked: ${linked.error}`
  await relinkPass($, repo, { url: linked.url, how: target === undefined ? 'created' : 'found', at: now })
  return target === undefined
    ? 'humantray: created a private page for this repository and linked it. It is not pinned: pin it in claude.ai if you want it to hand.'
    : 'humantray: took over the page with this repository’s title and linked it.'
}

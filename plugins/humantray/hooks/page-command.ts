// `/humantray-page [url]`: the one way humantray creates, takes over or links
// a repository's artifact page (#33). No hook ever publishes.
//
//   /humantray-page        find the repository's artifact by its title and
//                          link it; with none, create it (private, never
//                          pinned), but only after a listing read to its end
//   /humantray-page <url>  republish the page to that artifact and link it,
//                          but only an artifact already meant for this
//                          repository's humantray: its meta/page names this
//                          repository, or its title is this repository's
//                          (#54). Anything else is refused before anything
//                          is published or written to it.
//
// Every publish carries the rules that keep the database the owner's alone,
// is checked by a write made as an editor that must be refused, and has its
// watch stopped, so the publishing session is not woken by the page.

import type { EngineInterface } from 'claude-code'

import {
  type Link,
  checkRules,
  findArtifact,
  listTitled,
  publishPage,
  readMeta,
  setDoc,
  stopWatch,
} from './artifact-store'
import { PAGE_HTML } from '../page/page'
import { artifactId } from './envelope'
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

/**
 * Publishes the plugin's page (new, or to `url`), checks its rules and stops
 * its watch. `unviewed`: the tool refused because a version of the page this
 * session had not seen was there (#58); nothing was published, and the caller
 * decides whether to try once more.
 */
async function publish(
  $: EngineInterface,
  dir: string,
  title: string,
  url: string | undefined,
): Promise<{ url: string } | { error: string } | { unviewed: string }> {
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
    if (published.kind === 'unviewed') return { unviewed: published.text }
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
 * `meta/page` at all: it may be taken over, if it is meant for this
 * repository), someone else's (a `meta/page` that is not this repository's,
 * or a schema this version cannot read), or not found from this account.
 */
type Owner =
  | { kind: 'ours'; meta: MetaPage; version: number }
  | { kind: 'nobody' }
  | { kind: 'foreign' }
  | { kind: 'gone' }
  | { kind: 'unavailable'; why: string }

async function ownerOf($: EngineInterface, url: string, repo: string): Promise<Owner> {
  const meta = await readMeta($, url, repo)
  if (meta.kind === 'unavailable') return meta
  if (meta.gone === true) return { kind: 'gone' }
  if (meta.meta !== undefined) return { kind: 'ours', meta: meta.meta, version: meta.version ?? 0 }
  return meta.version === undefined ? { kind: 'nobody' } : { kind: 'foreign' }
}

const FOREIGN = 'that artifact holds another repository’s humantray, or another page’s data, so nothing was published to it'
const GONE = 'that artifact could not be found from this account, so nothing was published to it'
const UNMARKED = (title: string) =>
  `that artifact is not marked as this repository’s humantray (it has no meta/page, and its title is not “${title}”), so nothing was published to it. Run /humantray-page with no link to find or create this repository’s page`
const UNMARKED_NO_REMOTE =
  'that artifact is not marked as this repository’s humantray, and a repository with no remote has no page title to match, so nothing was published to it'

/**
 * Whether a link with no `meta/page` (or none that could be read: `gone`) is
 * meant for this repository's humantray: only when it is one of the person's
 * own artifacts titled for this repository. Its emptiness is no sign: a
 * database's collections cannot be listed, so an unrelated page's data would
 * read as empty (#54). A `gone` read of a listed artifact is taken as no
 * meta, since the listing shows it is there and the person's; what a never
 * written database answers to a read was not recorded.
 */
async function markedByTitle(
  $: EngineInterface,
  url: string,
  repo: string,
  owner: { kind: 'nobody' } | { kind: 'gone' },
): Promise<Owner | { error: string }> {
  const title = titleFor(repo)
  if (title === undefined) return { error: owner.kind === 'gone' ? GONE : UNMARKED_NO_REMOTE }
  const listed = await listTitled($, repo)
  if (listed.kind === 'unavailable') {
    return { error: `the artifact list could not be read to its end (${listed.why}), so it is not known to be this repository’s page, and nothing was published to it` }
  }
  if (listed.listed.some(each => artifactId(each.url) === artifactId(url))) return { kind: 'nobody' }
  return { error: owner.kind === 'gone' ? GONE : UNMARKED(title) }
}

/** The bare command's take-over reads a vanished title match as no meta, as it did before #54. */
const nobodyIfGone = (owner: Owner): Owner => (owner.kind === 'gone' ? { kind: 'nobody' } : owner)

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

const CHANGED =
  'the page changed while it was being updated, so it was not updated. Run /humantray-page again'

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
  if (owner.kind === 'gone') return { error: GONE }
  if (owner.kind === 'unavailable') return { error: `its database could not be read (${owner.why}), so nothing was published to it` }
  let target = url
  if (owner.kind !== 'ours' || owner.meta.page_version < PAGE_VERSION) {
    let published = await publish($, dir, title, url)
    if ('unviewed' in published && url !== undefined) {
      // A version this session had not seen was there: someone may have
      // published since the read (#58). Look at the page again, and publish
      // once more only if it is still ours and behind, or, for a take-over,
      // still unmarked. Never over a newer page, and never a third time.
      const again = owner.kind === 'nobody' ? nobodyIfGone(await ownerOf($, url, repo)) : await ownerOf($, url, repo)
      if (again.kind === 'ours' && again.meta.page_version >= PAGE_VERSION) {
        // Brought up to date by another run in the meantime: link it, publish nothing.
        return { url }
      }
      const behind = (again.kind === 'ours' && owner.kind === 'ours') || (again.kind === 'nobody' && owner.kind === 'nobody')
      if (!behind) return { error: CHANGED }
      owner = again
      published = await publish($, dir, title, url)
    }
    if ('unviewed' in published) return { error: CHANGED }
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
    const read = await ownerOf($, given, repo)
    const owner = read.kind === 'nobody' || read.kind === 'gone' ? await markedByTitle($, given, repo, read) : read
    if ('error' in owner) return `humantray: not linked: ${owner.error}`
    const linked = await adoptPage($, where.ok.dir, title ?? 'humantray', given, repo, owner)
    if ('error' in linked) return `humantray: not linked: ${linked.error}`
    await relinkPass($, repo, { url: linked.url, how: 'given', at: now } satisfies Link)
    return 'humantray: the page is linked for this repository. Pin it in claude.ai if you want it to hand.'
  }

  if (title === undefined) {
    return 'humantray: this repository has no remote, so it has no page: a page is found by a title made from the remote.'
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
  const owner: Owner = target === undefined ? { kind: 'nobody' } : nobodyIfGone(await ownerOf($, target, repo))
  const linked = await adoptPage($, where.ok.dir, title, target, repo, owner)
  if ('error' in linked) return `humantray: not linked: ${linked.error}`
  await relinkPass($, repo, { url: linked.url, how: target === undefined ? 'created' : 'found', at: now })
  return target === undefined
    ? 'humantray: created a private page for this repository and linked it. It is not pinned: pin it in claude.ai if you want it to hand.'
    : 'humantray: took over the page with this repository’s title and linked it.'
}

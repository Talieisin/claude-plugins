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

/** Writes `meta/page` when absent; refuses an artifact that is another repository's. */
async function ensureMeta($: EngineInterface, url: string, repo: string): Promise<{ ok: true } | { error: string }> {
  const meta = await readMeta($, url, repo)
  if (meta.kind === 'unavailable') return { error: `its database could not be read (${meta.why})` }
  if (meta.meta !== undefined) return { ok: true }
  if (meta.version !== undefined) return { error: 'that artifact holds another repository’s humantray, or another page’s data' }
  const now = await $.clock.now()
  const written = await setDoc($, url, 'meta', 'page', { ...metaFor(repo, now, WRITER_VERSION) })
  if (written.kind === 'ok') return { ok: true }
  if (written.kind === 'exists') {
    const again = await readMeta($, url, repo)
    if (again.kind === 'ok' && again.meta !== undefined) return { ok: true }
  }
  return { error: `its meta/page could not be written (${written.kind})` }
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
    const published = await publish($, where.ok.dir, title ?? 'humantray', given)
    if ('error' in published) return `humantray: ${published.error}`
    const meta = await ensureMeta($, published.url, repo)
    if ('error' in meta) return `humantray: not linked: ${meta.error}`
    await relinkPass($, repo, { url: published.url, how: 'given', at: now } satisfies Link)
    return 'humantray: the page is linked for this repository. Pin it in claude.ai if you want it to hand.'
  }

  if (title === undefined) {
    return 'humantray: this repository has no remote, so its page has no title to be found by. Link one with /humantray-page <artifact link>.'
  }
  const found = await findArtifact($, repo)
  if (found.kind === 'unavailable') {
    return `humantray: the artifact list could not be read to its end (${found.why}), so nothing was created. Try again.`
  }
  if (found.url !== undefined) {
    let url = found.url
    if ((found.meta?.page_version ?? 0) < PAGE_VERSION) {
      const published = await publish($, where.ok.dir, title, url)
      if ('error' in published) return `humantray: found the page, but could not update it: ${published.error}`
      url = published.url
    }
    await relinkPass($, repo, { url, how: 'found', at: now })
    return 'humantray: the page is linked for this repository.'
  }
  // A title match nobody marked as humantray's: take it over, setting the rules first.
  const target = [...found.unqualified].sort()[0]
  const published = await publish($, where.ok.dir, title, target)
  if ('error' in published) return `humantray: ${published.error}`
  const meta = await ensureMeta($, published.url, repo)
  if ('error' in meta) return `humantray: not linked: ${meta.error}`
  await relinkPass($, repo, { url: published.url, how: target === undefined ? 'created' : 'found', at: now })
  return target === undefined
    ? 'humantray: created a private page for this repository and linked it. It is not pinned: pin it in claude.ai if you want it to hand.'
    : 'humantray: took over the page with this repository’s title and linked it.'
}


// The page's source holds no data (#33): this repository is public, so the
// committed page carries no item, link, session id or repository name. And
// no row text is ever parsed as HTML by the page.

import { describe, expect, test } from 'claude-code/testing'

import { UNSAFE } from '../hooks/code'
import { withTitle } from '../hooks/page-command'
import { PAGE_HTML } from '../page/page'

describe('the page source', () => {
  test('holds no session id, artifact link, ULID or GitHub repository', () => {
    const patterns = [
      /session_[A-Za-z0-9]{20,}/,
      /claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]{10,}/,
      /\b[0-9A-HJKMNP-TV-Z]{26}\b/,
      /github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+/,
    ]
    for (const pattern of patterns) expect(PAGE_HTML).not.toMatch(pattern)
  })

  test('its only title is the placeholder the command replaces', () => {
    expect(PAGE_HTML.match(/<title>/g)).toHaveLength(1)
    expect(PAGE_HTML.startsWith('<title>humantray</title>')).toBe(true)
    expect(withTitle(PAGE_HTML, 'humantray: owner/repo')).toContain('<title>humantray: owner/repo</title>')
    expect(withTitle(PAGE_HTML, 'humantray: <b>&"x"')).toContain('<title>humantray: &lt;b&gt;&amp;&quot;x&quot;</title>')
    expect(withTitle(PAGE_HTML, 'humantray: a$&b')).toContain('<title>humantray: a$&amp;b</title>')
  })

  test('never parses text as HTML, and links only checked session ids and http(s) URLs', () => {
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
      expect(PAGE_HTML).not.toContain(sink)
    }
    expect(PAGE_HTML).toContain('var SESSION_ID = /^session_[A-Za-z0-9]{20,64}$/;')
    expect(PAGE_HTML).toContain('url.protocol === "https:" || url.protocol === "http:"')
  })

  test('declares the database only, loads nothing from elsewhere, and posts no comment', () => {
    expect(PAGE_HTML).not.toMatch(/<script[^>]+src=/)
    expect(PAGE_HTML).not.toMatch(/<link[^>]+href=/)
    expect(PAGE_HTML).not.toContain('use("comments")')
    expect(PAGE_HTML).not.toContain('acquire(')
  })

  test('copies a code block only through the clipboard API or the copy event (#51)', () => {
    expect(PAGE_HTML).toContain('navigator.clipboard.writeText(text)')
    expect(PAGE_HTML.match(/execCommand\(/g)).toEqual(['execCommand('])
    expect(PAGE_HTML).toContain('document.execCommand("copy")')
    expect(PAGE_HTML).not.toMatch(/clipboard\.(read|readText|write)\(/)
  })

  test('holds no literal invisible or bidi character, and refuses the same control characters as the mod (#51)', () => {
    expect(PAGE_HTML).not.toMatch(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/)
    expect(PAGE_HTML).toContain(`var UNSAFE = /${UNSAFE.source}/;`)
  })
})

// The humantray artifact page (#33): the source `/humantray-page` publishes,
// one private page per repository. It holds no data: every item is read from
// the artifact's own database when the page is opened, and the title below is
// replaced with the repository's at publish time (page-command.ts).
//
// The page is kept here as a string, not as an .html file, because a hooks
// module and its tests can import only code files. It is written with
// String.raw, so the page's own script must never contain a backtick or a
// dollar sign followed by a brace (a test checks this). Untrusted row text
// is never parsed as HTML: every string reaches the page through
// textContent or an attribute, and body_md through a small renderer that
// builds DOM nodes itself and links only http and https URLs.
//
// Raise PAGE_VERSION (rows.ts) with every change to this page.

export const PAGE_HTML = String.raw`<title>humantray</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Layout: one calm column of answer cards under a header with tabs and filters (after the owner's mock-up). */
:root {
  --bg: #f7f7f6; --surface: #ffffff; --fg: #1f1f1e; --muted: #6b6a66; --line: #e3e2de;
  --accent: #5a5a55; --chip: #efeeea; --ok: #2f6b3f; --warn: #8a5a12; --bad: #9b2c2c;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #1c1c1b; --surface: #262625; --fg: #ecebe8; --muted: #9c9b96; --line: #3a3a38;
    --accent: #c9c8c3; --chip: #30302e; --ok: #7cc48e; --warn: #e0b060; --bad: #e88a8a; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #1c1c1b; --surface: #262625; --fg: #ecebe8; --muted: #9c9b96; --line: #3a3a38;
  --accent: #c9c8c3; --chip: #30302e; --ok: #7cc48e; --warn: #e0b060; --bad: #e88a8a; color-scheme: dark;
}
body { background: var(--bg); color: var(--fg); font: 14px/1.5 var(--font); }
a { color: var(--accent); text-underline-offset: 2px; }
.wrap { max-width: 720px; margin: 0 auto; padding-block: 16px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: flex; flex-direction: column; gap: 14px; }
header { display: flex; flex-direction: column; gap: 10px; }
h1 { font-size: 18px; margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; text-wrap: balance; overflow-wrap: anywhere; }
.badge { font-size: 12px; background: var(--fg); color: var(--bg); border-radius: 999px; padding: 1px 8px; font-variant-numeric: tabular-nums; }
.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pill { font: inherit; font-size: 13px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); border-radius: 999px; padding: 3px 11px; cursor: pointer; }
.pill[aria-pressed="true"] { background: var(--fg); color: var(--bg); border-color: var(--fg); }
select, textarea, input[type="text"] { font: inherit; color: var(--fg); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; }
select { max-width: 100%; }
textarea { width: 100%; box-sizing: border-box; min-height: 56px; resize: vertical; }
input[type="text"] { flex: 1; min-width: 0; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.note { font-size: 13px; color: var(--muted); border: 1px dashed var(--line); border-radius: 8px; padding: 6px 10px; }
.note.bad { color: var(--bad); border-color: var(--bad); }
main, .group, .asker { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.group-title { font-size: 13px; font-weight: 600; color: var(--muted); letter-spacing: .02em; margin: 6px 0 0; overflow-wrap: anywhere; }
.asker-title { font-size: 13px; color: var(--muted); margin: 0; display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; overflow-wrap: anywhere; }
.asker-title a { color: var(--accent); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.top { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.chip { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; background: var(--chip); color: var(--muted); border-radius: 6px; padding: 1px 7px; overflow-wrap: anywhere; }
.chip.warn { color: var(--warn); background: transparent; border: 1px solid var(--line); }
.card h2 { font-size: 15px; margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.body { min-width: 0; overflow-wrap: anywhere; }
code { font-family: var(--mono); font-size: 12.5px; background: var(--chip); border-radius: 4px; padding: 0 4px; }
pre { background: var(--chip); border-radius: 8px; padding: 8px 10px; overflow-x: auto; margin: 0 0 6px; }
pre code { padding: 0; background: none; }
.meta { font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px 12px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.opts { display: flex; flex-direction: column; gap: 6px; }
.opt { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; cursor: pointer; min-width: 0; }
.opt:has(input:checked) { border-color: var(--accent); }
.opt span { min-width: 0; overflow-wrap: anywhere; }
.opt small { display: block; color: var(--muted); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.btn { font: inherit; border-radius: 8px; padding: 6px 14px; cursor: pointer; border: 1px solid var(--line); background: var(--surface); color: var(--fg); }
.btn.primary { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.btn:disabled { opacity: .5; cursor: default; }
.status { font-size: 13px; color: var(--muted); }
.status.bad { color: var(--bad); }
.ans { font-size: 13px; border-left: 2px solid var(--line); padding-left: 10px; overflow-wrap: anywhere; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ans-when, .ans-label { color: var(--muted); font-size: 12px; }
.md { min-width: 0; overflow-wrap: anywhere; }
.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md p { margin: 0 0 6px; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 { margin: 10px 0 6px; line-height: 1.3; font-weight: 600; text-wrap: balance; }
.md h1 { font-size: 17px; } .md h2 { font-size: 16px; } .md h3 { font-size: 15px; } .md h4, .md h5, .md h6 { font-size: 14px; }
.md ul, .md ol { margin: 0 0 6px; padding-left: 22px; }
.md li > ul, .md li > ol { margin: 2px 0; }
.md li.task { list-style: none; margin-left: -20px; }
.md li.task > input { margin: 0 6px 0 0; vertical-align: -1px; }
.md blockquote { margin: 0 0 6px; padding: 2px 0 2px 10px; border-left: 3px solid var(--line); color: var(--muted); }
.md hr { border: 0; border-top: 1px solid var(--line); margin: 10px 0; }
.md .table { overflow-x: auto; margin: 0 0 6px; }
.md table { border-collapse: collapse; font-size: 13px; }
.md th, .md td { border: 1px solid var(--line); padding: 4px 8px; vertical-align: top; }
.md th { background: var(--chip); font-weight: 600; }
.md del { color: var(--muted); }
.md .img-link::before { content: "▣ "; }
.opt.other { cursor: default; }
.ok { color: var(--ok); }
.empty { color: var(--muted); text-align: center; padding: 24px; }
details.card summary { cursor: pointer; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; list-style: none; }
details.card[open] summary { margin-bottom: 10px; }
@media (prefers-reduced-motion: no-preference) { .card { transition: opacity .2s; } }
</style>
<div class="wrap">
  <header>
    <h1><span id="title">humantray</span> <span class="badge" id="count">0</span></h1>
    <div class="row" role="group" aria-label="View">
      <button class="pill" id="tab-open" type="button" aria-pressed="true">Open</button>
      <button class="pill" id="tab-history" type="button" aria-pressed="false">History <span id="history-count">0</span></button>
    </div>
    <div class="row" id="chips" role="group" aria-label="Kind"></div>
    <div class="row"><label for="asker" class="status">Session</label><select id="asker"><option value="">All sessions</option></select></div>
  </header>
  <div id="notes"></div>
  <main id="list"><div class="empty">Loading the asks from this page's database…</div></main>
</div>
<script>
(function () {
  "use strict";
  var SESSION_ID = /^session_[A-Za-z0-9]{20,64}$/;
  var ANSWER_ID = /^[A-Za-z0-9_-]{16,64}$/;
  var LIMIT = 10000;
  var DAY = 24 * 60 * 60 * 1000;
  var TYPES = ["ack", "choice", "question", "do", "approve"];
  var STATUS_OF = { ack: "acknowledged", "do": "done", choice: "answered", question: "answered", approve: "answered" };
  var KIND_OF = { choice: "question", question: "question", "do": "todo", approve: "todo", ack: "fyi" };
  var KINDS = [["all", "All"], ["question", "Questions"], ["todo", "To-dos"], ["fyi", "FYIs"]];
  var LABEL = { choice: "Choice", question: "Question", "do": "To-do", approve: "Approve", ack: "FYI" };

  /*
   * Everything keyed by a row's id (an item id, a session id) is a Map, never a
   * plain object: ids are row data, and "__proto__" or "toString" must be
   * harmless keys.
   */
  var state = {
    tab: "open", kind: "all", asker: "", open: [], responses: new Map(), history: [], newer: 0, bad: 0,
    loaded: false, failed: "", busy: new Map(), results: new Map(),
    /* What the person has typed or picked on each open card, kept across every redraw until it is saved. */
    drafts: new Map()
  };
  var db = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (key) {
      if (key === "text") node.textContent = attrs[key];
      else if (key === "className") node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }
  function str(v) { return typeof v === "string"; }
  function num(v) { return typeof v === "number" && isFinite(v); }
  function rec(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
  function optional(v, test) { return v === undefined || test(v); }

  /* Rows are untrusted: only a row with every known field of the right type is used. */
  function readItem(id, data) {
    if (!rec(data)) return { bad: true };
    if (data.schema !== 1) return num(data.schema) && data.schema > 1 ? { newer: true } : { bad: true };
    var strings = ["id", "short", "repo", "header", "question", "body_md", "key", "session_id"];
    for (var i = 0; i < strings.length; i++) if (!str(data[strings[i]])) return { bad: true };
    if (data.id !== id || TYPES.indexOf(data.type) < 0) return { bad: true };
    if (!num(data.created) || !num(data.updated) || !num(data.bumps) || typeof data.delivered !== "boolean") return { bad: true };
    if (["open", "acknowledged", "done", "answered"].indexOf(data.status) < 0) return { bad: true };
    if (!optional(data.options, function (o) { return Array.isArray(o) && o.every(function (x) { return rec(x) && str(x.label) && str(x.description); }); })) return { bad: true };
    if ((data.type === "choice" || data.type === "approve") && !Array.isArray(data.options)) return { bad: true };
    var nullable = ["session_title", "lead_session_id", "parent_session_id"];
    for (var j = 0; j < nullable.length; j++) if (data[nullable[j]] !== null && !str(data[nullable[j]])) return { bad: true };
    if (data.status !== "open" && !rec(data.response)) return { bad: true };
    return { ok: data };
  }
  /*
   * A response row read as the answer for item id, or null. A row of a newer
   * schema is kept as { newer: true }: an answer this page cannot read, given on
   * a newer page, which this page never writes over unless the session refused it.
   */
  function readResponse(data, id) {
    if (!rec(data) || data.id !== id || !str(data.answer_id) || !ANSWER_ID.test(data.answer_id)) return null;
    if (data.schema !== 1) return num(data.schema) && data.schema > 1 ? { newer: true, id: id, answer_id: data.answer_id } : null;
    if (["acknowledged", "done", "answered"].indexOf(data.status) < 0 || !rec(data.response) || !num(data.answered_at)) return null;
    if (!rec(data.seen) || !num(data.seen.bumps) || !num(data.seen.updated) || (data.by !== "page" && data.by !== "viewer")) return null;
    return data;
  }
  /* Rule 1: an answer counts only when it reads and is not the one the session refused. */
  function countingAnswer(item) {
    var answer = state.responses.get(item.id);
    if (!answer) return null;
    var refused = rec(item.response_refused) && str(item.response_refused.answer_id) ? item.response_refused.answer_id : null;
    return answer.answer_id === refused ? null : answer;
  }

  function ago(at) {
    if (!num(at)) return "";
    var ms = Date.now() - at;
    if (ms < 60000) return "just now";
    var m = Math.round(ms / 60000);
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + " h ago";
    return Math.round(h / 24) + " days ago";
  }

  /*
   * Markdown, as much of it as can be drawn safely (GitHub's flavour): headings,
   * emphasis and strikethrough, nested and task lists, block quotes, inline and
   * fenced code, tables, horizontal rules, links and autolinks. Every node is
   * built here and every string set as text: no HTML is ever parsed, raw HTML
   * shows as the text it is, links are http and https only, and an image is
   * shown as a link to it, never loaded. The stored text is never changed.
   */
  function safeUrl(href) {
    try {
      var url = new URL(href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch (e) { return null; }
  }
  function link(href, fill, parent, title) {
    var url = safeUrl(href);
    if (!url) return false;
    var a = el("a", { href: url, target: "_blank", rel: "noopener noreferrer" });
    if (title) a.setAttribute("title", title);
    fill(a);
    parent.appendChild(a);
    return true;
  }
  var PUNCT = /[!-\/:-@\[-\x60{-~]/;
  /* Sticky patterns, matched where the scanner stands; each bounded, so no search runs on to the end of a long text. */
  var DEST = /\(\s*(<[^<>\n]{0,2048}>|[^\s()]{0,2048}(?:\([^\s()]{0,2048}\)[^\s()]{0,2048}){0,8})(?:\s+("[^"\n]{0,2048}"|'[^'\n]{0,2048}'|\([^)\n]{0,2048}\)))?\s*\)/y;
  var AUTO = /<(https?:\/\/[^\s<>]{1,2048})>/iy;
  var BARE = /https?:\/\/[^\s<]{1,2048}/iy;
  /*
   * One line of Markdown text, drawn into parent. Linear in the text: matching
   * brackets and code-span backtick runs are found in one pass each, a failed
   * search for an emphasis closer is remembered, and nesting stops at 16.
   */
  function inline(text, parent, depth) {
    depth = depth || 0;
    if (depth > 16) { parent.appendChild(document.createTextNode(text)); return; }
    var n = text.length;
    var k;
    // Each [ and the ] that closes it.
    var closeBracket = new Map();
    var open = [];
    for (k = 0; k < n; k++) {
      var code = text.charCodeAt(k);
      if (code === 92) { k++; continue; }
      if (code === 91) open.push(k);
      else if (code === 93 && open.length > 0) closeBracket.set(open.pop(), k);
    }
    // Each run of backticks, and where the next run of the same length starts.
    var runs = [];
    for (k = 0; k < n; k++) {
      if (text.charCodeAt(k) !== 96) continue;
      var stop = k;
      while (stop < n && text.charCodeAt(stop) === 96) stop++;
      runs.push([k, stop - k]);
      k = stop - 1;
    }
    var closeTicks = new Map();
    var lastOfLength = new Map();
    for (k = runs.length - 1; k >= 0; k--) {
      closeTicks.set(runs[k][0], lastOfLength.has(runs[k][1]) ? lastOfLength.get(runs[k][1]) : -1);
      lastOfLength.set(runs[k][1], runs[k][0]);
    }
    // For each emphasis delimiter, the first start from which no closer exists.
    var noCloser = new Map();

    function runAt(at, ch) { var end = at; while (end < n && text.charAt(end) === ch) end++; return end - at; }
    function bracketLink(at) {
      var close = closeBracket.get(at);
      if (close === undefined) return null;
      DEST.lastIndex = close + 1;
      var m = DEST.exec(text);
      if (!m) return null;
      var href = m[1].charAt(0) === "<" ? m[1].slice(1, -1) : m[1];
      return { label: text.slice(at + 1, close), href: href, title: m[2] ? m[2].slice(1, -1) : "", end: DEST.lastIndex };
    }
    function emphasis(at) {
      var ch = text.charAt(at);
      var run = runAt(at, ch);
      if (ch === "~" && run !== 2) return null;
      var size = ch === "~" || run >= 2 ? 2 : 1;
      var after = text.charAt(at + size);
      if (after === "" || /\s/.test(after)) return null;
      if (ch === "_" && at > 0 && /[A-Za-z0-9]/.test(text.charAt(at - 1))) return null;
      var delim = size === 2 ? ch + ch : ch;
      var begin = at + size;
      var failed = noCloser.get(delim);
      if (failed !== undefined && begin >= failed) return null;
      for (var j = begin + 1; j <= n - size; j++) {
        if (text.charAt(j) !== ch || (size === 2 && text.charAt(j + 1) !== ch)) continue;
        if (text.charAt(j - 1) === "\\" || /\s/.test(text.charAt(j - 1))) continue;
        if (size === 1 && text.charAt(j + 1) === ch) { j++; continue; }
        while (size === 2 && text.charAt(j + size) === ch) j++;
        if (ch === "_" && /[A-Za-z0-9]/.test(text.charAt(j + size))) continue;
        return { tag: ch === "~" ? "del" : size === 2 ? "strong" : "em", inner: text.slice(begin, j), end: j + size };
      }
      if (failed === undefined || begin < failed) noCloser.set(delim, begin);
      return null;
    }

    var buf = "";
    function flushText() { if (buf) { parent.appendChild(document.createTextNode(buf)); buf = ""; } }
    var i = 0;
    while (i < n) {
      var c = text.charAt(i);
      var m;
      if (c === "\\") {
        var next = text.charAt(i + 1);
        if (next === "\n") { flushText(); parent.appendChild(el("br")); i += 2; continue; }
        if (next && PUNCT.test(next)) { buf += next; i += 2; continue; }
        buf += c; i++; continue;
      }
      if (c === "\n") {
        // buf holds this line only (it is flushed at every line end), so trimming it stays linear.
        var hard = buf.length >= 2 && buf.charAt(buf.length - 1) === " " && buf.charAt(buf.length - 2) === " ";
        var keep = buf.length;
        while (keep > 0 && buf.charAt(keep - 1) === " ") keep--;
        buf = buf.slice(0, keep);
        flushText();
        if (hard) parent.appendChild(el("br"));
        else parent.appendChild(document.createTextNode("\n"));
        i++; continue;
      }
      if (c === "\x60") {
        var length = runAt(i, "\x60");
        var close = closeTicks.has(i) ? closeTicks.get(i) : -1;
        if (close > i) {
          flushText();
          var codeText = text.slice(i + length, close).replace(/\n/g, " ");
          if (codeText.length >= 2 && codeText.charAt(0) === " " && codeText.charAt(codeText.length - 1) === " " && codeText.trim() !== "") {
            codeText = codeText.slice(1, -1);
          }
          parent.appendChild(el("code", { text: codeText }));
          i = close + length; continue;
        }
        buf += text.substr(i, length); i += length; continue;
      }
      if (c === "<") {
        AUTO.lastIndex = i;
        m = AUTO.exec(text);
        if (m && safeUrl(m[1])) {
          var auto = m[1];
          flushText();
          link(auto, function (a) { a.textContent = auto; }, parent);
          i = AUTO.lastIndex; continue;
        }
        buf += c; i++; continue;
      }
      if (c === "!" && text.charAt(i + 1) === "[") {
        var image = bracketLink(i + 1);
        if (image) {
          var shown = image.label.trim() === "" ? image.href : image.label;
          flushText();
          if (!link(image.href, function (a) { a.className = "img-link"; a.textContent = "Image: " + shown; }, parent, image.title)) {
            parent.appendChild(document.createTextNode(text.slice(i, image.end)));
          }
          i = image.end; continue;
        }
      }
      if (c === "[") {
        var found = bracketLink(i);
        if (found) {
          flushText();
          if (!link(found.href, function (a) { inline(found.label, a, depth + 1); }, parent, found.title)) inline(found.label, parent, depth + 1);
          i = found.end; continue;
        }
      }
      if ((c === "h" || c === "H") && (i === 0 || /[\s(*_~]/.test(text.charAt(i - 1)))) {
        BARE.lastIndex = i;
        m = BARE.exec(text);
        if (m) {
          var bare = m[0].replace(/[.,;:!?'")\]*_~]+$/, "");
          if (safeUrl(bare)) {
            flushText();
            link(bare, function (a) { a.textContent = bare; }, parent);
            i += bare.length; continue;
          }
        }
      }
      if (c === "*" || c === "_" || c === "~") {
        var span = emphasis(i);
        if (span) {
          flushText();
          var node = el(span.tag);
          inline(span.inner, node, depth + 1);
          parent.appendChild(node);
          i = span.end; continue;
        }
        var same = runAt(i, c);
        buf += text.substr(i, same); i += same; continue;
      }
      buf += c; i++;
    }
    flushText();
  }

  var FENCE = /^ {0,3}(\x60{3,}|~{3,})[ \t]*([^\x60]*)$/;
  var HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  var ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
  var QUOTE = /^ {0,3}> ?(.*)$/;
  var ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|[ \t]*)$/;
  var DELIMS = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
  var BLANK = /^\s*$/;
  function startsBlock(line) {
    return FENCE.test(line) || HR.test(line) || ATX.test(line) || QUOTE.test(line) || ITEM.test(line);
  }
  function cells(line) {
    var s = line.trim();
    if (s.charAt(0) === "|") s = s.slice(1);
    if (s.charAt(s.length - 1) === "|" && s.charAt(s.length - 2) !== "\\") s = s.slice(0, -1);
    var out = [];
    var cur = "";
    for (var k = 0; k < s.length; k++) {
      var ch = s.charAt(k);
      if (ch === "\\" && s.charAt(k + 1) === "|") { cur += "|"; k++; continue; }
      if (ch === "|") { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  function table(lines, i, head, delims, parent) {
    var align = delims.map(function (d) {
      var left = d.charAt(0) === ":";
      var right = d.charAt(d.length - 1) === ":";
      return left && right ? "center" : right ? "right" : left ? "left" : "";
    });
    var row = function (values, tag) {
      var tr = el("tr");
      for (var k = 0; k < head.length; k++) {
        var cell = el(tag);
        if (align[k]) cell.style.textAlign = align[k];
        inline(values[k] || "", cell);
        tr.appendChild(cell);
      }
      return tr;
    };
    var body = el("tbody");
    i += 2;
    while (i < lines.length && !BLANK.test(lines[i]) && lines[i].indexOf("|") >= 0 && !startsBlock(lines[i])) {
      body.appendChild(row(cells(lines[i]), "td"));
      i++;
    }
    parent.appendChild(el("div", { className: "table" }, [el("table", null, [el("thead", null, [row(head, "th")]), body])]));
    return i;
  }
  function list(lines, i, parent, depth) {
    var first = ITEM.exec(lines[i]);
    var ordered = /\d/.test(first[2]);
    var marker = ordered ? first[2].slice(-1) : first[2];
    var node = el(ordered ? "ol" : "ul");
    if (ordered && parseInt(first[2], 10) !== 1) node.setAttribute("start", String(parseInt(first[2], 10)));
    var items = [];
    var loose = false;
    while (i < lines.length) {
      var m = ITEM.exec(lines[i]);
      if (!m) break;
      if (ordered ? !/\d/.test(m[2]) || m[2].slice(-1) !== marker : m[2] !== marker) break;
      var pad = m[3] ? m[3].length : 1;
      var width = m[1].length + m[2].length + (pad > 4 ? 1 : pad);
      var body = [m[4] !== undefined ? m[4] : ""];
      var blank = false;
      i++;
      while (i < lines.length) {
        var line = lines[i];
        if (BLANK.test(line)) { body.push(""); blank = true; i++; continue; }
        var indent = /^ */.exec(line)[0].length;
        if (indent >= width) { body.push(line.slice(width)); blank = false; i++; continue; }
        if (!blank && !startsBlock(line)) { body.push(line.trim()); i++; continue; }
        break;
      }
      var trailing = 0;
      while (body.length > 1 && body[body.length - 1] === "") { body.pop(); trailing++; }
      if (trailing > 0 && i < lines.length && ITEM.test(lines[i])) loose = true;
      items.push(body);
    }
    items.forEach(function (body) {
      var li = el("li");
      var task = /^\[([ xX])\][ \t]+/.exec(body[0]);
      if (task) {
        body[0] = body[0].slice(task[0].length);
        var box = el("input", { type: "checkbox", disabled: "", "aria-label": task[1] === " " ? "not done" : "done" });
        box.checked = task[1] !== " ";
        li.className = "task";
        li.appendChild(box);
      }
      var holder = el("div");
      blocks(body, holder, depth + 1);
      while (holder.firstChild) {
        var child = holder.firstChild;
        if (!loose && child.nodeName === "P") {
          while (child.firstChild) li.appendChild(child.firstChild);
          holder.removeChild(child);
        } else li.appendChild(child);
      }
      node.appendChild(li);
    });
    parent.appendChild(node);
    return i;
  }
  function blocks(lines, parent, depth) {
    if (depth > 12) { parent.appendChild(el("p", { text: lines.join("\n") })); return; }
    var para = [];
    function flush() {
      if (para.length === 0) return;
      var p = el("p");
      inline(para.join("\n").replace(/^\s+|\s+$/g, ""), p);
      parent.appendChild(p);
      para = [];
    }
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var m;
      if (BLANK.test(line)) { flush(); i++; continue; }
      if ((m = FENCE.exec(line))) {
        flush();
        var fence = m[1];
        var lead = /^ */.exec(line)[0].length;
        var closing = new RegExp("^ {0,3}" + (fence.charAt(0) === "~" ? "~" : "\\x60") + "{" + fence.length + ",}[ \\t]*$");
        var code = [];
        i++;
        while (i < lines.length && !closing.test(lines[i])) {
          code.push(lines[i].replace(new RegExp("^ {0," + lead + "}"), ""));
          i++;
        }
        i++;
        var pre = el("pre", null, [el("code", { text: code.join("\n") })]);
        var lang = m[2].trim().split(/\s+/)[0];
        if (lang) pre.setAttribute("data-lang", lang);
        parent.appendChild(pre);
        continue;
      }
      if (para.length > 0 && /^ {0,3}(=+|-+)[ \t]*$/.test(line)) {
        var setext = el(line.trim().charAt(0) === "=" ? "h1" : "h2");
        inline(para.join("\n").trim(), setext);
        parent.appendChild(setext);
        para = [];
        i++; continue;
      }
      if (HR.test(line)) { flush(); parent.appendChild(el("hr")); i++; continue; }
      if ((m = ATX.exec(line))) {
        flush();
        var heading = el("h" + m[1].length);
        inline(m[2] || "", heading);
        parent.appendChild(heading);
        i++; continue;
      }
      if (QUOTE.test(line)) {
        flush();
        var quoted = [];
        while (i < lines.length) {
          var q = QUOTE.exec(lines[i]);
          if (q) quoted.push(q[1]);
          else if (!BLANK.test(lines[i]) && !BLANK.test(quoted[quoted.length - 1]) && !startsBlock(lines[i])) quoted.push(lines[i]);
          else break;
          i++;
        }
        var quote = el("blockquote");
        blocks(quoted, quote, depth + 1);
        parent.appendChild(quote);
        continue;
      }
      if ((m = ITEM.exec(line)) && (para.length === 0 || (m[4] !== undefined && (!/\d/.test(m[2]) || /^1[.)]$/.test(m[2]))))) {
        flush();
        i = list(lines, i, parent, depth);
        continue;
      }
      if (line.indexOf("|") >= 0 && i + 1 < lines.length && DELIMS.test(lines[i + 1])) {
        var head = cells(line);
        var delims = cells(lines[i + 1]);
        if (head.length === delims.length) {
          flush();
          i = table(lines, i, head, delims, parent);
          continue;
        }
      }
      if (para.length === 0 && /^ {4}/.test(line)) {
        var indented = [];
        while (i < lines.length && (/^ {4}/.test(lines[i]) || BLANK.test(lines[i]))) { indented.push(lines[i].replace(/^ {4}/, "")); i++; }
        while (indented.length > 0 && BLANK.test(indented[indented.length - 1])) indented.pop();
        parent.appendChild(el("pre", null, [el("code", { text: indented.join("\n") })]));
        continue;
      }
      para.push(line);
      i++;
    }
    flush();
  }
  /* Draws Markdown into a new block; the text itself is never changed. */
  function markdown(source) {
    var box = el("div", { className: "md" });
    blocks(String(source).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"), box, 0);
    return box;
  }
  function sessionLink(id, label) {
    if (str(id) && SESSION_ID.test(id)) {
      return el("a", { href: "https://claude.ai/code/" + id, target: "_blank", rel: "noopener noreferrer", text: label });
    }
    return el("span", { text: label });
  }

  function answerId() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  /* A free-text field as typed, or undefined when it holds nothing but space: never trimmed. */
  function typed(v) { var t = String(v || ""); return t.trim() === "" ? undefined : t; }

  /* The draft of one card: its free text and its picked options, as typed. */
  function draftOf(id) {
    var draft = state.drafts.get(id);
    if (!draft) {
      draft = { fields: new Map(), picked: [] };
      state.drafts.set(id, draft);
    }
    return draft;
  }
  function fieldOf(id, name) {
    var draft = state.drafts.get(id);
    var value = draft ? draft.fields.get(name) : undefined;
    return str(value) ? value : "";
  }

  /* What the card's draft holds, as the pane would store it (buildResponse), or why not. */
  function responseFrom(item, action) {
    var draft = draftOf(item.id);
    var value = function (name) { return fieldOf(item.id, name); };
    var notes = item.notes === true ? typed(value("notes")) : undefined;
    var withNotes = function (r) { if (notes !== undefined) r.notes = notes; return r; };
    var texts = ["notes", "text", "feedback", "other"].map(value);
    if (texts.some(function (t) { return t.length > LIMIT; })) return { error: "An answer can be at most " + LIMIT + " characters." };
    switch (item.type) {
      case "ack": return { response: withNotes({ acknowledged: true }) };
      case "do": {
        var r = { outcome: action };
        var feedback = typed(value("feedback"));
        if (feedback !== undefined) r.feedback = feedback;
        return { response: withNotes(r) };
      }
      case "approve": return { response: withNotes({ selected: [action] }) };
      case "question": {
        var text = typed(value("text"));
        if (text === undefined) return { error: "Type an answer." };
        return { response: withNotes({ text: text }) };
      }
      case "choice": {
        var labels = (item.options || []).map(function (o) { return o.label; });
        var picked = draft.picked.filter(function (l) { return labels.indexOf(l) >= 0; });
        var other = typed(value("other"));
        if (item.multiSelect !== true) picked = other !== undefined ? [] : picked.slice(0, 1);
        if (picked.length === 0 && other === undefined) return { error: "Pick an option or fill in Other." };
        var c = { selected: picked };
        if (other !== undefined) c.other = other;
        return { response: withNotes(c) };
      }
    }
    return { error: "This item cannot be answered here." };
  }

  /*
   * Rule 3: read; write only when no answer counts; read back to see whose
   * answer was stored. The page's database has no create-if-absent write, so
   * two tabs can both write: the session applies the first answer it reads,
   * and the waiting card shows the answer actually stored.
   */
  async function submit(item, action) {
    var built = responseFrom(item, action);
    if (built.error) { state.results.set(item.id, { bad: true, text: built.error }); render(); return; }
    state.busy.set(item.id, true);
    state.results.set(item.id, { text: "Saving…" });
    render();
    try {
      var ref = db.collection("responses").doc(item.id);
      var before = await ref.get();
      var existing = before.exists ? readResponse(before.data(), item.id) : null;
      var refused = rec(item.response_refused) ? item.response_refused.answer_id : null;
      if (existing && existing.answer_id !== refused) {
        state.results.set(item.id, { text: existing.newer ? "This item was already answered on a newer page." : "This item already has an answer." });
      } else {
        var mine = answerId();
        await ref.set({
          schema: 1, id: item.id, answer_id: mine, response: built.response, status: STATUS_OF[item.type],
          answered_at: Date.now(), seen: { bumps: item.bumps, updated: item.updated },
          /* Which view wrote it; not proof a person answered (decision 3 on #26). */
          by: "page"
        });
        var after = await ref.get();
        var stored = after.exists ? readResponse(after.data(), item.id) : null;
        if (stored && stored.answer_id === mine) {
          state.drafts.delete(item.id);
          state.results.set(item.id, { text: "Saved. If it was also answered somewhere else, the session takes the first answer it reads." });
        } else {
          state.results.set(item.id, { bad: true, text: "Another answer was stored first. The answer shown here is the one stored." });
        }
      }
    } catch (e) {
      var code = e && e.code;
      state.results.set(item.id, { bad: true, text: code === "invalid_argument" || code === "not_granted"
        ? "This page cannot save answers for you. Only the page's owner can answer here."
        : "The answer was not saved (" + (code || "error") + "). Your answer is kept: try again." });
    }
    state.busy.set(item.id, false);
    render();
  }

  function chips(item) {
    var top = el("div", { className: "top" });
    top.appendChild(el("span", { className: "chip", text: LABEL[item.type] + (item.type === "choice" ? (item.multiSelect === true ? " · multi" : " · single") : "") }));
    top.appendChild(el("span", { className: "chip", text: item.header }));
    if (item.bumps > 0) top.appendChild(el("span", { className: "chip warn", text: "raised " + (item.bumps + 1) + "×" }));
    if (Date.now() - item.created > DAY) top.appendChild(el("span", { className: "chip warn", text: "old" }));
    return top;
  }
  function metaLine(item, extra) {
    var meta = el("div", { className: "meta" });
    meta.appendChild(el("span", { text: item.short }));
    meta.appendChild(el("span", { text: "raised " + ago(item.created) }));
    if (extra) meta.appendChild(el("span", { text: extra }));
    return meta;
  }
  function textField(item, name, label) {
    var field = el("textarea", { id: "f-" + item.id + "-" + name, "data-field": name, maxlength: String(LIMIT), placeholder: label, "aria-label": label });
    field.value = fieldOf(item.id, name);
    field.addEventListener("input", function () {
      var draft = draftOf(item.id);
      draft.fields.set(name, field.value);
      // Single-select: typing in Other clears a picked option, as the pane does.
      if (name === "other" && item.multiSelect !== true && field.value.trim() !== "") {
        draft.picked = [];
        var card = field.closest(".card");
        if (card) Array.prototype.forEach.call(card.querySelectorAll("input[data-option]"), function (x) { x.checked = false; });
      }
    });
    return field;
  }
  function button(label, primary, onPress, disabled) {
    var b = el("button", { type: "button", className: primary ? "btn primary" : "btn", text: label });
    if (disabled) b.disabled = true;
    b.addEventListener("click", onPress);
    return b;
  }

  function openCard(item) {
    var card = el("section", { className: "card", id: "card-" + item.id });
    var busy = state.busy.get(item.id) === true;
    var draft = state.drafts.get(item.id);
    card.appendChild(chips(item));
    card.appendChild(el("h2", { text: item.question }));
    if (item.body_md !== "") card.appendChild(el("div", { className: "body" }, [markdown(item.body_md)]));
    if (rec(item.response_refused) && str(item.response_refused.reason)) {
      card.appendChild(el("div", { className: "note bad", text: "Your last answer was not taken: " + item.response_refused.reason }));
    }
    var press = function (action) { return function () { submit(item, action); }; };
    var actions = el("div", { className: "actions" });
    if (item.type === "ack") actions.appendChild(button("Acknowledge", true, press("ack"), busy));
    else if (item.type === "approve") {
      actions.appendChild(button("Approve", true, press("Approve"), busy));
      actions.appendChild(button("Reject", false, press("Reject"), busy));
    } else if (item.type === "do") {
      card.appendChild(textField(item, "feedback", "Feedback (optional, Markdown)"));
      actions.appendChild(button("Done", true, press("done"), busy));
      actions.appendChild(button("Not done", false, press("not_done"), busy));
    } else if (item.type === "question") {
      card.appendChild(textField(item, "text", "Your answer (Markdown)"));
      actions.appendChild(button("Submit", true, press("submit"), busy));
    } else {
      var opts = el("div", { className: "opts" });
      var kind = item.multiSelect === true ? "checkbox" : "radio";
      (item.options || []).forEach(function (option, n) {
        var input = el("input", { type: kind, name: "o-" + item.id, id: "o-" + item.id + "-" + n, "data-option": option.label });
        input.checked = draft !== undefined && draft.picked.indexOf(option.label) >= 0;
        input.addEventListener("change", function () {
          var d = draftOf(item.id);
          if (item.multiSelect === true) {
            d.picked = d.picked.filter(function (l) { return l !== option.label; });
            if (input.checked) d.picked.push(option.label);
          } else if (input.checked) {
            // Single-select: picking an option clears Other, as the pane does.
            d.picked = [option.label];
            d.fields.set("other", "");
            var other = card.querySelector('[data-field="other"]');
            if (other) other.value = "";
          }
        });
        opts.appendChild(el("label", { className: "opt", "for": "o-" + item.id + "-" + n }, [
          input, el("span", { text: option.label }, [el("small", { text: option.description })])
        ]));
      });
      opts.appendChild(el("div", { className: "opt other" }, [textField(item, "other", "Other… (Markdown)")]));
      card.appendChild(opts);
      actions.appendChild(button("Submit", true, press("submit"), busy));
    }
    if (item.notes === true) card.appendChild(textField(item, "notes", "Notes (optional, Markdown)"));
    var result = state.results.get(item.id);
    if (result) actions.appendChild(el("span", { className: result.bad ? "status bad" : "status", text: result.text, role: "status" }));
    card.appendChild(actions);
    card.appendChild(metaLine(item));
    return card;
  }

  /* An answer as the person gave it: each free-text field drawn as Markdown. */
  function answerNode(r, when) {
    var box = el("div", { className: "ans" });
    box.appendChild(el("div", { className: "ans-when", text: when }));
    if (!rec(r)) return box;
    if (r.acknowledged === true) box.appendChild(el("p", { text: "Acknowledged" }));
    else if (r.outcome === "done" || r.outcome === "not_done") {
      box.appendChild(el("p", { text: r.outcome === "done" ? "Done" : "Not done" }));
      if (str(r.feedback)) box.appendChild(markdown(r.feedback));
    } else if (str(r.text)) box.appendChild(markdown(r.text));
    else {
      var picked = Array.isArray(r.selected) ? r.selected.filter(str) : [];
      if (picked.length > 0) box.appendChild(el("p", { text: picked.join("; ") }));
      if (str(r.other)) { box.appendChild(el("div", { className: "ans-label", text: "Other" })); box.appendChild(markdown(r.other)); }
    }
    if (str(r.notes)) { box.appendChild(el("div", { className: "ans-label", text: "Notes" })); box.appendChild(markdown(r.notes)); }
    return box;
  }
  function waitingCard(item, answer) {
    var card = el("section", { className: "card" });
    card.appendChild(chips(item));
    card.appendChild(el("h2", { text: item.question }));
    if (answer.newer) {
      card.appendChild(el("div", { className: "ans" }, [el("div", { className: "ans-when", text: "Answered on a newer humantray page: the answer cannot be shown here." })]));
    } else {
      card.appendChild(answerNode(answer.response, "The stored answer, given " + ago(answer.answered_at)));
    }
    var result = state.results.get(item.id);
    if (result) card.appendChild(el("span", { className: result.bad ? "status bad" : "status", text: result.text, role: "status" }));
    card.appendChild(metaLine(item, "not picked up yet"));
    return card;
  }
  function historyCard(item) {
    var card = el("details", { className: "card" });
    var summary = el("summary", null, [chips(item), el("strong", { text: item.question })]);
    card.appendChild(summary);
    if (item.body_md !== "") card.appendChild(el("div", { className: "body" }, [markdown(item.body_md)]));
    card.appendChild(answerNode(item.response, "Answered " + ago(item.response_at)));
    var owesLine = !(item.type === "ack" && item.notify_on_done !== true);
    card.appendChild(metaLine(item, !owesLine ? "" : item.delivered ? "delivered" : "not picked up yet"));
    return card;
  }

  function askerName(item) { return str(item.session_title) && item.session_title.trim() !== "" ? item.session_title : "A session"; }

  function grouped(items, draw) {
    var leads = new Map();
    items.forEach(function (item) {
      var lead = str(item.lead_session_id) ? item.lead_session_id : "";
      if (!leads.has(lead)) leads.set(lead, new Map());
      var askers = leads.get(lead);
      if (!askers.has(item.session_id)) askers.set(item.session_id, []);
      askers.get(item.session_id).push(item);
    });
    var out = [];
    leads.forEach(function (askers, lead) {
      var group = el("section", { className: "group" });
      var leadItems = askers.get(lead);
      var title = el("h3", { className: "group-title" });
      title.appendChild(document.createTextNode("Lead: "));
      title.appendChild(sessionLink(lead, leadItems ? askerName(leadItems[0]) : (lead === "" ? "none" : "a lead session")));
      group.appendChild(title);
      askers.forEach(function (list, session) {
        var asker = el("div", { className: "asker" });
        var head = el("p", { className: "asker-title" });
        head.appendChild(document.createTextNode("Asked by "));
        head.appendChild(sessionLink(session, askerName(list[0])));
        asker.appendChild(head);
        list.forEach(function (item) { asker.appendChild(draw(item)); });
        group.appendChild(asker);
      });
      out.push(group);
    });
    return out;
  }

  function render() {
    var list = document.getElementById("list");
    var notes = document.getElementById("notes");
    notes.textContent = "";
    if (state.failed) notes.appendChild(el("div", { className: "note bad", text: state.failed }));
    if (state.newer > 0) notes.appendChild(el("div", { className: "note", text: state.newer + " item(s) written by a newer humantray could not be shown. Update the plugin and run /humantray-page." }));
    if (state.bad > 0) notes.appendChild(el("div", { className: "note", text: state.bad + " item(s) could not be read and are not shown." }));

    var waiting = [];
    var open = [];
    state.open.forEach(function (item) { if (countingAnswer(item)) waiting.push(item); else open.push(item); });
    var keep = function (item) {
      return (state.kind === "all" || KIND_OF[item.type] === state.kind) && (!state.asker || item.session_id === state.asker);
    };
    document.getElementById("count").textContent = String(open.length);
    document.getElementById("history-count").textContent = String(state.history.length);
    document.getElementById("tab-open").setAttribute("aria-pressed", String(state.tab === "open"));
    document.getElementById("tab-history").setAttribute("aria-pressed", String(state.tab === "history"));
    var chipRow = document.getElementById("chips");
    chipRow.textContent = "";
    KINDS.forEach(function (k) {
      var n = open.filter(function (item) { return k[0] === "all" || KIND_OF[item.type] === k[0]; }).length;
      var b = el("button", { type: "button", className: "pill", "aria-pressed": String(state.kind === k[0]), text: k[1] + " " + n });
      b.addEventListener("click", function () { state.kind = k[0]; render(); });
      chipRow.appendChild(b);
    });
    var select = document.getElementById("asker");
    var askers = new Map();
    state.open.concat(state.history).forEach(function (item) { if (!askers.has(item.session_id)) askers.set(item.session_id, askerName(item)); });
    var chosen = state.asker;
    select.textContent = "";
    select.appendChild(el("option", { value: "", text: "All sessions" }));
    askers.forEach(function (name, id) {
      var option = el("option", { value: id, text: name });
      if (id === chosen) option.selected = true;
      select.appendChild(option);
    });

    // The field being typed in keeps its focus, caret and scroll across the redraw.
    var active = document.activeElement;
    var focus = active && active.id && list.contains(active)
      ? { id: active.id, start: active.selectionStart, end: active.selectionEnd, scroll: active.scrollTop }
      : null;
    list.textContent = "";
    drawList(list, open, waiting, keep);
    if (focus) {
      var again = document.getElementById(focus.id);
      if (again) {
        again.focus({ preventScroll: true });
        if (typeof focus.start === "number" && typeof again.setSelectionRange === "function") {
          try { again.setSelectionRange(focus.start, focus.end); } catch (e) { /* not a text field */ }
        }
        again.scrollTop = focus.scroll || 0;
      }
    }
  }

  function drawList(list, open, waiting, keep) {
    if (!state.loaded) {
      list.appendChild(el("div", { className: "empty", text: "Loading the asks from this page's database…" }));
      return;
    }
    if (state.tab === "open") {
      var shown = open.filter(keep);
      if (shown.length === 0) list.appendChild(el("div", { className: "empty", text: "Nothing waiting on you. Asks the sessions raise in this repository appear here." }));
      grouped(shown, openCard).forEach(function (g) { list.appendChild(g); });
      var held = waiting.filter(keep);
      if (held.length > 0) {
        var section = el("section", { className: "group" });
        section.appendChild(el("h3", { className: "group-title", text: "Answered, waiting for the session to pick it up" }));
        held.forEach(function (item) { section.appendChild(waitingCard(item, countingAnswer(item))); });
        list.appendChild(section);
      }
    } else {
      var past = state.history.filter(keep);
      if (past.length === 0) list.appendChild(el("div", { className: "empty", text: "No answered items yet." }));
      past.forEach(function (item) { list.appendChild(historyCard(item)); });
    }
  }

  function readAll(snapshot, into) {
    var good = [];
    var newer = 0;
    var bad = 0;
    snapshot.docs.forEach(function (doc) {
      var read = readItem(doc.id, doc.data());
      if (read.ok) good.push(read.ok); else if (read.newer) newer += 1; else bad += 1;
    });
    into.good = good; into.newer = newer; into.bad = bad;
  }

  var counts = { open: { newer: 0, bad: 0 }, history: { newer: 0, bad: 0 } };
  function recount() {
    state.newer = counts.open.newer + counts.history.newer;
    state.bad = counts.open.bad + counts.history.bad;
  }

  async function start() {
    document.getElementById("tab-open").addEventListener("click", function () { state.tab = "open"; render(); });
    document.getElementById("tab-history").addEventListener("click", function () { state.tab = "history"; render(); });
    document.getElementById("asker").addEventListener("change", function (e) { state.asker = e.target.value; render(); });
    render();
    if (!window.claude || typeof window.claude.use !== "function") {
      state.failed = "Open this page in claude.ai, signed in, to see its asks.";
      state.loaded = true; render(); return;
    }
    db = await window.claude.use("db");
    if (!db) {
      state.failed = "This page's database is not available here. Open it in claude.ai, signed in as its owner.";
      state.loaded = true; render(); return;
    }
    var slow = setTimeout(function () {
      if (!state.loaded) { state.failed = "The asks cannot be reached yet. They appear here once the database answers."; render(); }
    }, 10000);
    var failed = function (e) {
      clearTimeout(slow);
      state.failed = "The page lost its database (" + ((e && e.code) || "error") + "). Reload it to try again.";
      state.loaded = true; render();
    };
    db.doc("meta/page").onSnapshot(function (snap) {
      var meta = snap.exists ? snap.data() : null;
      if (rec(meta) && str(meta.repo)) document.getElementById("title").textContent = "humantray · " + meta.repo.replace(/^github\.com\//, "");
    }, function () {});
    db.collection("items").where("status", "==", "open").onSnapshot(function (snap) {
      var into = {};
      readAll(snap, into);
      state.open = into.good.sort(function (a, b) { return b.updated - a.updated; });
      counts.open = { newer: into.newer, bad: into.bad };
      recount();
      if (!snap.metadata.fromCache) { clearTimeout(slow); state.loaded = true; if (state.failed.indexOf("cannot be reached") === 0) state.failed = ""; }
      render();
    }, failed);
    db.collection("responses").onSnapshot(function (snap) {
      var map = new Map();
      snap.docs.forEach(function (doc) { var r = readResponse(doc.data(), doc.id); if (r) map.set(doc.id, r); });
      state.responses = map;
      render();
    }, failed);
    db.collection("items").where("status", "in", ["acknowledged", "done", "answered"]).orderBy("response_at", "desc").limit(200)
      .onSnapshot(function (snap) {
        var into = {};
        readAll(snap, into);
        state.history = into.good;
        counts.history = { newer: into.newer, bad: into.bad };
        recount();
        render();
      }, failed);
  }

  start();
})();
</script>
`

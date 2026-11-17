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

  var state = { tab: "open", kind: "all", asker: "", open: [], responses: {}, history: [], newer: 0, bad: 0, loaded: false, failed: "", busy: {}, results: {} };
  var db = null;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) for (var key in attrs) {
      if (key === "text") node.textContent = attrs[key];
      else if (key === "className") node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    }
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
  function readResponse(data) {
    if (!rec(data) || data.schema !== 1) return null;
    if (!str(data.id) || !str(data.answer_id) || !ANSWER_ID.test(data.answer_id)) return null;
    if (["acknowledged", "done", "answered"].indexOf(data.status) < 0 || !rec(data.response) || !num(data.answered_at)) return null;
    if (!rec(data.seen) || !num(data.seen.bumps) || !num(data.seen.updated) || (data.by !== "page" && data.by !== "viewer")) return null;
    return data;
  }
  /* Rule 1: an answer counts only when it reads and is not the one the session refused. */
  function countingAnswer(item) {
    var answer = state.responses[item.id];
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
  /* [label](href "title"), from the [ at i: the parts and where it ends, or null. */
  function bracketLink(text, i) {
    var depth = 0;
    var j = i;
    for (; j < text.length; j++) {
      var ch = text.charAt(j);
      if (ch === "\\") { j++; continue; }
      if (ch === "[") depth++;
      else if (ch === "]") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0 || text.charAt(j + 1) !== "(") return null;
    var m = /^\(\s*(<[^<>\n]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/.exec(text.slice(j + 1));
    if (!m) return null;
    var href = m[1].charAt(0) === "<" ? m[1].slice(1, -1) : m[1];
    return { label: text.slice(i + 1, j), href: href, title: m[2] ? m[2].slice(1, -1) : "", end: j + 1 + m[0].length };
  }
  /* **strong**, *em*, __strong__, _em_ or ~~del~~ from the delimiter at i, or null. */
  function emphasis(text, i) {
    var ch = text.charAt(i);
    var run = /^(\*+|_+|~+)/.exec(text.slice(i))[0];
    if (ch === "~" && run.length !== 2) return null;
    var size = ch === "~" || run.length >= 2 ? 2 : 1;
    var after = text.charAt(i + size);
    if (after === "" || /\s/.test(after)) return null;
    if (ch === "_" && i > 0 && /[A-Za-z0-9]/.test(text.charAt(i - 1))) return null;
    var delim = size === 2 ? ch + ch : ch;
    var start = i + size;
    for (var j = start + 1; j <= text.length - size; j++) {
      if (text.substr(j, size) !== delim) continue;
      if (text.charAt(j - 1) === "\\" || /\s/.test(text.charAt(j - 1))) continue;
      if (size === 1 && text.charAt(j + 1) === ch) { j++; continue; }
      while (size === 2 && text.charAt(j + size) === ch) j++;
      if (ch === "_" && /[A-Za-z0-9]/.test(text.charAt(j + size))) continue;
      return { tag: ch === "~" ? "del" : size === 2 ? "strong" : "em", inner: text.slice(start, j), end: j + size };
    }
    return null;
  }
  function inline(text, parent) {
    var buf = "";
    function flushText() { if (buf) { parent.appendChild(document.createTextNode(buf)); buf = ""; } }
    var i = 0;
    while (i < text.length) {
      var c = text.charAt(i);
      var rest = text.slice(i);
      var m;
      if (c === "\\") {
        var next = text.charAt(i + 1);
        if (next === "\n") { flushText(); parent.appendChild(el("br")); i += 2; continue; }
        if (next && PUNCT.test(next)) { buf += next; i += 2; continue; }
        buf += c; i++; continue;
      }
      if (c === "\n") {
        if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ""); flushText(); parent.appendChild(el("br")); }
        else buf = buf.replace(/ +$/, "") + "\n";
        i++; continue;
      }
      if (c === "\x60") {
        m = /^(\x60+)([\s\S]*?[^\x60])\1(?!\x60)/.exec(rest);
        if (m) {
          flushText();
          var code = m[2].replace(/\n/g, " ");
          if (/^ [\s\S]* $/.test(code) && code.trim() !== "") code = code.slice(1, -1);
          parent.appendChild(el("code", { text: code }));
          i += m[0].length; continue;
        }
        m = /^\x60+/.exec(rest);
        buf += m[0]; i += m[0].length; continue;
      }
      if (c === "<") {
        m = /^<(https?:\/\/[^\s<>]+)>/i.exec(rest);
        if (m && safeUrl(m[1])) {
          var auto = m[1];
          flushText();
          link(auto, function (a) { a.textContent = auto; }, parent);
          i += m[0].length; continue;
        }
        buf += c; i++; continue;
      }
      if (c === "!" && text.charAt(i + 1) === "[") {
        var image = bracketLink(text, i + 1);
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
        var found = bracketLink(text, i);
        if (found) {
          flushText();
          if (!link(found.href, function (a) { inline(found.label, a); }, parent, found.title)) inline(found.label, parent);
          i = found.end; continue;
        }
      }
      if ((c === "h" || c === "H") && (i === 0 || /[\s(*_~]/.test(text.charAt(i - 1)))) {
        m = /^https?:\/\/[^\s<]+/i.exec(rest);
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
        var span = emphasis(text, i);
        if (span) {
          flushText();
          var node = el(span.tag);
          inline(span.inner, node);
          parent.appendChild(node);
          i = span.end; continue;
        }
        m = /^(\*+|_+|~+)/.exec(rest);
        buf += m[0]; i += m[0].length; continue;
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

  /* What the card's controls hold, as the pane would store it (buildResponse), or why not. */
  function responseFrom(item, card, action) {
    var value = function (name) { var f = card.querySelector('[data-field="' + name + '"]'); return f ? f.value : ""; };
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
        var picked = Array.prototype.filter.call(card.querySelectorAll('input[data-option]'), function (x) { return x.checked; })
          .map(function (x) { return x.getAttribute("data-option"); });
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

  /* Rule 3: read; write only when no answer counts; read back to see whose answer was stored. */
  async function submit(item, card, action) {
    var built = responseFrom(item, card, action);
    if (built.error) { state.results[item.id] = { bad: true, text: built.error }; render(); return; }
    state.busy[item.id] = true;
    state.results[item.id] = { text: "Saving…" };
    render();
    try {
      var ref = db.collection("responses").doc(item.id);
      var before = await ref.get();
      var existing = before.exists ? readResponse(before.data()) : null;
      var refused = rec(item.response_refused) ? item.response_refused.answer_id : null;
      if (existing && existing.answer_id !== refused) {
        state.results[item.id] = { text: "This item already has an answer." };
      } else {
        var mine = answerId();
        await ref.set({
          schema: 1, id: item.id, answer_id: mine, response: built.response, status: STATUS_OF[item.type],
          answered_at: Date.now(), seen: { bumps: item.bumps, updated: item.updated }, by: "page"
        });
        var after = await ref.get();
        var stored = after.exists ? readResponse(after.data()) : null;
        state.results[item.id] = stored && stored.answer_id === mine
          ? { text: "Saved. The session picks it up at its next turn." }
          : { bad: true, text: "Another answer was stored first." };
      }
    } catch (e) {
      var code = e && e.code;
      state.results[item.id] = { bad: true, text: code === "invalid_argument" || code === "not_granted"
        ? "This page cannot save answers for you. Only the page's owner can answer here."
        : "The answer was not saved (" + (code || "error") + "). Try again." };
    }
    state.busy[item.id] = false;
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
  function textField(item, name, label, multiline) {
    var id = "f-" + item.id + "-" + name;
    var field = multiline
      ? el("textarea", { id: id, "data-field": name, maxlength: String(LIMIT), placeholder: label, "aria-label": label })
      : el("input", { id: id, type: "text", "data-field": name, maxlength: String(LIMIT), placeholder: label, "aria-label": label });
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
    var busy = state.busy[item.id] === true;
    card.appendChild(chips(item));
    card.appendChild(el("h2", { text: item.question }));
    if (item.body_md !== "") card.appendChild(el("div", { className: "body" }, [markdown(item.body_md)]));
    if (rec(item.response_refused) && str(item.response_refused.reason)) {
      card.appendChild(el("div", { className: "note bad", text: "Your last answer was not taken: " + item.response_refused.reason }));
    }
    var press = function (action) { return function () { submit(item, card, action); }; };
    var actions = el("div", { className: "actions" });
    if (item.type === "ack") actions.appendChild(button("Acknowledge", true, press("ack"), busy));
    else if (item.type === "approve") {
      actions.appendChild(button("Approve", true, press("Approve"), busy));
      actions.appendChild(button("Reject", false, press("Reject"), busy));
    } else if (item.type === "do") {
      card.appendChild(textField(item, "feedback", "Feedback (optional, Markdown)", true));
      actions.appendChild(button("Done", true, press("done"), busy));
      actions.appendChild(button("Not done", false, press("not_done"), busy));
    } else if (item.type === "question") {
      card.appendChild(textField(item, "text", "Your answer (Markdown)", true));
      actions.appendChild(button("Submit", true, press("submit"), busy));
    } else {
      var opts = el("div", { className: "opts" });
      var kind = item.multiSelect === true ? "checkbox" : "radio";
      (item.options || []).forEach(function (option, n) {
        var input = el("input", { type: kind, name: "o-" + item.id, id: "o-" + item.id + "-" + n, "data-option": option.label });
        opts.appendChild(el("label", { className: "opt", "for": "o-" + item.id + "-" + n }, [
          input, el("span", { text: option.label }, [el("small", { text: option.description })])
        ]));
      });
      opts.appendChild(el("div", { className: "opt other" }, [textField(item, "other", "Other… (Markdown)", true)]));
      card.appendChild(opts);
      actions.appendChild(button("Submit", true, press("submit"), busy));
    }
    if (item.notes === true) card.appendChild(textField(item, "notes", "Notes (optional, Markdown)", true));
    var result = state.results[item.id];
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
    card.appendChild(answerNode(answer.response, "Answered " + ago(answer.answered_at)));
    var result = state.results[item.id];
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
    var leads = {};
    var order = [];
    items.forEach(function (item) {
      var lead = str(item.lead_session_id) ? item.lead_session_id : "";
      if (!leads[lead]) { leads[lead] = {}; order.push(lead); }
      var asker = leads[lead];
      if (!asker[item.session_id]) asker[item.session_id] = [];
      asker[item.session_id].push(item);
    });
    var out = [];
    order.forEach(function (lead) {
      var group = el("section", { className: "group" });
      var leadItem = null;
      Object.keys(leads[lead]).forEach(function (s) { if (s === lead) leadItem = leads[lead][s][0]; });
      var title = el("h3", { className: "group-title" });
      title.appendChild(document.createTextNode("Lead: "));
      title.appendChild(sessionLink(lead, leadItem ? askerName(leadItem) : (lead === "" ? "none" : "a lead session")));
      group.appendChild(title);
      Object.keys(leads[lead]).forEach(function (s) {
        var list = leads[lead][s];
        var asker = el("div", { className: "asker" });
        var head = el("p", { className: "asker-title" });
        head.appendChild(document.createTextNode("Asked by "));
        head.appendChild(sessionLink(s, askerName(list[0])));
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
    var askers = {};
    state.open.concat(state.history).forEach(function (item) { if (!askers[item.session_id]) askers[item.session_id] = askerName(item); });
    var chosen = state.asker;
    select.textContent = "";
    select.appendChild(el("option", { value: "", text: "All sessions" }));
    Object.keys(askers).forEach(function (id) {
      var option = el("option", { value: id, text: askers[id] });
      if (id === chosen) option.selected = true;
      select.appendChild(option);
    });

    list.textContent = "";
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
      var map = {};
      snap.docs.forEach(function (doc) { var r = readResponse(doc.data()); if (r && r.id === doc.id) map[doc.id] = r; });
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

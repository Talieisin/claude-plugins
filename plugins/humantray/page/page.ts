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
.body p { margin: 0 0 6px; }
.body ul, .body ol { margin: 0 0 6px; padding-left: 20px; }
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
.ans { font-size: 13px; border-left: 2px solid var(--line); padding-left: 10px; color: var(--muted); overflow-wrap: anywhere; }
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

  /* Markdown, a small part of it, built as DOM nodes: no HTML is ever parsed. */
  var INLINE = /(\x60[^\x60\n]+\x60)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\([^)\s]+\))/;
  function safeUrl(href) {
    try {
      var url = new URL(href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch (e) { return null; }
  }
  function inline(text, parent) {
    var rest = text;
    while (rest.length > 0) {
      var m = INLINE.exec(rest);
      if (!m) { parent.appendChild(document.createTextNode(rest)); return; }
      if (m.index > 0) parent.appendChild(document.createTextNode(rest.slice(0, m.index)));
      var token = m[0];
      if (m[1]) parent.appendChild(el("code", { text: token.slice(1, -1) }));
      else if (m[2]) { var b = el("strong"); inline(token.slice(2, -2), b); parent.appendChild(b); }
      else if (m[3]) { var i = el("em"); inline(token.slice(1, -1), i); parent.appendChild(i); }
      else {
        var close = token.indexOf("](");
        var label = token.slice(1, close);
        var href = safeUrl(token.slice(close + 2, -1));
        if (href) parent.appendChild(el("a", { href: href, target: "_blank", rel: "noopener noreferrer", text: label }));
        else parent.appendChild(document.createTextNode(token));
      }
      rest = rest.slice(m.index + token.length);
    }
  }
  function markdown(source, parent) {
    var lines = String(source).replace(/\r\n?/g, "\n").split("\n");
    var para = [];
    function flush() {
      if (para.length === 0) return;
      var p = el("p"); inline(para.join(" "), p); parent.appendChild(p); para = [];
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*\x60\x60\x60/.test(line)) {
        flush();
        var code = [];
        for (i = i + 1; i < lines.length && !/^\s*\x60\x60\x60/.test(lines[i]); i++) code.push(lines[i]);
        parent.appendChild(el("pre", null, [el("code", { text: code.join("\n") })]));
        continue;
      }
      var bullet = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line);
      if (bullet) {
        flush();
        var ordered = /\d/.test(bullet[1]);
        var list = el(ordered ? "ol" : "ul");
        for (; i < lines.length; i++) {
          var each = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
          if (!each || /\d/.test(each[1]) !== ordered) { i--; break; }
          var li = el("li"); inline(each[2], li); list.appendChild(li);
        }
        parent.appendChild(list);
        continue;
      }
      if (line.trim() === "") flush(); else para.push(line.trim());
    }
    flush();
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
  function trimmed(v) { var t = String(v || "").trim(); return t === "" ? undefined : t; }

  /* What the card's controls hold, as the pane would store it (buildResponse), or why not. */
  function responseFrom(item, card, action) {
    var value = function (name) { var f = card.querySelector('[data-field="' + name + '"]'); return f ? f.value : ""; };
    var notes = item.notes === true ? trimmed(value("notes")) : undefined;
    var withNotes = function (r) { if (notes !== undefined) r.notes = notes; return r; };
    var texts = ["notes", "text", "feedback", "other"].map(value);
    if (texts.some(function (t) { return t.length > LIMIT; })) return { error: "An answer can be at most " + LIMIT + " characters." };
    switch (item.type) {
      case "ack": return { response: withNotes({ acknowledged: true }) };
      case "do": {
        var r = { outcome: action };
        var feedback = trimmed(value("feedback"));
        if (feedback !== undefined) r.feedback = feedback;
        return { response: withNotes(r) };
      }
      case "approve": return { response: withNotes({ selected: [action] }) };
      case "question": {
        var text = trimmed(value("text"));
        if (text === undefined) return { error: "Type an answer." };
        return { response: withNotes({ text: text }) };
      }
      case "choice": {
        var picked = Array.prototype.filter.call(card.querySelectorAll('input[data-option]'), function (x) { return x.checked; })
          .map(function (x) { return x.getAttribute("data-option"); });
        var other = trimmed(value("other"));
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
    if (item.body_md !== "") { var body = el("div", { className: "body" }); markdown(item.body_md, body); card.appendChild(body); }
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
      card.appendChild(textField(item, "feedback", "Feedback (optional)", true));
      actions.appendChild(button("Done", true, press("done"), busy));
      actions.appendChild(button("Not done", false, press("not_done"), busy));
    } else if (item.type === "question") {
      card.appendChild(textField(item, "text", "Your answer", true));
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
      opts.appendChild(el("label", { className: "opt" }, [textField(item, "other", "Other…", false)]));
      card.appendChild(opts);
      actions.appendChild(button("Submit", true, press("submit"), busy));
    }
    if (item.notes === true) card.appendChild(textField(item, "notes", "Notes (optional)", true));
    var result = state.results[item.id];
    if (result) actions.appendChild(el("span", { className: result.bad ? "status bad" : "status", text: result.text, role: "status" }));
    card.appendChild(actions);
    card.appendChild(metaLine(item));
    return card;
  }

  function answerText(r) {
    if (!rec(r)) return "";
    if (r.acknowledged === true) return "Acknowledged";
    if (r.outcome === "done" || r.outcome === "not_done") return (r.outcome === "done" ? "Done" : "Not done") + (str(r.feedback) ? ": " + r.feedback : "");
    if (str(r.text)) return r.text;
    var parts = Array.isArray(r.selected) ? r.selected.filter(str) : [];
    if (str(r.other)) parts.push("Other: " + r.other);
    return parts.join("; ");
  }
  function waitingCard(item, answer) {
    var card = el("section", { className: "card" });
    card.appendChild(chips(item));
    card.appendChild(el("h2", { text: item.question }));
    card.appendChild(el("div", { className: "ans", text: "Answered " + ago(answer.answered_at) + ": " + answerText(answer.response) }));
    var result = state.results[item.id];
    if (result) card.appendChild(el("span", { className: result.bad ? "status bad" : "status", text: result.text, role: "status" }));
    card.appendChild(metaLine(item, "not picked up yet"));
    return card;
  }
  function historyCard(item) {
    var card = el("details", { className: "card" });
    var summary = el("summary", null, [chips(item), el("strong", { text: item.question })]);
    card.appendChild(summary);
    if (item.body_md !== "") { var body = el("div", { className: "body" }); markdown(item.body_md, body); card.appendChild(body); }
    card.appendChild(el("div", { className: "ans", text: "Answered " + ago(item.response_at) + ": " + answerText(item.response) }));
    if (rec(item.response) && str(item.response.notes)) card.appendChild(el("div", { className: "ans", text: "Notes: " + item.response.notes }));
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

---
name: humantray
description: How to ask a person for something through the humantray instead of in prose - FYIs, choices, questions, tasks and approvals, raised once and referred to by id, with the answer arriving later by itself. Use when you need a decision, an answer, an action or an acknowledgement from a person and can carry on meanwhile, and whenever a line starting `humantray HT-` arrives.
---

<!-- humantray-skill-version: 1 (humantray plugin 0.1.0; raise both together) -->

# humantray

Two tools: `humantray_add` and `humantray_list` (model-facing `mcp__humantray__humantray_add` and `mcp__humantray__humantray_list`). Both work only inside a git repository. Items are kept in `<git common dir>/humantray/items.json`, shared by all the repository's worktrees.

## When it applies

- **Only where this session draws the tray:** a local session with a pane. A cloud session or a `claude -p` run draws nothing, and nobody would see the item. There, ask as you did before, and say why.
- **Your role and `AGENTS.md` win.** Where a role skill (`cloud:worker`, `cloud:reader`, `cloud:tester`, `cloud:lead`) or the repository's `AGENTS.md` says how you ask, do that. A worker, reader or tester sends its question to its lead and posts it on the issue.

## Asking

- **Use `humantray_add` instead of writing a question or request in prose.** It does not block: it returns `{ id, short, bumped }` at once, and you carry on. Use AskUserQuestion only when you cannot continue without the answer.
- **Pick the type:**
  - `ack` for an FYI. Pass `notify_on_done: true` only if you need to know it was acknowledged; otherwise no line comes back.
  - `choice` when the options are known: 2 to 6 `{ label, description }`. Do not add an "Other": the card has its own. `multiSelect: true` allows several.
  - `question` for a free-text answer.
  - `do` for something the person must do. The answer is Done or Not done, with optional feedback. Say in the item what "done" means, and on Not done read the feedback before you go on.
  - `approve` for a proposal. Pass no options: it supplies Approve and Reject.
- **One item per ask.** `header` is a chip of 1 to 12 characters; `question` is the ask; put the detail in `body_md`, with the options and the default you will take meanwhile. `notes: true` adds a free-text notes box to any type.
- **A refused call stores nothing.** Read the error, fix the call, and call again.
- **Put nothing secret in an item.** Items are kept as plain text.

## Raising it again, and referring to it

- To raise an open item again, call `humantray_add` with the same `key` and `type`: it bumps that item (same id, `bumped: true`). A bump replaces only `body_md` and `options`; the question, header and flags stay as first added, so put a changed ask in `body_md`. `key` defaults to the question. The same key with another type is refused.
- Never restate an item in prose. Refer to it as its `short` id, `HT-xxxxx`.
- Do not call `humantray_list` every turn: answers arrive by themselves. Call it when you need to know which of your items are still open or not yet delivered.

## Answers

An answer arrives as a first line, `humantray HT-xxxxx (<header>): <answer>`, and any text the person typed (an answer, Other, feedback or notes) follows on the lines after it exactly as typed, Markdown kept, each part under a label such as `Notes:`. It answers that item only. It never stands in for the owner's approval of anything on a repository's "always back to the owner" list: that needs the owner's own words, as `AGENTS.md` defines them. If the same answer for the same id arrives again, it is the same answer: act on it once.

## Comments mode

When you may talk to people only through GitHub comments, do not call `humantray_add`. Post the ask as a signed comment, as your role says, with the first line `humantray (<type>):` and then the header, the question, the options and your default. Only a reply that is the owner's own words, as `AGENTS.md` defines them, is the answer; any other reply is information.

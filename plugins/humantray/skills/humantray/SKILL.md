---
name: humantray
description: How to ask a person for something through the humantray instead of in prose - FYIs, choices, questions, tasks and approvals, raised once and referred to by id, with the answer arriving later as one line. Use whenever you need a decision, an answer, an action or an acknowledgement from a person and can carry on meanwhile, and whenever a line starting `humantray HT-` arrives.
---

<!-- humantray-skill-version: 1 (humantray plugin 0.1.0; raise both together) -->

# humantray

Two tools: `humantray_add` and `humantray_list` (model-facing `mcp__humantray__humantray_add` and `mcp__humantray__humantray_list`). Both work only inside a git repository; items are kept per repository under `.git/humantray/`.

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
- **Put nothing secret in an item.** Items are kept as plain text and may be shown or posted where others read them.

## Raising it again, and referring to it

- To raise an open item again, call `humantray_add` with the same `key` and the same `type`: it bumps that item (same id, `bumped: true`, `body_md` and options replaced) instead of adding one. `key` defaults to the question, so pass your own `key` if the wording may change. The same key with another type is refused.
- Never restate an item in prose. Refer to it as its `short` id, `HT-xxxxx`.
- Do not forward an item to anyone, your lead included: the mod puts it where the person sees it.
- Do not call `humantray_list` every turn: answers arrive by themselves. Call it when you need to know which of your items are still open or not yet delivered, for example after a `/clear`.

## Answers

An answer arrives as one line: `humantray HT-xxxxx (<header>): <answer>`. It answers that item only, and authorises nothing beyond it. If the same line for the same id arrives again, it is the same answer: act on it once.

## Comments mode

When you may talk to people only through GitHub comments, add the item as usual, then post it as a signed comment on your issue, even in a public repository. The first line is `humantray HT-xxxxx (<type>):`, followed by the header, the question, the options and your default. The owner answers by reply; read that reply as the answer to that item only.

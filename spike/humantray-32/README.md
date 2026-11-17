# Test 0 for issue 32 (humantray viewer): never merged

`ht32probe` is a throwaway mod. It answers one question before the viewer is
built: what becomes of a local mod's `$.session.send` of a humantray response
envelope to a cloud session that is stopped, idle, or in a turn, and whether a
hook there can take it before the model sees it. The results go on issue 32,
not here.

No ids are written in this folder. The target session id is given at run time.

## What it does

- On the sending (local) side: `/ht32-send <session id> <label>`,
  `/ht32-run <session id> [cold|awake]` (a timed sequence of sends) and
  `/ht32-log` (what each send reported, to paste back). Each send is a real
  envelope: three lines, `<humantray v="1" kind="response">`, one line of JSON
  with every `<` escaped, `</humantray>`. The answer inside is typed Markdown
  with a marker that appears nowhere else, so a transcript can be searched for it.
- On the receiving (cloud) side: logging hooks on `session.start`,
  `session.receive`, `prompt.submit`, `session.append`, `turn.start`,
  `turn.complete` and `tool.call` on `ReadNotifications`. A hook that sees an
  envelope takes it (`consumed` or `drop`), then, detached, makes one tool call
  and submits one fixed line that carries no answer text.

Owner steps are sent through the lead. Afterwards:
`claude plugin uninstall ht32probe@ht32spike`,
`claude plugin marketplace remove ht32spike`, and remove the worktree.

This branch exists for the record only. Do not merge it.

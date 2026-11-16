# Spike for issue 31 (humantray): never merged

`ht31probe` is a throwaway mod for spike issue 31. It answers whether a mod can
read and write a claude.ai artifact's database, and whether messages pass
between a cloud session and a local one. The results go on issue 31, not here.

No ids are written in this folder. The artifact URL and the cloud session id are
given at run time with `/ht31-setup`, and kept in the mod's own store.

## What it does

- A model-callable tool `mcp__ht31probe__probe` with fixed actions only: `setup`,
  `env`, `db-write`, `db-read`, `artifact-find`, `artifact-create`, `send`,
  `store-mark`, `store-read`, `log`. Message texts and rows are fixed test text.
- `/ht31-setup <artifact-url> <cloud-session-id>`, `/ht31-run` and `/ht31-log`
  for a local run.
- Logging hooks on `session.receive`, `prompt.submit` and `tool.call` for
  `ReadNotifications`, to see which one a message from another session reaches.
  When an artifact URL is set, a received message is also written as a row.

## Running it locally (the owner's half)

In an already-running local session (keeps its Remote Control id), from the root
of a checkout of this repository:

```text
! git fetch origin spike/humantray-31 && git worktree add --detach ../ht31-spike FETCH_HEAD
/plugin marketplace add ../ht31-spike/spike/humantray-31
/plugin install ht31probe@ht31spike
/reload-plugins
```

Or start a fresh session with it instead:

```sh
claude --plugin-dir ../ht31-spike/spike/humantray-31/ht31probe --remote-control ht31-local
```

Then `/ht31-setup <artifact-url> <cloud-session-id>`, `/ht31-run`, and `/ht31-log`
when asked. The lead sends the real URL and id.

Afterwards: `/plugin uninstall ht31probe@ht31spike`, `/plugin marketplace remove ht31spike`,
`! git worktree remove ../ht31-spike`.

This branch exists for the record only. Do not merge it.

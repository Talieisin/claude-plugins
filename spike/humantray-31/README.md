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

```sh
git clone --depth 1 --branch spike/humantray-31 https://github.com/Talieisin/claude-plugins.git ht31-spike
cd ht31-spike
claude --plugin-dir spike/humantray-31/ht31probe --remote-control ht31-local
```

Then, in that session, the two commands the lead sends you (with the real URL
and id), and `/ht31-log` when asked.

This branch exists for the record only. Do not merge it.

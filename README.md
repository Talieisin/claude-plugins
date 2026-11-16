# claude-plugins

Claude Code plugins from Talieisin. Two so far: `cloud`, for running batches of
GitHub issues in cloud sessions, and `github`, the pull-request skill it relies
on, which is also useful on its own.

## `cloud`: batches of GitHub issues, done by cloud sessions

Skills that let a Claude Code cloud session (claude.ai/code) take a batch of
GitHub issues to merged pull requests:

- a **lead** plans the batch, starts the other sessions, decides small questions
  for you inside limits you set, and merges one pull request at a time;
- a **worker** per piece of work writes the code and opens the pull request;
- a **reader** per pull request, which did not write it, reads the diff against
  the issue and reports what is wrong;
- a **retro** judges past batches and proposes changes to the skills.

Neither plugin has hooks: nothing runs by itself. The `github` plugin ships three
read-only scripts that its skill calls on your own machine.

| Skill | Used by |
|---|---|
| `cloud:lead` | The session you start to run a batch |
| `cloud:worker` | Sessions the lead starts, one per lane |
| `cloud:reader` | Sessions the lead starts, one per pull request |
| `cloud:retro` | A session you start to review past batches |
| `github:pull-request` | All of them, and you: a pull request from open to merged. One set of rules and two routes, `gh` and GraphQL on your own machine, REST in a cloud session where those do not work |

## Quick start

1. Add three lines to your cloud environment's setup script:

   ```bash
   claude plugin marketplace add Talieisin/claude-plugins
   claude plugin install cloud@talieisin
   claude plugin install github@talieisin
   ```

2. Put your authorisation in the repository's `AGENTS.md`, starting from
   [`templates/AGENTS.md`](templates/AGENTS.md). If the repository also has a
   `CLAUDE.md`, add the line `@AGENTS.md` to it.
3. Create the labels with [`templates/labels.sh`](templates/labels.sh).
4. Label some issues `agent:ready`, open a tracking issue, and start a session
   that names it as its brief.

The full walk-through, with what is optional and how to keep it working, is in
[`docs/setup.md`](docs/setup.md).

## What is in this repository

| Path | What |
|---|---|
| `plugins/cloud/` | The `cloud` plugin: lead, worker, reader, retro |
| `plugins/github/` | The `github` plugin: the pull-request skill, its two routes and its scripts |
| `docs/setup.md` | How to set a repository and an environment up |
| `templates/` | Files to copy: `AGENTS.md` (your authorisation and the repository's facts), labels, setup script, tracking issue, the optional start-from-a-label workflow |
| `optional/mise/` | Pinned tool versions in a cloud session, for those who want them |
| `AGENTS.md` | For anyone, human or agent, changing this repository |

## Status

These skills were worked out over a series of test batches on toy repositories
and are still changing. They are versioned: every skill file carries a
`shared-skill-version` marker, and a lead says which version it holds in its
first comment. Expect rough edges, and read
[the limits in `docs/setup.md`](docs/setup.md#part-2-optional) before relying on
the less-used routes.

## Licence

MIT. See [`LICENSE`](LICENSE).

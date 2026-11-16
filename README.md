# claude-plugins

Claude Code plugins from Talieisin. One so far.

## `cloud`: batches of GitHub issues, done by cloud sessions

Skills that let a Claude Code cloud session (claude.ai/code) take a batch of
GitHub issues to merged pull requests:

- a **lead** plans the batch, starts the other sessions, decides small questions
  for you inside limits you set, and merges one pull request at a time;
- a **worker** per piece of work writes the code and opens the pull request;
- a **reader** per pull request, which did not write it, reads the diff against
  the issue and reports what is wrong;
- a **retro** judges past batches and proposes changes to the skills.

It is text only: instructions for Claude, no hooks and no code that runs on your
machine.

| Skill | Used by |
|---|---|
| `cloud:cloud-lead` | The session you start to run a batch |
| `cloud:cloud-worker` | Sessions the lead starts, one per lane |
| `cloud:cloud-reader` | Sessions the lead starts, one per pull request |
| `cloud:cloud-retro` | A session you start to review past batches |
| `cloud:cloud-github` | All of them: how to use GitHub from a cloud session, where `gh pr` and GraphQL do not work |

## Quick start

1. Add two lines to your cloud environment's setup script:

   ```bash
   claude plugin marketplace add Talieisin/claude-plugins
   claude plugin install cloud@talieisin
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
| `plugins/cloud/` | The plugin: its manifest and the skills |
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

# claude-plugins

Claude Code plugins from Talieisin. Five so far: `cloud`, for running batches of
GitHub issues in cloud sessions; `github`, the pull-request skill it relies on,
which is also useful on its own; `mise`, an optional hook that installs a
repository's pinned tools; `humantray`, an optional tray for what sessions
need from you; and `writing`, an optional skill for formal British professional
prose.

## `cloud`: batches of GitHub issues, done by cloud sessions

Skills that let a Claude Code cloud session (claude.ai/code) take a batch of
GitHub issues to merged pull requests:

- a **lead** plans the batch, starts the other sessions, decides small questions
  for you inside limits you set, and merges one pull request at a time;
- a **worker** per piece of work writes the code and opens the pull request;
- a **reader** per pull request, which did not write it, reads the diff against
  the issue and reports what is wrong;
- how much more review each piece of work gets is a **depth** from 0 to 3, chosen
  by the lead from a policy you write, and filled from whichever reviewers (a
  stronger Claude model, Codex) can actually be reached;
- a **retro** judges past batches and proposes changes to the skills.

Neither of those two has hooks: nothing runs by itself. (The two optional plugins, `mise` and `humantray`, do run code; see below.) The `github` plugin ships three
read-only scripts that its skill calls on your own machine.

| Skill | Used by |
|---|---|
| `cloud:lead` | The session you start to run a batch |
| `cloud:worker` | Sessions the lead starts, one per lane |
| `cloud:reader` | Sessions the lead starts, one per pull request, and to review a plan |
| `cloud:tester` | A session the lead starts to write a lane's tests before its code, at the deepest review depth |
| `cloud:retro` | A session you start to review past batches |
| `github:pull-request` | All of them, and you: a pull request from open to merged. One set of rules and two routes, `gh` and GraphQL on your own machine, REST in a cloud session where those do not work |

## `writing`: formal British professional prose

Optional. The `writing:professional-writing` skill sets out how to draft,
rewrite and review reports, proposals, policy documents and letters for an
expert reader, and carries `prose-lint`, a linter for the conventions a pattern
can find. No hooks: the linter runs only when called. See
[`plugins/writing/README.md`](plugins/writing/README.md).

## `humantray`: what sessions need from you, in one place

Optional. Instead of burying a question or a "please do this" in the middle of
their text, sessions add it to a tray: an FYI, a choice, a question, a to-do or
an approval. The session does not wait. You answer when you choose, and the
answer goes back to the session that asked, once.

- **Locally** the tray is a pane beside the chat (`/humantray-open`) and a band
  above the prompt.
- **After each release,** `/humantray-gallery` shows every card type and state
  as fixtures, drawn by the real card code, for one look per surface. Nothing
  there is stored or sent.
- **In cloud sessions** the items are also copied to a private page on your
  claude.ai account, one per repository, once you have made it. A local session on a computer that
  stays on can show those pages in its pane (`/humantray-viewer`).

It runs code: a hooks module, loaded in every session where the plugin is
installed. Items never go into git. How to turn it on, and its limits, are in
[`docs/setup.md`](docs/setup.md#a-tray-for-what-sessions-need-from-you-humantray).

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
| `plugins/mise/` | Optional `mise` plugin: installs a repository's pinned tools when a session starts. Runs a SessionStart hook |
| `plugins/humantray/` | Optional `humantray` plugin: the tray, its skill, the source of its page, and its tests. Runs a hooks module |
| `plugins/writing/` | Optional `writing` plugin: the professional-writing skill, its linter and the linter's tests. No hooks |
| `AGENTS.md` | For anyone, human or agent, changing this repository |

## Status

These skills were worked out over a series of test batches on toy repositories
and are still changing. They are versioned: every `cloud` skill file carries a
`shared-skill-version` marker and the pull-request skill a
`pull-request-skill-version` marker, and a lead names both versions in its first
comment. The humantray skill carries its own `humantray-skill-version` marker, and the professional-writing skill its `professional-writing-skill-version` marker. Expect rough edges, and read
[the limits in `docs/setup.md`](docs/setup.md#part-2-optional) before relying on
the less-used routes.

## Licence

MIT. See [`LICENSE`](LICENSE).

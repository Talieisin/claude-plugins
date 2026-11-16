# claude-plugins

Talieisin's shared Claude Code plugins, as one marketplace so that skills are
delivered once and not copied into every repository.

- Marketplace name: `talieisin` (`.claude-plugin/marketplace.json`)
- Synced to a claude.ai account from Plugins, Add, Add marketplace, Add from a
  repository. From a terminal: `/plugin install cloud --marketplace Talieisin/claude-plugins`

## Plugins

| Plugin | What it holds | Runs code? |
|---|---|---|
| `cloud` | `cloud-lead`, `cloud-worker`, `cloud-reader`, `cloud-retro` and the `cloud-github` rule, for running batches of GitHub issues in cloud sessions | No: text only |

More plugins belong here as further folders under `plugins/`, each turned on
separately. A plugin that runs code (hooks) is kept apart from text-only ones,
so that turning it on is a deliberate choice.

## How sessions get the skills

- Best: the environment's setup script installs the plugin, so every session
  in that environment has it, however it was started. This repository is
  public so that the script needs no credential. Add to the setup script:

  ```bash
  claude plugin marketplace add Talieisin/claude-plugins
  claude plugin install cloud@talieisin
  ```

  `github.com` must be among the environment's allowed domains.
- A cloud session started by hand also gets the plugin from the account it is
  synced to. A session created by another session does not, unless its
  environment installs it as above; without that, the lead hands each worker
  and reader its skill and the `cloud-github` rule in the system prompt.
- A repository that uses the plugin should carry no copies of these skills: a
  copy wins on the bare name. Sessions use the `cloud:` names.
- A plugin cannot carry a `.claude/rules` file, so the GitHub rule is the skill
  `cloud-github`.

## Source of truth

This repository is the source of truth for the `cloud` skills from version 18 (run 17 of the cloud-sessions experiment proved the hand-off).
Repositories do not carry copies. What stays in each repository: `CLAUDE.md`
(the standing authorisation is the owner's, per repository), `AGENTS.md` and
`mise.toml`. A change here is read by a session other than its author before
it merges, as each repository's `CLAUDE.md` asks for changes to how sessions
work.

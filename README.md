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

## The GitHub rule

A plugin cannot carry a `.claude/rules` file, so the rule is the skill
`cloud-github`. Each role skill tells its session to load it before any GitHub
call, and to name the rule version it loaded in its first comment, so that a
lead can see it was read.

## Status

A probe (run 11 of the cloud-sessions experiment). The source of truth for the
role skills is still `Talieisin/cc-web-lab-alpha` until that run reports; the
copies here differ from it only in pointing at the `cloud-github` skill. What
stays in each repository whatever happens here: `CLAUDE.md` (the standing
authorisation is the owner's, per repository), `AGENTS.md` and `mise.toml`.

# claude-cloud-skills

Talieisin's shared Claude Code skills for cloud sessions, packaged as a plugin
marketplace so that they are delivered once and not copied into every repository.

- Marketplace name: `talieisin` (`.claude-plugin/marketplace.json`)
- Plugin: `cloud` (`plugins/cloud`), enabled as `cloud@talieisin`
- Skills: `cloud-lead`, `cloud-worker`, `cloud-reader`, `cloud-retro`
- `plugins/cloud/rules/cloud-github.md` is printed into a cloud session's
  context by a SessionStart hook, because a plugin cannot carry a rules file.

Status: a probe (run 11 of the cloud-sessions experiment). The source of truth
for the skills is still `Talieisin/cc-web-lab-alpha` until that run reports.
Their text is copied here unchanged at skill version 16, so it still refers to
`.claude/rules/cloud-github.md` and to each repository's own `CLAUDE.md`,
`AGENTS.md` and `docs/FINDINGS.md`.

What stays in each repository whatever happens here: `CLAUDE.md` (the standing
authorisation is the owner's, per repository), `AGENTS.md` (that repository's
facts) and `mise.toml`.

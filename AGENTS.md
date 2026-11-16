# Working on this repository

For anyone, human or agent, changing the plugins here. How to *use* the `cloud`
plugin is in [`docs/setup.md`](docs/setup.md); read that first if you are setting
something up.

## What this repository is

- A Claude Code plugin marketplace named `talieisin`
  (`.claude-plugin/marketplace.json`), public so that a cloud environment's
  setup script can install from it without a credential.
- One plugin, `cloud` (`plugins/cloud/`): five skills, text only. Keep it text
  only. A plugin that runs code (hooks) goes in its own folder under `plugins/`
  so that turning it on is a separate, deliberate choice.
- This repository is the source of truth for the skills. No other repository
  carries a copy, and a copy elsewhere would win over the plugin on the bare
  skill name.

## It is public

Write nothing here that should not be read by anyone: no session, environment
or trigger ids, no names of private repositories or their issue numbers, no
credentials, no personal details. The skills say "this repository" and
`AGENTS.md`; they do not name ours.

Evidence for why a rule exists (which test batch showed what) is kept privately
by Talieisin, not here. A skill states the rule and, where it helps, the reason
in a clause. It does not cite a private record.

## Changing a skill

1. **Branch and pull request.** Never push to `main`.
2. **Bump the versions together.** Every file under `plugins/cloud/skills/`
   except `cloud-github/SKILL.md` carries `<!-- shared-skill-version: N ... -->`;
   all carry the same N. Raise N in all of them, and raise `version` in both `plugins/cloud/.claude-plugin/plugin.json`
   and `.claude-plugin/marketplace.json` to match (`0.N.0`). `cloud-github`
   carries its own `shared-rule-version`, which rises only when that file's
   rules change; the sentence in it that names the version rises with it.
3. **Have it read by someone other than its author** before it merges, and read
   again after any fix. The read is of the text as instructions: contradictions
   between files, a reference to a section or file that moved, a step a session
   could not carry out, a role left without an instruction. Small wording
   changes have broken these in practice.
4. **Keep the lead skill short.** `cloud-lead/SKILL.md` is read in full by every
   lead. What only some leads need lives in a side file beside it
   (`comments-mode.md`, `handing-skills.md`, `taking-over.md`) that the skill
   points to. A rule added must be paid for by one removed or shortened.
5. **Rules may go in after one batch, and must come out when they do not pay.**
   That is what a retro is for.

## After a release

A cloud environment caches what its setup script did, so sessions keep the old
version of the plugin until the script changes. After merging a new version,
re-save each environment that should pick it up (change the `# refreshed:` line
in its setup script), then confirm with a new session: `claude plugin list`, or
the versions a lead names in its first comment.

An account that has synced this marketplace on claude.ai picks a release up by
itself if automatic sync is on.

## Things that are not in this repository

So that nobody looks for them here, or forgets they exist:

| What | Where it lives |
|---|---|
| A cloud environment's setup script, allowed domains and network secrets | The environment, on claude.ai. [`templates/setup-script.sh`](templates/setup-script.sh) is the copy to paste |
| A routine that starts a lead | The owner's claude.ai account, under Scheduled. Its id and token are a variable and a secret on the repository that fires it |
| What sessions may do in a repository, and its facts | That repository's `AGENTS.md` (the facts in its `Repository facts` section) |

If you change how any of those must be set up, change `docs/setup.md` and the
matching file under `templates/` in the same pull request.

## Checks

There is no test suite. Before opening a pull request:

- every `shared-skill-version` marker carries the same version, and the two
  manifests match it (`cloud-github` has only its own `shared-rule-version`);
- every path a skill, the README or `docs/setup.md` names exists;
- `bash -n` passes on each script under `templates/` and `optional/`.

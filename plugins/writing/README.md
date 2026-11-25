# `writing`: formal British professional prose

Optional. One skill, `writing:professional-writing`, for drafting, rewriting and
reviewing reports, proposals, technical and policy documents, briefings and
letters for a senior, expert reader. It sets out how to establish the substance
before drafting, how to preserve meaning through revision, and how to compare
drafts rather than score them. A client's or organisation's own style guide
overrides it.

The skill carries [`prose-lint`](skills/professional-writing/tools/prose-lint/README.md),
a linter for the conventions a pattern can find: dashes, contractions,
plain-English substitutions, chat-interface leftovers, long sentences and the
like. It reports and never rewrites. It needs `uv`, which installs its one
package on first use.

**No hooks.** Nothing runs by itself: a session runs the linter when the skill
tells it to. A repository of documents that wants every edit linted adds the
hook to its own settings, as the linter's README shows. The plugin does not, so
that the READMEs and changelogs of every other repository are left alone.

Install it with:

```sh
claude plugin install writing@talieisin
```

The linter's README also covers the optional companion tools: britfix for
British spelling, Vale for a repository's own terminology, and LanguageTool for
a final grammar proofread.

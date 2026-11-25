# prose-lint

A linter for formal British professional prose in Markdown and plain text. It accompanies the professional-writing skill and checks the conventions that skill sets out which a pattern can find. It reports findings and never rewrites the text.

It needs Python 3.11 or later and one package, `markdown-it-py`, which parses the Markdown so that code, quotations and links are told apart from prose. The script declares it inline, so `uv run --script` installs it on first use with no other setup.

## Running it

```sh
uv run --script prose_lint.py letter.md            # one file
uv run --script prose_lint.py docs/                # every .md, .markdown and .txt file below docs/
cat draft.md | uv run --script prose_lint.py -     # standard input
```

Options:

| Option | Effect |
|---|---|
| `--rules FILE` | Merge a project rules file over the built-in rules (repeatable) |
| `--format text\|json\|report` | Text lines (the default), JSON, or a Markdown summary grouped by rule, with the sentence count, average and longest sentence |
| `--fail-on rule\|warn\|never` | Exit 1 if any finding is at that severity or above (default `rule`) |
| `--list-rules` | List every rule id and its severity, or `disabled` |
| `--hook` | Run as a Claude Code `PostToolUse` hook (below) |

Exit codes: 0 for no findings at the `--fail-on` level, 1 for findings, 2 for a missing file.

## Severities

- **Rule:** a convention that is absolute, such as an em dash, a contraction, "e.g." or a chat-interface leftover. Fix it.
- **Warn:** a pattern that is usually wrong but sometimes right, such as a long sentence, a passive cluster, an all-purpose verb or an American spelling. Judge it in context.

Do not rewrite sound text to clear a warning, and do not clear `long-sentence` warnings only by splitting: the skill's 15 to 20 word average has a lower bound too, and a run of short sentences reads as abrupt. Restructure instead, and keep a long sentence that has one subject and one claim. The warnings indicate where to look; they do not measure quality. Direct quotations, official names and terms the source requires stay as they are, whatever the finding.

## What it checks

| Area | Rule ids |
|---|---|
| Dashes | `em-dash`, `en-dash-spaced`, `double-hyphen-dash`, `en-dash-words` |
| Mechanics | `contraction`, `latin-abbreviation`, `stakeholder`, `bullet-lower-case`, `bullet-trailing-punctuation`, `bullet-trailing-conjunction`, `semicolon-chain` |
| Diction | `plain-english`, `marketing`, `significance-inflation`, `evaluative-filler`, `abstraction-as-actor`, `all-purpose-verb`, `figurative`, `ai-tell` |
| Readability | `long-sentence` (over 25 words), `long-paragraph` (over five sentences), `passive-cluster`, `justification-cluster` |
| Lists | `announced-count`: a count in the lead-in directly above a list, ending in a colon or a full stop ("Three factors determine the price:"), with measurements excluded. A count elsewhere is a fact and is not flagged. `bullet-trailing-conjunction`: an item other than the last ending in "and" or "or" |
| Spelling | `us-spelling`: spellings other than the house style (British, with -ise), with the house form suggested. Oxford -ize is British too: a document that follows it disables the rule |
| Leftovers | `chatbot-artefact`: chat phrases, citation markers, unfilled placeholders, tracking parameters |

`all-purpose-verb` is off by default, because *hold*, *carry* and *sit* are too often right in commercial prose; a project turns it on with `enable = ["all-purpose-verb"]` in its rules file. The others listed are on.

Short sentences, nominalisations, the share of bullets and readability scores such as Flesch are deliberately not linted: whether they help or hurt depends on context that a count cannot see, and the skill compares drafts instead of scoring them. The report gives the average sentence length, which the skill does set a target for.

Front matter, HTML (comments included), fenced and indented code, inline code, blockquotes (quoted source material), images, tables and link destinations are not checked as prose. Chat-interface leftovers are the exception: they are also sought in blockquotes, tables, captions and links. In a `.txt` file indented lines are prose and there is no front matter.

## Suppressing a finding

Where the wording is deliberate (quoting a banned word, for example), add a Markdown comment:

```markdown
<!-- prose-lint-disable-next-line stakeholder -->
The standard forbids the word "stakeholder".

<!-- prose-lint-disable em-dash en-dash-spaced -->
...a region that quotes dashes...
<!-- prose-lint-enable -->
```

With no rule ids named, every rule is suppressed.

## Project rules

Put a project's own conventions in a TOML file and pass it with `--rules`. It is merged over `rules.toml`:

```toml
# Rules this project does not want, and rules off by default that it does.
disable = ["stakeholder"]
enable = ["all-purpose-verb"]

# Thresholds.
[readability]
sentence_max_words = 30

# Numbers that are defined things, not announced lists.
[counts]
allow = ['(?i)\bseven wonders\b']

# Spellings to add. For a document in American English, disable "us-spelling" instead,
# and add a [[rule]] for each British form to be caught.
[spelling.words]
aluminum = "aluminium"

# A house term.
[[rule]]
id = "house-term"
severity = "rule"
pattern = '\bclient portal\b'
message = "Write 'customer portal', the product's registered name."
exclude = '(?i)\blegacy client portal\b'     # optional: matches inside this are ignored
```

Patterns are Python regular expressions, case-sensitive unless they begin with `(?i)`. Use single-quoted TOML strings so that backslashes need no escaping.

## Claude Code hook

The plugin does not install a hook: a hook would run on every Markdown file in every repository where the plugin is installed, READMEs and changelogs included. A repository of documents that wants each file linted as Claude writes it adds this to its own `.claude/settings.json`, with the path to a copy of `prose_lint.py` (this folder, or one vendored into the repository):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [{ "type": "command", "command": "uv run -q --script /path/to/prose_lint.py --hook || echo '{\"systemMessage\": \"prose-lint could not start\"}'" }]
      }
    ]
  }
}
```

A Write is checked whole. An Edit is checked only in the headings, paragraphs and bullet items it changed, taken from the patch Claude Code reports, or, without one, from where the new text appears in the file. The findings, capped at ten with `rule` findings first, return to Claude as context to act on in the same turn. The hook never blocks an edit and never fails one; the `|| echo` keeps that true when `uv` itself cannot start, for example without network on its first run.

## Companion tools

None is required. Each catches something prose-lint does not.

| Tool | Use | Notes |
|---|---|---|
| [britfix](https://github.com/Talieisin/britfix) | Rewrites American spellings to British, with a dictionary far larger than `us-spelling`'s, in prose and in code comments | It turns *program* into *programme*: a repository that follows this skill lists `program` and `programs` in its `.britfixignore`. Where both run as hooks, chain them in one command (britfix, then prose-lint), since Claude Code runs separate hooks in parallel, and disable `us-spelling` |
| [Vale](https://vale.sh) | A repository's own terminology and consistency checks, in the editor and in CI | Worth it where a repository already uses Vale. It does not replace prose-lint's hook mode |
| [LanguageTool](https://languagetool.org) (en-GB) | A final grammar proofread: agreement, articles, wrong words | Needs Java 17 or later and a local server. Never send client documents to the public API, whose terms also forbid automated use. Not suited to a hook |

## Tests

```sh
uv run --no-project --with pytest --with markdown-it-py pytest tests
```

# Setting up the `cloud` and `github` plugins

How to get a repository to the point where a Claude Code cloud session can lead
a batch of GitHub issues to merged pull requests, with a worker session per
piece of work and a reader session per pull request.

Part 1 is everything you need. Part 2 is optional extras, each independent of
the others, among them `humantray`, a tray for what sessions need from you.
Part 3 is how to keep it working.

Nothing here needs Talieisin's own tooling. Where we use something of our own
(mise for pinned tools, for instance) it is in Part 2 and marked as optional.

## What you need first

- A Claude plan that includes Claude Code on the web (claude.ai/code).
- A GitHub repository, with the Claude GitHub App installed on it.
- The GitHub CLI (`gh`) on your own machine, for the one-off label step.

## Part 1: required

### 1. A cloud environment that installs the plugin

Sessions get the skills from the environment they run in. On claude.ai/code,
open the environment picker (beside the repository picker, under the prompt
box), choose **New environment** (or the gear beside an existing one), and paste
[`templates/setup-script.sh`](../templates/setup-script.sh) into **Setup
script**. Its three working lines are:

```bash
claude plugin marketplace add Talieisin/claude-plugins
claude plugin install cloud@talieisin
claude plugin install github@talieisin
```

Leave **Network access** on Limited. No extra domains are needed for the plugin.

Why the environment and not your account: a plugin added to your claude.ai
account reaches only the sessions you start by hand. A lead creates its workers
and readers itself, and those sessions get nothing from your account. The setup
script runs for every session in the environment, however it was started.

### 2. The owner's authorisation in `AGENTS.md`

The skills act for you inside limits you set, and they read those limits from
three sections of the repository's `AGENTS.md`: "Standing authorisation",
"Deciding for the owner" and "Questions". Copy
[`templates/AGENTS.md`](../templates/AGENTS.md) into your `AGENTS.md` (or add it
to the one you have) and edit it until it says what you actually allow.

You do not need a `CLAUDE.md`. Claude Code reads `AGENTS.md` by itself when the
repository has no `CLAUDE.md` (since version 2.1.277). But if the repository does
have a `CLAUDE.md`, Claude Code by default reads that and not `AGENTS.md`, so:

- add the line `@AGENTS.md` to the `CLAUDE.md`, which loads it; and
- move anything in the `CLAUDE.md` that says what sessions may do into
  `AGENTS.md`. The skills read `AGENTS.md`, and two files that both set limits
  will sooner or later disagree.

The skills also tell every session to read `AGENTS.md` if it was not loaded, so
a batch does not depend on this; the import saves each session a step.

Read the list headed "Always back to the owner first" with care. It is what no
session may do without you: force pushes, repository settings, workflows,
credentials, anything outside the repository, and any change to these sections
themselves.

This is the one part that cannot be installed for you. It is your approval,
given in advance, so it has to be yours.

### 3. Labels

From a clone of the repository that will use the skills, with the GitHub CLI
signed in: download [`templates/labels.sh`](../templates/labels.sh), read it (it
is a dozen `gh label create` lines), then run it:

```bash
curl -fsSL -o labels.sh https://raw.githubusercontent.com/Talieisin/claude-plugins/main/templates/labels.sh
```

```bash
less labels.sh
```

```bash
bash labels.sh
```

Delete `labels.sh` afterwards; it does not belong in your repository.

Do not pipe it straight from the network into a shell: you would be running
whatever the file holds at that moment with your GitHub sign-in. It creates `agent:ready`,
`agent:claimed`, `agent:review`, `agent:question`, `needs:owner`,
`plan:required`, `review:deep`, `review:max` and `needs:codex-review`.

### 4. Nothing of the same name in the repository

The repository must not carry its own skills named `lead`, `worker`, `reader`,
`retro` or `pull-request` under `.claude/skills/`. Where a repository and the plugin both supply a
skill, the repository's copy is the one a bare name loads.

### 5. Branch protection

Recommended, not required: a pull request is needed to change the default
branch, and review threads must be resolved before merge. If the repository has
a test workflow, make it a required check. The lead is a stricter gate than
these, but they stop a mistake from merging.

### 6. A first batch

1. Open the issues you want done and label each `agent:ready`. Add
   `plan:required` to one you want planned and approved before any code is
   written, and `review:deep` to one that should get more review: at least depth 2
   for its plan and its code, filled from the reviewers your environment lists
   (see "Review depth" below).
2. Open one more issue as the brief, from
   [`templates/tracking-issue.md`](../templates/tracking-issue.md). The lead
   reports there.
3. On claude.ai/code, choose the repository and the environment from step 1,
   and start a session with:

   > You are the lead for this batch. Your brief is issue N of this repository:
   > read it and follow it, using the `cloud:lead` skill. If you do not
   > hold that skill, say so on the issue and stop.

The lead's first comment on the tracking issue names the versions of its own skill
and of the `github:pull-request` skill that it holds. Then it posts its lanes, starts workers,
has each pull request read, and merges one at a time. When it has a question
only you can answer, it labels the issue `needs:owner`, sends a push
notification, and asks you in its own session once its report is posted.

### The `Repository facts` section

The same `AGENTS.md` ends with a section headed `Repository facts`: the test
command and how long it takes, hazards that have bitten a lane, what branch
protection requires. It is the one part of the file a lead may change, by a pull
request titled `Facts: ...` that a reader reads before it merges. You do not
have to write it: if it is missing, the lead works out what it needs and
proposes the section at the end of its first batch. The template includes a
skeleton.

## Part 2: optional

### Also add the plugin to your account

Useful if you start sessions in environments that do not have the setup script.
On claude.ai: **Plugins**, **Add**, **Add marketplace**, **Add from a
repository**, and give `Talieisin/claude-plugins`; then add the `cloud` and `github`
plugins. Neither has hooks.

If neither the environment nor the account gives a lead's children the plugin,
the lead falls back to handing each child its skill text when it starts them.
That works, and costs the lead a good deal of context, so prefer step 1.

### Pinned tool versions

Only if the repository must run on exact tool versions. See
the optional [`mise` plugin](../plugins/mise/README.md), which installs a
repository's pinned tools when a session starts. Nothing is copied into the
repository. It runs code by itself (as does `humantray`, below), so read its
script first. Its page also says what to do if you use a version manager other
than mise.

### A tray for what sessions need from you: `humantray`

Sessions add what they need from you to a tray instead of writing it into their
text: an FYI to acknowledge, a choice, a question, something for you to do, or
a proposal to approve. Adding an item does not stop the session. You answer
when you choose, and the answer is delivered to the session that asked, once,
with anything you typed kept as written. Raising the same thing again bumps the
item that is open, so one ask stays one item.

**It runs code.** The plugin is a hooks module (TypeScript) that Claude Code
loads in every session where the plugin is installed, so turning it on is a
choice of its own, as with `mise`. Read
[`plugins/humantray/hooks/`](../plugins/humantray/hooks/) first if you want to
know what it does. Hooks modules are an early-access part of Claude Code and may
change between releases; this version was built on Claude Code 2.1.326.

**On your own computer.** Install it once:

```bash
claude plugin marketplace add Talieisin/claude-plugins
claude plugin install humantray@talieisin
```

or, from a checkout of this repository, start a session with
`claude --plugin-dir <checkout>/plugins/humantray`. In a git repository, the
pane opens by itself when a session adds an item; `/humantray-open` opens it
again (`/humantray` is the skill, not the pane). A band above the prompt counts
what is open. Finished items move to History, which keeps the last 200 per
repository. A `claude -p` run draws nothing, so a session there asks as it
always did.

**In a cloud environment.** Add one line to the setup script, after the others
(it is in [`templates/setup-script.sh`](../templates/setup-script.sh),
commented out):

```bash
claude plugin install humantray@talieisin
```

A cloud session draws no pane of its own, so its items are shown elsewhere, in
two places that read the same store:

- **The page, per repository.** Run `/humantray-page` once in a cloud session in
  that repository. It finds the private page titled `humantray: <owner>/<repo>`
  on your claude.ai account and links it, or creates it if there is none;
  `/humantray-page <link>` links a page you name. You can answer items on the
  page. No session pins it: pin it yourself in claude.ai if you want it to
  hand. Until a repository has a page, its cloud sessions do not use the tray
  and ask as they did before.
- **The viewer, on a computer that stays on.** In a local session on that
  computer, with the plugin installed, start Claude Code with
  `claude --remote-control` (or
  `claude --plugin-dir <checkout>/plugins/humantray --remote-control`), then
  run `/humantray-viewer`. Its pane shows the open items of every repository's
  page, grouped by repository, then lead, then the session that asked, and reads
  them again about every 20 seconds. An answer you give there is sent as a
  message to the session that asked. One viewer runs per computer;
  `/humantray-viewer off` stops it. This is the main way to follow cloud
  sessions; the page is the fallback when the viewer is not running.

A lead uses the tray only with `cloud` 0.35.0 or later, and only for what its
skill allows: an FYI, a step you agreed to take part in, or a chance to object
to a decision it has already recorded. Workers raise only what their lead names;
readers and test authors raise nothing. Questions that are yours to decide still
reach you as Part 1 describes: a comment, the `needs:owner` label and a
question in the lead's session.

**Limits.**

- **Items never go into git, public repository or private.** On your computer
  they are kept in `.git/humantray/items.json` in the repository (shared by its
  worktrees), which git never commits or pushes. In a cloud session with a
  page, each item's text and your answers are also copied to that private page
  on your claude.ai account, for a public repository as for a private one.
  Nothing is posted to GitHub, except in comments mode below. There is no copy
  in git for private repositories either.
- **Items are plain text,** in `.git/humantray/` and on the page. Put nothing
  secret in an item. In a public repository an item may quote text that anyone
  wrote in an issue or a pull request. The page draws Markdown but never runs
  HTML or scripts from an item, and shows images as links without loading them.
  Keep the page's link out of anything public.
- **No pane on mobile yet.** The pane and the band draw in the terminal and the
  desktop app. On a phone, open the repository's page.
- **An answer given on the page** reaches a cloud session that is idle only at
  its next turn, even while a viewer is running.
- **Comments mode.** A session that may talk to you only through GitHub
  comments (a lead started from a label, and the sessions it starts) adds no
  items. It asks as its role says. A session with no role posts a signed
  comment whose first line is `humantray (<type>):`, and only your own words
  answer it.
- **No answer from the tray is your approval** of anything on the "always back
  to the owner" list in `AGENTS.md`. That still needs your own words, as
  `AGENTS.md` defines them.

### Starting a lead from a label, with nobody at a keyboard

[`templates/start-lead.yml`](../templates/start-lead.yml) is a workflow that
fires a Claude Code routine when an issue is labelled `lead:start`. You need:

- the workflow itself: copy the template to `.github/workflows/start-lead.yml`
  in your repository;
- a routine on claude.ai (under Scheduled) for the repository and the
  environment from step 1, with an API trigger, and with a prompt that tells it
  to lead the batch whose tracking issue the trigger's text names, using
  `cloud:lead`, and to post its session link on that issue first;
- the routine's id as the repository variable `LEAD_ROUTINE_ID`, and its token
  as the repository secret `LEAD_ROUTINE_TOKEN`;
- the `lead:start` label.

Know the limits before relying on it. A session started by a routine cannot
message the sessions it creates and has no way to ask you a question, so it
works by comments alone ("comments mode" in the lead skill) and reaches you only
by label and push notification. This route has had far less use than a lead
started by hand, and has not been run since the skills moved into this plugin.

### Review depth

Every pull request is read by a reader session. How much more review a piece
of work gets is a depth, from 0 to 3, set separately for its plan and its code.
Nothing here is needed for a batch to work: with no reviewers listed and no
labels, every depth is 0 and a batch behaves as described in Part 1.

| Depth | Plan | Code |
|---|---|---|
| 0 | The lead reads it | The ordinary reader |
| 1 | One independent reviewer | The reader and one second reviewer |
| 2 | Two reviewers | The reader and two second reviewers |
| 3 | Depth 2, then one recheck of the revised plan | Depth 2, with tests written first by a separate test author, then one recheck of the fixes |

You say who can review and what your policy is. The lead works out the rest for
each piece of work, from what is actually reachable in that session.

**Who can review.** In the cloud environment's **Environment variables**, list
the reviewers in your order of preference:

```
CLOUD_REVIEWERS=codex-github claude
```

| Reviewer | What it is | Reviews | Needs |
|---|---|---|---|
| `claude` | A reader session on a stronger Claude model | Plans and pull requests | Nothing more |
| `codex-github` | A comment on the pull request that asks the Codex GitHub app for a review | Pull requests only | The Codex GitHub app installed on the repository, and a Codex subscription on the account the sessions run as |

You do not have to know in advance what each repository has. A reviewer counts
only if it answers: a model the platform accepts, or a Codex app that reacts to
the request and finishes in time. One that does not is skipped and noted, and
the depth is filled from the rest. If fewer can be reached than a depth asks
for, the work gets what there is and the lead says so. Two reviewers are never
taken from the same family.

`CLOUD_REVIEW_MODEL` names the model the `claude` reviewer uses. Unset, it is
`claude-fable-5-2`.

**Your policy.** Write it in the repository's `AGENTS.md`, as a paragraph under
"Defaults the owner has chosen" that begins `Review policy:`. Name one of the
built-in policies, write your own, or name one and adjust it in words:

```
Review policy: thorough. Anything that touches billing is depth 2. At most
three lanes at depth 2 or above in a batch.
```

| Policy | What it gives |
|---|---|
| `minimal` | Depth 0 for everything |
| `standard` (used when nothing is set) | A lane the lead made plan first: plan depth 1, code depth 1. Everything else: 0 |
| `thorough` | Every plan the lead asks for: depth 1. Every non-trivial change: code depth 1. A change to an interface other code relies on, to how data is stored, or to sign-in, permissions or secrets: depth 2 for both |

A change is non-trivial when it adds or removes behaviour, changes an
interface, or refactors code other code depends on. No built-in policy gives
depth 3: ask for it in your own words, or with a label.

To give all your repositories the same policy without repeating it, set
`CLOUD_REVIEW_POLICY` in the environment as well. A repository's `AGENTS.md`
overrides it.

**A floor for one issue.** Label an issue `review:deep` for at least depth 2,
or `review:max` for at least depth 3. A floor on the plan means the worker must
plan first. A label is honoured whatever your policy's limit says. Put
`review:max` on before the batch starts: tests can only be written first if the
worker has not begun. `needs:codex-review` asks for Codex by name on that
issue's pull request, at depth 1 or more; if Codex cannot be reached, the lead tells
you and holds that one pull request until you answer.

**Depth changes during a batch.** The lead picks a depth for each piece of work
when it plans, and says why. It never lowers one.

**What depth costs.** Each second reviewer is a session or a Codex review.
Depth 3 adds a test author session, a hand-off before the worker starts, and a
recheck. Use it for the few changes that warrant it.

### An automatic reviewer (Copilot, for instance)

Optional. If the repository has a reviewer that reads each pull request by
itself, the lead finds that out from the repository's facts in `AGENTS.md` or,
failing that, from its recent pull requests; you set nothing. (A reviewer that
only answers when asked, such as the Codex GitHub app, is not one of these.) It never counts towards a review depth. If the repository has
none, nothing waits and nothing below applies.

What the lead does about one is a line under "Defaults the owner has chosen" in
`AGENTS.md`, or `CLOUD_AUTOMATED_REVIEW` in the environment for all your
repositories:

```
Automated review: wait
```

| Setting | What the lead does |
|---|---|
| `wait` (the default) | Before merging, waits for the automatic review of the pull request's first version, for up to ten minutes from when it opened. If none comes (the reviewer may be out of quota), it says so on the pull request and in its report, and goes on. You may give another limit: `Automated review: wait up to 20 minutes` |
| `catch-up` | Never waits, even if the review is still running |
| `ignore` | Does not wait, and does not look for late comments |

Whatever the setting, short of `ignore`, the lead looks back at the end of the
batch, once each pull request has been open for the limit, for anything the
automatic reviewer wrote that nobody dealt with: comments that arrived after
the merge, or just before it. It answers
the ones that are wrong, and opens one issue for each pull request that has
real ones, labelled `agent:ready`. If the batch has time left it works those
issues there and then, and looks once more at the pull requests that produces;
anything found then waits for the next batch.

### A retro

After a few batches, start a session with "Use the `cloud:retro` skill on
runs <tracking issues>". It measures each run from its issues, pull requests and
sessions, judges whether each rule in the skills earned its place, and proposes
changes. It never merges anything.

## Part 3: keeping it working

**After a new release of the plugin, re-save the environment.** The environment
caches what the setup script did, so new sessions keep the old version until
the script changes. Edit the `# refreshed:` line at the bottom of the setup
script and save. Then check: the next lead's first comment names the versions
it holds.

**How to tell what a session got.** In the session, `claude plugin list` shows
`cloud@talieisin` and `github@talieisin` (and `humantray@talieisin`, if you added
it) with their versions, and `cat /tmp/cloud-setup.log` shows what the
setup script did. If the plugin is missing, the log says why.

**If a lead says it does not hold the skill,** the environment's setup script
did not install the plugin. Check the log, check that the session was started in
the environment you edited, and check that nothing blocks `github.com`.

**Where things live, so that nobody has to remember:**

| What | Where |
|---|---|
| The skills | This repository, `plugins/cloud/skills/`, `plugins/github/skills/` and `plugins/humantray/skills/` |
| A repository's humantray page, if you use one | Your claude.ai account, as a private page titled `humantray: <owner>/<repo>` |
| What sessions may do, and a repository's facts | That repository's `AGENTS.md` |
| The setup script | The cloud environment, on claude.ai (not in any repository) |
| The routine, if you use one | Your claude.ai account, under Scheduled |
| A batch's record | Its tracking issue |

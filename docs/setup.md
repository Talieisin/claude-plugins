# Setting up the `cloud` and `github` plugins

How to get a repository to the point where a Claude Code cloud session can lead
a batch of GitHub issues to merged pull requests, with a worker session per
piece of work and a reader session per pull request.

Part 1 is everything you need. Part 2 is optional extras, each independent of
the others. Part 3 is how to keep it working.

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
signed in, run [`templates/labels.sh`](../templates/labels.sh) straight from
this repository:

```bash
curl -fsSL https://raw.githubusercontent.com/Talieisin/claude-plugins/main/templates/labels.sh | bash
```

or download the file, read it, and run `bash labels.sh`. It creates `agent:ready`,
`agent:claimed`, `agent:review`, `agent:question`, `needs:owner`,
`plan:required`, `review:deep` and `needs:codex-review`.

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
   written, and `review:deep` to one whose pull request should get a second,
   deeper read.
2. Open one more issue as the brief, from
   [`templates/tracking-issue.md`](../templates/tracking-issue.md). The lead
   reports there.
3. On claude.ai/code, choose the repository and the environment from step 1,
   and start a session with:

   > You are the lead for this batch. Your brief is issue N of this repository:
   > read it and follow it, using the `cloud:lead` skill. If you do not
   > hold that skill, say so on the issue and stop.

The lead's first comment on the tracking issue names the versions of the skill
and of the GitHub rule that it holds. Then it posts its lanes, starts workers,
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
[`optional/mise/`](../optional/mise/README.md), which also says what to do if
you use a version manager other than mise.

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

### A second review from Codex

If the Codex GitHub app is installed on the repository, the lead asks it for one
review on a pull request whose issue carries `needs:codex-review` or whose lane
was plan-gated, and waits for it before merging. Without the app, do not use the
label.

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
`cloud@talieisin` and `github@talieisin` with their versions, and `cat /tmp/cloud-setup.log` shows what the
setup script did. If the plugin is missing, the log says why.

**If a lead says it does not hold the skill,** the environment's setup script
did not install the plugin. Check the log, check that the session was started in
the environment you edited, and check that nothing blocks `github.com`.

**Where things live, so that nobody has to remember:**

| What | Where |
|---|---|
| The skills | This repository, `plugins/cloud/skills/` and `plugins/github/skills/` |
| What sessions may do, and a repository's facts | That repository's `AGENTS.md` |
| The setup script | The cloud environment, on claude.ai (not in any repository) |
| The routine, if you use one | Your claude.ai account, under Scheduled |
| A batch's record | Its tracking issue |

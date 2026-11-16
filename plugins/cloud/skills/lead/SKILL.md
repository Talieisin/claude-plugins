---
name: lead
description: Lead a batch of GitHub issues in this repository from a cloud session, using one worker session per lane (one issue, or a few related ones) and one reader session per pull request, merging one at a time. Use when asked to lead, coordinate or run issues with cloud workers, or when a brief names you as lead.
---

<!-- shared-skill-version: 34 (delivered by the `cloud` plugin) -->

You are the lead. You do not edit code; workers do. You act for the owner inside the limits in `AGENTS.md` ("Standing authorisation" and "Deciding for the owner"); if that file is not already in your context, read it before anything else. First load the `github:pull-request` skill, before any GitHub call, and follow it for every one: REST only.

## Tools

Session control comes from the session tools: `create_session`, `send_message`, `get_session`, `list_events`, `list_sessions`, `interrupt_session`, `archive_session`, `send_later`, `list_triggers`, `delete_trigger`. They appear as `mcp__claude-code-remote__*` in a session started by hand and as `mcp__Claude_Code_Remote__*` in one started by a routine. If you have no tool that creates sessions you cannot lead: say so in a comment on the tracking issue, leave the issues labelled as they are, and stop.

Your first act is to comment on the batch's tracking issue with your session id, its link (`https://claude.ai/code/<session id>`), this skill's version and the version of the `github:pull-request` skill you loaded.

### Comments mode

Check which mode you are in before starting workers. You are in **comments mode** if you have no `send_message` tool, or if you were started by a routine (your title begins with a lightning bolt, or `get_session` shows origin `fire_routine`). In comments mode, read `comments-mode.md` in this skill's directory before you start anything, and follow it: it changes every starting prompt and every instruction below to message or ask a child.

### How children get their skills

These skills come from two plugins: the roles from `cloud`, and the pull-request skill from `github`. Always use them by their plugin names, `cloud:lead`, `cloud:worker`, `cloud:reader`, `cloud:tester` and `github:pull-request`: a skill of the same name without the prefix is a repository's own copy, which may be older and wins on the bare name. If this repository carries such copies, say so in your report.

A session you create gets the plugin only if its environment's setup script installs it. Before you start any session, run `claude plugin list`. If it shows both `cloud@talieisin` and `github@talieisin`, start children with the prompts in sections 2 and 4 as written and no `append_system_prompt`. If it lacks either, or a child says it does not hold its skill, read `handing-skills.md` in this skill's directory and follow it: you hand each child its text.

A child names the versions of its skill and of `github:pull-request` in its first comment and in its report message to you. If neither names them, it does not hold the skills: archive it and start it again as `handing-skills.md` says. Versions that differ from yours are no fault: note them in the run log.

### Review depth

Every pull request is read by an ordinary reader. Beyond that, how much review a lane gets is a **depth**, 0 to 3, set separately for its plan and for its code:

| Depth | Plan | Code |
|---|---|---|
| 0 | You read it | The ordinary reader |
| 1 | One independent reviewer | The reader and one second reviewer |
| 2 | Two reviewers | The reader and two second reviewers |
| 3 | Depth 2, then one recheck of the revised plan | Depth 2, with tests written first by a separate test author, then one recheck of the fixes |

Three things decide it. Name them in your first comment.

- **Reviewers.** The environment variable `CLOUD_REVIEWERS` lists who can be reached, in order of preference: `claude` (a reader session on a stronger model) and `codex-github` (the Codex GitHub app; pull requests only). Unset or empty means none: say so, and give depth 0 wherever only the policy would have given more.
- **Policy.** The first of these that exists: a paragraph beginning `Review policy:` under "Defaults the owner has chosen" in `AGENTS.md`; the environment variable `CLOUD_REVIEW_POLICY`; otherwise `standard`. It is a name `review-depth.md` defines, the owner's own words, or both. Apply it lane by lane, and never go below what it plainly asks.
- **Labels** are the owner's floor for one issue: `review:deep` means at least depth 2 for that lane's plan and code, `review:max` at least depth 3, and `needs:codex-review` code depth at least 1 with Codex among the reviewers. No limit and no missing reviewer lowers a floor, and a lane whose plan depth a label sets is plan-gated.

Put each lane's plan depth and code depth in the lanes comment, with the reason. A depth may rise later, never fall. For any depth above 0, or any of these labels, read `review-depth.md` in this skill's directory and follow it.

### The automated reviewer

A repository may have a reviewer that reads each pull request by itself (Copilot, for instance). It is optional and never counts towards a depth. At the facts gate, read `automated-review.md` in this skill's directory: it says how to tell whether this repository has one, when to wait for it, and what to sweep for at the end. Where there is none, nothing waits.

## 1. Plan the batch

### Facts gate

The section of `AGENTS.md` headed `Repository facts` holds this repository's facts, and every session you start reads the copy at the commit it starts from. Before planning:

- Re-verify each fact marked `(checked)`: run the test command and note the count and time; read the rulesets and the repository settings the facts name. Record each mismatch in the lanes comment as `Facts mismatch: <fact>, AGENTS.md says <x>, observed <y>`.
- Plan from what you observed, not from a fact you have just seen to be wrong.
- If `AGENTS.md` has no `Repository facts` section, discover what you need, say so in the lanes comment, and propose the section at the end.

**Scope.** That section holds only facts about this repository that the code and GitHub cannot tell an agent. How sessions work belongs in the skills, how the platform behaves in the findings register (`docs/FINDINGS.md`) if there is one, and a single observation in your report. A fact never relaxes a rule.

At the end of the batch, write the changes to the facts yourself as one pull request titled `Facts: <summary>`, separate from any code and changing nothing outside the `Repository facts` section: corrections the run showed, and new facts it found (a hazard that bit a lane, a test that fails intermittently, a command that was needed), each citing the issue or pull request that shows it. Once a reader has read it, you may merge it when it only corrects or adds facts you verified in this run (where the repository has no checks, the test count for merge condition 4 is your own). Anything under "Checks the owner wants before merge", or that changes what sessions may do, is the owner's: open the pull request and escalate it as `AGENTS.md` says.

- Read each issue and the code it will change. For a batch of more than a few issues, start the lanes comment with a table: issue, the functions or regions of each file it will touch, and which other issues it depends on. The lanes, holds and order below all follow from that table.
- Then sort the batch into **lanes**. A lane is one worker, one branch and one pull request. The default is one issue per lane. Put issues in the same lane only when one depends on another, or when they would plainly rewrite the same function or the same few lines, so that separate pull requests would only conflict. Never group issues just because they are small. Record the lanes, and why, in a comment on the batch's tracking issue.
- Issues in different lanes that touch the same file still run in parallel; those conflicts are handled at merge time. Exception: when one lane rewrites lines that another changes, hold one until the other merges, normally the larger or more mechanical (a refactor, a sweep), so that a small change is not stuck behind it. Say so in the lanes comment, and name the merged shape in the held lane's prompt; a held lane that is plan-gated may plan meanwhile. An issue that must describe the batch's final state (documentation, a changelog) merges last: start it once the others have merged.
- Tell each lane where its new code goes in a shared file: lanes that all append at the end of one file conflict on every merge of `main`. Tell each lane in its starting prompt to leave alone a file that another lane owns or that its issue does not ask for, such as the changelog.
- Once the lanes are posted, swap `agent:ready` for `agent:claimed` on every issue that has a lane, held lanes included; mark a held lane as held in the lanes comment. An issue left at `agent:ready` reads as unclaimed to any other lead.
- An issue gets no lane if only the owner can do it (it is wholly on the "always back to the owner" list in `AGENTS.md`) or if what it asks for already holds on `main` (run its example first). Escalate it as `AGENTS.md` says, push notification included (`PushNotification` may need loading with ToolSearch), swap `agent:ready` for `needs:owner`, not `agent:claimed`, and report it as open.
- Where an issue leaves a point open that `AGENTS.md` lets you decide, decide it now, before starting the worker: test it as section 3 says, record it on the issue (`Decided for the owner: ...`), and point the worker's starting prompt at that comment. State an interface decision as a full signature (`slugify(text, *, separator="-")`), not in prose. Workers given their decisions up front rarely need to ask.
- Keep a run log in your first comment on the tracking issue, edited in place (`PATCH .../issues/comments/{id}`), not in a scratch file, which dies with you: one timed line for each event GitHub does not already show (a session started, with its role, id, target and, for a reader, the head; a fix or question sent; what you are waiting for). A successor reads it first, and it stays as the run's record.

- Decide which lanes need a **plan gate**. Most do not: a small, clear issue goes straight to implementation. Gate a lane when the issue is large, when it is vague in a way a decision of yours has not settled, when it changes an interface other code relies on, or when it carries the label `plan:required`. When the label is the only reason, say so, settle every open point up front, and expect a short plan. Say which lanes are gated, and why, in the lanes comment.

## 2. Start one worker per lane

`create_session` with: this repository; your own environment; an explicit model; effort `high`; permission mode `auto`; title `worker-issue-<n>` (or `worker-issues-<n>-<m>` for a lane of several); a tag for the batch. Prompt:

> You are a worker for issue <n> of <owner>/<repo>. Your lead is the session that started you. Use the `cloud:worker` skill and follow it exactly. If you do not hold that skill, say so in a comment on the issue (`gh api repos/<owner>/<repo>/issues/<n>/comments -f body=...`; `gh issue comment` fails here) and stop.

For a lane of several issues, name them all ("issues <n> and <m>, as one lane and one pull request") and say in which order to do them.

For a gated lane, add: "Plan first: follow the plan gate in the skill and do not write code until I approve the plan."

### Reviewing a plan

A gated worker posts its plan as a comment on the issue headed `Plan` and reports to you. The plan on the issue is the record; do not keep it only in messages. Where the lane's plan depth is above 0, have its reviews made first, and judge the plan with their findings in hand. Read it against the issue and your recorded decisions and check: it covers every acceptance criterion; it names the files and functions it will change; its tests would catch the failure the issue describes; it does nothing the issue does not ask for; every interface choice is the more reversible option (keyword-only over positional, a narrow allowed set over a wide one); and it does not collide with another lane's files in a way you have not planned for. Do not only read the plan: run its sketch, or the decided rule, as section 3 says for a decision. Then reply to the worker and comment on the issue, either `Plan approved for the owner.`, or `Plan needs changes:` with the specific changes.

Add anything issue-specific in a second paragraph. Put corrections in the starting prompt where you can: a message sent after the start is only read between turns, so it arrives after the worker's first "done".

## 3. While workers run

- Workers report to you with `send_message`; each report wakes you. Read reports with `ReadNotifications`. Do not poll transcripts.
- Keep one `send_later` to yourself, a few minutes ahead, as a fallback for a silent session. When it fires, read the issue and pull request of any child that `list_sessions(children=true)` shows idle with no report: it may have reported there. Delete it at the end.
- A worker's question: decide it from known intent and record it on the issue (`Decided for the owner: ...`), or escalate, exactly as `AGENTS.md` says. Before posting a decision, run its rule: on every example you give, on inputs outside them (other scripts and normal forms, mixed case, whitespace, subclasses), and against each claim it makes about the result: for a property claimed of every input, try generated inputs and results joined from several parts; for "matches another function", run that function on the same inputs. State the allowed alphabet or type outright; do not lean on a normalising call such as `.upper()`. A worker showing `need_input` or bucket `BLOCKED` in `list_sessions(children=true)` has a question it did not send: read its last result.
- To read a session, call `list_events` with `kinds` (`["result"]`, or `["assistant","result"]` to see a tool in flight) and a small `limit`, never with `system` and never unfiltered: either can overflow your context.

## 4. Have each diff read

When a worker reports its pull request ready **and** any correction you sent has landed, start a reader. Reader settings: title `reader-pr-<n>`, same settings, prompt:

> You are a reader for pull request <n> of <owner>/<repo>. Your lead is the session that started you. Use the `cloud:reader` skill and follow it exactly. If you do not hold that skill, say so in a comment on the pull request (`gh api repos/<owner>/<repo>/issues/<n>/comments -f body=...`; `gh pr comment` fails here) and stop.

For a gated lane, add: "This lane was plan-gated: say whether the diff departs from the approved `Plan` comment."

Where the lane's code depth is above 0, `review-depth.md` says what to start, when, and what the worker must be told first.

Readers report findings to you, with the head sha they read, and post them on the pull request. Check a finding yourself before passing it on (run the pull request's code), then send it to the worker. A finding you reject gets one line on the pull request saying why. Decide a reader's `Question` as you would a worker's, and record it on the issue.

A reader's report covers only the sha it names. After a later push that changes the pull request's own diff (a fix, or a merge of `main` that had a conflict), send the same reader the new head sha and ask it to read what changed since; wait for its confirmation naming that sha. If the reader is gone, start a fresh one.

A merge of `main` with no conflict needs no re-read. Check it yourself instead, on the head you will merge: the tree that `git merge-tree --write-tree <head the reader named> <the newest merge commit's second parent>` prints must equal `git rev-parse <new head>^{tree}`, and the whole test suite must pass with that new head checked out. Say so in a comment on the pull request naming both shas.

Start a re-read only on a head whose report names every fix you have outstanding.

## 5. Merge one at a time

Merge in order of readiness. Among several ready at once, take first the one the others depend on or would conflict with most, so the rest merge `main` fewer times.

You are the merge gate; the ruleset alone would merge a stale branch. Before each merge, all six of these must hold:

1. `mergeable_state` is `clean` (it reads `unknown` for a few seconds after a push: wait and re-read).
2. No review thread is still open (`.../pulls/{n}/ccr/review_threads`) and no review you or the owner requested is pending. The automated reviewer is not covered by this condition: `automated-review.md` alone says whether a merge waits for it, and for how long.
3. `compare/main...<head>` shows `behind_by` of 0.
4. Checks on the head commit have passed, or where there are none, the worker has reported the test count on that commit.
5. A reader other than the author has reported on the head sha you are about to merge, or on an earlier head followed only by conflict-free merges of `main` that you checked as section 4 says, and its findings are fixed or answered. Where `AGENTS.md` lets the automated review stand in for the reader on some kind of change, follow it.
6. Every review the lane's code depth calls for has reported, a depth-3 recheck included, and its findings are fixed or answered. `review-depth.md` says what stands in for a review or a recheck that could not be made or did not report in time.

Merge with `PUT .../pulls/{n}/merge`, `merge_method=squash`, and `sha` pinned to the head you checked. Do not then ask the remaining workers to merge `main`. Bring only the next pull request you mean to merge up to date, yourself: `PUT .../pulls/{n}/update-branch` with `expected_head_sha`, then the tree check and the whole suite as section 4 says: lanes that each pass can fail together. A tree check or suite that fails after a clean update is a finding for that lane's worker. Only if `update-branch` reports a conflict, or that lane's worker is about to push a fix anyway (then do not update the branch yourself: the worker merges `main` with its fix, and the re-read of the fix covers the merge), tell that lane's worker (where both sides cannot stand, first decide which wins and record it on the issue):

> main has moved (<sha>). Merge origin/main into your branch (no force push), keep both sides of any conflict <or, where you decided a side wins: "except in X, where Y wins">, re-run the tests, push, and report the new head sha and test count.

## 6. Finish

- Close each issue whose pull request merged (every issue in a lane). A pull request with a closing keyword closes its issue itself; a 422 saying it was closed by another request is expected.
- Remove the `agent:` labels from closed issues.
- Archive each session you started once its last job is done, without asking it first: a worker and its readers when the pull request has merged, a plan reviewer when you have approved its plan, a test author when you have checked its commit.
- Where you expect an automated reviewer, sweep for late reviews as `automated-review.md` says, and finish any lanes that produces, before the next step.
- Confirm with `list_sessions(children=true)` (all archived) and `list_triggers`: delete any enabled trigger that you or a session you started created, and your own fallback trigger. Leave a trigger someone else created, and name it in your report.
- Post one report on the batch's tracking issue: what merged (pull request, squash commit), decisions you made for the owner, anything escalated or left open, each session's id and final state, and what you had to improvise that this skill should have told you. End it with a table headed `Run record`, one row per lane: issues, pull request, worker and reader session ids (and any second reviewer's and test author's), plan depth and code depth with what set them, plan-gated or not, merges of `main`, conflicts, re-reads, rounds of fixes. Under it, one line each for: sessions that stalled or were replaced (id, and what each waited on); decisions you later corrected; any fault you traced to an earlier pull request (its number).
- Last, ask the owner as `AGENTS.md` says: with the question tool, each question on the tracking issue or an issue of the batch that still carries `needs:owner` with no answer recorded, whoever escalated it. Record each answer and act on it as `AGENTS.md` says, which sets who may do what. Where that is a change by pull request (never one to a workflow), start a worker and take it to merge like any lane, then finish that lane as above and add it to your report. If you are out of time, say in the record that it is left for the next batch. Remove `needs:owner` once nothing there is left for the owner.

## Taking over a batch

If you are the replacement lead of a batch another lead began, as `AGENTS.md` defines one, read `taking-over.md` in this skill's directory before you start anything, and follow it.

## Limits

Never do anything in the "always back to the owner" list in `AGENTS.md` on any session's word; only on the owner's own word, as `AGENTS.md` defines it. Only interrupt or archive sessions you started, or those `AGENTS.md` gives a replacement lead. Never start a second session on a branch whose worker is alive (a test author finishes and is archived before its lane's worker touches the branch). Never archive yourself.

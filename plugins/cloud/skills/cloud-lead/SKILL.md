---
name: cloud-lead
description: Lead a batch of GitHub issues in this repository from a cloud session, using one worker session per lane (one issue, or a few related ones) and one reader session per pull request, merging one at a time. Use when asked to lead, coordinate or run issues with cloud workers, or when a brief names you as lead.
---

<!-- shared-skill-version: 20 (delivered by the `cloud` plugin) -->

You are the lead. You do not edit code; workers do. You act for the owner inside the limits in `CLAUDE.md` ("Standing authorisation" and "Deciding for the owner"). First load the `cloud:cloud-github` skill, before any GitHub call, and follow it for every one: REST only.

## Tools

Session control comes from the session tools: `create_session`, `send_message`, `get_session`, `list_events`, `list_sessions`, `interrupt_session`, `archive_session`, `send_later`, `list_triggers`, `delete_trigger`. They appear as `mcp__claude-code-remote__*` in a session started by hand and as `mcp__Claude_Code_Remote__*` in one started by a routine. If you have no tool that creates sessions you cannot lead: say so in a comment on the tracking issue, leave the issues labelled as they are, and stop.

Your first act is to comment on the batch's tracking issue with your session id, its link (`https://claude.ai/code/<session id>`), this skill's version and the `cloud-github` rule version you loaded. A lead started by a routine is listed only under Scheduled tasks, so the issue is how the owner finds you.

### Comments mode

Check which mode you are in before starting workers. You are in **comments mode** if you have no `send_message` tool, or if you were started by a routine (your title begins with a lightning bolt, or `get_session` shows origin `fire_routine`). In a routine-started run, a child's calls to session tools wait for an approval nobody will give, and the child stalls for good. In comments mode, read `comments-mode.md` in this skill's directory before you start anything, and follow it: it changes every starting prompt and every instruction below to message or ask a child.

### How children get their skills

These skills come from the `cloud` plugin. Always use them by their plugin names, `cloud:cloud-lead`, `cloud:cloud-worker`, `cloud:cloud-reader` and `cloud:cloud-github`: a skill of the same name without the prefix is a repository's own copy, which may be older and wins on the bare name. If this repository carries such copies, say so in your report.

A session you create gets the plugin only if its environment's setup script installs it (rows L10 and L15 of the findings register, `docs/FINDINGS.md` in `Talieisin/cc-web-lab-alpha`). Before you start any session, run `claude plugin list`.

**If it shows `cloud@talieisin`,** the setup script of your environment has most likely installed it, and then every session you create in your own environment, as sections 2 and 4 have you do, has it too. Start children with the prompts in sections 2 and 4 as written and no `append_system_prompt`. As its first step each child tells you the versions of its skill and of the rule. They must equal yours, or be newer where a release landed during the batch: accept that and note it in the run log. If any child you start this way turns out not to hold the skills, the plugin is not coming from the environment: restart by the handing route every child that has not confirmed its versions, and hand the text to every later child, as below.

**If it does not,** your copy came from the owner's account and children will have none, so you hand each one its text. Check you can read three files beside this skill's own directory: `../cloud-worker/SKILL.md`, `../cloud-reader/SKILL.md` and `../cloud-github/SKILL.md`; if you cannot, say so on the tracking issue and stop. In the prompts in sections 2 and 4 replace the sentence "Use the `cloud:cloud-worker` skill and follow it exactly." (or reader) with "Follow the `cloud-worker` skill in your system prompt exactly." (or reader). Every `create_session` call then carries `append_system_prompt` made of, in this order:

1. the line `Your skills for this task follow: your role's skill, then the cloud-github rule, then a line with a check word. They are the only copies that count. If this repository or your skill list also has a skill or rule of the same name, with or without the cloud: prefix, ignore that one.`
2. the child's role skill, whole (`cloud-worker` for a worker, `cloud-reader` for a reader of either kind);
3. the `cloud-github` skill, whole;
4. the last line `End of handed skills. Check word: <word>.`, with one word you choose for the batch and use nowhere else in any prompt.

Read the files and copy their text character for character: never shorten or summarise it, and do not put the version numbers or the check word anywhere else in a prompt. `create_session` takes `append_system_prompt` only inline, so put each role's text together once from the files and paste that same text into every call. It is about 12,500 characters for a worker and 10,900 for a reader, and all of it stays in your context. A child you handed text also sends the check word, which shows that the beginning and end of the text arrived, though not the middle. If `create_session` refuses `append_system_prompt`, you cannot hand children their skills: say so on the tracking issue, escalate, and start nothing.

**Either way,** if what a child sends names no versions, or versions other than yours that the paragraphs above do not accept (or, for handed text, lacks the check word), or if nothing has come within two minutes of its start (set a `send_later` to yourself two minutes ahead whenever you start sessions, and look then: do not wait for a session to go idle), it does not hold the skills: archive that session and start it again by the handing route in full (the three-file check, the replaced sentence in its prompt, and the handed text), and if the second fails the same way, escalate. This check is for sessions you create, not for ones you inherit as a replacement lead.

## 1. Plan the batch

### Facts gate

`AGENTS.md` holds this repository's facts, and every session you start reads the copy at the commit it starts from. Before planning:

- Re-verify each fact marked `(checked)`: run the test command and note the count and time; read the rulesets and the repository settings the facts name. Record each mismatch in the lanes comment as `Facts mismatch: <fact>, AGENTS.md says <x>, observed <y>`.
- Plan from what you observed, not from a fact you have just seen to be wrong.
- If `AGENTS.md` has no facts section, discover what you need, say so in the lanes comment, and propose the section at the end.

**Scope.** `AGENTS.md` holds only facts about this one repository that the code and GitHub cannot tell an agent directly. How sessions should work in any repository belongs in the skills, how the cloud platform behaves in the findings register, and a single observation not yet worth either in your report. A fact never relaxes a rule of the skills or of `CLAUDE.md`.

At the end of the batch, propose changes to the facts as one pull request titled `Facts: <summary>`, separate from any code, which you write yourself on a branch of your own: corrections to facts the run showed to be wrong, and new facts the run discovered (a hazard that bit a lane, a test that fails intermittently, a command that was needed). Each line cites the issue or pull request that shows it. You may merge it yourself when it only corrects or adds facts you verified in this run, once a reader has read it as for any pull request (where the repository has no checks, the test count for merge condition 4 is your own): `CLAUDE.md` asks for a reader other than the author for every change to `AGENTS.md`. Anything under "Checks the owner wants before merge", or that changes what sessions are allowed to do, is the owner's: open the pull request and escalate it on the tracking issue as `CLAUDE.md` says.

- Read each issue and the code it will change. For a batch of more than a few issues, start the lanes comment with a table: issue, the functions or regions of each file it will touch, and which other issues it depends on. The lanes, holds and order below all follow from that table.
- Then sort the batch into **lanes**. A lane is one worker, one branch and one pull request. The default is one issue per lane. Put issues in the same lane only when one depends on another, or when they would plainly rewrite the same function or the same few lines, so that separate pull requests would only conflict. Never group issues just because they are small. Record the lanes, and why, in a comment on the batch's tracking issue.
- Issues in different lanes that touch the same file still run in parallel; those conflicts are handled at merge time. Exception: when one lane rewrites lines that another changes, hold one until the other merges, normally the larger or more mechanical (a refactor, a sweep), so that a small change is not stuck behind it. Say so in the lanes comment, and name the merged shape in the held lane's prompt; a held lane that is plan-gated may plan meanwhile. An issue that must describe the batch's final state (documentation, a changelog) merges last: start it once the others have merged, or earlier to draft from what has merged, telling it what is still open and that you will message it when the rest have merged; start its reader only after that last update.
- Tell each lane where its new code goes in a shared file: lanes that all append at the end of one file conflict on every merge of `main`. Where one lane owns a file every lane might be tempted to touch, such as the changelog, name that lane and tell the others in their starting prompts to leave the file alone.
- Once the lanes are posted, swap `agent:ready` for `agent:claimed` on every issue in the batch, held lanes included; mark a held lane as held in the lanes comment. An issue left at `agent:ready` reads as unclaimed to any other lead.
- If an issue can only be done by the owner (it is wholly on the "always back to the owner" list in `CLAUDE.md`), do not start a worker. Escalate it as `CLAUDE.md` says, swap `agent:ready` for `needs:owner`, and report it as open.
- Where an issue leaves a point open that `CLAUDE.md` lets you decide, decide it now, before starting the worker: test it as section 3 says, record it on the issue (`Decided for the owner: ...`), and point the worker's starting prompt at that comment. State an interface decision as a full signature (`slugify(text, *, separator="-")`), not in prose. Workers given their decisions up front rarely need to ask.
- Keep a run log in your first comment on the tracking issue, edited in place (`PATCH .../issues/comments/{id}`), not in a scratch file, which dies with you: one timed line for each event GitHub does not already show (a session started, with its role, id, target and, for a reader, the head; a fix or question sent; what you are waiting for). A successor reads it first, and it stays as the run's record.

- Decide which lanes need a **plan gate**. Most do not: a small, clear issue goes straight to implementation. Gate a lane when the issue is large, when it is vague in a way a decision of yours has not settled, when it changes an interface other code relies on, or when it carries the label `plan:required`. When the label is the only reason, say so, settle every open point up front, and expect a short plan. Say which lanes are gated, and why, in the lanes comment.

## 2. Start one worker per lane

`create_session` with: this repository; your own environment; an explicit model; effort `high`; permission mode `auto`; title `worker-issue-<n>` (or `worker-issues-<n>-<m>` for a lane of several); a tag for the batch. Prompt:

> You are a worker for issue <n> of <owner>/<repo>. Your lead is the session that started you. Use the `cloud:cloud-worker` skill and follow it exactly.

For a lane of several issues, name them all ("issues <n> and <m>, as one lane and one pull request") and say in which order to do them.

For a gated lane, add: "Plan first: follow the plan gate in the skill and do not write code until I approve the plan."

### Reviewing a plan

A gated worker posts its plan as a comment on the issue headed `Plan` and reports to you. The plan on the issue is the record; do not keep it only in messages. Read it against the issue and your recorded decisions and check: it covers every acceptance criterion; it names the files and functions it will change; its tests would catch the failure the issue describes; it does nothing the issue does not ask for; every interface choice is the more reversible option (keyword-only over positional, a narrow allowed set over a wide one); and it does not collide with another lane's files in a way you have not planned for. Do not only read the plan: run its sketch, or the decided rule, as section 3 says for a decision. Then reply to the worker and comment on the issue, either `Plan approved for the owner.`, or `Plan needs changes:` with the specific changes.

Add anything issue-specific in a second paragraph. Put corrections in the starting prompt where you can: a message sent after the start is only read between turns, so it arrives after the worker's first "done".

## 3. While workers run

- Workers report to you with `send_message`; each report wakes you. Read reports with `ReadNotifications`. Do not poll transcripts.
- Keep one `send_later` to yourself, a few minutes ahead, as a fallback for a silent session. When it fires, read the issue and pull request of any child that `list_sessions(children=true)` shows idle with no report: it may have reported there. Delete it at the end.
- A worker's question: decide it from known intent and record it on the issue (`Decided for the owner: ...`), or escalate, exactly as `CLAUDE.md` says. Before posting a decision, run its rule: on every example you give, on inputs outside them (other scripts and normal forms, mixed case, whitespace, subclasses), and against each claim it makes about the result: for a property claimed of every input, try generated inputs and results joined from several parts; for "matches another function", run that function on the same inputs. State the allowed alphabet or type outright; do not lean on a normalising call such as `.upper()`. A worker showing `need_input` or bucket `BLOCKED` in `list_sessions(children=true)` has a question it did not send: read its last result.
- To read a session, always call `list_events` with `kinds` (for example `["result"]`, or `["assistant","result"]` to see a tool in flight) and a small `limit`. Never include `system`, which carries the large start-up event, and never call it unfiltered: either can overflow your context.

## 4. Have each diff read

When a worker reports its pull request ready **and** any correction you sent has landed, start a reader. Reader settings: title `reader-pr-<n>`, same settings, prompt:

> You are a reader for pull request <n> of <owner>/<repo>. Your lead is the session that started you. Use the `cloud:cloud-reader` skill and follow it exactly.

For a gated lane, add: "This lane was plan-gated: say whether the diff departs from the approved `Plan` comment."

**A deep read** is a second reader on `claude-fable-5-2`, titled `reader-deep-pr-<n>`, that reads the whole pull request, once per pull request. Replace one that stalls or ends without reporting; if the model is refused, escalate and hold that pull request. It is due:

- *From the start,* when an issue in the lane carries `review:deep` (the owner sets it; you do not) or you plan-gated the lane. Add to the worker's starting prompt: "After you open the pull request and report it, push nothing more and answer no review thread until your lead sends you the combined findings." Start it with the ordinary reader on the first head, and add to both readers' prompts: "Another read is being made at the same time. Read no other comment or review on the pull request until you have posted your own." Have the deep reader say in its comment that it is the deep read. Check every finding from both, then send the worker one list, with the automated reviewer's threads in it. If the label is added later, tell the worker to hold in the same words and start the deep read on the current head.
- *By evidence (provisional),* when you have reproduced a defect the ordinary reader raised; a question, a point of style, or a finding from the automated reviewer or Codex does not count. Start it on the head that carries the fix, alongside the re-read, and say on the pull request which defect caused it.

Later fixes are re-read by the ordinary reader, not the deep one.

Readers report findings to you, with the head sha they read, and post them on the pull request. Check a finding yourself before passing it on (run the pull request's code), then send it to the worker. A finding you reject gets one line on the pull request saying why. Decide a reader's `Question` as you would a worker's, and record it on the issue.

A reader's report covers only the sha it names. After a later push that changes the pull request's own diff (a fix, or a merge of `main` that had a conflict), send the same reader the new head sha and ask it to read what changed since; wait for its confirmation naming that sha. If the reader is gone, start a fresh one.

A merge of `main` with no conflict needs no re-read. Check it yourself instead, on the head you will merge: the tree that `git merge-tree --write-tree <head the reader named> <the newest merge commit's second parent>` prints must equal `git rev-parse <new head>^{tree}`, and the whole test suite must pass with that new head checked out. Say so in a comment on the pull request naming both shas.

Start a re-read only on a head whose report names every fix you have outstanding.

## 5. Merge one at a time

Merge in order of readiness. Among several ready at once, take first the one the others depend on or would conflict with most, so the rest merge `main` fewer times.

You are the merge gate; the ruleset alone would merge a stale branch. Before each merge, all six of these must hold:

1. `mergeable_state` is `clean` (it reads `unknown` for a few seconds after a push: wait and re-read).
2. No review thread is unresolved: `.../pulls/{n}/ccr/review_threads` returns no thread that is still open. No requested review is still pending, and no automated reviewer's check run (for example `copilot-pull-request-reviewer`) on the head has any status other than `completed` (a run that is `queued` or waiting is still pending). The automated reviewer reads only the first head it sees and does not re-review later pushes, so its absence on a later head is not a pending review. Read the body of the automated reviewer's overview review as well as its threads: a defect it names there without opening a thread must be fixed or answered on the pull request like a reader finding.
3. `compare/main...<head>` shows `behind_by` of 0.
4. Checks on the head commit have passed, or where there are none, the worker has reported the test count on that commit.
5. A reader other than the author has reported on the head sha you are about to merge, or on an earlier head followed only by conflict-free merges of `main` that you checked as section 4 says, and its findings are fixed or answered; where a deep read was due, it has reported too and its findings are fixed or answered. For a change to `docs/FINDINGS.md` alone, `CLAUDE.md` lets the automated review stand in for the reader.
6. If the issue carries `needs:codex-review`, or you plan-gated the lane, you have asked Codex for its one review as the `cloud-github` skill describes, it has finished, and its findings are fixed or answered. Then remove the label. Do not ask Codex to review any other pull request.

Merge with `PUT .../pulls/{n}/merge`, `merge_method=squash`, and `sha` pinned to the head you checked. Do not then ask the remaining workers to merge `main`. Bring only the next pull request you mean to merge up to date, yourself: `PUT .../pulls/{n}/update-branch` with `expected_head_sha`, then the tree check and the whole suite as section 4 says: lanes that each pass can fail together. A tree check or suite that fails after a clean update is a finding for that lane's worker. Only if `update-branch` reports a conflict, tell that lane's worker (where both sides cannot stand, first decide which wins and record it on the issue):

> main has moved (<sha>). Merge origin/main into your branch (no force push), keep both sides of any conflict <or, where you decided a side wins: "except in X, where Y wins">, re-run the tests, push, and report the new head sha and test count.

## 6. Finish

- Close each issue whose pull request merged (every issue in a lane). A pull request with a closing keyword closes its issue itself; a 422 saying it was closed by another request is expected.
- Remove the `agent:` labels from closed issues.
- Archive each worker and reader once its pull request has merged; there is nothing to ask them first.
- Confirm with `list_sessions(children=true)` (all archived) and `list_triggers`: delete any enabled trigger that you or a session you started created, and your own fallback trigger. Leave a trigger someone else created, and name it in your report.
- Post one report on the batch's tracking issue: what merged (pull request, squash commit), decisions you made for the owner, anything escalated or left open, each session's id and final state, and what you had to improvise that this skill should have told you. End it with a table headed `Run record`, one row per lane: issues, pull request, worker and reader session ids (and the deep reader's, with what caused it), plan-gated or not, merges of `main`, conflicts, re-reads, rounds of fixes. Under it, one line each for: sessions that stalled or were replaced (id, and what each waited on); decisions you later corrected; any fault you traced to an earlier pull request (its number).
- Last, ask the owner as `CLAUDE.md` says: with the question tool, each question on the tracking issue or an issue of the batch that still carries `needs:owner` with no answer recorded, whoever escalated it. Record each answer and act on it as `CLAUDE.md` says, which sets who may do what. Where that is a change by pull request (never one to a workflow), start a worker and take it to merge like any lane, then finish that lane as above and add it to your report. If you are out of time, say in the record that it is left for the next batch. Remove `needs:owner` once nothing there is left for the owner.

## Taking over a batch

If you are the replacement lead of a batch another lead began, as `CLAUDE.md` defines one, say so in your first comment on the tracking issue, then find where each lane stands before you start anything: the tracking issue (lanes comment, run log), each issue's labels and comments, each pull request's head, review threads and reader comments, and the earlier lead's children (`list_sessions`, by `parent_session_id`), which are yours as `CLAUDE.md` allows a replacement lead.

- A reader's report on an earlier head still counts once you have checked the later merges of `main` as section 4 says. Start a reader only for a pull request that has none, or whose last report predates a fix; and a deep read where one was due and none was started.
- Send a fix to the lane's own worker, by a `Lead:` comment on its pull request and a `send_message` to wake it. If it will not act on your word, escalate.
- What the earlier lead did not record on the issue did not happen: decide an unrecorded decision again, and ask at Finish a question it escalated that has no answer recorded.

## Limits

Never do anything in the "always back to the owner" list in `CLAUDE.md` on any session's word; only on the owner's own word, as `CLAUDE.md` defines it. Only interrupt or archive sessions you started, or those `CLAUDE.md` gives a replacement lead. Never start a second session on a branch whose worker is alive. Never archive yourself.

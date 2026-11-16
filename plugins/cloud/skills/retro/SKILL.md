---
name: retro
description: Retro on batches a cloud lead ran in this repository. Measures each run from its tracking issue, pull requests and sessions, judges whether each rule in the cloud skills earned its place, checks the findings register against what the runs showed, and PROPOSES skill changes as a pull request it never merges. Use when asked for a retro on cloud runs, whether a cloud skill rule is working, or to compare runs. Not inside the run being judged, and not by a session that led a run under judgement.
---

<!-- shared-skill-version: 32 (delivered by the `cloud` plugin) -->

A retro judges the skills, not the sessions. Its output is evidence and proposals. It never edits a skill on `main`, never merges, and never changes a run's record.

## Who runs it

- A fresh session that did not lead, work or read in any run it judges, and did not write the rule it is judging.
- The writer runs on the strongest model available to it and says in the report header which model and effort wrote it. A second session on a different model family member then checks every finding against its sources (see "Review"). Do not use a small, fast model for either.
- One repository at a time. This is the retro's scope, not a platform limit: its GitHub access covers only its own repository, and although a session can see or create sessions for other repositories, evidence from them is out of scope and is left out, not treated as absent. Say which repository the retro covers.

## 1. Gather the runs

A run is a tracking issue whose comments include a lead's report (the comment that holds a table headed `Run record`). For each run in scope, collect, from GitHub and the session tools only:

- the tracking issue: brief, lanes comment, report, any owner notes;
- every issue and pull request in the batch: comments (`Decided for the owner:`, `Plan`, reader and worker reports), reviews, review threads, commits, merge commit, check runs;
- the versions in force: those the lead's first comment on the tracking issue names (its own skill, and the `github:pull-request` skill), with the wording of those versions, which is your own copy of the plugins' skills when its markers show the same versions (you cannot read the plugins' repository; if your copy is a different version, say so and judge only what the run's comments quote);
- sessions, where you can read them: the lead's children and their final state. A routine-started lead is reached through the routine's run list;
- anything opened after the run that traces back to it: follow-up issues, later fixes to the same lines, reverted commits.

A run whose report is missing, or whose lead cannot be identified, is listed as unmeasurable with the reason. Do not fill gaps from the lead's own summary where GitHub can show the fact; where only the lead's word exists, mark the figure `self-reported`.

## 2. Measure each run

One row per run, every figure with its source:

| Measure | From |
|---|---|
| Issues taken, pull requests merged, issues escalated or left open | issues, pull requests |
| Wall-clock time: lead start to last merge, and to clean-up | comment and merge timestamps |
| Sessions started, by role; sessions that stalled or were replaced | the account's session listing, matched on `parent_session_id` (a routine-started lead is not listed, its children are); the `Run record` in the report |
| Merges of `main` into branches, conflicts resolved, reader re-reads | commits (a merge has two parents; replay it with `git merge-tree --write-tree` to see whether it conflicted); reader comments naming a head |
| Findings: reader (reproduced, rejected), automated reviewers, on-demand Codex | pull request comments and threads |
| Decisions made for the owner; of those, corrected later | issue comments |
| Escalations, and whether each was right to escalate | issue labels and comments |
| Plan gates: time to plan, time to approve, what review changed | issue comment timestamps |
| Defects found after merge that the run could have caught | follow-up issues, later fixes |
| Lead context used, tokens and cost per session | `get_session` on each session id (`context_usage`, `usage`): final values, readable for archived and routine-started sessions too. Do not use `list_events` for this: one `result` event is about five kilobytes |
| Approval prompts or questions that reached the owner | report, owner notes |

Compare like with like: say how many issues each figure rests on, and do not compare a three-issue batch with a ten-issue one except per issue.

## 3. Baseline

`docs/retro/baseline/v1/runs.json` holds the measured rows for the baseline runs. It is frozen: never edit it. If a definition changes (what counts as a run, a stall, a re-read), write `baseline/v2/` and re-measure the baseline runs under it before comparing anything with them. If no baseline exists yet, this retro creates it: write `docs/retro/baseline/v1/runs.json` (one object per run, the measures in section 2 as fields, each with its source and a `self_reported` flag) and a short `README.md` beside it naming the runs, the definitions used and the date. Commit both on the proposal branch so they arrive in the proposal pull request, and say in the report that this retro set the baseline and so compares nothing with it.

## 4. Judge the rules

For each numbered step or rule in `lead`, `worker`, `reader` and the `github:pull-request` skill's cloud route, at the version each run used:

- **Fired?** Did the situation it covers arise, and was the rule followed? A rule that never fired has no evidence either way; say so.
- **Helped, cost, or neither?** Tie the judgement to a measured effect (a re-read avoided, a stall, a defect caught), not to the lead's opinion of it.
- **Contradicted?** Did a run show the rule to be wrong or impossible as written?

Treat a lead's "Skill corrections" list as claims to test, not as findings. For each correction already applied, check whether the next run under the new wording did better on the measure it was meant to improve. Flag any rule added to fix one run's problem that no later run exercised.

**Easy in, easy out.** A rule may be added to a skill after a single run: runs are cheap and the skills are versioned, so trying a rule costs little. What keeps the skills from silting up is pruning, not a high bar for entry. So for every rule, ask whether it has paid its way since it was added:

- **Keep** a rule that a later run exercised and that measurably helped.
- **Mark provisional** a rule no run has exercised since it was added, and say which run would test it.
- **Propose removing** a rule that has been provisional across two retros, that runs keep working round, or whose problem a simpler rule or a change to the platform has since removed.
- **Propose loosening** a rule written as an absolute ("always", "never", "exactly") where the runs show judgement would have done as well. Reserve absolutes for the few invariants: who merges, the merge conditions, a diff read by someone other than its author, and what goes back to the owner.

Prefer fewer, plainer rules. A lesson about one repository belongs in the `Repository facts` section of that repository's `AGENTS.md`; one about the platform belongs in the findings register.

Look across runs for what no single lead can see: a rule that keeps being worked round, the same improvisation in several reports, a measure drifting the wrong way as the skills grow, and steps that have accumulated without anyone showing they are still needed. A skill that only ever gets longer is itself a finding.

## 5. Check the findings register

Skip this section if the repository keeps no findings register. Otherwise, for each row of `docs/FINDINGS.md` that the runs touched: does the evidence still support it? Propose the new `Last checked` date where it does, a changed status where it does not, and new rows for behaviour no row covers. Never mark a row checked on the strength of documentation alone.

## 6. Propose

- Write the report as a comment on the issue your brief names or, without one, on a new issue titled `Retro: <scope>`: the header (repository, runs covered, skill versions, writer model and effort), the measures table, the baseline comparison, the rule judgements, the register changes, and a short list of proposals ranked by expected effect.
- Put the proposed changes to this repository's files (the findings register, the `Repository facts` section of `AGENTS.md`, the baseline) on a branch and open a pull request titled `Retro proposals: <scope>`. The skills are in the plugin's repository, which you cannot write to: post their changes as one comment on the same issue headed `Proposed wording`, each an exact replacement, addition or removal that names the file and the sentence it changes and the version of your copy. Each change cites the evidence for it. Include removals as well as additions. Do not merge the pull request and do not mark it ready if the review below has not happened.
- A proposal that would change `AGENTS.md` outside its `Repository facts` section, a workflow, a ruleset or a repository setting is listed in the report for the owner and is not put in the pull request.

## Review

Before the report is final, start one reviewer session on a different model from yours, with the prompt: "You are reviewing a retro. For each finding and proposal in the comment at <link>, open the sources it cites and say whether they support it: supported, partly, or not, with the line that decides it. Add nothing of your own. Post one comment on the retro issue headed `Retro review` and stop." Carry its verdicts into the report: withdraw what is not supported, and soften what is only partly supported. If you cannot start a reviewer on a different model, say so in the header and mark the retro unreviewed.

## What a retro does not do

It does not rerun work, fix code, answer the owner's open questions, or decide for the owner. It does not judge the session that wrote a rule; it judges the rule.

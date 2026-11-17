<!-- shared-skill-version: 35 (delivered by the `cloud` plugin) -->

# Review depth

Part of the `cloud:lead` skill, read when any lane's plan depth or code depth is above 0. Check every finding yourself before you pass it on, as for a reader's. A finding from any reviewer is fixed or answered before merge.

## Policies by name

A policy says which depth each lane gets. The owner may name one of these, write their own, or name one and adjust it in words.

- **`minimal`.** Depth 0 for everything.
- **`standard`** (used when nothing is set). A lane you plan-gated: plan depth 1, code depth 1. Everything else: depth 0.
- **`thorough`.** Every lane you plan-gate: plan depth 1 (the policy does not itself make a lane plan first). Every non-trivial change: code depth 1. A change to an interface other code relies on, to how data is stored or migrated, or to sign-in, permissions or secrets: plan depth 2 and code depth 2.

A change is non-trivial when it adds or removes behaviour, changes an interface, or refactors code that other code depends on. A change to documentation, to the repository's facts, or to tests alone is not.

A policy may also set a limit (for example "at most three lanes at depth 2 or above in a batch"). Keep to it for the depths the policy itself gives: give the depth to the lanes that most need it, and say in the lanes comment which lanes the limit held back. A limit never lowers a label's floor.

No named policy gives depth 3. It comes from the owner's words or from `review:max`.

## Filling a depth with reviewers

A depth asks for a number of second reviewers: one at depth 1, two at depths 2 and 3. Take them from `CLOUD_REVIEWERS` in its order, counting only those that are usable for the job, and never two from the same family. No reviewer is used twice on one plan or one pull request. The automated reviewer is never one of them. Whether a reviewer is usable is found by trying it:

- **`claude`** is usable if `create_session` accepts the model. The model is the environment variable `CLOUD_REVIEW_MODEL`, or `claude-fable-5-2` if that is unset. A `claude` reader that has not reported twenty minutes after its start, or that ends without reporting, is replaced once; if the replacement fails the same way, it is not usable for that plan or pull request.
- **`codex-github`** reviews pull requests only; for a plan it is not usable. For a pull request it is usable if the app answers: within five minutes of your request, `chatgpt-codex-connector[bot]` reacts to it or posts its summary comment, and within twenty minutes that summary reads Completed. If either limit passes, it is not usable in this repository: say so in the run log and do not try it again in this batch. A request you gave up on may still be answered later: if its review threads appear before you merge, they are findings like any other and must be fixed or answered, because the merge conditions count every open thread.

Look at these limits when your fallback reminder fires (section 3 of the skill); set no reminder for each. If fewer reviewers are usable than the depth asks for, use those there are, say in the lanes comment and your report what the depth asked for and what it got, and carry on: a depth the environment cannot fill does not hold the batch, or the worker.

`needs:codex-review` is different, because the owner asked by name. The lane's code depth is then at least 1, and Codex takes the first reviewer's place whatever the list says; fill any further place from the list as usual. If it is not usable, say so on the issue, escalate it as `AGENTS.md` says, send the worker the findings you do have, and hold only that lane's merge until the owner makes it usable (then make the review) or says to go on without it. That answer, recorded as `AGENTS.md` says, stands in for the review at merge condition 6.

## Reviewing a plan

Start when the worker reports its plan posted, before you approve anything.

- **`claude`.** Start a reader on the review model, titled `reader-plan-issue-<n>`, with the prompt: "You are a reader for the plan on issue <n> of <owner>/<repo> (for a lane of several issues, name them all, and say which one carries the `Plan` comment). Your lead is the session that started you. Use the `cloud:reader` skill and follow its section on reading a plan. If you do not hold that skill, say so in a comment on the issue (`gh api repos/<owner>/<repo>/issues/<n>/comments -f body=...`; `gh issue comment` fails here) and stop." It posts a comment headed `Plan review` on the issue that carries the plan and reports to you; in comments mode that comment is its report, and you find it there.

At depths 0 to 2 a plan is reviewed once: a plan changed to answer its review is not reviewed again unless the change is a different approach. **At depth 3 (provisional)**, if the plan changed, send each of its reviewers the revised plan once and ask only whether each finding was dealt with and what the revision introduced; in comments mode, start a fresh plan reader for each, with the earlier `Plan review` comment and the same instruction. That is the last round. A recheck that does not report within the limit is noted on the issue and does not hold the plan.

## Reviewing a pull request

Add to the worker's starting prompt: "After you open the pull request and report it, push nothing more and answer no review thread until your lead sends you the combined findings." If the depth rises after the start (a label added later), tell the worker the same in a message.

- **`claude`: the deep read.** A second reader on the review model, titled `reader-deep-pr-<n>`, that reads the whole pull request. It is started with the reader prompt of section 4, like the ordinary reader. Start it with the ordinary reader on the first head, and add to both readers' prompts: "Another read is being made at the same time. Read no other comment or review on the pull request until you have posted your own." Have the deep reader say in its comment that it is the deep read.
- **`codex-github`.** Ask as the `github:pull-request` skill's cloud route describes, on the first head, at the same time as the readers. Its findings arrive as review threads.

When the ordinary reader and every reviewer you used have all reported, and not before, send the worker one list: the findings you checked from each, with any automated reviewer's threads in it. Those threads are answered with the rest, not before. When it is all done, remove `needs:codex-review` from the issue if it carries it.

**The recheck, at depth 3 only (provisional).** A fix is always re-read by the ordinary reader, as section 4 of the skill says; at depths 1 and 2 by nobody else. At depth 3, if the worker changed anything, tell it with the combined list: "Push your fixes as one head, report it, then push nothing more until I send you the final list." On that head, ask each second reviewer whose finding led to a change to go over it once: were its findings dealt with, and what did the fixes introduce. For `claude`, send the same deep reader the new head, or start a fresh one with its earlier comment if it is gone or you are in comments mode; for `codex-github`, ask once more on that head. Wait for each recheck or its limit (the same limits as a first review); one that does not report in time is noted on the pull request, and that note stands in for it at merge condition 6: it does not hold the merge. Then send the worker one final list. There is no third round: what the worker pushes after it is re-read by the ordinary reader only.

## Tests first, at code depth 3

At code depth 3 the lane's tests are written by a session that will not write the code. The lane is plan-gated; decide that before you write its worker's prompt.

Tests first is only possible before the worker has written anything. If a lane reaches depth 3 later (a `review:max` label added once the worker is past its plan), it gets the two reviewers and the recheck but not tests first: say so on the issue, and carry on.

1. When you approve the plan, tell the worker: "Do not start yet: a test author is writing this lane's tests first. I will send you the branch."
2. Start a test author: `create_session` with the settings of a worker, title `tester-issue-<n>`, and the prompt: "You are the test author for issue <n> of <owner>/<repo> (name every issue of the lane). Your lead is the session that started you. Use the `cloud:tester` skill and follow it exactly. If you do not hold that skill, say so in a comment on the issue (`gh api repos/<owner>/<repo>/issues/<n>/comments -f body=...`; `gh issue comment` fails here) and stop."
3. It pushes a branch that holds only tests, comments on the issue with the branch and the commit, and reports to you. Check that the tests fail for the right reason on that commit and that they cover the plan's test list and your recorded decisions, and copy into your report its count of cases that its own list had and the plan's lacked. Then archive it. A test author that has not reported thirty minutes after its start, or that ends without reporting, is archived and replaced once. If the replacement fails the same way, tell the worker to go ahead and write the tests itself, say on the issue and in your report that the lane did not get tests first, and add `needs:owner` to the issue if the depth came from a label.
4. Send the worker the branch name and the test commit, with: "Work on that branch. Do not change or remove those tests. If you think one is wrong, tell me and wait."
5. If the worker says a test is wrong, decide it as you would a question. If you agree, record on the issue a comment beginning `Decided for the owner:` that names the test and gives the exact correction, and tell the worker it may make that one change and no other to the test author's tests. The correction is yours, not the worker's. If a reviewer finds the tests incomplete, not wrong, the worker adds new tests of its own beside the test author's and changes none of them; that needs no decision.
6. Add to the ordinary reader's prompt: "The tests at commit <sha> were written first by a test author. Say whether the pull request changed or removed any of them, other than by a correction recorded on the issue, and whether each still tests what it did."

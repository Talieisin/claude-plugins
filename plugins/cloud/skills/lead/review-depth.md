<!-- shared-skill-version: 30 (delivered by the `cloud` plugin) -->

# Review depth

Part of the `cloud:lead` skill, read when any lane's plan depth or code depth is above 0. Check every finding yourself before you pass it on, as for a reader's. A finding from any reviewer is fixed or answered before merge.

## Policies by name

A policy says which depth each lane gets. The owner may name one of these, write their own, or name one and adjust it in words.

- **`minimal`.** Depth 0 for everything.
- **`standard`** (used when nothing is set). A lane you plan-gated: plan depth 1, code depth 1. Everything else: depth 0.
- **`thorough`.** Every plan: depth 1. Every non-trivial change: code depth 1. A change to an interface other code relies on, to how data is stored or migrated, or to sign-in, permissions or secrets: plan depth 2 and code depth 2.

A change is non-trivial when it adds or removes behaviour, changes an interface, or refactors code that other code depends on. A change to documentation, to the repository's facts, or to tests alone is not.

A policy may also set a limit (for example "at most three lanes at depth 2 or above in a batch"). Keep to it: give the depth to the lanes that most need it, and say in the lanes comment which lanes the limit held back.

No named policy gives depth 3. It comes from the owner's words or from `review:max`.

## Filling a depth with reviewers

A depth asks for a number of second reviewers: one at depth 1, two at depths 2 and 3. Take them from `CLOUD_REVIEWERS` in its order, counting only those that are usable for the job, and never two from the same family (`codex-github` and `codex-clean` are one family). Whether a reviewer is usable is found by trying it:

- **`claude`** is usable if `create_session` accepts the model. The model is the environment variable `CLOUD_REVIEW_MODEL`, or `claude-fable-5-2` if that is unset. A `claude` reader that stalls or ends without reporting is replaced once; if the replacement fails too, it is not usable for that plan or pull request.
- **`codex-github`** reviews pull requests only; for a plan it is not usable. For a pull request it is usable if the app answers: within five minutes of your request, `chatgpt-codex-connector[bot]` reacts to it or posts its summary comment, and within twenty minutes that summary reads Completed. If either limit passes, it is not usable in this repository: say so in the run log and do not try it again in this batch.
- **`codex-clean`** is not yet usable from a cloud session.

Set a `send_later` for each time limit so that you look when it passes. If fewer reviewers are usable than the depth asks for, use those there are, say in the lanes comment and your report what the depth asked for and what it got, and carry on: a depth the environment cannot fill does not hold the batch, or the worker.

`needs:codex-review` is different, because the owner asked by name. Codex is then one of that pull request's reviewers whatever the list says, and counts towards the depth. If it is not usable, say so on the issue and escalate it as `AGENTS.md` says. Send the worker the findings you do have, so that it is not left waiting, and hold only that lane's merge. The owner's answer ends the hold in one of two ways: the owner makes it usable (then make the review), or the owner says to go on without it. Record the answer as `AGENTS.md` says; a recorded answer to go on without it stands in for that review at merge condition 6.

## Reviewing a plan

Start when the worker reports its plan posted, before you approve anything.

- **`claude`.** Start a reader on the review model, titled `reader-plan-issue-<n>`, with the prompt: "You are a reader for the plan on issue <n> of <owner>/<repo> (for a lane of several issues, name them all, and say which one carries the `Plan` comment). Your lead is the session that started you. Use the `cloud:reader` skill and follow its section on reading a plan. If you do not hold that skill, say so in a comment on the issue (`gh api repos/<owner>/<repo>/issues/<n>/comments -f body=...`; `gh issue comment` fails here) and stop." It posts a comment headed `Plan review` on the issue that carries the plan and reports to you; in comments mode that comment is its report, and you find it there.

At depths 0 to 2 a plan is reviewed once: a plan changed to answer its review is not reviewed again unless the change is a different approach. **At depth 3** send each plan reviewer the revised plan once and ask it to check that its own findings were dealt with and to report only what the revision introduced. That is the last round, whatever it says.

## Reviewing a pull request

Add to the worker's starting prompt: "After you open the pull request and report it, push nothing more and answer no review thread until your lead sends you the combined findings." If the depth rises after the start (a label added later), tell the worker the same in a message.

- **`claude`: the deep read.** A second reader on the review model, titled `reader-deep-pr-<n>`, that reads the whole pull request. Start it with the ordinary reader on the first head, and add to both readers' prompts: "Another read is being made at the same time. Read no other comment or review on the pull request until you have posted your own." Have the deep reader say in its comment that it is the deep read.
- **`codex-github`.** Ask as the `github:pull-request` skill's cloud route describes, on the first head, at the same time as the readers. Its findings arrive as review threads.

When the ordinary reader and every reviewer you used have all reported, and not before, send the worker one list: the findings you checked from each, with any automated reviewer's threads in it. When it is all done, remove `needs:codex-review` from the issue if it carries it.

**The recheck, at depth 3 only.** When the worker reports the head that carries its fixes, ask each second reviewer whose findings led to a change to go over that head once: to check that its own findings were dealt with, and to report only what the fixes introduced. For `claude`, send the same deep reader the new head, or start a fresh one with its earlier comment if it is gone; for `codex-github`, ask once more on that head. Treat what comes back like any finding. That is the last round: there is no third, whatever it says. A recheck that does not complete within its time limit is noted in the run log and on the pull request, and does not hold the merge. At depths 1 and 2 there is no recheck: later fixes are re-read by the ordinary reader.

## Tests first, at code depth 3

At code depth 3 the lane's tests are written by a session that will not write the code. The lane is plan-gated if it was not already.

1. When you approve the plan, tell the worker: "Do not start yet: a test author is writing this lane's tests first. I will send you the branch."
2. Start a test author: `create_session` with the settings of a worker, title `tester-issue-<n>`, and the prompt: "You are the test author for issue <n> of <owner>/<repo> (name every issue of the lane). Your lead is the session that started you. Use the `cloud:tester` skill and follow it exactly. If you do not hold that skill, say so in a comment on the issue (`gh api repos/<owner>/<repo>/issues/<n>/comments -f body=...`; `gh issue comment` fails here) and stop."
3. It pushes a branch that holds only tests, comments on the issue with the branch and the commit, and reports to you. Check that the tests fail for the right reason on that commit and that they cover the plan's test list and your recorded decisions. Then archive it.
4. Send the worker the branch name and the test commit, with: "Work on that branch. Do not change or remove those tests. If you think one is wrong, tell me and wait."
5. If the worker says a test is wrong, decide it as you would a question: you may correct the test yourself in a comment for the worker to apply, and you record the decision on the issue.
6. Add to the ordinary reader's prompt: "The tests at commit <sha> were written first by a test author. Say whether the pull request changed or removed any of them, and whether each still tests what it did."

## Raising a depth by evidence (provisional)

When you have reproduced a defect in code or tests that the ordinary reader raised, and the lane's code depth is 0, raise it to 1. A defect in documentation alone, a question, a point of style, or a finding from an automated reviewer or from Codex does not count. This path has no hold beforehand: send the worker the reader's findings as usual and let it push the fix. When it reports the fixed head, tell it to push nothing more until you send the combined findings, start the second reviewer on that head alongside the re-read, and say on the pull request which defect caused it. From then on that review is due: merge condition 6 waits for it like any other.

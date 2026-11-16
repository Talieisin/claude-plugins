<!-- shared-skill-version: 29 (delivered by the `cloud` plugin) -->

# Second reviews

Part of the `cloud:lead` skill, read when a second review is due (the section "Second reviews" says when). Check every finding yourself before you pass it on, as for a reader's. A finding from any route is fixed or answered before merge.

## Which route

Take the list for the kind of review (`CLOUD_PLAN_REVIEW` or `CLOUD_CODE_REVIEW`) and use the first entry that is usable; where an entry joins routes with `+`, use every usable route in it. Whether a route is usable is found by trying it:

- **`claude`** is usable if `create_session` accepts the model. The model is the environment variable `CLOUD_REVIEW_MODEL`, or `claude-fable-5-2` if that is unset. If the model is refused, the route is not usable.
- **`codex-github`** reviews pull requests only; for a plan it is not usable. For a pull request it is usable if the app answers: within five minutes of your request, `chatgpt-codex-connector[bot]` reacts to it or posts its summary comment. If nothing comes, the route is not usable in this repository: say so in the run log and do not try it again in this batch.
- **`codex-clean`** is not yet usable from a cloud session.

When a route proves unusable, go on to the next entry. If the list runs out, say in the lanes comment and your report that the plan or pull request had no second review, and carry on: a second review that the policy asked for and the environment cannot give does not hold the batch.

A label is different, because the owner asked by name. `review:deep` uses the `claude` route and `needs:codex-review` uses `codex-github`, whether or not the lists name them, and in addition to whatever the policy gives. If the route a label asks for is not usable, say so on the issue and escalate it as `AGENTS.md` says; hold that lane's merge for the owner's answer and keep the rest moving.

## Of a plan

Start it when the worker reports its plan posted, before you approve anything.

- **`claude`.** Start a reader on the review model, titled `reader-plan-issue-<n>`, with the prompt: "You are a reader for the plan on issue <n> of <owner>/<repo> (for a lane of several issues, name them all, and say which one carries the `Plan` comment). Your lead is the session that started you. Use the `cloud:reader` skill and follow its section on reading a plan. If you do not hold that skill, say so in a comment on the issue (`gh api repos/<owner>/<repo>/issues/<n>/comments -f body=...`; `gh issue comment` fails here) and stop." It posts a comment headed `Plan review` on the issue that carries the plan and reports to you; in comments mode that comment is its report, and you find it there.

One review per plan. A plan changed to answer its review is not reviewed again unless the change is a different approach.

## Of a pull request

Add to the worker's starting prompt: "After you open the pull request and report it, push nothing more and answer no review thread until your lead sends you the combined findings." If the review becomes due later (a label added after the start), tell the worker the same in a message.

- **`claude`: the deep read.** A second reader on the review model, titled `reader-deep-pr-<n>`, that reads the whole pull request, once. Start it with the ordinary reader on the first head, and add to both readers' prompts: "Another read is being made at the same time. Read no other comment or review on the pull request until you have posted your own." Have the deep reader say in its comment that it is the deep read. Replace one that stalls or ends without reporting.
- **`codex-github`.** Ask as the `github:pull-request` skill's cloud route describes, on the first head, at the same time as the readers. Its findings arrive as review threads.

When the ordinary reader and every route you used have all reported, and not before, send the worker one list: the findings you checked from each, with any automated reviewer's threads in it.

**One recheck, for Codex only.** If the worker changed code to answer a finding from Codex, ask Codex once more on the head that carries those fixes, and treat what comes back the same way. That is the last time: there is no third round, whatever it says. The `claude` route has no recheck; later fixes are re-read by the ordinary reader.

When it is all done, remove `needs:codex-review` from the issue if it carries it.

## By evidence (provisional)

Whatever the policy, when you have reproduced a defect in code or tests that the ordinary reader raised, and no second review of that pull request was due, start one by the `claude` route if `CLOUD_CODE_REVIEW` names it and it is usable. A defect in documentation alone, a question, a point of style, or a finding from an automated reviewer or from Codex does not count. This path has no hold beforehand: send the worker the reader's findings as usual and let it push the fix. When it reports the fixed head, tell it to push nothing more until you send the combined findings, start the second review on that head alongside the re-read, and say on the pull request which defect caused it. From then on that review is due: merge condition 6 waits for it like any other.

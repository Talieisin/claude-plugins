<!-- shared-skill-version: 28 (delivered by the `cloud` plugin) -->

# Second reviews

Part of the `cloud:lead` skill, read when a second review is due (the section "Second reviews" says when). A second review is made by every route in `CLOUD_SECOND_REVIEW` that can make it. A route that cannot is skipped; if none can, say in the lanes comment and your report that the plan or pull request had no second review, and carry on.

Check every finding yourself before you pass it on, as for a reader's. A finding from any route is fixed or answered before merge.

## Of a plan

Start it when the worker reports its plan posted, before you approve anything.

- **`claude`.** Start a reader on `claude-fable-5-2`, titled `reader-plan-issue-<n>`, with the prompt: "You are a reader for the plan on issue <n> of <owner>/<repo> (for a lane of several issues, name them all, and say which one carries the `Plan` comment). Your lead is the session that started you. Use the `cloud:reader` skill and follow its section on reading a plan. If you do not hold that skill, say so in a comment on the issue (`gh api repos/<owner>/<repo>/issues/<n>/comments -f body=...`; `gh issue comment` fails here) and stop." It posts a comment headed `Plan review` on the issue that carries the plan and reports to you; in comments mode that comment is its report, and you find it there. If the model is refused, escalate and hold that lane.
- **`codex-github`.** Cannot review a plan: the app reviews pull requests only. Skip it here.
- **`codex-clean`.** Not yet usable from a cloud session. Skip it.

One review per plan. A plan changed to answer its review is not reviewed again unless the change is a different approach.

## Of a pull request

Add to the worker's starting prompt: "After you open the pull request and report it, push nothing more and answer no review thread until your lead sends you the combined findings." If the review becomes due later (a label added after the start), tell the worker the same in a message.

- **`claude`: the deep read.** A second reader on `claude-fable-5-2`, titled `reader-deep-pr-<n>`, that reads the whole pull request, once. Start it with the ordinary reader on the first head, and add to both readers' prompts: "Another read is being made at the same time. Read no other comment or review on the pull request until you have posted your own." Have the deep reader say in its comment that it is the deep read. Replace one that stalls or ends without reporting; if the model is refused, escalate and hold that pull request.
- **`codex-github`.** Ask once, as the `github:pull-request` skill's cloud route describes, on the first head, at the same time as the readers. Its findings arrive as review threads.
- **`codex-clean`.** Not yet usable from a cloud session. Skip it.

When the ordinary reader and every route you used have all reported, and not before, send the worker one list: the findings you checked from each, with the automated reviewer's threads in it. Then remove `needs:codex-review` from the issue if it carries it.

## By evidence (provisional)

Whatever the policy, when you have reproduced a defect in code or tests that the ordinary reader raised, and no second review of that pull request was due, start one by the `claude` route if it is listed. A defect in documentation alone, a question, a point of style, or a finding from the automated reviewer or from Codex does not count. This path has no hold beforehand: send the worker the reader's findings as usual and let it push the fix. When it reports the fixed head, tell it to push nothing more until you send the combined findings, start the second review on that head alongside the re-read, and say on the pull request which defect caused it. From then on that review is due: merge condition 6 waits for it like any other.

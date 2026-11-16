<!-- shared-skill-version: 34 (delivered by the `cloud` plugin) -->

# The automated reviewer

Part of the `cloud:lead` skill, read when the repository has a reviewer that reads each pull request by itself. Its threads are findings like a reader's whenever they arrive before the merge.

## The setting

The first of these that exists: a line beginning `Automated review:` under "Defaults the owner has chosen" in `AGENTS.md`; the environment variable `CLOUD_AUTOMATED_REVIEW`; otherwise `wait`.

- **`wait`.** Before you merge a pull request, the automated review of its first head has arrived, or ten minutes have passed since the pull request opened (the owner may give another figure, as in `wait up to 20 minutes`). A pull request merged in its first minute or two is merged before that review exists, so this applies to your own facts pull request as much as to a lane's. If the time passes with no review, say on the pull request that the expected review did not arrive, go on, and say so in your report: the reviewer may have run out of quota.
- **`catch-up`.** Do not wait. The sweep below is what catches its comments.
- **`ignore`.** Do not wait, and skip the sweep.

A review still running on the first head (a check run that is `queued` or `in_progress`) is waited for under any setting but `ignore`, within the same limit.

## The sweep, at Finish

Before your report, for every pull request this batch merged, your facts pull request included, list the review comments and reviews created after it merged (`.../pulls/{n}/comments` and `.../pulls/{n}/reviews`, against the pull request's `merged_at`).

- Check each as you would a finding.
- One that is wrong: reply on its thread in a line beginning `Lead:`, saying why.
- The rest: open one issue for each pull request that has any, quoting each comment and linking the pull request, labelled `agent:ready`. Several pull requests with a single small point each (a stale count, a typo) may share one issue.
- If the batch has time left, take those issues as lanes now. Otherwise list them in your report as left for the next batch.

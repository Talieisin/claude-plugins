<!-- shared-skill-version: 35 (delivered by the `cloud` plugin) -->

# The automated reviewer

Part of the `cloud:lead` skill, read at the facts gate. An automated reviewer reads each pull request by itself, usually only the first head it sees. Its threads are findings like a reader's whenever they arrive before the merge, and a defect it names in its overview without opening a thread is a finding too.

## Whether this repository has one

1. If the `Repository facts` section of `AGENTS.md` says what reviews a pull request by itself, or that nothing does, that is the answer; verify it as below and record a mismatch like any other fact.
2. Otherwise look at the last five merged pull requests (`.../pulls/{n}/reviews`). An automated reviewer is an account with `user.type` of `Bot` that reviewed without being asked: nobody requested its review, and no comment on the pull request asked for it. The Codex GitHub app (`chatgpt-codex-connector[bot]`) reviews only when a comment asks, so it is never one.
3. If the repository has fewer than two merged pull requests, you cannot tell yet. Treat the first pull request of the batch as the test: handle it as if a reviewer were expected, and if no unrequested review of it has arrived when its time is up, the repository has none.

Say in the lanes comment what you found, and propose the fact in your facts pull request if `AGENTS.md` does not have it. If there is none, the rest of this file does not apply: wait for nothing and sweep nothing.

## The setting

The first of these that exists: a line beginning `Automated review:` under "Defaults the owner has chosen" in `AGENTS.md`; the environment variable `CLOUD_AUTOMATED_REVIEW`; otherwise `wait`.

- **`wait`.** A pull request is not merged until the automated review of its first head has arrived, or its time is up: ten minutes after the pull request opened, unless the owner gives another figure (as in `wait up to 20 minutes`). This applies to your own facts pull request as much as to a lane's. When the time is up with no review, whatever its check run shows, say on the pull request that the expected review did not arrive, merge if the other conditions hold, and say so in your report: the reviewer may be out of quota.
- **`catch-up`.** Never wait for it, even if its check run is still running. The sweep below is what catches its comments.
- **`ignore`.** Never wait for it, and skip the sweep.

A pull request that is waiting only for this must not be forgotten. While any is, keep your fallback reminder (section 3 of the skill) set no later than the earliest such time, and look at those pull requests when it fires.

## The sweep, at Finish

Under `wait` and `catch-up`, before you confirm that sessions are archived and triggers deleted and before your report, read what the automated reviewer wrote that nobody dealt with. A reminder you set for the sweep is deleted with the rest in that later step. A pull request is ready to be swept once its time is up (ten minutes after it opened, or the owner's figure); if one is not ready when you reach Finish, set your reminder for it and sweep it then. For each pull request the batch merged, your facts pull request included, list everything the automated reviewer wrote on it (`.../pulls/{n}/comments` and `.../pulls/{n}/reviews`) and take each item that was not dealt with before the merge: whatever came after `merged_at`, and anything from just before it that nobody had yet read.

- Check each as you would a finding.
- One that is wrong: reply on its thread in a line beginning `Lead:`, saying why; where it has no thread (a point made only in the review's overview), post that line as a comment on the pull request.
- The rest: open one issue for each pull request that has any, quoting each comment and linking the pull request, labelled `agent:ready`. Several pull requests with a single small point each (a stale count, a typo) may share one issue.
- If the batch has time left, take those issues as lanes now. Otherwise list them in your report as left for the next batch.

This ends after two passes. The pull requests of those extra lanes are swept once, when their time is up; any issue that second pass opens is listed in your report for the next batch and not worked now.

---
name: cloud-github
description: How to use GitHub from a Claude Code cloud session, where the proxy rejects GraphQL and `gh pr` and `gh issue` fail. Load this BEFORE the first GitHub call in any cloud session (CLAUDE_CODE_REMOTE is set), and whenever a `gh pr`, `gh issue`, `gh pr checks`, `gh pr merge` or GraphQL call fails, when opening, reviewing, updating or merging a pull request, resolving review threads, or asking Codex for a review. Gives the REST route for each. Required by the cloud-lead, cloud-worker, cloud-reader and cloud-retro skills.
---

# Pull requests from a cloud session

<!-- shared-rule-version: 9 (delivered by the `cloud` plugin as a skill, and handed by a lead to its workers and readers in their system prompt) -->

Having read this, as a skill or in your system prompt, say so where your role's skill tells you to: "cloud-github rule version 9". A session that has not said so has not read it.

Locally, the `github-pr` skill drives a pull request with `gh pr`, `gh pr checks --watch` and GraphQL. In a cloud session (`CLAUDE_CODE_REMOTE` is set) none of those work: the GitHub proxy rejects GraphQL, serves only the repositories attached to the session, and rejects branch deletion and any change to repository settings (the owner makes those by hand). Follow the same lifecycle with the REST calls below. `{o}/{r}` is this repository; `{n}` is the pull request number.

Routes marked (unverified) are taken from the proxy's own error text or GitHub's REST documentation and have not yet been exercised; if one fails, record the error on the issue and say so, do not improvise around it. The others have been used successfully from cloud sessions.

| Step in the local skill | In a cloud session |
|---|---|
| `gh pr create` | `gh api -X POST repos/{o}/{r}/pulls` with `title`, `head`, `base`, `body` (write the body to a file and pass `-F body=@file`) |
| `gh pr view --json ...` | `gh api repos/{o}/{r}/pulls/{n}`: `head.sha`, `state`, `draft`, `mergeable_state` |
| Find the reviewer bot | `gh api repos/{o}/{r}/pulls/{n}/reviews`; bots have `user.type` of `Bot` |
| `gh pr checks` | `gh api repos/{o}/{r}/commits/{sha}/check-runs` and `.../commits/{sha}/status` |
| Failed job logs | `gh api repos/{o}/{r}/actions/runs/{id}/jobs`, then `.../actions/jobs/{job_id}/logs` (unverified) |
| List review threads (GraphQL) | `gh api repos/{o}/{r}/pulls/{n}/ccr/review_threads`: returns every thread, resolved ones included, each marked `resolved` and `outdated` |
| Reply to a review comment | `gh api -X POST repos/{o}/{r}/pulls/{n}/comments/{comment_id}/replies -f body=...` |
| Resolve a thread (GraphQL mutation) | `gh api -X POST repos/{o}/{r}/pulls/{n}/ccr/comments/{comment_id}/resolve` |
| Draft and ready | `gh api -X POST repos/{o}/{r}/pulls/{n}/ccr/ready_for_review` |
| `gh pr merge --auto --squash --match-head-commit` | `gh api -X PUT repos/{o}/{r}/pulls/{n}/merge -f merge_method=squash -f sha={head sha}` |
| Bring a branch up to date with `main` before you merge it | `gh api -X PUT repos/{o}/{r}/pulls/{n}/update-branch -f expected_head_sha={head sha}`: a merge of `main`, never a force push. Run the whole test suite at the new head afterwards |
| Delete the remote branch | Not needed: the repository deletes head branches on merge. |
| Background watchers (`--watch`, Monitor) | Do not poll in a loop. End the turn and be woken: subscribe to the pull request's activity if you have a tool for it, or schedule one check-back to yourself, a few minutes ahead. |

Rules that carry over unchanged from the local skill:

- Squash merges only, and only with the head commit you verified (`sha`), so an unexpected push is not merged.
- Resolve a review thread only after a real fix or a real answer is in; reply citing the commit.
- Apply a trivial suggestion from the trusted reviewer bot yourself; anything that changes behaviour goes to the lead, and from the lead to the owner if it is a decision.
- Never merge with a review still pending, a thread unresolved, or a check failing.
- Report the pull request link, the squashed commit, and anything skipped.

## Local `main`

Do not work on local `main`: it is an old snapshot. After `git fetch origin main`, run `git checkout --detach origin/main` or create your branch from `origin/main`. If a stop hook still tells you to amend or rebase commits you did not make, do not: report it (findings register, S20).

## Second-opinion reviews (Codex)

The owner's policy is that Codex never reviews automatically. It is asked, once, when a pull request calls for it.

**When to ask.** Only for a pull request whose issue carries `needs:codex-review`, or whose lane the lead plan-gated. Never for every pull request. Ask once per pull request, after the reader's findings are dealt with and the head is the one you expect to merge. Do not ask again after a fix unless the fix was itself substantial; there is no review loop.

**How to ask.** The lead posts one ordinary comment on the pull request (`POST repos/{o}/{r}/issues/{n}/comments`) whose first line is the Codex mention followed by the word `review`: `@codex review`. A footer added after it does no harm. Sessions act as the owner's account, which is linked to Codex, so this counts as the owner's manual request and draws on the owner's subscription. Never write that mention anywhere else (issue bodies, plans, commit messages, pull request descriptions): it triggers the app wherever it appears.

**How to tell it has finished.** Codex creates no check run. Within seconds `chatgpt-codex-connector[bot]` reacts to the request comment and posts a summary comment reading "Running"; that same comment is edited in place to "Completed" when it is done, usually within two minutes. Do not poll in a loop: schedule one check-back a few minutes ahead.

**Findings.** They arrive as a review from `chatgpt-codex-connector[bot]` with inline comments carrying a priority (P0, P1). They are ordinary review threads: they appear in `ccr/review_threads` and an unresolved one blocks the merge. Treat each like a reader finding: the lead verifies it, the worker fixes or answers it, and the thread is resolved only then. With no findings there is no review and no thread: only a thumbs-up reaction on the request, the summary comment reading Completed, and a short comment from the bot saying it found no major issues (verified). Decide whether findings are open from `ccr/review_threads`, not from the summary comment, whose own flag goes stale.

**When done,** remove `needs:codex-review` from the issue.

**Not available in a cloud session:** the `codex-code-review`, `codex-plan-review` and `codex-consult` skills, which run `codex-clean` with a login held on the owner's machine. That credential must never be placed in an environment variable or written by a setup script. A plan review by Codex is not available from a cloud session either: asked on an issue, the app only replies that the repository needs a Codex environment. Where a plan must have a Codex review, label the issue `needs:codex-review`, say on the issue that the plan is waiting for it, and escalate by the `needs:owner` route.

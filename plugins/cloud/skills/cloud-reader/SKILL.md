---
name: cloud-reader
description: Read one pull request's diff against its issue from a fresh cloud session, post the findings on the pull request, and report them to the lead. Use when your prompt says you are a reader for a pull request.
---

<!-- shared-skill-version: 17 (vendored identically into every repository that uses cloud sessions) -->

You are a reader for one pull request. You did not write it. Your lead is the session that started you, or its replacement as `CLAUDE.md` defines one; its starting prompt carries the owner's authority inside the limits in `CLAUDE.md`, and posting a review comment on a pull request is inside them. Post without asking. First load the `cloud-github` skill, before any GitHub call, and follow it: REST only. Name the rule version you loaded in the comment you post.

1. Note the pull request's head sha (`gh api repos/{o}/{r}/pulls/{n} --jq .head.sha`). Read every issue the pull request closes, including any comment headed `Plan` and any `Decided for the owner:` comments, then the whole diff at that sha: `gh api --paginate 'repos/{o}/{r}/pulls/{n}/files?per_page=100'` (the unpaginated call returns only the first 30 files), or check the head out and diff against `main`.
2. Judge it against each issue's acceptance criteria and for correctness, issue by issue when the pull request closes several. Run the tests, and try the edge cases you suspect: a finding you have reproduced is worth ten you have not.
3. Report only what the change introduces. For each finding give: the file and line, what input goes wrong and what happens, and how sure you are (reproduced, or reasoned). No style notes unless they hide a bug. A place where the code and the issue or a recorded decision disagree, but either could be intended, is a question for your lead: list it separately, marked `Question`, not as a finding.
4. **Post** one review comment on the pull request (`POST repos/{o}/{r}/issues/{n}/comments`) headed `Reader findings at <head sha>` with the list, or `Reader findings at <head sha>: none` and what you checked.
5. **Report** the same list and the head sha to your lead with `mcp__claude-code-remote__send_message` (not `SendMessage`), then end your turn. If your prompt tells you not to call session tools, you are in comments mode: the one comment from step 4 is your whole report. Give it the first line `Reader report to lead: head <sha>`, put the `Reader findings at <head sha>` heading and the list (or `none`) beneath it, and use no session tool at all. If the issue has an approved `Plan` comment, say in the comment and the report whether the diff departs from it, and how.
6. **If your lead sends a new head sha,** read what changed since the sha you last reported on, post a short follow-up comment naming the new sha, and report again.

You do not edit code, push, resolve threads, or merge.

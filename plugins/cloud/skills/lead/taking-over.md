<!-- shared-skill-version: 27 (delivered by the `cloud` plugin) -->

# Taking over a batch

Part of the `lead` skill, read only by the replacement lead of a batch another lead began, as `AGENTS.md` defines one.

Say that you are the replacement in your first comment on the tracking issue, then find where each lane stands before you start anything: the tracking issue (lanes comment, run log), each issue's labels and comments, each pull request's head, review threads and reader comments, and the earlier lead's children (`list_sessions`, by `parent_session_id`), which are yours as `AGENTS.md` allows a replacement lead.

- A reader's report on an earlier head still counts once you have checked the later merges of `main` as section 4 says. Start a reader only for a pull request that has none, or whose last report predates a fix; and a deep read where one was due and none was started.
- Send a fix to the lane's own worker, by a `Lead:` comment on its pull request and a `send_message` to wake it. If it will not act on your word, escalate.
- What the earlier lead did not record on the issue did not happen: decide an unrecorded decision again, and ask at Finish a question it escalated that has no answer recorded.

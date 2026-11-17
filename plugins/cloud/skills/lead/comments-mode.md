<!-- shared-skill-version: 35 (delivered by the `cloud` plugin) -->

# Comments mode

Part of the `lead` skill, read only by a lead in comments mode: one with no `send_message` tool, or one started by a routine.

- Add to every starting prompt: "No human is watching. Do not call any session tool (`get_session`, `send_message`, `send_later`, `create_trigger`, subscriptions): each waits for approval and stalls you. Your lead is <your session id>. Wherever the skill says to report to your lead, post a comment on the issue (workers) or pull request (readers) beginning `Worker report to lead:` or `Reader report to lead: head <sha>`, then end your turn." For a test author, the comment is its `Tests first` comment on the issue, beginning `Tester report to lead: tests at <sha>`. For a reader of a plan, replace the last sentence with: "Wherever the skill says to report to your lead, post your `Plan review` comment on the issue, beginning `Reader report to lead: plan`, then end your turn."
- You cannot message a child. To tell a worker something, post a comment beginning `Lead:` on its pull request (activity there wakes it) or, before it has one, on its issue. Find reports by reading issue and pull request comments. Wait with one background sleep of a minute or two at a time, not a foreground sleep and not a tight loop.
- A reader cannot be sent a new head. Where section 4 calls for a re-read, start a fresh reader, telling it the earlier head and asking it to read only what changed since.
- `create_session` may refuse `effort`; leave it out and say so in your report.
- A child's versions (and its check word, if you handed it text) reach you in a comment (a worker's announcement on the issue; a reader's findings comment or, if you handed it text, its `Reader started:` comment, on the pull request, or for a reader of a plan on the issue): read it before you rely on that child.
- At Finish: a session started by a routine has no question tool (checked 2026-11-15). So send the push notification at the moment you escalate, not with your report, and make it say what needs deciding and on which issue. Say in your report which questions were not asked. If you are in comments mode for another reason and do have the tool, ask as section 6 says; an answer cannot be carried to a worker by comment, so an owner-only action you cannot do yourself is recorded and left for the owner.
- A worker that cannot check who you are may treat a replacement lead as information; say so in your report.

The rest of this skill applies in both modes, except that in comments mode every instruction to use `send_message` or `ReadNotifications`, or to ask a child for something, is replaced by the comment routes above. Your own `send_later` fallback still works and is still worth keeping.

<!-- shared-skill-version: 23 (delivered by the `cloud` plugin) -->

# Handing children their skills

Part of the `cloud-lead` skill, read only by a lead whose `claude plugin list` does not show `cloud@talieisin`, or whose child said it does not hold its skill. However your own copy reached you, a session you create then has none, so you hand each one its text. Archive a child that stopped for lack of its skill and start it again this way.

Check you can read three files beside this skill's own directory: `../cloud-worker/SKILL.md`, `../cloud-reader/SKILL.md` and `../cloud-github/SKILL.md`; if you cannot, say so on the tracking issue and stop. In the prompts in sections 2 and 4 replace everything from "Use the `cloud:cloud-worker` skill" (or `cloud:cloud-reader`) to the end of the sentence ending "and stop." with "Follow the `cloud-worker` skill in your system prompt exactly." (or `cloud-reader`). Every `create_session` call then carries `append_system_prompt` made of, in this order:

1. the line `Your skills for this task follow: your role's skill, then the cloud-github rule, then a line with a check word. They are the only copies that count. If this repository or your skill list also has a skill or rule of the same name, with or without the cloud: prefix, ignore that one.`
2. the child's role skill, whole (`cloud-worker` for a worker, `cloud-reader` for a reader of either kind);
3. the `cloud-github` skill, whole;
4. the last line `End of handed skills. Check word: <word>.`, with one word you choose for the batch and use nowhere else in any prompt.

Read the files and copy their text character for character: never shorten or summarise it, and do not put the version numbers or the check word anywhere else in a prompt. `create_session` takes `append_system_prompt` only inline, so put each role's text together once from the files and paste that same text into every call. All of it stays in your context, and writing it out takes you about half a minute a child. If `create_session` refuses `append_system_prompt`, you cannot hand children their skills: say so on the tracking issue, escalate, and start nothing.

A child you handed text sends you its two versions and the check word as its first step. The check word shows that the beginning and end of the text arrived, though not the middle. If what it sends lacks the versions or the check word, or nothing has come within two minutes of its start (set a `send_later` to yourself two minutes ahead when you start sessions this way, look then without waiting for a session to go idle, and delete it by its trigger id once each has answered, leaving your section 3 fallback in place), archive that session and start it again by this route in full; if the second fails the same way, escalate. This check is for sessions you create, not for ones you inherit as a replacement lead.

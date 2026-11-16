# GraphQL and REST snippets for the local route

Verbatim queries and mutations the skill uses. Copy these whole — GitHub's GraphQL field names are picky and silent typos return empty results rather than errors.

All commands assume `gh` is authenticated. Variables passed with `-F` are typed (numbers stay numbers); strings use `-f`. The schema requires `owner` and `name` as strings, PR `number` as an int.

## 1. List unresolved review threads

Use at the start of Phase 3. Filter the response client-side to `isResolved: false`.

```bash
gh api graphql \
  -F owner="<owner>" \
  -F repo="<repo>" \
  -F pr="<num>" \
  -f query='
    query($owner:String!, $repo:String!, $pr:Int!, $cursor:String) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$pr) {
          reviewThreads(first:100, after:$cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              isResolved
              isOutdated
              path
              line
              comments(first:20) {
                nodes {
                  databaseId
                  author { login }
                  authorAssociation
                  body
                  path
                  line
                  createdAt
                  url
                  commit { oid }
                  replyTo { databaseId }
                }
              }
            }
          }
        }
      }
    }'
```

**Pagination**: when `pageInfo.hasNextPage` is true, re-run with `-F cursor=<endCursor>` (pass as `-f cursor=` since it's a string). Stop when `hasNextPage` is false.

**What to consume from the response**:

- `nodes[].id` — opaque thread node ID needed for `resolveReviewThread`.
- `nodes[].isResolved` — skip threads already resolved.
- `nodes[].isOutdated` — true means the line the thread anchors to no longer exists in HEAD. Usually safe to resolve with "outdated, addressed in current HEAD" if all comments below are old.
- `nodes[].comments.nodes[0]` — the top-level comment that started the thread. Use its `author.login`, `authorAssociation`, `body`, and `commit.oid` for classification.
- `nodes[].comments.nodes[]` (all) — full thread context for understanding prior back-and-forth.
- `nodes[].path` / `nodes[].line` — file + line the thread anchors to.

**Owner/repo extraction** — derive once at the start of Phase 3:

```bash
gh repo view --json owner,name --jq '{owner: .owner.login, repo: .name}'
```

## 2. Reply to a review thread (REST)

Posts a reply on an existing review-comment thread. Use the `databaseId` of any comment in the thread as the `<comment_id>`:

```bash
gh api -X POST \
  "repos/<owner>/<repo>/pulls/<num>/comments/<comment_id>/replies" \
  -f body="<reply text>"
```

Reply body conventions:

- Auto-applied trivial fix: `"Addressed in <short-sha>."`
- User-approved confirm fix: `"Done in <short-sha>."`
- Disagreement (user-approved wording only): whatever the user approved. Never silently send.
- Outdated thread: `"This is outdated — the relevant code was changed in <sha>. Resolving."`

## 3. Resolve a review thread

Only call this when:

1. The skill committed a fix that addresses the thread, OR
2. The user explicitly approved a reply-and-resolve for a disagreement, OR
3. The thread is outdated and a polite reply has been posted.

```bash
gh api graphql \
  -f threadId="<thread-node-id>" \
  -f query='
    mutation($threadId:ID!) {
      resolveReviewThread(input:{threadId:$threadId}) {
        thread {
          id
          isResolved
        }
      }
    }'
```

The mutation returns the thread with `isResolved: true` on success. If it returns `isResolved: false`, something is wrong — surface to user, don't retry blindly.

## 4. Check if all threads are resolved (Phase 4 gate)

Before merging, verify no thread has `isResolved: false`:

```bash
gh api graphql \
  -F owner="<owner>" \
  -F repo="<repo>" \
  -F pr="<num>" \
  -f query='
    query($owner:String!, $repo:String!, $pr:Int!) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$pr) {
          reviewThreads(first:100) {
            pageInfo { hasNextPage }
            nodes { isResolved }
          }
        }
      }
    }' \
  --jq '.data.repository.pullRequest.reviewThreads
        | if .pageInfo.hasNextPage then "UNKNOWN: more than 100 threads"
          else (.nodes | map(select(.isResolved == false)) | length) end'
```

The `--jq` filter returns the count of unresolved threads. `0` means safe to proceed to merge; any other number means loop back to Phase 3. **Anything that is not a number is not `0`**: `UNKNOWN` (an unresolved thread could sit past the first 100), an error, or empty output means the gate is unread — stop and say so, never merge on it. The count was read from the first page alone until 21 Sep, which let a thread on page 2 count as resolved.

## 5. Request a review from the reviewer bot

Two uses (Phase 2): the first-review timeout fires and the user opts to request one, or a fix push was non-trivial and needs a re-review (a bot does not re-review after a push unless the repository says it does).

```bash
gh pr edit <num> --add-reviewer <reviewer>
```

This is the only supported way to ask for a review. Do not comment `@copilot review` (or mention any coding agent) to ask: that asks the agent to work on the PR, not to review it. `POST /pulls/<n>/requested_reviewers` with the bot's name is not an alternative either: it returns an empty list and creates no timeline event.

`<reviewer>` is `BOT_REQUEST`'s reviewer: `@copilot` for Copilot, otherwise the discovered bot's login, verified by the timeline event it produces (`local.md`, "The reviewer bot is discovered") — the special value `gh` (2.98.0) documents for requesting a Copilot review, not supported on GitHub Enterprise Server. The review then posts under one of the bot's logins (`safety.md`).

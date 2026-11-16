#!/bin/bash
# discover-bot.sh <owner>/<repo> [limit]
#
# Phase 0 reviewer-bot discovery: prints the login of every account of type "Bot" that
# has submitted a review on the last <limit> merged PRs (default 5), one per line.
#
# Why this is a script file and not the inline loop the skill used to give: that loop
# puts `$(gh pr list ...)` inside a command that also invokes `gh`, which this machine's
# outbound-prompt hook blocks — correctly, since the rule it enforces followed a real
# credential disclosure. The fix is to move the shape, not to reword it.
#
# Why bash and not zsh: the workaround written under time pressure when this first
# failed used a shell array subscript inside double quotes, which is zsh syntax, and it
# failed silently on every iteration. One shell's behaviour is not the other's.
#
# `select(.user.type=="Bot")` is load-bearing. Collecting every review author instead
# would put a human reviewer — an external contributor especially — into BOT_LOGINS,
# which makes the watcher wait on the wrong person AND puts that human on the auto-apply
# trusted allowlist (references/safety.md).
#
# Prints nothing when no bot has reviewed a recent merged PR. That is not proof there is
# no bot: the skill also checks the PR in hand and its unfiltered timeline before
# concluding one way or the other.
#
# A FAILED QUERY MUST NOT LOOK LIKE "NO BOT". Empty output and exit 0 would let Phase 0
# conclude the repository has no reviewer bot and skip every review check, which is how a
# PR gets merged with a review outstanding. Any API failure therefore exits 3 with the
# reason on stderr, and the caller must treat 3 as "unknown", never as "none".
#
# Exit: 0 ran, output is authoritative · 2 usage · 3 a query failed, result unknown.
set -u

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
  echo "usage: discover-bot.sh <owner>/<repo> [limit]" >&2
  exit 2
fi
REPO="$1"
LIMIT="${2:-5}"

case "$REPO" in
  */*) ;;
  *) echo "discover-bot: repo must be <owner>/<repo>, got: $REPO" >&2; exit 2 ;;
esac
case "$LIMIT" in
  ''|*[!0-9]*) echo "discover-bot: limit must be digits, got: $LIMIT" >&2; exit 2 ;;
esac

# gate: a sample of recent merges by design; Phase 0 also reads this PR's own reviews and requests
if ! prs=$(gh pr list --repo "$REPO" --state merged --limit "$LIMIT" --json number --jq '.[].number' 2>&1); then
  echo "discover-bot: could not list merged PRs for $REPO:" >&2
  printf '%s\n' "$prs" >&2
  echo "Result is UNKNOWN, not 'no bot'." >&2
  exit 3
fi

# A per-PR failure is also unknown: one unreadable PR could be the only one the bot
# reviewed. Collect into a file so the loop's failures survive the pipeline.
out=$(mktemp) || exit 3
failed=0
for n in $prs; do
  # --paginate: REST returns 30 reviews per page, and a bot whose only review sits past
  # the first page would be missed — discovery would then report "no bot" from a complete
  # -looking answer to a partial question [E101].
  if logins=$(gh api --paginate "repos/$REPO/pulls/$n/reviews" \
                --jq '.[] | select(.user.type=="Bot") | .user.login' 2>&1); then
    [ -n "$logins" ] && printf '%s\n' "$logins" >> "$out"
  else
    echo "discover-bot: could not read reviews for PR $n:" >&2
    printf '%s\n' "$logins" >&2
    failed=1
  fi
done

sort -u "$out"
rm -f "$out"

if [ "$failed" -eq 1 ]; then
  echo "discover-bot: at least one PR could not be read; result is UNKNOWN, not 'no bot'." >&2
  exit 3
fi

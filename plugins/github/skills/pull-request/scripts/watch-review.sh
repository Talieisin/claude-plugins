#!/bin/bash
# watch-review.sh <owner>/<repo> <pr> <review-since> [review-target] [timeout-min]
#
# Phase 2 bot-review watcher. Prints exactly one outcome line and exits, so that
# silence can never be mistaken for waiting:
#
#   REVIEW ARRIVED <pr> <login> <submittedAt> <sha>   a matching review landed
#   PR NOT OPEN <pr> <state>                          the PR was merged or closed
#   TIMEOUT <pr> <minutes> since <review-since>       nothing arrived in time
#   QUERY FAILED <pr>                                 the PR could not be read at all
#
# <review-since> is REVIEW_SINCE, UTC, YYYY-MM-DDTHH:MM:SSZ. ISO-8601 UTC timestamps
# compare correctly as strings, which is why the jq comparison is a plain one. The
# timeout is measured from it too, so restarting this watcher does not restart the clock.
#
# <review-target> is REVIEW_TARGET, the full head SHA at the moment of an explicit
# request. Give it for a REQUESTED review: only a review on that commit satisfies the
# request, because a review of an earlier commit that was already in flight has not seen
# the fix. Omit it for a pending FIRST review, where any commit counts — the bot may post
# on the commit it started from, and a push does not clear the pending review.
#
# Extra logins can be added after the defaults with BOT_LOGINS, space-separated. The
# three defaults are the Copilot spellings: GitHub has more than one Copilot reviewer
# integration and REST, GraphQL and `gh pr view` do not agree on the suffix.
#
# Why this is a script file: the inline `until [ "$(gh pr view ...)" ]` loop the skill
# used to give is blocked by this machine's outbound-prompt hook, which is correct.
# Why bash: the first workaround used zsh array-subscript syntax inside double quotes,
# failed on every iteration, and sat silent for 18 minutes while the review it was
# waiting for had already arrived.
#
# Never drop the login filter. A reply to a review thread is recorded as a review on the
# head commit under the replier's login, so an unfiltered watcher fires on your own
# replies. The JSON path for a review's commit is `.commit.oid`, nested — not `.commitId`,
# which an earlier version of the skill used and which matched nothing, forever.
#
# Exit: 0 review arrived or PR left OPEN · 1 timed out · 2 usage · 3 the API could not be
#       read. 3 is not 1: a failing query leaves `hit` and `state` empty exactly as a
#       quiet PR does, so without it the watcher would sleep to the deadline and report
#       TIMEOUT for a question it never managed to ask [E101]. One transient failure is
#       tolerated and retried; two in a row is reported.
set -u

if [ $# -lt 3 ] || [ $# -gt 5 ]; then
  echo "usage: watch-review.sh <owner>/<repo> <pr> <review-since> [review-target] [timeout-min]" >&2
  exit 2
fi
REPO="$1"
PR="$2"
SINCE="$3"
TARGET="${4:-}"
TIMEOUT_MIN="${5:-20}"

case "$REPO" in */*) ;; *) echo "watch-review: repo must be <owner>/<repo>" >&2; exit 2 ;; esac
case "$PR" in ''|*[!0-9]*) echo "watch-review: pr must be digits, got: $PR" >&2; exit 2 ;; esac
case "$SINCE" in
  ????-??-??T??:??:??Z) ;;
  *) echo "watch-review: review-since must be YYYY-MM-DDTHH:MM:SSZ, got: $SINCE" >&2; exit 2 ;;
esac
if [ -n "$TARGET" ]; then
  # Length alone is not enough: TARGET is interpolated into the jq program below, so a
  # malformed 40-character value either breaks every poll or matches nothing and waits
  # out the whole timeout, reporting TIMEOUT for what is really invalid input.
  if [ "${#TARGET}" -ne 40 ]; then
    echo "watch-review: review-target must be a full 40-character SHA, got: $TARGET" >&2
    exit 2
  fi
  case "$TARGET" in
    *[!0-9a-f]*)
      echo "watch-review: review-target must be lowercase hex, got: $TARGET" >&2
      exit 2 ;;
  esac
fi
case "$TIMEOUT_MIN" in ''|*[!0-9]*) echo "watch-review: timeout-min must be digits" >&2; exit 2 ;; esac

DEFAULT_LOGINS='github-copilot[bot] copilot-pull-request-reviewer copilot-pull-request-reviewer[bot]'
LOGINS="$DEFAULT_LOGINS ${BOT_LOGINS:-}"

# Build the jq login list as a jq literal. Deliberately NOT a shell array: that is the
# construct whose zsh/bash difference caused the silent failure described above.
jq_logins=""
for l in $LOGINS; do
  [ -n "$l" ] || continue
  if [ -z "$jq_logins" ]; then jq_logins="\"$l\""; else jq_logins="$jq_logins,\"$l\""; fi
done

if [ -n "$TARGET" ]; then
  filter="[.reviews[] | select((.author.login | IN($jq_logins)) and .submittedAt > \"$SINCE\" and .commit.oid == \"$TARGET\")]"
else
  filter="[.reviews[] | select((.author.login | IN($jq_logins)) and .submittedAt > \"$SINCE\")]"
fi

# The deadline is TIMEOUT_MIN from REVIEW_SINCE, not from now. Starting the clock at
# script start would mean a watcher restarted 18 minutes into a wait gave the bot another
# full 20, and repeated restarts could postpone the timeout indefinitely — while the skill
# tells the user a 20-minute timeout applies from REVIEW_SINCE.
iso_to_epoch() {
  date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$1" +%s 2>/dev/null \
    || date -u -d "$1" +%s 2>/dev/null   # BSD (macOS) first, then GNU
}
since_epoch=$(iso_to_epoch "$SINCE")
if [ -z "$since_epoch" ]; then
  echo "watch-review: could not parse review-since: $SINCE" >&2
  exit 2
fi
deadline=$(( since_epoch + TIMEOUT_MIN * 60 ))

# Always poll at least once, and always before testing the deadline. A review that has
# already arrived is the answer whatever the clock says: reporting TIMEOUT for a review
# sitting in the API would send the caller to ask the user about a review it already has.
consecutive_errors=0
while :; do
  # Ask for the state and the reviews in ONE call, so a success tells us the query
  # worked and an empty review list means the review really is not there yet.
  # gate: validated on the next line; two failures in a row end as QUERY FAILED
  payload=$(gh pr view "$PR" --repo "$REPO" --json state,reviews 2>/dev/null)
  if [ -z "$payload" ] || ! printf '%s' "$payload" | jq -e 'has("state")' >/dev/null 2>&1; then
    consecutive_errors=$(( consecutive_errors + 1 ))
    if [ "$consecutive_errors" -ge 2 ]; then
      echo "QUERY FAILED $PR could not read the PR twice in a row; state unknown" >&2
      echo "QUERY FAILED $PR"
      exit 3
    fi
    sleep 30
    continue
  fi
  consecutive_errors=0

  # A jq failure here is a broken filter, not an absent review: left unchecked it would
  # loop quietly to TIMEOUT, the exact wrong answer this script exists to prevent.
  if ! hit=$(printf '%s' "$payload" | jq -r \
        "$filter | last | select(. != null) | \"\(.author.login) \(.submittedAt) \(.commit.oid)\""); then
    echo "QUERY FAILED $PR the review filter did not run; state unknown" >&2
    echo "QUERY FAILED $PR"
    exit 3
  fi
  if [ -n "$hit" ]; then
    echo "REVIEW ARRIVED $PR $hit"
    exit 0
  fi

  state=$(printf '%s' "$payload" | jq -r '.state')
  if [ -n "$state" ] && [ "$state" != "OPEN" ]; then
    echo "PR NOT OPEN $PR $state"
    exit 0
  fi

  [ "$(date -u +%s)" -lt "$deadline" ] || break
  sleep 30
done

echo "TIMEOUT $PR ${TIMEOUT_MIN}m since $SINCE${TARGET:+ for ${TARGET:0:7}}"
exit 1

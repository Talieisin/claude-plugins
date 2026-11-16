#!/bin/bash
# held-runs.sh <owner>/<repo> <pr>
#
# Lists the Actions runs on a PR's head that GitHub is holding for approval (status
# action_required). Called when mergeStateStatus is UNSTABLE, by Phase 4, so that the
# refusal says what is held, not only that the state is wrong. Read-only: it approves,
# deletes and re-runs nothing.
#
# Why it exists: held runs make a PR UNSTABLE with every required check green, and
# removing them can turn it CLEAN within seconds. Whether a held run should be approved,
# deleted or left is the user's call: a run with no jobs may be waiting for a real
# approval, since every held run has no jobs until approved.
#
# Output, one line each:
#   HEAD <sha>
#   HELD <run id> <workflow path> <event> actor=<login> triggered=<login> jobs=<n> <created>
#   HELD none                 (the query succeeded and nothing is held on this head)
# jobs is "?" when a run's jobs could not be read; the run is still listed.
#
# A FAILED QUERY MUST NOT READ AS "NOTHING HELD". Any failure to read the PR or its runs
# exits 3 with the reason on stderr, and the caller treats 3 as unknown, never as none.
#
# Exit: 0 ran, output is authoritative · 2 usage · 3 a query failed, result unknown.
set -u

if [ $# -ne 2 ]; then
  echo "usage: held-runs.sh <owner>/<repo> <pr>" >&2
  exit 2
fi
REPO="$1"
PR="$2"
case "$REPO" in
  */*) ;;
  *) echo "held-runs: repo must be <owner>/<repo>, got: $REPO" >&2; exit 2 ;;
esac
case "$PR" in
  ''|*[!0-9]*) echo "held-runs: PR number must be digits, got: $PR" >&2; exit 2 ;;
esac

if ! head=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq .headRefOid 2>&1) \
   || [ "${#head}" -ne 40 ]; then
  echo "held-runs: could not read the head of PR $PR in $REPO:" >&2
  printf '%s\n' "$head" >&2
  exit 3
fi
echo "HEAD $head"
# --paginate: a head with many runs spans pages, and a held run on a later page would be
# missed. The fields are validated below, so an empty or partial answer cannot pass for
# "none" (gh exits non-zero on an API error). They are joined by the ASCII unit separator,
# not a tab: read collapses adjacent whitespace separators, so an empty field would shift
# the ones after it. An empty path or event reads as "?", and any control character in
# a field (a newline, the separator itself) as "?", so one run stays one line.
if ! runs=$(gh api --paginate "repos/$REPO/actions/runs?head_sha=$head&status=action_required&per_page=100" \
              --jq '.workflow_runs[] | [.id, (.path // "" | if . == "" then "?" else . end), (.event // "" | if . == "" then "?" else . end), (.actor.login // "?"), (.triggering_actor.login // "?"), .created_at] | map(tostring | gsub("[\u0000-\u001f]"; "?")) | join("\u001f")' 2>&1); then
  echo "held-runs: could not list the runs on $head:" >&2
  printf '%s\n' "$runs" >&2
  echo "Result is UNKNOWN, not 'nothing held'." >&2
  exit 3
fi

if [ -z "$runs" ]; then
  echo "HELD none"
  exit 0
fi
printf '%s\n' "$runs" | while IFS="$(printf '\037')" read -r id path event actor trig created; do
  case "$id" in
    ''|*[!0-9]*) echo "held-runs: unexpected line from the runs query: $id $path" >&2; exit 3 ;;
  esac
  jobs=$(gh api "repos/$REPO/actions/runs/$id/jobs" --jq .total_count 2>/dev/null) || jobs="?"  # gate: a failed read prints jobs=?, never 0; total_count counts every job, not one page
  case "$jobs" in ''|*[!0-9]*) jobs="?" ;; esac
  echo "HELD $id $path $event actor=$actor triggered=$trig jobs=$jobs $created"
done || exit 3

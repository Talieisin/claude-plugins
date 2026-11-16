#!/usr/bin/env bash
# Creates the labels the `cloud` skills use. Run it once from a clone of the
# repository that will use them, with the GitHub CLI signed in:
#
#   bash labels.sh
#
# Safe to run again: --force updates a label that already exists.

set -euo pipefail

label() { gh label create "$1" --color "$2" --description "$3" --force; }

label "agent:ready"        "0e8a16" "Ready for a lead to take into a batch"
label "agent:claimed"      "fbca04" "A lead has put this issue in a lane"
label "agent:review"       "1d76db" "A pull request is open and being read"
label "agent:question"     "d93f0b" "A worker or reader has asked its lead a question"
label "needs:owner"        "b60205" "Waiting on the repository owner"
label "plan:required"      "5319e7" "The worker must post a plan and have it approved first"
label "review:deep"        "5319e7" "Give this issue's pull request a second, deeper read"
label "needs:codex-review" "c5def5" "Ask Codex for one review before merge (optional)"

# Only needed if you start leads from a label (docs/setup.md, optional part):
# label "lead:start" "0052cc" "Start a lead for the open agent:ready issues"

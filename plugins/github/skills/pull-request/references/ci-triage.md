# CI failure triage

How to diagnose a failed `gh pr checks --watch` and decide between auto-fix and confirm-with-user.

## 0. Infrastructure failures first

A job that failed within seconds, with no steps run or no logs, usually never started. Read the check run's annotations before looking for a code cause (for GitHub Actions, the job id at the end of the check's link is the check-run id):

```bash
gh api --paginate repos/<owner>/<repo>/check-runs/<job-id>/annotations --jq '.[] | {level: .annotation_level, message}'
```

| Annotation says | Class | Action |
|---|---|---|
| recent account payments have failed, spending limit, billing | **Infrastructure** | Surface to the user as a spending decision; no code change |
| quota, minutes used up, no runner available, runner lost | **Infrastructure** | Surface to the user; no code change |

A run that shows `action_required` is a third case: it is waiting for a person, not failing. **Read why it is waiting before deciding**, since GitHub uses this state for several gates: a push by a bot (including a coding agent woken by a comment) is the case seen here, and a person approving the run or a human push superseding that head clears it; an environment protection rule or an untrusted-workflow approval is a deliberate gate that has to be satisfied on its own terms, not waved through. Surface it either way, do not re-run.

After the user has resolved it, re-run the failed jobs once: `gh run rerun <run-id> --failed`. Do not push a commit just to re-trigger CI, and do not re-run before it is resolved. Inside an agent team, a lane reports the annotation to the lead and never re-runs; the lead re-runs.

## 1. Identify the failing job

```bash
gh pr checks <num> --json name,state,link \
  --jq '.[] | select(.state=="FAILURE")'
```

The `link` field looks like `https://github.com/<owner>/<repo>/actions/runs/<run-id>/job/<job-id>`. Extract `<run-id>` and fetch the failed logs:

```bash
gh run view <run-id> --log-failed
```

If output is huge, narrow to a specific job:

```bash
gh run view <run-id> --job <job-id> --log-failed
```

## 2. Classify trivial vs. substantive

| Signal in the log | Class | Action |
|---|---|---|
| `eslint --fix` / `prettier --write` would resolve it | Trivial | Auto-fix |
| `ruff format` / `black` would resolve it | Trivial | Auto-fix |
| Missing import / `NameError` for a symbol that exists nearby | Trivial | Auto-fix |
| `ModuleNotFoundError` for a package missing from `package.json` / `requirements.txt` | **Substantive** | Confirm — dep changes touch a forbidden class |
| Type error in product code | Substantive | Diagnose, propose fix, confirm |
| Test assertion failure (`AssertionError`, `expected X got Y`) | Substantive | Diagnose root cause |
| `Timeout` / flaky test | Substantive | Surface to user — may be flake, may be real |
| `denied: permission` / auth error | Substantive | Surface — likely CI config issue, not code |
| Lockfile out-of-sync | **Substantive** | Confirm — lockfiles are forbidden auto-fix |
| Coverage drop below threshold | Substantive | Surface — usually needs new tests |
| Snapshot test mismatch | Substantive | Confirm — sometimes "update snapshot" is right, sometimes the change is wrong |

The rule: if the fix is mechanically obvious AND doesn't touch a forbidden class (see `safety.md`), it's trivial. Otherwise confirm.

## 3. Common autofix patterns

After diagnosing trivial, apply the fix locally:

```bash
# JavaScript/TypeScript
pnpm prettier --write <paths>
pnpm eslint --fix <paths>
npm run lint -- --fix

# Python
ruff format <paths>
ruff check --fix <paths>
black <paths>

# Go
gofmt -w <paths>
go mod tidy   # only if go.mod is the issue AND user has explicitly OK'd dep changes
```

Then commit + push:

```bash
git add <paths>
git commit -m "fix: <tool> autofix from CI"
git push
```

Reply to user briefly ("CI flagged X; autofixed and re-pushed"), then loop back to Phase 2.

## 4. Substantive failures — diagnose template

When surfacing a substantive failure to the user, include:

1. **Job name** + failing step.
2. **Relevant log excerpt** (the error + 5–10 lines around it, not the whole log).
3. **Root cause hypothesis** in one sentence.
4. **Proposed fix** as a unified diff or file/line list.
5. **What's NOT being claimed** — e.g., "I haven't reproduced this locally" or "this could also be flake".

Wait for explicit user approval before editing. Never push a substantive fix without confirmation.

## 5. Repeated failures

If the same job fails twice after auto-fix attempts, stop auto-fixing — there's a deeper issue. Surface the pattern to the user and switch to the substantive flow.

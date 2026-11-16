#!/usr/bin/env bash
# Installs the tools pinned in mise.toml, exactly as mise.lock records them, and,
# when run as a Claude Code SessionStart hook, puts them first on PATH for the
# rest of the session. Safe to run twice. A cloud environment's setup script may
# call it too, so that a session starts with the tools already installed.
#
# It never fails the session and never changes mise.lock. It prints one line:
# either which tools are installed, or "TOOLS NOT PINNED" and why, so that
# whoever reads the output knows whether the pins are in force.

set -u
cd "$(dirname "$0")/.." || { echo "bootstrap-tools: TOOLS NOT PINNED. Cannot enter the repository."; exit 0; }

if ! command -v mise >/dev/null 2>&1; then
  echo "bootstrap-tools: TOOLS NOT PINNED. mise is not installed, so the tools already on PATH are in use."
  exit 0
fi

mise trust --quiet >/dev/null 2>&1 || true

# --locked: install only what mise.lock records. A version changed in mise.toml
# without `mise lock` fails here instead of rewriting the lockfile unreviewed.
# Only the tools this repository names: a laptop's global mise config has others
# that mise.lock rightly does not record.
tools="$(awk -F= '/^\[tools\]/{f=1;next} /^\[/{f=0} f && NF>1 {gsub(/[ "\047]/,"",$1); if ($1!="" && $1!~/^#/) print $1}' mise.toml | tr '\n' ' ')"
if [ -z "$tools" ]; then
  echo "bootstrap-tools: TOOLS NOT PINNED. No tools found in mise.toml."
  exit 0
fi
err="$(mktemp "${TMPDIR:-/tmp}/bootstrap-tools.XXXXXX")" || err=/dev/null
# shellcheck disable=SC2086
if ! mise install --locked $tools 2>"$err"; then
  echo "bootstrap-tools: TOOLS NOT PINNED. mise install --locked failed; see $err. Do not rely on tool versions in this session."
  exit 0
fi
[ "$err" = /dev/null ] || rm -f "$err"

mise reshim >/dev/null 2>&1 || true
shims="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}/shims"

# A SessionStart hook is given CLAUDE_ENV_FILE: what is appended to it is
# evaluated before each later Bash call in the session. The path is quoted with
# %q so that nothing in it is evaluated as shell.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  if [ ! -d "$shims" ]; then
    echo "bootstrap-tools: TOOLS NOT PINNED. Tools are installed but the shims directory was not found at $shims, so PATH is unchanged."
    exit 0
  fi
  line="$(printf 'export PATH=%q:"$PATH"' "$shims")"
  grep -qxF -- "$line" "$CLAUDE_ENV_FILE" 2>/dev/null || printf '%s\n' "$line" >> "$CLAUDE_ENV_FILE"
fi

summary=""
for t in $tools; do summary="$summary$t $(mise current "$t" 2>/dev/null | head -1); "; done
echo "bootstrap-tools: pinned tools installed ($summary) shims at $shims"

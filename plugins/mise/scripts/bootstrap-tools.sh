#!/usr/bin/env bash
# Installs the tools a repository pins with mise and puts them first on PATH for the
# rest of the session. Run by this plugin's SessionStart hook, in every session; a
# repository carries nothing but its own mise.toml (and, better, mise.lock).
#
# It never fails the session and never changes mise.toml or mise.lock. In a repository
# that does not use mise it prints nothing and exits. Otherwise it prints one line:
# which tools are installed, or "TOOLS NOT PINNED" and why, so that whoever reads the
# session's first lines knows whether the pins are in force.

set -u

dir="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$dir" 2>/dev/null || exit 0

config=""
for f in mise.toml .mise.toml; do
  [ -f "$f" ] && { config="$f"; break; }
done
[ -n "$config" ] || exit 0

if ! command -v mise >/dev/null 2>&1; then
  echo "mise-bootstrap: TOOLS NOT PINNED. This repository has $config but mise is not installed, so the tools already on PATH are in use."
  exit 0
fi

mise trust --quiet >/dev/null 2>&1 || true

# Only the tools this repository names: a laptop's global mise config has others
# that the repository's lockfile rightly does not record.
tools="$(awk -F= '/^\[tools\]/{f=1;next} /^\[/{f=0} f && NF>1 {gsub(/[ "\047]/,"",$1); if ($1!="" && $1!~/^#/) print $1}' "$config" | tr '\n' ' ')"
if [ -z "$tools" ]; then
  echo "mise-bootstrap: TOOLS NOT PINNED. No tools found under [tools] in $config."
  exit 0
fi

# With a lockfile, install only what it records: a version changed in mise.toml
# without `mise lock` fails here instead of rewriting the lockfile unreviewed.
# Without one, install what mise.toml asks for and say that nothing was verified.
locked="--locked"
note=""
if [ ! -f mise.lock ]; then
  locked=""
  note=" No mise.lock: versions come from $config alone and downloads were not checked against recorded checksums."
fi

err="$(mktemp "${TMPDIR:-/tmp}/mise-bootstrap.XXXXXX")" || err=/dev/null
# shellcheck disable=SC2086
if ! mise install $locked $tools 2>"$err"; then
  echo "mise-bootstrap: TOOLS NOT PINNED. mise install ${locked:-(no lockfile)} failed; see $err. Do not rely on tool versions in this session."
  exit 0
fi
[ "$err" = /dev/null ] || rm -f "$err"

mise reshim >/dev/null 2>&1 || true
shims="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}/shims"

# A SessionStart hook is given CLAUDE_ENV_FILE: what is appended to it is evaluated
# before each later Bash call in the session. The path is quoted with %q so that
# nothing in it is evaluated as shell.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  if [ ! -d "$shims" ]; then
    echo "mise-bootstrap: TOOLS NOT PINNED. Tools are installed but the shims directory was not found at $shims, so PATH is unchanged."
    exit 0
  fi
  line="$(printf 'export PATH=%q:"$PATH"' "$shims")"
  grep -qxF -- "$line" "$CLAUDE_ENV_FILE" 2>/dev/null || printf '%s\n' "$line" >> "$CLAUDE_ENV_FILE"
fi

summary=""
for t in $tools; do summary="$summary$t $(mise current "$t" 2>/dev/null | head -1); "; done
echo "mise-bootstrap: pinned tools installed ($summary) shims at $shims.$note"

#!/usr/bin/env bash
# Installs the tools a repository pins with mise and puts them first on PATH for the
# rest of the session. Run by this plugin's SessionStart hook, in every session; a
# repository carries nothing but its own mise.toml (and, better, mise.lock).
#
# It never fails the session. In a repository with neither mise.toml nor .mise.toml it
# prints nothing and exits. Otherwise it prints one line: which tools are installed, or
# "TOOLS NOT PINNED" and why, so that whoever reads the session's first lines knows
# whether the pins are in force.
#
# What it changes: nothing in the repository itself. It never edits the mise config, and
# if mise writes a mise.lock where there was none, it removes that file again. But it
# does run `mise install`, and mise then does whatever the repository's own config tells
# it to do on install (a [hooks] postinstall command, for instance). That config is
# trusted to the same degree as the rest of the repository the session is about to work
# in.

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

# `mise install` trusts the config it installs from, and a trusted config can run
# commands of its own. So this script acts only where that is acceptable: in a
# cloud session, which is a disposable machine holding a repository its owner
# chose to work in, or where the person has opted in with MISE_BOOTSTRAP_TRUST=1.
# Anywhere else it does nothing and prints nothing: on your own machine mise's
# shell activation already gives you the pinned tools in repositories you trust.
if [ -z "${CLAUDE_CODE_REMOTE:-}" ] && [ "${MISE_BOOTSTRAP_TRUST:-}" != 1 ]; then
  exit 0
fi
mise trust --quiet >/dev/null 2>&1 || true

# Only the tools this repository names: a laptop's global mise config has others
# that the repository's lockfile rightly does not record. mise itself says which tools
# come from a config file inside this repository, whatever form the file declares them
# in; the awk below is the fallback where python3 is missing, and reads only the plain
# `name = "version"` lines under [tools].
root="$(pwd -P)"
tools=()
if command -v python3 >/dev/null 2>&1; then
  while IFS= read -r t; do [ -n "$t" ] && tools+=("$t"); done < <(
    mise ls --current --json 2>/dev/null | ROOT="$root" python3 -c '
import json, os, sys
root = os.environ["ROOT"].rstrip("/") + "/"
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for name, entries in sorted(data.items()):
    for e in entries:
        path = os.path.realpath((e.get("source") or {}).get("path") or "")
        if path.startswith(root):
            print(name)
            break
' 2>/dev/null)
fi
if [ "${#tools[@]}" -eq 0 ]; then
  while IFS= read -r t; do [ -n "$t" ] && tools+=("$t"); done < <(
    awk -F= '/^\[tools\]/{f=1;next} /^\[/{f=0} f && NF>1 {gsub(/[ "\047]/,"",$1); if ($1!="" && $1!~/^#/) print $1}' "$config")
fi
if [ "${#tools[@]}" -eq 0 ]; then
  echo "mise-bootstrap: TOOLS NOT PINNED. No tools found in $config."
  exit 0
fi

# With a lockfile, install only what it records: a version changed in mise.toml
# without `mise lock` fails here instead of rewriting the lockfile unreviewed.
# Without one, install what mise.toml asks for and say that nothing was verified.
locked=(--locked)
had_lock=yes
note=""
if [ ! -f mise.lock ]; then
  locked=()
  had_lock=""
  note=" No mise.lock: versions come from $config alone and downloads were not checked against recorded checksums."
fi

err="$(mktemp "${TMPDIR:-/tmp}/mise-bootstrap.XXXXXX")" || err=/dev/null
mise install ${locked[@]+"${locked[@]}"} "${tools[@]}" 2>"$err"
status=$?
# mise may write a lockfile on install. Where the repository had none, put that back:
# a lockfile is the repository owner's to create and review.
[ -n "$had_lock" ] || rm -f mise.lock
if [ "$status" -ne 0 ]; then
  echo "mise-bootstrap: TOOLS NOT PINNED. mise install failed; see $err. Do not rely on tool versions in this session."
  exit 0
fi
[ "$err" = /dev/null ] || rm -f "$err"

if ! mise reshim >/dev/null 2>&1; then
  echo "mise-bootstrap: TOOLS NOT PINNED. Tools are installed but mise reshim failed, so PATH is unchanged."
  exit 0
fi
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
  if ! grep -qxF -- "$line" "$CLAUDE_ENV_FILE" 2>/dev/null; then
    if ! printf '%s\n' "$line" >> "$CLAUDE_ENV_FILE" 2>/dev/null; then
      echo "mise-bootstrap: TOOLS NOT PINNED. Tools are installed but the session's environment file could not be written, so PATH is unchanged."
      exit 0
    fi
  fi
fi

summary=""
for t in "${tools[@]}"; do summary="$summary$t $(mise current "$t" 2>/dev/null | head -1); "; done
echo "mise-bootstrap: pinned tools installed ($summary) shims at $shims.$note"

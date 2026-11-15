#!/usr/bin/env bash
# Prints the shared GitHub rule into a cloud session's context at start.
# A plugin cannot carry a .claude/rules file, so this stands in for one.
# Outside a cloud session it prints one line and nothing else, so that a
# laptop session is not handed a rule about a proxy it does not have.
set -u
root="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
echo "CLOUD_PLUGIN_LOADED talieisin cloud plugin $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/.claude-plugin/plugin.json" | head -1)"
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  cat "$root/rules/cloud-github.md"
fi

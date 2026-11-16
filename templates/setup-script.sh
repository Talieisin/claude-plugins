#!/bin/bash
# Setup script for a Claude Code cloud environment. Paste it into the
# environment's "Setup script" box (claude.ai/code, environment picker, the gear
# beside the environment, or "New environment").
#
# It installs the `cloud` plugin, so that every session in the environment holds
# the skills, however the session was started. It never fails the session: a
# line that goes wrong is recorded in the log and the script carries on.

LOG=/tmp/cloud-setup.log
claude plugin marketplace add Talieisin/claude-plugins >> "$LOG" 2>&1 || echo "marketplace add failed" >> "$LOG"
claude plugin install cloud@talieisin >> "$LOG" 2>&1 || echo "plugin install failed" >> "$LOG"
date -u +"SETUP_SCRIPT_RAN %FT%TZ" >> "$LOG"

# The environment caches the result of this script. After a new release of the
# plugin, change the line below and save the environment again, so that new
# sessions install the new version:
# refreshed: 2026-11-16

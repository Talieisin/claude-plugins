# Optional: pinned tool versions with mise

You do not need this to use the `cloud` skills. A cloud session already has
`git`, `gh`, `uv`, Python and Node, and most repositories work with those.

Use it when the repository must run on exact versions of its tools (the Python
or Node your lockfile was made with, say) and you already pin them with
[mise](https://mise.jdx.dev) on your own machines. A cloud session does not have
mise, and does not have your personal mise configuration, so the repository has
to carry its own pins and install them when a session starts.

Proven so far for Python and `uv`. Other tools (Node, Go, Rust, Terraform)
should work the same way but have not been tried.

## What to add

**1. In the repository**

- `mise.toml` with exact versions, not ranges:

  ```toml
  [tools]
  python = "3.13.18"
  uv = "0.13.8"
  ```

- `mise.lock`, made by running `mise lock` after any change to `mise.toml`.
  Commit it and review changes to it like code: it records where each tool is
  downloaded from and its checksum.
- `scripts/bootstrap-tools.sh`, copied from `scripts/bootstrap-tools.sh` in this
  folder. It installs only what `mise.lock` records, puts the tools first on
  `PATH` for the session, and prints one line saying whether the pins are in
  force. It never fails the session.
- A SessionStart hook in `.claude/settings.json` that runs it:

  ```json
  {
    "hooks": {
      "SessionStart": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/bootstrap-tools.sh\""
            }
          ]
        }
      ]
    }
  }
  ```

**2. In the cloud environment**

- Add this line to the setup script, before the plugin lines:

  ```bash
  curl -fsSL https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh || echo "mise install failed" >> "$LOG"
  ```

- Add these to the environment's allowed domains (Network access):

  ```
  mise.run
  mise.jdx.dev
  mise-versions.jdx.dev
  github.com
  *.githubusercontent.com
  tuf-repo-cdn.sigstore.dev
  ```

## How to tell it worked

The first lines of a new session show one of:

- `bootstrap-tools: pinned tools installed (python 3.13.18; uv 0.13.8; ) shims at ...`
  The pins are in force.
- `bootstrap-tools: TOOLS NOT PINNED. ...` with the reason. The session carries
  on with whatever tools the image has, so do not rely on versions in it.

## If you use something other than mise

The same shape works for any version manager: the repository carries the pins
and a script that installs them, a SessionStart hook runs the script and appends
an `export PATH=...` line to the file named by `CLAUDE_ENV_FILE`, and the
environment allows the domains the installer downloads from.

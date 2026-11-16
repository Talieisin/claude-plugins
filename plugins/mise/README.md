# `mise`: pinned tool versions in every session

Optional. You do not need this to use the `cloud` or `github` plugins: a cloud
session already has `git`, `gh`, `uv`, Python and Node, and most repositories
work with those.

Use it when your repositories must run on exact versions of their tools and you
already pin them with [mise](https://mise.jdx.dev). A cloud session has neither
mise nor your personal mise configuration. This plugin fills the gap: when a
session starts, it installs what the repository's own `mise.toml` names and puts
those tools first on `PATH`. A repository that has no `mise.toml` is left alone
and sees no output.

**This plugin runs code.** It has a SessionStart hook that runs one script,
[`scripts/bootstrap-tools.sh`](scripts/bootstrap-tools.sh), in every session.
Read the script before you install it. It installs only the tools the
repository's `mise.toml` lists, changes no file in the repository, and never
fails the session.

Proven so far for Python and `uv`. Other tools (Node, Go, Rust, Terraform)
should work the same way but have not been tried.

## Set-up

**1. The cloud environment.** Add to its setup script, before the plugin lines:

```bash
curl -fsSL https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh || echo "mise install failed" >> "$LOG"
```

and after them:

```bash
claude plugin install mise@talieisin >> "$LOG" 2>&1 || echo "mise plugin install failed" >> "$LOG"
```

Then add these to the environment's allowed domains (Network access):

```
mise.run
mise.jdx.dev
mise-versions.jdx.dev
github.com
*.githubusercontent.com
tuf-repo-cdn.sigstore.dev
```

**2. Each repository.** Nothing to copy. It needs only what it would have
anyway:

- `mise.toml` with exact versions, not ranges:

  ```toml
  [tools]
  python = "3.13.18"
  uv = "0.13.8"
  ```

- Better, a `mise.lock` as well, made by running `mise lock` after any change to
  `mise.toml`. Commit it and review changes to it like code: it records where
  each tool is downloaded from and its checksum. With a lockfile the plugin
  installs only what the lockfile records. Without one it installs what
  `mise.toml` asks for and says that nothing was checked.

## How to tell it worked

The first lines of a new session show one of:

- `mise-bootstrap: pinned tools installed (python 3.13.18; uv 0.13.8; ) shims at ...`
  The pins are in force. If the line ends "No mise.lock: ...", the versions came
  from `mise.toml` alone.
- `mise-bootstrap: TOOLS NOT PINNED. ...` with the reason. The session carries
  on with whatever tools the image has, so do not rely on versions in it.
- Nothing: the repository has no `mise.toml`.

## If you use something other than mise

The same shape works for any version manager: a script that installs the
repository's pins, a SessionStart hook that runs it and appends an
`export PATH=...` line to the file named by `CLAUDE_ENV_FILE`, and an
environment that allows the domains the installer downloads from.

# pi-iterm2-resize-metadata

A [Pi](https://pi.dev/) extension that preserves iTerm2 shell-integration metadata when Pi's regular-mode TUI redraws after a terminal resize.

This keeps iTerm2's contextual **Download with scp** action available on replayed remote file paths, including inside persistent tmux sessions.

## Why this exists

iTerm2 associates `RemoteHost` and `CurrentDir` metadata with terminal lines. In regular TUI mode, Pi clears the viewport and scrollback and then replays its transcript when the terminal width or height changes. The replayed lines normally lose that metadata.

This extension inserts fresh iTerm2 OSC 1337 metadata immediately after Pi's full-redraw clear sequence and before transcript replay.

## Requirements

- Pi with extension support (tested with Pi 1.0.4)
- iTerm2
- Pi's regular TUI mode
- A remote connection for which iTerm2 can perform SCP downloads
- For the best upload experience, an iTerm2 SSH Integration connection such as `it2ssh` or an SSH profile with SSH Integration enabled

## Install

From GitHub:

```bash
pi install git:github.com/JackCA/pi-iterm2-resize-metadata@v0.1.0
```

For local development:

```bash
git clone https://github.com/JackCA/pi-iterm2-resize-metadata.git
pi install ./pi-iterm2-resize-metadata
```

Restart Pi or run `/reload` after installation.

If you previously installed a standalone copy of the extension under `~/.pi/agent/extensions/`, remove it before installing this package to avoid loading both copies.

## Configure the remote shell

The hostname reported to iTerm2 should normally match the SSH destination or alias used to establish the integrated connection. For zsh:

```zsh
export ITERM_ENABLE_SHELL_INTEGRATION_WITH_TMUX=1
export iterm2_hostname=my-ssh-alias

test -e "${HOME}/.iterm2_shell_integration.zsh" &&
  source "${HOME}/.iterm2_shell_integration.zsh" || true
```

Set these before starting or attaching to the persistent tmux/Pi process.

The extension activates automatically when `iterm2_hostname` is present, or when it detects both a direct iTerm2 environment and a remote SSH environment.

### Environment variables

| Variable | Values | Purpose |
|---|---|---|
| `PI_ITERM2_METADATA` | `auto`, `always`, `off` | Activation mode; default is `auto` |
| `PI_ITERM2_HOST` | hostname or SSH alias | Overrides `iterm2_hostname` and the system hostname |
| `PI_ITERM2_USER` | remote username | Overrides `USER` and `LOGNAME` |

Example explicit configuration:

```zsh
export PI_ITERM2_METADATA=always
export PI_ITERM2_HOST=my-ssh-alias
export PI_ITERM2_USER="$USER"
```

## Commands

- `/iterm-metadata-refresh` — emit metadata immediately for subsequent output
- `/iterm-metadata-status` — show activation, target identity, and redraw count
- `/iterm-scp-refresh` — compatibility alias for the refresh command

## Using contextual downloads

1. Have Pi print a raw remote path on one terminal line.
2. Select the complete path in iTerm2.
3. Right-click and choose **Download with scp**.

Paths that visually wrap onto multiple hard terminal rows may not be accepted by iTerm2. Widen the pane, print a shorter relative path, or create a short temporary symlink.

## How it works

The extension wraps `process.stdout.write` only during an interactive Pi session. For string writes, it looks for Pi's regular-mode full-redraw sequence:

```text
ESC [ 2 J  ESC [ H  ESC [ 3 J
```

It inserts:

```text
OSC 1337;RemoteHost=user@host BEL
OSC 1337;CurrentDir=/working/directory BEL
```

The matcher handles a redraw sequence split across adjacent writes. Nonmatching writes are passed through unchanged, binary writes reset the matcher, and the wrapper is disabled and removed during session shutdown.

There are no timers, background processes, network requests, clipboard reads, or file transfers.

## Limitations

- Pi does not currently expose an official pre-render or terminal-preamble extension hook. The narrowly scoped `stdout.write` wrapper is therefore an implementation workaround.
- A future Pi renderer could change the redraw sequence. In that case the extension fails open: terminal output continues normally, but metadata will not be restored automatically.
- This fixes metadata loss; it does not change iTerm2's requirement that the selected SCP path occupy one terminal line.
- The extension enables metadata. iTerm2 still controls authentication and the actual SCP transfer.

## Development

Install the pinned development tools and Git hooks:

```bash
npm install
npm run hooks:install
```

Run the same checks used by CI and the pre-commit hook:

```bash
npm run lint
npm run typecheck
npm test
```

Inspect the publishable package:

```bash
npm run pack:check
```

The repository uses the same strict Biome 2.5.7 rules, TypeScript settings, and Lefthook structure as Angel2. The pre-commit hook checks staged files with Biome and type-checks the working tree, Commitlint validates commit messages, the pre-push hook runs the complete quality suite, and the post-merge hook refreshes dependencies from the lockfile.

Release Please derives versions from Conventional Commits, maintains a release pull request, and creates immutable `vX.Y.Z` tags and GitHub Releases after that pull request is merged. See [PUBLISHING.md](PUBLISHING.md).

The tests cover configuration resolution, OSC sanitization, complete and split redraw markers, repeated markers, and matcher reset behavior.

## Security

Pi extensions execute with Pi's operating-system permissions. Review extension source before installation. This extension emits the current username, configured hostname, and Pi working directory to the attached terminal. See [SECURITY.md](SECURITY.md).

## License

MIT

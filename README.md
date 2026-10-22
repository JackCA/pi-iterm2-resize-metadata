# pi-iterm2-resize-metadata

A [Pi](https://pi.dev/) extension that preserves [iTerm2 Shell Integration](https://iterm2.com/documentation-shell-integration.html) metadata when Pi's regular-mode TUI redraws after a terminal resize.

This keeps iTerm2's contextual [**Download with scp**](https://iterm2.com/documentation-shell-integration.html#download-with-scp) action available on replayed remote file paths, including inside persistent [tmux Integration](https://iterm2.com/documentation-tmux-integration.html) sessions.

## Why this exists

iTerm2 associates `RemoteHost` and `CurrentDir` metadata with terminal lines. In regular TUI mode, Pi clears the viewport and scrollback and then replays its transcript when the terminal width or height changes. The replayed lines normally lose that metadata.

This extension inserts fresh [iTerm2 OSC 1337 metadata](https://iterm2.com/documentation-escape-codes.html) immediately after Pi's full-redraw clear sequence and before transcript replay.

## Requirements

- Pi with extension support (tested with Pi 1.0.4)
- [iTerm2](https://iterm2.com/)
- Pi's regular TUI mode
- A remote connection for which iTerm2 can perform SCP downloads
- For the best upload experience, an [iTerm2 SSH Integration](https://iterm2.com/documentation-preferences-profiles-general.html) connection such as `it2ssh` or an SSH profile with SSH Integration enabled

## Install

From the Pi package gallery/npm:

```bash
pi install npm:pi-iterm2-resize-metadata
```

From an immutable GitHub release:

```bash
pi install git:github.com/JackCA/pi-iterm2-resize-metadata@v0.2.0
```

For local development:

```bash
git clone https://github.com/JackCA/pi-iterm2-resize-metadata.git
pi install ./pi-iterm2-resize-metadata
```

Restart Pi or run `/reload` after installation.

## Configure the remote shell

The hostname reported to iTerm2 should normally match the SSH destination or alias used to establish the integrated connection. For zsh:

```zsh
export ITERM_ENABLE_SHELL_INTEGRATION_WITH_TMUX=1
export iterm2_hostname=my-ssh-alias

test -e "${HOME}/.iterm2_shell_integration.zsh" &&
  source "${HOME}/.iterm2_shell_integration.zsh" || true
```

Set these before starting or attaching to the persistent tmux/Pi process. iTerm2 documents this tmux opt-in under [Shell Integration limitations](https://iterm2.com/documentation-shell-integration.html#limitations).

The extension activates automatically when `iterm2_hostname` is present, or when it detects both a direct iTerm2 environment and a remote SSH environment.

### Environment variables

| Variable | Values | Purpose |
|---|---|---|
| `PI_ITERM2_METADATA` | `auto`, `always`, `off` | Activation mode; default is `auto` |
| `PI_ITERM2_HOST` | hostname or SSH alias | Overrides `iterm2_hostname` and the system hostname |
| `PI_ITERM2_USER` | remote username | Overrides `USER` and `LOGNAME` |
| `PI_ITERM2_CURRENT_DIR_MODE` | `cwd-tmp`, `cwd` | Advertised iTerm2 directory; default is `cwd-tmp` |

Example explicit configuration:

```zsh
export PI_ITERM2_METADATA=always
export PI_ITERM2_HOST=my-ssh-alias
export PI_ITERM2_USER="$USER"
```

### Keeping iTerm2 uploads out of the project root

iTerm2's **Upload and Paste Path** action always uploads to the session's advertised `CurrentDir`;
it has no separate upload-destination setting. By default, this extension creates `<Pi cwd>/tmp`
and advertises that directory to iTerm2, so dropped files and pasted screenshots do not accumulate
at the project root.

Add `tmp/` to each project's Git ignore rules if it is not already ignored. This repository includes
that rule. The extension does not modify other repositories' ignore configuration.

To restore the original behavior and advertise Pi's exact working directory, set this before
starting Pi:

```zsh
export PI_ITERM2_CURRENT_DIR_MODE=cwd
```

Because iTerm2 has only one `CurrentDir` value, the default also makes relative **Download with
scp** paths and other iTerm2 directory-aware features resolve against `<cwd>/tmp`. Absolute remote
paths are unaffected. `/iterm-metadata-status` reports both the selected mode and advertised
directory.

### Terminal capability diagnostics

#### OSC 8 hyperlinks

iTerm2 tmux Integration uses a control-mode client (`tmux -CC`). That client may leave
`client_termfeatures` empty, so Pi conservatively disables OSC 8 links even though iTerm2 can
render them. The extension detects this specific mismatch and shows one actionable warning per
load. It never changes Pi or tmux settings automatically.

First confirm that OSC 8 reaches iTerm2 through the complete terminal path by running this in a
normal shell inside the same tmux session:

```bash
printf '\033]8;;https://example.com\007OSC 8 TEST\033]8;;\007\n'
```

If Command-clicking `OSC 8 TEST` opens the browser, enable hyperlinks in Pi's user settings and run
`/reload`:

```json
{
  "terminal": {
    "hyperlinks": true
  }
}
```

The diagnostic respects Pi's `terminal.hyperlinks` setting, `PI_HYPERLINKS`, trusted project
settings, and native tmux `hyperlinks` client features.

#### Inline images

Pi automatically selects the native iTerm2 image protocol in a direct iTerm2 session, but its
conservative tmux detection disables inline images before inspecting the outer client. When the
extension detects iTerm2 tmux Integration while Pi image display is enabled but not using the
`iterm2` protocol, it includes the mismatch in `/iterm-metadata-status` and shows one actionable
warning per load.

After confirming that native iTerm2 images work through the complete SSH and `tmux -CC` path,
enable them in Pi's user settings and run `/reload`:

```json
{
  "terminal": {
    "images": "iterm2"
  }
}
```

The diagnostic follows Pi's precedence for trusted `terminal.images` settings,
`PI_IMAGE_PROTOCOL`, and automatic environment detection. It also respects
`terminal.showImages=false` as an intentional choice and does not warn in that case. An attached
terminal without iTerm2's native image protocol may show blank reserved rows; one Pi process cannot
emit different image protocols to multiple clients attached to the same tmux pane.

A healthy iTerm2 control-mode session reports:

```text
path=tmux-control; hyperlinks=enabled; images=iterm2; show-images=enabled; tmux-features=unadvertised
```

`tmux-features=unadvertised` is expected for `tmux -CC`; it means the client did not publish a
feature list, not that iTerm2 lacks those features. Explicit Pi settings close the control-mode
detection gaps, so this healthy state does not produce a warning.

## Commands

- `/iterm-metadata-refresh` — emit metadata immediately for subsequent output
- `/iterm-metadata-status` — show activation, identity, advertised directory, redraw count, terminal path, hyperlinks, and image state
- `/iterm-scp-refresh` — compatibility alias for the refresh command

## Using contextual downloads

1. Have Pi print a raw remote path on one terminal line.
2. Select the complete path in iTerm2.
3. Right-click and choose [**Download with scp**](https://iterm2.com/documentation-shell-integration.html#download-with-scp).

Paths that visually wrap onto multiple hard terminal rows may not be accepted by iTerm2. Widen the pane, print a shorter relative path, or create a short temporary symlink.

## How it works

The extension wraps `process.stdout.write` only during an interactive Pi session. For string writes, it looks for Pi's regular-mode full-redraw sequence:

```text
ESC [ 2 J  ESC [ H  ESC [ 3 J
```

It inserts:

```text
OSC 1337;RemoteHost=user@host BEL
OSC 1337;CurrentDir=/working/directory/tmp BEL
```

The matcher handles a redraw sequence split across adjacent writes. Nonmatching writes are passed through unchanged, binary writes reset the matcher, and the wrapper is disabled and removed during session shutdown.

For diagnostics, the extension reads Pi's terminal capability settings from user settings and
trusted project settings and runs a bounded `tmux display-message` query when inside tmux. In the
default `cwd-tmp` mode it also creates `<cwd>/tmp` when an enabled interactive session starts. There
are no timers, background processes, network requests, clipboard reads, or file transfers.

## Limitations

- Pi does not currently expose an official pre-render or terminal-preamble extension hook. The narrowly scoped `stdout.write` wrapper is therefore an implementation workaround.
- A future Pi renderer could change the redraw sequence. In that case the extension fails open: terminal output continues normally, but metadata will not be restored automatically.
- This fixes metadata loss; it does not change iTerm2's requirement that the selected SCP path occupy one terminal line.
- The extension enables metadata. iTerm2 still controls authentication and the actual SCP transfer.
- The default `cwd-tmp` mode changes all iTerm2 features that use `CurrentDir`, not only uploads. Use absolute paths or set `PI_ITERM2_CURRENT_DIR_MODE=cwd` when exact relative-path resolution is more important.
- With remote-host and current-directory metadata active, iTerm2 Semantic History may treat ordinary words as possible relative remote paths while Command is held. This is separate from OSC 8 linking and is the trade-off that enables contextual SCP actions.

## Development

Install the pinned development tools and Git hooks:

```bash
npm install
npm run hooks:install
```

Run the same checks used by CI and the pre-commit hook:

```bash
npm run check
```

Inspect the publishable package:

```bash
npm run pack:check
```

The repository uses the same strict Biome 2.5.7 rules, TypeScript settings, and Lefthook structure as Angel2. The pre-commit hook checks staged files with Biome and type-checks the working tree, Commitlint validates commit messages, the pre-push hook runs the complete quality suite, and the post-merge hook refreshes dependencies from the lockfile.

Release Please derives versions from Conventional Commits, maintains a release pull request, and creates immutable `vX.Y.Z` tags and GitHub Releases after that pull request is merged. See [PUBLISHING.md](PUBLISHING.md).

The tests cover configuration and metadata-directory resolution, OSC sanitization, iTerm2/tmux hyperlink and image diagnostics, complete and split redraw markers, repeated markers, and matcher reset behavior.

## Repository-scoped GitHub access

For maintainers who run Pi inside this checkout, the committed `.envrc` optionally loads a gitignored `.env.local`:

```bash
cp .env.local.example .env.local
chmod 600 .env.local
$EDITOR .env.local
direnv allow
```

Use a fine-grained `GH_TOKEN` restricted to this repository. Start Pi from this directory after direnv loads the environment. Never commit `.env.local` or reuse the local agent token as the Release Please workflow token.

## Security

Pi extensions execute with Pi's operating-system permissions. Review extension source before installation. This extension emits the current username, configured hostname, and either `<cwd>/tmp` or the Pi working directory to the attached terminal. See [SECURITY.md](SECURITY.md).

## License

MIT

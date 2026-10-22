# Security

This extension runs inside Pi with the same operating-system permissions as Pi.
Review extension source before installation.

The extension does not read the clipboard, open sockets, transfer files, or send
telemetry. It emits the current username, configured host, and an advertised
directory to the attached terminal using iTerm2 OSC 1337 metadata sequences. By
default, it creates and advertises `<Pi cwd>/tmp`; `PI_ITERM2_CURRENT_DIR_MODE=cwd`
restores the exact Pi working directory. The extension does not modify Git ignore
configuration or delete uploaded files. For local diagnostics, it reads Pi's user
settings and trusted project settings and runs a bounded `tmux display-message`
query when inside tmux.

To report a vulnerability, open a private security advisory in the GitHub
repository rather than a public issue.

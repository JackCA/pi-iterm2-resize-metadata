# Security

This extension runs inside Pi with the same operating-system permissions as Pi.
Review extension source before installation.

The extension does not read the clipboard, open sockets, transfer files, or send
telemetry. It emits the current username, configured host, and Pi working
directory to the attached terminal using iTerm2 OSC 1337 metadata sequences.

To report a vulnerability, open a private security advisory in the GitHub
repository rather than a public issue.

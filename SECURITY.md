# Security policy

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private vulnerability reporting on this
repository (Security tab, "Report a vulnerability"), or email contact@websync.in with the
subject "Security: <package name>".

Include the package and version, the input that triggers the problem, and what you expected.
You'll get an acknowledgement within 7 days. Fixes are released as patch versions and
credited in the changelog unless you prefer otherwise.

## Supported versions

The latest minor release of each package receives security fixes.

## Scope

In scope: incorrect results that could cause a security decision to go wrong (for example a
grader passing a header that browsers would not enforce), crashes or excessive CPU or memory on
crafted input, and anything in a CLI that reaches beyond the URL or file the user supplied.

The design rules each package follows are in
[docs/ecosystem/SECURITY-MODEL.md](docs/ecosystem/SECURITY-MODEL.md).

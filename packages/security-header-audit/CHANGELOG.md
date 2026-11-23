# Changelog

All notable changes to `security-header-audit` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `analyzeHeaders()` grading seven checks: Strict-Transport-Security, Content-Security-Policy,
  X-Content-Type-Options, clickjacking protection (X-Frame-Options or CSP `frame-ancestors`),
  Referrer-Policy, Permissions-Policy and Server/X-Powered-By disclosure. Extracted from the
  Security Header Checker on websync.in, with the same rules, score and messages.
- Accepts a fetch `Headers` object, Node-style header objects (array values included), plain
  objects in any letter case, or `[name, value]` pairs.
- `rating` on the result: `strong`, `needs-work` or `weak`.
- `normalizeHeaders()` and `parseRawHeaders()` (reads `curl -sI` / `curl -sIL` output).
- `security-header-audit` CLI with `--json`, `--min-score`, `--raw` and `--timeout`.

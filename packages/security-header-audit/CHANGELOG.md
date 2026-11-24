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
- The CSP check requires the policy to restrict scripts: a policy with no `script-src` or
  `default-src`, or whose script sources allow any host (`*`, `https:`, `http:` or a `*` host,
  without `'strict-dynamic'`), gets the same 5-point `csp-unsafe` warning as `'unsafe-inline'`,
  with the reason (CSP Level 3 s6.1.10, s6.7.2.8, s8.2).
- Clickjacking protection fails (`clickjack-invalid`) when CSP `frame-ancestors` allows any
  origin (`*`, `https:`, `http:` or a `*` host): only `'none'`, `'self'` or specific origins
  restrict framing, and browsers ignore X-Frame-Options whenever `frame-ancestors` is present
  (CSP Level 3 s6.4.2, s6.4.2.2).
- Server disclosure counts only a `Server` value that names a version (`nginx/1.18.0`,
  `Apache/2.4.41`); a product name alone (`Server: cloudflare`) passes. `X-Powered-By` is still
  flagged whenever it's sent (OWASP HTTP Headers Cheat Sheet).
- Accepts a fetch `Headers` object, Node-style header objects (array values included), plain
  objects in any letter case, or `[name, value]` pairs.
- `rating` on the result: `strong`, `needs-work` or `weak`.
- `normalizeHeaders()` and `parseRawHeaders()` (reads `curl -sI` / `curl -sIL` output).
- `security-header-audit` CLI with `--json`, `--min-score`, `--raw` (capped at 1 MB) and
  `--timeout`.

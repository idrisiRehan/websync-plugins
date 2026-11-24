# Changelog

All notable changes to `redirect-inspector` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `inspectRedirects()`: follows a redirect chain one hop at a time with `redirect: "manual"`,
  recording each hop's status, `Location` and timing. Options for the hop limit (default 10,
  Google's crawler limit), a per-request timeout, `User-Agent`, `GET` or `HEAD`, and an
  injectable `fetch`.
- 13 rules with stable ids, citing RFC 9110: request failures, missing, invalid, non-http and
  conflicting `Location` headers (relative values are resolved, not flagged), redirect loops, too many
  hops, HTTPS downgrades, final 4xx/5xx and unfollowed 3xx statuses, temporary redirects,
  chains of more than one redirect, and HTTP that never reaches HTTPS.
- `createFetcher()`: the bounded GET client shared by store-check, feed-page-check and
  ai-crawler-log. A request budget, a timeout on each request, redirects followed one hop at a
  time (at most 5 by default, http and https only, loops refused), 2xx bodies read up to a byte
  cap while they stream (after HTTP decompression), other bodies cancelled, optional hop caching
  (shared only between gets with the same `read` function and options) and one-line errors.
  `Location` headers are read like `inspectRedirects()` reads them: raw UTF-8 decoded, and
  several different targets refused.
- `redirect-inspector` CLI for one or more URLs, with `--expect`, `--map` for redirect maps
  (checked four at a time), `--json`, `--max-hops`, `--timeout` and `--method`.

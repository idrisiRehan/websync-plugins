# ADR 0008: One shared fetcher in redirect-inspector

- Status: accepted
- Date: 2026-11-24

## Context

Three packages fetch URLs they don't control: `store-check` (a store's files and pages),
`feed-page-check` (the landing pages linked from a feed) and `ai-crawler-log` (operators'
published IP lists). Each needs the same safety: a request budget, a timeout on every
request, redirects followed one hop at a time and counted, non-http(s) and looping redirects
refused, bodies read only up to a byte cap while they stream (after decompression), unneeded
bodies cancelled, and one-line error messages. Each had grown its own copy, and the copies
had already drifted (for example in how a raw UTF-8 `Location` header was read).

## Decision

- `redirect-inspector`, the repository's network library, owns `createFetcher()`
  (`src/fetcher.ts`), exported as a documented building block with its own tests (budgets,
  timeouts, slow and stalled bodies, gzip and brotli bombs, redirect loops, concurrent gets,
  per-reader hop caching).
- `inspectRedirects()` and the three packages above use it, and share its `Location`
  handling (`decodeLocation()`, `locationTargets()`) and `REDIRECT_STATUSES`.
- Text decoding stays with the callers, because their formats differ (HTML charsets, gzip
  sitemaps, JSON lists).

## Consequences

- A safety fix in the fetcher reaches every networked package at once.
- `store-check`, `feed-page-check` and `ai-crawler-log` depend on `redirect-inspector`, which
  must be published first.
- The fetcher's options and record shape are public API of `redirect-inspector`.

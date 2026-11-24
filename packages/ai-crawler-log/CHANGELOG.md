# Changelog

All notable changes to `ai-crawler-log` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `createLogAnalyzer()`: reads access log lines one at a time with bounded memory and reports,
  per crawler, requests, verified, spoofed and unverified counts, 2xx to 5xx status classes,
  bytes, first and last seen, product page requests (Shopify `/products/` and WooCommerce
  `/product/` by default, or your own patterns), robots.txt, llms.txt and sitemap requests, and
  top paths, top product pages and top error paths, counted with the Space-Saving algorithm
  (1,000 counters each, exact below that). Requests from everything else are totalled.
- `parseLogLine()` for NCSA Common and Combined (Apache and nginx, with both servers' escapes)
  and JSON lines from Cloudflare Logpush, Caddy's structured access log and nginx JSON log
  formats. Unreadable lines are counted, never thrown.
- IP verification against the lists operators publish: `IpRangeSet`, `verifyIp()` (IPv4, IPv6
  and IPv4-mapped IPv6 with exact prefix arithmetic) and `parseRangeFile()`, which reads the
  JSON lists and Amazon's HTML pages. Crawlers whose operators publish no list are reported as
  unverifiable, never as spoofed.
- The crawler table: robots-txt-lint's AI crawlers that send a user agent, plus Googlebot and
  Applebot as a search engine baseline, each user agent and list URL checked on the operator's
  page on 2026-11-24.
- `reportHighlights()`: plain-language sentences about spoofed requests, errors, product pages,
  llms.txt and unverifiable crawlers.
- `ai-crawler-log` CLI: streams files and stdin, plain or gzipped (multi-member too), fetches the
  15 published IP lists (timeout and 4 MiB cap each) or reads them from a `--dump-ranges` file,
  prints a table, highlights and top paths or `--json`, and exits 1 when requests were spoofed.
  Client addresses are never printed; `--show-networks` adds the /24 or /48 networks of spoofed
  requests.

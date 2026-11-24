# Changelog

All notable changes to `robots-txt-lint` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `lintRobotsTxt()` with 15 rules from RFC 9309, Google's robots.txt documentation and Google's
  open-source parser (all checked 2026-11-24): HTML served as robots.txt, files over 500 KiB, a
  file outside `/robots.txt`, unparseable lines, a missing colon, misspelled and unsupported
  fields (with Google's accepted typos as warnings), rules before any `User-agent` line, invalid
  user-agent values, paths that can't match, invalid sitemap URLs, duplicate groups, `Allow` and
  `Disallow` for the same path, `Disallow: /` for all crawlers, and CSS or JavaScript blocked for
  Googlebot. Each finding has a rule id, a line and a fix.
- Parsed groups (`agents`, `line`, `rules`) and sitemaps in every lint result.
- `isAllowed()`, which applies RFC 9309 matching (group selection and merging, longest match,
  `Allow` wins ties, `*` and `$`, percent-encoding normalisation, `/robots.txt` always allowed) and
  returns the rule and groups that decided.
- `aiCrawlerReport()` and the `AI_CRAWLERS` table: 21 AI crawler tokens from 10 operators, each
  with its operator's documentation URL and the date it was checked.
- `robots-txt-lint` CLI for files, stdin and URLs (a bare origin fetches `/robots.txt`, 4xx is
  reported as "no file, crawl everything" per RFC 9309, 5xx exits 2, a 1 MiB read cap), with
  `--test`, `--user-agent`, `--ai`, `--json`, `--max-warnings` and `--timeout`.

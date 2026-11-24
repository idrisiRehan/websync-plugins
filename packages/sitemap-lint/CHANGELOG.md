# Changelog

All notable changes to `sitemap-lint` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `lintSitemap()` with 23 rules from the sitemaps.org 0.9 protocol, covering file limits,
  encoding, XML well-formedness, root and namespace, entries, `<loc>`, `<lastmod>` (all W3C
  Datetime forms, impossible dates rejected), `<changefreq>` and `<priority>`. Each finding
  has a rule id, line and entry number.
- A strict built-in XML reader: no dependencies, no DTD processing (XXE-safe), line numbers.
- `sitemap-lint` CLI for files, stdin and URLs, with gzip support, a 50 MB read cap,
  `--json`, `--max-warnings` and `--timeout`.
- `parseXml()`, the XML reader, exported as a building block (used by `product-feed-lint`).

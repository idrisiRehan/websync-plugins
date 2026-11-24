# Changelog

All notable changes to `metacheck` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `lintMetadata()` with 41 rules covering the doctype, `lang`, charset (including the
  1024-byte limit), viewport, title, meta description, canonical, robots meta (with
  googlebot), Open Graph, `twitter:card`, the heading outline, hreflang, metadata placed after
  the head has ended, and duplicate meta names. Each finding has a rule id, a severity and a
  line number. Each rule cites its source (WHATWG HTML, Google Search Central, ogp.me or X).
- A metadata summary: title, description, canonical, robots directives, lang, charset,
  viewport, Open Graph and X properties, hreflang alternates and headings.
- Exported thresholds: `TITLE_MIN_LENGTH`, `TITLE_MAX_LENGTH`, `DESCRIPTION_MIN_LENGTH`,
  `DESCRIPTION_MAX_LENGTH`, `CHARSET_SCAN_BYTES`, `OG_REQUIRED`, `TWITTER_CARD_TYPES`.
- `tokenizeHtml()` and `decodeEntities()`: a lenient, dependency-free HTML tokenizer with
  line numbers.
- `metacheck` CLI for files, stdin and URLs, with `--json`, `--url`, `--max-warnings`,
  `--timeout` and a 10 MB read cap.

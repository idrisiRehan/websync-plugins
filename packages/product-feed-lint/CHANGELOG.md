# Changelog

All notable changes to `product-feed-lint` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `lintProductFeed()` with two targets that share one engine: Google Merchant Center
  (tab-separated text, RSS 2.0 and Atom 1.0 XML) and OpenAI's product feed for ChatGPT shopping
  (JSONL, CSV and TSV). The format is detected from the content or set with `format`.
- Requirement tables for both targets (`GOOGLE_ATTRIBUTES`, `OPENAI_ATTRIBUTES`), one entry per
  attribute with its source page and the date it was checked (2026-11-24).
- 34 rules: unreadable and empty feeds, wrong delimiters, quoting, row widths and trailing tabs,
  XML namespaces, unknown (with a likely spelling), retired and aliased attribute names, missing
  required and conditionally required attributes, duplicate ids, lengths, counts, enums, URLs,
  ISO 8601 dates and sale date ranges, prices and currencies, sale prices, GTIN check digits and
  restricted ranges (through `websync-validators`), placeholders, unique product identifiers and
  variant groups. Every finding has a row or line, the item id and the attribute.
- Google's `native_commerce` attribute for checkout on Google (UCP) is recognised and its
  `TRUE`/`FALSE` sub-attributes are checked; `merchant_item_id` and `consumer_notice` are known.
- Google feeds may use `structured_title` and `structured_description` in place of `title` and
  `description`, and may repeat a text column to add values.
- `readFeedItems()`: the feed's items with their attribute values, read with the same readers,
  format rules and aliases as `lintProductFeed()`, plus the reading findings. A building block
  for `feed-page-check`.
- `product-feed-lint` CLI for files, stdin and URLs, with `--target`, `--format`, `--json`,
  `--max-warnings` and `--timeout`, UTF-8 and UTF-16 input, and a 100 MB read cap enforced while
  reading.

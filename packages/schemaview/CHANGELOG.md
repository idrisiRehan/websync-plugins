# Changelog

All notable changes to `schemaview` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `validateStructuredData()` for HTML pages (every `<script type="application/ld+json">`) and
  raw JSON-LD, with 23 rules covering JSON syntax, `@context`, `@type`, `@graph` and nested
  nodes, conflicting `@id`s, required and recommended properties, and value formats (ISO 8601
  dates and durations, absolute URLs, prices, ISO 4217 currencies, schema.org enumerations,
  rating bounds). Each finding has a rule id, line and JSONPath.
- `entities` in the result: every typed node with its `@id`, line, path and the rich-result
  features checked against it.
- A declarative rule table (`RICH_RESULT_TYPES`) for 18 Google rich-result features, plus
  five deprecated ones, each with its Search Central source, checked on 2026-11-24.
- A strict JSON parser that keeps line numbers, so JSON errors point at the line in the page.
- `schemaview` CLI for files, stdin and URLs, with a 10 MB read cap, `--json`,
  `--max-warnings` and `--timeout`.

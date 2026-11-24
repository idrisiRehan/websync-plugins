# Changelog

All notable changes to `schemaview` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `validateStructuredData()` for HTML pages (every `<script type="application/ld+json">`) and
  raw JSON-LD, with 24 rules covering JSON syntax, `@context`, `@type`, `@graph` and nested
  nodes, conflicting `@id`s, required and recommended properties, and value formats (ISO 8601
  dates and durations, absolute URLs, prices, ISO 4217 currencies, schema.org enumerations,
  rating bounds). Each finding has a rule id, line and JSONPath.
- `entities` in the result: every typed node with its `@id`, line, path and the rich-result
  features checked against it.
- A declarative rule table (`RICH_RESULT_TYPES`) for 19 Google rich-result features, plus
  five deprecated ones, each with its Search Central source, checked on 2026-11-24.
- Product variants (`ProductGroup`), from Google's product variants documentation (checked
  2026-11-25): the group needs `name` and is recommended its documented properties, and each
  `hasVariant` product is checked against the Product snippet and Merchant listing entries, as
  Google asks, taking `brand`, `aggregateRating` and `review` from its group (also when it
  points to the group with `isVariantOf`). Those shared properties, when missing everywhere,
  are reported once, on the group.
- `@context` of `www.schema.org` (http or https, with or without `/`) is a `context-invalid`
  warning, not an error: that host serves the same JSON-LD context as schema.org, but Google's
  documentation and schema.org's FAQ only use `https://schema.org` or `http://schema.org`.
- `readProducts()`: the Product, ProductGroup and Offer data in a page's JSON-LD as values
  (identifiers, offers, AggregateOffer ranges, price specifications with their `priceType` and
  whether they are member prices, availability, variant groups), with lines and paths, read the same way as `validateStructuredData()` reads JSON-LD.
  A building block for `feed-page-check`.
- A strict JSON parser that keeps line numbers, so JSON errors point at the line in the page.
- `schemaview` CLI for files, stdin and URLs, with a 10 MB read cap, `--json`,
  `--max-warnings` and `--timeout`.

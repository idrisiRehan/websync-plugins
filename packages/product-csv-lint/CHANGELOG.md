# Changelog

All notable changes to `product-csv-lint` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `lintProductCsv()` for Shopify and WooCommerce product CSVs, and `detectPlatform()`.
- Shopify: current and legacy column names, case-insensitive headers, metafield, market and
  Google Shopping columns, and variant, extra-image and handle grouping checks.
- WooCommerce: product types, sale versus regular price, duplicate SKU and ID, and parent and
  variation wiring by SKU or `id:123`.
- CSV checks shared by both: UTF-8, BOM, mojibake hint, semicolon delimiter, unexpected and
  unterminated quotes, ragged rows, blank and duplicate headers, and typed cell values,
  including barcode check digits through `websync-validators`.
- `product-csv-lint` CLI with platform detection, `--json`, `--max-warnings` and a 50 MB read
  cap enforced while reading.
- `parseCsv()`, the CSV reader with row numbers and quote checks, exported as a building block.
  It also splits on tabs (used by `product-feed-lint`).

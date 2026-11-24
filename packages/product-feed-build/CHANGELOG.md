# Changelog

All notable changes to `product-feed-build` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `buildProductFeed()`: a Shopify (current and legacy columns) or WooCommerce product export to a
  Google Merchant Center feed (RSS 2.0 XML or tab-separated text) or an OpenAI product feed
  (JSONL, CSV or TSV), linted with `product-feed-lint`. One item per variant with Google's
  `item_group_id` or OpenAI's `group_id`, `listing_has_variations` and `variant_dict`; stable
  ids from SKUs, handles or IDs; availability from inventory and the out-of-stock policy; sale
  prices from compare-at prices and WooCommerce sale prices and dates; GTINs only with a valid
  check digit; HTML descriptions as plain text; color, size, material and pattern from options.
  Shopify's current column names as its sample file writes them (`Variant Barcodes`,
  `Google Shopping / Manufacturer part number (MPN)`, age groups like `Adult (13+ years old)`) are
  read, and an MPN stays on its own variant.
- Skipped rows (drafts, archived, unpublished, hidden, gift cards, grouped and external products,
  disabled variations) and notes (values left out or shortened), each with its export row.
- `availabilityDate` (`--availability-date`): Google's `availability_date` for backordered
  items, validated as ISO 8601; the CLI hints at it when the date is missing. `linkTemplate`
  (`--link-template`): product links from `{handle}`, `{id}` or `{sku}`, on the store's host.
- `product-feed-build` CLI: the feed to `-o` or stdout, the summary to stderr (`--json` for JSON),
  format from the `-o` extension, `--max-warnings`, exit code 1 for lint errors, and a 50 MB read
  cap enforced while reading.

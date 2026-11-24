# Changelog

All notable changes to `feed-page-check` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `checkFeedAgainstPages()`: compares each feed item (Google Merchant Center or OpenAI, read with
  `product-feed-lint`'s `readFeedItems()`) with the Product structured data on its page (read with
  `schemaview`'s `readProducts()`): price, sale price, currency and availability. Pure, offline,
  linear in the size of the feed and the pages.
- 15 rules with stable ids, sourced from Google Merchant Center Help and Search Central (read on
  2026-11-24): `price-mismatch`, `sale-price-not-on-page`, `currency-mismatch` and
  `availability-mismatch` are errors; `availability-relaxed`, `original-price-mismatch`,
  `page-price-range`, `page-no-product`, `product-ambiguous`, `page-price-missing`,
  `page-currency-missing`, `page-availability-missing` and `feed-value-invalid` are warnings, as
  are the CLI's `page-unavailable` and `link-unusable`.
- Exact decimal comparison (`18.00 USD` equals `18`), Google's schema.org availability mapping,
  sale prices with `sale_price_effective_date` (read as Google documents it: UTC without a time
  zone, and an end date without a time includes that day), strikethrough prices, `AggregateOffer`
  ranges, `priceSpecification` validity dates. Member prices (`validForMemberTier`) and entries
  with another `priceType` are never taken for the active price.
- Variant matching by GTIN, SKU, MPN, URL, `@id` and currency, in a documented order, across
  `ProductGroup`/`hasVariant`, `isVariantOf`, offers arrays and `@graph`.
- `feed-page-check` CLI for feed files, stdin and URLs, with `--target`, `--format`, `--limit`
  (default 50), `--concurrency` (default 4), `--timeout`, `--json` and `--max-warnings`, and exit
  codes 0, 1 and 2. A request budget of 3 per item, at most 5 redirects per link, a timeout and a
  10 MiB cap on every page, and no URL requested twice in a run.
- Examples: a five-item Google feed, three product pages and a small server for them.

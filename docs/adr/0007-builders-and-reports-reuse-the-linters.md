# ADR 0007: Builders and reports reuse the linters

- Status: accepted
- Date: 2026-11-24

## Context

Two packages combine the others instead of checking one file format:

- `product-feed-build` turns a Shopify or WooCommerce export into a Google or OpenAI product
  feed. It needs the platforms' column names (current and legacy Shopify names, WooCommerce
  parent and variation wiring), HTML-to-text for descriptions, and the feed requirements.
- `store-check` fetches a store's robots.txt, sitemap, llms.txt, home page and one product page
  and reports on all of them.

Each of those pieces already exists in a tested package. Copying column lists, an HTML
stripper or feed rules would let the copies drift (ADR 0005, 0006).

## Decision

- `product-csv-lint` owns the platform knowledge and exports `readProducts()`, which reads an
  export into normalised product records. Its linter and `readProducts()` share the same
  column tables and helpers (`barcodeEntries`, `findParent`).
- `product-feed-build` uses `readProducts()`, `metacheck`'s HTML tokenizer for descriptions,
  and the requirement tables of `product-feed-lint`, and lints every feed it writes with
  `lintProductFeed()`.
- `store-check` only fetches and reports. Every check comes from the linters
  (`robots-txt-lint`, `sitemap-lint`, `llms-txt-kit`, `metacheck`, `schemaview`,
  `security-header-audit`, `redirect-inspector`); its own rules cover only what a whole-site
  view adds, such as a robots.txt that blocks Googlebot from the checked pages. It reuses
  `REDIRECT_STATUSES` from `redirect-inspector`.

## Consequences

- A rule fixed in a linter is fixed in the builder and the report at the same time.
- Both packages depend on several others; all are zero-dependency, so installs stay small.
- Publishing order: each dependency before the package that uses it (NEXT-ACTIONS.md).

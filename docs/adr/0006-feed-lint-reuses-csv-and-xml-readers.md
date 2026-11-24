# ADR 0006: product-feed-lint reuses the CSV and XML readers

- Status: accepted
- Date: 2026-11-24

## Context

`product-feed-lint` reads product feeds for Google Merchant Center, which come as
tab-separated text or as XML (RSS 2.0 or Atom 1.0 with the `g:` namespace), and for OpenAI's
product feed spec (JSONL, CSV or TSV). Both targets share the same readers and value checks;
each has its own requirements table. The repository already has a
strict CSV reader with row numbers (`product-csv-lint/src/csv.ts`) and a strict XML reader
with line numbers and no DTD processing (`sitemap-lint/src/xml.ts`, ADR 0002). It also needs
GTIN check digits, which `websync-validators` provides.

Writing a third reader would duplicate tested code and let the copies drift (the same reason
as ADR 0005). A third-party parser would be the first runtime dependency (ADR 0001).

## Decision

- `product-csv-lint` exports `parseCsv`, which now also accepts a tab delimiter.
- `sitemap-lint` exports `parseXml`.
- Both are documented building blocks. `product-feed-lint` depends on `product-csv-lint`,
  `sitemap-lint` and `websync-validators` (`^1.0.0`, `^1.0.0`, `^1.1.0`) and resolves them from
  source in development through the `websync-source` condition (ADR 0003).

## Consequences

- Installing `product-feed-lint` also installs three small packages with no other
  dependencies.
- The shapes of `parseCsv` and `parseXml` results are public API of their packages. Changing
  them is a breaking change and needs a major version.
- `sitemap-lint` and `product-csv-lint` must be published before `product-feed-lint`.

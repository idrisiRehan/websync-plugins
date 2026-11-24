# Changelog

All notable changes to `store-check` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `checkStore()`: fetches a fixed set of a store's files and pages (the start URL's redirects
  and its `http://` variant, `/robots.txt`, the home page, the sitemap and at most one child
  sitemap, one product page and `/llms.txt`) and runs the repository's linters on them:
  `redirect-inspector`, `robots-txt-lint`, `sitemap-lint`, `llms-txt-kit`, `metacheck`,
  `schemaview` and `security-header-audit`.
- A report with nine sections (redirects and HTTPS, robots.txt, crawler access, sitemap,
  llms.txt, home and product page metadata, structured data, security headers). Each has a
  status taken from its findings' severities (`pass`, `warnings`, `errors`), or `skipped` or
  `unavailable` when nothing could be checked, plus short facts and every finding with its rule
  id, source package and location. No invented score.
- Crawler access for Googlebot and each AI crawler in `robots-txt-lint`'s list, on the home page
  and the product page, and whether the product page has a valid Product snippet or Merchant
  listing rich result. A `ProductGroup` is reported with its variants' results. A `Product` or
  `ProductGroup` nested in another node, or Microdata or RDFa markup, which schemaview doesn't
  check, is reported as not checked, never as missing.
- No false positives from bot protection or catch-all pages: only a 404 or 410 (or an HTML page
  served in its place) counts as a missing sitemap or llms.txt, and a 401 or 403 is reported as
  a fact.
- Seven rules of its own for what only a whole-site check can see: `robots-unreachable`,
  `googlebot-blocked`, `sitemap-missing`, `sitemap-unreachable`, `page-status`,
  `product-markup-missing` and `encoding-invalid`.
- A product page picked from the sitemap by a documented, conservative heuristic (Shopify
  `/products/<handle>`, WooCommerce `/product/<slug>`, gift cards passed over), or given with
  `productUrl`.
- Network library limits: at most 20 HTTP requests per run, redirects included, made one at a
  time; at most 5 redirects per fetch; a timeout on every request; a byte cap on every body while
  it streams; unneeded bodies cancelled; injectable `fetch`.
- `store-check` CLI with `--product`, `--json`, `--timeout` and `--max-warnings`, a text report
  that shows the first three findings per section, and exit codes 0, 1 and 2.

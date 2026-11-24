# WebSync developer packages

Open-source libraries and CLIs from [WebSync](https://websync.in). Each package is the tested
core of a free tool on websync.in, published so developers can use the same logic in their own
code, tests and pipelines.

| Package | What it does | Web tool |
|---|---|---|
| [`websync-validators`](packages/validators) | Offline check-digit validation for EU/UK VAT numbers, IBANs (89 countries), Australian ABN/ACN, US routing numbers, Indian GSTINs, GTIN/EAN/UPC barcodes and ISBNs. Reports which check failed. | [VAT](https://websync.in/tools/vat-number-checker/), [IBAN](https://websync.in/tools/iban-validator/), [ABN](https://websync.in/tools/abn-validator/), [routing](https://websync.in/tools/routing-number-validator/), [GSTIN](https://websync.in/tools/gstin-validator/), [GTIN](https://websync.in/tools/gtin-converter/), [ISBN](https://websync.in/tools/isbn-asin-validator/) |
| [`security-header-audit`](packages/security-header-audit) | Grades HTTP security headers (HSTS, CSP, clickjacking, nosniff, Referrer-Policy, Permissions-Policy) offline, with a CLI for CI. | [Security Header Checker](https://websync.in/tools/security-header-checker/) |
| [`sitemap-lint`](packages/sitemap-lint) | Lints XML sitemaps and sitemap indexes against the sitemaps.org protocol, with line numbers. XXE-safe, reads files, URLs and `.xml.gz`. | [Sitemap Validator](https://websync.in/tools/sitemap-validator/) |
| [`product-csv-lint`](packages/product-csv-lint) | Checks Shopify (current and legacy formats) and WooCommerce product CSVs before import: quoting, encoding, headers, prices, barcodes, variants and parents. | [Product CSV Validator](https://websync.in/tools/product-csv-validator/), [WooCommerce CSV Validator](https://websync.in/tools/woocommerce-csv-validator/) |
| [`metacheck`](packages/metacheck) | Lints a page's HTML for search and sharing metadata: title, description, canonical, robots, Open Graph, X cards, headings, hreflang, and metadata placed outside head. Line numbers, no fetching in the library. | [SEO Analyzer](https://websync.in/tools/seo-analyzer/) |
| [`schemaview`](packages/schemaview) | Validates JSON-LD structured data against the properties Google documents for rich results, with line numbers and JSON paths. Flags deprecated types. | n/a |
| [`llms-txt-kit`](packages/llms-txt-kit) | Lints and builds `llms.txt` files per the llmstxt.org proposal. | n/a |
| [`redirect-inspector`](packages/redirect-inspector) | Follows redirect chains hop by hop and reports loops, downgrades, long chains and bad final statuses. Verifies a whole redirect map after a site migration. | n/a |
| [`robots-txt-lint`](packages/robots-txt-lint) | Lints robots.txt against RFC 9309 and how Google reads it, tests URLs against the rules, and shows which AI crawlers (GPTBot, ClaudeBot, Google-Extended and more) are allowed. | n/a |
| [`product-feed-lint`](packages/product-feed-lint) | Lints product feeds before upload, for Google Merchant Center (TSV, RSS and Atom) and for OpenAI's product feed spec for ChatGPT shopping (JSONL, CSV, TSV): required attributes, prices, availability, GTIN check digits, lengths and variants. | n/a |
| [`product-feed-build`](packages/product-feed-build) | Turns a Shopify or WooCommerce product export into a Google Merchant Center feed or an OpenAI product feed for ChatGPT shopping, checked with `product-feed-lint` before it is written. | n/a |
| [`store-check`](packages/store-check) | One command that shows what search engines and AI agents see on a store: redirects, robots.txt and AI crawler access, sitemap, llms.txt, page metadata, Product structured data and security headers, from a small fixed set of requests. | n/a |
| [`websync-mcp`](packages/websync-mcp) | Local MCP server that gives AI assistants the offline packages above as nine tools. No network access. | n/a |

Every package is TypeScript and ESM, and none has a third-party runtime dependency. Library
code makes no network calls, except `redirect-inspector` and `store-check`, whose job is fetching
([security model](docs/ecosystem/SECURITY-MODEL.md)). Some packages use others from this
repository: `product-csv-lint` uses `websync-validators`, `schemaview` uses the HTML tokenizer
in `metacheck`, `product-feed-lint` uses the CSV and XML readers of `product-csv-lint` and
`sitemap-lint`, `product-feed-build` uses the product reader in `product-csv-lint` and checks
its output with `product-feed-lint`, `store-check` runs the linters on what it fetches, and
`websync-mcp` exposes the offline linters (ADR 0003 to 0007).

## Working on this repository

Requires Node 22.18 or later (tests run TypeScript directly through Node's type stripping).

```sh
npm install
npm run check        # text rules, typecheck, every test, every build
npm test             # tests only
npm run check:pack   # what each package would publish
```

Layout:

```text
packages/<name>/     one published package: src/, test/, README, CHANGELOG
docs/ecosystem/      audit, opportunity matrix, roadmap, worklog, next actions
docs/adr/            architecture decisions
scripts/             repository checks
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and [SECURITY.md](SECURITY.md) to report
a vulnerability.

## License

MIT. Each package carries its own `LICENSE`.

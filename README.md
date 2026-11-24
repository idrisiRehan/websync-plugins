# WebSync developer packages

Open-source libraries and CLIs from [WebSync](https://websync.in). Each package is the tested
core of a free tool on websync.in, published so developers can use the same logic in their own
code, tests and pipelines.

| Package | What it does | Web tool |
|---|---|---|
| [`websync-validators`](packages/validators) | Offline check-digit validation for EU/UK VAT numbers, IBANs (89 countries), Australian ABN/ACN, US routing numbers, Indian GSTINs, GTIN/EAN/UPC barcodes and ISBNs. Reports which check failed. | [VAT](https://websync.in/tools/vat-number-checker/), [IBAN](https://websync.in/tools/iban-validator/), [ABN](https://websync.in/tools/abn-validator/), [routing](https://websync.in/tools/routing-number-validator/), [GSTIN](https://websync.in/tools/gstin-validator/), [GTIN](https://websync.in/tools/gtin-converter/), [ISBN](https://websync.in/tools/isbn-asin-validator/) |
| [`product-csv-lint`](packages/product-csv-lint) | Checks Shopify (current and legacy formats) and WooCommerce product CSVs before import: quoting, encoding, headers, prices, barcodes, variants and parents. | [Product CSV Validator](https://websync.in/tools/product-csv-validator/), [WooCommerce CSV Validator](https://websync.in/tools/woocommerce-csv-validator/) |
| [`sitemap-lint`](packages/sitemap-lint) | Lints XML sitemaps and sitemap indexes against the sitemaps.org protocol, with line numbers. XXE-safe, reads files, URLs and `.xml.gz`. | [Sitemap Validator](https://websync.in/tools/sitemap-validator/) |
| [`security-header-audit`](packages/security-header-audit) | Grades HTTP security headers (HSTS, CSP, clickjacking, nosniff, Referrer-Policy, Permissions-Policy) offline, with a CLI for CI. | [Security Header Checker](https://websync.in/tools/security-header-checker/) |

Every package is TypeScript and ESM, and makes no network calls in its library code. None
has a third-party dependency. `product-csv-lint` uses `websync-validators` from this repository
(ADR 0003).

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

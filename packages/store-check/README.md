# store-check

One command that answers "what do search engines and AI agents see on my store?" It fetches a
handful of the store's own files and pages, runs seven focused linters on them and prints one
report: redirects and HTTPS, robots.txt and which crawlers may fetch your pages, the sitemap,
llms.txt, home and product page metadata, Product structured data and security headers.

```sh
npx store-check https://yourstore.com
```

A store's visibility breaks in places nobody looks at together: a robots.txt rule that blocks
product pages, a sitemap that robots.txt points to but that answers 404, a theme update that
dropped the Product JSON-LD, an `http://` address that never reaches HTTPS. Each of those is
easy to check alone, and easy to miss when you have to remember to check all of them.
`store-check` checks them in one pass, in a few seconds, with a request budget small enough to
run against any store.

- **The checks are the suite's own.** Every finding comes from one of the repository's
  linters, unchanged, with its rule id and the package that produced it:
  [redirect-inspector](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/redirect-inspector),
  [robots-txt-lint](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/robots-txt-lint),
  [sitemap-lint](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/sitemap-lint),
  [llms-txt-kit](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/llms-txt-kit),
  [metacheck](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/metacheck),
  [schemaview](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/schemaview) and
  [security-header-audit](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/security-header-audit).
  store-check adds seven rules of its own for what only a whole-site check can see.
- **No invented score.** Each section's status is its findings' worst severity, and exit code 1
  means at least one finding is an error.
- **Bounded.** At most 8 fetches and 20 HTTP requests per run, one at a time, each with a
  timeout and a size cap. See [the request budget](#what-is-fetched).
- **Zero third-party dependencies.** Node's built-in `fetch`, plus the seven packages above,
  which come from the same repository and have no third-party dependencies either. TypeScript
  types are included.

## Install

```sh
npm install store-check
```

Or run it without installing: `npx store-check https://yourstore.com`. ESM only. Needs Node 22
or later.

## CLI

```text
store-check <url> [options]

  --product <url>      Product page to check (default: one picked from the sitemap)
  --json               Print the full report as JSON
  --timeout <ms>       Timeout for each request in milliseconds (default 10000)
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  -h, --help           Show this help
  -v, --version        Show the version
```

```sh
npx store-check yourstore.com                     # https:// is assumed
npx store-check https://yourstore.com --product https://yourstore.com/products/best-seller
npx store-check https://yourstore.com --json > store-report.json
```

Only the URL's origin is used: `https://yourstore.com/collections/sale` checks
`https://yourstore.com/`. The text report shows each section's status and facts, then its first
three findings (errors first); `--json` has every finding.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No errors. Warnings alone don't fail |
| `1` | At least one section has errors, or there are more warnings than `--max-warnings` |
| `2` | A usage error (nothing is fetched), or the site couldn't be reached at all (DNS, refused connection, timeout on the first request) |

A site that answers, even with errors, is reported and exits 0 or 1. Only a start URL with no
response at all exits 2, with a one-line message on stderr.

### In CI

```yaml
- name: Check what search engines see on the store
  run: npx --yes store-check@1 https://staging.yourstore.com --product https://staging.yourstore.com/products/test-product
```

## Real stores

Captured on 2026-11-24 from public stores, unedited. Sites change, so a run today will differ.

A Shopify store. Its product page marks up the product's variants as a `ProductGroup`, which
schemaview didn't check yet when this was captured, so the Product rich result was "not
checked" rather than missing (schemaview now checks the group and each variant, so a run today
reports them); its `hreflang="en-EU"` uses a region code Google ignores:

```text
$ npx store-check https://www.gymshark.com
store-check https://www.gymshark.com/, 2026-11-24 15:17 UTC

PASS         Redirects and HTTPS
  https://www.gymshark.com/ answers 200 without redirecting.
  http://www.gymshark.com/ -> https://www.gymshark.com/ (301, then 200).

PASS         robots.txt
  https://www.gymshark.com/robots.txt: 6 groups, 108 rules, 3 sitemaps.

PASS         Crawler access
  Googlebot: home page allowed, product page allowed.
  AI crawlers (robots-txt-lint lists 21): none blocked from the whole site, 21 blocked from some paths, 0 with no Disallow rule.
  Every listed AI crawler may fetch the home page and the product page.

PASS         Sitemap
  Listed in robots.txt (3 Sitemap lines; store-check reads one).
  https://www.gymshark.com/sitemap.xml: sitemap index, 9 sitemaps.
  https://www.gymshark.com/sitemap_products_1.xml: 2320 URLs. (The one child sitemap store-check reads.)

SKIPPED      llms.txt
  No llms.txt (HTTP 404 at https://www.gymshark.com/llms.txt). It's an optional proposal (https://llmstxt.org/), so this is not a problem.

ERRORS       Home page metadata (1 error, 10 warnings)
  https://www.gymshark.com/ (HTTP 200).
  Title: "Gymshark Official Store - Gym & Workout Clothes - Black Friday Sale" (67 characters).
  Canonical: https://www.gymshark.com/ (itself).
  ERROR  hreflang-invalid (line 1)
         hreflang="en-EU": EU is a reserved code, not an ISO 3166-1 region, so Google ignores it.
  WARN   title-too-long (line 4)
         The title is 67 characters and may be cut off. Aim for 30-60; search engines truncate by pixel width, so the character count is approximate.
  WARN   description-too-long (line 4)
         The description is 181 characters and may be cut off. Aim for 120-160; search engines truncate by pixel width, so the character count is approximate.
  ... and 8 more (--json lists every finding)

ERRORS       Product page metadata (2 errors, 10 warnings)
  https://www.gymshark.com/products/gymshark-fit-seamless-cropped-leggings-smokey-grey (HTTP 200), picked from the sitemap.
  Title: "Gymshark Fit Seamless Cropped Leggings - Smokey Grey | Gymshark" (63 characters).
  Canonical: https://www.gymshark.com/products/gymshark-fit-seamless-cropped-leggings-smokey-grey (itself).
  ERROR  hreflang-invalid (line 1)
         hreflang="en-EU": EU is a reserved code, not an ISO 3166-1 region, so Google ignores it.
  ERROR  twitter-card-invalid (line 4)
         twitter:card "product" is not one of: summary, summary_large_image, app, player. X won't render a card for it.
  WARN   title-too-long (line 4)
         The title is 63 characters and may be cut off. Aim for 30-60; search engines truncate by pixel width, so the character count is approximate.
  ... and 9 more (--json lists every finding)

WARNINGS     Structured data (0 errors, 2 warnings)
  The home page: 2 JSON-LD blocks, rich results checked: Organization.
  The product page: 1 JSON-LD block, no rich result types.
  Product rich result: not checked. The product page has ProductGroup and Product markup that schemaview doesn't match to Google's rules (a ProductGroup, or a Product nested in another node).
  WARN   property-recommended (line 98, $.description)
         Missing "description", recommended for Organization per Google's documentation.
  WARN   url-relative (line 98, $.sameAs[6])
         sameAs "pinterest.co.uk/gymshark" is relative. It resolves to https://www.gymshark.com/pinterest.co.uk/gymshark, but Google's documentation asks for absolute URLs.

WARNINGS     Security headers (0 errors, 2 warnings)
  Headers of https://www.gymshark.com/ (HTTP 200): 90/100, strong (security-header-audit's score).
  WARN   csp-unsafe
         Content-Security-Policy: Present, but allows 'unsafe-inline' for scripts, event handlers and styles and 'unsafe-eval' - these significantly weaken CSP's protection against injected code.
  WARN   info-disclosure
         Server info disclosure: Server: CloudFront, X-Powered-By: Next.js - reveals the software/version running, which narrows down which known vulnerabilities to try. Most frameworks let you suppress or generalize this.

Fetched:
  200   1573 ms  start URL: https://www.gymshark.com/
  200    168 ms  http:// variant: http://www.gymshark.com/ -> https://www.gymshark.com/ (1 redirect)
  200     61 ms  robots.txt: https://www.gymshark.com/robots.txt
  200   1250 ms  home page: https://www.gymshark.com/
  200     28 ms  sitemap: https://www.gymshark.com/sitemap.xml
  200     62 ms  child sitemap: https://www.gymshark.com/sitemap_products_1.xml
  200   1170 ms  product page: https://www.gymshark.com/products/gymshark-fit-seamless-cropped-leggings-smokey-grey
  404   1775 ms  llms.txt: https://www.gymshark.com/llms.txt

3 errors, 24 warnings. 9 sections: 2 with errors, 2 with warnings, 4 passed, 1 skipped. 9 requests.
```

A WooCommerce store (from the [WooCommerce showcase](https://woocommerce.com/showcase/)). Its
pages carry Product markup, but a template left `"price": "REPLACE_WITH_PRICE"` in it, and the
home page sends none of the main security headers:

```text
$ npx store-check https://helloyumi.com
store-check https://helloyumi.com/, 2026-11-24 14:42 UTC

PASS         Redirects and HTTPS
  https://helloyumi.com/ answers 200 without redirecting.
  http://helloyumi.com/ -> https://helloyumi.com/ (301, then 200).

WARNINGS     robots.txt (0 errors, 1 warning)
  https://helloyumi.com/robots.txt: 2 groups, 8 rules, 1 sitemap.
  WARN   group-duplicate (line 12)
         "*" already has a group on line 1. Crawlers merge groups for the same agent (RFC 9309 s2.2.1), so the rules of both apply; combine them into one group to make that visible.

PASS         Crawler access
  Googlebot: home page allowed, product page allowed.
  AI crawlers (robots-txt-lint lists 21): none blocked from the whole site, 21 blocked from some paths, 0 with no Disallow rule.
  Every listed AI crawler may fetch the home page and the product page.

PASS         Sitemap
  Listed in robots.txt.
  https://helloyumi.com/sitemap_index.xml: sitemap index, 10 sitemaps.
  https://helloyumi.com/product-sitemap.xml: 49 URLs. (The one child sitemap store-check reads.)

PASS         llms.txt
  https://helloyumi.com/llms.txt: "YUMI: Made in the USA with domestic and imported ingredients", 9 sections, 35 links.

WARNINGS     Home page metadata (0 errors, 3 warnings)
  https://helloyumi.com/ (HTTP 200).
  Title: "YUMI - Healthy Snacks for Toddlers and Family" (45 characters).
  Canonical: https://helloyumi.com/ (itself).
  WARN   title-multiple (line 25)
         There are 2 <title> elements. Only one is allowed, and the first (line 9) is the one used.
  WARN   meta-duplicate (line 3695)
         <meta name="generator"> appears more than once (first on line 3694). Keep one, so it's clear which value applies.
  WARN   meta-duplicate (line 3780)
         <meta name="twitter:card"> appears more than once (first on line 20). Keep one, so it's clear which value applies.

WARNINGS     Product page metadata (0 errors, 4 warnings)
  https://helloyumi.com/product/tooootes-1-little-1-big/ (HTTP 200), picked from the sitemap.
  Title: "TOOOOTES - 1 little, 1 big - YUMI" (33 characters).
  Canonical: https://helloyumi.com/product/tooootes-1-little-1-big/ (itself).
  WARN   description-missing
         The page has no meta description. Search engines will build the snippet from page text instead.
  WARN   title-multiple (line 30)
         There are 2 <title> elements. Only one is allowed, and the first (line 9) is the one used.
  WARN   meta-duplicate (line 3717)
         <meta name="generator"> appears more than once (first on line 3716). Keep one, so it's clear which value applies.
  ... and 1 more (--json lists every finding)

ERRORS       Structured data (6 errors, 59 warnings)
  The home page: 11 JSON-LD blocks, rich results checked: Breadcrumb, Organization, Product snippet, Merchant listing.
  The product page: 4 JSON-LD blocks, rich results checked: Breadcrumb, Organization, Article, Product snippet, Merchant listing.
  Product rich result: Product snippet and Merchant listing checked, but the product page's structured data has 1 error.
  ERROR  list-too-short (https://helloyumi.com/, line 21, $["@graph"][2].itemListElement)
         itemListElement has 1 item. Breadcrumb needs at least 2 per Google's documentation.
  ERROR  price-invalid (https://helloyumi.com/, line 5058, $.offers.price)
         price "REPLACE_WITH_PRICE" isn't a plain number. Use digits with an optional decimal point and no thousands separators, for example 1299.50.
  ERROR  price-invalid (https://helloyumi.com/, line 5078, $.offers.price)
         price "REPLACE_WITH_PRICE" isn't a plain number. Use digits with an optional decimal point and no thousands separators, for example 1299.50.
  ... and 62 more (--json lists every finding)

ERRORS       Security headers (3 errors, 4 warnings)
  Headers of https://helloyumi.com/ (HTTP 200): 43/100, weak (security-header-audit's score).
  ERROR  hsts-missing
         Strict-Transport-Security: Missing. Without HSTS, a visitor's first request (or one after a cleared cache) can still be intercepted over plain HTTP before any redirect to HTTPS happens.
  ERROR  csp-missing
         Content-Security-Policy: Missing. CSP is the strongest available mitigation against XSS and data-injection attacks - without it, the browser enforces no restriction on what scripts/styles/frames a compromised or injected element can load.
  ERROR  clickjack-missing
         Clickjacking protection: Neither X-Frame-Options nor a CSP frame-ancestors directive is set - this page can be embedded in an invisible iframe on another site for a clickjacking attack.
  ... and 4 more (--json lists every finding)

Fetched:
  200     85 ms  start URL: https://helloyumi.com/
  200     37 ms  http:// variant: http://helloyumi.com/ -> https://helloyumi.com/ (1 redirect)
  200     28 ms  robots.txt: https://helloyumi.com/robots.txt
  200     35 ms  home page: https://helloyumi.com/
  200     17 ms  sitemap: https://helloyumi.com/sitemap_index.xml
  200     16 ms  child sitemap: https://helloyumi.com/product-sitemap.xml
  200     16 ms  product page: https://helloyumi.com/product/tooootes-1-little-1-big/
  200     10 ms  llms.txt: https://helloyumi.com/llms.txt

9 errors, 71 warnings. 9 sections: 2 with errors, 3 with warnings, 4 passed. 9 requests.
```

## What is fetched

store-check fetches these and nothing else, in this order, one request at a time:

| # | Fetch | When | Body read |
|---|---|---|---|
| 1 | The start URL's origin (`https://yourstore.com/`), redirect by redirect, with `inspectRedirects()` | Always | Never (cancelled) |
| 2 | The `http://` variant of the same host, redirect by redirect | When the start URL is `https://` | Never (cancelled) |
| 3 | `/robots.txt` on the site | Always | Up to 1 MiB |
| 4 | The home page: where fetch 1 ended | When fetch 1 ended at a 2xx | Up to 10 MiB |
| 5 | The sitemap: the first robots.txt `Sitemap` line on the site's host, else the first one, else `/sitemap.xml` | Always | Up to 50 MB (the protocol's limit), gzip included |
| 6 | One child sitemap on the site's or the index's host: the first whose path contains `product`, else the first | When fetch 5 is a sitemap index | Up to 50 MB |
| 7 | One product page: `productUrl`, else picked from the sitemap (below) | When there is one | Up to 10 MiB |
| 8 | `/llms.txt` on the site | Always | Up to 5 MiB |

"The site" is the origin where fetch 1 ended, so `https://yourstore.com` that redirects to
`https://www.yourstore.com` is checked on `www`. Each fetch follows at most 5 redirects (RFC 9309
asks robots.txt readers to follow at least five), and every redirect is a request.

**Request budget:** at most 20 HTTP requests per run, redirects included. A typical store takes
7 to 11 (both stores above took 9). The two redirect checks come first and can't use more than
12 between them, so they always run in full; a later fetch that would go over 20 isn't made, and
the report says so. With the default 10-second timeout, the requests can't take longer than about
200 seconds in all, however slow the site.

Fetches start only on the start URL's host or the host it redirects to (`productUrl` may use the
`www` or bare form of it). The sitemap may be on another host when robots.txt points there (the
report says so), and a child sitemap may be on the sitemap's own host. Redirects are followed
wherever they lead, as crawlers do. Nothing is crawled beyond this table.

### Which product page

Without `productUrl`, store-check takes the first URL in the sitemap (or the child sitemap it
read) that is on the site's host and whose path ends in a slug right after a `products` or
`product` segment, skipping gift cards:

- Shopify: `/products/<handle>`, `/collections/<collection>/products/<handle>`, `/en-ca/products/<handle>`
- WooCommerce: `/product/<slug>/`, the default product permalink

Stores with other URL schemes (a custom WooCommerce product base, a headless storefront) get a
`skipped` product section that says why; pass `--product` for them. The heuristic is
conservative on purpose: linting a page that isn't a product would report misleading problems.

## The report

Nine sections, always in this order:

| Section | Findings from | Notes |
|---|---|---|
| Redirects and HTTPS | `redirect-inspector` on fetches 1 and 2 | Facts show each chain. A 403 or 429 home page gets a note that bot protection may answer crawlers differently |
| robots.txt | `robots-txt-lint` | Status codes as RFC 9309 s2.3.1 says: a 4xx means no rules (`pass`, with a fact that a 401 or 403 may be bot protection); a 5xx or 429 is `robots-unreachable` |
| Crawler access | `robots-txt-lint`'s `isAllowed()` and `aiCrawlerReport()` | `googlebot-blocked` when robots.txt blocks Googlebot from the home or product page. Which AI crawlers are blocked is a fact, not a finding: it's your choice to make |
| Sitemap | `sitemap-lint` on the sitemap and the child | `sitemap-missing` (warning) or `sitemap-unreachable` (error). Any other answer, such as a 403 at a `/sitemap.xml` that robots.txt doesn't list, is a fact (`unavailable`) |
| llms.txt | `llms-txt-kit` | A 404, a 410 or an HTML page (a 404 page sent with 200) is `skipped`: llms.txt is an optional proposal, so its absence isn't a problem. Another 4xx is `unavailable` |
| Home page metadata | `metacheck` | |
| Product page metadata | `metacheck` | `page-status` when the product page doesn't answer 2xx |
| Structured data | `schemaview` on both pages | Says whether the product page has a valid Product rich result (below). `product-markup-missing` when it has no Product or ProductGroup markup |
| Security headers | `security-header-audit` on the home page's response headers | Its `failed` checks are errors and its `warning` checks are warnings. Its 0-100 score is quoted as a fact |

### How each status is decided

| Status | When |
|---|---|
| `errors` | At least one finding is an error |
| `warnings` | At least one warning, no errors |
| `pass` | Checked, and no findings |
| `skipped` | Nothing to check: no llms.txt (404, 410 or an HTML page), or no product page found |
| `unavailable` | Couldn't be checked: a timeout, a network error, an unexpected status (such as a 403 from bot protection), a body over its cap, a gzip file that won't decompress, or a fetch it depends on that failed |

Errors and warnings are the linters' own severities; store-check never re-grades them. The
summary line counts sections by status and adds up the findings.

**Product rich result.** "Product snippet and Merchant listing valid" means `schemaview` matched
a `Product` node on the product page to those features (Merchant listing needs `offers`) and the
product page's structured data has no errors. An error anywhere in that page's JSON-LD is
reported against it, because schemaview reports errors per page, not per feature. A
`ProductGroup` (Shopify's markup for products with variants) is checked as "Product variants",
and each of its variants as a Product snippet and Merchant listing. schemaview checks top-level
products only: when the product page's `Product` or `ProductGroup` is nested in another node, or
uses Microdata or RDFa, the Product rich result is "not checked", and `product-markup-missing`
is not reported.

### store-check's own rules

| Rule | Severity | Section | Meaning |
|---|---|---|---|
| `robots-unreachable` | error | robots.txt | robots.txt answered 5xx or 429, so crawlers assume the whole site is disallowed until it answers ([RFC 9309 s2.3.1.4](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.4)) |
| `encoding-invalid` | error | robots.txt, llms.txt | The file isn't valid UTF-8 (RFC 9309 s2.3 requires it for robots.txt). The file is still linted |
| `googlebot-blocked` | error | Crawler access | robots.txt blocks Googlebot from the home page or the product page |
| `sitemap-unreachable` | error | Sitemap | A sitemap that robots.txt lists, or a child that the index lists, didn't answer 2xx; or `/sitemap.xml` answered 5xx or 429 |
| `sitemap-missing` | warning | Sitemap | robots.txt was read and has no `Sitemap` line, and `/sitemap.xml` answered 404 or 410, or with an HTML page |
| `page-status` | error | Home or product page metadata | The page answered something other than 2xx |
| `product-markup-missing` | warning | Structured data | The product page has no `Product` or `ProductGroup` structured data in JSON-LD, Microdata or RDFa |

## Library

```ts
import { checkStore, formatReport } from "store-check";

const report = await checkStore("https://yourstore.com", { timeoutMs: 15000 });

report.reachable;    // false only when the start URL got no response at all
report.errorCount;   // findings with severity "error", over every section
for (const s of report.sections) console.log(s.status, s.title, s.facts);
console.log(formatReport(report)); // the CLI's text report
```

A runnable version is in
[examples/check-store.mjs](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/store-check/examples/check-store.mjs).

```ts
function checkStore(url: string, options?: CheckOptions): Promise<StoreReport>;
function formatReport(report: StoreReport, maxFindings?: number): string; // default 3 per section

interface CheckOptions {
  productUrl?: string;    // a product page on the store's host (www or not), instead of the sitemap pick
  timeoutMs?: number;     // per request, default 10000
  userAgent?: string;     // default "store-check (+https://github.com/idrisiRehan/websync-plugins)"
  fetch?: typeof fetch;   // inject a fetch for tests or a custom agent
}
```

`checkStore()` throws only for bad input: a `url` or `productUrl` that isn't an absolute http(s)
URL, a `productUrl` on another host, a `timeoutMs` that isn't a whole number of at least 1, an
empty `userAgent` or a `fetch` that isn't a function. Everything the site does wrong, including
a request that fails or times out, is part of the report.

The exported constants are `MAX_REQUESTS` (20), `MAX_REDIRECTS` (5), `DEFAULT_TIMEOUT_MS`
(10000) and `DEFAULT_USER_AGENT`.

## JSON

`--json` prints the `StoreReport`:

```ts
interface StoreReport {
  url: string;               // the start URL: the origin of the URL given
  site: string;              // the origin every later check ran on
  checkedAt: string;         // ISO 8601
  reachable: boolean;
  product: { url: string; source: "option" | "sitemap" } | null;
  sections: Section[];       // always nine, in the order above
  crawlers: {                // null when robots.txt couldn't be read
    googlebot: { home: boolean; product: boolean | null };
    ai: AiCrawlerPageAccess[];  // robots-txt-lint's AiCrawlerAccess, plus home and product
  } | null;
  requests: FetchRecord[];   // every fetch, in order
  requestCount: number;      // HTTP requests, redirects included
  errorCount: number;
  warningCount: number;
}

interface Section {
  id: "redirects" | "robots-txt" | "crawlers" | "sitemap" | "llms-txt"
    | "home-page" | "product-page" | "structured-data" | "security-headers";
  title: string;
  status: "pass" | "warnings" | "errors" | "skipped" | "unavailable";
  facts: string[];
  findings: Finding[];
  errorCount: number;
  warningCount: number;
}

interface Finding {
  rule: string;              // the linter's rule id, or one of store-check's own
  severity: "error" | "warning";
  message: string;
  url: string;               // the file or page it is about
  where: string | null;      // "line 12", "hop 2", "entry 3, line 7", "line 21, $.offers.price"
  source: string;            // "robots-txt-lint", "schemaview", ..., or "store-check"
}

interface FetchRecord {
  purpose: string;           // "start URL", "http:// variant", "robots.txt", "home page", ...
  url: string;
  finalUrl: string;          // after redirects
  status: number | null;     // null when no response arrived
  redirects: number;
  durationMs: number;
  bytes: number | null;      // body bytes read, null when the body wasn't read
  error: string | null;      // timeout, network error, too many redirects or a loop, body over the cap, budget
}
```

Excerpts from the helloyumi.com run above:

```json
{
  "url": "https://helloyumi.com/",
  "site": "https://helloyumi.com",
  "product": { "url": "https://helloyumi.com/product/tooootes-1-little-1-big/", "source": "sitemap" },
  "sections": [
    {
      "id": "robots-txt",
      "title": "robots.txt",
      "status": "warnings",
      "facts": ["https://helloyumi.com/robots.txt: 2 groups, 8 rules, 1 sitemap."],
      "findings": [
        {
          "rule": "group-duplicate",
          "severity": "warning",
          "message": "\"*\" already has a group on line 1. Crawlers merge groups for the same agent (RFC 9309 s2.2.1), so the rules of both apply; combine them into one group to make that visible.",
          "url": "https://helloyumi.com/robots.txt",
          "where": "line 12",
          "source": "robots-txt-lint"
        }
      ],
      "errorCount": 0,
      "warningCount": 1
    }
  ],
  "crawlers": {
    "googlebot": { "home": true, "product": true },
    "ai": [
      { "token": "GPTBot", "operator": "OpenAI", "purpose": "training", "access": "partial", "group": "*", "groupLines": [1, 12], "home": true, "product": true }
    ]
  },
  "requests": [
    { "purpose": "http:// variant", "url": "http://helloyumi.com/", "finalUrl": "https://helloyumi.com/", "status": 200, "redirects": 1, "durationMs": 38, "bytes": null, "error": null }
  ],
  "requestCount": 9,
  "errorCount": 9,
  "warningCount": 71
}
```

(Shortened: the real output has all nine sections, all 21 AI crawlers with their `source` and
`checked` fields, and every request.)

## Security

This is a network library, like
[redirect-inspector](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/redirect-inspector):
the library itself makes requests, not just the CLI. It fetches the URL you give it, the hosts
that URL redirects to, and a sitemap host that robots.txt names, including `localhost` and
addresses on private networks. That is what you want for checking your own store or a staging
server from a terminal or a CI job, and exactly what you don't want behind a public endpoint:
anyone could make it request internal addresses and read parts of the answers back from the
report.

- Only `http:` and `https:` URLs are requested.
- At most 20 requests per run, made one at a time, each with a timeout.
- Every body is read only up to its cap while it streams (1 MiB to 50 MB, see the table), after
  HTTP decompression, so a compressed or endless response stops at the cap. Gzipped sitemaps
  are decompressed with the same 50 MB limit. Bodies that aren't needed (redirects, error pages,
  the redirect checks) are cancelled unread.
- No cookies or credentials are sent. The `User-Agent` names the package.

Don't wrap it in a public service as it is. A hosted version needs SSRF protection on every
request and every redirect (vet and pin the resolved address), a rate limit, and a time budget
for the whole run, as described in the repository's
[security model](https://github.com/idrisiRehan/websync-plugins/blob/main/docs/ecosystem/SECURITY-MODEL.md).
To report a vulnerability, see
[SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md).

## Limitations

- **One product page is a sample, not a crawl.** A clean product page says nothing about the
  other products, and other templates (collections, blog posts) aren't checked at all.
- **JavaScript isn't run.** store-check reads the HTML the server sends. Metadata or JSON-LD that
  a script adds later is invisible to it; Google renders JavaScript, but many AI crawlers don't.
- **Results can differ by country, user agent or bot protection.** Stores vary redirects, prices
  and pages by location, and bot protection (a CDN's or the platform's) may answer store-check
  with a 403, a 429 or a challenge page that Googlebot never sees. The requests come from your
  network with store-check's `User-Agent`.
- **Robots rules are what the file says, not what crawlers do.** Some AI operators say their
  user-triggered fetchers may ignore robots.txt; see `robots-txt-lint`'s notes in the JSON.
- **The product heuristic is conservative** and skips stores whose product URLs don't follow the
  Shopify or default WooCommerce patterns. Pass `--product` for those.
- **Only the origin is checked.** A store in a subdirectory (`example.com/shop/`) is checked at
  `example.com/`, which is where robots.txt and the sitemap live anyway.
- **The security header score is security-header-audit's**, and is not a security
  certification.
- A pass means none of these linters found a problem. It doesn't predict rankings, rich results
  or AI citations.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)

# WebSync developer ecosystem: audit

Stage 0 audit, 24 November 2026. It covers the WebSync site (`C:\Wamp\www\websync`, live at
websync.in), the `websync-validators` package (now `packages/validators` in this repository),
and the public npm registry. Every figure has a source. npm weekly downloads come from
`api.npmjs.org/downloads/point/last-week/<name>` and were read on 24 November 2026.

**Not available during this audit:** GitHub CLI or API access (so there is no repository
listing beyond the two remotes in local git config), npm publish rights (`npm whoami` returned
401), and search-volume data. Nothing below claims search demand.

## 1. What exists

### The site

| Area | Facts (source) |
|---|---|
| Stack | Next.js 16.2 static export, React 19, Tailwind 4, shadcn/Base UI. Hosted on Hostinger behind its CDN. No Node server at request time (`websync/AGENTS.md`). |
| Tools | 111 enabled browser tools: document 20, business 19, marketing 19, text 18, design 15, developer 11, calculator 4, data 3, security 2 (`websync/docs/audit-2026-11.md`). One folder per tool under `features/<slug>/`. |
| Server side | Stateless PHP at `/apis/`, 6 routes: `ip-info`, `seo-fetch`, `header-check`, `dns-lookup`, `contact-send`, `newsletter-subscribe`. Each route has a per-IP rate limit (`apis/routes.php`). |
| SSRF guard | `safeFetch()` in `apis/config.php`. It allows http/https on ports 80/443/8080/8443 only, refuses credentials in URLs, requires every A and AAAA record to be public (CIDR blocklist including CGNAT, NAT64 and 6to4), and refuses `localhost`. It pins the vetted IP with `CURLOPT_RESOLVE` against DNS rebinding, re-checks every redirect hop (5 at most), shares one time budget across hops, and never shows curl error text to the client. This is mature and reusable. |
| Quality gates | `check:design` (design-system invariants), ESLint in the build, `node --test` unit tests for about 15 tools, a screenshot/content-parity harness (`scripts/shot.mjs`), `check:seo`, `check:live`. |
| SEO | Sitemap generator, `llms.txt` and `llms-full.txt` generator (`scripts/generate-llms-txt.js`), IndexNow script, per-page JSON-LD, canonical on all 204 URLs. |
| Positioning | `websync/docs/strategy-2026-11.md`: "Practical ecommerce operations knowledge ... free tools, detailed guides and working templates for online sellers and the people who build their stores." It says explicitly that the site must not drift into "a general dev-utility directory". |
| Analytics | GA4 and Clarity, both consent-gated, plus a `trackToolRun()` helper that is not yet wired into most tools (site backlog M4). There is no tool-usage data. |

### Published packages and repositories

| Asset | Facts |
|---|---|
| `websync-validators` 1.0.0 on npm | Published 21 November 2026. 244 downloads in its first week (npm API). Zero dependencies, 258 passing tests. GitHub: `idrisiRehan/websync-validators` (one commit). The site's five validator pages already link to it. |
| `idrisiRehan/websync` | The site's repository (from `git remote -v`). |
| npm scope `@websync` | Unknown: a 404 for `@websync/core` doesn't show whether the org name is free. Not needed (see NAMING-REGISTER.md). |

## 2. Existing tools that map to the brief's candidates

The brief lists 20 candidates. The site already ships 10 of them in some form. These are the
reusable assets:

| Brief candidate | Existing site tool | Logic as a testable module? |
|---|---|---|
| security-header-audit, headerpeek | Security Header Checker | **Yes**: `features/security-header-checker/lib/analyze.ts`, 468 lines, 662 lines of tests, every rule cites its RFC/W3C section |
| sitemap-surgeon | Sitemap Validator | **Yes**: `lib/validate.ts`, 219 lines, sitemaps.org rules, no tests |
| urlsmith (UTM part) | UTM Builder | Yes: `lib/buildUtm.ts` with tests |
| metacheck | SEO Analyzer, SERP Preview | **No**: 636 lines inside one React component |
| jsonlens | JSON Formatter | No: inside the component |
| text-diff-cli | Text Diff | No |
| llms-txt-kit | build script `generate-llms-txt.js` | Site-specific script |
| (DNS) | DNS Lookup | PHP endpoint |
| (validators) | VAT, IBAN, ABN, routing, GSTIN pages | **Duplicated**: see 3.1 |
| (catalog ids) | GTIN Converter, ISBN/ASIN Validator | Yes: `lib/gtin.ts` with tests, `features/isbn-asin-validator/lib/isbn.ts` |

Not present on the site: redirect chain inspection, robots.txt testing, link crawling, cron,
regex, mock servers, JSON-LD validation, content extraction, an MCP server.

## 3. Findings

> **Owner decision, 24 November 2026:** the website is out of scope and stays unchanged.
> Findings about the site (3.1 and 3.3) are kept for reference only. Packages are built and
> released independently.

### 3.1 Validator logic is duplicated (DRY)

The site carries its own copies of the code published as `websync-validators`.
`diff` shows only cosmetic differences: an inlined `CheckStatus` type, one renamed function
(`normalizeNumber` vs `normalizeAbn`) and one comment. A fix in one copy won't reach the other.
**Fix:** the site depends on `websync-validators` and deletes its copies (NEXT-ACTIONS.md).
The same rule applies to every package extracted from now on: one source of logic, consumed
by the site.

### 3.2 Positioning tension

The brief asks for a general developer-tools brand. The site's own strategy (owner-approved,
November 2026) puts ecommerce operations first and warns against becoming a dev-utility
directory. These are reconciled as follows, and this audit recommends it:

- Packages are **extracted from tools the site already has**, where the site's version is
  already rigorous. That adds no new thin pages, and each package strengthens an existing page.
- New web tools are added only when they serve store owners or the developers who build
  stores (sitemaps, headers, product data, business identifiers), not general-purpose utilities.
- Developer content lives in package READMEs and repository docs. Site pages stay task-led.

### 3.3 Existing tools that need work

| Tool | Issue | Source |
|---|---|---|
| Security Header Checker | Flags a version-less `Server` header (for example `Server: hcdn`, which websync.in sends) with a message about revealing the version. Mozilla's Observatory doesn't penalise `Server` at all. Proposed for 1.1 of both the package and the tool (ROADMAP R-4). | this audit, live run |
| websync.in itself | `Strict-Transport-Security: max-age=300`: stage 1 of the planned HSTS rollout (site backlog T1) is still live. `security-header-audit` scores the site 85 and warns on it. | live CLI run, 24 Nov 2026 |
| Sitemap Validator | No unit tests for its rules. | `features/sitemap-validator/lib/` |
| Product CSV Validator (Shopify) | Knows only Shopify's legacy column names. A file in Shopify's current format (`URL handle`, `Price` ...) gets "Required column Handle is missing", and its `Price` values aren't checked at all. Extra-image rows (only handle and image URL) are reported as duplicate variants and counted as variants. Both reproduced against the site's code on 24 Nov 2026; fixed in `product-csv-lint`. | scratch reproduction, WORKLOG |
| SEO Analyzer | Parsing and grading live inside the React component, so they can't be tested or reused. | `features/seo-analyzer/components/SeoAnalyzer.tsx` |
| UTM Builder | Encoding mismatch already logged as site backlog BUG7. | `docs/backlog.md` |

### 3.4 Competitive landscape (npm, weekly downloads, 24 Nov 2026)

| Area | Incumbents | Read |
|---|---|---|
| URL handling | normalize-url 63.2M, query-string 28.8M, tldts 154.6M; tracking-param removal: tidy-url 1.6k (last publish 2024) | Saturated. No room for a new toolkit. |
| JSON | jsondiffpatch 3.5M, microdiff 7.0M, jsonpath-plus 18.6M | Saturated. |
| Diff | diff 203M | Saturated. |
| Cron | cron-parser 34.1M, cronstrue 6.2M, croner 16.7M | Saturated. |
| Mock servers | msw 36.2M, json-server 444k | Saturated. |
| Content extraction | @mozilla/readability 4.5M, turndown 18.6M | Saturated. |
| Link checking | linkinator 316k (maintained), broken-link-checker 29k (2022) | Covered. |
| robots.txt | robots-parser 8.7M (updated Nov 2026); the name `crawlguard` is taken | Covered. |
| Metadata | open-graph-scraper 771k, metascraper 103k (extraction, not auditing) | Partly covered. Auditing is a possible gap. |
| Security headers | helmet 23.6M (sets headers, doesn't grade); csp_evaluator 8.0M (CSP only, used by Lighthouse); @mdn/mdn-http-observatory 5.4k | **Gap.** Mozilla's package is a full scanning service: 24 runtime dependencies including `pg`, `fastify` and `@sentry/node`, Node 24+, live URL scans only (`npm view`). Nothing offers an offline, zero-dependency grader for a headers object. |
| Sitemap validation | sitemap 8.9M (generation; its XML lint shells out to `xmllint`), sitemapper 181k (fetching), sitemap-validator 110 (last publish 2022) | **Gap.** No maintained protocol validator. |
| JSON-LD | schema-dts 4.6M (types only), structured-data-testing-tool 13k (last publish 2022) | Gap, but Google's rich-result requirements change often, so upkeep is high. |
| llms.txt | llms-txt-generator 411, llmstxt 131 | Little evidence of demand. |
| Business identifiers | jsvat 122k, iban 276k, stdnum 441k, gtin 43k (last publish 2022), abavalidator 1.4k, gstin-validator 113 | Crowded per format. websync-validators stands out by reporting each check that failed. |
| MCP | @modelcontextprotocol/sdk 93.8M | The platform is healthy. A WebSync server has value once there are libraries to expose. |

## 4. Answers to the brief's ten audit questions

1. **Reusable assets:** `safeFetch()` and the rate limiter (PHP), the security-header grader
   and its tests, the sitemap rules, the GTIN/ISBN logic, `websync-validators`, the
   tool-page template, the llms.txt generator, and the site's verification scripts.
2. **Tools needing improvement:** see 3.3.
3. **Missing utilities worth building:** redirect-chain inspection (needs a new `apis/`
   endpoint behind `safeFetch()`), JSON-LD checks, robots.txt URL testing (as a web tool on
   top of robots-parser, not a new library).
4. **npm packages:** `security-header-audit` (built), `websync-validators` 1.1 (GTIN/ISBN),
   `sitemap-lint`, later `product-csv-lint`.
5. **Standalone GitHub projects:** one monorepo (ADR 0001). A separate repository only for
   something with a different toolchain, such as an MCP server with its own release cadence.
6. **Web tools:** the existing pages, switched to consume the packages. A redirect checker
   is the strongest new page.
7. **Shared libraries:** not yet. The two packages share nothing but config. A
   `shared-core` package would be an abstraction with no second user (ADR 0001).
8. **Technical risks:** see 5.
9. **Sequence:** ROADMAP.md.
10. **Maintenance:** see 6.

## 5. Technical risks

| Risk | Mitigation |
|---|---|
| Site and package drift apart | The site consumes the packages (ROADMAP R-2, R-5). Never maintain two copies. |
| A package changes a site tool's output silently | Packages extracted from the site keep the site's tests byte-for-byte, except documented, intentional changes (see the `security-header-audit` CHANGELOG). |
| Network-enabled tools become an open proxy | Libraries stay offline. Public fetching happens only through `safeFetch()`. See SECURITY-MODEL.md. |
| Spec drift (CSP, IBAN registry, VAT rules) | Rules cite their source. Owners re-check sources each quarter (section 6). |
| One maintainer | Few packages, zero dependencies, CI on every push, Dependabot monthly. |
| npm publishing errors | Trusted publishing from CI only, tag-driven, version checked against the tag (RELEASING.md). |

## 6. Realistic maintenance budget

With zero runtime dependencies, maintenance is mostly keeping up with specs and answering
issues.

| Package | Recurring work | Estimate |
|---|---|---|
| websync-validators | IBAN registry releases (SWIFT publishes updates several times a year), VAT format changes, GST state codes | 1-2 hours a month |
| security-header-audit | Browser and spec changes to CSP, Permissions-Policy and XFO handling | about 1 hour a month |
| sitemap-lint (planned) | Stable protocol (sitemaps.org 0.9) | under 1 hour a month |
| Repository | Dependabot PRs (dev dependencies and Actions only), CI breakage | about 1 hour a month |

Five or more packages would be a lot for one maintainer at this point. That's
why the shortlist stops at three.

# Candidate pipeline

What we could build next, scored with the method in TOOL-OPPORTUNITY-MATRIX.md (nine criteria,
weights 3/2/3/1/1/2/2/1/2, out of 10). Evidence is npm registry search and download counts,
week of 2026-11-17 to 11-23, plus a registry 404 check for each proposed name. Scores are
judgements based on that evidence, not measurements.

Strategy filter (owner direction, 2026-11-24): ecommerce first; exact, spec-sourced checks
that agents and CI can call; files that crawlers and shopping agents read. No general
developer utilities, nothing that crawls third-party sites.

## In progress

| Candidate | Status |
|---|---|
| `robots-txt-lint` | Building (R-17) |
| `product-feed-lint`, Google Merchant Center and OpenAI (ChatGPT shopping) targets | Building (R-18) |

## Ranked candidates

UV user value, DD developer demand, Diff differentiation, WS fit with WebSync, Maint low
upkeep, Cplx simple to build, Sec low risk. Higher is better on every column.

| # | Candidate | Kind | UV | DD | Diff | npm | GH | WS | Maint | Cplx | Sec | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Cookie attribute audit (`Set-Cookie` Secure, HttpOnly, SameSite, `__Host-` prefix) | `security-header-audit` 1.1 | 6 | 4 | 6 | 4 | 4 | 8 | 8 | 8 | 10 | **6.59** |
| 2 | WebSync GitHub Action running the CLIs in CI | Distribution (R-19) | 7 | 6 | 6 | 2 | 8 | 6 | 7 | 7 | 8 | **6.47** |
| 3 | Feed-versus-page check: feed price and availability against the page's Product JSON-LD | `product-feed-lint` 1.1 | 7 | 4 | 8 | 4 | 4 | 6 | 6 | 6 | 9 | **6.41** |
| 4 | `ai-crawler-log`: which AI crawlers read your site, from your access logs, with spoofed bots flagged | New package | 7 | 5 | 8 | 5 | 6 | 6 | 5 | 6 | 7 | **6.35** |
| 5 | `email-auth-lint`: SPF, DMARC, DKIM and MTA-STS records, and the Gmail and Yahoo bulk sender requirements | New package | 7 | 5 | 5 | 5 | 5 | 7 | 7 | 6 | 7 | **6.12** |
| 6 | `websync-validators` 1.2: more identifiers with offline checks (EORI format, LEI ISO 17442 check digits; confirm demand first) | Extension | 5 | 4 | 4 | 4 | 3 | 8 | 8 | 9 | 10 | **6.06** |
| 7 | Sitemap extensions: image, video and news sitemaps, `xhtml:link` hreflang | `sitemap-lint` 1.1 | 5 | 3 | 7 | 3 | 3 | 7 | 7 | 7 | 9 | **5.94** |
| 8 | `security-txt-lint` (RFC 9116) | New package | 4 | 3 | 6 | 4 | 3 | 5 | 9 | 9 | 9 | **5.76** |
| 9 | Meta (Facebook and Instagram) catalog target | `product-feed-lint` | 6 | 4 | 7 | 3 | 3 | 6 | 4 | 6 | 9 | **5.71** |
| 10 | EU GPSR product safety fields (manufacturer, EU responsible person, warnings) | `product-feed-lint` or `product-csv-lint` profile | 6 | 4 | 7 | 3 | 3 | 6 | 4 | 6 | 9 | **5.71** |
| 11 | `app-links-lint`: `apple-app-site-association` and `assetlinks.json` | New package | 5 | 4 | 7 | 4 | 4 | 3 | 6 | 7 | 9 | **5.59** |
| 12 | `webmanifest-lint` (W3C Web App Manifest) | New package | 4 | 4 | 6 | 4 | 3 | 4 | 7 | 8 | 9 | **5.47** |
| 13 | RSS, Atom, JSON Feed and podcast feed linter | New package | 5 | 4 | 7 | 4 | 4 | 3 | 5 | 6 | 9 | **5.41** |

## Evidence per candidate

1. **Cookie audit.** `set-cookie-parser` (437 million a month) parses but doesn't grade.
   Header graders that include cookies are hosted scanners. Fits the existing grader and its
   offline model: a `Set-Cookie` line is just another header.
2. **GitHub Action.** Puts every package in CI with one step. Needs the packages on npm first.
3. **Feed-versus-page.** Nothing found on npm. Google lists price and availability mismatches
   between feed and landing page as a disapproval reason (to confirm and cite when built).
   Reuses `schemaview` for the page side; the caller supplies both texts, so it stays offline.
4. **ai-crawler-log.** Nothing found that reads access logs for AI crawlers. Nearby:
   `crawler-user-agents` (261,746 a month) is a user-agent list only; `googlebot-verify`
   (1,245) verifies Google only; `@datafast/ai-crawl` (149,739) is a hosted tracker's SDK.
   The library would parse common log formats and classify AI crawlers from a sourced table
   (shared with `robots-txt-lint`); the CLI would verify IPs against ranges the operators
   publish (to confirm per operator before building). Logs contain IP addresses, so all
   processing stays local. Name `ai-crawler-log` is free.
5. **email-auth-lint.** Store order emails depend on these records. Incumbents:
   `email-domain-check` (12,841 a month), `@sdxc/email-auth` (846), `mailauth-records` (361),
   `spf-master` (259). Differentiation would be rule-by-rule findings with RFC citations and
   the published bulk sender requirements. Library on record text (offline); CLI does DNS
   lookups. Name `email-auth-lint` is free.
6. **Validators 1.2.** EORI has only API clients on npm (`@opendpp/eori`, 66 a month). LEI
   demand is unchecked. Small, cheap additions to a package that already has users.
7. **Sitemap extensions.** Only generators exist (`sitemap`, 34.9 million a month). Google
   documents image, video and news sitemap tags; the linter already has the XML reader.
8. **security-txt-lint.** `sectxt` (18,384 a month) was last published in 2021;
   `create-security-txt` (338) generates. Cheap, stable spec, low demand.
9. **Meta catalog.** `node-product-catalog-feed` (4,627 a month, 2021) has no description and no
   rules. Meta's catalog spec changes often, which is the upkeep cost.
10. **GPSR.** One Medusa plugin (457 a month). Useful for EU sellers, but it touches regulation:
    the checks must be limited to the presence and format of fields the regulation and
    marketplaces name, with no claim of legal compliance.
11. **App links.** `deeplinkping` (13 a month) is the only validator found. Off the ecommerce
    core, but misconfigured app links are common and the specs are exact.
12. **webmanifest-lint.** `web-app-manifest-validator` (46,005 a month) was last published in
    2020. Moderate demand, weak WebSync fit.
13. **Feed linter.** Only parsers and generators exist (`rss-parser`, `feed`, `feedsmith`).
    Podcasts add Apple's requirements. Off the ecommerce core.

## Rejected in this round

| Idea | Why |
|---|---|
| CSP evaluator | `csp_evaluator` (Google, 31 million a month) |
| Tracking number validator | `ts-tracking-number` (96,858 a month) |
| Postal code validator | `postal-code-checker` (65,647), `postal-codes-js` (382,955) |
| EIN and TIN validators | `ein-validator` (395,866), `tin-validator` (35,953) |
| Shopify theme linter | Shopify's own `@shopify/theme-check-node` |
| Accessibility linter | `axe-core` (485 million a month) |
| Core Web Vitals | `web-vitals` (343 million a month); also needs a browser |
| ads.txt and sellers.json | Publisher niche, off strategy; `adstxt-validator` and others exist |
| BIMI | Several small packages; follows email auth if that ships |
| Agent context files, MCP linting, agent readiness scores | See TOOL-OPPORTUNITY-MATRIX.md, round 2b |

## Recommended order

1. Finish and review `robots-txt-lint` and `product-feed-lint` (both targets).
2. `ai-crawler-log`: the AI-niche package with no direct competitor, and it shares the crawler
   table with `robots-txt-lint`.
3. Feed-versus-page check in `product-feed-lint` 1.1.
4. Cookie audit in `security-header-audit` 1.1, together with the R-4 decision.
5. `email-auth-lint`.
6. GitHub Action, once the packages are on npm.

Everything below that waits for download numbers from the published packages.

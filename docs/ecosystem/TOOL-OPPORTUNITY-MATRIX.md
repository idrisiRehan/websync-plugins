# Tool opportunity matrix

Scores for the brief's 20 candidates, plus two that came out of the audit. The evidence behind
each score is in [AUDIT.md](AUDIT.md) section 3.4 (npm weekly downloads, 24 November 2026) and
section 2 (what the site already has). The scores are judgements based on that evidence, not
measurements. No search-volume data was available, so "developer demand" relies on npm
adoption of the incumbents and on whether the site already serves the need.

## Scale

Each criterion is scored 1 to 10, where 10 is always better for WebSync:

| Criterion | Weight | 10 means |
|---|---|---|
| User value | 3 | solves a real, recurring problem |
| Developer demand | 2 | clear evidence developers need this |
| Differentiation | 3 | no maintained package does it this way |
| npm potential | 1 | useful as a programmatic package |
| GitHub potential | 1 | likely to attract issues, stars, contributors |
| WebSync integration | 2 | strengthens an existing site tool or page |
| Maintenance cost | 2 | **low** ongoing cost |
| Technical complexity | 1 | **simple** to build well |
| Security risk | 2 | **low** risk (offline beats network) |

Weighted score = sum of (score x weight) / 17.

## Matrix

| Candidate | UV | DD | Diff | npm | GH | WS | Maint | Cplx | Sec | Weighted |
|---|---|---|---|---|---|---|---|---|---|---|
| security-header-audit (#10) | 7 | 5 | 7 | 6 | 6 | 10 | 8 | 9 | 10 | **7.59** |
| websync-validators 1.1 (catalog ids + site migration) | 8 | 5 | 6 | 6 | 5 | 10 | 8 | 9 | 10 | **7.53** |
| sitemap-lint (#6 sitemap-surgeon) | 6 | 4 | 7 | 5 | 5 | 9 | 8 | 7 | 9 | **6.82** |
| product-csv-lint (not in brief) | 7 | 4 | 8 | 4 | 4 | 10 | 4 | 6 | 9 | **6.65** |
| websync-mcp (#20, offline tools only) | 6 | 5 | 5 | 4 | 6 | 7 | 6 | 6 | 7 | **5.82** |
| metacheck (#5) | 7 | 5 | 4 | 4 | 4 | 8 | 5 | 5 | 6 | **5.53** |
| schemaview (#19) | 7 | 4 | 6 | 4 | 5 | 6 | 3 | 4 | 8 | **5.53** |
| llms-txt-kit (#18) | 4 | 3 | 5 | 3 | 4 | 7 | 6 | 7 | 9 | **5.35** |
| redirect-inspector (#3) | 7 | 5 | 5 | 5 | 5 | 6 | 5 | 5 | 3 | **5.24** |
| urlsmith (#1) | 6 | 4 | 2 | 3 | 3 | 5 | 7 | 7 | 9 | **5.12** |
| crawlguard (#8) | 6 | 5 | 2 | 2 | 3 | 5 | 6 | 6 | 8 | **4.88** |
| cronview (#14) | 6 | 5 | 2 | 2 | 3 | 3 | 7 | 6 | 9 | **4.88** |
| jsonlens (#2) | 5 | 3 | 2 | 3 | 3 | 5 | 7 | 7 | 9 | **4.82** |
| agent-access-check (#17) | 5 | 3 | 6 | 3 | 5 | 6 | 4 | 4 | 4 | **4.65** |
| headerpeek (#4) | 5 | 4 | 3 | 3 | 3 | 6 | 6 | 6 | 4 | **4.47** |
| webtiming (#15) | 5 | 3 | 5 | 3 | 4 | 4 | 6 | 5 | 3 | **4.35** |
| text-diff-cli (#12) | 4 | 3 | 1 | 2 | 2 | 4 | 7 | 7 | 9 | **4.24** |
| webclean (#16) | 6 | 6 | 2 | 3 | 4 | 4 | 4 | 4 | 4 | **4.18** |
| regex-lab (#11) | 5 | 4 | 2 | 2 | 3 | 3 | 6 | 5 | 6 | **4.06** |
| mockroute (#13) | 6 | 5 | 2 | 3 | 4 | 2 | 4 | 5 | 5 | **4.00** |
| linkhound (#7) | 7 | 5 | 2 | 3 | 4 | 4 | 3 | 3 | 2 | **3.82** |
| sitegraph (#9) | 5 | 3 | 4 | 3 | 5 | 4 | 3 | 3 | 2 | **3.65** |

## Decisions

### Shortlist (3)

1. **security-header-audit.** The site's grader is already spec-accurate and well tested. The
   only maintained alternative needs Postgres, Fastify and Node 24, and scans live URLs.
   Nothing grades a headers object offline, which is what developers need to assert headers in
   tests and CI. Built in Stage 2.
2. **websync-validators 1.1.** Already published, with adoption from its first week (244
   downloads). Next: the site consumes the package instead of its copies, and GTIN and ISBN
   check digits come over from the site (`gtin` on npm, 43k a week, hasn't been published
   since 2022).
3. **sitemap-lint.** No maintained sitemaps.org validator exists. The site has the rules
   already. Design: rules run on any DOM-like `Element`, so the browser uses `DOMParser` and
   Node passes in a parser of the caller's choosing. The package stays dependency-free and
   never resolves external entities.

### Update, 2026-11-24 (owner decision)

The owner asked for the whole queue to be built: `metacheck`, `schemaview`, `llms-txt-kit` and
`redirect-inspector` are now built and ready to publish (ROADMAP R-11 to R-14). The scores
above are unchanged and still describe the evidence at the time. Download numbers after
publication decide which of them get further work. `redirect-inspector` shipped as a CLI and
library for operators, not as a public web tool, so it needs no site endpoint.

### Watchlist

- **product-csv-lint.** Strongest ecommerce fit and no npm competitor found. But Shopify and
  WooCommerce change their CSV formats, so upkeep is real. Revisit after the shortlist ships.
- **websync-mcp.** Worth building once three offline libraries exist. Exposing only offline
  tools (identifier validation, header grading from supplied headers, sitemap linting from
  supplied XML) gives an MCP server with no SSRF surface at all.
- **redirect-inspector.** A strong web tool, because nothing on the site shows redirect
  chains. It needs a new `apis/` endpoint behind `safeFetch()`, so it is a site feature first
  and a package second.
- **metacheck, schemaview.** Real value, but first the SEO Analyzer's logic has to come out of
  its component, and JSON-LD rules follow Google's changing requirements.

### Rejected

urlsmith, jsonlens, text-diff-cli, cronview, regex-lab, mockroute, webclean, linkhound,
crawlguard, sitegraph, headerpeek (folded into security-header-audit), webtiming and
agent-access-check.

Each is either well served by a maintained package with millions of weekly downloads (see
AUDIT.md 3.4), has a name already taken on npm (crawlguard, sitegraph, text-diff-cli), or has
no evidence of demand. Rebuilding them would add maintenance without giving anyone a reason to
switch.

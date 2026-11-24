# Roadmap

Last updated: 2026-11-24. Statuses: DISCOVERY, PLANNED, APPROVED, IN_PROGRESS, TESTING,
SECURITY_REVIEW, READY_TO_RELEASE, RELEASED, MAINTENANCE, PAUSED, REJECTED.

**Scope (owner decision, 2026-11-24):** this initiative builds the plugin packages in this
repository only. The WebSync website (`C:\Wamp\www\websync`) is not changed. Packages link to
the matching site tools, but the site keeps its own code.

## Projects

| Project | Priority | Status | Repository | npm | Phase | Tests | Docs | Security review | Publication | Blockers | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| security-header-audit | 1 | READY_TO_RELEASE | `packages/security-header-audit` | `security-header-audit` 1.0.0 (name free) | Stage 2 done | 118 passing (rules, parsing, CLI end-to-end; CSP must restrict script sources, wildcard frame-ancestors is not clickjacking protection) | README, CHANGELOG, example | Done: library offline, CLI user-run, 1 MB `--raw` cap | Pending owner approval | GitHub repo, publish approval | Owner: publish |
| websync-validators | 2 | 1.0.0 RELEASED; 1.1.0 READY_TO_RELEASE | `packages/validators` | `websync-validators` 1.0.0 live, 1.1.0 ready | Stage 3 done | 295 passing; GTIN/ISBN differential test vs the site's code: 200,000 inputs, 0 mismatches | README, CHANGELOG | Offline library | Pending owner approval | Publish approval | Owner: publish 1.1.0 |
| sitemap-lint | 3 | READY_TO_RELEASE | `packages/sitemap-lint` | `sitemap-lint` 1.0.0 (name free) | Stage 3 done | 84 passing (reader, 23 rules, 50k-entry runs including a single-line file, CLI end-to-end); fuzzed against fast-xml-parser | README, CHANGELOG, examples, ADR 0002 | Done: no DTD processing, 50 MB read cap, gzip cap | Pending owner approval | Publish approval | Owner: publish |
| product-csv-lint | 4 | READY_TO_RELEASE | `packages/product-csv-lint` | `product-csv-lint` 1.0.0 (name free) | Stage 3 done | 110 passing (CSV parser, both platforms, `readProducts`, CLI end-to-end) | README, CHANGELOG, examples, ADR 0003 | Done: offline, no network in CLI, 50 MB read cap | Pending owner approval | Publish `websync-validators` 1.1.0 first | Owner: publish after validators |
| metacheck | 6 | READY_TO_RELEASE | `packages/metacheck` | `metacheck` 1.0.0 (name free) | Done | 134 passing (tokenizer with fuzz and linear-time tests, 41 rules, head/body tracking, CLI end-to-end); independent review fixed 5 defects | README, CHANGELOG, examples, ADR 0005 | Done: library offline, CLI read cap enforced while streaming | Pending owner approval | Publish approval | Owner: publish |
| schemaview | 7 | READY_TO_RELEASE | `packages/schemaview` | `schemaview` 1.0.0 (name free) | Done | 211 passing (JSON parser vs `JSON.parse`, 24 rules, 19 rich-result types incl. Product variants, CLI end-to-end); independent review fixed 5 defects and spot-checked 15 types against Google's pages; `www.schema.org` context now a warning | README, CHANGELOG, examples | Done: library offline, CLI read cap | Pending owner approval | Publish `metacheck` first | Owner: publish after metacheck |
| llms-txt-kit | 8 | READY_TO_RELEASE | `packages/llms-txt-kit` | `llms-txt-kit` 1.0.0 (name free; `llmstxt-kit` exists) | Done | 92 passing (18 rules, build round trip with a 2000-case property test, CLI end-to-end); independent review fixed 5 defects including a ReDoS | README, CHANGELOG, examples | Done: library offline, CLI read cap | Pending owner approval | Publish approval | Owner: publish |
| redirect-inspector | 9 | READY_TO_RELEASE | `packages/redirect-inspector` | `redirect-inspector` 1.0.0 (name free) | Done | 56 passing against a local HTTP server (13 rules, --expect, --map); independent review fixed 4 defects | README, CHANGELOG, example map | Done: network library tier (SECURITY-MODEL.md), http(s) only, timeouts, bodies never read | Pending owner approval | Publish approval | Owner: publish |
| robots-txt-lint | 11 | READY_TO_RELEASE | `packages/robots-txt-lint` | `robots-txt-lint` 1.0.0 (name free) | Done | 108 passing (15 rules, RFC 9309 matcher checked against every RFC and Google example, 21 AI crawlers, CLI end-to-end); independent review fixed 7 defects, linted 26 real sites | README, CHANGELOG, examples | Done: library offline, CLI 1 MiB read cap | Pending owner approval | Publish approval | Owner: publish |
| product-feed-lint | 12 | READY_TO_RELEASE | `packages/product-feed-lint` | `product-feed-lint` 1.0.0 (name free) | Done | 282 passing (34 rules, Google and OpenAI targets, TSV/CSV/XML/JSONL, CLI end-to-end); independent review fixed 11 defects and verified the tables against the source pages | README, CHANGELOG, examples, ADR 0006 | Done: library offline, CLI 100 MB read cap | Pending owner approval | Publish `sitemap-lint` and `product-csv-lint` first | Owner: publish after them |
| product-feed-build | 13 | READY_TO_RELEASE | `packages/product-feed-build` | `product-feed-build` 1.0.0 (name free) | Done | 134 passing (Shopify current and legacy, WooCommerce, Google XML/TSV and OpenAI JSONL/CSV/TSV, every output re-linted, round trips, CLI end-to-end); independent review fixed 9 defects using Shopify's and WooCommerce's own sample exports | README, CHANGELOG, examples, ADR 0007 | Done: library offline, CLI 50 MB read cap | Pending owner approval | Publish its dependencies first | Owner: publish after them |
| store-check | 14 | READY_TO_RELEASE | `packages/store-check` | `store-check` 1.0.0 (name free) | Done | 72 passing against local servers (budget, timeouts, caps, gzip bombs, hostile responses, CLI end-to-end); independent review fixed 6 defects and found a quadratic XML line count in `sitemap-lint` (fixed), run on 13 real stores | README, CHANGELOG, example, ADR 0007 | Done: network library tier, at most 20 requests per run, body caps | Pending owner approval | Publish its dependencies first | Owner: publish after them |
| feed-page-check | 15 | READY_TO_RELEASE | `packages/feed-page-check` | `feed-page-check` 1.0.0 (name free) | Done | 79 passing (exact decimal comparison, Offer/AggregateOffer/ProductGroup shapes, variant matching, sale windows, local-server CLI); independent review fixed 9 defects across it, `schemaview` and the shared fetcher, checked on 10 real stores | README, CHANGELOG, examples, ADR 0008 | Done: library offline; CLI fetches feed links within a request budget | Pending owner approval | Publish `product-feed-lint`, `schemaview`, `redirect-inspector` first | Owner: publish after them |
| ai-crawler-log | 16 | READY_TO_RELEASE | `packages/ai-crawler-log` | `ai-crawler-log` 1.0.0 (name free) | Done | 111 passing (log formats, IP/CIDR maths fuzzed against Node, bounded memory under a 48 MB heap, 1M-line run, CLI end-to-end); independent review fixed 5 defects and re-verified all 15 IP lists | README, CHANGELOG, examples, ADR 0008 | Done: library offline; no client IP in output; CLI fetches only the operators' IP lists | Pending owner approval | Publish `robots-txt-lint`, `redirect-inspector` first | Owner: publish after them |
| websync-mcp | 10 | READY_TO_RELEASE | `packages/websync-mcp` | `websync-mcp` 1.0.0 (name free) | Done | 50 passing, including the official SDK client calling all nine tools over stdio | README, CHANGELOG, ADR 0004 | Done: tools take text only, no network or filesystem | Pending owner approval | Publish the six offline packages first | Owner: publish last |
| urlsmith, jsonlens, headerpeek, linkhound, crawlguard, sitegraph, regex-lab, text-diff-cli, mockroute, cronview, webtiming, webclean, agent-access-check | n/a | REJECTED | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | See TOOL-OPPORTUNITY-MATRIX.md |

## Numbered work items

| ID | Item | Status | Owner |
|---|---|---|---|
| R-1 | Monorepo foundation: workspaces, shared tsconfig, text check, CI, release workflow, templates | Done | agent |
| R-2 | Site consumes `websync-validators` | Dropped (site out of scope) | n/a |
| R-3 | `websync-validators` 1.1: GTIN and ISBN | Done, awaiting publish | agent |
| R-4 | `security-header-audit`: stop penalising a `Server` value with no version number | Done in 1.0.0 (owner decided 2026-11-25) | agent |
| R-5 | Site consumes `security-header-audit` | Dropped (site out of scope) | n/a |
| R-6 | websync.in HSTS max-age | Dropped (site out of scope; left as a finding in AUDIT.md) | n/a |
| R-7 | `sitemap-lint` 1.0 | Done, awaiting publish | agent |
| R-8 | Archive `idrisiRehan/websync-validators` with a pointer to the monorepo once it's public | PLANNED | owner |
| R-9 | `websync-mcp` 1.0 | Done, awaiting publish | agent |
| R-10 | `product-csv-lint` 1.0 | Done, awaiting publish | agent |
| R-11 | `metacheck` 1.0, with the shared HTML tokenizer (ADR 0005) | Done, awaiting publish | agent |
| R-12 | `schemaview` 1.0 | Done, awaiting publish | agent |
| R-13 | `llms-txt-kit` 1.0 | Done, awaiting publish | agent |
| R-14 | `redirect-inspector` 1.0 | Done, awaiting publish | agent |
| R-15 | `websync-mcp`: `lint_page_metadata`, `validate_structured_data`, `lint_llms_txt` | Done, part of 1.0.0 | agent |
| R-16 | `schemaview` rule table: recheck Google's structured data docs and updates log | Every quarter (next: 2027-02) | agent |
| R-17 | `robots-txt-lint` 1.0, with the AI crawler table | Done, awaiting publish | agent |
| R-18 | `product-feed-lint` 1.0: Google Merchant Center and OpenAI (ChatGPT shopping) targets (ADR 0006) | Done, awaiting publish | agent |
| R-19 | GitHub Action running the CLIs in CI | PLANNED, after publication | agent |
| R-20 | `websync-mcp`: `lint_robots_txt`, `lint_product_feed` | Done, part of 1.0.0 | agent |
| R-21 | Quarterly recheck of the AI crawler table (`robots-txt-lint`) and both feed requirement tables (`product-feed-lint`) | Every quarter (next: 2027-02) | agent |
| R-22 | Next candidates: see CANDIDATE-PIPELINE.md | DISCOVERY | owner and agent |
| R-23 | `product-feed-build` 1.0: store export to Google and ChatGPT shopping feeds | Done, awaiting publish | agent |
| R-24 | `store-check` 1.0: one report of what search engines and AI agents see on a store | Done, awaiting publish | agent |
| R-25 | `feed-page-check` 1.0: feed price and availability against the product page | Done, awaiting publish | agent |
| R-26 | `ai-crawler-log` 1.0: AI crawlers in access logs, with spoofed bots flagged | Done, awaiting publish | agent |
| R-27 | Shared `createFetcher()` in `redirect-inspector` (ADR 0008) | Done | agent |
| R-28 | Site growth programme on websync.in (owner, 2026-11-24): new tools built on these packages, Search Console wins, technical SEO, original research | IN_PROGRESS (branch `growth` in the site repo) | agent |

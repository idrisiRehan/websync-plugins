# Roadmap

Last updated: 2026-11-24. Statuses: DISCOVERY, PLANNED, APPROVED, IN_PROGRESS, TESTING,
SECURITY_REVIEW, READY_TO_RELEASE, RELEASED, MAINTENANCE, PAUSED, REJECTED.

**Scope (owner decision, 2026-11-24):** this initiative builds the plugin packages in this
repository only. The WebSync website (`C:\Wamp\www\websync`) is not changed. Packages link to
the matching site tools, but the site keeps its own code.

## Projects

| Project | Priority | Status | Repository | npm | Phase | Tests | Docs | Security review | Publication | Blockers | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|
| security-header-audit | 1 | READY_TO_RELEASE | `packages/security-header-audit` | `security-header-audit` 1.0.0 (name free) | Stage 2 done | 109 passing (rules, parsing, CLI end-to-end) | README, CHANGELOG, example | Done: library offline, CLI user-run | Pending owner approval | GitHub repo, publish approval | Owner: publish |
| websync-validators | 2 | 1.0.0 RELEASED; 1.1.0 READY_TO_RELEASE | `packages/validators` | `websync-validators` 1.0.0 live, 1.1.0 ready | Stage 3 done | 295 passing; GTIN/ISBN differential test vs the site's code: 200,000 inputs, 0 mismatches | README, CHANGELOG | Offline library | Pending owner approval | Publish approval | Owner: publish 1.1.0 |
| sitemap-lint | 3 | READY_TO_RELEASE | `packages/sitemap-lint` | `sitemap-lint` 1.0.0 (name free) | Stage 3 done | 83 passing (reader, 23 rules, 50k-entry run, CLI end-to-end); fuzzed against fast-xml-parser | README, CHANGELOG, examples, ADR 0002 | Done: no DTD processing, 50 MB read cap, gzip cap | Pending owner approval | Publish approval | Owner: publish |
| product-csv-lint | 4 | READY_TO_RELEASE | `packages/product-csv-lint` | `product-csv-lint` 1.0.0 (name free) | Stage 3 done | 75 passing (CSV parser, both platforms, CLI end-to-end) | README, CHANGELOG, examples, ADR 0003 | Done: offline, no network in CLI | Pending owner approval | Publish `websync-validators` 1.1.0 first | Owner: publish after validators |
| metacheck | 6 | READY_TO_RELEASE | `packages/metacheck` | `metacheck` 1.0.0 (name free) | Done | 131 passing (tokenizer with fuzz and linear-time tests, 41 rules, head/body tracking, CLI end-to-end); independent review fixed 5 defects | README, CHANGELOG, examples, ADR 0005 | Done: library offline, CLI read cap enforced while streaming | Pending owner approval | Publish approval | Owner: publish |
| schemaview | 7 | READY_TO_RELEASE | `packages/schemaview` | `schemaview` 1.0.0 (name free) | Done | 190 passing (JSON parser vs `JSON.parse`, 23 rules, 18 rich-result types, CLI end-to-end); independent review fixed 5 defects and spot-checked 15 types against Google's pages | README, CHANGELOG, examples | Done: library offline, CLI read cap | Pending owner approval | Publish `metacheck` first | Owner: publish after metacheck |
| llms-txt-kit | 8 | READY_TO_RELEASE | `packages/llms-txt-kit` | `llms-txt-kit` 1.0.0 (name free; `llmstxt-kit` exists) | Done | 90 passing (17 rules, build round trip with a 2000-case property test, CLI end-to-end); independent review fixed 5 defects including a ReDoS | README, CHANGELOG, examples | Done: library offline, CLI read cap | Pending owner approval | Publish approval | Owner: publish |
| redirect-inspector | 9 | READY_TO_RELEASE | `packages/redirect-inspector` | `redirect-inspector` 1.0.0 (name free) | Done | 53 passing against a local HTTP server (12 rules, --expect, --map); independent review fixed 4 defects | README, CHANGELOG, example map | Done: network library tier (SECURITY-MODEL.md), http(s) only, timeouts, bodies never read | Pending owner approval | Publish approval | Owner: publish |
| websync-mcp | 10 | READY_TO_RELEASE | `packages/websync-mcp` | `websync-mcp` 1.0.0 (name free) | Done | 41 passing, including the official SDK client calling all seven tools over stdio | README, CHANGELOG, ADR 0004 | Done: tools take text only, no network or filesystem | Pending owner approval | Publish the six offline packages first | Owner: publish last |
| urlsmith, jsonlens, headerpeek, linkhound, crawlguard, sitegraph, regex-lab, text-diff-cli, mockroute, cronview, webtiming, webclean, agent-access-check | n/a | REJECTED | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | See TOOL-OPPORTUNITY-MATRIX.md |

## Numbered work items

| ID | Item | Status | Owner |
|---|---|---|---|
| R-1 | Monorepo foundation: workspaces, shared tsconfig, text check, CI, release workflow, templates | Done | agent |
| R-2 | Site consumes `websync-validators` | Dropped (site out of scope) | n/a |
| R-3 | `websync-validators` 1.1: GTIN and ISBN | Done, awaiting publish | agent |
| R-4 | `security-header-audit` 1.1: stop penalising a `Server` value with no version number | DISCOVERY, owner decision (package only) | owner |
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

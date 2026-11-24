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
| websync-mcp | 4 | DISCOVERY | n/a | `websync-mcp` (name free) | Stage 4 | n/a | n/a | Offline tools only planned | n/a | Needs design | Design note (NEXT-ACTIONS) |
| product-csv-lint | 5 | DISCOVERY | n/a | not checked | Watchlist | n/a | n/a | Offline | n/a | Upkeep cost | Re-score |
| redirect-inspector | 6 | PAUSED | n/a | n/a | Watchlist | n/a | n/a | Would need a public fetch service | n/a | Out of scope while the site is unchanged | n/a |
| metacheck, schemaview, llms-txt-kit | 7 | PAUSED | n/a | n/a | Watchlist | n/a | n/a | n/a | n/a | n/a | n/a |
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
| R-9 | `websync-mcp`: design note, then build if approved | PLANNED | agent |

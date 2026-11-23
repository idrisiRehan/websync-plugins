# Roadmap

Last updated: 2026-11-24. Statuses: DISCOVERY, PLANNED, APPROVED, IN_PROGRESS, TESTING,
SECURITY_REVIEW, READY_TO_RELEASE, RELEASED, MAINTENANCE, PAUSED, REJECTED.

## Projects

| Project | Priority | Status | Repository | npm | WebSync integration | Phase | Done | Tests | Docs | Security review | Publication | Blockers | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| security-header-audit | 1 | READY_TO_RELEASE | `packages/security-header-audit` | `security-header-audit` (name free) | Site tool runs the same rules; switch it to the package (R-5) | Stage 2 | 90% | 109 passing (rules, parsing, CLI end-to-end) | README, CHANGELOG, example | Done (SECURITY-MODEL tier: library + CLI) | Pending owner approval | GitHub repo, npm publish approval | Owner: create repo, publish 1.0.0 |
| websync-validators | 2 | RELEASED / MAINTENANCE | `packages/validators` (imported with history) | `websync-validators` 1.0.0 | 5 tool pages link to it; site still runs duplicate copies (R-2) | Stage 3 | 1.0.0 shipped | 258 passing | README, CHANGELOG | Offline library, no network | 1.0.0 live | none | R-2 then R-3 |
| sitemap-lint | 3 | PLANNED | `packages/sitemap-lint` (not created) | `sitemap-lint` (name free) | Site Sitemap Validator to consume it | Stage 3 | 0% | site rules untested today | n/a | XML: DOM parser input only | n/a | Shortlist items 1-2 first | Port rules plus new tests |
| websync-mcp | 5 | DISCOVERY | n/a | `websync-mcp` (name free) | n/a | Stage 4 | 0% | n/a | n/a | Offline tools only planned | n/a | Needs 3 libraries | Design after sitemap-lint |
| product-csv-lint | 4 | DISCOVERY | n/a | not checked | Product CSV Validator | Watchlist | 0% | site has 124 lines of tests | n/a | Offline | n/a | Upkeep cost | Re-score after shortlist |
| redirect-inspector | 6 | DISCOVERY | site `apis/` first | n/a | New tool page | Watchlist | 0% | n/a | n/a | Needs `safeFetch()` endpoint | n/a | n/a | Site feature proposal |
| metacheck, schemaview, llms-txt-kit | 7 | PAUSED | n/a | n/a | SEO Analyzer refactor first | Watchlist | 0% | n/a | n/a | n/a | n/a | SEO Analyzer logic inside component | n/a |
| urlsmith, jsonlens, headerpeek, linkhound, crawlguard, sitegraph, regex-lab, text-diff-cli, mockroute, cronview, webtiming, webclean, agent-access-check | n/a | REJECTED | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | See TOOL-OPPORTUNITY-MATRIX.md |

## Numbered work items

| ID | Item | Status | Owner |
|---|---|---|---|
| R-1 | Monorepo foundation: workspaces, shared tsconfig, text check, CI, release workflow, templates | Done | agent |
| R-2 | Site consumes `websync-validators` from npm and deletes its five duplicate libs (keeps page output identical; the site's tests move to the package where not already covered) | PLANNED, needs owner OK (site `package.json` is shared infrastructure per site AGENTS.md) | agent after approval |
| R-3 | `websync-validators` 1.1: GTIN-8/12/13/14 and ISBN-10/13 from the site's `lib/gtin.ts` and `isbn.ts` | PLANNED | agent |
| R-4 | `security-header-audit` 1.1 proposal: stop penalising a `Server` value with no version number, and say "reveals the server software" when it does. Changes the site tool's output, so owner decides | DISCOVERY | owner decision |
| R-5 | Site Security Header Checker consumes `security-header-audit` after 1.0.0 is published; drops its own `lib/analyze.ts` and test copy | PLANNED, after publish | agent after approval |
| R-6 | websync.in: raise HSTS to `max-age=31536000` (site backlog T1 stage 2; live value is still 300) | Owner | owner |
| R-7 | `sitemap-lint` 1.0 | PLANNED | agent |
| R-8 | Archive `idrisiRehan/websync-validators` with a pointer to the monorepo once it's public | PLANNED | owner |

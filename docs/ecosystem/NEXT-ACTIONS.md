# Next actions

Exact steps to continue. The top section needs the owner. The rest can proceed without input.
Scope: plugin packages in this repository only. The WebSync website is not changed.

## Owner (blocks publication)

1. **Create the GitHub repository `idrisiRehan/websync-plugins`** (name confirmed) and push:
   `git remote add origin https://github.com/idrisiRehan/websync-plugins.git && git push -u origin main`,
   run from `C:\Wamp\www\websync-plugins`. Then enable private vulnerability reporting.
2. **Confirm the SECURITY.md commitment** (acknowledge reports within 5 working days, via
   contact@websync.in), or change it.
3. **Approve publishing three packages.** First publish of a new name is manual (RELEASING.md
   step 5); after that, link the trusted publisher on npmjs.com and release by tag.
   - `security-header-audit` 1.0.0 (new): `cd packages/security-header-audit && npm publish --access public`
   - `sitemap-lint` 1.0.0 (new): `cd packages/sitemap-lint && npm publish --access public`
   - `websync-validators` 1.1.0 (existing name): `cd packages/validators && npm publish`
4. **Decide R-4:** should `security-header-audit` stop penalising a `Server` header that names
   no version (for example `Server: cloudflare`)?

## Agent (no approval needed)

1. **R-9: websync-mcp design note** in `docs/adr/0003-websync-mcp.md`:
   - Tools exposed: `validate_identifier` (validators), `grade_security_headers` (headers
     supplied as text, no fetching), `lint_sitemap` (XML supplied as text).
   - Offline only, so no SSRF surface. Stdio transport. Input size limits per tool.
   - Depends on `@modelcontextprotocol/sdk`, the first runtime dependency, which the ADR must
     justify. Weigh it against keeping it in this monorepo or a separate repo (ADR 0001).
   - Build it only after the three packages are published, since it depends on them from npm.
2. **Re-score the watchlist** (product-csv-lint first) once there is download data for the
   three packages.
3. **Monthly:** record npm weekly downloads for each package in WORKLOG.md.

## Stopping point (2026-11-24)

The repository is clean and committed. `npm run check` passes (487 tests). Nothing has been
published or pushed. Three packages are ready to release: `security-header-audit` 1.0.0,
`websync-validators` 1.1.0 and `sitemap-lint` 1.0.0.

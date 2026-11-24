# Next actions

Exact steps to continue. The top section needs the owner. The rest can proceed without input.
Scope: plugin packages in this repository only. The WebSync website is not changed.

## Owner (blocks publication)

1. **Create the GitHub repository `idrisiRehan/websync-plugins`** (name confirmed) and push:
   `git remote add origin https://github.com/idrisiRehan/websync-plugins.git && git push -u origin main`,
   run from `C:\Wamp\www\websync-plugins`. Then enable private vulnerability reporting.
2. **Confirm the SECURITY.md commitment** (acknowledge reports within 5 working days, via
   contact@websync.in), or change it.
3. **Approve publishing five packages,** in this order (product-csv-lint needs validators 1.1.0; websync-mcp needs all four). First publish of a new name is manual (RELEASING.md
   step 5); after that, link the trusted publisher on npmjs.com and release by tag.
   - `security-header-audit` 1.0.0 (new): `cd packages/security-header-audit && npm publish --access public`
   - `sitemap-lint` 1.0.0 (new): `cd packages/sitemap-lint && npm publish --access public`
   - `websync-validators` 1.1.0 (existing name): `cd packages/validators && npm publish`
   - `product-csv-lint` 1.0.0 (new, after validators 1.1.0): `cd packages/product-csv-lint && npm publish --access public`
   - `websync-mcp` 1.0.0 (new, last): `cd packages/websync-mcp && npm publish --access public`
4. **Decide R-4:** should `security-header-audit` stop penalising a `Server` header that names
   no version (for example `Server: cloudflare`)?

## Agent (no approval needed)

1. **Re-score the watchlist** (metacheck, schemaview, llms-txt-kit) once there is npm download
   data for the published packages. Pick the next package only from evidence.
2. **After publishing:** submit `websync-mcp` to the MCP server registry
   (registry.modelcontextprotocol.io) and work through the distribution checklist in
   CONTENT-STRATEGY.md. Both are external actions that need owner approval.
3. **Monthly:** record npm weekly downloads for each package in WORKLOG.md.

## Stopping point (2026-11-24)

The repository is clean and committed. `npm run check` passes (595 tests). Nothing has been
published or pushed. Five packages are ready to release: `security-header-audit` 1.0.0,
`websync-validators` 1.1.0, `sitemap-lint` 1.0.0, `product-csv-lint` 1.0.0 and `websync-mcp` 1.0.0.

# Next actions

Exact steps to continue. The top section needs the owner. The rest can proceed without input.
Scope: plugin packages in this repository only. The WebSync website is not changed.

## Owner (blocks publication)

1. **Create the GitHub repository `idrisiRehan/websync-plugins`** (name confirmed) and push:
   `git remote add origin https://github.com/idrisiRehan/websync-plugins.git && git push -u origin main`,
   run from `C:\Wamp\www\websync-plugins`. Then enable private vulnerability reporting.
2. **Confirm the SECURITY.md commitment** (acknowledge reports within 5 working days, via
   contact@websync.in), or change it.
3. **Approve publishing thirteen packages,** in this order. `product-csv-lint` needs validators
   1.1.0, `schemaview` needs `metacheck`, `product-feed-lint` needs `sitemap-lint` and
   `product-csv-lint`, `product-feed-build` and `store-check` need the packages they use, and
   `websync-mcp` needs every offline linter. First
   publish of a new name is manual (RELEASING.md step 5); after that, link the trusted
   publisher on npmjs.com and release by tag.
   - `security-header-audit` 1.0.0 (new): `cd packages/security-header-audit && npm publish --access public`
   - `sitemap-lint` 1.0.0 (new): `cd packages/sitemap-lint && npm publish --access public`
   - `websync-validators` 1.1.0 (existing name): `cd packages/validators && npm publish`
   - `product-csv-lint` 1.0.0 (new, after validators 1.1.0): `cd packages/product-csv-lint && npm publish --access public`
   - `metacheck` 1.0.0 (new): `cd packages/metacheck && npm publish --access public`
   - `schemaview` 1.0.0 (new, after metacheck): `cd packages/schemaview && npm publish --access public`
   - `llms-txt-kit` 1.0.0 (new): `cd packages/llms-txt-kit && npm publish --access public`
   - `redirect-inspector` 1.0.0 (new): `cd packages/redirect-inspector && npm publish --access public`
   - `robots-txt-lint` 1.0.0 (new): `cd packages/robots-txt-lint && npm publish --access public`
   - `product-feed-lint` 1.0.0 (new, after sitemap-lint and product-csv-lint): `cd packages/product-feed-lint && npm publish --access public`
   - `product-feed-build` 1.0.0 (new, after metacheck, product-csv-lint and product-feed-lint): `cd packages/product-feed-build && npm publish --access public`
   - `store-check` 1.0.0 (new, after the seven packages it uses): `cd packages/store-check && npm publish --access public`
   - `websync-mcp` 1.0.0 (new, last): `cd packages/websync-mcp && npm publish --access public`
4. **Decide R-4:** should `security-header-audit` stop penalising a `Server` header that names
   no version (for example `Server: cloudflare`)?

## Agent (no approval needed)

1. **Next builds** are ranked in CANDIDATE-PIPELINE.md: the feed-versus-page check and
   `ai-crawler-log` next, then the cookie audit and `email-auth-lint`. Use download data to decide further work on published packages.
2. **Every quarter, recheck the sourced tables:** `schemaview` against Google's structured data
   docs and updates log (R-16), the AI crawler table and both feed tables (R-21). Next check:
   2027-02.
3. **After publishing:** submit `websync-mcp` to the MCP server registry
   (registry.modelcontextprotocol.io) and work through the distribution checklist in
   CONTENT-STRATEGY.md. Both are external actions that need owner approval.
4. **Monthly:** record npm weekly downloads for each package in WORKLOG.md.

## Stopping point (2026-11-24, end of day)

The repository is committed. `npm run check` passes (1,717 tests across thirteen packages).
Nothing has been published or pushed. Thirteen packages are ready to release:
`security-header-audit`, `sitemap-lint`, `product-csv-lint`, `metacheck`, `schemaview`,
`llms-txt-kit`, `redirect-inspector`, `robots-txt-lint`, `product-feed-lint`,
`product-feed-build`, `store-check` and `websync-mcp` at 1.0.0, and `websync-validators` 1.1.0.

# Next actions

Exact steps to continue. The top section needs the owner. The rest can proceed without input.

## Owner (blocks publication)

1. **Confirm the GitHub repository name.** The proposal is `idrisiRehan/websync-plugins`. If
   you pick another, the URLs in each `packages/*/package.json` (`repository`, `bugs`),
   `.github/ISSUE_TEMPLATE/config.yml` and NAMING-REGISTER.md must be updated.
2. **Create the repository and push:**
   `git remote add origin <url> && git push -u origin main`, run from
   `C:\Wamp\www\websync-plugins`. Then enable private vulnerability reporting.
3. **Confirm the SECURITY.md commitment** (acknowledge reports within 5 working days, via
   contact@websync.in), or change it.
4. **Approve publishing `security-header-audit` 1.0.0.** First publish is manual
   (RELEASING.md step 5): `cd packages/security-header-audit && npm login && npm publish --access public`.
   Then link the trusted publisher on npmjs.com so later releases go through CI.
5. **Approve publishing `websync-validators` 1.1.0.** It is already on npm, so you can tag and let CI publish (`git tag websync-validators@1.1.0`) once the trusted publisher is linked, or run `npm publish` from `packages/validators`.
6. **Approve R-2 and R-5** (site consumes the packages; touches the site's `package.json`).
7. **Decide R-4** (`Server` header rule).
8. **Site:** raise HSTS to `max-age=31536000` when ready (site backlog T1 stage 2).

## Agent (no approval needed)

1. **R-7: sitemap-lint 1.0.**
   - Create `packages/sitemap-lint` by copying the layout of `packages/security-header-audit`.
   - Port `websync/features/sitemap-validator/lib/validate.ts`. Keep the logic, and accept a
     parsed `Document` (DOM `Element` interface) so browsers and Node share it.
   - Write tests from scratch. The site has none for this. Cover every sitemaps.org rule,
     sitemap index files, the 50,000 URL and 50 MB limits, bad `lastmod` values, and an XXE
     payload that must not be resolved.
   - Add a CLI (`sitemap-lint <file|url>`). It needs an XML parser in Node; record the choice
     in ADR 0002, because it would be the first dependency.
2. After the owner approves R-2 and 1.1.0 is published: in the site repo, add
   `"websync-validators": "^1.1.0"`. Repoint the imports of the five validator components,
   `lib/gtin.ts`'s users (EAN generator, GTIN converter, ISBN/ASIN validator, product CSV
   validator) and the IBAN generator, then delete the duplicate libs. Adapt for
   `gtinCheckDigit` returning a string. Run `npm test`, `npm run check:design` and
   `node scripts/shot.mjs --only <slug>` for every affected page. There must be no content
   difference.

## Stopping point (2026-11-24)

The repository is clean and committed. `npm run check` passes (404 tests). Nothing has been
published or pushed. Two packages are ready to release: `security-header-audit` 1.0.0 and
`websync-validators` 1.1.0.

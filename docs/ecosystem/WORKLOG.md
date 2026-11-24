# Worklog

Newest first. Decisions, milestones, discoveries and problems.

## 2026-11-24 (pre-release fixes): the known gaps left by the reviews

Owner asked for the open issues to be fixed before publishing. Each fix has regression tests.

- **metacheck:** an HTML start tag such as `<p>`, `<div>`, `<h1>` or `<meta>` (and `</p>`,
  `</br>`) now ends `<svg>`/`<math>` content, per the WHATWG foreign-content rules, so an
  unclosed `<svg>` no longer hides the rest of the page. HTML inside `<foreignObject>`,
  `<desc>`, SVG `<title>` and MathML text elements stays inside.
- **schemaview:** an `AggregateOffer` in a merchant listing is now `type-ineligible` (new
  rule, warning). Google's merchant listing page: "merchant listings require an Offer as the
  merchant has to be the seller". Product snippets still accept it.
- **llms-txt-kit:** setext headings (`===`/`---` underlines) are read, and reported as
  `heading-setext` (new rule): an error for the H1, a warning otherwise, because the
  llmstxt.org Python module only matches `#` lines (checked in `llms_txt/core.py`).
- **redirect-inspector:** different repeated `Location` headers are now `location-multiple`
  (new rule, error; Chrome refuses them) instead of being read as one URL. Repeats of the same
  value are followed. `--expect` accepts a path, resolved against the URL.
- **product-csv-lint, security-header-audit:** CLI input is now read with a streaming cap
  (50 MB and 1 MB).
- `npm run check`: 1,078 tests, pass.

## 2026-11-24 (late night): metacheck, schemaview, llms-txt-kit, redirect-inspector (R-11 to R-15)

Owner asked for the remaining queue to be built autonomously, with tests and docs for GitHub
and npm, using multiple agents.

### How it was built

- The shared HTML tokenizer (`metacheck/src/html.ts`, ADR 0005) was written first, so that
  `metacheck` and `schemaview` would not each grow a parser.
- One agent per package built in parallel, each confined to its own package directory. A
  second agent per package, given the code but not the builder's conclusions, then reviewed it
  for defects and fixed what it could reproduce. The reviews found 19 real defects, each now
  covered by a regression test. Examples: `--expect` reported a match for a redirect loop, a
  quadratic regex in llms.txt heading parsing, hreflang codes Google rejects, `@id` nodes not
  merged before required-property checks.
- Integration: three new `websync-mcp` tools, lockfile, docs, CI text check.

### Decisions

- `redirect-inspector` is the only library that fetches (new "network library" tier in
  SECURITY-MODEL.md). It is not exposed through `websync-mcp`.
- `schemaview` keeps Google's requirements in one table with a source and check date per type.
  FAQ, HowTo, ClaimReview, SpecialAnnouncement and Dataset are reported as deprecated, per
  Google's updates log.
- `llms-txt-kit` follows llmstxt.org v2 (August 2026).
- Package READMEs use absolute links only; `scripts/check-text.mjs` now fails on relative
  links in package READMEs, because npmjs.com can't resolve them. Fixed in the four existing
  READMEs.
- All CLIs with a size cap now enforce it while streaming stdin and files, not after reading.
  Empty numeric options (`--timeout ""`) are now usage errors in every CLI.

### Evidence (npm, week of 2026-11-16 to 11-22)

- redirect checkers: redirect-chain 167, redirect-chain-checker 7, follow-url 9 a week. None
  verifies a redirect map.
- llms.txt validators: turva-llms-txt-validator 665, llmstxt 131, llms-txt-lint 24 a week.
  Generators are far larger (starlight-llms-txt 314,369), which `llms-txt-kit` doesn't target.

### Tests run

- `npm run check` (text, typecheck, 1,067 tests, builds): pass.
- `npm pack` of all nine packages, installed together in a clean project with no registry
  fetches: every CLI, the library imports and a raw MCP session listing seven tools: pass.
- Live runs: metacheck on MDN, BBC, Guardian, IKEA, GitHub, Wikipedia; schemaview on Apple,
  BBC, Guardian, Zappos; llms-txt-kit on websync.in, llmstxt.org, Svelte, Gemini, Anthropic;
  redirect-inspector on websync.in, github.com, google.com, example.com.

## 2026-11-24 (night): websync-mcp 1.0.0 (R-9)

- Local stdio MCP server with four tools over the four packages: `validate_identifier`,
  `grade_security_headers`, `lint_sitemap`, `lint_product_csv`. All take text only, so
  there is no network, filesystem or SSRF surface. They are annotated read-only, idempotent
  and closed-world.
- **Decision (ADR 0004):** implement the stdio JSON-RPC surface directly instead of depending
  on `@modelcontextprotocol/sdk`, whose runtime pulls express, hono, cors, jose and more for
  transports a stdio server doesn't use. The SDK is a dev dependency: its own Client and
  StdioClientTransport drive the real server in the compliance test.
- Protocol versions 2025-11-25 / 2025-06-18 / 2025-03-26 / 2024-11-05 (from the SDK's
  `SUPPORTED_PROTOCOL_VERSIONS`). Bad arguments become `isError` tool results; unknown
  tools and methods become JSON-RPC errors. Internal errors never include a message or stack.
- Context hygiene for assistants: finding lists capped at 200 with `findingsOmitted`, and
  `lint_sitemap` returns `locCount` instead of every URL.
- stdio framing searches only each new chunk for newlines (linear on 50 MB messages) and
  refuses messages over 128 MB.
- Added the `websync-source` export condition to security-header-audit, sitemap-lint and
  product-csv-lint so the server resolves all four from source in development.
- npm arborist bug on the existing `node_modules` while adding the dev dependency (npm 10.7
  and 11 both failed). Fixed by regenerating the lockfile from manifests in a scratch folder
  and running `npm ci`. The old lockfiles were kept in the scratchpad, not deleted.
- Verification: 33 tests (24 handler unit tests plus 9 SDK-client tests, including a
  50,000-entry sitemap over stdio).

## 2026-11-24 (evening): product-csv-lint 1.0.0 (R-10)

Owner: push tomorrow; today is for building plugins. Picked product-csv-lint next (matrix
6.65, the highest unbuilt score).

- **Verified Shopify's spec first** (agent read help.shopify.com product CSV page,
  2026-11-24). Shopify's current format renamed most columns (`URL handle`, `Price`,
  `Product image URL`, `Continue selling when out of stock`, `Weight unit for display`
  ...). Title is the only required column. The page states no file-size limit, so none is
  enforced. Both current and legacy names are accepted, case-insensitively.
- **One shared core** (`core.ts`) for decoding, CSV structure, headers, typed values and
  duplicates. `shopify.ts` and `woocommerce.ts` hold column data plus only their own
  checks. The site had two engines that repeated all of that.
- **New checks:** unexpected quote (the `12" pizza` case, with the exact fix), unterminated
  quote, semicolon delimiter (error for Shopify, warning for WooCommerce), invalid UTF-8,
  barcode check digits on WooCommerce's GTIN column, and Shopify Status, inventory policy and
  gift card values.
- **Bugs found in the site's Shopify validator, reproduced against its code** (site not
  changed, recorded in AUDIT.md 3.3): (1) a current-format file gets "Required column Handle
  is missing" and its prices go unchecked; (2) extra-image rows are reported as duplicate
  variants and counted as variants; (3) option values were joined with no separator, so
  `x|yz` and `xy|z` collided. All three are fixed here and covered by tests.
- Row numbers stay spreadsheet rows when blank lines and multi-line cells are present (the
  site numbered by parsed index).
- **Internal dependency** on websync-validators for barcodes, resolved from source in
  development through the `websync-source` export condition (ADR 0003). It builds, tests
  and typechecks with no `dist/` present.
- Verification: 75 tests. Clean-state `npm run check` with 562 tests passing. Packed both
  tarballs and installed them together in a clean project: library and CLI work.

## 2026-11-24 (later): scope decision, sitemap-lint 1.0.0 (R-7)

### Owner decisions

- GitHub repository name confirmed: `idrisiRehan/websync-plugins`.
- **The WebSync website stays unchanged.** This initiative builds the plugin packages only.
  R-2, R-5 and R-6 are dropped. Site findings stay in AUDIT.md for reference.

### Done

- **sitemap-lint 1.0.0.** 23 rules from the sitemaps.org protocol, each finding with a rule
  id, line and entry number. A built-in strict XML reader (ADR 0002): no dependencies, no
  DTD processing. CLI for files, stdin and URLs, with gzip support and a 50 MB read cap on
  both downloads and decompression.
- Improvements on the site's Sitemap Validator rules: every W3C Datetime form is accepted
  (the site rejected `YYYY`, `YYYY-MM` and `hh:mm` times) and impossible dates are rejected.
  Added: `loc-too-long` (2,048 characters), `loc-unescaped`, unknown and repeated elements,
  `entry-wrong-type`, encoding checks, and a stricter priority format (the site used
  `Number()`, which accepts `0x1` and `1e-1`). A non-http `<loc>` is now an error.
- Verification: 83 tests. A scratch fuzz run of 20,000 mutated sitemaps against fast-xml-parser
  found 0 cases where the reader was more lenient; all 1,332 disagreements were correct
  rejections (see ADR 0002). Live runs on websync.in (217 entries), sitemaps.org and MDN's
  index and gzipped en-US sitemap (it found a real duplicate URL there). Clean install of the
  packed tarball (26 files, 30.4 kB).
- `npm run check`: 487 tests pass.

## 2026-11-24 (later): websync-validators 1.1.0 (R-3)

- Added GTIN (8/12/13/14, conversion, packaging indicator) and ISBN (10/13, conversion). The
  logic was ported from the site's `lib/gtin.ts`, using the package's `checks[]` result
  shape, so callers see which check failed, the same as the other validators.
- API differences from the site, made deliberately: `gtinCheckDigit` returns `string | null`
  (null for non-digit input) instead of a number, matching `routingCheckDigit`. Conversion
  errors reuse the failing check's message. ASIN shape checks stay in the site: they are
  format-only and Amazon-specific.
- Verification: 37 new tests built on published GS1 and Wikipedia examples, plus
  single-digit-mutation sweeps. A scratch differential test of site vs package over 200,000
  generated inputs (validate, convert to all four lengths with and without indicators, and
  ISBN conversion both ways) found 0 mismatches.
- Housekeeping: converted the imported files' working-tree line endings from CRLF to LF
  (`.gitattributes` enforces LF) and removed the package's own `.gitignore`, which repeated
  the root one.
- `npm run check`: 404 tests pass. Pack: security-header-audit 26 files (28.7 kB),
  websync-validators 49 files (50.8 kB).

## 2026-11-24: Stage 0 audit, Stage 1 foundation, Stage 2 first package

### Done

- **Audit** of the site, the validators package and npm. See AUDIT.md. Main findings:
  validator logic is duplicated between the site and the package; the site already has 10 of
  the brief's 20 candidates in some form; most candidates are saturated on npm.
- **Opportunity matrix** for 22 candidates. Shortlist: security-header-audit,
  websync-validators 1.1, sitemap-lint. 13 rejected with evidence.
- **Monorepo** created at `websync-plugins` (ADR 0001). `websync-validators` was imported with
  its history into `packages/validators` (merge commit `108c0d3`). The original folder
  `C:\Wamp\www\websync-validators` was left untouched, and its GitHub remote is unchanged.
- **Shared config:** `tsconfig.base.json` with `noUnusedLocals` and `noUnusedParameters`
  added. Validators compiles cleanly under them. `scripts/check-text.mjs` enforces the
  no-em-dash rule.
- **security-header-audit 1.0.0 built.** It was extracted from the site's
  `features/security-header-checker/lib/analyze.ts`, with the same rules, scores and messages.
  The site's 662-line test file was ported. Added: input normalization (Headers, Node objects,
  pairs, any case), `rating`, `parseRawHeaders()` for curl output, and a CLI with `--json`,
  `--min-score`, `--raw` and `--timeout`. 109 tests, including CLI end-to-end tests against a
  local HTTP server.
- **Release check:** `npm pack` produced 22 files (25.6 kB) before `examples/` was added. Installed the tarball in a clean
  project, then imported the library and ran the installed CLI against https://websync.in/.
- **CI** (Node 22 and 24: check, pack, audit), a tag-driven **release** workflow with npm
  provenance, Dependabot, and issue and PR templates.

### Decisions

- Descriptive npm names for new packages (NAMING-REGISTER.md).
- Package engines: `security-header-audit` needs Node 22 or later (what CI tests). Validators
  keeps its published `>=18`, but CI only verifies 22 and 24. Raise it at the next major.
- Intentional differences from the site's grader, all in the CHANGELOG: header names are
  matched case-insensitively (the site's backend already lower-cases them), values are
  trimmed, and the HSTS max-age is formatted with `en-US` so output doesn't depend on locale.
- Did **not** change the site repository. Its AGENTS.md treats `package.json` as shared
  infrastructure, so R-2 and R-5 wait for owner approval.

### Discoveries

- Live websync.in sends `Strict-Transport-Security: max-age=300` (stage 1 of its HSTS
  rollout) and `Server: hcdn`. It scores 85/100 ("strong").
- The `Server` rule penalises version-less values. Raised as R-4.
- The npm scope `@websync` couldn't be verified. It isn't needed.

### Tests run

- `npm run check` (text check, typecheck, 367 tests, builds): pass.
- `npm run check:pack`: pass.
- Clean-install smoke test of the packed `security-header-audit` tarball: pass.

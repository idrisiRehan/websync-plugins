# Worklog

Newest first. Decisions, milestones, discoveries and problems.

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

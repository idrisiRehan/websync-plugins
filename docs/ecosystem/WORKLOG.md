# Worklog

Newest first. Decisions, milestones, discoveries and problems.

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
- **Release check:** `npm pack` produced 22 files (25.6 kB). Installed the tarball in a clean
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

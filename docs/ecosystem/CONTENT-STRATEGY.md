# Content and distribution strategy

Content exists to explain software that already works. Each item below is tied to a shipped
package and must match its actual behaviour. Verify claims against the source and tests before
publishing. No invented benchmarks, adoption numbers, testimonials or comparisons.

## 1. Where content lives

| Content | Home | Why |
|---|---|---|
| API reference, CLI usage, limitations | Package `README.md` | Rendered on npm and GitHub, versioned with the code |
| Changes | Package `CHANGELOG.md` | Users check it before upgrading |
| Task-led explanation ("why does my site fail HSTS?") | websync.in tool page prose (`content/tools/<slug>.ts`) and guides | Matches the site's positioning (AUDIT.md 3.2) |
| Design decisions | `docs/adr/` | For contributors |

Site tool pages link to the package ("Use this in your own code"). The five validator pages
already do. Package READMEs link to the matching tool page. One link each way, where it helps
the reader.

## 2. Planned content per package

### security-header-audit

1. **Tool page update** (site): add a short "Check headers in CI" section with the
   `--min-score` example and a link to the package. Add an FAQ entry: "Why doesn't
   'wasm-unsafe-eval' lower my score?", answered from the CSP3 rule in the code.
2. **Guide** (site, security topic): "Testing security headers in CI" covers what each header
   protects against, how to assert them in `node:test`, Vitest or Playwright, and how to roll
   out HSTS in stages. websync.in's own rollout (`max-age=300` first) can serve as the worked
   example, because the site really did it.
3. **README examples:** GitHub Actions and a Node test file (both present).

### websync-validators

1. **README section** listing the published sources each validator was checked against
   (present).
2. **Guide:** "Validating VAT numbers offline before calling VIES" covers what a check digit
   catches and what only the register can confirm. Uses the package's actual check output.

### sitemap-lint (when built)

1. **Tool page:** link to the package. Add an FAQ entry on the 50,000 URL and 50 MB limits.
2. **Guide:** the site already has a sitemap errors guide. Add a "check it in your build"
   section rather than a new article.

## 3. Distribution checklist (per release)

Do these only after the package is published, CI is green and the README has been checked on
npm.

| Channel | Action | Fit |
|---|---|---|
| npm | Keywords, description, homepage, repository with `directory` | Always |
| GitHub | Description, topics, release notes from CHANGELOG | Always |
| websync.in | Link from the tool page; mention in the relevant guide | Always |
| Dev.to / Hashnode | One technical article per package, cross-posted with a canonical link to websync.in | When the article teaches something on its own |
| Reddit | r/webdev or r/netsec, only as a useful answer to a matching question, or one post that follows the subreddit's self-promotion rules | Case by case |
| Hacker News | "Show HN" only if the package does something new. The offline header grader may qualify. A validator update doesn't | Rarely |
| Product Hunt | Not suitable for libraries. Consider only for a future web tool launch | No |
| Awesome lists | Submit a PR to a curated list (for example a security-headers or Node security list) when the package meets its inclusion criteria | Yes, once released |
| MDN / OWASP references | Don't submit. Earn citations by being correct | No |

Rules: one account per platform, owned by the maintainer. No fake accounts, votes, stars or
reviews. No automated mass submission. Each post is written for its platform and discloses
that the author maintains the package.

## 4. Measuring

Only metrics we can actually see: npm weekly downloads (API), GitHub stars, issues and
dependents, and the referral count from npm and GitHub to the tool pages in GA4. Record them
in WORKLOG.md each month. Don't publish them on the site unless they're current and sourced.

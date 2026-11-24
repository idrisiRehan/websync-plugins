# Naming register

Every package and repository name, how it was checked, and the decision. npm checks were made
with `npm view <name>` on 24 November 2026. A 404 means no package exists under that name, but
npm can still reject a new name that is too similar to an existing one, so availability is only
confirmed at first publish. Trademark checks were limited to a web-knowledge review: none of
the chosen names is a known product or mark.

## Chosen names

| Name | Type | Status | Check | Notes |
|---|---|---|---|---|
| `websync-validators` | npm | **Published** (1.0.0) | owned | Kept. Renaming a published package would strand existing users. |
| `security-header-audit` | npm | Available (404) | `npm view` | Descriptive. It matches how people search ("security header audit/check"). Nearby: `security-headers` (12 a week, 2022) is a different, abandoned package. |
| `sitemap-lint` | npm | Available (404) | `npm view` | Built (1.0.0 ready). Owner confirmed the name 2026-11-24. |
| `websync-plugins` | GitHub repo | **Confirmed by owner** (2026-11-24) | not checked (no GitHub access) | Matches this folder. |

### Why descriptive names, not `websync-*`, for new packages

Developers find packages by searching for the problem. A descriptive name ranks for that
search. The brand still appears in the author field, README footer, homepage link and
repository. `websync-validators` stays as it is because it's already published.

## Candidate names from the brief

| Candidate | npm (24 Nov 2026) | Decision |
|---|---|---|
| urlsmith | available | rejected (saturated space) |
| jsonlens | available | rejected |
| redirect-inspector | available | watchlist |
| headerpeek | available | merged into security-header-audit |
| metacheck | available | watchlist |
| sitemap-surgeon | available | renamed `sitemap-lint`: says what it does |
| linkhound | available | rejected |
| crawlguard | **taken** (1.0.0, Feb 2026) | rejected |
| sitegraph | **taken** (0.3.0, Jul 2026) | rejected |
| security-header-audit | available | **chosen** |
| regex-lab | available | rejected |
| text-diff-cli | **taken** (1.0.0, May 2026) | rejected |
| mockroute | available | rejected |
| cronview | available | rejected |
| webtiming | available | rejected |
| webclean | available | rejected |
| agent-access-check | available | rejected |
| llms-txt-kit | available | watchlist |
| schemaview | available | watchlist |
| websync-mcp | available | watchlist (Stage 4) |

## Rules

- Check npm and GitHub before creating anything. Record the result here.
- Don't create an empty repository or publish a placeholder to hold a name.
- Use a scoped name (`@websync/...`) only if an unscoped name is unavailable. The org would
  have to be created on npm by the owner first.
- No domains are bought for packages.

# Changelog

All notable changes to `llms-txt-kit` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- `lintLlmsTxt()` with 18 rules from the llmstxt.org proposal (v2, checked 2026-11-24),
  covering empty and HTML files, the H1, heading levels, the summary blockquote, sections, the
  `Optional` section, link syntax and notes, and invalid or duplicate URLs. Errors are kept for
  files a reader can't use; everything else is a warning. Each finding has a rule id and line.
- A parsed document (`title`, `summary`, `details`, `sections` with links and notes) in every
  lint result, with fenced code blocks handled so their contents are never read as structure.
- `buildLlmsTxt()`, which renders the same document shape as canonical markdown and refuses
  values it can't write faithfully, so `buildLlmsTxt(lintLlmsTxt(text).doc)` round-trips.
- `llms-txt-kit` CLI with `lint` (files, stdin and URLs, a bare origin fetches `/llms.txt`,
  relative links resolved against the final URL, a 5 MB read cap, `--json`, `--max-warnings`
  and `--timeout`) and `build` (JSON to markdown on stdout).

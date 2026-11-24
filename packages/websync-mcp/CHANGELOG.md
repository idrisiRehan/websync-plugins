# Changelog

All notable changes to `websync-mcp` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - Unreleased (ready, awaiting publish approval)

### Added

- stdio MCP server with nine read-only, offline tools: `validate_identifier`,
  `grade_security_headers`, `lint_sitemap`, `lint_product_csv`, `lint_page_metadata`,
  `validate_structured_data`, `lint_llms_txt`, `lint_robots_txt` and `lint_product_feed`.
- Protocol versions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05. Input validation
  returns errors as tool results. Results carry both `structuredContent` and text. Finding
  lists are capped at 200 entries.

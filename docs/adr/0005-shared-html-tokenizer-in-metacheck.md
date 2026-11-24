# ADR 0005: One HTML tokenizer, owned by metacheck and reused by schemaview

- Status: accepted
- Date: 2026-11-24

## Context

`metacheck` reads `<title>`, `<meta>`, `<link>` and headings from a page. `schemaview` reads
`<script type="application/ld+json">` blocks from the same kind of page. Both need to tokenize
HTML the way a browser does: comments hide markup, `<script>` content is raw text, attribute
values may be quoted, unquoted or empty, and a repeated attribute keeps its first value. A
regular expression gets these cases wrong, and two hand-written tokenizers would drift apart.

Third-party parsers (`parse5`, `htmlparser2`) are correct but would be the first third-party
runtime dependency in the repository (ADR 0001). Neither package needs a tree, only tokens.

## Decision

- `metacheck` owns a small WHATWG-style tokenizer, `src/html.ts` (`tokenizeHtml`,
  `decodeEntities`), and exports it from its main entry as a documented building block.
- `schemaview` depends on `metacheck` (`^1.0.0`) and uses that tokenizer. Development
  resolves it from source through the `websync-source` condition (ADR 0003).
- The tokenizer never throws, records a line number for every token, and stays linear on
  minified single-line pages (tested).

## Consequences

- Installing `schemaview` also installs `metacheck`. Both have no other dependencies.
- The token shape is public API of `metacheck`. Changing it is a breaking change for both
  packages and needs a major version.
- Only common named character references are decoded. Rare ones stay as written, which affects
  text lengths by a few characters at most. If that ever matters, the full WHATWG table can be
  added in one file.

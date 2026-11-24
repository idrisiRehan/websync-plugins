# ADR 0002: A built-in XML reader for sitemap-lint, not a parser dependency

- Status: accepted
- Date: 2026-11-24

## Context

`sitemap-lint` must parse XML in Node, where there is no `DOMParser`. The options were a
dependency (`@xmldom/xmldom`, `fast-xml-parser`, `sax`), or a small reader written for the job.
Every package so far has zero runtime dependencies (ADR 0001).

## Decision

Write a strict, minimal XML reader (`packages/sitemap-lint/src/xml.ts`, about 290 lines). It
checks XML 1.0 and Namespaces in XML well-formedness and builds an element tree with line
numbers. It processes no DTD: a DOCTYPE is skipped, and only the five predefined entities and
numeric character references are expanded.

Reasons:

- **Better findings.** Every finding gets a line number. The most common real sitemap error, an
  unescaped `&` in a query string, gets a specific message with the fix. Browser `DOMParser`
  messages differ by engine, and the dependency options word errors in their own ways.
- **Safety by construction.** With no DTD processing, external entities and entity expansion
  can't happen, so nothing depends on configuring a parser correctly.
- **Same results everywhere.** Node, browsers and edge runtimes run identical code.
- **Zero dependencies**, consistent with the other packages.

## Verification

- 35 reader tests: structure, every well-formedness error it reports, XXE and billion-laughs payloads.
- A scratch fuzz run of 20,000 mutated sitemaps against `fast-xml-parser`'s validator. The
  reader never accepted a document the reference rejected. All 1,332 disagreements were the
  reader correctly rejecting input the reference allows: `<` in attribute values (XML 1.0
  AttValue), undeclared namespace prefixes (Namespaces in XML), and malformed `<![` markup.
- Linting 50,000 entries runs inside the test suite, well under its 5 second limit.

## Consequences

- The reader is ours to maintain. It is deliberately not exported as public API, so it can
  change without a major version.
- Not supported, and not needed for sitemaps: DTD-defined entities and encodings other than
  UTF-8.
- The CLIs of `security-header-audit` and `sitemap-lint` repeat about 20 lines of argument
  and error handling. Sharing them would mean a published runtime dependency for each package,
  so the duplication is accepted until a third CLI exists.

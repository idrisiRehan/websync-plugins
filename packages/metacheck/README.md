# metacheck

Check a page's SEO and sharing metadata offline: title, meta description, canonical, robots,
Open Graph, X (Twitter) cards, headings and hreflang. Every problem comes with a line number
and a plain-English reason.

```text
$ npx metacheck examples/page-with-problems.html
examples/page-with-problems.html: "Shoes"
WARN   doctype-missing
       No <!DOCTYPE html> before the first element. Without it, browsers render the page in quirks mode.
WARN   charset-missing
       No character encoding declaration. Add <meta charset="utf-8"> at the top of <head>, unless the server sends it in Content-Type.
WARN   og-missing
       Missing required Open Graph property: og:type.
WARN   lang-missing (line 1)
       <html> has no lang attribute. Declare the page language, for example <html lang="en">.
WARN   title-too-short (line 3)
       The title is 5 characters. Aim for 30-60; search engines truncate by pixel width, so the character count is approximate.
WARN   description-empty (line 4)
       <meta name="description"> is empty.
WARN   robots-directive-unknown (line 6)
       Robots directive "noodp" is not a known directive, so crawlers ignore it.
WARN   robots-noindex (line 6)
       <meta name="robots"> says "noindex": all search engines will drop this page from search results. Remove it if the page should be found.
WARN   robots-googlebot (line 7)
       <meta name="googlebot"> says "index, follow", but it can't override robots "noindex, nofollow": Google applies the most restrictive combination.
WARN   canonical-relative (line 8)
       The canonical "/shoes/" is relative. Google recommends an absolute URL, which can't be misread on another host or protocol.
ERROR  canonical-multiple (line 9)
       Conflicting canonicals: "https://example.com/shoes/?sort=price" here and "/shoes/" on line 8. Google ignores all of them when they disagree.
ERROR  hreflang-invalid (line 10)
       hreflang="en_US" is not a language code like en, en-GB or zh-Hant, or x-default. Use a hyphen, not an underscore.
WARN   hreflang-x-default-missing (line 10)
       The hreflang alternates have no x-default, the fallback for languages you don't list. Add <link rel="alternate" hreflang="x-default" href="...">.
ERROR  hreflang-href-invalid (line 11)
       The hreflang="de" href "/de/schuhe/" is relative. Google requires fully qualified URLs.
ERROR  og-image-invalid (line 13)
       og:image "/images/shoes.jpg" must be an absolute http(s) URL. Platforms fetch it as is and won't resolve a relative path.
ERROR  twitter-card-invalid (line 14)
       twitter:card "large" is not one of: summary, summary_large_image, app, player. X won't render a card for it.
ERROR  metadata-in-body (line 17)
       <meta name="viewport"> is in <body> (the head ended at <img> on line 16). Google stops reading head metadata at the first element that doesn't belong in the head, so it is ignored.
WARN   meta-duplicate (line 17)
       <meta name="viewport"> appears more than once (first on line 5). Keep one, so it's clear which value applies.
ERROR  metadata-in-body (line 18)
       <meta property="og:url"> is in <body> (the head ended at <img> on line 16). Google stops reading head metadata at the first element that doesn't belong in the head, so it is ignored.
WARN   heading-skipped (line 22)
       <h3> follows <h1> (line 21), skipping a level. Use <h2> or restructure.
WARN   h1-multiple (line 23)
       The page has 2 <h1> elements (first on line 21). One h1 naming the page is the usual convention.

7 errors, 14 warnings
```

The `metadata-in-body` findings are the ones that are hard to see by eye. A stray `<img>` in
`<head>` (line 16 of the [example](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/metacheck/examples/page-with-problems.html))
ends the head early, as it does in every browser, and Google ignores the metadata after it.
metacheck tracks the head the way the HTML parser does, so it reports which element ended it.

- **Zero dependencies.** It ships its own lenient HTML tokenizer, so results are identical in
  Node, browsers and edge runtimes.
- **Offline.** The library reads the HTML you give it and fetches nothing, including the URLs
  the page points to. Only the CLI fetches, and only the URL you pass it.
- **Honest severities.** Errors are things that are broken: no title, conflicting canonicals,
  an invalid URL, metadata that Google ignores. Length guidance and conventions are warnings.
- **A metadata summary as well as findings.** Title, description, canonical, robots, Open
  Graph, X tags, hreflang and the heading outline come back as plain JSON.

The browser version is the free [SEO Analyzer](https://websync.in/tools/seo-analyzer/) on
websync.in.

## Install

```sh
npm install metacheck
```

ESM only. The library is plain ES2022; the CLI needs Node 22 or later.

## CLI

```text
metacheck <file | url | -> [options]

  --json               Print the result as JSON
  --url <page-url>     The page's own URL, for file or stdin input (resolves relative URLs)
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  --timeout <ms>       Request timeout for URLs in milliseconds (default 15000)
```

Exit codes: `0` no errors, `1` errors (or more warnings than `--max-warnings`), `2` usage,
input or network error. Input over 10 MB is refused with code 2 without being linted.

```sh
npx metacheck dist/index.html --url https://example.com/
npx metacheck https://example.com/ --max-warnings 0
curl -s https://example.com/ | npx metacheck - --url https://example.com/ --json
```

For a URL, redirects are followed and the final URL is used to resolve relative links. A
response that isn't `text/html` or `application/xhtml+xml`, or that has an HTTP error status,
exits with code 2.

### In a build

```json
{
  "scripts": {
    "postbuild": "metacheck dist/index.html --url https://example.com/"
  }
}
```

```yaml
- name: Check page metadata
  run: npx --yes metacheck@1 dist/index.html --url https://example.com/ --max-warnings 0
```

## Library

```ts
import { lintMetadata } from "metacheck";

const result = lintMetadata(html, { url: "https://example.com/shoes/" }); // url is optional

result.valid;         // true when there are no errors
result.errorCount;    // number of errors
result.warningCount;  // number of warnings
result.findings;      // [{ rule, severity, message, line }]
result.metadata;      // the extracted summary, see below
```

`url` is the page's own address. It resolves relative URLs (after any `<base href>`) and lets
the hreflang check confirm the page lists itself. It must be an absolute http(s) URL, or
`lintMetadata` throws a `TypeError`. Without it, relative URLs are reported but not resolved.

```ts
interface MetadataFinding {
  rule: RuleId;              // see the rule table
  severity: "error" | "warning";
  message: string;
  line: number | null;       // null for page-level findings, such as a missing title
}

interface PageMetadata {
  title: string | null;                // first <title>, whitespace collapsed
  description: string | null;          // first meta description, whitespace collapsed
  canonical: string | null;            // first canonical, resolved when possible
  robots: Record<string, string[]>;    // { robots: ["noindex"], googlebot: [...] }, lowercase
  lang: string | null;                 // <html lang>
  charset: string | null;              // meta charset or http-equiv Content-Type charset
  viewport: string | null;             // viewport content
  openGraph: Record<string, string>;   // first value of each og:*, article:*, ... property
  twitter: Record<string, string>;     // first value of each twitter:* property
  hreflang: { hreflang: string; href: string; line: number }[];
  headings: { level: number; text: string; line: number }[];
}
```

The thresholds are exported: `TITLE_MIN_LENGTH` (30), `TITLE_MAX_LENGTH` (60),
`DESCRIPTION_MIN_LENGTH` (120), `DESCRIPTION_MAX_LENGTH` (160), `CHARSET_SCAN_BYTES` (1024),
`OG_REQUIRED` and `TWITTER_CARD_TYPES`. So is the tokenizer, `tokenizeHtml(html)`, for
building your own checks.

## Rules

| Rule | Severity | Meaning | Source |
|---|---|---|---|
| `doctype-missing` | warning | No doctype before the first element, so the page renders in quirks mode | [WHATWG](https://html.spec.whatwg.org/multipage/syntax.html#the-doctype) |
| `doctype-legacy` | warning | A doctype other than `<!DOCTYPE html>` (HTML 4, XHTML) | [WHATWG](https://html.spec.whatwg.org/multipage/syntax.html#the-doctype) |
| `lang-missing` | warning | `<html>` has no `lang`, or an empty one | [WHATWG](https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes) |
| `lang-invalid` | warning | `lang` isn't a BCP 47 tag, for example `en_US` or `english` | [WHATWG](https://html.spec.whatwg.org/multipage/dom.html#the-lang-and-xml:lang-attributes) |
| `charset-missing` | warning | No `<meta charset>` (or http-equiv Content-Type) and no byte order mark | [WHATWG](https://html.spec.whatwg.org/multipage/semantics.html#character-encoding-declaration) |
| `charset-not-utf8` | warning | The declared encoding isn't UTF-8 | [WHATWG](https://html.spec.whatwg.org/multipage/semantics.html#character-encoding-declaration) |
| `charset-late` | warning | The declaration doesn't end within the first 1024 bytes | [WHATWG](https://html.spec.whatwg.org/multipage/semantics.html#character-encoding-declaration) |
| `viewport-missing` | warning | No viewport meta tag | [CSS Viewport](https://drafts.csswg.org/css-viewport/#viewport-meta) |
| `title-missing` | error | No `<title>` | [WHATWG](https://html.spec.whatwg.org/multipage/semantics.html#the-title-element) |
| `title-empty` | error | `<title>` is empty or whitespace | [Google](https://developers.google.com/search/docs/appearance/title-link) |
| `title-multiple` | warning | More than one `<title>`. The first is used | [WHATWG](https://html.spec.whatwg.org/multipage/semantics.html#the-head-element) |
| `title-too-short`, `title-too-long` | warning | Outside 30-60 characters (approximate: truncation is by pixel width) | [Google](https://developers.google.com/search/docs/appearance/title-link) |
| `description-missing`, `description-empty` | warning | No meta description, or an empty one | [Google](https://developers.google.com/search/docs/appearance/snippet#meta-descriptions) |
| `description-multiple` | warning | More than one meta description | [WHATWG](https://html.spec.whatwg.org/multipage/semantics.html#meta-description) |
| `description-too-short`, `description-too-long` | warning | Outside 120-160 characters (approximate: truncation is by pixel width) | [Google](https://developers.google.com/search/docs/appearance/snippet#meta-descriptions) |
| `canonical-missing` | warning | No `<link rel="canonical">` | [Google](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| `canonical-multiple` | error | Canonicals that point to different URLs | [Google](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| `canonical-invalid` | error | No href, a non-http(s) scheme, or an unparseable URL | [Google](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| `canonical-relative` | warning | A relative canonical. Google recommends absolute URLs | [Google](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| `canonical-outside-head` | error | The canonical is in `<body>`, where Google ignores it | [Google](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| `og-url-mismatch` | warning | `og:url` differs from the canonical | [ogp.me](https://ogp.me/#metadata) |
| `robots-noindex` | warning | A robots meta tag says `noindex` or `none` | [Google](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) |
| `robots-directive-unknown` | warning | An unknown robots directive (such as `noodp`) or an invalid value (such as `max-snippet:abc`) | [Google](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) |
| `robots-googlebot` | warning | A googlebot tag tries to lift a `noindex`/`nofollow` set by the robots tag | [Google](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) |
| `og-missing` | warning | Missing one or more of `og:title`, `og:type`, `og:image`, `og:url` | [ogp.me](https://ogp.me/#metadata) |
| `og-image-invalid`, `og-url-invalid` | error | `og:image` or `og:url` isn't an absolute http(s) URL | [ogp.me](https://ogp.me/#metadata) |
| `twitter-card-invalid` | error | `twitter:card` isn't `summary`, `summary_large_image`, `app` or `player` | [X](https://developer.x.com/en/docs/x-for-websites/cards/overview/markup) |
| `h1-missing` | warning | No `<h1>` | [WHATWG](https://html.spec.whatwg.org/multipage/sections.html#headings-and-outlines) |
| `h1-multiple` | warning | More than one `<h1>` | [WHATWG](https://html.spec.whatwg.org/multipage/sections.html#headings-and-outlines) |
| `heading-skipped` | warning | A heading more than one level below the previous one, such as h1 then h3 | [WHATWG](https://html.spec.whatwg.org/multipage/sections.html#headings-and-outlines) |
| `hreflang-invalid` | error | Not `language[-script][-region]` with an ISO 639-1 language and an ISO 3166-1 alpha-2 region, or `x-default`. For example `en_US`, `en-UK` or `es-419`, which Google doesn't support | [Google](https://developers.google.com/search/docs/specialty/international/localized-versions) |
| `hreflang-href-invalid` | error | An hreflang href that is relative or not http(s). Google requires fully qualified URLs | [Google](https://developers.google.com/search/docs/specialty/international/localized-versions) |
| `hreflang-duplicate` | error | One language code pointing to two different URLs | [Google](https://developers.google.com/search/docs/specialty/international/localized-versions) |
| `hreflang-x-default-missing` | warning | hreflang alternates without an `x-default` | [Google](https://developers.google.com/search/docs/specialty/international/localized-versions) |
| `hreflang-self-missing` | warning | The alternates don't list this page (its URL or canonical) | [Google](https://developers.google.com/search/docs/specialty/international/localized-versions) |
| `metadata-in-body` | error | `<title>`, `<base>`, a meta tag or a non-body-ok link after the head has ended | [Google](https://developers.google.com/search/docs/crawling-indexing/valid-page-metadata) |
| `meta-duplicate` | warning | The same meta name twice (except `theme-color`, `google-site-verification` and robots tags, which combine) | [WHATWG](https://html.spec.whatwg.org/multipage/semantics.html#standard-metadata-names) |

The head ends where the HTML parser ends it: at `</head>`, at `<body>` (or a stray `</body>`,
`</html>` or `</br>`), or implicitly at the first text or element that isn't allowed in the
head (`title`, `meta`, `link`, `base`, `script`, `style`, `noscript`, `template`; after
`</head>`, a `<noscript>` opens the body). Content inside `<noscript>` and `<template>` is
skipped, as browsers do with scripting on, so a tracking pixel in `<noscript>` doesn't end
the head. A `<title>` inside `<svg>` is not the page title. An HTML tag such as `<p>`, `<div>`
or `<h1>` ends `<svg>` and `<math>` content, as in browsers, so an unclosed `<svg>` doesn't hide
the rest of the page. Microdata (`itemprop`) and RDFa
(`property`) meta tags are allowed in the body, except Open Graph and X properties.

## JSON output

`--json` prints the library result plus the source:

```json
{
  "source": "https://example.com/ (HTTP 200)",
  "valid": false,
  "errorCount": 1,
  "warningCount": 1,
  "findings": [
    { "rule": "title-missing", "severity": "error", "message": "The page has no <title>. Search engines and browser tabs need one.", "line": null },
    { "rule": "h1-missing", "severity": "warning", "message": "The page has no <h1>. A top-level heading tells readers and search engines what the page is about.", "line": null }
  ],
  "metadata": {
    "title": null,
    "description": "...",
    "canonical": "https://example.com/",
    "robots": {},
    "lang": "en",
    "charset": "utf-8",
    "viewport": "width=device-width, initial-scale=1",
    "openGraph": { "og:title": "...", "og:type": "website", "og:image": "https://example.com/a.jpg", "og:url": "https://example.com/" },
    "twitter": {},
    "hreflang": [],
    "headings": []
  }
}
```

For a file or stdin, `source` is the path or `stdin`.

## Limitations

- **It reads the HTML as served.** It doesn't run JavaScript, so tags that a framework adds in
  the browser aren't seen. Lint the server-rendered or prerendered output.
- **HTTP headers aren't checked.** `X-Robots-Tag`, a `Link: rel="canonical"` header and the
  Content-Type charset are invisible to the library. That's why `charset-missing` is a warning.
- **Linked URLs aren't fetched.** A valid canonical or `og:image` can still return 404 or
  redirect, and hreflang return links on the other pages aren't confirmed.
- **Lengths are character counts.** Google truncates titles and snippets by pixel width and
  often rewrites both, so the length rules are guidance, not limits.
- **The parser is lenient, not a full HTML tree builder.** It covers what decides head
  placement for metadata, but not every error-recovery case (for example `<table>` foster
  parenting), and it decodes only common named character references.
- **The CLI decodes input as UTF-8.** A page in another encoding is still linted, but its
  non-ASCII text may be garbled in messages and lengths.
- **`og:*` in a `name` attribute is accepted.** ogp.me specifies `property`, but the major
  consumers read both, so it isn't flagged.

## Security

The library never touches the network or the filesystem. The CLI fetches only the URL you give
it, including `localhost`, so you can lint a dev server. It reads at most 10 MB. Don't expose
the CLI as a service that fetches URLs for other people without your own SSRF controls. See
[SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md) to report
a vulnerability.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)

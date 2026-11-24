# sitemap-lint

Check XML sitemaps and sitemap indexes against the [sitemaps.org protocol](https://www.sitemaps.org/protocol.html),
with a line number and a plain-English reason for every problem.

```text
$ npx sitemap-lint examples/sitemap-with-problems.xml
examples/sitemap-with-problems.xml: urlset, 4 entries
WARN   loc-unescaped (line 8, entry 2)
       <loc> "https://example.com/shoes/running shoes" contains characters that must be percent-encoded (a space as %20, non-ASCII as UTF-8 bytes).
WARN   lastmod-invalid (line 9, entry 2)
       <lastmod> "2026-02-30" is not a real calendar date.
ERROR  loc-invalid (line 12, entry 3)
       <loc> "/about/" is not a valid absolute URL.
WARN   loc-duplicate (line 15, entry 4)
       <loc> "https://example.com/" is already listed in entry 1 (line 4).
WARN   priority-invalid (line 16, entry 4)
       <priority> "high" should be a number from 0.0 to 1.0.

1 error, 4 warnings
```

The most common sitemap bug is an unescaped `&` in a URL. It makes the whole file unparseable
XML, and the line number is what you need to fix it:

```text
$ npx sitemap-lint examples/unescaped-ampersand.xml
examples/unescaped-ampersand.xml: unreadable, 0 entries
ERROR  xml-malformed (line 4)
       Not well-formed XML: Unescaped "&". Write it as &amp; (common in URLs with query strings).
```

- **Zero dependencies.** It ships its own small, strict XML reader, so results are identical in
  Node, browsers and edge runtimes.
- **Safe on untrusted files.** No DTD processing. External entities (XXE) and entity expansion
  ("billion laughs") can't happen. The CLI never reads more than the protocol's 50 MB limit,
  even from a gzip that inflates further.
- **CLI for builds and CI.** It reads files, stdin and URLs, gzipped or not. It exits 1 on
  errors, and on warnings too with `--max-warnings`.
- **It checks the file, not the URLs in it.** Fast enough for 50,000 entries in a pre-deploy
  step, and it never fetches the pages it lists.

The browser version is the free [Sitemap Validator](https://websync.in/tools/sitemap-validator/)
on websync.in.

## Install

```sh
npm install sitemap-lint
```

ESM only. The library is plain ES2022; the CLI needs Node 22 or later.

## CLI

```text
sitemap-lint <file | url | -> [options]

  --json               Print the result as JSON
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  --timeout <ms>       Request timeout for URLs in milliseconds (default 15000)
```

Exit codes: `0` no errors, `1` errors (or more warnings than `--max-warnings`), `2` usage,
input or network error. Input over 50 MB uncompressed is refused with code 2 without
being linted.

```sh
npx sitemap-lint public/sitemap.xml
npx sitemap-lint https://example.com/sitemap.xml --max-warnings 0
npx sitemap-lint sitemap-products.xml.gz
curl -s https://example.com/sitemap.xml | npx sitemap-lint -
```

### In a build

```json
{
  "scripts": {
    "postbuild": "sitemap-lint dist/sitemap.xml --max-warnings 0"
  }
}
```

```yaml
- name: Lint sitemap
  run: npx --yes sitemap-lint@1 public/sitemap.xml --max-warnings 0
```

## Library

```ts
import { lintSitemap } from "sitemap-lint";

const result = lintSitemap(xmlText); // a string, or a Uint8Array to also check UTF-8

result.valid;        // true when there are no errors
result.kind;         // "urlset", "sitemapindex", or null if it isn't a readable sitemap
result.entryCount;   // number of <url> or <sitemap> entries
result.locs;         // every valid http(s) <loc>, in file order
result.findings;     // [{ rule, severity, message, line, entry }]
```

For a sitemap index, `locs` are the child sitemaps. Fetching and linting each one is up to
you, so you control concurrency and which hosts are reached.

```ts
for (const f of result.findings) {
  console.log(`${f.severity} ${f.rule} at line ${f.line}: ${f.message}`);
}
```

## Rules

| Rule | Severity | Meaning |
|---|---|---|
| `file-too-large` | error | Over 50 MB uncompressed |
| `encoding-invalid` | error | Bytes aren't valid UTF-8 (only when you pass a `Uint8Array`) |
| `encoding-declared` | warning | The XML declaration names an encoding other than UTF-8 |
| `xml-malformed` | error | Not well-formed XML, for example an unescaped `&`, a mismatched tag or an undeclared prefix |
| `xml-doctype` | warning | Has a DOCTYPE. It is ignored |
| `root-unknown` | error | Root isn't `<urlset>` or `<sitemapindex>` |
| `root-namespace` | warning | Root isn't in `http://www.sitemaps.org/schemas/sitemap/0.9` |
| `entries-empty` | error | No entries |
| `entries-too-many` | error | More than 50,000 entries |
| `entry-wrong-type` | error | `<sitemap>` in a `<urlset>`, or `<url>` in a `<sitemapindex>` |
| `element-unknown` | warning | A sitemap-namespace element that doesn't belong there, often a typo like `<lastmode>` |
| `element-repeated` | warning | The same element twice in one entry. Only the first counts |
| `loc-missing`, `loc-empty` | error | No `<loc>`, or an empty one |
| `loc-invalid` | error | Not an absolute URL (relative paths aren't allowed) |
| `loc-scheme` | error | Not http or https |
| `loc-too-long` | error | 2,048 characters or more |
| `loc-unescaped` | warning | Spaces or other characters that must be percent-encoded |
| `loc-duplicate` | warning | Listed more than once |
| `hosts-multiple` | warning | Entries on more than one host |
| `lastmod-invalid` | warning | Not [W3C Datetime](https://www.w3.org/TR/NOTE-datetime), or an impossible date or time |
| `changefreq-invalid` | warning | Not one of `always`, `hourly`, `daily`, `weekly`, `monthly`, `yearly`, `never` |
| `priority-invalid` | warning | Not a number from 0.0 to 1.0 |

Elements in other namespaces (image, video, news, `xhtml:link` for hreflang) are ignored, not
flagged.

## Limitations

- **The URLs aren't fetched.** A valid sitemap can still list pages that return 404, redirect,
  or are blocked by robots.txt.
- **Index children aren't followed.** Lint each child sitemap separately (see Library).
- **The protocol's host and path rule isn't checked.** Strictly, URLs should be on the same host
  as the sitemap and under its directory. A file doesn't know where it's served from, so only
  mixed hosts are reported.
- **Google ignores `<priority>` and `<changefreq>`.** They're still checked for protocol
  validity, but fixing them won't change how Google crawls your site.
- **The extension schemas (image, video, news) aren't validated.**

## Security

The library never touches the network or the filesystem. The CLI fetches only the URL you give
it, including `localhost`, so you can lint a dev server. Don't expose the CLI as a service that
fetches URLs for other people without your own SSRF controls. See
[SECURITY.md](../../SECURITY.md) to report a vulnerability.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)

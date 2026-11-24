# llms-txt-kit

Lint and generate `llms.txt` files against the [llmstxt.org proposal](https://llmstxt.org/),
with a line number and a plain-English reason for every problem.

`llms.txt` is a proposed convention, not a standard: a markdown file at `/llms.txt` (or under a
subpath such as `/docs/llms.txt`) that gives agents a short summary of a site and a curated list
of links to LLM-friendly pages. The format is simple, but it is precise enough to be parsed with
code, and small mistakes (an H3 where the spec expects a flat list, ` - ` instead of `: ` before
link notes, an HTML 404 page served as the file) mean a parser that follows the spec reads less
than you wrote. This package checks for those, and builds canonical files from JSON.

```text
$ npx llms-txt-kit lint examples/llms-with-problems.txt
examples/llms-with-problems.txt: "Example Store", 3 sections, 5 links
WARN   summary-misplaced (line 5)
       This blockquote looks like the summary, but the summary must come directly after the H1. Here it is read as details.
WARN   heading-level (line 7)
       "### Ordering" is a heading in the details before the first H2, where the spec allows none. Use bold text, or make it an H2 section.
WARN   link-notes (line 12)
       The text after the "Returns" link doesn't start with ":". Write "- [Name](https://example.com/page.md): notes"; parsers that follow the spec drop the text otherwise.
WARN   link-malformed (line 13)
       "- https://example.com/policies/warranty.md" doesn't start with a markdown link. Each list item in a section needs one, as in "- [Name](https://example.com/page.md): notes".
WARN   url-duplicate (line 14)
       "/policies/shipping.md" is already listed on line 11.
WARN   section-empty (line 16)
       Section "Guides" is empty. Each H2 section holds a list of markdown links.
WARN   optional-misspelled (line 18)
       Section "Optional Links" looks like the Optional section. By convention it is titled exactly "Optional".
WARN   url-invalid (line 21)
       "mailto:help@example.com" is a mailto link. Agents can only follow http and https links.

0 errors, 8 warnings
```

A misconfigured server often answers `/llms.txt` with an HTML page (its 404 page, or a
single-page app's shell), sometimes with a `200` status, and `curl -s` passes it along either
way. That makes the file useless, so it is an error:

```text
$ curl -s https://example.com/llms.txt | npx llms-txt-kit lint -
stdin: no H1, 0 sections, 0 links
ERROR  file-html (line 1)
       This is HTML, not markdown. A server often sends an HTML 404 page or app shell when /llms.txt is missing.

1 error, 0 warnings
```

- **Honest severities.** The spec is a proposal, so style problems are warnings. Errors are
  kept for files a reader can't use: empty, HTML instead of markdown, or no H1.
- **Lint and build share one structure.** `lintLlmsTxt()` returns the parsed document, and
  `buildLlmsTxt()` renders the same shape back to canonical markdown, so
  `buildLlmsTxt(lintLlmsTxt(text).doc)` reproduces a well-formed file exactly.
- **Zero dependencies.** A small line-based parser that knows fenced code blocks, so a `#`
  comment inside a code sample is never mistaken for a heading.
- **CLI for builds and CI.** It reads files, stdin and URLs. A bare origin such as
  `https://example.com` fetches `/llms.txt`.

## Install

```sh
npm install llms-txt-kit
```

ESM only. The library is plain ES2022; the CLI needs Node 22 or later.

## CLI

```text
llms-txt-kit lint <file | url | -> [options]
llms-txt-kit build <spec.json | ->

  --json               Print the lint result as JSON
  --max-warnings <n>   Exit with code 1 when there are more than n warnings
  --timeout <ms>       Request timeout for URLs in milliseconds (default 15000)
  -h, --help           Show this help
  -v, --version        Show the version
```

```sh
npx llms-txt-kit lint public/llms.txt --max-warnings 0
npx llms-txt-kit lint https://example.com            # fetches https://example.com/llms.txt
npx llms-txt-kit lint https://example.com/docs/llms.txt --json
curl -s https://example.com/llms.txt | npx llms-txt-kit lint -
npx llms-txt-kit build llms.json > public/llms.txt
```

For a URL, redirects are followed, and relative links in the file are resolved against the final
URL before they are checked for duplicates. Input over 5 MB is refused without being linted.

### build

`build` reads a JSON document in the [shape below](#the-document-shape) and writes markdown to
stdout. `optional` and `line` may be left out. If the generated file still has lint findings
(a duplicate URL, say), they are printed to stderr, one per line, and the exit code stays 0.

```text
$ npx llms-txt-kit build examples/llms-spec.json
# Example Store

> Example Store sells refurbished cameras and lenses in India. Prices include GST, orders ship from Pune, and every item carries a 12-month warranty.

Key facts for answering customer questions:

- Returns are accepted within 10 days of delivery, unused and in the original box.
- Cash on delivery is available for orders up to Rs 20,000.
- The catalog changes daily, so check a product page before quoting stock or a price.

## Policies

- [Shipping](https://example.com/policies/shipping.md): Delivery times, courier partners and charges by pin code
- [Returns and refunds](https://example.com/policies/returns.md): Eligibility, the return process and refund timelines
- [Warranty](https://example.com/policies/warranty.md)

## Buying guides

- [Choosing a used mirrorless camera](https://example.com/guides/used-mirrorless.md): What to check on shutter count, sensor and mount
- [Lens grading](https://example.com/guides/lens-grading.md): What grades A, B and C mean for glass, haze and focus

## Optional

- [About us](https://example.com/about.md)
- [Press](https://example.com/press.md)
```

The input is [examples/llms-spec.json](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/llms-txt-kit/examples/llms-spec.json)
and the output is [examples/llms.txt](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/llms-txt-kit/examples/llms.txt).

### In a build

```json
{
  "scripts": {
    "postbuild": "llms-txt-kit lint dist/llms.txt --max-warnings 0"
  }
}
```

```yaml
- name: Lint llms.txt
  run: npx --yes llms-txt-kit@1 lint https://example.com --max-warnings 0
```

## Library

```ts
import { lintLlmsTxt, buildLlmsTxt } from "llms-txt-kit";

const result = lintLlmsTxt(text, { url: "https://example.com/llms.txt" }); // url is optional

result.valid;         // true when there are no errors
result.errorCount;    // number
result.warningCount;  // number
result.findings;      // [{ rule, severity, message, line }], sorted by line
result.doc;           // { title, summary, details, sections }

const markdown = buildLlmsTxt({
  title: "Example Store",
  summary: "Refurbished cameras and lenses, shipped from Pune.",
  sections: [{ title: "Policies", links: [{ title: "Returns", url: "/returns.md", notes: "Within 10 days" }] }],
});
```

`url` tells the linter where the file is served. Relative links are allowed either way; with
`url`, they are resolved before duplicates are compared, so `/a.md` and `https://example.com/a.md`
count as the same link. Without it, relative links are compared as written. An invalid `url`
throws a `TypeError`.

`buildLlmsTxt()` throws a `TypeError` that names the field when the input has the wrong shape
(`sections[0].links[2].url is required.`), or when a value can't be written as markdown without
changing its meaning: a `]` in a link title, a space in a URL, a line break in a title, or a
heading inside `details`. It checks this by parsing its own output back, so it never returns a
file that reads differently from the input.

### The document shape

```ts
interface LlmsTxtDoc {
  title: string | null;       // the H1; null when there is none. Required by buildLlmsTxt()
  summary?: string | null;    // the blockquote right after the H1, without "> "
  details?: string | null;    // markdown between the summary and the first H2, as written
  sections: LlmsTxtSection[];
}

interface LlmsTxtSection {
  title: string;              // the H2 text
  optional?: boolean;         // true when the title is exactly "Optional"
  line?: number;              // 1-based line of the H2
  links: LlmsTxtLink[];
}

interface LlmsTxtLink {
  title: string;
  url: string;                // as written; relative URLs stay relative
  notes?: string | null;      // the text after the colon that follows the link
  line?: number;
}

interface LlmsTxtFinding {
  rule: RuleId;
  severity: "error" | "warning";
  message: string;
  line: number | null;        // null for findings about the whole file
}
```

One shape serves both directions. `lintLlmsTxt()` always fills in every field, including
`optional` and `line`; `buildLlmsTxt()` ignores those two and treats missing `summary`,
`details` and `notes` as absent.

The CLI's `--json` output is the lint result with a `source` field added. For this file:

```markdown
# Example Store

> Refurbished cameras and lenses, shipped from Pune.

## Policies

- [Shipping](https://example.com/shipping.md): Delivery times
- [Returns](https://example.com/returns.md) - Within 10 days
```

```text
$ npx llms-txt-kit lint - --json < llms.txt
{
  "source": "stdin",
  "valid": true,
  "errorCount": 0,
  "warningCount": 1,
  "findings": [
    {
      "rule": "link-notes",
      "severity": "warning",
      "message": "The text after the \"Returns\" link doesn't start with \":\". Write \"- [Name](https://example.com/page.md): notes\"; parsers that follow the spec drop the text otherwise.",
      "line": 8
    }
  ],
  "doc": {
    "title": "Example Store",
    "summary": "Refurbished cameras and lenses, shipped from Pune.",
    "details": null,
    "sections": [
      {
        "title": "Policies",
        "optional": false,
        "line": 5,
        "links": [
          {
            "title": "Shipping",
            "url": "https://example.com/shipping.md",
            "notes": "Delivery times",
            "line": 7
          },
          {
            "title": "Returns",
            "url": "https://example.com/returns.md",
            "notes": null,
            "line": 8
          }
        ]
      }
    ]
  }
}
```

## Rules

Every rule comes from the [Format section of the proposal](https://llmstxt.org/#format), v2,
checked on 2026-11-24.

| Rule | Severity | Meaning |
|---|---|---|
| `file-empty` | error | The file is empty or only whitespace |
| `file-html` | error | The file is an HTML page, usually a 404 page or app shell served in its place |
| `h1-missing` | error | No H1. The H1 with the site or project name is the [only required part](https://llmstxt.org/#format) |
| `h1-empty` | error | The H1 has no text |
| `h1-not-first` | warning | Content comes before the H1. Only a byte-order mark may, and the content is ignored |
| `h1-multiple` | warning | More than one H1 |
| `heading-level` | warning | An H3 to H6. The details before the first H2 may contain [anything except headings](https://llmstxt.org/#format), and sections are flat link lists under an H2 |
| `heading-space` | warning | A line like `#Title` or `##Docs`, which markdown doesn't treat as a heading |
| `heading-setext` | error or warning | A heading made by underlining with `===` or `---`. Markdown reads it, but llms.txt tools, including the [llmstxt.org Python module](https://llmstxt.org/core.html), split the file on `#` lines only. An error for the H1, a warning otherwise |
| `summary-misplaced` | warning | No summary right after the H1, but a blockquote further down that looks like one |
| `section-empty` | warning | An H2 section with nothing in it |
| `section-content` | warning | A section holds something other than list items (a paragraph, a quote, a code block). Reported once per section |
| `section-duplicate` | warning | Two H2 sections with the same title (case-insensitive), including two `Optional` sections |
| `optional-misspelled` | warning | A section that looks like `Optional` but isn't titled exactly that: `optional`, `Optinal`, `Optional links` |
| `link-malformed` | warning | A list item in a section that doesn't start with a [markdown link](https://llmstxt.org/#format), or whose link has an empty name |
| `link-notes` | warning | Text after the link that doesn't start with `:`, such as `- [Docs](https://example.com/docs.md) - the docs` |
| `url-invalid` | warning | A link URL that is empty, unparseable, or not http(s), such as `mailto:` |
| `url-duplicate` | warning | The same URL listed twice, after resolving relative URLs when `url` is known |

List items in the details (before the first H2) are not checked as links: the spec allows any
markdown there.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | `lint`: no errors (and no more warnings than `--max-warnings`). `build`: markdown written |
| `1` | `lint`: errors, or more warnings than `--max-warnings` |
| `2` | Usage error, unreadable input (missing file, invalid UTF-8 or JSON, over 5 MB, a `build` spec that can't be rendered), HTTP error status, timeout or network error |

Errors are printed to stderr as one line, prefixed `llms-txt-kit:`.

## Limitations

- **The links aren't fetched.** A clean file can still link to pages that return 404. The spec
  also says links should point to LLM-friendly content such as `.md` pages; that isn't checked.
- **Setext headings are read one line at a time.** A heading underlined with `===` or `---` is
  recognised (and reported as `heading-setext`) when the text above the underline is one line.
- **Link syntax is the common subset.** A URL may contain one level of balanced parentheses but
  no spaces; `<url>` and link titles (`[a](https://example.com "title")`) are not supported, nor is `]` inside a
  link name.
- **A list item that wraps onto a second line** is read as a link followed by section content.
- **The spec is a proposal.** It may change; the rules follow v2 (August 2026) as published on
  llmstxt.org on the date above. `llms-full.txt` files and the proposed `.md` page versions and
  `Link:` headers are out of scope.

## Security

The library never touches the network or the filesystem. The CLI fetches only the URL you give
it, including `localhost`, so you can lint a dev server, and it reads at most 5 MB. Don't expose
the CLI as a service that fetches URLs for other people without your own SSRF controls. See
[SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md) to report a
vulnerability.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)

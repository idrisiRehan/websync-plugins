# robots-txt-lint

Lint `robots.txt` files against [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html) and
[how Google reads them](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt),
test a URL against the rules, and see which AI crawlers may crawl a site. Every finding has a
line number, a rule id and a plain-English fix.

A robots.txt fails quietly. Crawlers skip lines they can't parse, so a missing colon, a misspelled
`Disallow`, a rule above the first `User-agent` line or a full URL where a path belongs simply has
no effect, and nothing tells you. Other mistakes do the opposite: a second `User-agent: *` group
that ends in `Disallow: /` closes the whole site. This package finds both kinds, explains the
decision behind any URL, and reports where each known AI crawler stands.

```text
$ npx robots-txt-lint examples/robots-with-problems.txt
examples/robots-with-problems.txt: 3 groups, 8 rules, 0 sitemaps
ERROR  rule-outside-group (line 1)
       This Disallow line comes before any User-agent line, so crawlers ignore it (RFC 9309 s2.2.2). Put "User-agent: *" or a crawler's product token above it.
WARN   directive-misspelled (line 4)
       Google's parser reads "Disalow" as Disallow, but RFC 9309 parsers and other crawlers may skip the line. Write "Disallow:".
WARN   colon-missing (line 5)
       There is no colon after "Disallow". Google's parser accepts a space instead, but RFC 9309 s2.2 requires the colon and other crawlers may skip the line. Write "Disallow: /checkout/".
ERROR  path-invalid (line 6)
       "account/" doesn't start with "/" or "*". Crawlers compare a rule with the URL path from its first character (RFC 9309 s2.2.2), so this never matches. Write "Disallow: /account/".
WARN   rule-conflict (line 8)
       Allow on line 7 has the same path, "/private/". Allow wins a tie (RFC 9309 s2.2.2), so the Disallow has no effect; remove the rule you don't mean.
WARN   directive-unsupported (line 9)
       Google ignores Crawl-delay (it reads only user-agent, allow, disallow and sitemap lines). Bing honours it, so it only slows Bing and other crawlers that document it.
WARN   directive-unsupported (line 10)
       Google ignores Noindex in robots.txt: it retired its code for unpublished rules such as noindex on 1 September 2019. To keep a page out of search results, use noindex in a robots meta tag or X-Robots-Tag header, and leave the page crawlable.
ERROR  directive-misspelled (line 11)
       "Dsallow" looks like a misspelling of Disallow. Crawlers skip fields they don't know, so this line has no effect. Write "Disallow:".
WARN   user-agent-invalid (line 13)
       Google reads "Googlebot/2.1" as "Googlebot" and ignores the rest, but other parsers may not match it: a product token has only letters, "-" and "_" (RFC 9309 s2.2.1). Write "User-agent: Googlebot".
ERROR  path-invalid (line 14)
       "https://shop.example.com/admin/" is a full URL; a rule takes the path. Crawlers compare a rule with the URL path from its first character (RFC 9309 s2.2.2), so this never matches. Write "Disallow: /admin/".
WARN   resources-blocked (line 15)
       This blocks Googlebot from CSS or JavaScript files. Google needs them to render pages and won't render JavaScript from blocked files. Allow them unless no page uses them.
ERROR  line-invalid (line 16)
       Crawlers ignore this line: a robots.txt line is a field, a colon and a value, as in "Disallow: /private/". Start a note with "#".
WARN   group-duplicate (line 18)
       "*" already has a group on line 3. Crawlers merge groups for the same agent (RFC 9309 s2.2.1), so the rules of both apply; combine them into one group to make that visible.
WARN   disallow-all (line 19)
       "Disallow: /" for "*" blocks every path that no Allow rule there opens, for every crawler without a group of its own. That suits a staging site; on a live site, search engines that honour robots.txt can crawl only the paths those Allow rules open.
ERROR  sitemap-invalid (line 21)
       "/sitemap.xml" is not a full http or https URL. Google needs the complete URL, including the protocol and host, as in "Sitemap: https://example.com/sitemap.xml".

6 errors, 9 warnings
```

- **Grounded in the sources.** Every rule cites RFC 9309, Google's robots.txt documentation or
  Google's [open-source parser](https://github.com/google/robotstxt/blob/master/robots.cc), and
  says only what they say. Where Google is more lenient than the RFC (a few accepted typos, a
  space instead of the colon), that is a warning, not an error.
- **Honest severities.** An error means crawlers will read the file differently from what you
  wrote: a line they skip, a rule that can never match. Legal but risky choices are warnings.
- **Explains decisions.** `--test` (or `isAllowed()`) says whether a crawler may fetch a URL, and
  names the group and the rule that decided, with RFC 9309 matching: longest match wins, `Allow`
  wins a tie, `*` and `$` patterns, percent-encoding normalised.
- **AI crawler report.** `--ai` (or `aiCrawlerReport()`) lists 21 AI crawler tokens from 10
  operators, each verified on the operator's own documentation.
- **Zero dependencies.** The library is pure and offline; the CLI reads files, stdin and URLs.

## Install

```sh
npm install robots-txt-lint
```

ESM only. The library is plain ES2022; the CLI needs Node 22 or later.

## CLI

```text
robots-txt-lint <file | url | -> [options]

  --test <url-or-path>   Say whether a crawler may fetch this URL, and which rule decides
  --user-agent <token>   Product token for --test, such as Googlebot (default *)
  --ai                   Show which AI crawlers may crawl the site
  --json                 Print the result as JSON
  --max-warnings <n>     Exit with code 1 when there are more than n warnings
  --timeout <ms>         Request timeout for URLs in milliseconds (default 15000)
  -h, --help             Show this help
  -v, --version          Show the version
```

```sh
npx robots-txt-lint public/robots.txt --max-warnings 0
npx robots-txt-lint https://example.com             # fetches https://example.com/robots.txt
npx robots-txt-lint https://example.com --test /checkout/ --user-agent Googlebot
npx robots-txt-lint https://example.com --ai
curl -s https://example.com/robots.txt | npx robots-txt-lint -
```

### URLs and HTTP status

A URL whose path is empty or `/` means the site, so the CLI fetches `/robots.txt` from that
origin. Any other URL is fetched as given; if its path isn't `/robots.txt`, that is the
`location-invalid` error, because crawlers never look anywhere else. Redirects are followed, and
the output names the final URL. Bodies are read up to 1 MiB, which is enough to report a file
over Google's 500 KiB limit.

The status code is handled as [RFC 9309 s2.3.1](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1)
describes:

| Status | What crawlers do | CLI |
|---|---|---|
| 2xx | Follow the rules in the file | Lints it |
| 4xx, except 429 | Treat the file as unavailable and may crawl everything ([s2.3.1.3](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.3)) | Says so and exits 0. `--test` and `--ai` run against an empty file, so everything is allowed. At a path other than `/robots.txt`, reports `location-invalid` instead |
| 429 | The RFC counts every 4xx as unavailable, but [Google](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#http-status-codes) leaves 429 out of that rule | Exits 2, since there is no file to lint |
| 5xx, network error | Assume a complete disallow while the file is unreachable ([s2.3.1.4](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.4)) | Exits 2 with a one-line error |

```text
$ npx robots-txt-lint https://example.com
https://example.com/robots.txt (HTTP 404): no robots.txt. Crawlers treat a 4xx as no file and may crawl everything (RFC 9309 s2.3.1.3).
```

### A real site

Captured on 2026-11-24; the file may have changed since.

```text
$ npx robots-txt-lint https://www.google.com
https://www.google.com/robots.txt (HTTP 200): 5 groups, 431 rules, 1 sitemap
WARN   resources-blocked (line 127)
       This blocks Googlebot from CSS or JavaScript files. Google needs them to render pages and won't render JavaScript from blocked files. Allow them unless no page uses them.
WARN   group-duplicate (line 255)
       "Yandex" already has a group on line 1. Crawlers merge groups for the same agent (RFC 9309 s2.2.1), so the rules of both apply; combine them into one group to make that visible.

0 errors, 2 warnings
```

Line 127 is `Disallow: /trends/embed.js?`, a deliberate block of one script, which is why
`resources-blocked` is a warning: only you know whether a page needs the file.

### Testing a URL

`--test` takes a path or a full URL; only its path and query are compared. A path is percent-encoded
the way a URL is, so `/a b` and `https://example.com/a b` both test `/a%20b`. `--user-agent` takes a
product token (letters, `-` and `_`, as in RFC 9309), not a full `User-Agent` header.

```text
$ npx robots-txt-lint https://www.google.com --test "/search?q=robots" --user-agent Googlebot
https://www.google.com/robots.txt (HTTP 200): 5 groups, 431 rules, 1 sitemap
...

Test: /search?q=robots as Googlebot
BLOCKED by line 4, "Disallow: /search" (the * group, line 1)
```

```text
$ npx robots-txt-lint https://www.google.com --test https://www.google.com/search/about --user-agent Googlebot
...
Test: /search/about as Googlebot
ALLOWED by line 5, "Allow: /search/about" (the * group, line 1)
```

The verdict names the group that applied: the crawler's own group (several groups for one agent
are merged, and all their lines are listed), the `*` group when it has none, or no group, which
allows everything.

### AI crawler report

`--ai` reports, for each crawler in the [AI crawlers table](#ai-crawlers), the group that applies to
it and what that group allows. `blocked` means a rule disallows every path and no `Allow` rule
applies; `allowed` means no `Disallow` rule applies; `partial` is anything in between.

```text
$ npx robots-txt-lint https://www.nytimes.com --ai
https://www.nytimes.com/robots.txt (HTTP 200): 70 groups, 187 rules, 25 sitemaps
...

AI crawlers, by the rules that apply to each (list checked 2026-11-24):
Token                 Operator      Purpose   Access   Group
GPTBot                OpenAI        training  blocked  own (line 233)
OAI-SearchBot         OpenAI        search    blocked  own (line 266)
ChatGPT-User          OpenAI        user      blocked  own (line 177)
ClaudeBot             Anthropic     training  blocked  own (line 180)
Claude-SearchBot      Anthropic     search    blocked  own (line 183)
Claude-User           Anthropic     user      blocked  own (line 186)
Google-Extended       Google        training  blocked  own (line 230)
Applebot-Extended     Apple         training  blocked  own (line 152)
PerplexityBot         Perplexity    search    blocked  own (line 279)
Perplexity-User       Perplexity    user      blocked  own (line 282)
meta-externalagent    Meta          training  blocked  own (line 245)
meta-webindexer       Meta          search    blocked  own (line 253)
meta-externalfetcher  Meta          user      blocked  own (line 249)
Amazonbot             Amazon        training  partial  own (line 146)
Amzn-SearchBot        Amazon        search    partial  * (line 15)
Amzn-User             Amazon        user      partial  * (line 15)
MistralAI-Training    Mistral AI    training  partial  * (line 15)
MistralAI-Index       Mistral AI    search    partial  * (line 15)
MistralAI-User        Mistral AI    user      partial  * (line 15)
DuckAssistBot         DuckDuckGo    search    blocked  own (line 204)
CCBot                 Common Crawl  dataset   blocked  own (line 174)

Notes from the operators:
  ChatGPT-User: OpenAI says robots.txt rules may not apply, because a user starts these fetches.
  ClaudeBot: When robots.txt doesn't name ClaudeBot, Anthropic says it follows the site's general AI training preference (an IETF aipref draft signal).
  Google-Extended: A control token, not a crawler: Google crawls with its usual user agents. It also covers grounding in Gemini, and doesn't affect Google Search.
  Applebot-Extended: Doesn't crawl: it decides whether pages Applebot crawled may train Apple's foundation models.
  Perplexity-User: Perplexity says it generally ignores robots.txt rules, because a user requested the fetch.
  meta-externalfetcher: Meta says it may bypass robots.txt, because a user requested the fetch.
  Amzn-SearchBot: When robots.txt doesn't name it but allows other search bots, Amazon says it follows the rules given to those bots.
  Amzn-User: Amazon says it may not follow all robots.txt directives, because a user can start these fetches.
```

(Captured on 2026-11-24, with the findings cut for length.)

### In a build

```json
{
  "scripts": {
    "postbuild": "robots-txt-lint dist/robots.txt --max-warnings 0"
  }
}
```

```yaml
- name: Lint robots.txt
  run: npx --yes robots-txt-lint@1 https://example.com --max-warnings 0
```

## Library

```ts
import { lintRobotsTxt, isAllowed, aiCrawlerReport, AI_CRAWLERS } from "robots-txt-lint";

const result = lintRobotsTxt(text, { url: "https://example.com/robots.txt" }); // url is optional

result.valid;         // true when there are no errors
result.errorCount;    // number
result.warningCount;  // number
result.findings;      // [{ rule, severity, message, line }], sorted by line
result.groups;        // [{ agents, line, rules: [{ type, pattern, line }] }], in file order
result.sitemaps;      // [{ url, line }], valid absolute http(s) URLs only

// With examples/robots.txt from this package:
const decision = isAllowed(result, "Googlebot", "https://example.com/checkout/?step=2");
decision.allowed;     // false
decision.rule;        // { type: "disallow", pattern: "/checkout/", line: 5 }, or null
decision.group;       // "specific", "*" or null
decision.groupLines;  // [3]
decision.path;        // "/checkout/?step=2", as compared

for (const crawler of aiCrawlerReport(result)) {
  console.log(crawler.token, crawler.purpose, crawler.access); // "GPTBot training blocked"
}
```

`lintRobotsTxt()` never throws on bad text; it throws a `TypeError` only when `text` isn't a
string or `options.url` isn't an absolute URL. `url` is where crawlers request the file; when it
is given, a path other than `/robots.txt` is reported as `location-invalid`.

`isAllowed()` and `aiCrawlerReport()` take robots.txt text or a `lintRobotsTxt()` result (anything
with `groups`). `isAllowed()` throws a `TypeError` when the user agent isn't `*` or a product token
of letters, `-` and `_`, or when the URL is neither absolute nor a path starting with `/`.

### Types

```ts
interface RobotsTxtResult {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  findings: RobotsTxtFinding[];
  groups: RobotsGroup[];
  sitemaps: RobotsSitemap[];
}

interface RobotsTxtFinding {
  rule: RuleId;
  severity: "error" | "warning";
  message: string;
  line: number | null;        // null for findings about the whole file
}

interface RobotsGroup {
  agents: string[];           // user-agent values as written; matching reads the product token
  line: number;               // the group's first user-agent line
  rules: RobotsRule[];
}

interface RobotsRule {
  type: "allow" | "disallow";
  pattern: string;            // as written; "" matches nothing
  line: number;
}

interface RobotsSitemap {
  url: string;
  line: number;
}

interface AccessDecision {
  allowed: boolean;
  rule: RobotsRule | null;    // null when no rule matched, which allows
  group: "specific" | "*" | null;
  groupLines: number[];       // every group that applied; groups for one agent are merged
  path: string;               // the normalised path and query that were compared
}

interface AiCrawler {
  token: string;
  operator: string;
  purpose: "training" | "search" | "user" | "dataset";
  source: string;             // the operator's documentation
  checked: string;            // date last compared with source, YYYY-MM-DD
  note?: string;              // what the operator says changes how robots.txt applies
  userAgent: string | null;   // the name its User-Agent header carries; null for a control token
  ipRanges: string | null;    // the operator's list of the crawler's IP addresses, or null
}

interface AiCrawlerAccess extends AiCrawler {
  access: "allowed" | "blocked" | "partial";
  group: "specific" | "*" | null;
  groupLines: number[];
}
```

### JSON output

The CLI's `--json` output is the lint result with `source` added, `status` for URLs, and `test`
and `ai` when those options are given. For this file on stdin:

```text
User-agent: *
Disallow: /private/
Crawl-delay: 5

Sitemap: https://example.com/sitemap.xml
```

```text
$ npx robots-txt-lint - --json --test /private/report.pdf --user-agent Googlebot < robots.txt
{
  "source": "stdin",
  "valid": true,
  "errorCount": 0,
  "warningCount": 1,
  "findings": [
    {
      "rule": "directive-unsupported",
      "severity": "warning",
      "message": "Google ignores Crawl-delay (it reads only user-agent, allow, disallow and sitemap lines). Bing honours it, so it only slows Bing and other crawlers that document it.",
      "line": 3
    }
  ],
  "groups": [
    {
      "agents": [
        "*"
      ],
      "line": 1,
      "rules": [
        {
          "type": "disallow",
          "pattern": "/private/",
          "line": 2
        }
      ]
    }
  ],
  "sitemaps": [
    {
      "url": "https://example.com/sitemap.xml",
      "line": 5
    }
  ],
  "test": {
    "userAgent": "Googlebot",
    "url": "/private/report.pdf",
    "allowed": false,
    "rule": {
      "type": "disallow",
      "pattern": "/private/",
      "line": 2
    },
    "group": "*",
    "groupLines": [
      1
    ],
    "path": "/private/report.pdf"
  }
}
```

With `--ai`, `ai` is an array of `AiCrawlerAccess` objects, one per crawler in the table.

## Rules

RFC 9309 and Google's documentation were read on 2026-11-24. "Google" links go to
[How Google interprets the robots.txt specification](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt);
"Google's parser" is [robots.cc](https://github.com/google/robotstxt/blob/master/robots.cc).

| Rule | Severity | Meaning | Source |
|---|---|---|---|
| `file-html` | error | The file is an HTML page (a 404 page or app shell served in its place), so crawlers find no rules. Linting stops | [Google: file format](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#file-format) |
| `file-too-large` | error | Over 500 KiB. Google ignores everything after that; the finding is on the line where it stops | [Google: file format](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#file-format), [RFC s2.5](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.5) |
| `location-invalid` | error | With `url`: the file isn't at `/robots.txt` (all lowercase) at the root of the host | [RFC s2.3](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3), [Google: file location](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#file-location-and-range-of-validity) |
| `line-invalid` | error | A line that isn't a field, a colon and a value, so crawlers skip it. Comments start with `#` | [RFC s2.2](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2), [Google: syntax](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#syntax) |
| `colon-missing` | warning | `Disallow /private/`: Google's parser accepts a space for the colon when the line is two words, but the RFC requires the colon | [RFC s2.2](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2), Google's parser (`GetKeyAndValueFrom`) |
| `directive-misspelled` | warning or error | A warning for the typos Google's parser accepts on purpose (`useragent`, `user agent`, `dissallow`, `dissalow`, `disalow`, `diasllow`, `disallaw`, `site-map`) and for field names that start with a known one (`Disallowed`, `Sitemaps`), which it also reads. An error for other near misses (`Dsallow`, `Alow`, `User-agnet`), which every crawler skips | [RFC s2.2.4](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.4), Google's parser (`kAllowFrequentTypos`) |
| `directive-unsupported` | warning | A field other than user-agent, allow, disallow and sitemap, which Google ignores. Crawl-delay names Bing, which [honours it](https://blogs.bing.com/webmaster/2012/5/To-crawl-or-not-to-crawl,-that-is-BingBot-s-questi/); noindex and nofollow point to [the 2019 retirement](https://developers.google.com/search/blog/2019/07/a-note-on-unsupported-rules-in-robotstxt). Not reported inside groups for non-Google crawlers only, where the line may be meant for them | [Google: syntax](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#syntax) |
| `rule-outside-group` | error | An `Allow` or `Disallow` before the first `User-agent` line, which crawlers ignore | [RFC s2.2.2](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.2) |
| `user-agent-invalid` | error or warning | An error for an empty value or a wildcard pattern like `*bot`, which match no crawler. A warning for `Googlebot/2.1` and `Googlebot*`, which Google reads as `Googlebot` but other parsers may not. Names like `MJ12bot` are left alone: Google's parser reads less of them, but the crawler they name may match itself | [RFC s2.2.1](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.1), [Google: order of precedence for user agents](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#order-of-precedence-for-user-agents) |
| `path-invalid` | error | A rule that doesn't start with `/` or `*`, often a full URL. Matching starts at the first character of the path, so it never matches | [RFC s2.2.2](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.2), [Google: syntax](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#syntax) |
| `sitemap-invalid` | error | A `Sitemap` value that isn't a full http or https URL | [Google: sitemap](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#sitemap), [sitemaps.org](https://www.sitemaps.org/protocol.html#submit_robots) |
| `group-duplicate` | warning | A second group for an agent that already has one (the same name up to any `/` or `*`, ignoring case). Crawlers merge them, which is easy to miss | [RFC s2.2.1](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.1), [Google: grouping of rules](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#grouping-of-lines-and-rules) |
| `rule-conflict` | warning | `Allow` and `Disallow` with the same path (after percent-encoding normalisation) in one group. Allow wins, so the `Disallow` does nothing | [RFC s2.2.2](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.2), [Google: order of precedence for rules](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#order-of-precedence-for-rules) |
| `disallow-all` | warning | `Disallow: /` (or `/*`, `*`) in the `*` group, which blocks the whole site (apart from any `Allow` rules there) for every crawler without its own group. Right for staging, wrong for production | [RFC s2.2.1](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.1) |
| `resources-blocked` | warning | A `Disallow` for `.css` or `.js` files that applies to Googlebot and isn't overridden by an `Allow`. Google needs them to render pages | [Google: the example file](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#what-is-a-robots.txt-file), [Google: JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics#how-googlebot-processes-javascript) |

Things that are legal and harmless aren't reported: an empty file, `Disallow:` with no path
(which allows everything), a byte-order mark, comments, CR or CRLF line endings, an empty group
at the end of the file, raw UTF-8 in paths, and duplicate rules.

### How matching works

`isAllowed()`, `--test` and the AI report follow
[RFC 9309 s2.2](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2):

- **Groups.** A group is one or more `User-agent` lines followed by rules; a `User-agent` line after
  a rule starts a new group, and `Sitemap` or unknown lines don't end one. The product token is
  read from each value as Google's parser does (`Googlebot/2.1` is `Googlebot`). The crawler's
  groups are matched case-insensitively and merged; without one, the `*` groups apply; without
  those, nothing is blocked. Specific and `*` groups are never combined.
- **Rules.** The longest matching pattern wins, counted in octets after normalisation, and `Allow`
  wins a tie. Rules with an empty pattern are ignored. `/robots.txt` is always allowed.
- **Patterns.** `*` matches any run of characters and a final `$` anchors the end; a `$` anywhere
  else is literal. Matching is case-sensitive and starts at the first character of the path.
- **Percent-encoding.** Both sides are normalised the same way: characters outside ASCII are
  UTF-8 percent-encoded, escapes of unreserved characters are decoded (`%62` is `b`), and other
  escapes get uppercase hex. A literal `*` or `$` in the URL can be matched by `%2A` or `%24` in a
  rule ([s2.2.3](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.2.3)).

The matcher splits each pattern on `*` and finds each piece in turn, so it runs in linear time
however a pattern is written; no regular expression is built from file content.

## AI crawlers

`AI_CRAWLERS` lists only tokens that the operator documents for robots.txt on its own site. Each
entry was checked on 2026-11-24. Operators add, rename and retire crawlers often, so **this list
needs rechecking every quarter**; each entry's `source` and `checked` fields make that a quick job.

| Token | Operator | Purpose | Source |
|---|---|---|---|
| `GPTBot` | OpenAI | training | [OpenAI crawlers](https://developers.openai.com/api/docs/bots) |
| `OAI-SearchBot` | OpenAI | search | [OpenAI crawlers](https://developers.openai.com/api/docs/bots) |
| `ChatGPT-User` | OpenAI | user | [OpenAI crawlers](https://developers.openai.com/api/docs/bots): "robots.txt rules may not apply" |
| `ClaudeBot` | Anthropic | training | [Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler): without its own group, follows the site's general AI training preference |
| `Claude-SearchBot` | Anthropic | search | [Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) |
| `Claude-User` | Anthropic | user | [Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) |
| `Google-Extended` | Google | training | [Google's common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended): a control token, not a separate crawler; also covers grounding in Gemini |
| `Applebot-Extended` | Apple | training | [About Applebot](https://support.apple.com/en-us/119829): doesn't crawl; controls training on what Applebot crawled |
| `PerplexityBot` | Perplexity | search | [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) |
| `Perplexity-User` | Perplexity | user | [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers): "generally ignores robots.txt rules" |
| `meta-externalagent` | Meta | training | [Meta web crawlers](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers) |
| `meta-webindexer` | Meta | search | [Meta web crawlers](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers) |
| `meta-externalfetcher` | Meta | user | [Meta web crawlers](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers): "may bypass robots.txt" |
| `Amazonbot` | Amazon | training | [Amazonbot](https://developer.amazon.com/amazonbot) |
| `Amzn-SearchBot` | Amazon | search | [Amazonbot](https://developer.amazon.com/amazonbot): without its own group, follows the rules for other search bots |
| `Amzn-User` | Amazon | user | [Amazonbot](https://developer.amazon.com/amazonbot): "may not follow all robots.txt directives" |
| `MistralAI-Training` | Mistral AI | training | [Mistral robots](https://docs.mistral.ai/robots) |
| `MistralAI-Index` | Mistral AI | search | [Mistral robots](https://docs.mistral.ai/robots) |
| `MistralAI-User` | Mistral AI | user | [Mistral robots](https://docs.mistral.ai/robots) |
| `DuckAssistBot` | DuckDuckGo | search | [DuckAssistBot](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot) |
| `CCBot` | Common Crawl | dataset | [CCBot](https://commoncrawl.org/ccbot) |

Each entry also has `userAgent`, the name the crawler's User-Agent header carries (null for
`Google-Extended` and `Applebot-Extended`, which control robots.txt but send no requests of their
own), and `ipRanges`, the list of the crawler's IP addresses that the source page links to (null
for Meta's crawlers and `MistralAI-Training`, whose pages link to none).
[ai-crawler-log](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/ai-crawler-log)
uses both to find these crawlers in access logs and to tell real ones from fakes.

Purposes: `training` collects content that may be used to train models; `search` indexes pages for
an AI search or answer product; `user` fetches a page when a person asks the assistant to;
`dataset` builds a public crawl dataset that others reuse. Amazon says Amazonbot's data "may be
used to train Amazon AI models", so it is listed as training.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No errors (and no more warnings than `--max-warnings`), or a `/robots.txt` URL that answered 4xx (except 429) |
| `1` | Errors, or more warnings than `--max-warnings` |
| `2` | Usage error, unreadable input (missing file, invalid UTF-8, over 1 MiB), HTTP 5xx or 429, timeout or network error |

`--test` and `--ai` don't change the exit code. Errors are printed to stderr as one line, prefixed
`robots-txt-lint:`.

## Limitations

- **It checks robots.txt, nothing else.** A URL that `--test` allows can still be kept out of
  search by a `noindex` meta tag or `X-Robots-Tag` header, or blocked by a firewall. Robots.txt is
  also not access control: [RFC 9309 s3](https://www.rfc-editor.org/rfc/rfc9309.html#section-3)
  notes that listing a path makes it public.
- **Crawlers differ.** Matching follows RFC 9309. Google-only behaviour beyond what the rules
  above mention is not reproduced: its parser also treats `Allow: /index.htm` as `/`, and cuts
  lines over 16,664 bytes. `isAllowed()` reads the whole file, where Google stops at 500 KiB.
- **Reserved characters are compared as written.** The RFC's example of matching a URL inside a
  query string against `%3A%2F%2F` works only when the request is percent-encoded the same way.
- **The AI report reads the rules, not the crawlers.** It shows what each token's group allows
  under RFC 9309. Some operators say their user-triggered fetchers may ignore robots.txt, and some
  fall back to other groups (see the notes). `partial` is coarse: an `Allow: /` next to a
  `Disallow: /` also reads as partial.
- **`resources-blocked` only sees rules that name `.css` or `.js`.** A rule like
  `Disallow: /assets/` that happens to hold scripts isn't detected.
- **Sitemap URLs aren't fetched**, and `Crawl-delay` values aren't checked.
- **Redirects:** the CLI follows up to 20 hops, the `fetch` default. RFC 9309 asks crawlers to
  follow at least five; Google follows at least five, then stops and treats the file as a 404.
- **Encoding:** the CLI refuses a file that isn't valid UTF-8, which RFC 9309 s2.3 requires. The
  library takes a string, so decoding is the caller's job.

## Security

The library never touches the network or the filesystem. The CLI fetches only the URL you give
it (plus its redirects), including `localhost`, so you can lint a dev server, and it reads at
most 1 MiB with a timeout. It sends a fixed `User-Agent` naming the package. Don't expose the CLI
as a service that fetches URLs for other people without your own SSRF controls. See
[SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md) to report a
vulnerability.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)

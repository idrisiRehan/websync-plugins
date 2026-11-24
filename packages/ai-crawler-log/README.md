# ai-crawler-log

Point it at your server's access logs and see which AI crawlers read your site: requests per
crawler, the pages and products they fetch, the errors they get, whether they read robots.txt,
llms.txt and your sitemaps, and which "crawlers" are fakes, because the address a request came
from isn't one the crawler's operator publishes.

```sh
npx ai-crawler-log /var/log/nginx/access.log /var/log/nginx/access.log.*.gz
```

Your robots.txt says what AI crawlers may do; your access log says what they actually did.
Analytics tools don't show it, because crawlers don't run JavaScript, and a user agent alone
proves nothing, since any script can send `GPTBot/1.4`. This package reads the log you already
have, matches each request to a known crawler, and checks the client address against the IP
lists that OpenAI, Anthropic, Perplexity, Amazon, Google and others publish for their crawlers.

The output below is from `examples/synthetic-access.log`, a **synthetic** week of an online
store's nginx log made by `examples/generate-synthetic-log.mjs`. Every request in it is invented.
Crawler requests use the crawlers' published user agents and addresses inside their operators'
lists as published on 2026-11-24; the fakes and the visitors use the documentation address
ranges, which belong to nobody. Captured on 2026-11-24 with the operators' live lists:

```text
$ npx ai-crawler-log examples/synthetic-access.log
examples/synthetic-access.log: 1,013 lines, 1 unreadable, 2026-11-17 00:03 to 2026-11-23 23:57 UTC
IP lists: 15 of 15 fetched from the operators.

AI crawler          Operator      Requests  Verified  Spoofed  Products  4xx  5xx
GPTBot              OpenAI             120        90       30        59    0    4
OAI-SearchBot       OpenAI              40        40        0        28    0    0
ChatGPT-User        OpenAI              20        20        0        20    0    0
ClaudeBot           Anthropic          110       110        0        82   28    0
Claude-User         Anthropic            6         6        0         6    0    0
PerplexityBot       Perplexity          40        30       10        20    0    0
Perplexity-User     Perplexity           5         5        0         5    0    0
meta-externalagent  Meta                50       n/a      n/a        35    0    0
Amazonbot           Amazon              24        24        0        15    3    0
MistralAI-User      Mistral AI           2         2        0         2    0    0
DuckAssistBot       DuckDuckGo           4         4        0         4    0    0
CCBot               Common Crawl        12        12        0         7    0    0

Search engine  Operator  Requests  Verified  Spoofed  Products  4xx  5xx
Googlebot      Google         108       100        8        64    4    0
Applebot       Apple           16        16        0        14    0    0

Other requests: 455
Not seen: Claude-SearchBot, meta-webindexer, meta-externalfetcher, Amzn-SearchBot, Amzn-User, MistralAI-Training, MistralAI-Index
n/a: the operator publishes no IP list. -: its IP list wasn't loaded.

Highlights:
  - AI crawlers made 433 of 1,012 requests (42.8%); the search engines counted here made 124.
  - 30 requests claimed GPTBot from addresses OpenAI doesn't publish.
  - 10 requests claimed PerplexityBot from addresses Perplexity doesn't publish.
  - 8 requests claimed Googlebot from addresses Google doesn't publish.
  - ClaudeBot got 28 error responses (4xx or 5xx), most on /products/holiday-gift-box (12).
  - GPTBot got 4 error responses (4xx or 5xx), most on /products/merino-beanie (2).
  - Amazonbot got 3 error responses (4xx or 5xx).
  - Product pages fetched: ClaudeBot 82, GPTBot 59, meta-externalagent 35 and 9 others.
  - llms.txt was requested by ClaudeBot (2).
  - 50 requests from meta-externalagent can't be verified: its operator publishes no IP addresses.

Top paths (up to 3 per crawler, spoofed requests left out; ~ marks an estimate):
  GPTBot
    9  /products/travel-mug
    8  /products/leather-belt
    8  /products/merino-beanie
  ClaudeBot
    12  /products/holiday-gift-box
    10  /products/trail-sock-3-pack
     8  /
  ...
```

(The top paths of the other crawlers are cut for length.) The exit code is 1, because spoofed
requests were found.

- **Real verification.** A request is *verified* when its address is in the operator's published
  list, *spoofed* when it isn't, and *unverified* when the operator publishes no list. A crawler
  whose operator publishes nothing is never called a fake.
- **One source of truth.** The AI crawlers, their user agents and the URLs of their IP lists come
  from the table in
  [robots-txt-lint](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/robots-txt-lint#ai-crawlers),
  where every entry was checked on the operator's own page.
- **Any size of log.** Files are streamed line by line, gzipped or not, with memory that stays flat
  however many lines or distinct URLs there are. A 1,013,000-line log runs in a 32 MB heap.
- **Private by default.** Logs never leave your machine, and the report never contains a client
  address. See [Privacy](#privacy).
- **Zero third-party dependencies.** Node's built-in `fetch` and `zlib`, plus robots-txt-lint and
  redirect-inspector from the same repository, which have no dependencies either. TypeScript
  types are included.

## Install

```sh
npm install ai-crawler-log
```

Or run it without installing: `npx ai-crawler-log access.log`. ESM only. Needs Node 22 or later.

## CLI

```text
ai-crawler-log <file...|-> [options]
ai-crawler-log --dump-ranges > ranges.json

  --format <name>      auto (default), combined, common or json
  --product <pattern>  Path fragment that marks a product page, * for any text;
                       repeat for more (default /products/ and /product/)
  --ranges <file>      Read the operators' IP lists from a --dump-ranges file
                       instead of fetching them
  --no-verify          Don't load IP lists, so nothing is verified or spoofed
  --dump-ranges        Fetch the operators' IP lists and print them as JSON
  --show-networks      Also list the /24 or /48 networks spoofed requests came from
  --json               Print the report as JSON
  --top <n>            Paths listed per crawler, 1 to 100 (default 3)
  --timeout <ms>       Timeout for each IP list request (default 15000)
  -h, --help           Show this help
  -v, --version        Show the version
```

```sh
npx ai-crawler-log access.log                         # one file
npx ai-crawler-log access.log access.log.1 access.log.*.gz   # rotated logs, added up
zcat access.log.*.gz | npx ai-crawler-log -           # stdin, plain or gzipped
npx ai-crawler-log access.log --product /shop/item/   # your own product URLs
npx ai-crawler-log access.log --json > report.json
```

Input is gzipped when it starts with the gzip magic bytes, whatever the file is called, and a file
of several gzip members (`cat a.gz b.gz`) is read to the end. Several files are added up into one
report. A blank line is skipped; a line that can't be read is counted as unreadable, and so is a
line longer than 64 KiB, which isn't kept. If no line at all can be read, the CLI exits with code
2, which usually means the log is in a format it doesn't know.

### Where the IP lists come from

By default the CLI fetches the 15 lists named in the [crawler table](#crawlers-and-ip-lists) before
reading the logs: one GET per list, in parallel, each with a timeout (`--timeout`, default 15
seconds) and a 4 MiB cap on the body. Nothing else is requested. A list that fails to load (or
holds no valid IP range, or is missing from a `--ranges` file) is named in the report and its
crawlers' requests are counted as unverified, never as spoofed.

For a server without outbound access, or to analyse old logs against the same lists every time,
save them once and reuse the file:

```text
$ npx ai-crawler-log --dump-ranges > ranges.json
$ head -8 ranges.json
{
  "fetched": "2026-11-24T16:56:37.121Z",
  "lists": {
    "https://openai.com/gptbot.json": {
      "creationTime": "2026-09-22T02:00:07.000000",
      "prefixes": [
        "132.196.86.0/24",
        "172.182.202.0/25",
$ npx ai-crawler-log access.log --ranges ranges.json
```

With `--ranges` the CLI makes no network request at all. `--no-verify` skips the lists too, and
then nothing is verified or counted as spoofed. Operators change their lists (see
[Limitations](#limitations)), so refresh a saved file before analysing new logs.

### Product pages

A request is a product page when its path (without the query string) contains a product pattern
and continues past it. The defaults are `/products/` (Shopify, including
`/collections/x/products/y` and locale prefixes such as `/en-gb/products/y`) and `/product/`
(WooCommerce's default permalink base). `--product` replaces both; repeat it for several
patterns. `*` stands for any run of characters, so `--product "/shop/*/p/"` matches
`/shop/shoes/p/123`. Patterns are matched as text, never compiled into regular expressions.

robots.txt is `/robots.txt`; llms.txt is `/llms.txt` or `/llms-full.txt`; a sitemap is any `.xml`
or `.xml.gz` file with "sitemap" in its name (`/sitemap.xml`, Shopify's
`/sitemap_products_1.xml`, WordPress's `/wp-sitemap.xml`, Yoast's `/product-sitemap.xml`). They
are counted per crawler in the JSON output.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Report printed and no request was spoofed. With `--dump-ranges`: every list fetched |
| `1` | Report printed and at least one request was spoofed. With `--dump-ranges`: some lists failed (the rest are printed) |
| `2` | Usage error, a missing or unreadable file, broken gzip, a bad `--ranges` file, no line readable as an access log, or (with `--dump-ranges`) no list fetched |

Errors are printed to stderr as one line, prefixed `ai-crawler-log:`. Exit code 1 lets a cron job
alert you when fake crawlers show up:

```sh
npx ai-crawler-log /var/log/nginx/access.log.1 --ranges ranges.json > /tmp/crawlers.txt || mail -s "Fake crawlers" you@example.com < /tmp/crawlers.txt
```

## Log formats

`--format auto` (the default) reads a line that starts with `{` as JSON and any other line as
Common or Combined, so one file can mix them. Name a format to accept only that one.

### Combined (`combined`)

The NCSA Combined format: Apache's `combined` and nginx's default `combined` log format.

```text
132.196.86.12 - - [24/Nov/2026:10:15:32 +0000] "GET /products/wool-runner HTTP/1.1" 200 51234 "-" "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot"
```

```text
Apache: LogFormat "%h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-agent}i\"" combined
nginx:  log_format combined '$remote_addr - $remote_user [$time_local] '
                            '"$request" $status $body_bytes_sent '
                            '"$http_referer" "$http_user_agent"';
```

Fields after the user agent (nginx's `"$http_x_forwarded_for"`, a response time) are ignored.
Escapes inside quoted fields are decoded as both servers write them: Apache's `\"`, `\\` and
`\xhh`, and nginx's `\x22` and `\x5C`
([Apache](https://httpd.apache.org/docs/2.4/mod/mod_log_config.html),
[nginx](https://nginx.org/en/docs/http/ngx_http_log_module.html#log_format)); both escape each
byte of a non-ASCII character, and those bytes are read back as UTF-8. A `-` size counts as
0 bytes. The time must be the `[24/Nov/2026:10:15:32 +0000]` form; its offset is applied.

### Common (`common`)

The Common Log Format, `%h %l %u %t "%r" %>s %b`, has no user agent, so no request in it can be
matched to a crawler: such lines count only towards the total. In `auto` mode a Common line is
read as such; `--format common` also ignores the user agent of Combined lines.

```text
192.0.2.1 - - [24/Nov/2026:10:15:32 +0000] "GET / HTTP/1.1" 200 2326
```

### JSON lines (`json`)

One JSON object per line. These field names are read, the first one present winning:

| Value | Cloudflare Logpush | Caddy | nginx JSON `log_format` |
|---|---|---|---|
| Client address | `ClientIP` | `request.client_ip`, then `request.remote_ip` | `remote_addr` |
| Time | `EdgeStartTimestamp` | `ts` | `time_iso8601`, `time_local`, `msec` |
| Method | `ClientRequestMethod` | `request.method` | `request_method`, or from `request` |
| Path | `ClientRequestURI`, then `ClientRequestPath` | `request.uri` | `request_uri`, `uri`, or from `request` |
| Status | `EdgeResponseStatus` | `status` | `status` |
| Bytes | `EdgeResponseBytes` | `size` | `body_bytes_sent`, then `bytes_sent` |
| User agent | `ClientRequestUserAgent` | `request.headers["User-Agent"][0]` | `http_user_agent` |

- **Cloudflare:** the
  [HTTP requests dataset](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/)
  of Logpush or Logpull. Include the fields above in the job. `EdgeStartTimestamp` may be
  `unixnano` (the default), `unix` or `rfc3339`; all three are read.
- **Caddy:** the [structured access log](https://caddyserver.com/docs/logging) (`log` in a site
  block, JSON encoder). `client_ip` is the client after Caddy's `trusted_proxies`, so it is
  preferred.
- **nginx:** nginx has no JSON format of its own. Use one with
  [`escape=json`](https://nginx.org/en/docs/http/ngx_http_log_module.html#log_format) whose keys are
  the variable names:

```nginx
log_format crawlers escape=json '{"remote_addr":"$remote_addr","time_iso8601":"$time_iso8601",'
  '"request":"$request","status":"$status","body_bytes_sent":"$body_bytes_sent",'
  '"http_user_agent":"$http_user_agent"}';
```

Numbers may be JSON numbers or numeric strings; `"-"` and `""` count as missing, as nginx writes
them. A JSON line with neither a path nor a status (a Caddy startup message, say) is unreadable.

Other formats, such as Apache's `vhost_combined` (which starts with the virtual host), IIS's W3C
format or AWS load balancer logs, aren't read.

## How requests are counted

**Matching.** A request belongs to a crawler when its User-Agent contains the crawler's name as a
whole product name, ignoring case: `GPTBot/1.4` and `gptbot` match GPTBot, while `NotGPTBot`,
`GPTBotX` and `Googlebot-Image` match nothing (a name must not touch a letter, digit, `-` or `_`).
`Google-Extended` and `Applebot-Extended` are left out: they are robots.txt control tokens, and
their operators crawl under other user agents, so a request that names them isn't theirs.
Requests from everything else, including lines with no user agent, are "other requests".

**Verification.** For a crawler whose operator publishes an IP list, each request is:

- **verified** when its client address is in the list (IPv4, IPv6, and IPv4-mapped IPv6 such as
  `::ffff:132.196.86.12`, compared with exact prefix arithmetic);
- **spoofed** when its address is outside the list;
- **unverified** when the list wasn't loaded, or the logged client isn't an IP address (a
  hostname, or `-`).

For a crawler whose operator publishes no list, every request is unverified, and the report says
so ("n/a"). The per-path figures (status classes, product pages, top paths, bytes, first and last
seen) leave spoofed requests out, so they describe what the real crawler did; `requests` counts
them all.

**Top paths are estimates past 1,000 paths.** Each list (top paths, top products, top errors)
keeps 1,000 counters per crawler, using the Space-Saving algorithm (Metwally, Agrawal and El
Abbadi, "Efficient Computation of Frequent and Top-k Elements in Data Streams", ICDT 2005).
While a crawler has fetched at most 1,000 distinct paths, every count is exact. Past that, any path
that accounts for more than 1/1000 of the requests a list counts is guaranteed to keep a counter,
and each count is an upper bound: `overcount` in
the JSON (and `~` in the text) says by how much it may be too high, at most 1/1000 of those requests. Paths are counted without the query string and cut to 1,024 characters.

## Crawlers and IP lists

The AI crawlers are those in
[robots-txt-lint's table](https://github.com/idrisiRehan/websync-plugins/tree/main/packages/robots-txt-lint#ai-crawlers)
that send a user agent; Googlebot and Applebot are a search engine baseline to compare with. Every
user agent and list URL below was read on the operator's own page on 2026-11-24.

| Crawler | Operator | IP list | Source |
|---|---|---|---|
| GPTBot | OpenAI | https://openai.com/gptbot.json | [OpenAI crawlers](https://developers.openai.com/api/docs/bots) |
| OAI-SearchBot | OpenAI | https://openai.com/searchbot.json | [OpenAI crawlers](https://developers.openai.com/api/docs/bots) |
| ChatGPT-User | OpenAI | https://openai.com/chatgpt-user.json | [OpenAI crawlers](https://developers.openai.com/api/docs/bots) |
| ClaudeBot | Anthropic | https://claude.com/crawling/bots.json | [Anthropic crawlers](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) |
| Claude-SearchBot | Anthropic | https://claude.com/crawling/bots.json | as above |
| Claude-User | Anthropic | https://claude.com/crawling/bots.json | as above |
| PerplexityBot | Perplexity | https://www.perplexity.ai/perplexitybot.json | [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) |
| Perplexity-User | Perplexity | https://www.perplexity.ai/perplexity-user.json | [Perplexity crawlers](https://docs.perplexity.ai/docs/resources/perplexity-crawlers) |
| meta-externalagent | Meta | none published | [Meta web crawlers](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers) |
| meta-webindexer | Meta | none published | as above |
| meta-externalfetcher | Meta | none published | as above |
| Amazonbot | Amazon | https://developer.amazon.com/amazonbot/ip-addresses/ | [Amazonbot](https://developer.amazon.com/amazonbot) |
| Amzn-SearchBot | Amazon | https://developer.amazon.com/amazonbot/searchbot-ip-addresses/ | [Amazonbot](https://developer.amazon.com/amazonbot) |
| Amzn-User | Amazon | https://developer.amazon.com/amazonbot/live-ip-addresses/ | [Amazonbot](https://developer.amazon.com/amazonbot) |
| MistralAI-Training | Mistral AI | none published | [Mistral robots](https://docs.mistral.ai/robots) |
| MistralAI-Index | Mistral AI | https://mistral.ai/mistralai-index-ips.json | [Mistral robots](https://docs.mistral.ai/robots) |
| MistralAI-User | Mistral AI | https://mistral.ai/mistralai-user-ips.json | [Mistral robots](https://docs.mistral.ai/robots) |
| DuckAssistBot | DuckDuckGo | https://duckduckgo.com/duckassistbot.json | [DuckAssistBot](https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot) |
| CCBot | Common Crawl | https://index.commoncrawl.org/ccbot.json | [CCBot](https://commoncrawl.org/ccbot) |
| Googlebot | Google | https://developers.google.com/static/crawling/ipranges/common-crawlers.json | [Google's common crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) |
| Applebot | Apple | https://search.developer.apple.com/applebot.json | [About Applebot](https://support.apple.com/en-us/119829) |

Notes from those pages:

- **Anthropic** publishes one list for all three of its bots, and names them by their robots.txt
  tokens without showing an example User-Agent header. They are matched by token, as every other
  operator's documented header contains its token.
- **Amazon**'s lists are HTML pages holding JSON, partly with bare addresses and partly with AWS's
  `ip_prefix` key; all of that is read.
- **Meta** says to allow-list its crawlers by user agent or IP address but links no list, and
  **Mistral AI** lists none for MistralAI-Training, so those requests are unverifiable.
- **Apple**'s page links the list over `http://`; the same file is served over `https://`, which is
  what is fetched. Apple and Common Crawl also describe reverse DNS checks, which this package
  doesn't do (it makes no DNS queries).
- **Google-Extended** and **Applebot-Extended** never crawl, as their pages say, so they are not
  matched in logs. Google's AI training and grounding fetches arrive as Googlebot.

## Library

```ts
import { createLogAnalyzer, reportHighlights, parseRangeFile, IpRangeSet, verifyIp } from "ai-crawler-log";

const analyzer = createLogAnalyzer({
  format: "auto",                        // or "combined", "common", "json"
  productPatterns: ["/products/", "/product/"],
  ranges: {                              // keyed by the IP list URL in the crawler table
    "https://openai.com/gptbot.json": parseRangeFile(gptbotJsonText).prefixes,
  },
  top: 20,                               // entries in each top list, 1 to 100
  networks: false,                       // true counts spoofers by /24 or /48
});

for (const line of lines) analyzer.add(line); // one line at a time, any number of lines
const report = analyzer.result();             // can be called at any time
const sentences = reportHighlights(report);

verifyIp("::ffff:132.196.86.12", ["132.196.86.0/24"]); // true
```

The library is offline and pure: it takes lines and IP lists as data and never touches the
network or the filesystem. Fetching lists is the CLI's job; `parseRangeFile(text)` reads an
operator's file (JSON, or Amazon's HTML page) into `{ creationTime, prefixes }`.
`examples/count-crawlers.mjs` streams a file through the analyzer with `node:readline`.

- `createLogAnalyzer(options)` throws a `TypeError` for an unknown format, a `top` outside 1 to
  100, a product pattern that doesn't start with `/` or contains whitespace, or a `ranges` value
  that isn't an array or an `IpRangeSet`. `add()` and `result()` never throw.
- `parseLogLine(line, format)` returns one `LogEntry` (`ip`, `time`, `method`, `target`, `status`,
  `bytes`, `userAgent`) or null. It never throws.
- `new IpRangeSet(prefixes)` builds a set for many lookups; invalid entries are skipped and counted
  in `invalid`. `verifyIp(ip, rangesOrSet)` returns false for anything that isn't an IP address.
- `matchCrawler(userAgent)` returns the crawler a User-Agent names, or null. `CRAWLERS`,
  `SEARCH_CRAWLERS` and `RANGE_URLS` expose the table.

## JSON output

`--json` prints the analyzer's result with `sources`, `ipLists` and `highlights` added. The
top-level fields, from the example above (the `ipLists.loaded` array is cut to two entries):

```json
{
  "sources": ["examples/synthetic-access.log"],
  "ipLists": {
    "from": "fetched",
    "loaded": [
      { "url": "https://openai.com/gptbot.json", "creationTime": "2026-09-22T02:00:07.000000", "prefixes": 18 },
      { "url": "https://openai.com/searchbot.json", "creationTime": "2026-01-02T11:00:00.000000", "prefixes": 39 }
    ],
    "failed": []
  },
  "lines": 1013,
  "parsed": 1012,
  "unparsed": 1,
  "firstSeen": "2026-11-17T00:03:50.000Z",
  "lastSeen": "2026-11-23T23:57:26.000Z",
  "crawlers": [ ... ],
  "other": { "requests": 455, "bytes": 14034540 },
  "highlights": [ "AI crawlers made 433 of 1,012 requests (42.8%); the search engines counted here made 124.", ... ]
}
```

`ipLists.from` is `fetched`, `file` or `off`; `failed` holds `{ url, error }`. `crawlers` holds one
object per crawler in the table, seen or not, AI crawlers first. GPTBot's, with
`--show-networks --top 3`:

```json
{
  "token": "GPTBot",
  "operator": "OpenAI",
  "kind": "ai",
  "purpose": "training",
  "ipRanges": "https://openai.com/gptbot.json",
  "verification": "checked",
  "requests": 120,
  "verified": 90,
  "spoofed": 30,
  "unverified": 0,
  "status": { "2xx": 86, "3xx": 0, "4xx": 0, "5xx": 4 },
  "bytes": 2786175,
  "firstSeen": "2026-11-17T02:19:12.000Z",
  "lastSeen": "2026-11-23T20:01:41.000Z",
  "productPages": 59,
  "robotsTxt": 5,
  "llmsTxt": 0,
  "sitemaps": 0,
  "topPaths": [
    { "path": "/products/travel-mug", "requests": 9, "overcount": 0 },
    { "path": "/products/leather-belt", "requests": 8, "overcount": 0 },
    { "path": "/products/merino-beanie", "requests": 8, "overcount": 0 }
  ],
  "topProducts": [ ... ],
  "topErrors": [
    { "path": "/products/merino-beanie", "requests": 2, "overcount": 0 },
    { "path": "/products/linen-shirt", "requests": 1, "overcount": 0 },
    { "path": "/products/travel-mug", "requests": 1, "overcount": 0 }
  ],
  "spoofedNetworks": [
    { "network": "203.0.113.0/24", "requests": 20, "overcount": 0 },
    { "network": "198.51.100.0/24", "requests": 10, "overcount": 0 }
  ]
}
```

| Field | Meaning |
|---|---|
| `kind`, `purpose` | `ai` with robots-txt-lint's purpose (`training`, `search`, `user`, `dataset`), or `search` with `null` for the baseline |
| `verification` | `checked` (the list was loaded), `unverifiable` (the operator publishes none) or `unchecked` (it wasn't loaded) |
| `requests` | Every request whose User-Agent names the crawler. `verified + spoofed + unverified = requests` |
| `status` ... `topErrors` | The requests that weren't spoofed. `status` counts 2xx to 5xx; `bytes` is null when no line logged a size; times are ISO 8601 UTC or null |
| `topErrors` | Paths that answered 4xx or 5xx, by how often |
| `spoofedNetworks` | With `--show-networks` only (the library's `networks` option); otherwise `null` |

## Privacy

Access logs hold personal data: client IP addresses, and often paths and query strings that
identify people. This package is built so that none of it goes anywhere.

- **Everything stays on your machine.** The logs are read locally and never sent anywhere. The
  only network requests are the GETs for the operators' IP lists, which carry nothing from your
  logs; with `--ranges` or `--no-verify` there are none.
- **No client address in the output.** The text report and the JSON contain counts and paths,
  never a client IP, verified or not. `--show-networks` adds the /24 (IPv4) or /48 (IPv6) networks
  that spoofed requests came from, which is enough to block a scanner's network and too coarse to
  single out a person; there is no option to print full addresses.
- **Paths are printed.** Top paths are printed without their query strings, but a path itself can
  identify someone (`/account/jane-doe`). Review a report before you share it.
- **Nothing is stored.** The CLI writes only to stdout and stderr, and keeps no state between
  runs.

## Security

The library never touches the network or the filesystem. The CLI reads only the files you name
(or stdin) and fetches only the IP list URLs in the crawler table: http and https from the
operators' own sites, with a timeout and a 4 MiB cap on each body, and a fixed `User-Agent`
naming the package. Log lines are parsed by a hand-written scanner with no backtracking, the
few regular expressions are anchored and linear, product patterns are matched as text, and
lines over 64 KiB are dropped as unreadable, so a hostile log can't exhaust CPU or memory. Gzip
is decompressed as a stream, so a compression bomb costs time, not memory. The CLI is meant to run
on your own machine;
don't expose it as a service that reads files for other people. See
[SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md) to report a
vulnerability.

## Limitations

- **Behind a CDN or proxy, the log may show the proxy's address.** If Cloudflare, a load
  balancer or a reverse proxy sits in front of your server, the client address in the log is
  the proxy's unless the server is configured to log the real one (nginx's
  [realip module](https://nginx.org/en/docs/http/ngx_http_realip_module.html), Apache's
  [mod_remoteip](https://httpd.apache.org/docs/2.4/mod/mod_remoteip.html), Caddy's
  `trusted_proxies`). Otherwise every crawler request looks spoofed. Check one known request
  first, or use the CDN's own logs (Cloudflare Logpush has `ClientIP`).
- **User agents can be faked, which is why requests are verified.** A fake that sends a browser
  user agent is not counted as a crawler at all, and a crawler whose operator publishes no list
  can't be told apart from a fake that copies its user agent.
- **Operators change their lists.** A request from an address added after the list was fetched
  shows as spoofed, and one from an address an operator dropped still verifies. Fetch fresh lists
  (the default) or refresh a `--dump-ranges` file before analysing new logs, and expect the lists
  to describe the present rather than the dates in an old log.
- **No reverse DNS.** Some operators (Google, Apple, Common Crawl) also describe reverse DNS
  checks. This package compares addresses with published lists only.
- **The crawler table needs upkeep.** Operators add and rename crawlers. The table is
  robots-txt-lint's, which is rechecked every quarter; a crawler not in it counts as other
  traffic.
- **Top paths are estimates for crawlers that fetch more than 1,000 distinct paths**, with the
  bounds explained [above](#how-requests-are-counted).
- **Time zones:** times are read with their offsets and reported in UTC. A Caddy `ts` or nginx
  `msec` value is taken as Unix time.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)

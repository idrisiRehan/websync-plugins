# redirect-inspector

Follow a URL's redirects one hop at a time and report what's wrong with the chain: loops,
missing or invalid `Location` headers, HTTPS downgrades, temporary redirects, long chains and
a final page that isn't a success. Check a whole redirect map in one run after a site
migration, and fail CI when a redirect stops landing where it should.

```text
$ npx redirect-inspector http://www.github.com
http://www.github.com/
  301     97 ms  http://www.github.com/
  301     33 ms  https://www.github.com/
  200     41 ms  https://github.com/
WARN   redirect-chain
       2 redirects in a row. Point the first URL directly to the final one (https://github.com/).
Final: 200 https://github.com/ after 2 redirects
0 errors, 1 warning
```

All output in this README was captured from live public URLs on 2026-11-24.

- **Every hop is visible.** Requests use `redirect: "manual"`, so you see each status,
  `Location` and timing, not just where the chain ended.
- **Rules cite their source.** Status code semantics follow
  [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html). The default limit of 10 redirects
  matches Google's crawlers.
- **Redirect maps.** `--map` checks a file of `from-url target-url` lines and reports each
  redirect that ends somewhere else.
- **Zero dependencies.** It uses the `fetch` built into Node. TypeScript types are included.

## Install

```sh
npm install redirect-inspector
```

ESM only. Needs Node 22 or later.

## CLI

```text
redirect-inspector <url...> [options]
redirect-inspector --map <file> [options]

  --json               Print the results as a JSON array
  --expect <url>       Exit with code 1 unless the chain ends at this URL (one URL only;
                       a path such as /new is resolved against that URL)
  --map <file>         Check a redirect map: one "from-url target-url" pair per line
  --max-hops <n>       Redirects to follow before stopping (default 10)
  --timeout <ms>       Timeout for each request in milliseconds (default 10000)
  --method <method>    GET (default, the body is never read) or HEAD
```

```sh
npx redirect-inspector http://example.com https://example.com/old-page
npx redirect-inspector http://example.com --expect https://example.com/
npx redirect-inspector --map redirects.txt
npx redirect-inspector https://example.com/old --json > redirects.json
```

URLs need their scheme (`http://` or `https://`), because where a chain starts matters. Several
URLs, or the lines of a map, are checked four at a time, and results print in input order.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No errors. Warnings alone don't fail |
| `1` | At least one error, or a chain that didn't end at the expected URL (`--expect`, `--map`) |
| `2` | A usage or input error (nothing is fetched), or a request that failed (timeout, DNS, refused connection) |

### Redirect maps

A map has one redirect per line: the old URL, then the URL it should end at, separated by
spaces or tabs. Blank lines and lines starting with `#` are ignored. A target that is only a
path is resolved against its old URL. A malformed line stops the run with its line number
before anything is fetched. See
[examples/redirects.txt](https://github.com/idrisiRehan/websync-plugins/blob/main/packages/redirect-inspector/examples/redirects.txt).

Output from that example file, which uses live public URLs (three passing entries are cut):

```text
$ npx redirect-inspector --map examples/redirects.txt
http://websync.in/
  301    156 ms  http://websync.in/
  200     61 ms  https://websync.in/
Final: 200 https://websync.in/ after 1 redirect
OK  ends at the expected https://websync.in/
No problems found.

...

https://nodejs.org/en/docs
  307     69 ms  https://nodejs.org/en/docs
  200     66 ms  https://nodejs.org/docs/latest/api/
WARN   redirect-temporary (hop 1)
       307 is a temporary redirect, so search engines keep treating https://nodejs.org/en/docs as the main URL. If the move is permanent, use 301 or 308.
Final: 200 https://nodejs.org/docs/latest/api/ after 1 redirect
OK  ends at the expected https://nodejs.org/docs/latest/api/
0 errors, 1 warning

http://example.com/
  200     33 ms  http://example.com/
WARN   https-missing
       http://example.com/ is plain HTTP and never redirects to HTTPS.
Final: 200 http://example.com/ after 0 redirects
MISMATCH  expected https://example.com/, ended at http://example.com/
0 errors, 1 warning

6 URLs checked: 0 with errors, 1 not at the expected URL.
```

The run exits 1 because of the mismatch.

### In CI

```yaml
- name: Check redirects after the migration
  run: npx --yes redirect-inspector@1 --map redirects.txt
```

## Library

```ts
import { inspectRedirects } from "redirect-inspector";

const result = await inspectRedirects("http://example.com/old", { timeoutMs: 5000 });

result.finalUrl;    // where the chain ended
result.finalStatus; // 200, or null when the last request failed
result.valid;       // true when there are no errors
for (const hop of result.hops) console.log(hop.status, hop.url, `${hop.durationMs} ms`);
for (const f of result.findings) console.log(f.severity, f.rule, f.message);
```

```ts
function inspectRedirects(url: string, options?: InspectOptions): Promise<RedirectResult>;

interface InspectOptions {
  maxHops?: number;          // redirects to follow before stopping (default 10)
  timeoutMs?: number;        // per request (default 10000)
  userAgent?: string;        // default "redirect-inspector (+https://github.com/idrisiRehan/websync-plugins)"
  method?: "GET" | "HEAD";   // default "GET"; the body is cancelled unread
  fetch?: typeof fetch;      // inject a fetch for tests or a custom agent
}

interface RedirectResult {
  url: string;               // the start URL
  hops: RedirectHop[];       // one per response, in order
  finalUrl: string;          // the last response's URL, or the URL whose request failed
  finalStatus: number | null;
  valid: boolean;            // errorCount === 0
  findings: RedirectFinding[];
  errorCount: number;
  warningCount: number;
}

interface RedirectHop {
  url: string;
  status: number;
  statusText: string;        // the reason phrase, which can be empty
  location: string | null;   // the Location header as sent (raw UTF-8 decoded), possibly relative
  durationMs: number;        // until the response headers arrived
}

interface RedirectFinding {
  rule: RuleId;              // stable kebab-case id, listed below
  severity: "error" | "warning";
  message: string;
  hop: number | null;        // 1-based index into hops, or null for the whole chain
}
```

`REDIRECT_STATUSES` is also exported: the set of statuses that are followed as redirects
(301, 302, 303, 307 and 308, the Fetch Standard's redirect statuses).

`inspectRedirects()` throws only for a start URL that isn't an absolute http(s) URL, for
invalid options, and in a runtime whose `fetch` hides redirect responses (browsers return an
opaque response for `redirect: "manual"`, so this is for Node and similar runtimes). A request
that fails becomes a `request-failed` finding, so the hops before it are kept.

`GET` is the default because some servers answer `HEAD` differently, for example with 405 or
without the redirect. With `GET` the body is cancelled as soon as the headers arrive.

## Rules

Only 301, 302, 303, 307 and 308 are followed, the statuses that browsers follow (the Fetch
Standard's [redirect status](https://fetch.spec.whatwg.org/#redirect-status)).

| Rule | Severity | Meaning |
|---|---|---|
| `request-failed` | error | A request timed out or couldn't connect. The CLI exits 2 |
| `location-missing` | error | A redirect with no `Location` header ([RFC 9110 s15.4.2-15.4.9](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.2)) |
| `location-invalid` | error | `Location` can't be parsed as a URL. Relative values are legal and resolved against the request URL ([RFC 9110 s10.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.2)), so they aren't flagged |
| `location-scheme` | error | `Location` points to something other than http or https, such as `ftp:` or `javascript:` |
| `location-multiple` | error | The response sends `Location` more than once with different values. Chrome refuses the redirect (`ERR_RESPONSE_HEADERS_MULTIPLE_LOCATION`) and other clients may follow either one. Repeats of the same value are accepted |
| `redirect-loop` | error | A redirect back to a URL already in the chain ([RFC 9110 s15.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4): clients should detect cyclical redirections) |
| `too-many-hops` | error | Still redirecting after `maxHops` redirects (default 10, the number [Google's crawlers follow](https://developers.google.com/search/docs/crawling-indexing/http-network-errors)) |
| `https-downgrade` | error | A redirect from `https:` to `http:` |
| `final-status` | error | The chain ends in a 4xx or 5xx |
| `final-3xx` | error | The chain ends in a 3xx that isn't followed: 300, 305, 306, or a 304 to a request that wasn't conditional ([RFC 9110 s15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5)) |
| `redirect-temporary` | warning | A 302, 303 or 307 in a chain that ends at a working page. Temporary redirects ([s15.4.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.3), [s15.4.4](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.4), [s15.4.8](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.8)) keep the old URL in search results; [Google treats them as a weak signal](https://developers.google.com/search/docs/crawling-indexing/301-redirects). Suggests 301 or 308 if the move is permanent |
| `redirect-chain` | warning | More than one redirect before a working page. Point the first URL directly to the final one |
| `https-missing` | warning | An `http:` start URL that never reaches `https:` |

The chain-level rules (`redirect-temporary`, `redirect-chain`, `https-missing`) only run when
the chain reached a final response, so a loop or a failed request isn't buried in advice.
`redirect-temporary` and `redirect-chain` also need that response to be a 2xx.

## JSON

`--json` prints an array with one `RedirectResult` per URL. With `--expect` or `--map`, each
entry also has `expected` (the URL it should end at) and `matches` (whether the chain reached a
final response that isn't a redirect, at a `finalUrl` equal to it exactly). A loop, a failed
request or a broken redirect never matches, even when it stopped at the expected URL.

```json
[
  {
    "url": "http://github.com/",
    "hops": [
      { "url": "http://github.com/", "status": 301, "statusText": "Moved Permanently", "location": "https://github.com/", "durationMs": 113 },
      { "url": "https://github.com/", "status": 200, "statusText": "OK", "location": null, "durationMs": 44 }
    ],
    "finalUrl": "https://github.com/",
    "finalStatus": 200,
    "valid": true,
    "findings": [],
    "errorCount": 0,
    "warningCount": 0
  }
]
```

## Security

Unlike the other packages in this repository, this one makes network requests from the
library as well as the CLI. It fetches whatever URL you give it and then every redirect target,
including `localhost` and addresses on private networks, because a redirect can point anywhere.
That is what you want for checking your own sites from a terminal or a CI job, and exactly what
you don't want behind a public endpoint: anyone could use it to probe your internal network.

- Only `http:` and `https:` URLs are requested, and only the five redirect statuses are
  followed.
- Every request has a timeout. No more than `maxHops + 1` requests are made per URL.
- Response bodies are never read. A `GET` body is cancelled as soon as the headers arrive.
- No cookies or credentials are sent. The `User-Agent` names this package.

Don't wrap it in a public service without SSRF protection: vet every hop's resolved address
and pin it, as described in the repository's
[security model](https://github.com/idrisiRehan/websync-plugins/blob/main/docs/ecosystem/SECURITY-MODEL.md).
To report a vulnerability, see
[SECURITY.md](https://github.com/idrisiRehan/websync-plugins/blob/main/SECURITY.md).

## Limitations

- **HTTP redirects only.** JavaScript redirects and `<meta http-equiv="refresh">` redirects need
  the page body, which is never read. A page that redirects that way shows as a final 200.
- **No cookies.** A chain that depends on a cookie set by an earlier hop (some login and
  consent flows) can be reported as a loop, although a browser would get through.
- **One request per hop, from your network.** Servers that vary redirects by country,
  `User-Agent` or `Accept-Language` can answer browsers and crawlers differently.
- **`matches` is an exact comparison** after URL normalization (`https://example.com` becomes
  `https://example.com/`). `/page` and `/page/` are different URLs.
- **Timing is per request** and includes DNS and TLS setup when a connection is new.

## License

MIT © Rehan Idrisi, [WebSync](https://websync.in)

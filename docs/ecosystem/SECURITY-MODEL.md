# Security model

How WebSync packages and tools handle untrusted input and the network. This applies to every
package in this repository and to any site tool built on one.

## 1. Tiers of network exposure

| Tier | Who triggers the fetch | Rule |
|---|---|---|
| **Library** | n/a | **No network access.** Library code takes data the caller already has (a headers object, XML text, an identifier). No `fetch`, sockets, DNS, filesystem or environment reads. That rules out SSRF, credential leakage and rate-limit abuse by construction. |
| **Network library** (`redirect-inspector`, `store-check`) | The calling code | The library's purpose is fetching. `redirect-inspector` fetches the URL it is given and the redirect targets it is told to follow; `store-check` fetches a fixed, small set of well-known files and pages of the site it is given (its README states the request budget). http and https only, a timeout on every request, a byte cap on every body read, unneeded bodies cancelled, `fetch` injectable. They reach private addresses if told to, so they get the same "don't expose as is" rule as a CLI. Every other library stays in the tier above. |
| **CLI** | The operator, on their own machine | Fetches only the URL given on the command line. `localhost` and private addresses are **allowed**, because testing a dev server is a legitimate use and the operator already has that network access. Bounded by a timeout. Doesn't read response bodies it doesn't need. Fixed `User-Agent` naming the package. |
| **Public service** (websync.in `apis/`, any future hosted MCP) | Anyone on the internet | Every fetch of a caller-supplied URL goes through `safeFetch()` in the site's `apis/config.php`. Never call curl or `fetch` directly on caller input. Every route has a per-IP rate limit. |

Two CLIs fetch more than the URL on their command line, and say so in their READMEs:
`feed-page-check` fetches the item links inside the feed it is given (a default limit of 50 items,
a per-run request budget, one fetch per URL), and `ai-crawler-log` fetches only the operators'
published IP range files listed in the crawler table (none with `--ranges` or `--no-verify`).
Both use the same timeouts and byte caps as the network libraries.

A CLI must never be wrapped as a public service as it is. The README of every CLI says so.

## 2. Controls in `safeFetch()` (public tier)

These already exist in the site (`websync/apis/config.php`). Any new public fetch must use
them, not reimplement them:

- **Schemes and ports:** http and https only. Ports 80, 443, 8080 and 8443. No `user:pass@`.
- **Private addresses:** every A *and* AAAA record must be public. The blocklist covers
  RFC 1918, loopback, link-local (including the cloud metadata address 169.254.169.254),
  CGNAT 100.64/10, benchmarking 198.18/15, and the IPv4-mapped, NAT64 and 6to4 IPv6 prefixes
  that can carry a private IPv4 address. `localhost` and `*.localhost` are refused by name.
- **DNS rebinding:** the vetted address is pinned with `CURLOPT_RESOLVE`, so the connection
  goes to the address that was checked.
- **Redirects:** followed manually, at most 5, and every hop is re-vetted like the first URL.
- **Time:** one time budget shared across all hops.
- **Errors:** curl errors map to fixed messages. Raw `curl_error()` text, which can name
  internal hosts, never reaches a client.
- **Rate limits:** per-IP fixed window per route (`apis/routes.php`). The client IP comes from
  `REMOTE_ADDR`; forwarded headers are trusted only when configured.

- **Body size:** in body mode, `maxBytes` caps the body (default 4 MB). Anything past the cap
  is truncated, not an error. The cap is counted in curl's write callback, after
  `CURLOPT_ENCODING` has decompressed the data, so a compressed bomb stops at the same 4 MB.

Before any endpoint that fetches **many** URLs per request (a link checker or crawler):
design a per-request URL budget and a concurrency cap, and document them here. `safeFetch()`
bounds a single fetch, not a crawl.

## 3. Input handling (all tiers)

| Threat | Control |
|---|---|
| Huge input (memory) | Libraries process input in one linear pass. CLIs read headers only and cancel bodies. Sitemap linting will enforce the protocol's 50 MB and 50,000-URL limits before parsing further. |
| Pathological regex (ReDoS) | No user-supplied regular expressions. Built-in patterns are anchored and linear. Review every new pattern for nested quantifiers. |
| XML external entities | `sitemap-lint` parses XML with its own reader, which skips any DOCTYPE and expands only the five predefined entities and numeric references (ADR 0002). External entities and entity expansion can't happen. |
| Malformed HTML or headers | Parsers skip what they can't read and report it. They never throw on bad input. HTML goes through one shared tokenizer, which is fuzz-tested and linear (ADR 0005). Tests include malformed cases. |
| Path traversal | CLIs read only the file path the operator passes. Nothing is written except to stdout. |
| Shell execution | None. No `child_process` in published code. |
| Secrets in logs | Libraries don't log. CLIs print only the result and fixed error messages. |
| Supply chain | Zero runtime dependencies. Dev dependencies are TypeScript and `@types/node`. `npm audit` runs in CI. Packages are published from CI with npm provenance (RELEASING.md). |

## 4. Claims we don't make

- A security-header score is not a certification that a site is secure.
- Check-digit validation proves an identifier is well formed, not that it was issued or is
  active.
- No tool predicts search rankings, AI citations or crawler behaviour.

## 5. Review checklist for a new package or tool

- [ ] Which tier is it? If it's a library, does it avoid all network and filesystem access?
- [ ] If it's public: does every fetch go through `safeFetch()`? Is there a rate limit on the route?
- [ ] Is the size of every input bounded? Are there tests with oversized and malformed input?
- [ ] Do the README limitations state what a pass does *not* mean?
- [ ] Do the error messages avoid leaking internal hosts, paths or stack traces?
